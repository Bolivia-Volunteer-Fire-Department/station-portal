import { SCRIPT_URL } from '../config';
import { NOTIFICATION_TYPES } from '../utils/notificationPrefs';
import { EVENT_WEEKDAYS } from '../utils/events';
import { roleFieldsFromForm } from '../utils/permissions';
import { systemLogRequest } from '../utils/systemLog';

// The notification opt-in fields, enumerated from the shared switch catalogue rather than listed
// here by hand.
//
// This file used to keep its own copy of the keys, and that copy is what broke: a switch added to the
// catalogue and to the backend whitelist but NOT here was never sent, so the payload carried only an
// id, the backend answered "No settings were supplied.", and the member saw "Failed to save
// notification preference." Three hand-maintained lists existed; this removes one of them entirely,
// and verify:notification-prefs asserts the remaining two agree with the catalogue.
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
// Generous on purpose: Apps Script serialises requests behind a script lock, so a refresh wave can
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
// marker), so a write can never be applied twice.
async function appScriptFetch(body, { retryOnNetworkError = false } = {}) {
  // Every request is bounded. Apps Script serialises requests behind a script lock in doPost, so a
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

  if (data && data.redirected) return postOnce();
  return data;
}

export const fetchInitialData = async () =>
  appScriptFetch({ action: 'GET_INITIAL_DATA' }, { retryOnNetworkError: true });

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

export const registerPushDevice = async (deviceToken, deviceLabel, token) =>
  appScriptFetch({
    action: 'REGISTER_PUSH_DEVICE',
    token, // the session
    // The device token travels as `device_token`, because `token` is the session in the envelope.
    device_token: String(deviceToken || ''),
    device_label: String(deviceLabel || ''),
  });

export const unregisterPushDevice = async (deviceToken, token) =>
  appScriptFetch({ action: 'UNREGISTER_PUSH_DEVICE', token, device_token: String(deviceToken || '') });

export const fetchMyPushDevices = async (token) => appScriptFetch({ action: 'MY_PUSH_DEVICES', token });

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
    user_name: userData.user_name,
    name: userData.name,
    password: userData.password || '',
    status: userData.status,
    role_id: userData.role_id,
    rank_id: userData.rank_id,
    // An administrator-managed attribute on the users sheet. Sent with the rest of the row so a
    // save is ONE request; the backend ignores it unless the caller has is_admin.
    runner_sound_profile: String(userData.runner_sound_profile ?? ''),
  });

export const adminDeleteUser = async (userId, token) =>
  appScriptFetch({ action: 'ADMIN_DELETE_USER', token, id: userId });

// --- Admin: Roles ---

export const adminSaveRole = async (roleData, token) =>
  appScriptFetch({
    action: 'ADMIN_SAVE_ROLE',
    token,
    id: roleData.id || '',
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
// removal, because a signature is an acknowledgement of attendance rather than a preference.
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

// --- Events ---------------------------------------------------------------------
//
// Events are read by every signed-in member, because their calendars need them, and written only by a
// role holding can_create_events.

// The weekday flags, enumerated from the shared catalogue rather than listed by hand.
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