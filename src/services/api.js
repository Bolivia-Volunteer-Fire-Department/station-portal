import { NOTIFICATION_TYPES } from '../utils/notificationPrefs';
import { EVENT_WEEKDAYS } from '../utils/events';
import { roleFieldsFromForm } from '../utils/permissions';
import { storedRequiresVerification } from '../utils/documents.js';
import { rankFieldsFromForm } from '../utils/ranks';
import { isReadAction } from '../utils/readCoalescing';
import { SESSION_ENDED_MESSAGE } from '../utils/sessionTimeout';
import { routeRead, routeWrite, routingBlocker, lastReadFailureFor } from './firestoreRouting.js';
// The payload's section readers, so the refresh after a save reads the same shapes a sign-in does.
import { readAdminSection, readAdminSections } from './firestorePayload.js';
import { decorateCertifications } from '../utils/certifications.js';
import { stationTodayKey } from '../utils/scheduleDate.js';
import {
  changeOwnPassword,
  createMember,
  resetMemberPassword,
  setMemberStatus,
  signInAsMember,
  updateMemberAccount,
} from './firebaseAuth.js';
import { firebaseAuth, firebaseConfigured, firestore } from './firebase.js';
import { doc, getDoc, setDoc } from 'firebase/firestore';

// The row version a save was based on, when the caller has one.
//
// The sheet backend refused a single-record write built on a stale copy (see upsertSheetRowById there) and
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

// THE TIMEOUT, THE BUSY RETRY AND THE ABORT DETECTION USED TO LIVE HERE, and they went with the backend that needed
// them. All three existed because of how Apps Script behaves: it serialises requests behind a script lock, so a refresh
// wave could queue for tens of seconds and needed a 60-second backstop; it refuses a write it could not serialise with
// BUSY and a `retry_after`; and an abandoned fetch reports "signal is aborted without reason", which needed naming.
//
// None of that applies to Firestore. A request that does not come back rejects on its own with a real error, and
// Firestore's writers already answer a conflict with the message the admin tabs display - so the retry loop, the
// abort-naming and the wait ceiling have no work to do and are gone rather than kept as decoration.

// THE APPS SCRIPT BACKEND USED TO BE CALLED FROM HERE, and this is where it was.
//
// `appScriptRequest` POSTed the action envelope to the deployed script: a bounded timeout because the platform
// serialises requests behind a script lock, a first-request 302 warm-up, a UNAUTHORIZED path that opened the
// reauthentication prompt, and BUSY/CONFLICT retries. Every one of those shapes belonged to that platform, and none of
// them is needed now: Firestore is asked directly and answers with Firestore's own errors, which the routed writers
// map to the same `result.message` the screens already show.
//
// What went with it, deliberately, is the FALLBACK. A read Firestore refused used to be re-asked of the sheet, which
// kept a screen working while hiding a migration step that was not working - the module's own comment called that out
// as the thing that "hides it". Now a routed read that fails throws and the screen says so, which is the honest answer
// once there is nothing left to fall back TO.

// THE ONE GATE EVERY DATA CALL PASSES THROUGH, and its name is now historical: the bodies are still shaped as the
// action envelopes they were when a sheet answered them, because the action NAMES are what the routing tables are
// keyed by and every call site still names one. The name is kept rather than renamed across a hundred call sites in
// the same change that removes the backend - see the README's data-model section.
//
// An action with no route THROWS rather than being swallowed or asked of somewhere else: there is no second backend
// now, and a screen that quietly receives nothing is the failure this module exists to prevent.
// WHY IT WAS NOT ANSWERED, ASKED RATHER THAN ASSUMED.
//
// The first version of this said "Firestore did not answer X", which sends the reader looking for a failing query when
// the real answer can be "this route is switched off". VITE_FIRESTORE_FEATURES pins a LIST of routes when it is set,
// and anything left out of that list is simply not routed - so the honest message needs the blocker, and the blocker
// knows what it is. This is the difference between an afternoon spent hunting a phantom Firestore failure and one
// console line that says which route is off.
//
// A SESSION THAT ENDED IS NOT A ROUTING PROBLEM, and saying it as one sends the reader to the wrong place: the action
// IS routed and the build is fine - what happened is that the Firebase session this tab was holding had gone. The app
// watches for that and signs the member out with this same sentence (App.jsx), so what arrives here is the race it
// cannot win: a button pressed in the moment between the session ending and the login screen appearing. The code stays
// the routing one, so a caller treating it as "this route was not taken" is still right.
const notSignedIn = () => {
  const ended = new Error(SESSION_ENDED_MESSAGE);
  ended.code = 'ROUTE_NOT_TAKEN';
  return ended;
};

const notAnswered = async (action) => {
  const blocker = await routingBlocker(action);
  if (blocker === 'not-signed-in-to-firebase') return notSignedIn();
  // THE REASON, WHEN WE HAVE ONE. A blocked route is a route that is missing; a route that RAN and threw is a different
  // answer entirely, and the app knows which it is - so it says so rather than describing both as "did not answer".
  const failed = blocker ? '' : lastReadFailureFor(action);
  const error = new Error(
    blocker
      ? `${action} was not routed (${blocker}), and there is no sheet behind it any more, so nothing answered it.` +
        (blocker === 'feature-off'
          ? ' VITE_FIRESTORE_FEATURES pins a list of routes when it is set, and this route is not in it - leave it unset for every route.'
          : '')
      : failed
        ? `${action} failed: ${failed}`
        : `Firestore did not answer ${action}. The console says which read failed.`
  );
  error.code = blocker ? 'ROUTE_NOT_TAKEN' : 'READ_FAILED';
  return error;
};

// WHAT THE REQUESTS GO TO: one of two routed dispatchers, and nothing else. Reads go to the reader dispatcher
// (firestoreReads.js, through firestoreRouting.js), writes to the writer dispatcher, and an action that neither answers is
// an ERROR rather than a silent no-op - `notAnswered` logs the action and says what is missing.
//
// IT USED TO BE CALLED `appScriptFetch`, and the rename is the point rather than tidiness: the sheet is gone from this path
// entirely (there is no fallback behind it any more - see the note above about what was removed), so a name that said "fetch
// this from Apps Script" described a backend that no longer exists. `routeRead` and `routeWrite` are what it dispatches to,
// and now its name says so.
function dispatchRequest(body) {
  const action = body?.action ?? '';

  // Reads answer from firestoreReads.js, one slice at a time.
  if (isReadAction(action)) {
    return routeRead(action, body).then(async (routed) => {
      if (routed) return routed;
      throw await notAnswered(action);
    });
  }

  // Writes go to their own dispatcher: the admin tabs' simple saves reach here through the one hook, and everything
  // with a dedicated routeWrite call never does.
  return routeWrite(action, body).then(async (routed) => {
    if (routed) return routed;
    throw await notAnswered(action);
  });
}

export const fetchInitialData = async () =>
  dispatchRequest({ action: 'GET_INITIAL_DATA' });

// The whole member sign-in in ONE request: schedule, availability, roster, offers, training, announcements,
// events, clock history and who is on duty.
//
// Nine separate calls became one. Each of them was an Apps Script execution paying a second or three of startup
// before it read a cell, and the calls at the end of that queue were the ones that ran out of the 60-second
// patience this module enforces - which showed up as a calendar with no shifts on it and a clock that had gone
// back to 12-hour. See the member payload in firestorePayload.js.
export const fetchBootstrap = async () => {
  // The whole member sign-in in ONE read: schedule, availability, roster, offers, training, announcements, events,
  // clock history and who is on duty.
  //
  // No fallback and no silent null. This payload is the app's first screen after sign-in, so a failure has to reach the
  // loading state as an error rather than being rendered as an empty station - which is exactly what a fallback to a
  // backend that no longer exists would produce. routeRead logs which read failed, by name, before this throws.
  const payload = await routeRead('GET_BOOTSTRAP');
  if (!payload) throw await notAnswered('GET_BOOTSTRAP');
  return payload;
};

// Everything an administration sign-in - and every admin save's background reload - needs, in ONE request. The
// admin-scoped fields are present only for a role that may have them: a section the caller cannot have is omitted
// rather than refusing the whole response. See the admin payload in firestorePayload.js.
export const adminFetchBootstrap = async () => {
  // The officer's whole sign-in in ONE read, the same arrangement as the member bootstrap and the same refusal to
  // answer with a silent null.
  const payload = await routeRead('ADMIN_GET_BOOTSTRAP');
  if (!payload) throw await notAnswered('ADMIN_GET_BOOTSTRAP');
  return payload;
};

// ONE OR TWO SECTIONS OF THAT PAYLOAD, for the refresh after a save.
//
// A save knows what it changed (`onDataChanged('ranks')`), so re-reading the whole payload for it is waste: the payload
// is eighteen collections, one of which is every shift the station has ever scheduled. This reads just the named
// sections, through the same readers the payload itself uses - so a scoped refresh cannot answer with a different shape
// than a sign-in. An unknown name throws rather than quietly refreshing nothing, because a screen that failed to update
// looks exactly like a scoped refresh that did not run.
export const fetchAdminCertificationRecords = async ({ includeInactive = false } = {}) => {
  const response = await routeRead('ADMIN_GET_CERTIFICATIONS', { includeInactive });
  if (!response?.success) throw await notAnswered('ADMIN_GET_CERTIFICATIONS');
  const { certificationSetup = [] } = await readAdminSection('certificationSetup');
  const activeIds = new Set(response.activeUserIds || []);
  return decorateCertifications(response.records || [], certificationSetup, stationTodayKey()).map((row) => ({
    ...row,
    member_status: activeIds.has(row.user_id) ? 'active' : 'inactive',
  }));
};

export const fetchAdminDocumentVerificationCount = async () => {
  const response = await routeRead('ADMIN_GET_DOCUMENT_VERIFICATION_COUNT');
  if (!response?.success) throw await notAnswered('ADMIN_GET_DOCUMENT_VERIFICATION_COUNT');
  return Math.max(0, Number(response.count) || 0);
};

export const fetchReports = async () => {
  const response = await routeRead('GET_REPORTS');
  if (!response?.success) throw await notAnswered('GET_REPORTS');
  return Array.isArray(response.reports) ? response.reports : [];
};

export const fetchReportConfigurations = async () => {
  const response = await routeRead('GET_REPORT_CONFIGS');
  if (!response?.success) throw await notAnswered('GET_REPORT_CONFIGS');
  return Array.isArray(response.reports) ? response.reports : [];
};

export const runConfiguredReport = async (request) => {
  const response = await routeRead('RUN_REPORT', request || {});
  if (!response?.success) throw await notAnswered('RUN_REPORT');
  return response;
};

export const saveReportConfiguration = (report) => routeWrite('SAVE_REPORT_CONFIG', report || {});
export const deleteReportConfiguration = (reportId) =>
  routeWrite('DELETE_REPORT_CONFIG', { reportId: String(reportId || '') });

// Form definitions: the ones this caller may generate (audience-filtered), and - for the config tab - every one of them.
export const fetchFormTemplates = async () => {
  const response = await routeRead('GET_FORM_TEMPLATES');
  if (!response?.success) throw await notAnswered('GET_FORM_TEMPLATES');
  return Array.isArray(response.forms) ? response.forms : [];
};

export const fetchAdminFormTemplates = async () => {
  const response = await routeRead('ADMIN_GET_FORM_TEMPLATES');
  if (!response?.success) throw await notAnswered('ADMIN_GET_FORM_TEMPLATES');
  return Array.isArray(response.forms) ? response.forms : [];
};

export const saveFormTemplate = (request) => routeWrite('SAVE_FORM_TEMPLATE', request || {});
export const deleteFormTemplate = (formId) => routeWrite('DELETE_FORM_TEMPLATE', { id: String(formId || '') });

// One member's training - the catalogue and their signatures - which is what a training-based form is filled from.
export const fetchMemberTraining = async (userId) => {
  const response = await routeRead('GET_MEMBER_TRAINING', { userId: String(userId || '') });
  if (!response?.success) throw await notAnswered('GET_MEMBER_TRAINING');
  return {
    trainings: Array.isArray(response.trainings) ? response.trainings : [],
    signatures: Array.isArray(response.signatures) ? response.signatures : [],
  };
};

export const fetchAdminSections = async (names) => {
  const wanted = (Array.isArray(names) ? names : [names]).filter(Boolean);
  const needsCertifications = wanted.includes('certificationRecords');
  const otherSections = wanted.filter((name) => name !== 'certificationRecords');
  const [sections, certificationRecords] = await Promise.all([
    otherSections.length ? readAdminSections(otherSections) : {},
    needsCertifications ? fetchAdminCertificationRecords() : null,
  ]);
  return needsCertifications ? { ...sections, certificationRecords } : sections;
};

export const loginUser = async (username, password) => {
  // FIREBASE, AND ONLY FIREBASE.
  //
  // The sheet used to answer when Auth refused, because a member's Auth account carried the migration's temporary
  // password while their old password was still in the sheet - so a refusal had to be allowed to fall through. There
  // is no sheet to ask now, and the case for the fallback went with the thing that made it temporary: a wrong password
  // is a wrong password.
  //
  // The token this returns is the FIREBASE ID token, from signInAsMember. It is not what Firestore is authenticated
  // with - that is the Firebase session itself - but the app uses a token as the identity of the session it is holding
  // (see applyToken in App.jsx), so it has to be a real one rather than an empty string.
  if (!firebaseConfigured()) {
    const error = new Error('This build has no Firebase configuration, so nobody can sign in.');
    error.code = 'NO_FIREBASE_CONFIG';
    throw error;
  }

  return signInAsMember(username, password);
};

// The member's own clock history, over an optional window. The History screen asks for a range (and can ask for an older
// one), because this table grows without limit - see the note on the reader in firestoreReads.js.
export const fetchTimeclockLogs = async (token, { from = '', to = '' } = {}) =>
  dispatchRequest({ action: 'GET_TIMECLOCK_LOGS', token, from, to });

export const fetchOnDutyUsers = async (token) =>
  dispatchRequest({ action: 'GET_ON_DUTY', token });

// A WINDOW of the schedule, for a screen that navigated outside the one the sign-in carried. Both ends are 'YYYY-MM-DD'
// keys, and the reader answers with the rows inside them plus the window it applied - so the caller can keep track of what
// it holds rather than assuming this delivered everything.
export const fetchScheduleWindow = async (from, to, token) =>
  dispatchRequest({ action: 'GET_SCHEDULE', token, from, to });

// THE CREW DIRECTORY, for a screen that lists people - the calendar's pill names, the availability roster, the Users tab. Read
// when such a screen opens rather than at sign-in: see firestorePayload#readStationRows and App#loadRoster.
export const fetchRoster = async (token) => dispatchRequest({ action: 'GET_ROSTER', token });

// ONE PAGE of the roster. The search and the cursor belong to the SCREEN and travel as top-level keys on the request the
// reader receives (the shape the clock history's range uses); the page SIZE is deliberately not sent, so the default lives
// in exactly one place - functions/rosterPage.js, where the harness can ask it.
export const fetchRosterModule = async (token, { search = '', cursor = '' } = {}) =>
  dispatchRequest({ action: 'GET_ROSTER_MODULE', token, search, cursor });

// --- Certification badges ---------------------------------------------------------------------------------------

// The badge index for NAMED members only. The roster read carries the whole index for the screens that draw many names;
// this is the same data for the screens that draw a few - the dashboard's on-duty card and the sidebar's own badges - so
// neither of them pays a read per member at the station to put an icon beside two names.
export const fetchCertificationBadges = async (userIds, token) =>
  dispatchRequest({ action: 'GET_CERTIFICATION_BADGES', token, user_ids: Array.isArray(userIds) ? userIds : [] });

// THE AVAILABILITY OPTIONS LIST, for the member's own grid - read when that screen is opened, not at sign-in: see
// GET_AVAILABILITY_WINDOWS and firestorePayload#readStationRows.
export const fetchAvailabilityWindows = async (token) =>
  dispatchRequest({ action: 'GET_AVAILABILITY_WINDOWS', token });

export const submitClockAction = async (action, userId, coords = {}, token) => {
  const request = {
    action, // 'CLOCK_IN' or 'CLOCK_OUT'
    user_id: userId,
    gps_lat: coords.latitude || '',
    gps_lon: coords.longitude || '',
    is_manual: false,
    token,
  };
  // The station boundary is checked in the browser before this is ever called (utils/clockLocation.js), which is
  // why the Firestore path never answers OUT_OF_RANGE_CODE: it cannot be reached from a routed clock action.
  //
  // NOTHING ENFORCES IT SERVER-SIDE, and that is a decision rather than something the migration dropped on the floor.
  // The sheet backend had a second half of this check; it is retired and nothing runs it, so the browser's answer is the only
  // one. What is being accepted is a member lying about their own location on their own timesheet - the note on
  // `clock` in firestoreRouting.js records the same decision and what is NOT lost by it.
  return (await routeWrite(action, request)) || dispatchRequest(request);
};

// Push devices. Registration is per DEVICE: a member's
// phone and computer each hold their own row, so enabling one never disturbs the other.
//
// A device belongs to ONE member, so registering a token that is already somebody else's is refused
// and the refusal names them. `options.transfer` is the one way to insist - it is set by the settings
// card's "use this computer for me" button, and by nothing else.
export const registerPushDevice = async (deviceToken, deviceLabel, token, options) =>
  dispatchRequest({
    action: 'REGISTER_PUSH_DEVICE',
    token, // the session
    // The device token travels as `device_token`, because `token` is the session in the envelope.
    device_token: String(deviceToken || ''),
    device_label: String(deviceLabel || ''),
    transfer: options?.transfer === true,
  });

export const unregisterPushDevice = async (deviceToken, token) =>
  dispatchRequest({ action: 'UNREGISTER_PUSH_DEVICE', token, device_token: String(deviceToken || '') });

// The member's own devices, plus whose device this browser is when its token is passed in. The second
// half has to come from the server: the local subscription only says a device is enabled, never whose
// alerts it is set up to receive - and assuming it was the signed-in member's is what let a shared
// computer be taken over by simply signing in on it.
export const fetchMyPushDevices = async (token, deviceToken) =>
  dispatchRequest({
    action: 'MY_PUSH_DEVICES',
    token,
    device_token: String(deviceToken || ''),
  });

// --- Certifications ---

// The member's own records, the catalog they are named and iconed from, and whichever are expiring. The
// bootstrap carries all three at sign-in; this is for a re-read without signing in again.
export const fetchCertifications = async (token) => dispatchRequest({ action: 'GET_CERTIFICATIONS', token });

// The catalog: what the station tracks, how each one is shown, and what should happen when it runs out.
export const adminSaveCertificationSetup = async (certification, token) =>
  dispatchRequest({
    action: 'ADMIN_SAVE_CERTIFICATION_SETUP',
    token,
    id: String(certification.id || ''),
    name: String(certification.name || ''),
    icon: String(certification.icon || ''),
    description: String(certification.description || ''),
    // `undefined` is dropped by the fetch layer, so a field the caller did not touch is left alone; an empty
    // string is the deliberate "do not warn about this one".
    sort_order: certification.sort_order === undefined ? undefined : String(certification.sort_order),
    warn_days_before:
      certification.warn_days_before === undefined ? undefined : String(certification.warn_days_before),
    is_renewable: certification.is_renewable === true,
    show_next_to_name: certification.show_next_to_name === true,
    show_on_roster: certification.show_on_roster === true,
  });

export const adminDeleteCertificationSetup = async (id, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_CERTIFICATION_SETUP', token, id: String(id || '') });

// One member's record of one certification, for one period. Renewing saves a NEW row rather than editing the
// last, which is what keeps the history.
export const adminSaveCertification = async (certification, token) =>
  dispatchRequest({
    action: 'ADMIN_SAVE_CERTIFICATION',
    token,
    id: String(certification.id || ''),
    user_id: String(certification.user_id || ''),
    certification_id: String(certification.certification_id || ''),
    effective_date: String(certification.effective_date || ''),
    // Ignored by the server when the type is not renewable, which is the rule rather than this call's promise.
    end_date: String(certification.end_date || ''),
    notes: String(certification.notes || ''),
  });

export const adminDeleteCertification = async (id, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_CERTIFICATION', token, id: String(id || '') });

// The certification report's batch save. Three kinds of work, in one request:
//
//   * RECORDS - the same certification and dates recorded for several members at once, which is how a course that a
//     group sat together gets onto the books. One row per member, exactly as the single save writes it.
//   * UPDATES - a change applied to several EXISTING rows at once, given by id. Only the fields the officer actually
//     ticked are sent, and the writer merges them, so a bulk edit cannot blank a column nobody looked at.
//   * DELETES - ids, for the same reason.
//
// The reply carries the rebuilt badge index, as a single save's does: a batch can change every member's icons.
export const adminBulkSaveCertification = async ({ records = [], updates = [], deleteIds = [] }, token) =>
  dispatchRequest({
    action: 'ADMIN_BULK_SAVE_CERTIFICATION',
    token,
    payload: {
      records: records.map((row) => ({
        id: String(row.id || ''),
        user_id: String(row.user_id || ''),
        certification_id: String(row.certification_id || ''),
        effective_date: String(row.effective_date || ''),
        end_date: String(row.end_date || ''),
        notes: String(row.notes || ''),
      })),
      updates: updates.map((change) => {
        const out = { id: String(change.id || '') };
        // `undefined` is the officer NOT touching this field on any selected row, and it is left out of the request
        // rather than sent as an empty string: the writer merges, so absent means untouched and "" means cleared.
        if (change.effective_date !== undefined) out.effective_date = String(change.effective_date);
        if (change.end_date !== undefined) out.end_date = String(change.end_date);
        if (change.notes !== undefined) out.notes = String(change.notes);
        return out;
      }),
      deleteIds: deleteIds.map((id) => String(id)),
    },
  });

// The member's own settings row: time format, theme, and which notifications they want.
//
// NO `fcm_token`. That field existed because the sheet kept the device token in this row as well as in `push_devices`,
// and the Firestore model dropped it deliberately: the rules keep device tokens out of this document, and a copy here
// would be one nothing reads and nothing clears. A device is registered by REGISTER_PUSH_DEVICE.
//
// The notification preferences travel INCLUDING their absences, which is the part that matters: a field the form did not
// send must not arrive as `false`, because "not stated" means "inherit the station default" - and writing false is how a
// member ends up silently unsubscribed by a form that never asked about it.
// The member's FEMA student id - their own, or, for a user administrator, anybody's (the rules decide which).
//
// Its OWN call rather than riding along with UPDATE_USER_SETTINGS, because it lives on the PRIVATE half of an account
// rather than with the preferences: that is what lets the rules keep every other key of that document callable-only.
// The member's own details - their email, their phone, their FEMA student id - or, for a user administrator, anybody's,
// the member id included. WHICH IS DECIDED BY THE RULES, which refuse the member id to the member on their own row.
//
// Its OWN call rather than riding along with UPDATE_USER_SETTINGS, because these live on the PRIVATE half of an account
// rather than with the preferences: that is what lets the rules keep every other key of that document callable-only.
export const saveMemberPrivateFields = ({ userId = '', fields = {} } = {}) =>
  routeWrite('SAVE_MEMBER_PRIVATE', { userId: String(userId || ''), fields: fields || {} });

export const saveUserSettings = async (updatedSettings, token) =>
  dispatchRequest({
    action: 'UPDATE_USER_SETTINGS',
    token,
    payload: {
      id: String(updatedSettings.id),
      time_format: updatedSettings.time_format === undefined ? undefined : String(updatedSettings.time_format),
      is_dark_mode: updatedSettings.is_dark_mode === undefined ? undefined : String(updatedSettings.is_dark_mode),
      hide_events_by_default:
        updatedSettings.hide_events_by_default === undefined ? undefined : String(updatedSettings.hide_events_by_default),
      colorblind_rank_labels:
        updatedSettings.colorblind_rank_labels === undefined ? undefined : String(updatedSettings.colorblind_rank_labels),
      font_scale: updatedSettings.font_scale === undefined ? undefined : String(updatedSettings.font_scale),
      ...notificationPrefFields(updatedSettings),
    },
  });

// The member's own password change, and it must not fork: two systems would drift and the member would have one
// password here and another in Firebase. It goes to the `changeOwnPassword` callable, which is the only thing that CAN
// set a Firebase password - and, as the comment in functions/index.js says, the callable is also what clears the
// change-on-next-login flag, because only a function may write that claim.
//
// The sheet branch that used to answer when Firebase was unconfigured is gone with the sheet, so there is no second
// path: a build without Firebase cannot change a password at all, which is the truth rather than a quieter fallback.
// Takes an OBJECT rather than a positional password, deliberately. The caller used to pass `(userId, newPassword,
// token)` - the sheet's shape - and when this became a one-argument function that call would still have compiled, with
// the password argument ignored and the user id used AS the password. A named property cannot be mis-ordered, and a
// positional string passed here reaches the callable as `undefined`, which fails loudly instead of quietly.
export const updateUserPassword = async ({ newPassword }) => {
  try {
    await changeOwnPassword(newPassword);
    return { success: true };
  } catch (error) {
    return { success: false, message: error?.message || 'The password could not be changed.' };
  }
};
// --- Admin: Users ---

// The officer's user editor, translated. The sheet's ONE save is five operations in this model: the roster fields and
// the two per-member preferences on the `users` document (the rule names exactly those four keys and refuses anything
// else), then the status, the password and the account facts through the callables that already existed for them.
//
// EVERY FIELD THE FORM CARRIES IS SAVED, which is worth stating because it has not always been true. This file used to
// report `exclude_from_scheduling` and `is_change_password_on_login` as fields with nowhere to go, and the Users tab
// carries the scar: a checkbox that quietly did nothing because the payload never carried it. Both are written now -
// the scheduling preference on the roster document, which the rule was extended for, and the password-change flag
// through `updateMemberAccount`, which is also what moves a username.
//
// `token` is still passed by the caller and no longer needed: the session is Firebase's own. Left out of the signature
// rather than accepted and ignored.
export const adminSaveUser = async (userData) => {
  if (firebaseConfigured() && firebaseAuth().currentUser) {
    try {
      if (!userData.id) {
        const created = await createMember({
          username: userData.user_name,
          password: userData.password || '',
          name: userData.name,
          rank_id: userData.rank_id,
          role_id: userData.role_id,
        });
        return { success: true, id: created?.id || created?.userId || '' };
      }

      // The three fields the rules allow, in one write - plus the scheduling preference, which the rules allow there
      // too and which the tab has a checkbox for.
      //
      // NO MERGE, and that is the bug this save came with: the rules evaluate `request.resource.data` as the document
      // AFTER the write, and their allowlist (`hasOnly`) is checked against THAT. The migration left the sheet's `id`
      // column inside every stored users document, so a merge re-produced a six-field document and the rule refused
      // the save - "missing or insufficient access" - for every member whose row predated the app. A full replace
      // writes exactly the declared shape, passes the rule, and drops the debris field while it is at it.
      await setDoc(
        doc(firestore(), 'users', String(userData.id)),
        {
          name: String(userData.name || ''),
          rank_id: String(userData.rank_id || ''),
          role_id: String(userData.role_id || ''),
          exclude_from_scheduling: String(userData.exclude_from_scheduling || '').toUpperCase() === 'TRUE',
          // The runner's own sound profile: which tones their device plays. It lived on the users row in the sheet, and
          // it belongs here rather than in `user_settings` because it is a fact about the member's PLACE in the station
          // - the leaderboard draws it - rather than a preference only their own screen reads.
          runner_sound_profile: String(userData.runner_sound_profile ?? ''),
        }
      );

      if (userData.status) await setMemberStatus({ userId: String(userData.id), status: String(userData.status) });
      if (userData.password) {
        await resetMemberPassword({ userId: String(userData.id), temporaryPassword: String(userData.password) });
      }

      // The private half: a username (which moves the Auth address with it) and the change-on-next-login flag. Sent
      // only when the form actually carries them, because either one is a real change rather than a restatement.
      const account = {};
      if (userData.user_name) account.username = String(userData.user_name);
      const changeFlag = String(userData.is_change_password_on_login || '').toUpperCase();
      if (changeFlag === 'TRUE') account.isChangePasswordOnLogin = true;
      if (changeFlag === 'FALSE') account.isChangePasswordOnLogin = false;
      if (Object.keys(account).length) await updateMemberAccount({ userId: String(userData.id), ...account });

      return { success: true, id: String(userData.id) };
    } catch (error) {
      return { success: false, id: String(userData.id || ''), message: error?.message || 'The member could not be saved.' };
    }
  }

  // THE SHEET BRANCH THAT USED TO BE HERE IS GONE.
  //
  // It could only be reached with Firebase unconfigured or nobody signed in - and by then it was a request to a backend
  // that no longer exists, so it was dead code that still looked like a fallback. Deleting it is also what takes
  // ADMIN_SAVE_USER off the routing harness's list of actions the app calls but nothing routes.
  //
  // What it wrote, for the record: the row's own fields, the row-version guard, the two per-member flags and the
  // runner's sound profile. All of that is handled above; the two flags that live in `users_private`, which no client
  // may write, are reported to the officer rather than dropped, and the caller surfaces that message.
  return {
    success: false,
    id: String(userData.id || ''),
    message: 'This build has no Firebase configuration, so nothing could be saved.',
  };
};

export const adminDeleteUser = async (userId, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_USER', token, id: userId });

// --- Admin: Roles ---

export const adminSaveRole = async (roleData, token) =>
  dispatchRequest({
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
  dispatchRequest({ action: 'ADMIN_DELETE_ROLE', token, id: roleId });

// --- Admin: Ranks ---

export const adminSaveRank = async (rankData, token) =>
  dispatchRequest({
    action: 'ADMIN_SAVE_RANK',
    token,
    id: rankData.id || '',
    row_version: rowVersionField(rankData),
    // The rank's whole document, from the one place that declares it (utils/ranks.js). THE ORDER USED TO BE LEFT OUT
    // OF THIS PAYLOAD ENTIRELY, which is why a rank could not save its order: the form collected it, the input was
    // bound and the officer's number was in the state this object is built from - and none of it was ever put into the
    // request, so there was nothing for Firestore to write and nothing for the save to fail on. It reported success.
    //
    // It is spread rather than listed because the failure was a LIST that fell out of date: every other column was
    // typed out by hand next to it, so adding one to the document and not to this line was a silent no-op. Now the
    // shape of a rank is stated once, and the harnesses can check it against the form's own declaration.
    ...rankFieldsFromForm(rankData),
  });

export const adminDeleteRank = async (rankId, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_RANK', token, id: rankId });

// --- Admin: Shifts ---

export const adminSaveShift = async (shiftData, token) =>
  dispatchRequest({
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
  dispatchRequest({ action: 'ADMIN_DELETE_SHIFT', token, id: shiftId });
// --- Admin: Schedule Templates ---

export const adminSaveScheduleTemplate = async (templateData, token) =>
  dispatchRequest({
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
  dispatchRequest({ action: 'ADMIN_DELETE_SCHEDULE_TEMPLATE', token, id: templateId });

// The Firefighter Runner sound prefix for a member. It is an administrator-managed attribute on
// the users sheet, so it is saved with the rest of the row by adminSaveUser above - the backend
// ignores the field unless the caller has is_admin.

// Training: the station's training record, and each member's signatures against it.
//
// GET_TRAINING returns the training list to any signed-in member, but the signatures are
// filtered server-side by role: a member receives only their own, and the full set travels
// only to someone who can administer trainings.
export const fetchTraining = async (token) =>
  dispatchRequest({ action: 'GET_TRAINING', token });

// Signs a batch of trainings in one request. Add-only on purpose - the backend refuses any
// removal, because a signature is an acknowledgment of attendance rather than a preference.
export const signTraining = async (trainingIds, token) =>
  dispatchRequest({
    action: 'SIGN_TRAINING',
    token,
    payload: { training_ids: trainingIds.map((id) => String(id)) },
  });

// Adding and editing training details, for a role with can_edit_trainings. No deletion - that
// is adminBulkSaveTraining's job, and the backend refuses a delete here.
export const saveTraining = async ({ trainings = [] }, token) =>
  dispatchRequest({
    action: 'SAVE_TRAINING',
    token,
    payload: { trainings },
  });

// The admin Training report: saves training definitions (blank id = new row) and deletes the
// ones named in deleteIds, in a single request.
export const adminBulkSaveTraining = async ({ trainings = [], deleteIds = [] }, token) =>
  dispatchRequest({
    action: 'ADMIN_BULK_SAVE_TRAINING',
    token,
    payload: {
      trainings,
      deleteIds: deleteIds.map((id) => String(id)),
    },
  });

// Removes one signature. The only path that can, and it needs can_administer_trainings.
export const adminRemoveTrainingSignature = async (signatureId, token) =>
  dispatchRequest({
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
  dispatchRequest({ action: 'MY_ANNOUNCEMENTS', token });

// The window is the administrator's own: an older window GROWS what the list holds, and the reader answers with the recent
// rows unioned with everything still in force (see ADMIN_GET_ANNOUNCEMENTS), so a notice with no end date never falls out
// of view however old it is.
export const adminFetchAnnouncements = async (token, { from = '' } = {}) =>
  dispatchRequest({ action: 'ADMIN_GET_ANNOUNCEMENTS', token, from });

export const adminSaveAnnouncement = async (announcementData, token) =>
  dispatchRequest({
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
    // No `is_visible_on_login`: the location is gone (utils/announcements#ANNOUNCEMENT_LOCATIONS), so sending it would keep a
    // column alive that nothing reads. A save therefore clears it on an older row, which is the intent.
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
  dispatchRequest({ action: 'ADMIN_DELETE_ANNOUNCEMENT', token, id });

// --- Documents -------------------------------------------------------------------
//
// Two read pairs, because the audiences differ: a member reads what is published and at or above
// their rank, an administrator reads everything including drafts. Both list reads are METADATA
// ONLY - the body is fetched one document at a time - which is what keeps opening the module
// cheap however large the library gets.

export const fetchDocuments = async (token) => dispatchRequest({ action: 'GET_DOCUMENTS', token });

export const fetchDocument = async (id, token) => dispatchRequest({ action: 'GET_DOCUMENT', token, id });

export const adminFetchDocuments = async (token) => dispatchRequest({ action: 'ADMIN_GET_DOCUMENTS', token });

export const adminFetchDocument = async (id, token) => dispatchRequest({ action: 'ADMIN_GET_DOCUMENT', token, id });

export const adminSaveDocument = async (documentData, token) =>
  dispatchRequest({
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
    // The second signature. Through `storedRequiresVerification` rather than taken as sent, because two combinations
    // the editor can offer cannot mean anything: a checklist's acknowledgment IS its items (each verified on its own),
    // and a document nobody signs has nothing to confirm. The rule lives in utils/documents so the form, this and any
    // future importer cannot each decide it differently.
    requires_verification: storedRequiresVerification(documentData),
  });

export const adminDeleteDocument = async (id, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_DOCUMENT', token, id });

// Renames a folder by rewriting the column on the documents that carry the name. A blank `to` moves the
// folder's documents back to unfiled, which is the only way to get rid of a folder - there is no folder
// row to delete, because a folder is a name here rather than a record.
export const adminRenameDocumentFolder = async (from, to, token) =>
  dispatchRequest({ action: 'ADMIN_RENAME_DOCUMENT_FOLDER', token, from, to: to || '' });

// Drag-and-drop ordering. The pairs are worked out by `reorderDocuments` / `reorderFolders` in
// utils/documents - the rule belongs on the side that can be tested - and the server only checks that the rows
// exist and writes `sort_order` on them. Nothing else about a document is touched, which is what keeps a drag
// from being a save: no `row_version` moves, so an open editor does not get told somebody else changed the
// document when all that happened is a row moving up.
export const adminReorderDocuments = async (order, token) =>
  dispatchRequest({ action: 'ADMIN_REORDER_DOCUMENTS', token, order });

// --- Document signatures -----------------------------------------------------------
//
// A signature is ADD-ONLY from the member's side: the backend refuses a removal outright rather than ignoring
// one, and removing a signature is an administrator's action. Note what is NOT sent by `signDocument`: the date,
// who signed it and who it was for. All three are stamped from the session on the server.

export const signDocument = async (id, token) => dispatchRequest({ action: 'SIGN_DOCUMENT', token, id });

// The signature report for one document: administrators who manage documents, and the officers who verify
// checklists. Named for what it returns rather than for who calls it - a verifier is not an administrator.
// Another member's records, for a verifier looking at them. The mirror of `fetchDocuments`: same shape, same
// rules, applied by the server to the NAMED member's rank rather than the caller's. Gated on
// can_verify_documents, which is the permission that means "I read other people's paperwork to confirm it".
export const fetchMemberDocumentRecords = async (userId, token) =>
  dispatchRequest({ action: 'GET_MEMBER_DOCUMENT_RECORDS', token, user_id: userId });

export const fetchDocumentSignatures = async (id, token) =>
  dispatchRequest({ action: 'GET_DOCUMENT_SIGNATURES', token, id });

// --- Assessment scores -------------------------------------------------------------------------------------------
//
// A MEMBER'S OWN SCORE IS NOT HERE, and that is deliberate: it arrives with `fetchDocument`, because the caller is never
// named in that request and so cannot ask it for anybody else. There is no `fetchMyAssessmentScore(userId)` on purpose -
// a function taking a member id and returning "their own" score is a function whose argument nobody should be able to set.
//
// These two are the officer's half. `fetchMemberAssessmentScore` is the lookup behind the member picker, and
// `setAssessmentScore` is the save. Both NAME the member, and both are refused by the rules for anybody without
// `can_add_assessment_scores` - the read because the row is not theirs, the write because only a scorer may create one.
export const fetchMemberAssessmentScore = async (documentId, userId, token) =>
  dispatchRequest({ action: 'GET_MEMBER_ASSESSMENT_SCORE', token, document_id: documentId, user_id: userId });

// `score` is sent as the string it is. No Number(), no parseFloat, no validation that turns it into something else -
// the field is a string in the database because that is what lets "Pass", "4:52" and "12/15" share one column.
export const setAssessmentScore = async (documentId, userId, score, scoredOn, token) =>
  dispatchRequest({
    action: 'SET_DOCUMENT_ASSESSMENT_SCORE',
    token,
    document_id: documentId,
    user_id: userId,
    score: String(score ?? ''),
    scored_on: scoredOn,
  });

export const adminRemoveDocumentSignature = async (signatureId, token) =>
  dispatchRequest({ action: 'ADMIN_REMOVE_DOCUMENT_SIGNATURE', token, id: signatureId });

// Recording a member's signatures from the paper file. One call for as many items as the officer ticked, because the
// whole point is that entering a paper archive should not be forty requests.
//
// The RECORDER is deliberately not a parameter: the backend takes it from the session, so a caller cannot attribute a
// row to somebody else. The member it is for IS a parameter - that is the feature - and the rules require the row to
// carry the `backfilled` flag that says the member did not tap it themselves.
export const adminBackfillDocumentSignatures = async (
  { documentId, userId, itemIds = [], recordedOn = '', note = '', confirmVerified = false },
  token
) =>
  dispatchRequest({
    action: 'BACKFILL_DOCUMENT_SIGNATURES',
    token,
    document_id: documentId,
    user_id: userId,
    item_ids: Array.isArray(itemIds) ? itemIds : [],
    recorded_on: recordedOn,
    note,
    confirm_verified: confirmVerified === true,
  });

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
  dispatchRequest({
    action: 'SIGN_CHECKLIST_ITEM',
    token,
    document_id: documentId,
    // A list, because ticking several boxes and saving once is how the screen is used. The backend skips an item
    // that is already signed or that belongs to another checklist, and counts it, rather than failing the batch.
    item_ids: Array.isArray(itemIds) ? itemIds : [],
  });

export const verifyChecklistItem = async (documentId, itemId, userId, token) =>
  dispatchRequest({
    action: 'VERIFY_CHECKLIST_ITEM',
    token,
    document_id: documentId,
    item_id: itemId,
    user_id: userId,
  });

export const verifyChecklistRemaining = async (documentId, userId, token) =>
  dispatchRequest({
    action: 'VERIFY_CHECKLIST_REMAINING',
    token,
    document_id: documentId,
    user_id: userId,
  });

// Confirming a DOCUMENT's own signature rather than an item of a checklist - the same permission, the same two people,
// and the same add-only rule. It exists as its own action rather than as "verify item, with no item" because the two
// are different statements: a checklist item is a line somebody ticked, and this is the document as a whole. The
// backend refuses it unless the member has signed and the document still asks for a second signature.
export const verifyDocumentSignature = async (documentId, userId, token) =>
  dispatchRequest({
    action: 'VERIFY_DOCUMENT_SIGNATURE',
    token,
    document_id: documentId,
    user_id: userId,
  });

export const adminSaveChecklistItem = async (item, token) => {
  const documentId = String(item.document_id || '').trim();
  if (!documentId) throw new Error('A checklist item needs a document.');
  const parent = await getDoc(doc(firestore(), 'documents', documentId));
  if (!parent.exists()) throw new Error('The checklist document is not available.');

  return dispatchRequest({
    action: 'ADMIN_SAVE_CHECKLIST_ITEM',
    token,
    // A blank id creates; an id edits IN PLACE, which is what keeps the signatures pointing at it.
    id: item.id || '',
    document_id: item.document_id || '',
    sort_order: item.sort_order ?? 0,
    section: item.section || '',
    label: item.label || '',
    audience_keys: Array.isArray(parent.get('audience_keys')) ? parent.get('audience_keys') : [],
  });
  };

export const adminDeleteChecklistItem = async (id, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_CHECKLIST_ITEM', token, id });

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

// THE SCHEDULE'S REFERENCE DATA - templates, assignments and the shift definitions - for a screen that draws a schedule or labels a
// clock entry. Read once per session, when such a screen opens: see firestorePayload#scheduleSetupFor and App#loadScheduleSetup.
export const fetchScheduleSetup = async (token) => dispatchRequest({ action: 'GET_SCHEDULE_SETUP', token });

// THE CALENDAR ENTRIES, for the screens that draw them - the member's own calendar, the availability grid and the officer's
// board. Read (and watched) when one of those is opened rather than at sign-in: a member who clocks in has no calendar on
// screen, and the listener for this collection follows the screen instead. See App.jsx's events effect.
export const fetchEvents = async (token) => dispatchRequest({ action: 'GET_EVENTS', token });

export const adminFetchEvents = async (token) => dispatchRequest({ action: 'ADMIN_GET_EVENTS', token });

export const adminSaveEvent = async (eventData, token) =>
  dispatchRequest({
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
  dispatchRequest({ action: 'ADMIN_DELETE_EVENT', token, id });

export const adminSaveAssignment = async (assignmentData, token) =>
  dispatchRequest({
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
  dispatchRequest({ action: 'ADMIN_DELETE_ASSIGNMENT', token, id: assignmentId });

// Bulk-saves schedule entries in one request: `entries` are upserted by id
// (blank id = new row) and `deleteIds` are removed. Used by the Schedule
// Management tab so all in-memory edits flush in a single Save.
//
// Built once and handed to whichever backend: `routeWrite` answers null while the feature is switched off, which
// is every build until the payload layer lands (see firestoreRouting.js).
export const adminBulkSaveSchedule = async ({ entries = [], deleteIds = [] }, token) => {
  const request = { action: 'ADMIN_BULK_SAVE_SCHEDULE', token, entries, deleteIds };
  return (await routeWrite('ADMIN_BULK_SAVE_SCHEDULE', request)) || dispatchRequest(request);
};

// --- Shift offers (member request -> admin approval) ---

// The signed-in member's own offers, each carrying a derived `status`
// ('pending' | 'approved' | 'declined') and the `slot_key` the calendar matches
// its open pills against.
export const fetchMyShiftOffers = async (token) =>
  dispatchRequest({ action: 'GET_SHIFT_OFFERS', token });

// Offers to fill an open shift. `schedule_id` links an offer made on an existing
// unassigned row; template occurrences leave it blank.
export const submitShiftOffer = async ({ schedule_template_id, date_from, date_to, assignment_id, schedule_id } = {}, token) => {
  const request = {
    action: 'SUBMIT_SHIFT_OFFER',
    token,
    schedule_template_id: schedule_template_id || '',
    date_from: date_from || '',
    date_to: date_to || '',
    assignment_id: assignment_id || '',
    schedule_id: schedule_id || '',
  };
  return (await routeWrite('SUBMIT_SHIFT_OFFER', request)) || dispatchRequest(request);
};

// Admin: every offer, so the Schedule Management calendar can flag the slots
// waiting on approval.
export const adminFetchScheduleOffers = async (token) =>
  dispatchRequest({ action: 'ADMIN_GET_SCHEDULE_OFFERS', token });

// Admin: approve (fills the shift) or decline a single offer, both through the same route - and both of them through a
// callable, because writing a schedule row or a status is an officer's decision rather than a client write.
//
// The decision travels in the button's own vocabulary ('APPROVE' / 'DECLINE'), which the sheet expected and what
// the router now accepts in either case. Other pending offers for the same shift are NOT closed out here; approving
// fills the shift, which is what stops them showing, and they stay in the pending list until an officer declines them.
export const adminResolveShiftOffer = async (offerId, decision, token) => {
  const request = { action: 'ADMIN_RESOLVE_SHIFT_OFFER', token, id: offerId, decision };
  return (await routeWrite('ADMIN_RESOLVE_SHIFT_OFFER', request)) || dispatchRequest(request);
};

// --- Availability windows ---
//
// Officer-maintained reference data for the Member Availability module: the recurring weekly patterns members choose
// from (utils/availability.js). Saved and deleted like any other plain document - the routing table names the
// collection, so there is nothing to compute on the way in and no private half to write.

export const adminFetchAvailabilityWindows = async (token) =>
  dispatchRequest({ action: 'ADMIN_GET_AVAILABILITY_WINDOWS', token });

export const adminSaveAvailabilityWindow = async (windowData, token) =>
  dispatchRequest({
    action: 'ADMIN_SAVE_AVAILABILITY_WINDOW',
    token,
    id: windowData.id || '',
    row_version: rowVersionField(windowData),
    nickname: windowData.nickname || '',
    start_time: windowData.start_time || '',
    end_time: windowData.end_time || '',
    is_monday: Boolean(windowData.is_monday),
    is_tuesday: Boolean(windowData.is_tuesday),
    is_wednesday: Boolean(windowData.is_wednesday),
    is_thursday: Boolean(windowData.is_thursday),
    is_friday: Boolean(windowData.is_friday),
    is_saturday: Boolean(windowData.is_saturday),
    is_sunday: Boolean(windowData.is_sunday),
    effective_date: windowData.effective_date || '',
    end_date: windowData.end_date || '',
  });

export const adminDeleteAvailabilityWindow = async (windowId, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_AVAILABILITY_WINDOW', token, id: windowId });

// --- Availability ---

export const fetchAvailability = async (token, { from = '', to = '' } = {}) =>
  dispatchRequest({ action: 'GET_AVAILABILITY', token, from, to });

// Every member's claims for a month, for the two officer screens that ask "who can cover this?" - the All Members
// roster and the board's availability warning. Bounded by the month, and the read that replaced the officer being
// handed their own rows.
export const adminFetchAvailability = async (token, { from = '', to = '' } = {}) =>
  dispatchRequest({ action: 'ADMIN_GET_AVAILABILITY', token, from, to });

// One availability slot in the shape the backend expects. `date_to` defaults to the start
// date: a template occurrence is a single day.
// One month of availability in the shape the backend writes: the month key and the marks it holds, as a map of window id
// -> the days claimed. There is no add/remove vocabulary any more, because the document IS the month
// (utils/availability.js): a day that was un-marked is simply not in the map.
export const setMyAvailability = async ({ month, claims = {} } = {}, token) => {
  const request = { action: 'SET_MY_AVAILABILITY', token, month: String(month || ''), claims };
  return (await routeWrite('SET_MY_AVAILABILITY', request)) || dispatchRequest(request);
};

// Admin: one member's month, through the same route.
export const adminSetAvailability = async (userId, { month, claims = {} } = {}, token) =>
  dispatchRequest({
    action: 'ADMIN_SET_AVAILABILITY',
    token,
    user_id: userId,
    month: String(month || ''),
    claims,
  });

// --- Admin: System Settings ---

export const adminSaveSystemSetting = async (key, value, token) =>
  dispatchRequest({ action: 'ADMIN_SAVE_SYSTEM_SETTING', token, key, value });

// Saves many settings in ONE request, all-or-nothing.
//
// The Loading Messages card used to call the single-key action once per message, so ten messages were ten
// requests - and a failure part-way left some saved and some not, which reads as the app lying about what it
// stored. The backend validates every pair before writing any of them.
export const adminSaveSystemSettings = async (settings, token) =>
  dispatchRequest({ action: 'ADMIN_SAVE_SYSTEM_SETTINGS', token, settings });

// True when the write we sent is not a route in this build - how a page newer than its build detects that
// it has to fail rather than guess. The sheet backend used to answer UNKNOWN_ACTION to the same effect.
export const isUnknownAction = (result) => !!result && result.code === 'UNKNOWN_ACTION';

export const adminDeleteSystemSetting = async (key, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_SYSTEM_SETTING', token, key });

// --- Admin: Push notifications ---

// Per-member push status: whether a device is registered and which
// notification types that member has switched on (blank = station default).
export const adminFetchPushStatus = async (token) =>
  dispatchRequest({ action: 'ADMIN_GET_PUSH_STATUS', token });

// Sends a one-off push to a single member so an admin can verify the FCM
// setup end to end. Returns { success, message, detail }.
export const adminSendTestPush = async (userId, token) =>
  dispatchRequest({ action: 'ADMIN_SEND_TEST_PUSH', token, user_id: userId });

// Turns a member's notifications off for every device they have, or lets them back in.
//
// `disabled: true` is the forceful direction: their devices are forgotten AND a flag is set, because the
// member's own browser re-registers any subscription it holds when User Settings is opened - without the
// flag this would quietly undo itself. Lifting it only clears the flag: each device has to be enabled
// again from the device itself, which is the only place its push subscription can be turned back on.
export const adminSetPushDisabled = async (userId, disabled, token) =>
  dispatchRequest({
    action: 'ADMIN_SET_PUSH_DISABLED',
    token,
    user_id: String(userId || ''),
    disabled: disabled === true,
  });

// Which FCM credentials are present, as booleans - the service-account private
// key is write-only and is never returned, not even to an authenticated admin.
export const adminFetchFcmStatus = async (token) =>
  dispatchRequest({ action: 'ADMIN_GET_FCM_STATUS', token });

// --- Admin: Clock Management ---

export const adminSaveTimeclockEntry = async (entryData, token) =>
  dispatchRequest({
    action: 'ADMIN_SAVE_TIMECLOCK_ENTRY',
    token,
    id: entryData.id || '',
    user_id: entryData.user_id,
    time_in: entryData.time_in,
    time_out: entryData.time_out || '',
  });

export const adminDeleteTimeclockEntry = async (entryId, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_TIMECLOCK_ENTRY', token, id: entryId });

// --- Firefighter Runner (easter egg) ---

// The station leaderboard: personal bests above zero, highest first.
export const fetchRunnerLeaderboard = async (token) =>
  dispatchRequest({ action: 'GET_RUNNER_LEADERBOARD', token });

// Records a finished run. The backend keeps the higher of the two scores, so this can be
// called after every game without risking a personal best.
export const saveRunnerScore = async (score, token) =>
  dispatchRequest({ action: 'SAVE_RUNNER_SCORE', token, score });