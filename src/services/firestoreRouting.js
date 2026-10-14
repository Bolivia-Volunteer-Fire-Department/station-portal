// Decides which actions route to Firestore and executes their read and write handlers.
import { firebaseConfigured } from './firebase.js';
import { OFFLINE_CLOCK_MESSAGE, OFFLINE_WRITE_MESSAGE, isOffline } from '../utils/connectivity.js';

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const setting = (key) => env[key] ?? (typeof process !== 'undefined' ? process.env[key] : undefined);

// Reads feature flags from environment variables.
const enabledFeatures = () =>
  String(setting('VITE_FIRESTORE_FEATURES') || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

// Checks if a specific feature is enabled.
const featureIsOn = (name) => {
  const named = enabledFeatures();
  if (named.includes('off') || named.includes('none')) return false;
  return named.length === 0 || named.includes('*') || named.includes(name);
};

// Maps features to their required prerequisites and supported read/write actions.
export const ROUTED_FEATURES = {
  // Timeclock punch in, punch out, and shift log maintenance.
  clock: {
    requires: ['memberPayload'],
    writes: ['CLOCK_IN', 'CLOCK_OUT', 'ADMIN_SAVE_TIMECLOCK_ENTRY', 'ADMIN_DELETE_TIMECLOCK_ENTRY'],
    switchReads: ['GET_ON_DUTY', 'GET_TIMECLOCK_LOGS'],
  },
  // Member and admin shift availability setup and scheduling claims.
  availability: {
    requires: ['memberPayload'],
    writes: [
      'SET_MY_AVAILABILITY',
      'ADMIN_SET_AVAILABILITY',
      'ADMIN_SAVE_AVAILABILITY_WINDOW',
      'ADMIN_DELETE_AVAILABILITY_WINDOW',
    ],
    reads: ['ADMIN_GET_AVAILABILITY_WINDOWS', 'ADMIN_GET_AVAILABILITY'],
    switchReads: ['GET_AVAILABILITY'],
  },
  // Shift offers and swap approvals.
  offers: {
    requires: ['memberPayload', 'adminPayload'],
    writes: ['SUBMIT_SHIFT_OFFER', 'ADMIN_RESOLVE_SHIFT_OFFER'],
    switchReads: ['GET_SHIFT_OFFERS', 'ADMIN_GET_SCHEDULE_OFFERS'],
  },
  // Schedule calendar bulk editing board.
  scheduleBoard: {
    requires: ['adminPayload'],
    writes: ['ADMIN_BULK_SAVE_SCHEDULE'],
    switchReads: ['GET_SCHEDULE', 'ADMIN_GET_BOOTSTRAP'],
  },
  // Single document saves for admin configurations.
  adminSaves: {
    requires: ['adminPayload'],
    writes: [
      'ADMIN_SAVE_ROLE',
      'ADMIN_SAVE_RANK',
      'ADMIN_SAVE_SHIFT',
      'ADMIN_SAVE_CERTIFICATION_SETUP',
      'ADMIN_SAVE_CHECKLIST_ITEM',
      'ADMIN_SAVE_ANNOUNCEMENT',
      'ADMIN_SAVE_DOCUMENT',
      'ADMIN_SAVE_EVENT',
      'ADMIN_SAVE_ASSIGNMENT',
      'ADMIN_SAVE_SCHEDULE_TEMPLATE',
      'ADMIN_SAVE_CERTIFICATION',
      'SAVE_TRAINING',
      'ADMIN_DELETE_ASSIGNMENT',
      'ADMIN_DELETE_SCHEDULE_TEMPLATE',
      'ADMIN_DELETE_CERTIFICATION',
      'ADMIN_BULK_SAVE_TRAINING',
      'ADMIN_BULK_SAVE_CERTIFICATION',
      'ADMIN_SAVE_SYSTEM_SETTING',
      'ADMIN_SAVE_SYSTEM_SETTINGS',
      'ADMIN_DELETE_SYSTEM_SETTING',
      'ADMIN_TRIGGER_DATABASE_BACKUP',
      'ADMIN_DELETE_ROLE',
      'ADMIN_DELETE_RANK',
      'ADMIN_DELETE_SHIFT',
      'ADMIN_DELETE_CERTIFICATION_SETUP',
      'ADMIN_DELETE_CHECKLIST_ITEM',
      'ADMIN_DELETE_ANNOUNCEMENT',
      'ADMIN_DELETE_DOCUMENT',
      'ADMIN_DELETE_EVENT',
    ],
    reads: [],
    switchReads: [],
  },
  // Member module data reads and queries.
  memberReads: {
    requires: ['memberPayload'],
    writes: [],
    reads: [
      'GET_ON_DUTY',
      'GET_ROSTER',
      'GET_ROSTER_MODULE',
      'GET_CERTIFICATION_BADGES',
      'GET_TIMECLOCK_LOGS',
      'GET_SCHEDULE',
      'GET_SCHEDULE_SETUP',
      'GET_AVAILABILITY',
      'GET_AVAILABILITY_WINDOWS',
      'GET_SHIFT_OFFERS',
      'GET_TRAINING',
      'GET_CERTIFICATIONS',
      'MY_ANNOUNCEMENTS',
      'GET_EVENTS',
      'GET_INITIAL_DATA',
      'MY_PUSH_DEVICES',
    ],
    switchReads: [],
  },

  // Document library, checklists, signatures, and assessment tests.
  documents: {
    requires: ['memberPayload'],
    writes: [
      'SIGN_DOCUMENT',
      'SIGN_CHECKLIST_ITEM',
      'VERIFY_CHECKLIST_ITEM',
      'VERIFY_CHECKLIST_REMAINING',
      'VERIFY_DOCUMENT_SIGNATURE',
      'ADMIN_REMOVE_DOCUMENT_SIGNATURE',
      'BACKFILL_DOCUMENT_SIGNATURES',
      'ADMIN_RENAME_DOCUMENT_FOLDER',
      'ADMIN_REORDER_DOCUMENTS',
      'SET_DOCUMENT_ASSESSMENT_SCORE',
    ],
    reads: [
      'GET_DOCUMENTS',
      'GET_DOCUMENT',
      'ADMIN_GET_DOCUMENT',
      'GET_MEMBER_DOCUMENT_RECORDS',
      'GET_DOCUMENT_SIGNATURES',
      'GET_MEMBER_ASSESSMENT_SCORE',
    ],
    switchReads: [],
  },

  // Push notification device token registration.
  push: {
    requires: ['memberPayload'],
    writes: ['REGISTER_PUSH_DEVICE', 'UNREGISTER_PUSH_DEVICE', 'ADMIN_SET_PUSH_DISABLED', 'ADMIN_SEND_TEST_PUSH'],
    reads: ['ADMIN_GET_PUSH_STATUS', 'ADMIN_GET_FCM_STATUS'],
    switchReads: [],
  },

  // User preferences (theme, notification toggles, FEMA student ID).
  memberSettings: {
    requires: ['memberPayload'],
    writes: ['UPDATE_USER_SETTINGS', 'SAVE_MEMBER_PRIVATE'],
    switchReads: [],
  },

  // Member training attendance signatures.
  trainingSignatures: {
    requires: ['memberPayload'],
    writes: ['SIGN_TRAINING', 'ADMIN_REMOVE_TRAINING_SIGNATURE'],
    switchReads: [],
  },

  // Firefighter Runner mini-game high scores and leaderboard.
  runner: {
    requires: ['memberPayload'],
    writes: ['SAVE_RUNNER_SCORE'],
    reads: ['GET_RUNNER_LEADERBOARD'],
    switchReads: [],
  },

  // Station team chat messages, threads, and rooms.
  chat: {
    requires: ['memberPayload'],
    writes: [
      'SEND_CHAT_MESSAGE',
      'EDIT_CHAT_MESSAGE',
      'DELETE_CHAT_MESSAGE',
      'OPEN_CHAT_THREAD',
      'UPDATE_CHAT_PARTICIPANTS',
      'REACT_TO_CHAT_MESSAGE',
      'SAVE_CHAT_ROOM',
      'ADMIN_DELETE_CHAT_ROOM',
      'SET_CHAT_READ',
    ],
    reads: ['GET_CHAT_ROOMS', 'GET_CHAT_MESSAGES', 'ADMIN_GET_CHAT_ROOMS', 'LIST_CHAT_PEOPLE'],
    switchReads: [],
  },

  // Account administration (deleting users and cleaning up records).
  memberAccounts: {
    requires: ['adminPayload'],
    writes: ['ADMIN_DELETE_USER'],
    switchReads: [],
  },

  // Reports and statistical summaries.
  reports: {
    requires: ['memberPayload'],
    writes: ['SAVE_REPORT_CONFIG', 'DELETE_REPORT_CONFIG'],
    reads: ['GET_REPORTS', 'GET_REPORT_CONFIGS', 'RUN_REPORT'],
    switchReads: [],
  },

  // Customizable electronic form templates.
  forms: {
    requires: ['memberPayload'],
    writes: ['SAVE_FORM_TEMPLATE', 'DELETE_FORM_TEMPLATE'],
    reads: ['GET_FORM_TEMPLATES', 'ADMIN_GET_FORM_TEMPLATES', 'GET_MEMBER_TRAINING'],
    switchReads: [],
  },

  // Certification scanned image attachments.
  certificationFiles: {
    requires: ['memberPayload'],
    writes: ['ADMIN_SAVE_CERTIFICATION_FILE', 'ADMIN_DELETE_CERTIFICATION_FILE'],
    reads: ['GET_MY_CERTIFICATION_FILES', 'ADMIN_GET_CERTIFICATION_FILES'],
    switchReads: [],
  },

  // Interactive district map (drawing SVG, boundary, landmarks, and backdrops).
  districtMap: {
    requires: ['memberPayload'],
    writes: [
      'ADMIN_SAVE_MAP_LAYER',
      'ADMIN_DELETE_MAP_LAYER',
      'ADMIN_SAVE_MAP_BOUNDARY',
      'ADMIN_DELETE_MAP_BOUNDARY',
      'ADMIN_SAVE_MAP_LANDMARK',
      'ADMIN_DELETE_MAP_LANDMARK',
      'ADMIN_SAVE_MAP_BACKDROP',
      'ADMIN_DELETE_MAP_BACKDROP',
      'ADMIN_SAVE_MAP_TYPES',
    ],
    reads: ['GET_MAP_LAYER', 'GET_MAP_BOUNDARY', 'GET_MAP_LANDMARKS', 'GET_MAP_BACKDROPS', 'GET_MAP_TYPES'],
    switchReads: [],
  },

  // Initial member data bundle loaded right after signing in.
  memberPayload: { requires: [], writes: [], reads: ['GET_BOOTSTRAP'], switchReads: ['GET_BOOTSTRAP'] },

  // Administrative section queries.
  adminReads: {
    requires: ['adminPayload'],
    writes: [],
    reads: ['ADMIN_GET_ANNOUNCEMENTS', 'ADMIN_GET_EVENTS', 'ADMIN_GET_DOCUMENTS', 'ADMIN_GET_SCHEDULE_OFFERS', 'ADMIN_GET_CERTIFICATIONS', 'ADMIN_GET_DOCUMENT_VERIFICATION_COUNT'],
    switchReads: [],
  },

  // Complete admin data bundle loaded when opening the administration panel.
  adminPayload: {
    requires: ['memberPayload'],
    writes: [],
    reads: ['ADMIN_GET_BOOTSTRAP'],
    switchReads: ['ADMIN_GET_BOOTSTRAP'],
  },
};

// Map each write action to its feature.
export const ROUTED_WRITES = Object.fromEntries(
  Object.entries(ROUTED_FEATURES).flatMap(([feature, spec]) =>
    (spec.writes || []).map((action) => [action, feature])
  )
);

// Map each read action to its feature.
export const ROUTED_READS = Object.fromEntries(
  Object.entries(ROUTED_FEATURES).flatMap(([feature, spec]) => (spec.reads || []).map((action) => [action, feature]))
);

// Formats successful responses.
export const ok = (data = {}) => ({ success: true, ...data });

// Formats error responses.
export const fail = (message, code = 'FIRESTORE_ERROR') => ({ success: false, code, message });

// Known error messages for common business rule refusals.
const FAILURE_MESSAGES = {
  'already-clocked-in': 'You are already clocked in.',
  'no-entry': 'That shift is no longer open.',
  'not-your-entry': 'That shift belongs to somebody else.',
  'already-clocked-out': 'That shift is already closed.',
  'on-duty-mismatch': 'Your clock record and on-duty status do not match. Ask an officer to review it.',
  offline: OFFLINE_CLOCK_MESSAGE,
};

// Tracks the most recent failure reason for each read action for debugging.
const lastReadFailure = new Map();
export const lastReadFailureFor = (action) => lastReadFailure.get(String(action || '')) || '';

// Executes a routed read request.
export const routeRead = async (action, body = {}) => {
  const blocker = await routingBlocker(action);
  if (blocker) {
    console.warn(
      `[firestore] ${action} is NOT routed (${blocker}), and there is no sheet to ask any more - so this read fails.` +
        (blocker === 'feature-off'
          ? ' VITE_FIRESTORE_FEATURES is pinning a list of routes; unset it, or add this route, or set it to `off` deliberately.'
          : '')
    );
    return null;
  }

  const { firebaseAuth } = await import('./firebase.js');
  const uid = firebaseAuth().currentUser?.uid || '';
  try {
    if (READ_DISPATCH[action]) return await READ_DISPATCH[action](uid, body);
    const { READERS } = await import('./firestoreReads.js');
    if (READERS[action]) return ok(await READERS[action](uid, body));
    console.error(`[firestore] ${action} is routed but has no reader, so it is being read from the sheet.`);
    return null;
  } catch (error) {
    lastReadFailure.set(
      action,
      `${(error && error.code) || 'failed'}${error && error.message ? `: ${error.message}` : ''}`
    );
    console.error(
      `[firestore] ${action} could not be read from Firestore (${(error && error.code) || error.message}): ${
        (error && error.message) || ''
      }`
    );
    if (action === 'GET_BOOTSTRAP') {
      const { diagnoseMemberPayload } = await import('./firestorePayload.js');
      const { refused, failed } = await diagnoseMemberPayload(uid);
      if (refused.length) console.error(`[firestore] refused: ${refused.join(', ')}`);
      if (failed.length) console.error(`[firestore] failed for another reason: ${failed.join(', ')}`);
    }
    return null;
  }
};

// Converts database errors into helpful user messages.
export const failureFor = (error) => {
  const name = String((error && error.message) || '');
  const code = String((error && error.code) || '');
  const refusal = Object.keys(FAILURE_MESSAGES).find((message) => name === message || name.startsWith(`${message} `));
  if (refusal) return fail(FAILURE_MESSAGES[refusal], 'REFUSED');
  if (code === 'functions/permission-denied' || code === 'permission-denied') {
    return fail('You do not have permission to do that.', 'UNAUTHORIZED');
  }
  if (code === 'functions/unauthenticated' || code === 'unauthenticated') {
    return fail('Your session has expired. Please sign in again.', 'UNAUTHORIZED');
  }
  if (isOffline()) return fail(OFFLINE_WRITE_MESSAGE, 'OFFLINE');
  return fail(name || 'The change could not be saved.', 'FIRESTORE_ERROR');
};

// Actions that can run before the user has signed in.
const PRE_AUTH_READS = ['GET_INITIAL_DATA'];

// Checks if an action is allowed to run through Firestore.
export const routingBlocker = async (action) => {
  const feature = ROUTED_WRITES[action] || ROUTED_READS[action];
  if (!feature) return 'not-a-routed-action';
  if (!featureIsOn(feature)) return 'feature-off';
  if (!firebaseConfigured()) return 'firebase-unconfigured';

  const missing = ROUTED_FEATURES[feature].requires.filter((name) => !featureIsOn(name));
  if (missing.length) return `prerequisite-off:${missing.join(',')}`;

  if (PRE_AUTH_READS.includes(action)) return null;

  const { firebaseAuth } = await import('./firebase.js');
  if (!firebaseAuth().currentUser) return 'not-signed-in-to-firebase';
  return null;
};

// Dynamically loads the Firestore write helpers.
const writes = () => import('./firestoreWrites.js');

// Calls a backend Cloud Function.
const callable = async (name, data) => {
  const [{ httpsCallable }, { firebaseFunctions }] = await Promise.all([
    import('firebase/functions'),
    import('./firebase.js'),
  ]);
  const answer = await httpsCallable(firebaseFunctions(), name)(data);
  return answer.data || {};
};

// Handlers for specific read actions.
const READ_DISPATCH = {
  GET_BOOTSTRAP: async (uid) => {
    const { fetchMemberPayload } = await import('./firestorePayload.js');
    return ok(await fetchMemberPayload({ userId: uid }));
  },
  ADMIN_GET_BOOTSTRAP: async (uid) => {
    const { fetchAdminPayload } = await import('./firestorePayload.js');
    return ok(await fetchAdminPayload({ userId: uid }));
  },
  ADMIN_GET_CERTIFICATIONS: async (uid, body) => {
    void uid;
    return ok(await callable('readAdminCertificationRecords', { includeInactive: body?.includeInactive === true }));
  },
  ADMIN_GET_DOCUMENT_VERIFICATION_COUNT: async (uid, body) => {
    try {
      const result = await callable('readDocumentVerificationCount', {});
      if (result && typeof result.byDocument === 'object') {
        return ok(result);
      }
    } catch (err) {
      console.warn('[routing] callable readDocumentVerificationCount failed, using direct read', err);
    }
    const { readPendingDocumentVerifications } = await import('./firestoreReads.js');
    return ok(await readPendingDocumentVerifications(uid, body?.verifiableDocs));
  },
  GET_REPORTS: async () => ok(await callable('getReports', {})),
  GET_REPORT_CONFIGS: async () => ok(await callable('getReportConfigurations', {})),
  RUN_REPORT: async (_uid, body) => ok(await callable('runReport', body || {})),
};

// Prevents clock punches while disconnected from the network.
const refuseClockOffline = () => {
  if (isOffline()) throw new Error('offline');
};

// Action dispatchers for writes.
const DISPATCH = {
  SAVE_REPORT_CONFIG: async (body) => ok(await callable('saveReportConfiguration', body || {})),
  DELETE_REPORT_CONFIG: async (body) => ok(await callable('deleteReportConfiguration', { reportId: body.reportId || body.id })),

  SAVE_FORM_TEMPLATE: async (body, uid) => {
    const { saveFormTemplate } = await writes();
    return ok(await saveFormTemplate({ id: body?.id, definition: body?.definition, authorId: uid }));
  },
  DELETE_FORM_TEMPLATE: async (body) => {
    const { deleteFormTemplate } = await writes();
    return ok(await deleteFormTemplate({ id: body?.id || body?.formId }));
  },

  ADMIN_SAVE_MAP_LAYER: async (body, uid) => {
    const { saveMapLayer } = await writes();
    return ok(await saveMapLayer({ svg: body?.svg, authorId: uid }));
  },

  ADMIN_DELETE_MAP_LAYER: async () => {
    const { deleteMapLayer } = await writes();
    return ok(await deleteMapLayer());
  },

  ADMIN_SAVE_MAP_BOUNDARY: async (body, uid) => {
    const { saveMapBoundary } = await writes();
    const request = body?.request || body || {};
    return ok(await saveMapBoundary({ geojson: request.geojson, meta: request.meta || {}, authorId: uid }));
  },

  ADMIN_DELETE_MAP_BOUNDARY: async () => {
    const { deleteMapBoundary } = await writes();
    return ok(await deleteMapBoundary());
  },

  ADMIN_SAVE_MAP_LANDMARK: async (body, uid) => {
    const { saveMapLandmark } = await writes();
    const request = body?.request || body || {};
    return ok(await saveMapLandmark({ id: request.id || '', fields: request.fields || {}, authorId: uid }));
  },

  ADMIN_DELETE_MAP_LANDMARK: async (body) => {
    const { deleteMapLandmark } = await writes();
    return ok(await deleteMapLandmark({ id: body?.id || body?.landmarkId }));
  },

  ADMIN_SAVE_MAP_BACKDROP: async (body, uid) => {
    const { saveMapBackdrop } = await writes();
    const request = body?.request || body || {};
    return ok(
      await saveMapBackdrop({
        layer: request.layer,
        geojson: request.geojson,
        meta: request.meta || {},
        authorId: uid,
      })
    );
  },

  ADMIN_DELETE_MAP_BACKDROP: async (body) => {
    const { deleteMapBackdrop } = await writes();
    return ok(await deleteMapBackdrop({ layer: body?.layer }));
  },

  ADMIN_SAVE_MAP_TYPES: async (body, uid) => {
    const { saveMapTypes } = await writes();
    const request = body?.request || body || {};
    return ok(await saveMapTypes({ types: request.types, authorId: uid }));
  },

  CLOCK_IN: async (body, uid) => {
    refuseClockOffline();
    return ok(await callable('clockIn', {
      gps_lat: body.gps_lat || '',
      gps_lon: body.gps_lon || '',
    }));
  },

  CLOCK_OUT: async (body, uid) => {
    refuseClockOffline();
    const { openClockEntryFor } = await writes();
    const open = await openClockEntryFor(uid);
    if (!open) return fail('You are not clocked in.', 'REFUSED');
    return ok(await callable('clockOut', { entryId: open.id }));
  },

  SET_MY_AVAILABILITY: async (body, uid) => {
    const { saveAvailabilityMonth } = await writes();
    const month = String(body.month || '').trim();
    if (!month) return fail('A month is needed to save availability.', 'REFUSED');
    return ok(await saveAvailabilityMonth({ userId: uid, month, claims: body.claims || {} }));
  },

  ADMIN_SET_AVAILABILITY: async (body) => {
    const target = String(body.user_id || '').trim();
    if (!target) throw new Error('Which member is this availability for?');
    const month = String(body.month || '').trim();
    if (!month) return fail('A month is needed to save availability.', 'REFUSED');
    const { saveAvailabilityMonth } = await writes();
    return ok(await saveAvailabilityMonth({ userId: target, month, claims: body.claims || {} }));
  },

  REGISTER_PUSH_DEVICE: async (body) =>
    ok(
      await callable('registerPushDevice', {
        device_token: body.device_token,
        device_label: body.device_label,
        transfer: body.transfer === true,
      })
    ),

  UNREGISTER_PUSH_DEVICE: async (body) => {
    const { removePushDevice } = await writes();
    return ok(await removePushDevice({ token: body.device_token }));
  },

  ADMIN_SET_PUSH_DISABLED: async (body) => {
    const { setPushDisabled } = await writes();
    return ok(await setPushDisabled({ userId: body.user_id, disabled: body.disabled === true }));
  },

  SAVE_RUNNER_SCORE: async (body) => ok(await callable('saveRunnerScore', { score: body.score })),

  ADMIN_SAVE_CERTIFICATION_FILE: async (body) =>
    ok(
      await callable('saveCertificationFile', {
        recordId: String(body.recordId || ''),
        fileId: String(body.fileId || ''),
        name: String(body.name || ''),
      })
    ),
  ADMIN_DELETE_CERTIFICATION_FILE: async (body) =>
    ok(await callable('deleteCertificationFile', { fileId: String(body.fileId || '') })),

  SEND_CHAT_MESSAGE: async (body) =>
    ok(await callable('sendChatMessage', { conversationId: body.conversation_id, body: body.body, gif: body.gif })),
  EDIT_CHAT_MESSAGE: async (body) =>
    ok(
      await callable('editChatMessage', {
        conversationId: body.conversation_id,
        messageId: body.message_id,
        body: body.body,
      })
    ),
  DELETE_CHAT_MESSAGE: async (body) =>
    ok(await callable('deleteChatMessage', { conversationId: body.conversation_id, messageId: body.message_id })),
  OPEN_CHAT_THREAD: async (body) => ok(await callable('openChatThread', { memberIds: body.member_ids || [] })),
  UPDATE_CHAT_PARTICIPANTS: async (body) =>
    ok(
      await callable('updateChatParticipants', {
        conversationId: body.conversation_id,
        add: body.add || [],
        remove: body.remove || [],
      })
    ),
  REACT_TO_CHAT_MESSAGE: async (body) =>
    ok(
      await callable('reactToChatMessage', {
        conversationId: body.conversation_id,
        messageId: body.message_id,
        emoji: body.emoji,
      })
    ),
  LIST_CHAT_PEOPLE: async () => ok(await callable('getChatPeople', {})),

  SAVE_CHAT_ROOM: async (body) => {
    const { saveChatRoom } = await writes();
    return ok(await saveChatRoom(body.payload || {}));
  },
  ADMIN_DELETE_CHAT_ROOM: async (body) => {
    const { deleteChatRoom } = await writes();
    return ok(await deleteChatRoom(body.id));
  },

  SET_CHAT_READ: async (body, uid) => {
    const { setChatRead } = await writes();
    return ok(
      await setChatRead({
        userId: uid,
        conversationId: body.conversation_id,
        readCount: body.read_count,
        readAt: body.read_at,
        muted: body.muted,
      })
    );
  },

  ADMIN_DELETE_USER: async (body) => callable('deleteMember', { userId: body.id }),

  ADMIN_SEND_TEST_PUSH: async (body) => ok(await callable('sendTestPush', { user_id: body.user_id })),

  UPDATE_USER_SETTINGS: async (body, uid) => {
    const { saveMemberSettings } = await writes();
    const payload = body.payload || {};
    return ok(await saveMemberSettings({ userId: payload.id || uid, fields: payload }));
  },

  SAVE_MEMBER_PRIVATE: async (body, uid) => {
    const { saveMemberPrivateFields } = await writes();
    return ok(await saveMemberPrivateFields({ userId: body?.userId || uid, fields: body?.fields || {} }));
  },

  SAVE_MEMBER_AVATAR: async (body, uid) => {
    const { saveMemberAvatarUrl } = await writes();
    return ok(await saveMemberAvatarUrl({ userId: uid, url: body?.url || '' }));
  },

  SIGN_DOCUMENT: async (body, uid) => {
    const { signDocument } = await writes();
    return ok(await signDocument({ userId: uid, documentId: body.id }));
  },

  SET_DOCUMENT_ASSESSMENT_SCORE: async (body, uid) => {
    const { setDocumentAssessmentScore } = await writes();
    return ok(
      await setDocumentAssessmentScore({
        scorerId: uid,
        documentId: body.document_id,
        memberId: body.user_id,
        score: body.score,
        scoredOn: body.scored_on,
      })
    );
  },

  SIGN_CHECKLIST_ITEM: async (body, uid) => {
    const { signChecklistItems } = await writes();
    return ok(await signChecklistItems({ userId: uid, documentId: body.document_id, itemIds: body.item_ids }));
  },

  VERIFY_CHECKLIST_ITEM: async (body, uid) => {
    const { verifyChecklistItem } = await writes();
    return ok(
      await verifyChecklistItem({
        verifierId: uid,
        documentId: body.document_id,
        itemId: body.item_id,
        memberId: body.user_id,
      })
    );
  },

  VERIFY_CHECKLIST_REMAINING: async (body, uid) => {
    const { verifyChecklistRemaining } = await writes();
    return ok(await verifyChecklistRemaining({ verifierId: uid, documentId: body.document_id, memberId: body.user_id }));
  },

  VERIFY_DOCUMENT_SIGNATURE: async (body, uid) => {
    const { verifyDocumentSignature } = await writes();
    return ok(
      await verifyDocumentSignature({
        verifierId: uid,
        documentId: body.document_id,
        memberId: body.user_id,
      })
    );
  },

  ADMIN_REMOVE_DOCUMENT_SIGNATURE: async (body) => {
    const { removeDocumentSignature } = await writes();
    return ok(await removeDocumentSignature({ id: body.id }));
  },

  ADMIN_RENAME_DOCUMENT_FOLDER: async (body) => {
    const { renameDocumentFolder } = await writes();
    return ok(await renameDocumentFolder({ from: body.from, to: body.to }));
  },

  ADMIN_REORDER_DOCUMENTS: async (body) => {
    const { reorderDocuments } = await writes();
    return ok(await reorderDocuments({ order: body.order }));
  },

  BACKFILL_DOCUMENT_SIGNATURES: async (body, uid) => {
    const { backfillDocumentSignatures } = await writes();
    return ok(
      await backfillDocumentSignatures({
        recorderId: uid,
        documentId: body.document_id,
        memberId: body.user_id,
        itemIds: body.item_ids,
        recordedOn: body.recorded_on,
        note: body.note,
        confirmVerified: body.confirm_verified === true,
      })
    );
  },

  SIGN_TRAINING: async (body, uid) => {
    const { signTrainings } = await writes();
    const payload = body.payload || {};
    return ok(await signTrainings({ userId: uid, trainingIds: payload.training_ids }));
  },

  ADMIN_REMOVE_TRAINING_SIGNATURE: async (body) => {
    const { removeTrainingSignature } = await writes();
    return ok(await removeTrainingSignature({ id: body.signature_id || body.id }));
  },

  ADMIN_SAVE_TIMECLOCK_ENTRY: async (body) => {
    const { saveTimeclockEntry } = await writes();
    return ok(await saveTimeclockEntry({ id: body.id, userId: body.user_id, timeIn: body.time_in, timeOut: body.time_out }));
  },

  ADMIN_DELETE_TIMECLOCK_ENTRY: async (body) => {
    const { deleteTimeclockEntry } = await writes();
    return ok(await deleteTimeclockEntry({ id: body.id }));
  },

  ADMIN_BULK_SAVE_SCHEDULE: async (body) => {
    const { saveScheduleBoard } = await writes();
    return ok(await saveScheduleBoard({ entries: body.entries || [], deleteIds: body.deleteIds || [] }));
  },

  ADMIN_RESOLVE_SHIFT_OFFER: async (body) => {
    const decision = String(body.decision || '').trim().toLowerCase();
    if (decision === 'approve' || decision === 'approved') {
      const { approveOffer } = await writes();
      return ok(await approveOffer({ offerId: body.id }));
    }
    if (decision === 'decline' || decision === 'declined') {
      const { declineOffer } = await writes();
      return ok(await declineOffer({ offerId: body.id }));
    }
    console.error(
      `[firestore] ADMIN_RESOLVE_SHIFT_OFFER was given "${body.decision}", which is neither an APPROVE nor a DECLINE.`
    );
    return null;
  },

  SUBMIT_SHIFT_OFFER: async (body, uid) => {
    const { makeOffer } = await writes();
    const scheduleId = String(body.schedule_id || '');
    const dateKey = String(body.date_from || '').slice(0, 10);
    const slotKey = scheduleId
      ? `row-${scheduleId}`
      : dateKey && body.schedule_template_id
        ? `slot-${dateKey}-${body.schedule_template_id}`
        : '';
    const id = await makeOffer({
      userId: uid,
      scheduleId,
      templateId: String(body.schedule_template_id || ''),
      dateFrom: body.date_from,
      dateTo: body.date_to,
      assignmentId: body.assignment_id,
      slotKey,
    });
    return ok({ id });
  },

  ADMIN_BULK_SAVE_TRAINING: async (body) => {
    const { saveTrainingRows } = await writes();
    const request = body.payload || body;
    return ok(await saveTrainingRows({ rows: request.trainings || [], deleteIds: request.deleteIds || [] }));
  },

  ADMIN_BULK_SAVE_CERTIFICATION: async (body) => {
    const { saveCertificationRows, refreshCertificationBadges } = await writes();
    const request = body.payload || body;
    const result = await saveCertificationRows({
      records: request.records || [],
      updates: request.updates || [],
      deleteIds: request.deleteIds || [],
    });
    return ok({ ...result, badges: await refreshCertificationBadges() });
  },

  SAVE_TRAINING: async (body) => {
    const { saveTrainingRows } = await writes();
    const request = body.payload || body;
    return ok(await saveTrainingRows({ rows: request.trainings || [] }));
  },

  ADMIN_SAVE_SYSTEM_SETTING: async (body) => {
    const { saveSystemSettings } = await writes();
    return ok(await saveSystemSettings({ settings: [{ key: body.key, value: body.value }] }));
  },

  ADMIN_SAVE_SYSTEM_SETTINGS: async (body) => {
    const { saveSystemSettings } = await writes();
    const pairs = Array.isArray(body.settings)
      ? body.settings
      : Object.entries(body.settings || {}).map(([key, value]) => ({ key, value }));
    return ok(await saveSystemSettings({ settings: pairs }));
  },

  ADMIN_DELETE_SYSTEM_SETTING: async (body) => {
    const { deleteSystemSetting } = await writes();
    return ok(await deleteSystemSetting(body.key));
  },

  ADMIN_TRIGGER_DATABASE_BACKUP: async () => ok(await callable('triggerManualBackup', {})),
};

// Maps admin actions to single-document collections.
const DOCUMENT_SAVES = {
  ADMIN_SAVE_ROLE: 'roles',
  ADMIN_SAVE_RANK: 'ranks',
  ADMIN_SAVE_SHIFT: 'shifts',
  ADMIN_SAVE_AVAILABILITY_WINDOW: 'availability_windows',
  ADMIN_SAVE_CHECKLIST_ITEM: 'document_checklist_items',
  ADMIN_SAVE_ASSIGNMENT: 'assignments',
  ADMIN_SAVE_SCHEDULE_TEMPLATE: 'schedule_templates',
};

// Certification saves that trigger recalculation of roster badges.
const BADGE_REFRESHING_SAVES = {
  ADMIN_SAVE_CERTIFICATION: { collection: 'certifications', kind: 'save' },
  ADMIN_DELETE_CERTIFICATION: { collection: 'certifications', kind: 'delete' },
  ADMIN_SAVE_CERTIFICATION_SETUP: { collection: 'certification_setup', kind: 'save' },
};

const DOCUMENT_DELETES = {
  ADMIN_DELETE_ROLE: 'roles',
  ADMIN_DELETE_RANK: 'ranks',
  ADMIN_DELETE_SHIFT: 'shifts',
  ADMIN_DELETE_AVAILABILITY_WINDOW: 'availability_windows',
  ADMIN_DELETE_CERTIFICATION_SETUP: 'certification_setup',
  ADMIN_DELETE_CHECKLIST_ITEM: 'document_checklist_items',
  ADMIN_DELETE_ANNOUNCEMENT: 'announcements',
  ADMIN_DELETE_DOCUMENT: 'documents',
  ADMIN_DELETE_EVENT: 'events',
  ADMIN_DELETE_ASSIGNMENT: 'assignments',
  ADMIN_DELETE_SCHEDULE_TEMPLATE: 'schedule_templates',
};

// Collections that save audience keys for rank or role visibility filtering.
const AUDIENCE_SAVES = {
  ADMIN_SAVE_ANNOUNCEMENT: { collection: 'announcements', rankAndAbove: false, liveUntilFrom: 'end_date' },
  ADMIN_SAVE_DOCUMENT: { collection: 'documents', rankAndAbove: true },
  ADMIN_SAVE_EVENT: { collection: 'events', rankAndAbove: true },
};

// Generate handlers for basic document saves.
Object.entries(DOCUMENT_SAVES).forEach(([action, collection]) => {
  DISPATCH[action] = async (body) => {
    const { saveDocument } = await writes();
    return ok(await saveDocument({ collection, id: body.id, body }));
  };
});

// Generate handlers for basic document deletions.
Object.entries(DOCUMENT_DELETES).forEach(([action, collection]) => {
  DISPATCH[action] = async (body) => {
    const { deleteDocument } = await writes();
    return ok(await deleteDocument({ collection, id: body.id }));
  };
});

// Generate handlers for audience-filtered document saves.
Object.entries(AUDIENCE_SAVES).forEach(([action, { collection, rankAndAbove, liveUntilFrom }]) => {
  DISPATCH[action] = async (body, uid) => {
    const { saveAudienceDocument } = await writes();
    return ok(
      await saveAudienceDocument({ collection, id: body.id, body, rankAndAbove, authorId: uid, liveUntilFrom })
    );
  };
});

// Generate handlers for certification changes that refresh badge icons.
Object.entries(BADGE_REFRESHING_SAVES).forEach(([action, { collection, kind }]) => {
  DISPATCH[action] = async (body) => {
    const { saveDocument, deleteDocument, refreshCertificationBadges } = await writes();
    let targetUserId = '';
    if (collection === 'certifications') {
      if (kind === 'delete') {
        targetUserId = String(body.user_id || '').trim();
        if (!targetUserId && body.id) {
          const { doc, getDoc } = await import('firebase/firestore');
          const { firestore } = await import('./firebase.js');
          const snap = await getDoc(doc(firestore(), 'certifications', String(body.id)));
          if (snap.exists()) targetUserId = String(snap.data()?.user_id || '').trim();
        }
      } else {
        targetUserId = String(body.user_id || '').trim();
      }
    }
    if (kind === 'delete') await deleteDocument({ collection, id: body.id });
    else await saveDocument({ collection, id: body.id, body });
    return ok({
      id: String(body.id || ''),
      badges: targetUserId
        ? await refreshCertificationBadges(targetUserId)
        : await refreshCertificationBadges(),
    });
  };
});

// Executes a routed write request and returns the result.
export const routeWrite = async (action, body = {}) => {
  const blocker = await routingBlocker(action);
  if (blocker) {
    console.warn(
      `[firestore] ${action} was NOT routed (${blocker}), and there is no sheet behind it any more - so this write fails.` +
        (blocker === 'feature-off'
          ? ' VITE_FIRESTORE_FEATURES pins a list of routes when it is set; this one is not in it.'
          : '')
    );
    return null;
  }

  const { firebaseAuth } = await import('./firebase.js');
  const uid = firebaseAuth().currentUser.uid;
  try {
    return await DISPATCH[action](body, uid);
  } catch (error) {
    console.error(`[firestore] ${action} write failed:`, error);
    return failureFor(error);
  }
};
