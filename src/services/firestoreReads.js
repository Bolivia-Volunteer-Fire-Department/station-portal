// Functions to read smaller pieces of data from Firestore after sign-in.
import { collection, doc, endBefore, getCountFromServer, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { activeAudienceRows, audienceKeysFor, audienceRows, memberAvailabilityFor, offersForMember, pendingOffers, readUsersOnce, rowsFor, rowsInRange, rowsOf, scheduleSetupFor, settingRows } from './firestorePayload.js';
import { firebaseFunctions, firestore } from './firebase.js';
import { nextDateKey, toDateKey, stationTodayKey } from '../utils/scheduleDate.js';
import { CHAT_PAGE_SIZE, isChatThread } from '../utils/chat.js';
import { certificationAlertsFor, decorateCertifications } from '../utils/certifications.js';
import { mergeRowsById } from '../utils/savedRow.js';
import { claimRowsFromMonths, monthKeysBetween } from '../utils/availability.js';
import { assessmentScoreId, documentRequiresVerification, isAssessment as isAssessmentDocument } from '../utils/documents.js';
import { pendingDocumentVerificationsSummary } from '../utils/checklists.js';
import { roleAllowsTab } from '../utils/permissions.js';
import { MAP_LAYER_COLLECTION, MAP_LAYER_DOC_ID } from '../utils/mapLayer.js';
import {
  MAP_BOUNDARY_COLLECTION,
  MAP_BOUNDARY_DOC_ID,
  MAP_BACKDROP_COLLECTION,
  MAP_BACKDROP_LAYERS,
  MAP_LANDMARK_COLLECTION,
  MAP_LANDMARK_LIMIT,
} from '../utils/districtMap.js';
import { MAP_TYPES_COLLECTION, MAP_TYPES_DOC_ID } from '../utils/mapTypes.js';
import { PRE_INCIDENT_PLANS_COLLECTION, HYDRANTS_COLLECTION } from '../utils/preIncidentPlans.js';

// Reads who is currently on duty directly from the server.
const onDutyRows = async (_uid) => {
  const [duty, users] = await Promise.all([
    rowsOf(collection(firestore(), 'on_duty'), { source: 'server' }),
    readUsersOnce(),
  ]);
  const byId = Object.fromEntries(users.map((user) => [user.id, user]));
  const rankFor = (id) => {
    const member = byId[id] || {};
    return member.rank_id ?? '';
  };
  return duty.map((row) => ({
    ...row,
    name: (byId[row.id] || {}).name || '',
    rank_id: rankFor(row.id),
    user_id: row.id,
  }));
};

// Finds the audience keys (role, rank, etc.) for the current user.
const keysFor = async (uid) => {
  const me = (await getDoc(doc(firestore(), 'users', uid))).data() || {};
  return audienceKeysFor({ userId: uid, roleId: String(me.role_id || ''), rankId: String(me.rank_id || '') });
};

// Checks if the user has permission to manage everyone's clock logs.
const managesWholeTimeclock = async (uid) => {
  if (!uid) return false;
  const me = (await getDoc(doc(firestore(), 'users', uid))).data() || {};
  const roleId = String(me.role_id || '');
  if (!roleId) return false;
  let role = null;
  try {
    role = (await getDoc(doc(firestore(), 'roles', roleId))).data() || null;
  } catch {
    // If the role cannot be read, default to no access for safety.
    return false;
  }
  return roleAllowsTab(role, 'clock');
};

// Checks if an officer has permission to view all documents.
const mayReadWholeDocuments = async (uid) => {
  if (!uid) return false;
  const me = (await getDoc(doc(firestore(), 'users', uid))).data() || {};
  const roleId = String(me.role_id || '');
  if (!roleId) return false;
  let role = null;
  try {
    role = (await getDoc(doc(firestore(), 'roles', roleId))).data() || null;
  } catch {
    return false;
  }
  return roleAllowsTab(role, 'documents');
};

// Checks whether a document is published and active today.
const documentIsLive = (document, today) => {
  const row = document || {};
  if (row.is_published !== true && String(row.is_published || '').trim().toUpperCase() !== 'TRUE') return false;
  const from = String(row.effective_date || '').trim();
  const to = String(row.end_date || '').trim();
  if (from && today < from) return false;
  if (to && today > to) return false;
  return true;
};

// Loads checklist items for a document, sorted in order.
const checklistItemRows = async (documentId, audienceKeys = null) => {
  const wanted = String(documentId || '').trim();
  if (!wanted) return [];

  const items = Array.isArray(audienceKeys) && audienceKeys.length
    ? await rowsOf(query(
        collection(firestore(), 'document_checklist_items'),
        where('document_id', '==', wanted),
        where('audience_keys', 'array-contains-any', audienceKeys)
      ))
    : await rowsFor('document_checklist_items', 'document_id', wanted);
  return items
    .map((item) => ({
      id: String(item.id || '').trim(),
      document_id: String(item.document_id || '').trim(),
      sort_order: parseInt(item.sort_order, 10) || 0,
      section: String(item.section || '').trim(),
      label: String(item.label || '').trim(),
    }))
    .filter((item) => item.id !== '' && item.label !== '')
    .sort((a, b) => a.sort_order - b.sort_order || (a.label.toLowerCase() < b.label.toLowerCase() ? -1 : 1));
};

// Reads a single member's score on an assessment.
const assessmentScoreRow = async (documentId, userId) => {
  const wantedDocument = String(documentId || '').trim();
  const wantedMember = String(userId || '').trim();
  if (!wantedDocument || !wantedMember) return null;

  let snapshot = null;
  try {
    snapshot = await getDoc(
      doc(firestore(), 'document_assessment_scores', assessmentScoreId(wantedDocument, wantedMember))
    );
  } catch {
    return null;
  }
  if (!snapshot.exists()) return null;
  return { ...snapshot.data(), id: snapshot.id };
};

// Counts total items in a checklist and how many a member has completed.
const documentItemSummaries = async (userId, audienceKeys = null) => {
  const wantedUser = String(userId || '').trim();
  const items = Array.isArray(audienceKeys) && audienceKeys.length
    ? await rowsOf(query(
        collection(firestore(), 'document_checklist_items'),
        where('audience_keys', 'array-contains-any', audienceKeys)
      ))
    : await rowsOf(collection(firestore(), 'document_checklist_items'));
  const summaries = {};

  items.forEach((item) => {
    const documentId = String(item.document_id || '').trim();
    if (!documentId || !String(item.id || '').trim()) return;
    if (!summaries[documentId]) summaries[documentId] = { item_count: 0, items_signed: 0 };
    summaries[documentId].item_count += 1;
  });

  if (wantedUser) {
    const signatures = await rowsFor('document_signatures', 'user_id', wantedUser);
    signatures.forEach((signature) => {
      if (String(signature.signature_role || '') !== 'member') return;
      // Only count signatures for specific checklist items.
      if (String(signature.checklist_item_id || '') === '') return;
      const documentId = String(signature.document_id || '').trim();
      if (!summaries[documentId]) return;
      summaries[documentId].items_signed += 1;
    });
  }

  return summaries;
};

// Attaches checklist item counts to document rows.
const withItemSummaries = (rows, summaries) =>
  rows.map((row) => {
    const summary = String(row.doc_type || '').trim().toLowerCase() === 'checklist' ? summaries[row.id] : null;
    return { ...row, item_count: summary ? summary.item_count : 0, items_signed: summary ? summary.items_signed : 0 };
  });

// Sorts documents by folder first, then sort order, then title.
const documentSort = (a, b) => {
  const aFolder = String(a.folder || '');
  const bFolder = String(b.folder || '');
  if (aFolder !== bFolder) {
    if (!aFolder) return 1;
    if (!bFolder) return -1;
    return aFolder.toLowerCase() < bFolder.toLowerCase() ? -1 : 1;
  }
  const aOrder = parseInt(a.sort_order, 10) || 0;
  const bOrder = parseInt(b.sort_order, 10) || 0;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return String(a.title || '').toLowerCase() < String(b.title || '').toLowerCase() ? -1 : 1;
};

// Loads complete document details including its checklist items.
const documentFullRow = async (row, audienceKeys = null) => {
  const source = row || {};
  const content = String(source.content ?? '');
  return {
    ...source,
    content,
    content_length: content.length,
    items: String(source.doc_type || '').trim().toLowerCase() === 'checklist'
      ? await checklistItemRows(source.id, audienceKeys)
      : [],
  };
};

// Finds the user's signature for a specific document.
const documentSignatureFor = (signatures, documentId, userId) => {
  const wantedDocument = String(documentId || '').trim();
  const wantedUser = String(userId || '').trim();
  return (
    signatures.find(
      (signature) =>
        String(signature.document_id || '').trim() === wantedDocument &&
        String(signature.user_id || '').trim() === wantedUser &&
        String(signature.checklist_item_id || '') === '' &&
        String(signature.signature_role || '') === 'member'
    ) || null
  );
};

// Checks if the document was updated after the user signed it.
const signatureIsStale = (signature, document) => {
  const signedAt = parseInt(signature && signature.content_revision, 10);
  const current = parseInt(document && document.content_revision, 10);
  if (!Number.isFinite(signedAt) || !Number.isFinite(current)) return false;
  return signedAt < current;
};

// Reads a document only if the user has permission to view it.
export const visibleDocumentFor = async (uid, id) => {
  const wanted = String(id || '').trim();
  if (!wanted) return null;

  let document = null;
  try {
    const snapshot = await getDoc(doc(firestore(), 'documents', wanted));
    if (snapshot.exists()) document = { ...snapshot.data(), id: snapshot.id };
  } catch {
    return null;
  }
  if (!document) return null;

  const mine = await keysFor(uid);
  const audience = Array.isArray(document.audience_keys) ? document.audience_keys : [];
  if (!audience.some((key) => mine.includes(String(key)))) return null;
  if (!documentIsLive(document, stationTodayKey())) return null;
  return document;
};

// Maximum number of players to show on the game leaderboard.
const RUNNER_LEADERBOARD_LIMIT = 25;

// Reads certification scans uploaded for a specific member.
export const certificationFilesForMember = async (uid) => ({
  files: await rowsFor('certification_files', 'user_id', String(uid || '').trim()),
});

// Reads certification scans attached to a specific certification record.
export const certificationFilesForRecord = async (recordId) => {
  const wanted = String(recordId || '').trim();
  if (!wanted) return { files: [] };
  return { files: await rowsFor('certification_files', 'certification_id', wanted) };
};

// Gets audience keys for chat rooms the member can see.
const chatKeysFor = async (uid) => {
  const users = await readUsersOnce();
  const me = users.find((row) => String(row.id) === String(uid)) || {};
  return audienceKeysFor({
    userId: uid,
    roleId: String(me.role_id || ''),
    rankId: String(me.rank_id || ''),
  });
};

// Finds all chat rooms the member has permission to view.
const chatRoomsFor = async (uid) => {
  const keys = await chatKeysFor(uid);
  if (!keys.length) return [];
  const rows = await getDocs(
    query(collection(firestore(), 'chat_conversations'), where('audience_keys', 'array-contains-any', keys))
  );
  return rows.docs.map((row) => ({ ...row.data(), id: row.id }));
};

// Finds all chat channels for an administrator (excluding private 1-on-1 threads).
const allChatRooms = async () => {
  const rows = await getDocs(collection(firestore(), 'chat_conversations'));
  return rows.docs.map((row) => ({ ...row.data(), id: row.id })).filter((room) => !isChatThread(room));
};

// Reads all verifiable documents, items, and signatures to calculate pending verifications.
export const readPendingDocumentVerifications = async (verifierUserId, verifiableDocs = null) => {
  const db = firestore();
  let docs = verifiableDocs;
  if (!Array.isArray(docs) || docs.length === 0) {
    const all = await rowsOf(collection(db, 'documents'));
    docs = all.filter(
      (row) => String(row.doc_type || '').toLowerCase() === 'checklist' || documentRequiresVerification(row)
    );
  }
  if (!docs.length) return { count: 0, byDocument: {} };

  const [items, signatures] = await Promise.all([
    rowsOf(collection(db, 'document_checklist_items')),
    rowsOf(collection(db, 'document_signatures')),
  ]);

  return pendingDocumentVerificationsSummary({
    documents: docs,
    items,
    signatures,
    verifierUserId,
  });
};

export const READERS = {
  GET_ON_DUTY: (uid) => onDutyRows(uid).then((onDuty) => ({ onDuty })),
  // Reads the chat rooms this user is allowed to join.
  GET_CHAT_ROOMS: async (uid) => ({ chatRooms: await chatRoomsFor(uid) }),
  // Loads older messages in a chat conversation for scrolling backwards.
  GET_CHAT_MESSAGES: async (_uid, body) => {
    const conversationId = String((body && body.conversationId) || '').trim();
    const before = body && body.before;
    if (!conversationId || !before) return { messages: [] };
    const rows = await getDocs(
      query(
        collection(firestore(), 'chat_conversations', conversationId, 'messages'),
        orderBy('created_at', 'desc'),
        endBefore(before),
        limit(CHAT_PAGE_SIZE)
      )
    );
    return { messages: rows.docs.map((row) => ({ ...row.data(), id: row.id })) };
  },
  // Allows an admin to view all chat rooms.
  ADMIN_GET_CHAT_ROOMS: async () => ({ chatRooms: await allChatRooms() }),
  GET_MY_CERTIFICATION_FILES: (uid) => certificationFilesForMember(uid),
  ADMIN_GET_CERTIFICATION_FILES: (_uid, body) => certificationFilesForRecord(body && body.recordId),
  // Reads timeclock logs for the current member or all members if the user is an officer.
  GET_TIMECLOCK_LOGS: async (uid, body) => {
    const from = String((body && body.from) || '').trim();
    const to = String((body && body.to) || '').trim();

    const managesAll = await managesWholeTimeclock(uid);

    if (!from && !to) {
      return managesAll
        ? { logs: await rowsOf(collection(firestore(), 'timeclock')) }
        : { logs: await rowsFor('timeclock', 'user_id', uid) };
    }

    // Query timeclock entries within the specified date range.
    const logs = await rowsOf(
      query(
        collection(firestore(), 'timeclock'),
        ...(managesAll ? [] : [where('user_id', '==', uid)]),
        where('time_in', '>=', from || '0000-01-01'),
        where('time_in', '<', to ? nextDateKey(to) : '9999-12-31'),
        orderBy('time_in', 'desc')
      )
    );
    return { logs, logs_window: { from, to } };
  },
  // Reads the member roster and badge icons.
  GET_ROSTER: async () => {
    const [rosterRows, badgeRows] = await Promise.all([
      readUsersOnce(),
      rowsOf(collection(firestore(), 'certification_badges')),
    ]);
    return {
      roster: rosterRows.map((user) => ({ id: user.id, name: user.name, rank_id: user.rank_id })),
      certificationBadges: Object.fromEntries(badgeRows.map((row) => [String(row.user_id), row.badges || []])),
    };
  },
  // Reads one page of members for the roster directory.
  GET_ROSTER_MODULE: async (uid, body) => {
    const answer = await httpsCallable(firebaseFunctions(), 'readRosterModule')({
      page_size: (body && body.page_size) || '',
      search: (body && body.search) || '',
      cursor: (body && body.cursor) || '',
    });
    return answer.data || {};
  },
  // Reads schedule shifts and position templates.
  GET_SCHEDULE_SETUP: async () => scheduleSetupFor(),
  // Reads scheduled shifts, optionally bounded by a date range.
  GET_SCHEDULE: async (uid, body) => {
    const from = String((body && body.from) || '').trim();
    const to = String((body && body.to) || '').trim();
    const schedule =
      from || to
        ? await rowsInRange('schedule', 'date_from', from, to, { source: 'server' })
        : await rowsOf(collection(firestore(), 'schedule'), { source: 'server' });
    return { schedule, schedule_window: { from, to } };
  },
  // Reads available shift templates.
  GET_AVAILABILITY_WINDOWS: async () => ({
    availabilityWindows: await rowsOf(collection(firestore(), 'availability_windows')),
  }),
  // Reads the member's submitted shift availability.
  GET_AVAILABILITY: async (uid, body) => {
    const from = String((body && body.from) || '').trim();
    const to = String((body && body.to) || '').trim();
    if (!from && !to) {
      return { availability: claimRowsFromMonths(await rowsFor('availability_months', 'user_id', uid)) };
    }
    return {
      availability: await memberAvailabilityFor(uid, monthKeysBetween(from, to)),
      availability_window: { from, to },
    };
  },
  // Reads all members' availability for schedule planning.
  ADMIN_GET_AVAILABILITY: async (uid, body) => {
    const from = String((body && body.from) || '').trim();
    const to = String((body && body.to) || '').trim();
    if (!from && !to) {
      return { availability: claimRowsFromMonths(await rowsOf(collection(firestore(), 'availability_months'))) };
    }
    const months = monthKeysBetween(from, to);
    const docs = months.length
      ? await rowsOf(query(collection(firestore(), 'availability_months'), where('month', 'in', months)))
      : [];
    return { availability: claimRowsFromMonths(docs), availability_window: { from, to } };
  },
  // Reads shift coverage offers for this member.
  GET_SHIFT_OFFERS: (uid) => offersForMember(uid).then((offers) => ({ offers })),
  // Reads training topics and the member's signatures.
  GET_TRAINING: async (uid) => {
    const [trainings, signatures] = await Promise.all([
      rowsOf(collection(firestore(), 'trainings')),
      rowsFor('training_signatures', 'user_id', uid),
    ]);
    return { trainings, signatures };
  },
  // Reads certifications for this member with expiration alerts.
  GET_CERTIFICATIONS: async (uid) => {
    const [certifications, setup] = await Promise.all([
      rowsFor('certifications', 'user_id', uid),
      rowsOf(collection(firestore(), 'certification_setup')),
    ]);
    const decorated = decorateCertifications(certifications, setup, stationTodayKey());
    return { certifications: decorated, certificationAlerts: certificationAlertsFor(decorated) };
  },
  // Reads active station announcements for this member.
  MY_ANNOUNCEMENTS: async (uid) => ({
    announcements: await activeAudienceRows('announcements', await keysFor(uid), { liveUntilField: 'live_until' }),
  }),
  // Reads events for this member.
  GET_EVENTS: async (uid) => ({ events: await audienceRows('events', await keysFor(uid)) }),
  // Reads push notification devices registered for this member.
  MY_PUSH_DEVICES: async (uid, body) => {
    const [devices, settings] = await Promise.all([
      rowsFor('push_devices', 'user_id', uid),
      getDoc(doc(firestore(), 'user_settings', uid)),
    ]);

    const pushDisabled = settings.exists() && (settings.data() || {}).is_push_disabled === true;

    const deviceToken = String((body && body.device_token) || '').trim();
    if (!deviceToken) return { devices, push_disabled: pushDisabled, device_owner: null };

    const answer = await httpsCallable(firebaseFunctions(), 'pushDeviceOwner')({ token: deviceToken });
    return {
      devices,
      push_disabled: pushDisabled,
      device_owner: (answer.data && answer.data.device_owner) || null,
    };
  },
  // Reads recurring shift windows for schedule planning.
  ADMIN_GET_AVAILABILITY_WINDOWS: async () => ({
    availabilityWindows: await rowsOf(collection(firestore(), 'availability_windows')),
  }),
  // Reads announcements for administrators.
  ADMIN_GET_ANNOUNCEMENTS: async (uid, body) => {
    const from = String((body && body.from) || '').trim();
    if (!from) return { announcements: await rowsOf(collection(firestore(), 'announcements')) };

    const [recent, live] = await Promise.all([
      rowsInRange('announcements', 'effective_date', from, ''),
      rowsInRange('announcements', 'live_until', toDateKey(new Date()), ''),
    ]);
    return { announcements: mergeRowsById(recent, live), announcements_window: { from } };
  },
  // Reads all events for administrators.
  ADMIN_GET_EVENTS: () => rowsOf(collection(firestore(), 'events')).then((events) => ({ events })),
  // Reads all documents with checklist completion counts for administrators.
  ADMIN_GET_DOCUMENTS: async () => {
    const documents = await rowsOf(collection(firestore(), 'documents'));
    return { documents: withItemSummaries(documents, await documentItemSummaries('')).sort(documentSort) };
  },
  // Reads documents and signature statuses for the signed-in member.
  GET_DOCUMENTS: async (uid) => {
    const audienceKeys = await keysFor(uid);
    const [visible, signatures, summaries] = await Promise.all([
      audienceRows('documents', audienceKeys),
      rowsFor('document_signatures', 'user_id', uid),
      documentItemSummaries(uid, audienceKeys),
    ]);
    const today = stationTodayKey();
    const live = visible.filter((document) => documentIsLive(document, today));
    return { documents: withItemSummaries(live, summaries).sort(documentSort), signatures };
  },
  // Reads full document content, checklist items, and signatures.
  GET_DOCUMENT: async (uid, body) => {
    const wanted = String((body && body.id) || '').trim();
    const document = await visibleDocumentFor(uid, wanted);
    if (!document) return { success: false, message: 'That document is not available.' };

    const signature = documentSignatureFor(await rowsFor('document_signatures', 'user_id', uid), wanted, uid);
    return {
      success: true,
      document: await documentFullRow(document, document.audience_keys),
      signature,
      signature_stale: signatureIsStale(signature, document),
      assessment_score: isAssessmentDocument(document) ? await assessmentScoreRow(wanted, uid) : null,
    };
  },
  // Reads complete document details for editing by administrators.
  ADMIN_GET_DOCUMENT: async (uid, body) => {
    const wanted = String((body && body.id) || '').trim();
    if (!wanted) return { success: false, message: 'Which document?' };
    const snapshot = await getDoc(doc(firestore(), 'documents', wanted));
    if (!snapshot.exists()) return { success: false, message: 'That document is not available.' };
    return { success: true, document: await documentFullRow({ ...snapshot.data(), id: snapshot.id }) };
  },
  // Reads pending document and checklist verifications count and per-document breakdown.
  ADMIN_GET_DOCUMENT_VERIFICATION_COUNT: async (uid, body) => {
    return readPendingDocumentVerifications(uid, body?.verifiableDocs);
  },
  // Reads document and signature history for a specific member to verify them.
  GET_MEMBER_DOCUMENT_RECORDS: async (uid, body) => {
    const memberId = String((body && body.user_id) || '').trim();
    if (!memberId) return { success: false, message: 'Which member?' };

    const member = await getDoc(doc(firestore(), 'users', memberId));
    if (!member.exists()) return { success: false, message: 'That member no longer exists.' };

    const wholeCollection = await mayReadWholeDocuments(uid);
    const [visible, signatures, summaries] = await Promise.all([
      wholeCollection ? rowsOf(collection(firestore(), 'documents')) : audienceRows('documents', audienceKeysFor({
        userId: memberId,
        roleId: String((member.data() || {}).role_id || ''),
        rankId: String((member.data() || {}).rank_id || ''),
      })),
      rowsFor('document_signatures', 'user_id', memberId),
      documentItemSummaries(memberId),
    ]);
    const today = stationTodayKey();
    const live = visible.filter((document) => documentIsLive(document, today));
    return { documents: withItemSummaries(live, summaries).sort(documentSort), signatures };
  },
  // Reads a member's test score on an assessment.
  GET_MEMBER_ASSESSMENT_SCORE: async (uid, body) => {
    const documentId = String((body && body.document_id) || body && body.id || '').trim();
    const memberId = String((body && body.user_id) || '').trim();
    if (!documentId) return { success: false, message: 'Which assessment?' };
    if (!memberId) return { success: false, message: 'Which member?' };

    const snapshot = await getDoc(doc(firestore(), 'documents', documentId));
    if (!snapshot.exists()) return { success: false, message: 'That document is not available.' };
    if (!isAssessmentDocument({ ...snapshot.data(), id: snapshot.id })) {
      return { success: false, message: 'That document is not an assessment.' };
    }

    return { success: true, score: await assessmentScoreRow(documentId, memberId) };
  },
  // Reads certification badges for specific members.
  GET_CERTIFICATION_BADGES: async (uid, body) => {
    const wanted = Array.isArray(body && body.user_ids) ? body.user_ids : [];
    const ids = [...new Set(wanted.map((id) => String(id || '').trim()).filter(Boolean))];
    if (!ids.length) return { badges: {}, asked: [] };

    const snapshots = await Promise.all(
      ids.map((id) => getDoc(doc(firestore(), 'certification_badges', id)).then((snap) => [id, snap]))
    );
    const badges = Object.fromEntries(
      snapshots
        .filter(([, snap]) => snap.exists())
        .map(([id, snap]) => [id, (snap.data() || {}).badges || []])
    );
    return { badges, asked: ids };
  },
  // Reads checklist items and signatures for a specific document.
  GET_DOCUMENT_SIGNATURES: async (uid, body) => {
    const documentId = String((body && body.id) || '').trim();
    if (!documentId) return { items: [], signatures: [] };

    const [items, signatures, document] = await Promise.all([
      rowsFor('document_checklist_items', 'document_id', documentId),
      rowsFor('document_signatures', 'document_id', documentId),
      getDoc(doc(firestore(), 'documents', documentId)),
    ]);

    const revision = (row) => {
      const value = parseInt(row && row.content_revision, 10);
      return Number.isFinite(value) ? value : null;
    };
    const currentRevision = revision(document.exists() ? document.data() : null);

    return {
      items: items
        .map((item) => ({
          id: String(item.id || ''),
          document_id: String(item.document_id || ''),
          sort_order: parseInt(item.sort_order, 10) || 0,
          section: String(item.section || ''),
          label: String(item.label || ''),
        }))
        .sort((a, b) => a.sort_order - b.sort_order || (a.id < b.id ? -1 : 1)),
      signatures: signatures
        .map((signature) => ({
          ...signature,
          stale:
            currentRevision !== null &&
            revision(signature) !== null &&
            revision(signature) < currentRevision,
        }))
        .sort((a, b) => {
          const aAt = String(a.signed_at || '');
          const bAt = String(b.signed_at || '');
          if (aAt !== bAt) return aAt < bAt ? 1 : -1;
          return String(a.id || '') < String(b.id || '') ? -1 : 1;
        }),
    };
  },
  // Reads shift coverage requests awaiting officer approval.
  ADMIN_GET_SCHEDULE_OFFERS: async () => ({ offers: await pendingOffers(firestore()) }),
  // Reads push notification statuses and device counts for all members.
  ADMIN_GET_PUSH_STATUS: async () => {
    const [users, settings, devices] = await Promise.all([
      readUsersOnce(),
      rowsOf(collection(firestore(), 'user_settings')),
      rowsOf(collection(firestore(), 'push_devices')),
    ]);

    const settingsById = new Map(settings.map((row) => [String(row.id || ''), row]));
    const counts = new Map();
    devices.forEach((device) => {
      const id = String(device.user_id || '');
      if (id) counts.set(id, (counts.get(id) || 0) + 1);
    });

    return {
      users: users.map((user) => {
        const id = String(user.id || '');
        const prefs = settingsById.get(id) || {};
        const count = counts.get(id) || 0;
        return {
          ...user,
          ...prefs,
          id,
          device_count: count,
          device_registered: count > 0,
          push_disabled: prefs.is_push_disabled === true,
        };
      }),
    };
  },
  // Reads high scores for the firefighter mini-game.
  GET_RUNNER_LEADERBOARD: async () => {
    const scored = () => query(collection(firestore(), 'users'), where('runner_score', '>', 0));
    const [rows, counted] = await Promise.all([
      getDocs(query(scored(), orderBy('runner_score', 'desc'), limit(RUNNER_LEADERBOARD_LIMIT))),
      getCountFromServer(scored()),
    ]);

    return {
      leaderboard: rows.docs.map((entry) => {
        const data = entry.data() || {};
        return { id: String(entry.id), name: String(data.name || '').trim(), score: Number(data.runner_score) || 0 };
      }),
      total: counted.data().count,
    };
  },
  // Checks if the cloud messaging service is operational.
  ADMIN_GET_FCM_STATUS: async () => {
    const answer = await httpsCallable(firebaseFunctions(), 'fcmStatus')({});
    return answer.data || {};
  },
  // Reads form templates this member is allowed to use.
  GET_FORM_TEMPLATES: async (uid) => ({
    forms: (await audienceRows('form_templates', await keysFor(uid))).filter((form) => form.enabled !== false),
  }),
  // Reads all form templates for administrative setup.
  ADMIN_GET_FORM_TEMPLATES: async () => ({
    forms: (await rowsOf(collection(firestore(), 'form_templates'))).sort((left, right) =>
      String(left.name || '').localeCompare(String(right.name || ''))
    ),
  }),
  // Reads submitted entered forms.
  GET_FORM_SUBMISSIONS: async (uid) => {
    let docs = [];
    try {
      const snapshot = await getDocs(collection(firestore(), 'form_submissions'));
      docs = snapshot.docs;
    } catch {
      try {
        const userQuery = query(
          collection(firestore(), 'form_submissions'),
          where('submitted_by_uid', '==', String(uid || ''))
        );
        const userSnap = await getDocs(userQuery);
        docs = userSnap.docs;
      } catch {
        docs = [];
      }
    }
    const submissions = docs
      .map((row) => ({ id: row.id, ...row.data() }))
      .sort((a, b) => String(b.submitted_at || '').localeCompare(String(a.submitted_at || '')));
    return { submissions };
  },
  // Reads a member's completed training records.
  GET_MEMBER_TRAINING: async (uid, body) => {
    const subject = String((body && body.userId) || '').trim() || uid;
    const [trainings, signatures] = await Promise.all([
      rowsOf(collection(firestore(), 'trainings')),
      rowsFor('training_signatures', 'user_id', subject),
    ]);
    return { trainings, signatures };
  },
  // Reads the drawing layer for the district map.
  GET_MAP_LAYER: async () => {
    const snapshot = await getDoc(doc(firestore(), MAP_LAYER_COLLECTION, MAP_LAYER_DOC_ID));
    return { mapLayer: snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null };
  },
  // Reads geographic district boundaries.
  GET_MAP_BOUNDARY: async () => {
    const snapshot = await getDoc(doc(firestore(), MAP_BOUNDARY_COLLECTION, MAP_BOUNDARY_DOC_ID));
    return { mapBoundary: snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null };
  },
  // Reads custom map pin icons and categories.
  GET_MAP_TYPES: async () => {
    const snapshot = await getDoc(doc(firestore(), MAP_TYPES_COLLECTION, MAP_TYPES_DOC_ID));
    return { mapTypes: snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null };
  },
  // Reads landmarks and hydrants placed on the district map.
  GET_MAP_LANDMARKS: async () => {
    const rows = await getDocs(query(collection(firestore(), MAP_LANDMARK_COLLECTION), limit(MAP_LANDMARK_LIMIT)));
    return { mapLandmarks: rows.docs.map((row) => ({ id: row.id, ...row.data() })) };
  },
  // Reads pre-incident plans for district map and documents module.
  GET_PRE_INCIDENT_PLANS: async () => {
    const rows = await getDocs(query(collection(firestore(), PRE_INCIDENT_PLANS_COLLECTION)));
    return { preIncidentPlans: rows.docs.map((row) => ({ id: row.id, ...row.data() })) };
  },
  // Reads district hydrants directory.
  GET_HYDRANTS: async () => {
    const rows = await getDocs(query(collection(firestore(), HYDRANTS_COLLECTION)));
    return { hydrants: rows.docs.map((row) => ({ id: row.id, ...row.data() })) };
  },
  // Reads background map visual layers.
  GET_MAP_BACKDROPS: async () => {
    const read = async (layer) => {
      const snapshot = await getDoc(doc(firestore(), MAP_BACKDROP_COLLECTION, layer));
      return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
    };
    const rows = await Promise.all(MAP_BACKDROP_LAYERS.map(read));
    return { backdrops: Object.fromEntries(MAP_BACKDROP_LAYERS.map((layer, index) => [layer, rows[index]])) };
  },
  // Reads public settings before user login.
  GET_INITIAL_DATA: async () => {
    const settings = await getDoc(doc(firestore(), 'settings', 'public'));
    return { systemSettings: settingRows(settings) };
  },
  // Reads equipment asset records.
  GET_EQUIPMENT: async () => {
    const snapshot = await getDocs(collection(firestore(), 'equipment'));
    return { equipment: snapshot.docs.map((row) => ({ id: row.id, ...row.data() })) };
  },
  // Reads apparatus asset records.
  GET_APPARATUS: async () => {
    const snapshot = await getDocs(collection(firestore(), 'apparatus'));
    return { apparatus: snapshot.docs.map((row) => ({ id: row.id, ...row.data() })) };
  },
  // Reads configured equipment and apparatus asset types.
  GET_ASSET_TYPES: async () => {
    const snapshot = await getDocs(collection(firestore(), 'asset_types'));
    return { assetTypes: snapshot.docs.map((row) => ({ id: row.id, ...row.data() })) };
  },
  // Reads work order requests.
  GET_WORK_ORDERS: async () => {
    const snapshot = await getDocs(collection(firestore(), 'work_orders'));
    return { workOrders: snapshot.docs.map((row) => ({ id: row.id, ...row.data() })) };
  },
};
