import { NOTIFICATION_TYPES } from '../utils/notificationPrefs';
import { EVENT_WEEKDAYS } from '../utils/events';
import { roleFieldsFromForm } from '../utils/permissions';
import { storedRequiresVerification } from '../utils/documents.js';
import { rankFieldsFromForm } from '../utils/ranks';
import { isReadAction } from '../utils/readCoalescing';
import { SESSION_ENDED_MESSAGE } from '../utils/sessionTimeout';
import { routeRead, routeWrite, routingBlocker, lastReadFailureFor } from './firestoreRouting.js';
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

// Gets the version number of a record to prevent accidental overwrites.
const rowVersionField = (record) => (record && record.row_version !== undefined ? record.row_version : undefined);

// Extracts notification preferences from a user's settings.
export const notificationPrefFields = (settings) => {
  const fields = {};
  NOTIFICATION_TYPES.forEach((type) => {
    fields[type.key] = settings[type.key] === undefined ? undefined : String(settings[type.key]);
  });
  return fields;
};

// Returns an error when the user is signed out.
const notSignedIn = () => {
  const ended = new Error(SESSION_ENDED_MESSAGE);
  ended.code = 'ROUTE_NOT_TAKEN';
  return ended;
};

// Handles errors when a requested action cannot be completed.
const notAnswered = async (action) => {
  const blocker = await routingBlocker(action);
  if (blocker === 'not-signed-in-to-firebase') return notSignedIn();
  const failed = blocker ? '' : lastReadFailureFor(action);
  const error = new Error(
    blocker
      ? `${action} was not routed (${blocker}), so nothing answered it.` +
        (blocker === 'feature-off'
          ? ' VITE_FIRESTORE_FEATURES pins a list of routes when it is set, and this route is not in it.'
          : '')
      : failed
        ? `${action} failed: ${failed}`
        : `Firestore did not answer ${action}. Check console for details.`
  );
  error.code = blocker ? 'ROUTE_NOT_TAKEN' : 'READ_FAILED';
  return error;
};

// Dispatches data requests to either read or write handlers.
function dispatchRequest(body) {
  const action = body?.action ?? '';

  if (isReadAction(action)) {
    return routeRead(action, body).then(async (routed) => {
      if (routed) return routed;
      throw await notAnswered(action);
    });
  }

  return routeWrite(action, body).then(async (routed) => {
    if (routed) return routed;
    throw await notAnswered(action);
  });
}

// Loads public station settings before login.
export const fetchInitialData = async () =>
  dispatchRequest({ action: 'GET_INITIAL_DATA' });

// Loads initial member data (schedule, roster, etc.) right after sign-in.
export const fetchBootstrap = async () => {
  const payload = await routeRead('GET_BOOTSTRAP');
  if (!payload) throw await notAnswered('GET_BOOTSTRAP');
  return payload;
};

// Loads administrative data for officer panels.
export const adminFetchBootstrap = async () => {
  const payload = await routeRead('ADMIN_GET_BOOTSTRAP');
  if (!payload) throw await notAnswered('ADMIN_GET_BOOTSTRAP');
  return payload;
};

// Loads member certification records and their active status.
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

// Counts how many documents/items need verification.
export const fetchAdminDocumentVerificationCount = async () => {
  const response = await routeRead('ADMIN_GET_DOCUMENT_VERIFICATION_COUNT');
  if (!response?.success) throw await notAnswered('ADMIN_GET_DOCUMENT_VERIFICATION_COUNT');
  return Math.max(0, Number(response.count) || 0);
};

// Summary of pending document verifications including total count and per-document breakdown.
export const fetchAdminDocumentVerificationSummary = async (verifiableDocs = null) => {
  const response = await routeRead('ADMIN_GET_DOCUMENT_VERIFICATION_COUNT', { verifiableDocs });
  if (!response?.success) throw await notAnswered('ADMIN_GET_DOCUMENT_VERIFICATION_COUNT');
  return {
    count: Math.max(0, Number(response.count) || 0),
    byDocument: response.byDocument && typeof response.byDocument === 'object' ? response.byDocument : {},
  };
};

// Fetches reports available to the current user.
export const fetchReports = async () => {
  const response = await routeRead('GET_REPORTS');
  if (!response?.success) throw await notAnswered('GET_REPORTS');
  return Array.isArray(response.reports) ? response.reports : [];
};

// Fetches saved report configurations.
export const fetchReportConfigurations = async () => {
  const response = await routeRead('GET_REPORT_CONFIGS');
  if (!response?.success) throw await notAnswered('GET_REPORT_CONFIGS');
  return Array.isArray(response.reports) ? response.reports : [];
};

// Generates data for a configured report.
export const runConfiguredReport = async (request) => {
  const response = await routeRead('RUN_REPORT', request || {});
  if (!response?.success) throw await notAnswered('RUN_REPORT');
  return response;
};

// Saves a report definition.
export const saveReportConfiguration = (report) => routeWrite('SAVE_REPORT_CONFIG', report || {});

// Deletes a report definition.
export const deleteReportConfiguration = (reportId) =>
  routeWrite('DELETE_REPORT_CONFIG', { reportId: String(reportId || '') });

// Fetches form templates available to the member.
export const fetchFormTemplates = async () => {
  const response = await routeRead('GET_FORM_TEMPLATES');
  if (!response?.success) throw await notAnswered('GET_FORM_TEMPLATES');
  return Array.isArray(response.forms) ? response.forms : [];
};

// Fetches all form templates for admin management.
export const fetchAdminFormTemplates = async () => {
  const response = await routeRead('ADMIN_GET_FORM_TEMPLATES');
  if (!response?.success) throw await notAnswered('ADMIN_GET_FORM_TEMPLATES');
  return Array.isArray(response.forms) ? response.forms : [];
};

// Saves a form template.
export const saveFormTemplate = (request) => routeWrite('SAVE_FORM_TEMPLATE', request || {});

// Deletes a form template.
export const deleteFormTemplate = (formId) => routeWrite('DELETE_FORM_TEMPLATE', { id: String(formId || '') });

// Submits an entered form response.
export const submitFormResponse = (request) => routeWrite('SUBMIT_FORM_RESPONSE', request || {});

// Fetches all form submissions for administrators.
export const fetchFormSubmissions = async () => {
  const response = await routeRead('GET_FORM_SUBMISSIONS');
  if (!response?.success) throw await notAnswered('GET_FORM_SUBMISSIONS');
  return Array.isArray(response.submissions) ? response.submissions : [];
};

// Deletes a form submission.
export const deleteFormSubmission = (submissionId) =>
  routeWrite('DELETE_FORM_SUBMISSION', { id: String(submissionId || '') });

// Fetches the custom SVG drawing of the district boundary.
export const fetchMapLayer = () => dispatchRequest({ action: 'GET_MAP_LAYER' });

// Saves the custom SVG map drawing.
export const adminSaveMapLayer = (svg, token) =>
  routeWrite('ADMIN_SAVE_MAP_LAYER', { svg: String(svg || ''), token });

// Removes the custom SVG map drawing.
export const adminDeleteMapLayer = (token) => routeWrite('ADMIN_DELETE_MAP_LAYER', { token });

// Fetches the geographic district boundary polygon.
export const fetchMapBoundary = () => dispatchRequest({ action: 'GET_MAP_BOUNDARY' });

// Fetches landmark pins placed on the map.
export const fetchMapLandmarks = () => dispatchRequest({ action: 'GET_MAP_LANDMARKS' });

// Saves the geographic district boundary.
export const adminSaveMapBoundary = ({ geojson, meta } = {}, token) =>
  routeWrite('ADMIN_SAVE_MAP_BOUNDARY', { request: { geojson, meta }, token });

// Deletes the geographic district boundary.
export const adminDeleteMapBoundary = (token) => routeWrite('ADMIN_DELETE_MAP_BOUNDARY', { token });

// Saves a single landmark pin on the map.
export const adminSaveMapLandmark = ({ id = '', fields = {} } = {}, token) =>
  routeWrite('ADMIN_SAVE_MAP_LANDMARK', { request: { id, fields }, token });

// Deletes a landmark pin from the map.
export const adminDeleteMapLandmark = (id, token) =>
  routeWrite('ADMIN_DELETE_MAP_LANDMARK', { id: String(id || ''), token });

// Fetches Pre-Incident Plans for the map and documents module.
export const fetchPreIncidentPlans = () => dispatchRequest({ action: 'GET_PRE_INCIDENT_PLANS' });

// Saves a Pre-Incident Plan document.
export const adminSavePreIncidentPlan = ({ id = '', fields = {} } = {}, token) =>
  routeWrite('ADMIN_SAVE_PRE_INCIDENT_PLAN', { request: { id, fields }, token });

// Deletes a Pre-Incident Plan document.
export const adminDeletePreIncidentPlan = (id, token) =>
  routeWrite('ADMIN_DELETE_PRE_INCIDENT_PLAN', { id: String(id || ''), token });

// Fetches the district hydrants directory.
export const fetchHydrants = () => dispatchRequest({ action: 'GET_HYDRANTS' });

// Saves or updates a Hydrant document.
export const adminSaveHydrant = ({ id = '', fields = {} } = {}, token) =>
  routeWrite('ADMIN_SAVE_HYDRANT', { request: { id, fields }, token });

// Deletes a Hydrant document.
export const adminDeleteHydrant = (id, token) =>
  routeWrite('ADMIN_DELETE_HYDRANT', { id: String(id || ''), token });

// Fetches background road and waterway map layers.
export const fetchMapBackdrops = () => dispatchRequest({ action: 'GET_MAP_BACKDROPS' });

// Saves a background map layer.
export const adminSaveMapBackdrop = ({ layer, geojson, meta } = {}, token) =>
  routeWrite('ADMIN_SAVE_MAP_BACKDROP', { request: { layer, geojson, meta }, token });

// Deletes a background map layer.
export const adminDeleteMapBackdrop = (layer, token) =>
  routeWrite('ADMIN_DELETE_MAP_BACKDROP', { layer: String(layer || ''), token });

// Fetches landmark pin categories (names, icons, colors).
export const fetchMapTypes = () => dispatchRequest({ action: 'GET_MAP_TYPES' });

// Saves custom landmark pin categories.
export const adminSaveMapTypes = ({ types } = {}, token) =>
  routeWrite('ADMIN_SAVE_MAP_TYPES', { request: { types }, token });

// Fetches training sessions and signatures for one member.
export const fetchMemberTraining = async (userId) => {
  const response = await routeRead('GET_MEMBER_TRAINING', { userId: String(userId || '') });
  if (!response?.success) throw await notAnswered('GET_MEMBER_TRAINING');
  return {
    trainings: Array.isArray(response.trainings) ? response.trainings : [],
    signatures: Array.isArray(response.signatures) ? response.signatures : [],
  };
};

// Reads specific admin collections on demand.
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

// Signs a user in using Firebase Authentication.
export const loginUser = async (username, password) => {
  if (!firebaseConfigured()) {
    const error = new Error('This build has no Firebase configuration, so nobody can sign in.');
    error.code = 'NO_FIREBASE_CONFIG';
    throw error;
  }

  return signInAsMember(username, password);
};

// Fetches timeclock logs for the member within a date range.
export const fetchTimeclockLogs = async (token, { from = '', to = '' } = {}) =>
  dispatchRequest({ action: 'GET_TIMECLOCK_LOGS', token, from, to });

// Fetches the list of members currently clocked in.
export const fetchOnDutyUsers = async (token) =>
  dispatchRequest({ action: 'GET_ON_DUTY', token });

// Fetches shifts for a specific date window.
export const fetchScheduleWindow = async (from, to, token) =>
  dispatchRequest({ action: 'GET_SCHEDULE', token, from, to });

// Fetches the full station roster directory.
export const fetchRoster = async (token) => dispatchRequest({ action: 'GET_ROSTER', token });

// Fetches a paginated slice of the roster directory.
export const fetchRosterModule = async (token, { search = '', cursor = '' } = {}) =>
  dispatchRequest({ action: 'GET_ROSTER_MODULE', token, search, cursor });

// Fetches certification badges for specific members.
export const fetchCertificationBadges = async (userIds, token) =>
  dispatchRequest({ action: 'GET_CERTIFICATION_BADGES', token, user_ids: Array.isArray(userIds) ? userIds : [] });

// Fetches the list of availability windows members can select from.
export const fetchAvailabilityWindows = async (token) =>
  dispatchRequest({ action: 'GET_AVAILABILITY_WINDOWS', token });

// Submits a clock-in or clock-out action with GPS coordinates.
export const submitClockAction = async (action, userId, coords = {}, token) => {
  const request = {
    action, // 'CLOCK_IN' or 'CLOCK_OUT'
    user_id: userId,
    gps_lat: coords.latitude || '',
    gps_lon: coords.longitude || '',
    is_manual: false,
    token,
  };
  return (await routeWrite(action, request)) || dispatchRequest(request);
};

// Registers a web push device token for notifications.
export const registerPushDevice = async (deviceToken, deviceLabel, token, options) =>
  dispatchRequest({
    action: 'REGISTER_PUSH_DEVICE',
    token,
    device_token: String(deviceToken || ''),
    device_label: String(deviceLabel || ''),
    transfer: options?.transfer === true,
  });

// Unregisters a push device.
export const unregisterPushDevice = async (deviceToken, token) =>
  dispatchRequest({ action: 'UNREGISTER_PUSH_DEVICE', token, device_token: String(deviceToken || '') });

// Fetches push notification devices belonging to the member.
export const fetchMyPushDevices = async (token, deviceToken) =>
  dispatchRequest({
    action: 'MY_PUSH_DEVICES',
    token,
    device_token: String(deviceToken || ''),
  });

// Fetches all certifications earned by the current member.
export const fetchCertifications = async (token) => dispatchRequest({ action: 'GET_CERTIFICATIONS', token });

// Fetches document scans attached to the member's certifications.
export const fetchMyCertificationFiles = async (token) =>
  dispatchRequest({ action: 'GET_MY_CERTIFICATION_FILES', token });

// Fetches scans attached to a specific certification record for an officer.
export const fetchCertificationFiles = async (recordId, token) =>
  dispatchRequest({ action: 'ADMIN_GET_CERTIFICATION_FILES', token, recordId });

// Links an uploaded scan file to a certification record.
export const adminSaveCertificationFile = async ({ recordId, fileId, name }, token) =>
  dispatchRequest({ action: 'ADMIN_SAVE_CERTIFICATION_FILE', token, recordId, fileId, name });

// Removes a scan file from a certification record.
export const adminDeleteCertificationFile = async (fileId, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_CERTIFICATION_FILE', token, fileId });

// Saves a certification definition (name, badge icon, renewal rules).
export const adminSaveCertificationSetup = async (certification, token) =>
  dispatchRequest({
    action: 'ADMIN_SAVE_CERTIFICATION_SETUP',
    token,
    id: String(certification.id || ''),
    name: String(certification.name || ''),
    icon: String(certification.icon || ''),
    description: String(certification.description || ''),
    sort_order: certification.sort_order === undefined ? undefined : String(certification.sort_order),
    warn_days_before:
      certification.warn_days_before === undefined ? undefined : String(certification.warn_days_before),
    is_renewable: certification.is_renewable === true,
    show_next_to_name: certification.show_next_to_name === true,
    show_on_roster: certification.show_on_roster === true,
  });

// Deletes a certification definition.
export const adminDeleteCertificationSetup = async (id, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_CERTIFICATION_SETUP', token, id: String(id || '') });

// Records that a member earned a certification.
export const adminSaveCertification = async (certification, token) =>
  dispatchRequest({
    action: 'ADMIN_SAVE_CERTIFICATION',
    token,
    id: String(certification.id || ''),
    user_id: String(certification.user_id || ''),
    certification_id: String(certification.certification_id || ''),
    effective_date: String(certification.effective_date || ''),
    end_date: String(certification.end_date || ''),
    notes: String(certification.notes || ''),
  });

// Deletes a member's certification record.
export const adminDeleteCertification = async (id, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_CERTIFICATION', token, id: String(id || '') });

// Saves, updates, or deletes certification records in bulk.
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
        if (change.effective_date !== undefined) out.effective_date = String(change.effective_date);
        if (change.end_date !== undefined) out.end_date = String(change.end_date);
        if (change.notes !== undefined) out.notes = String(change.notes);
        return out;
      }),
      deleteIds: deleteIds.map((id) => String(id)),
    },
  });

// Saves private member account details like phone or FEMA student ID.
export const saveMemberPrivateFields = ({ userId = '', fields = {} } = {}) =>
  routeWrite('SAVE_MEMBER_PRIVATE', { userId: String(userId || ''), fields: fields || {} });

// Saves the user's profile avatar picture URL.
export const saveMemberAvatarUrl = ({ url = '' } = {}) => routeWrite('SAVE_MEMBER_AVATAR', { url: String(url || '') });

// Saves personal user preferences (theme, notification toggles, time format).
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
      dashboard_layout:
        updatedSettings.dashboard_layout === undefined ? undefined : String(updatedSettings.dashboard_layout),
      ...notificationPrefFields(updatedSettings),
    },
  });

// Changes the signed-in user's password.
export const updateUserPassword = async ({ newPassword }) => {
  try {
    await changeOwnPassword(newPassword);
    return { success: true };
  } catch (error) {
    return { success: false, message: error?.message || 'The password could not be changed.' };
  }
};

// Creates or updates a member account in the system.
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

      await setDoc(
        doc(firestore(), 'users', String(userData.id)),
        {
          name: String(userData.name || ''),
          rank_id: String(userData.rank_id || ''),
          role_id: String(userData.role_id || ''),
          exclude_from_scheduling: String(userData.exclude_from_scheduling || '').toUpperCase() === 'TRUE',
          runner_sound_profile: String(userData.runner_sound_profile ?? ''),
        }
      );

      if (userData.status) await setMemberStatus({ userId: String(userData.id), status: String(userData.status) });
      if (userData.password) {
        await resetMemberPassword({ userId: String(userData.id), temporaryPassword: String(userData.password) });
      }

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

  return {
    success: false,
    id: String(userData.id || ''),
    message: 'This build has no Firebase configuration, so nothing could be saved.',
  };
};

// Deletes a member account.
export const adminDeleteUser = async (userId, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_USER', token, id: userId });

// Saves a role and its permission flags.
export const adminSaveRole = async (roleData, token) =>
  dispatchRequest({
    action: 'ADMIN_SAVE_ROLE',
    token,
    id: roleData.id || '',
    row_version: rowVersionField(roleData),
    description: roleData.description,
    ...roleFieldsFromForm(roleData),
  });

// Deletes a role.
export const adminDeleteRole = async (roleId, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_ROLE', token, id: roleId });

// Saves a firefighter rank and its hierarchy order.
export const adminSaveRank = async (rankData, token) =>
  dispatchRequest({
    action: 'ADMIN_SAVE_RANK',
    token,
    id: rankData.id || '',
    row_version: rowVersionField(rankData),
    ...rankFieldsFromForm(rankData),
  });

// Deletes a rank.
export const adminDeleteRank = async (rankId, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_RANK', token, id: rankId });

// Saves a shift definition (start/end times and weekdays).
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

// Deletes a shift definition.
export const adminDeleteShift = async (shiftId, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_SHIFT', token, id: shiftId });

// Saves a recurring schedule template.
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
    nickname: templateData.nickname || '',
    effective_date: templateData.effective_date || '',
    end_date: templateData.end_date || '',
    apparatus_id: templateData.apparatus_id || '',
  });

// Deletes a schedule template.
export const adminDeleteScheduleTemplate = async (templateId, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_SCHEDULE_TEMPLATE', token, id: templateId });

// Fetches the station training catalogue and member signatures.
export const fetchTraining = async (token) =>
  dispatchRequest({ action: 'GET_TRAINING', token });

// Signs attendance for training sessions.
export const signTraining = async (trainingIds, token) =>
  dispatchRequest({
    action: 'SIGN_TRAINING',
    token,
    payload: { training_ids: trainingIds.map((id) => String(id)) },
  });

// Adds or edits training session details.
export const saveTraining = async ({ trainings = [] }, token) =>
  dispatchRequest({
    action: 'SAVE_TRAINING',
    token,
    payload: { trainings },
  });

// Saves and deletes training sessions in bulk.
export const adminBulkSaveTraining = async ({ trainings = [], deleteIds = [] }, token) =>
  dispatchRequest({
    action: 'ADMIN_BULK_SAVE_TRAINING',
    token,
    payload: {
      trainings,
      deleteIds: deleteIds.map((id) => String(id)),
    },
  });

// Removes a member's signature from a training record.
export const adminRemoveTrainingSignature = async (signatureId, token) =>
  dispatchRequest({
    action: 'ADMIN_REMOVE_TRAINING_SIGNATURE',
    token,
    signature_id: String(signatureId),
  });

// Fetches announcements targeted to the current member.
export const fetchMyAnnouncements = async (token) =>
  dispatchRequest({ action: 'MY_ANNOUNCEMENTS', token });

// Fetches all station announcements for administrative review.
export const adminFetchAnnouncements = async (token, { from = '' } = {}) =>
  dispatchRequest({ action: 'ADMIN_GET_ANNOUNCEMENTS', token, from });

// Saves an announcement and its visibility options.
export const adminSaveAnnouncement = async (announcementData, token) =>
  dispatchRequest({
    action: 'ADMIN_SAVE_ANNOUNCEMENT',
    token,
    id: announcementData.id || '',
    row_version: rowVersionField(announcementData),
    title: announcementData.title || '',
    message: announcementData.message || '',
    effective_date: announcementData.effective_date || '',
    end_date: announcementData.end_date || '',
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

// Deletes an announcement.
export const adminDeleteAnnouncement = async (id, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_ANNOUNCEMENT', token, id });

// Fetches document metadata visible to the member.
export const fetchDocuments = async (token) => dispatchRequest({ action: 'GET_DOCUMENTS', token });

// Fetches the full content of a specific document.
export const fetchDocument = async (id, token) => dispatchRequest({ action: 'GET_DOCUMENT', token, id });

// Fetches all documents including unpublished drafts for admins.
export const adminFetchDocuments = async (token) => dispatchRequest({ action: 'ADMIN_GET_DOCUMENTS', token });

// Fetches document details for admin editing.
export const adminFetchDocument = async (id, token) => dispatchRequest({ action: 'ADMIN_GET_DOCUMENT', token, id });

// Saves a document and its signing / verification requirements.
export const adminSaveDocument = async (documentData, token) =>
  dispatchRequest({
    action: 'ADMIN_SAVE_DOCUMENT',
    token,
    id: documentData.id || '',
    row_version: rowVersionField(documentData),
    title: documentData.title || '',
    folder: documentData.folder || '',
    doc_type: documentData.doc_type || 'markdown',
    sort_order: documentData.sort_order ?? 0,
    content: documentData.content ?? '',
    is_published: documentData.is_published === undefined ? true : Boolean(documentData.is_published),
    rank_id: documentData.rank_id || '',
    is_sign_required: Boolean(documentData.is_sign_required),
    requires_verification: storedRequiresVerification(documentData),
  });

// Deletes a document.
export const adminDeleteDocument = async (id, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_DOCUMENT', token, id });

// Renames a document folder across all files inside it.
export const adminRenameDocumentFolder = async (from, to, token) =>
  dispatchRequest({ action: 'ADMIN_RENAME_DOCUMENT_FOLDER', token, from, to: to || '' });

// Saves custom ordering of documents.
export const adminReorderDocuments = async (order, token) =>
  dispatchRequest({ action: 'ADMIN_REORDER_DOCUMENTS', token, order });

// Signs a document on behalf of the current member.
export const signDocument = async (id, token) => dispatchRequest({ action: 'SIGN_DOCUMENT', token, id });

// Fetches document records for a specific member being reviewed.
export const fetchMemberDocumentRecords = async (userId, token) =>
  dispatchRequest({ action: 'GET_MEMBER_DOCUMENT_RECORDS', token, user_id: userId });

// Fetches all signatures on a document.
export const fetchDocumentSignatures = async (id, token) =>
  dispatchRequest({ action: 'GET_DOCUMENT_SIGNATURES', token, id });

// Fetches an assessment score for a specific member on a document.
export const fetchMemberAssessmentScore = async (documentId, userId, token) =>
  dispatchRequest({ action: 'GET_MEMBER_ASSESSMENT_SCORE', token, document_id: documentId, user_id: userId });

// Records an assessment score for a member.
export const setAssessmentScore = async (documentId, userId, score, scoredOn, token) =>
  dispatchRequest({
    action: 'SET_DOCUMENT_ASSESSMENT_SCORE',
    token,
    document_id: documentId,
    user_id: userId,
    score: String(score ?? ''),
    scored_on: scoredOn,
  });

// Removes a signature from a document.
export const adminRemoveDocumentSignature = async (signatureId, token) =>
  dispatchRequest({ action: 'ADMIN_REMOVE_DOCUMENT_SIGNATURE', token, id: signatureId });

// Backfills paper signatures onto a member's digital record.
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

// Signs off on specific checklist items.
export const signChecklistItems = async (documentId, itemIds, token) =>
  dispatchRequest({
    action: 'SIGN_CHECKLIST_ITEM',
    token,
    document_id: documentId,
    item_ids: Array.isArray(itemIds) ? itemIds : [],
  });

// Verifies a member's completed checklist item.
export const verifyChecklistItem = async (documentId, itemId, userId, token) =>
  dispatchRequest({
    action: 'VERIFY_CHECKLIST_ITEM',
    token,
    document_id: documentId,
    item_id: itemId,
    user_id: userId,
  });

// Verifies all remaining signed checklist items for a member.
export const verifyChecklistRemaining = async (documentId, userId, token) =>
  dispatchRequest({
    action: 'VERIFY_CHECKLIST_REMAINING',
    token,
    document_id: documentId,
    user_id: userId,
  });

// Verifies a member's signature on a full document.
export const verifyDocumentSignature = async (documentId, userId, token) =>
  dispatchRequest({
    action: 'VERIFY_DOCUMENT_SIGNATURE',
    token,
    document_id: documentId,
    user_id: userId,
  });

// Saves an individual checklist item.
export const adminSaveChecklistItem = async (item, token) => {
  const documentId = String(item.document_id || '').trim();
  if (!documentId) throw new Error('A checklist item needs a document.');
  const parent = await getDoc(doc(firestore(), 'documents', documentId));
  if (!parent.exists()) throw new Error('The checklist document is not available.');

  return dispatchRequest({
    action: 'ADMIN_SAVE_CHECKLIST_ITEM',
    token,
    id: item.id || '',
    document_id: item.document_id || '',
    sort_order: item.sort_order ?? 0,
    section: item.section || '',
    label: item.label || '',
    audience_keys: Array.isArray(parent.get('audience_keys')) ? parent.get('audience_keys') : [],
  });
};

// Deletes a checklist item.
export const adminDeleteChecklistItem = async (id, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_CHECKLIST_ITEM', token, id });

// Extracts weekday recurrence flags for an event.
const eventWeekdayFields = (eventData) => {
  const fields = {};
  EVENT_WEEKDAYS.forEach((day) => {
    fields[day.key] = eventData[day.key];
  });
  return fields;
};

// Fetches schedule templates, assignments, and shift definitions.
export const fetchScheduleSetup = async (token) => dispatchRequest({ action: 'GET_SCHEDULE_SETUP', token });

// Fetches station calendar events for members.
export const fetchEvents = async (token) => dispatchRequest({ action: 'GET_EVENTS', token });

// Fetches all events for administration.
export const adminFetchEvents = async (token) => dispatchRequest({ action: 'ADMIN_GET_EVENTS', token });

// Saves a station calendar event.
export const adminSaveEvent = async (eventData, token) =>
  dispatchRequest({
    action: 'ADMIN_SAVE_EVENT',
    token,
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

// Deletes a calendar event.
export const adminDeleteEvent = async (id, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_EVENT', token, id });

// Saves an assignment position (driver, officer, firefighter).
export const adminSaveAssignment = async (assignmentData, token) =>
  dispatchRequest({
    action: 'ADMIN_SAVE_ASSIGNMENT',
    token,
    id: assignmentData.id || '',
    row_version: rowVersionField(assignmentData),
    description: assignmentData.description,
    rank_order_required: assignmentData.rank_order_required ?? '',
    color: assignmentData.color ?? '',
    icon: assignmentData.icon ?? '',
    effective_date: assignmentData.effective_date ?? '',
    end_date: assignmentData.end_date ?? '',
  });

// Deletes an assignment position.
export const adminDeleteAssignment = async (assignmentId, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_ASSIGNMENT', token, id: assignmentId });

// Saves schedule shifts in bulk.
export const adminBulkSaveSchedule = async ({ entries = [], deleteIds = [] }, token) => {
  const request = { action: 'ADMIN_BULK_SAVE_SCHEDULE', token, entries, deleteIds };
  return (await routeWrite('ADMIN_BULK_SAVE_SCHEDULE', request)) || dispatchRequest(request);
};

// Fetches shift offers submitted by the current member.
export const fetchMyShiftOffers = async (token) =>
  dispatchRequest({ action: 'GET_SHIFT_OFFERS', token });

// Submits a member's offer to work an open shift.
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

// Fetches pending shift offers for officer approval.
export const adminFetchScheduleOffers = async (token) =>
  dispatchRequest({ action: 'ADMIN_GET_SCHEDULE_OFFERS', token });

// Approves or declines a member's shift offer.
export const adminResolveShiftOffer = async (offerId, decision, token) => {
  const request = { action: 'ADMIN_RESOLVE_SHIFT_OFFER', token, id: offerId, decision };
  return (await routeWrite('ADMIN_RESOLVE_SHIFT_OFFER', request)) || dispatchRequest(request);
};

// Fetches recurring availability windows for admin setup.
export const adminFetchAvailabilityWindows = async (token) =>
  dispatchRequest({ action: 'ADMIN_GET_AVAILABILITY_WINDOWS', token });

// Saves an availability window template.
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

// Deletes an availability window template.
export const adminDeleteAvailabilityWindow = async (windowId, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_AVAILABILITY_WINDOW', token, id: windowId });

// Fetches availability submissions for the current member.
export const fetchAvailability = async (token, { from = '', to = '' } = {}) =>
  dispatchRequest({ action: 'GET_AVAILABILITY', token, from, to });

// Fetches availability submissions across all members for officers.
export const adminFetchAvailability = async (token, { from = '', to = '' } = {}) =>
  dispatchRequest({ action: 'ADMIN_GET_AVAILABILITY', token, from, to });

// Saves the member's own monthly availability days.
export const setMyAvailability = async ({ month, claims = {} } = {}, token) => {
  const request = { action: 'SET_MY_AVAILABILITY', token, month: String(month || ''), claims };
  return (await routeWrite('SET_MY_AVAILABILITY', request)) || dispatchRequest(request);
};

// Sets a member's monthly availability on their behalf.
export const adminSetAvailability = async (userId, { month, claims = {} } = {}, token) =>
  dispatchRequest({
    action: 'ADMIN_SET_AVAILABILITY',
    token,
    user_id: userId,
    month: String(month || ''),
    claims,
  });

// Saves a single station setting.
export const adminSaveSystemSetting = async (key, value, token) =>
  dispatchRequest({ action: 'ADMIN_SAVE_SYSTEM_SETTING', token, key, value });

// Saves multiple station settings in one batch.
export const adminSaveSystemSettings = async (settings, token) =>
  dispatchRequest({ action: 'ADMIN_SAVE_SYSTEM_SETTINGS', token, settings });

// Checks if an action is unrecognized by the backend.
export const isUnknownAction = (result) => !!result && result.code === 'UNKNOWN_ACTION';

// Deletes a station setting.
export const adminDeleteSystemSetting = async (key, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_SYSTEM_SETTING', token, key });

// Triggers an on-demand database snapshot and updates the backup status.
export const adminTriggerDatabaseBackup = async (token) =>
  dispatchRequest({ action: 'ADMIN_TRIGGER_DATABASE_BACKUP', token });

// Saves an equipment asset record (turnout gear, radio, or SCBA cylinder).
export const adminSaveEquipment = async (item, token) =>
  dispatchRequest({ action: 'ADMIN_SAVE_EQUIPMENT', token, id: item.id, ...item });

// Deletes an equipment asset record.
export const adminDeleteEquipment = async (id, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_EQUIPMENT', token, id });

// Fetches equipment asset records.
export const fetchEquipment = async (token) =>
  dispatchRequest({ action: 'GET_EQUIPMENT', token });

// Saves an apparatus asset record.
export const adminSaveApparatus = async (item, token) =>
  dispatchRequest({ action: 'ADMIN_SAVE_APPARATUS', token, id: item.id, ...item });

// Deletes an apparatus asset record.
export const adminDeleteApparatus = async (id, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_APPARATUS', token, id });

// Fetches apparatus asset records.
export const fetchApparatus = async (token) =>
  dispatchRequest({ action: 'GET_APPARATUS', token });

// Saves an asset type definition (equipment gear type, radio type, or apparatus type).
export const adminSaveAssetType = async (typeData, token) =>
  dispatchRequest({ action: 'ADMIN_SAVE_ASSET_TYPE', token, id: typeData.id, ...typeData });

// Deletes an asset type definition.
export const adminDeleteAssetType = async (id, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_ASSET_TYPE', token, id });

// Fetches configured asset types.
export const fetchAssetTypes = async (token) =>
  dispatchRequest({ action: 'GET_ASSET_TYPES', token });

// Fetches push notification delivery status across all members.
export const adminFetchPushStatus = async (token) =>
  dispatchRequest({ action: 'ADMIN_GET_PUSH_STATUS', token });

// Sends a test push notification to verify setup.
export const adminSendTestPush = async (userId, token) =>
  dispatchRequest({ action: 'ADMIN_SEND_TEST_PUSH', token, user_id: userId });

// Disables or re-enables push notifications for a member.
export const adminSetPushDisabled = async (userId, disabled, token) =>
  dispatchRequest({
    action: 'ADMIN_SET_PUSH_DISABLED',
    token,
    user_id: String(userId || ''),
    disabled: disabled === true,
  });

// Checks Firebase Cloud Messaging credentials status.
export const adminFetchFcmStatus = async (token) =>
  dispatchRequest({ action: 'ADMIN_GET_FCM_STATUS', token });

// Saves a manual timeclock log entry.
export const adminSaveTimeclockEntry = async (entryData, token) =>
  dispatchRequest({
    action: 'ADMIN_SAVE_TIMECLOCK_ENTRY',
    token,
    id: entryData.id || '',
    user_id: entryData.user_id,
    time_in: entryData.time_in,
    time_out: entryData.time_out || '',
  });

// Deletes a timeclock log entry.
export const adminDeleteTimeclockEntry = async (entryId, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_TIMECLOCK_ENTRY', token, id: entryId });

// Fetches the Firefighter Runner game leaderboard.
export const fetchRunnerLeaderboard = async (token) =>
  dispatchRequest({ action: 'GET_RUNNER_LEADERBOARD', token });

// Saves a member's high score in the Runner game.
export const saveRunnerScore = async (score, token) =>
  dispatchRequest({ action: 'SAVE_RUNNER_SCORE', token, score });

// Fetches chat rooms the member has access to.
export const fetchChatRooms = async (token) => dispatchRequest({ action: 'GET_CHAT_ROOMS', token });

// Fetches all chat rooms for admin management.
export const fetchAdminChatRooms = async (token) => dispatchRequest({ action: 'ADMIN_GET_CHAT_ROOMS', token });

// Loads older messages in a chat conversation.
export const fetchChatMessages = async ({ conversationId, before }, token) =>
  dispatchRequest({ action: 'GET_CHAT_MESSAGES', token, conversationId, before });

// Saves a chat room definition.
export const saveChatRoom = async (room, token) =>
  dispatchRequest({ action: 'SAVE_CHAT_ROOM', token, payload: room });

// Deletes a chat room.
export const deleteChatRoom = async (id, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_CHAT_ROOM', token, id });

// Sends a new chat message.
export const sendChatMessage = async ({ conversationId, body, gif }, token) =>
  dispatchRequest({ action: 'SEND_CHAT_MESSAGE', token, conversation_id: conversationId, body, gif });

// Edits an existing chat message.
export const editChatMessage = async ({ conversationId, messageId, body }, token) =>
  dispatchRequest({
    action: 'EDIT_CHAT_MESSAGE',
    token,
    conversation_id: conversationId,
    message_id: messageId,
    body,
  });

// Deletes a chat message.
export const deleteChatMessage = async ({ conversationId, messageId }, token) =>
  dispatchRequest({ action: 'DELETE_CHAT_MESSAGE', token, conversation_id: conversationId, message_id: messageId });

// Opens or creates a private direct message conversation.
export const openChatThread = async ({ memberIds }, token) =>
  dispatchRequest({ action: 'OPEN_CHAT_THREAD', token, member_ids: memberIds || [] });

// Lists members available to chat with.
export const fetchChatPeople = async (token) => dispatchRequest({ action: 'LIST_CHAT_PEOPLE', token });

// Adds or removes members in a group conversation.
export const updateChatParticipants = async ({ conversationId, add, remove }, token) =>
  dispatchRequest({
    action: 'UPDATE_CHAT_PARTICIPANTS',
    token,
    conversation_id: conversationId,
    add: add || [],
    remove: remove || [],
  });

// Toggles an emoji reaction on a chat message.
export const reactToChatMessage = async ({ conversationId, messageId, emoji }, token) =>
  dispatchRequest({
    action: 'REACT_TO_CHAT_MESSAGE',
    token,
    conversation_id: conversationId,
    message_id: messageId,
    emoji,
  });

// Updates the member's read marker and mute setting for a chat room.
export const setChatRead = async ({ conversationId, readCount, muted, readAt }, token) =>
  dispatchRequest({ action: 'SET_CHAT_READ', token, conversation_id: conversationId, read_count: readCount, muted, read_at: readAt });

// Saves a work order (from member submission or officer edit).
export const saveWorkOrder = async (workOrder, token) =>
  dispatchRequest({ action: 'SAVE_WORK_ORDER', token, id: workOrder.id, ...workOrder });

// Saves a work order from administrative panel.
export const adminSaveWorkOrder = async (workOrder, token) =>
  dispatchRequest({ action: 'ADMIN_SAVE_WORK_ORDER', token, id: workOrder.id, ...workOrder });

// Deletes a work order.
export const adminDeleteWorkOrder = async (id, token) =>
  dispatchRequest({ action: 'ADMIN_DELETE_WORK_ORDER', token, id });

// Fetches work orders.
export const fetchWorkOrders = async (token) =>
  dispatchRequest({ action: 'GET_WORK_ORDERS', token });