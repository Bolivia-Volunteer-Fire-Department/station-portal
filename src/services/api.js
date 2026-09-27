import { SCRIPT_URL } from '../config';
import { NOTIFICATION_TYPES } from '../utils/notificationPrefs';
import { EVENT_WEEKDAYS } from '../utils/events';
import { roleFieldsFromForm } from '../utils/permissions';
import { systemLogRequest } from '../utils/systemLog';
import { createReadCoalescer, isReadAction, readKey } from '../utils/readCoalescing';

// The row version a save was based on, when the caller has one.
//
// The backend refuses a single-record write built on a stale copy (see upsertSheetRowById in Code.gs) and
// answers CONFLICT with the row as it now stands. A save that sends nothing is not checked at all, which is
// what lets a page built before this keep working against a backend that has it.
const rowVersionField = (record) => (record && record.row_version !== undefined ? record.row_version : undefined);

// here by hand.
//
// This file used to keep its own copy of the keys, and that copy is what broke: a switch added to the
// catalog and to the backend whitelist but NOT here was never sent, so the payload carried only an
// id, the backend answered "No settings were supplied.", and the member saw "Failed to save
// notification preference." Three hand-maintained lists existed; this removes one of them entirely,
// and verify:notification-prefs asserts the remaining two agree with the catalog.
//
// Exported so the verifier can exercise it directly rather than re-implementing the enumeration.
export const notificationPrefFields = (settings) => {
  const fields = {};
  NOTIFICATION_TYPES.forEach((type) => {
    fields[type.key] = settings[type.key] === undefined ? undefined : String(settings[type.key]);
  });
  return fields;
};

// How long any single backend call may take before it is abandoned.
//
// Generous on purpose: Apps Script serializes requests behind a script lock, so a refresh wave can
// legitimately queue for tens of seconds under load. This is a backstop against a request that
// never returns at all, not a performance budget - without it, one stalled call leaves a caller
// awaiting forever, which the UI shows as a spinner that never stops.
const APP_SCRIPT_TIMEOUT_MS = 60000;

// How a timeout is described. The browser's own message for an aborted fetch is "signal is aborted without
// reason", which reads as a mystery in the console - and during a background refresh that is exactly where a
// reader will meet it.
const timeoutMessage = () =>
  `Apps Script did not answer within ${Math.round(APP_SCRIPT_TIMEOUT_MS / 1000)}s.`;
const isTimeoutAbort = (err) =>
  !!err && (err.name === 'AbortError' || /aborted/i.test(String(err.message || '')));

// How long a refused write waits before its single retry, in ms, and its ceiling.
//
// The server refuses a write it could not serialize (code BUSY) and asks for a short wait; this caps how long
// that wait can be so a hostile or mistaken `retry_after` cannot stall a save behind a long sleep.
const BUSY_RETRY_DEFAULT_MS = 1000;
const BUSY_RETRY_CAP_MS = 6000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A refused write is the ONE case where retrying a mutation is safe: the server answers BUSY only when it has
// written nothing at all (no cell, no log row, no session), and says so in the reply. That is categorically
// different from a network error, where the write may have landed and the answer been lost - which is why
// mutations never retry on those, and why this path is only ever entered on an explicit BUSY code.
//
// Reads cannot receive BUSY (they take no lock), so this is effectively a write-only path.
const busyRetryWaitMs = (data) => {
  const seconds = Number(data && data.retry_after);
  if (!Number.isFinite(seconds) || seconds <= 0) return BUSY_RETRY_DEFAULT_MS;
  return Math.min(BUSY_RETRY_CAP_MS, Math.round(seconds * 1000));
};

// Executes a POST against the Google Apps Script backend, transparently
// handling the platform's first-request redirect quirk.
//
// The first fetch to a freshly deployed /exec URL is answered with a 302
// redirect; browsers follow it as a GET, which drops the POST body. Without a
// doGet on the backend that redirected response carries no CORS headers, which
// surfaces in the console as:
//
//   Access ... blocked by CORS policy: No 'Access-Control-Allow-Origin' header
//   net::ERR_FAILED 200 (OK)
//
// Fix: the backend's doGet returns {"redirected": true} via ContentService
// (which Apps Script serves with Access-Control-Allow-Origin). When we see that
// marker the original action never ran - so we re-send it once to the now
// warmed URL. Read-only calls additionally retry once on a raw network/CORS
// failure, so the app still boots even before the backend is redeployed with
// doGet. Mutations never retry on network errors (only on the safe redirect
// marker, and on an explicit BUSY refusal), so a write can never be applied twice.
async function appScriptRequest(body, { retryOnNetworkError = false } = {}) {
  // Every request is bounded. Apps Script serializes requests behind a script lock in doPost, so a
  // long queue was previously able to leave a caller waiting indefinitely - and because callers
  // await these before clearing a spinner, an unbounded wait looked like a hung screen. A timeout
  // turns that into a normal, retryable error.
  const postOnce = () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), APP_SCRIPT_TIMEOUT_MS);
    return fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .finally(() => clearTimeout(timer));
  };

  let data;
  try {
    data = await postOnce();
  } catch (err) {
    // A timed-out request arrives as `AbortError: signal is aborted without reason`, which says nothing about
    // what happened or how long it waited. Named here, because this error surfaces in the console during a
    // background refresh and a reader should be able to tell a timeout from a network failure.
    const failure = isTimeoutAbort(err) ? new Error(timeoutMessage()) : err;
    if (!retryOnNetworkError) throw failure;
    return postOnce();
  }

  if (data && data.redirected) data = await postOnce();

  // A refused session is worth naming, loudly.
  //
  // "Session expired. Please sign in again." cannot be told apart from a request that was refused for some other
  // reason, and working it out from the outside is guesswork: the action that was refused and the token it was
  // sent with are what make it answerable from a bug report. Logged here because this is the one place every
  // request passes through, so no caller has to remember to do it.
  if (data && data.code === 'UNAUTHORIZED') {
    data.requestAction = body.action;
    const sent = String(body.token || body.payload?.token || '');
    console.warn(`[reauth] ${body.action} was refused (token …${sent.slice(-6) || 'none'})`);
  }

  // One retry, and only for a refusal: the other writer needs the moment `retry_after` asks for, and a second
  // refusal is reported to the caller rather than retried again.
  if (data && data.code === 'BUSY') {
    await sleep(busyRetryWaitMs(data));
    data = await postOnce();
  }

  // A write refused because the record moved on since the form was filled in. Reported as a normal failure
  // whose MESSAGE is the server's explanation ("...your change was NOT saved. Reload it and apply your change
  // again.") - every admin tab already surfaces `result.message`, so this needs no special case in the UI.
  // `current` rides along for a caller that wants to show or reload the newer row.
  return data;
}

// One read, one execution.
//
// The post-sign-in waves overlap (the member wave and the admin wave both fetch the schedule, the roster, on-duty,
// training, announcements and events), and the backend runs one execution at a time - so the duplicate copies of
// each read were pure queue. An identical read that is already in flight is shared instead of sent: see
// utils/readCoalescing for why that is safe, and why writes never join anything.
const readsInFlight = createReadCoalescer();

function appScriptFetch(body, options) {
  if (!isReadAction(body?.action)) return appScriptRequest(body, options);
  const key = readKey(body);
  const joined = readsInFlight.join(key);
  if (joined) return joined;
  return readsInFlight.hold(key, appScriptRequest(body, options));
}

export const fetchInitialData = async () =>
  appScriptFetch({ action: 'GET_INITIAL_DATA' }, { retryOnNetworkError: true });

// The whole member sign-in in ONE request: schedule, availability, roster, offers, training, announcements,
// events, clock history and who is on duty.
//
// Nine separate calls became one. Each of them was an Apps Script execution paying a second or three of startup
// before it read a cell, and the calls at the end of that queue were the ones that ran out of the 60-second
// patience this module enforces - which showed up as a calendar with no shifts on it and a clock that had gone
// back to 12-hour. See memberBootstrapPayload in Code.gs.
export const fetchBootstrap = async (token) =>
  appScriptFetch({ action: 'GET_BOOTSTRAP', token }, { retryOnNetworkError: true });

// Everything an administration sign-in - and every admin save's background reload - needs, in ONE request. The
// admin-scoped fields are present only for a role that may have them: a section the caller cannot have is omitted
// rather than refusing the whole response. See adminBootstrapPayload in Code.gs.
export const adminFetchBootstrap = async (token) =>
  appScriptFetch({ action: 'ADMIN_GET_BOOTSTRAP', token }, { retryOnNetworkError: true });

export const loginUser = async (username, password) =>
  appScriptFetch({ action: 'LOGIN', username, password });

export const fetchTimeclockLogs = async (token) =>
  appScriptFetch({ action: 'GET_TIMECLOCK_LOGS', token }, { retryOnNetworkError: true });

export const fetchOnDutyUsers = async (token) =>
  appScriptFetch({ action: 'GET_ON_DUTY', token }, { retryOnNetworkError: true });

// Refreshes the server-side session window without fetching anything. Used by the idle-timeout
// warning's "Stay signed in", so the button extends the real session rather than only a local timer.
export const pingSession = async (token) =>
  appScriptFetch({ action: 'PING', token }, { retryOnNetworkError: false });

export const fetchUserSchedule = async (token) =>
  appScriptFetch({ action: 'GET_SCHEDULE', token }, { retryOnNetworkError: true });

// Minimal member-visible roster (id/name/rank_id) used to label other members'
// shifts on the schedule calendar. Degrades gracefully: a backend deployment
// that predates GET_ROSTER simply returns no roster and the calendar falls back
// to member ids.
export const fetchRoster = async (token) =>
  appScriptFetch({ action: 'GET_ROSTER', token }, { retryOnNetworkError: true });

export const submitClockAction = async (action, userId, coords = {}, token) =>
  appScriptFetch({
    action, // 'CLOCK_IN' or 'CLOCK_OUT'
    user_id: userId,
    gps_lat: coords.latitude || '',
    gps_lon: coords.longitude || '',
    is_manual: false,
    token,
  });

// Push devices. Registration is per DEVICE (see the Push devices section of Code.gs): a member's
// phone and computer each hold their own row, so enabling one never disturbs the other.
//
// A device belongs to ONE member, so registering a token that is already somebody else's is refused
// and the refusal names them. `options.transfer` is the one way to insist - it is set by the settings
// card's "use this computer for me" button, and by nothing else.
export const registerPushDevice = async (deviceToken, deviceLabel, token, options) =>
  appScriptFetch({
    action: 'REGISTER_PUSH_DEVICE',
    token, // the session
    // The device token travels as `device_token`, because `token` is the session in the envelope.
    device_token: String(deviceToken || ''),
    device_label: String(deviceLabel || ''),
    transfer: options?.transfer === true,
  });

export const unregisterPushDevice = async (deviceToken, token) =>
  appScriptFetch({ action: 'UNREGISTER_PUSH_DEVICE', token, device_token: String(deviceToken || '') });

// The member's own devices, plus whose device this browser is when its token is passed in. The second
// half has to come from the server: the local subscription only says a device is enabled, never whose
// alerts it is set up to receive - and assuming it was the signed-in member's is what let a shared
// computer be taken over by simply signing in on it.
export const fetchMyPushDevices = async (token, deviceToken) =>
  appScriptFetch({
    action: 'MY_PUSH_DEVICES',
    token,
    device_token: String(deviceToken || ''),
  });

export const saveUserSettings = async (updatedSettings, token) =>
  appScriptFetch({
    action: 'UPDATE_USER_SETTINGS',
    token,
    payload: {
      id: String(updatedSettings.id),
      time_format: updatedSettings.time_format === undefined ? undefined : String(updatedSettings.time_format),
      is_dark_mode: updatedSettings.is_dark_mode === undefined ? undefined : String(updatedSettings.is_dark_mode),
      // Push-notification fields. Anything left undefined is ignored by the
      // backend, so the same call serves the settings form and the
      // "enable notifications on this device" flow (which only sends
      // fcm_token + the preference toggles).
      fcm_token: updatedSettings.fcm_token === undefined ? undefined : String(updatedSettings.fcm_token),
      ...notificationPrefFields(updatedSettings),
    },
  });

export const updateUserPassword = async (userId, newPassword, token) =>
  appScriptFetch({
    action: 'UPDATE_USER_PASSWORD',
    user_id: userId,
    password: newPassword,
    token,
  });
// --- Admin: Users ---

export const adminFetchUsers = async (token) =>
  appScriptFetch({ action: 'ADMIN_GET_USERS', token }, { retryOnNetworkError: true });

export const adminSaveUser = async (userData, token) =>
  appScriptFetch({
    action: 'ADMIN_SAVE_USER',
    token,
    id: userData.id || '',
    // Refuses the write if the row moved on since this form was filled in.
    row_version: rowVersionField(userData),
    user_name: userData.user_name,
    name: userData.name,
    password: userData.password || '',
    status: userData.status,
    role_id: userData.role_id,
    rank_id: userData.rank_id,
    // An administrator-managed attribute on the users sheet. Sent with the rest of the row so a
    // save is ONE request; the backend ignores it unless the caller has is_admin.
    runner_sound_profile: String(userData.runner_sound_profile ?? ''),
    // The two per-member flags. Both are sent every time, because the backend normalizes each to TRUE/FALSE and
    // writes only the ones it is given - so omitting one here would leave it silently unwritable. It was:
    // "Exclude from scheduling" had a checkbox, a badge in the list and backend support, and this payload did
    // not carry it, so ticking it changed nothing.
    exclude_from_scheduling: userData.exclude_from_scheduling,
    is_change_password_on_login: userData.is_change_password_on_login,
  });

export const adminDeleteUser = async (userId, token) =>
  appScriptFetch({ action: 'ADMIN_DELETE_USER', token, id: userId });

// --- Admin: Roles ---

export const adminSaveRole = async (roleData, token) =>
  appScriptFetch({
    action: 'ADMIN_SAVE_ROLE',
    token,
    id: roleData.id || '',
    row_version: rowVersionField(roleData),
    description: roleData.description,
    // Every permission column travels together, resolved through the shared rules
    // (the is_admin master switch and the per-permission dependencies the editor
    // shows). The backend copies any `can_*` field through by name, so a new
    // column needs no change on either side.
    ...roleFieldsFromForm(roleData),
  });

export const adminDeleteRole = async (roleId, token) =>
  appScriptFetch({ action: 'ADMIN_DELETE_ROLE', token, id: roleId });

// --- Admin: Ranks ---

export const adminSaveRank = async (rankData, token) =>
  appScriptFetch({
    action: 'ADMIN_SAVE_RANK',
    token,
    id: rankData.id || '',
    row_version: rowVersionField(rankData),
    description: rankData.description,
    color: rankData.color,
    icon: rankData.icon,
  });

export const adminDeleteRank = async (rankId, token) =>
  appScriptFetch({ action: 'ADMIN_DELETE_RANK', token, id: rankId });

// --- Admin: Shifts ---

export const adminSaveShift = async (shiftData, token) =>
  appScriptFetch({
    action: 'ADMIN_SAVE_SHIFT',
    token,
    id: shiftData.id || '',
    row_version: rowVersionField(shiftData),
    description: shiftData.description,
    start_time: shiftData.start_time,
    end_time: shiftData.end_time,
    is_monday: !!shiftData.is_monday,
    is_tuesday: !!shiftData.is_tuesday,
    is_wednesday: !!shiftData.is_wednesday,
    is_thursday: !!shiftData.is_thursday,
    is_friday: !!shiftData.is_friday,
    is_saturday: !!shiftData.is_saturday,
    is_sunday: !!shiftData.is_sunday,
  });

export const adminDeleteShift = async (shiftId, token) =>
  appScriptFetch({ action: 'ADMIN_DELETE_SHIFT', token, id: shiftId });
// --- Admin: Schedule Templates ---

export const adminFetchScheduleTemplates = async (token) =>
  appScriptFetch({ action: 'ADMIN_GET_SCHEDULE_TEMPLATES', token }, { retryOnNetworkError: true });

export const adminSaveScheduleTemplate = async (templateData, token) =>
  appScriptFetch({
    action: 'ADMIN_SAVE_SCHEDULE_TEMPLATE',
    token,
    id: templateData.id || '',
    row_version: rowVersionField(templateData),
    day_of_week: templateData.day_of_week,
    start_time: templateData.start_time,
    end_time: templateData.end_time,
    assignment_id: templateData.assignment_id,
    // Optional display name shown on the schedules in place of the times.
    nickname: templateData.nickname || '',
    // Optional window. Blank means open-ended, which is how every existing template behaves.
    // Sent as yyyy-MM-dd, the form an <input type="date"> produces and the form the sheet
    // stores after the backend normalizes it.
    effective_date: templateData.effective_date || '',
    end_date: templateData.end_date || '',
    // The sheet has an optional apparatus_id column; it will be surfaced in
    // the UI once apparatus management is built out (preserved here so saves
    // never clobber it).
    apparatus_id: templateData.apparatus_id || '',
  });

export const adminDeleteScheduleTemplate = async (templateId, token) =>
  appScriptFetch({ action: 'ADMIN_DELETE_SCHEDULE_TEMPLATE', token, id: templateId });

// The Firefighter Runner sound prefix for a member. It is an administrator-managed attribute on
// the users sheet, so it is saved with the rest of the row by adminSaveUser above - the backend
// ignores the field unless the caller has is_admin.

// Training: the station's training record, and each member's signatures against it.
//
// GET_TRAINING returns the training list to any signed-in member, but the signatures are
// filtered server-side by role: a member receives only their own, and the full set travels
// only to someone who can administer trainings.
export const fetchTraining = async (token) =>
  appScriptFetch({ action: 'GET_TRAINING', token });

// Signs a batch of trainings in one request. Add-only on purpose - the backend refuses any
// removal, because a signature is an acknowledgment of attendance rather than a preference.
export const signTraining = async (trainingIds, token) =>
  appScriptFetch({
    action: 'SIGN_TRAINING',
    token,
    payload: { training_ids: trainingIds.map((id) => String(id)) },
  });

// Adding and editing training details, for a role with can_edit_trainings. No deletion - that
// is adminBulkSaveTraining's job, and the backend refuses a delete here.
export const saveTraining = async ({ trainings = [] }, token) =>
  appScriptFetch({
    action: 'SAVE_TRAINING',
    token,
    payload: { trainings },
  });

// The admin Training report: saves training definitions (blank id = new row) and deletes the
// ones named in deleteIds, in a single request.
export const adminBulkSaveTraining = async ({ trainings = [], deleteIds = [] }, token) =>
  appScriptFetch({
    action: 'ADMIN_BULK_SAVE_TRAINING',
    token,
    payload: {
      trainings,
      deleteIds: deleteIds.map((id) => String(id)),
    },
  });

// Removes one signature. The only path that can, and it needs can_administer_trainings.
export const adminRemoveTrainingSignature = async (signatureId, token) =>
  appScriptFetch({
    action: 'ADMIN_REMOVE_TRAINING_SIGNATURE',
    token,
    signature_id: String(signatureId),
  });

// --- Announcements ---------------------------------------------------------------
//
// The announcements visible to the signed-in member (targeted by role/rank/member), and the
// administrator's four actions over them. Public announcements for the login screen arrive with
// GET_INITIAL_DATA instead, since there is no session yet at that point.

export const fetchMyAnnouncements = async (token) =>
  appScriptFetch({ action: 'MY_ANNOUNCEMENTS', token });

export const adminFetchAnnouncements = async (token) =>
  appScriptFetch({ action: 'ADMIN_GET_ANNOUNCEMENTS', token });

export const adminSaveAnnouncement = async (announcementData, token) =>
  appScriptFetch({
    action: 'ADMIN_SAVE_ANNOUNCEMENT',
    token,
    // A blank id creates; otherwise it updates in place. author_user_id is deliberately not sent:
    // the backend stamps it from the session on create and never lets it change.
    id: announcementData.id || '',
    row_version: rowVersionField(announcementData),
    title: announcementData.title || '',
    message: announcementData.message || '',
    effective_date: announcementData.effective_date || '',
    end_date: announcementData.end_date || '',
    is_visible_on_login: Boolean(announcementData.is_visible_on_login),
    is_visible_on_dashboard: Boolean(announcementData.is_visible_on_dashboard),
    is_visible_on_sidebar: Boolean(announcementData.is_visible_on_sidebar),
    role_id: announcementData.role_id || '',
    rank_id: announcementData.rank_id || '',
    user_id: announcementData.user_id || '',
    icon: announcementData.icon || '',
    context_variant: announcementData.context_variant || 'info',
    is_send_push_notification: Boolean(announcementData.is_send_push_notification),
    is_dismissable: Boolean(announcementData.is_dismissable),
  });

export const adminDeleteAnnouncement = async (id, token) =>
  appScriptFetch({ action: 'ADMIN_DELETE_ANNOUNCEMENT', token, id });

// --- Documents -------------------------------------------------------------------
//
// Two read pairs, because the audiences differ: a member reads what is published and at or above
// their rank, an administrator reads everything including drafts. Both list reads are METADATA
// ONLY - the body is fetched one document at a time - which is what keeps opening the module
// cheap however large the library gets.

export const fetchDocuments = async (token) => appScriptFetch({ action: 'GET_DOCUMENTS', token });

export const fetchDocument = async (id, token) => appScriptFetch({ action: 'GET_DOCUMENT', token, id });

export const adminFetchDocuments = async (token) => appScriptFetch({ action: 'ADMIN_GET_DOCUMENTS', token });

export const adminFetchDocument = async (id, token) => appScriptFetch({ action: 'ADMIN_GET_DOCUMENT', token, id });

export const adminSaveDocument = async (documentData, token) =>
  appScriptFetch({
    action: 'ADMIN_SAVE_DOCUMENT',
    token,
    // A blank id creates; otherwise it updates in place. author_user_id is deliberately not sent: the
    // backend stamps it from the session on create and never lets it change.
    id: documentData.id || '',
    row_version: rowVersionField(documentData),
    title: documentData.title || '',
    folder: documentData.folder || '',
    doc_type: documentData.doc_type || 'markdown',
    sort_order: documentData.sort_order ?? 0,
    content: documentData.content ?? '',
    // Defaults to published: the switch is a deliberate "hide while I write".
    is_published: documentData.is_published === undefined ? true : Boolean(documentData.is_published),
    rank_id: documentData.rank_id || '',
    is_sign_required: Boolean(documentData.is_sign_required),
  });

export const adminDeleteDocument = async (id, token) =>
  appScriptFetch({ action: 'ADMIN_DELETE_DOCUMENT', token, id });

// Renames a folder by rewriting the column on the documents that carry the name. A blank `to` moves the
// folder's documents back to unfiled, which is the only way to get rid of a folder - there is no folder
// row to delete, because a folder is a name here rather than a record.
export const adminRenameDocumentFolder = async (from, to, token) =>
  appScriptFetch({ action: 'ADMIN_RENAME_DOCUMENT_FOLDER', token, from, to: to || '' });

// Drag-and-drop ordering. The pairs are worked out by `reorderDocuments` / `reorderFolders` in
// utils/documents - the rule belongs on the side that can be tested - and the server only checks that the rows
// exist and writes `sort_order` on them. Nothing else about a document is touched, which is what keeps a drag
// from being a save: no `row_version` moves, so an open editor does not get told somebody else changed the
// document when all that happened is a row moving up.
export const adminReorderDocuments = async (order, token) =>
  appScriptFetch({ action: 'ADMIN_REORDER_DOCUMENTS', token, order });

// --- Document signatures -----------------------------------------------------------
//
// A signature is ADD-ONLY from the member's side: the backend refuses a removal outright rather than ignoring
// one, and removing a signature is an administrator's action. Note what is NOT sent by `signDocument`: the date,
// who signed it and who it was for. All three are stamped from the session on the server.

export const signDocument = async (id, token) => appScriptFetch({ action: 'SIGN_DOCUMENT', token, id });

// The signature report for one document: administrators who manage documents, and the officers who verify
// checklists. Named for what it returns rather than for who calls it - a verifier is not an administrator.
// Another member's records, for a verifier looking at them. The mirror of `fetchDocuments`: same shape, same
// rules, applied by the server to the NAMED member's rank rather than the caller's. Gated on
// can_verify_documents, which is the permission that means "I read other people's paperwork to confirm it".
export const fetchMemberDocumentRecords = async (userId, token) =>
  appScriptFetch({ action: 'GET_MEMBER_DOCUMENT_RECORDS', token, user_id: userId });

export const fetchDocumentSignatures = async (id, token) =>
  appScriptFetch({ action: 'GET_DOCUMENT_SIGNATURES', token, id });

export const adminRemoveDocumentSignature = async (signatureId, token) =>
  appScriptFetch({ action: 'ADMIN_REMOVE_DOCUMENT_SIGNATURE', token, id: signatureId });

// --- Checklist items ---------------------------------------------------------------
//
// Signing and verifying a checklist item are two different things and are two different calls. `signChecklistItem`
// is the member's own - the backend takes the member and the timestamp from the session, and refuses if the item
// belongs to another document. `verifyChecklistItem` is somebody else's, and names the member whose item it is;
// the backend refuses that user_id being the caller's own.
//
// `verifyChecklistRemaining` is the bulk form: everything one member has signed and nobody has confirmed, in one
// request. It exists because a 40-item checklist would otherwise be 40 round trips against a script that takes
// seconds per call, with no way to tell which of them had landed.

export const signChecklistItems = async (documentId, itemIds, token) =>
  appScriptFetch({
    action: 'SIGN_CHECKLIST_ITEM',
    token,
    document_id: documentId,
    // A list, because ticking several boxes and saving once is how the screen is used. The backend skips an item
    // that is already signed or that belongs to another checklist, and counts it, rather than failing the batch.
    item_ids: Array.isArray(itemIds) ? itemIds : [],
  });

export const verifyChecklistItem = async (documentId, itemId, userId, token) =>
  appScriptFetch({
    action: 'VERIFY_CHECKLIST_ITEM',
    token,
    document_id: documentId,
    item_id: itemId,
    user_id: userId,
  });

export const verifyChecklistRemaining = async (documentId, userId, token) =>
  appScriptFetch({
    action: 'VERIFY_CHECKLIST_REMAINING',
    token,
    document_id: documentId,
    user_id: userId,
  });

export const adminSaveChecklistItem = async (item, token) =>
  appScriptFetch({
    action: 'ADMIN_SAVE_CHECKLIST_ITEM',
    token,
    // A blank id creates; an id edits IN PLACE, which is what keeps the signatures pointing at it.
    id: item.id || '',
    document_id: item.document_id || '',
    sort_order: item.sort_order ?? 0,
    section: item.section || '',
    label: item.label || '',
  });

export const adminDeleteChecklistItem = async (id, token) =>
  appScriptFetch({ action: 'ADMIN_DELETE_CHECKLIST_ITEM', token, id });

// --- Events ---------------------------------------------------------------------
//
// Events are read by every signed-in member, because their calendars need them, and written only by a
// role holding can_create_events.

// The weekday flags, enumerated from the shared catalog rather than listed by hand.
//
// Same reasoning as notificationPrefFields above: a hand-written copy of a key list is exactly what broke
// the notification preferences, so anything enumerable is enumerated.
const eventWeekdayFields = (eventData) => {
  const fields = {};
  EVENT_WEEKDAYS.forEach((day) => {
    fields[day.key] = eventData[day.key];
  });
  return fields;
};

export const fetchEvents = async (token) => appScriptFetch({ action: 'GET_EVENTS', token });

export const adminFetchEvents = async (token) => appScriptFetch({ action: 'ADMIN_GET_EVENTS', token });

export const adminSaveEvent = async (eventData, token) =>
  appScriptFetch({
    action: 'ADMIN_SAVE_EVENT',
    token,
    // A blank id creates; otherwise it updates in place. author_user_id is deliberately not sent: the
    // backend stamps it from the session on create and never lets it change.
    id: eventData.id || '',
    row_version: rowVersionField(eventData),
    title: eventData.title,
    date_from: eventData.date_from,
    date_to: eventData.date_to,
    color: eventData.color,
    role_id: eventData.role_id,
    rank_id: eventData.rank_id,
    user_id: eventData.user_id,
    is_recurring: eventData.is_recurring,
    is_all_day: eventData.is_all_day,
    recurring_start: eventData.recurring_start,
    recurring_end: eventData.recurring_end,
    recurring_amount: eventData.recurring_amount,
    recurring_frequency: eventData.recurring_frequency,
    date_of_month: eventData.date_of_month,
    ...eventWeekdayFields(eventData),
  });

export const adminDeleteEvent = async (id, token) =>
  appScriptFetch({ action: 'ADMIN_DELETE_EVENT', token, id });

export const adminSaveAssignment = async (assignmentData, token) =>
  appScriptFetch({
    action: 'ADMIN_SAVE_ASSIGNMENT',
    token,
    id: assignmentData.id || '',
    row_version: rowVersionField(assignmentData),
    description: assignmentData.description,
    // Both of these were being dropped here: the form collected a minimum rank
    // and the backend accepted one, but the value never left the browser. Sent
    // as-is (empty string clears them), which is what the backend's
    // "only written when supplied" rules expect.
    rank_order_required: assignmentData.rank_order_required ?? '',
    color: assignmentData.color ?? '',
    // Optional icon name from the curated set in src/components/RankIcon.jsx, drawn
    // with the assignment wherever it appears. An empty string clears it.
    icon: assignmentData.icon ?? '',
    // Optional window. Blank means open-ended, which is how every existing assignment behaves.
    // Sent as yyyy-MM-dd, the form an <input type="date"> produces and the form the sheet stores
    // after the backend normalizes it.
    effective_date: assignmentData.effective_date ?? '',
    end_date: assignmentData.end_date ?? '',
  });

export const adminDeleteAssignment = async (assignmentId, token) =>
  appScriptFetch({ action: 'ADMIN_DELETE_ASSIGNMENT', token, id: assignmentId });

// Bulk-saves schedule entries in one request: `entries` are upserted by id
// (blank id = new row) and `deleteIds` are removed. Used by the Schedule
// Management tab so all in-memory edits flush in a single Save.
export const adminBulkSaveSchedule = async ({ entries = [], deleteIds = [] }, token) =>
  appScriptFetch({
    action: 'ADMIN_BULK_SAVE_SCHEDULE',
    token,
    entries,
    deleteIds,
  });

// --- Shift offers (member request -> admin approval) ---

// The signed-in member's own offers, each carrying a derived `status`
// ('pending' | 'approved' | 'declined') and the `slot_key` the calendar matches
// its open pills against.
export const fetchMyShiftOffers = async (token) =>
  appScriptFetch({ action: 'GET_SHIFT_OFFERS', token }, { retryOnNetworkError: true });

// Offers to fill an open shift. `schedule_id` links an offer made on an existing
// unassigned row; template occurrences leave it blank.
export const submitShiftOffer = async ({ schedule_template_id, date_from, date_to, assignment_id, schedule_id } = {}, token) =>
  appScriptFetch({
    action: 'SUBMIT_SHIFT_OFFER',
    token,
    schedule_template_id: schedule_template_id || '',
    date_from: date_from || '',
    date_to: date_to || '',
    assignment_id: assignment_id || '',
    schedule_id: schedule_id || '',
  });

// Admin: every offer, so the Schedule Management calendar can flag the slots
// waiting on approval.
export const adminFetchScheduleOffers = async (token) =>
  appScriptFetch({ action: 'ADMIN_GET_SCHEDULE_OFFERS', token }, { retryOnNetworkError: true });

// One page of the system log. The filter, sort and page travel with the request because the sheet is
// never sent whole - see the System Log tab and systemLogPage in Code.gs.
//
// The body comes from systemLogRequest, which is where the RPC envelope and the query are composed.
// Building it inline here is what broke this tab: `{ action: 'ADMIN_GET_SYSTEM_LOG', token, ...params }`
// looks right, but the query carries an `action` key of its own (the log's action FILTER), and
// spreading it afterwards replaced the action name with ''.
export const adminFetchSystemLog = async (params = {}, token) =>
  appScriptFetch(systemLogRequest(params, token), { retryOnNetworkError: true });

// Admin: approve (fills the shift) or decline a single offer. Other pending
// offers for the same shift are closed out on approval.
export const adminResolveShiftOffer = async (offerId, decision, token) =>
  appScriptFetch({ action: 'ADMIN_RESOLVE_SHIFT_OFFER', token, id: offerId, decision });

// --- Availability ---

export const fetchAvailability = async (token) =>
  appScriptFetch({ action: 'GET_AVAILABILITY', token }, { retryOnNetworkError: true });

// One availability slot in the shape the backend expects. `date_to` defaults to the start
// date: a template occurrence is a single day.
const availabilitySlotFields = (slot) => ({
  schedule_template_id: slot?.templateId || '',
  date_from: slot?.dateKey || '',
  date_to: slot?.dateToKey || slot?.dateKey || '',
});

// Applies every availability change the caller accumulated, in ONE request.
//
// This used to be one call per click, which meant a request - and a full sheet read on the
// server - for every tick. The screens now hold the edits locally until Save and send only
// what actually changed, so a month of ticks costs one round trip.
export const setMyAvailability = async ({ adds = [], removes = [] } = {}, token) =>
  appScriptFetch({
    action: 'SET_MY_AVAILABILITY',
    token,
    adds: adds.map(availabilitySlotFields),
    removes: removes.map(availabilitySlotFields),
  });

// Admin: the same batch, for another member.
export const adminSetAvailability = async (userId, { adds = [], removes = [] } = {}, token) =>
  appScriptFetch({
    action: 'ADMIN_SET_AVAILABILITY',
    token,
    user_id: userId,
    adds: adds.map(availabilitySlotFields),
    removes: removes.map(availabilitySlotFields),
  });

// --- Admin: System Settings ---

export const adminSaveSystemSetting = async (key, value, token) =>
  appScriptFetch({ action: 'ADMIN_SAVE_SYSTEM_SETTING', token, key, value });

// Saves many settings in ONE request, all-or-nothing.
//
// The Loading Messages card used to call the single-key action once per message, so ten messages were ten
// requests - and a failure part-way left some saved and some not, which reads as the app lying about what it
// stored. The backend validates every pair before writing any of them.
export const adminSaveSystemSettings = async (settings, token) =>
  appScriptFetch({ action: 'ADMIN_SAVE_SYSTEM_SETTINGS', token, settings });

// True when the deployment serving us predates an action, which is how a page newer than its backend detects
// that it has to fall back rather than fail. See the UNKNOWN_ACTION reply in Code.gs.
export const isUnknownAction = (result) => !!result && result.code === 'UNKNOWN_ACTION';

export const adminDeleteSystemSetting = async (key, token) =>
  appScriptFetch({ action: 'ADMIN_DELETE_SYSTEM_SETTING', token, key });

// --- Admin: Push notifications ---

// Per-member push status: whether a device is registered and which
// notification types that member has switched on (blank = station default).
export const adminFetchPushStatus = async (token) =>
  appScriptFetch({ action: 'ADMIN_GET_PUSH_STATUS', token }, { retryOnNetworkError: true });

// Sends a one-off push to a single member so an admin can verify the FCM
// setup end to end. Returns { success, message, detail }.
export const adminSendTestPush = async (userId, token) =>
  appScriptFetch({ action: 'ADMIN_SEND_TEST_PUSH', token, user_id: userId });

// Which FCM credentials are present, as booleans - the service-account private
// key is write-only and is never returned, not even to an authenticated admin.
export const adminFetchFcmStatus = async (token) =>
  appScriptFetch({ action: 'ADMIN_GET_FCM_STATUS', token }, { retryOnNetworkError: true });

// --- Admin: Clock Management ---

export const adminSaveTimeclockEntry = async (entryData, token) =>
  appScriptFetch({
    action: 'ADMIN_SAVE_TIMECLOCK_ENTRY',
    token,
    id: entryData.id || '',
    user_id: entryData.user_id,
    time_in: entryData.time_in,
    time_out: entryData.time_out || '',
  });

export const adminDeleteTimeclockEntry = async (entryId, token) =>
  appScriptFetch({ action: 'ADMIN_DELETE_TIMECLOCK_ENTRY', token, id: entryId });

// --- Firefighter Runner (easter egg) ---

// The station leaderboard: personal bests above zero, highest first.
export const fetchRunnerLeaderboard = async (token) =>
  appScriptFetch({ action: 'GET_RUNNER_LEADERBOARD', token }, { retryOnNetworkError: true });

// Records a finished run. The backend keeps the higher of the two scores, so this can be
// called after every game without risking a personal best.
export const saveRunnerScore = async (score, token) =>
  appScriptFetch({ action: 'SAVE_RUNNER_SCORE', token, score });