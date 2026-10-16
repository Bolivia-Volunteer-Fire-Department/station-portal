// Functions to write changes to Firestore collections.
// Where multiple related records must update together, we use transactions or batch writes.
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, query, runTransaction, setDoc, where, writeBatch } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { firebaseFunctions, firestore } from './firebase.js';
import { MEMBER_PRIVATE_ADMIN_FIELDS } from '../utils/memberFields.js';
import { AVATAR_URL_MAX } from '../utils/avatars.js';
import { rowsFor, rowsOf } from './firestorePayload.js';
import { badgeForRecord, badgeIndexFor, badgeToday } from '../utils/certificationBadges.js';
import { normalizeFormDefinition } from '../utils/formDefinition.js';
import { visibleDocumentFor } from './firestoreReads.js';
import { settingSide } from '../utils/systemSettings.js';
import { MAP_LAYER_COLLECTION, MAP_LAYER_DOC_ID, mapLayerFields, mapSvgProblem } from '../utils/mapLayer.js';
import { MAP_TYPES_COLLECTION, MAP_TYPES_DOC_ID, mapTypesDocument, mapTypesProblem } from '../utils/mapTypes.js';
import {
  MAP_BOUNDARY_COLLECTION,
  MAP_BOUNDARY_DOC_ID,
  MAP_BACKDROP_COLLECTION,
  MAP_BACKDROP_FIELDS,
  MAP_BACKDROP_LAYERS,
  MAP_LANDMARK_COLLECTION,
  backdropDocument,
  backdropProblem,
  boundaryDocument,
  boundaryProblem,
  landmarkFields,
  landmarkProblem,
} from '../utils/districtMap.js';
import {
  PRE_INCIDENT_PLANS_COLLECTION,
  HYDRANTS_COLLECTION,
  normalizeHydrant,
  preIncidentPlanFields,
  preIncidentPlanProblem,
} from '../utils/preIncidentPlans.js';
import { normalizeTraining, settingsRowsFrom, signatureWindowDays, trainingSignBlockedReason } from '../utils/training.js';
import { availabilityMonthId } from '../utils/availability.js';
import { parseSheetDateKey, stationTodayKey } from '../utils/scheduleDate.js';
import {
  WHOLE_DOCUMENT_ITEM,
  assessmentScoreId,
  assessmentScoreLimit as ASSESSMENT_SCORE_LIMIT,
  backfillSignaturePlan,
  documentRequiresVerification,
  documentVerificationState,
  isAssessment,
} from '../utils/documents.js';
import { deleteField } from 'firebase/firestore';

// Formats timestamps as 'YYYY-MM-DD HH:MM:SS' in station time (Eastern).
export const stationTimestamp = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const at = (type) => parts.find((part) => part.type === type).value;
  return `${at('year')}-${at('month')}-${at('day')} ${at('hour')}:${at('minute')}:${at('second')}`;
};

// Finds the currently open clock entry for a user, or returns null.
export const openClockEntryFor = async (userId) => {
  const open = await getDocs(
    query(collection(firestore(), 'timeclock'), where('user_id', '==', userId), where('time_out', '==', ''))
  );
  return open.docs[0] ? { id: open.docs[0].id, ...open.docs[0].data() } : null;
};

// Saves a member's claimed shift availability for an entire month in one document.
export const saveAvailabilityMonth = async ({ userId, month, claims = {} }) => {
  const id = availabilityMonthId(userId, month);
  await setDoc(doc(firestore(), 'availability_months', id), {
    user_id: String(userId),
    month: String(month),
    claims,
  });
  const claimed = Object.values(claims).reduce(
    (total, days) => total + (Array.isArray(days) ? days.length : 0),
    0
  );
  return { id, month, claimed };
};

// Submits an offer by a member to cover a shift slot.
export const makeOffer = async ({ userId, scheduleId, templateId, dateFrom, dateTo, assignmentId, slotKey }) => {
  const key = String(slotKey || '');
  if (key) {
    const declined = await rowsOf(
      query(
        collection(firestore(), 'schedule_offers'),
        where('user_id', '==', userId),
        where('slot_key', '==', key),
        where('status', '==', 'declined'),
        limit(1)
      )
    );
    if (declined.length > 0) {
      throw new Error('Your offer for this shift was declined, so you cannot offer for it again. Ask an officer to put you on it.');
    }
  }

  const created = doc(collection(firestore(), 'schedule_offers'));
  await setDoc(created, {
    user_id: userId,
    schedule_id: String(scheduleId || ''),
    schedule_template_id: String(templateId || ''),
    date_from: String(dateFrom || ''),
    date_to: String(dateTo || dateFrom || ''),
    assignment_id: String(assignmentId || ''),
    status: 'pending',
    slot_key: key,
  });
  return created.id;
};

// Withdraws an existing shift offer.
export const withdrawOffer = async (offerId) => {
  await deleteDoc(doc(firestore(), 'schedule_offers', String(offerId)));
};

// Approves a shift offer through a Cloud Function.
export const approveOffer = async ({ offerId }) => {
  const result = await httpsCallable(firebaseFunctions(), 'approveOffer')({ offerId: String(offerId) });
  return result.data;
};

// Declines a shift offer through a Cloud Function.
export const declineOffer = async ({ offerId }) => {
  const result = await httpsCallable(firebaseFunctions(), 'declineOffer')({ offerId: String(offerId) });
  return result.data;
};

// Saves all schedule changes and deletions from the schedule board in one transaction.
export const saveScheduleBoard = async ({ entries = [], deleteIds = [] }) => {
  const result = await httpsCallable(firebaseFunctions(), 'saveScheduleBoard')({ entries, deleteIds });
  return result.data;
};

// Strips envelope routing fields (like token and action) from the document payload.
const withoutEnvelope = (body = {}) => {
  const { action, token, row_version, id, ...fields } = body;
  void action;
  void token;
  void row_version;
  void id;
  return fields;
};

// Saves a single document to Firestore, creating an ID if one was not provided.
export const saveDocument = async ({ collection: collectionName, id, body, extra = {} }) => {
  const target = String(id || '').trim() || doc(collection(firestore(), collectionName)).id;
  const document = { ...withoutEnvelope(body), ...extra };

  await setDoc(doc(firestore(), collectionName, target), document, { merge: true });
  return { id: target };
};

// Expands target role, rank, or user into an array of audience keys.
export const audienceKeysForWrite = ({ roleId, rankId, userId, ranks = [], rankAndAbove = false }) => {
  const role = String(roleId || '').trim();
  const rank = String(rankId || '').trim();
  const member = String(userId || '').trim();
  const filled = [role, rank, member].filter(Boolean);

  if (filled.length > 1) throw new Error('That form targets more than one audience, which no single list can express.');
  if (!filled.length) return ['*'];
  if (role) return [`role:${role}`];
  if (member) return [`user:${member}`];
  if (!rankAndAbove) return [`rank:${rank}`];

  const orderOf = (id) => {
    const found = ranks.find((candidate) => String(candidate.id) === String(id));
    const order = parseInt(found?.rank_order, 10);
    return Number.isFinite(order) ? order : null;
  };
  const required = orderOf(rank);
  if (required === null) throw new Error('That rank does not exist, so nobody could be shown this.');
  return ranks
    .filter((candidate) => {
      const order = parseInt(candidate.rank_order, 10);
      return Number.isFinite(order) && order >= required;
    })
    .map((candidate) => `rank:${candidate.id}`);
};

// Far-future date key used for notices with no expiration date.
export const LIVE_UNTIL_OPEN = '9999-12-31';

// Saves a document with its target audience keys and expiration date attached.
export const saveAudienceDocument = async ({
  collection: name,
  id,
  body,
  rankAndAbove = false,
  authorId = '',
  liveUntilFrom = '',
}) => {
  const ranks = await rowsOf(collection(firestore(), 'ranks'));
  const audience_keys = audienceKeysForWrite({
    roleId: body.role_id,
    rankId: body.rank_id,
    userId: body.user_id,
    ranks,
    rankAndAbove,
  });
  const extra = { audience_keys };
  if (liveUntilFrom) extra.live_until = parseSheetDateKey(body?.[liveUntilFrom]) || LIVE_UNTIL_OPEN;
  if (authorId && !String(id || '').trim()) extra.author_user_id = authorId;
  const documentId = String(id || '').trim();
  if (name !== 'documents' || !documentId) return saveDocument({ collection: name, id, body, extra });

  const db = firestore();
  const parentRef = doc(db, 'documents', documentId);
  const current = await getDoc(parentRef);
  const currentKeys = current.exists() && Array.isArray(current.get('audience_keys'))
    ? current.get('audience_keys').slice().sort()
    : [];
  const nextKeys = audience_keys.slice().sort();
  if (JSON.stringify(currentKeys) === JSON.stringify(nextKeys)) {
    return saveDocument({ collection: name, id: documentId, body, extra });
  }

  const items = await rowsFor('document_checklist_items', 'document_id', documentId);
  if (items.length > 499) throw new Error('This checklist has too many items to change its audience safely.');
  const batch = writeBatch(db);
  batch.set(parentRef, { ...withoutEnvelope(body), ...extra }, { merge: true });
  items.forEach((item) => {
    batch.update(doc(db, 'document_checklist_items', item.id), { audience_keys });
  });
  await batch.commit();
  return { id: documentId };
};

// Unregisters a push device by token.
export const removePushDevice = async ({ token }) => {
  const wanted = String(token || '').trim();
  if (!wanted) return { removed: false };
  const found = await getDocs(query(collection(firestore(), 'push_devices'), where('token', '==', wanted)));
  await Promise.all(found.docs.map((row) => deleteDoc(row.ref)));
  return { removed: found.docs.length > 0 };
};

// Toggles whether push notifications are disabled for a member.
export const setPushDisabled = async ({ userId, disabled }) => {
  const target = String(userId || '').trim();
  if (!target) throw new Error('Which member?');

  const rows = await getDocs(query(collection(firestore(), 'push_devices'), where('user_id', '==', target)));
  if (disabled) await Promise.all(rows.docs.map((row) => deleteDoc(row.ref)));

  await setDoc(doc(firestore(), 'user_settings', target), { is_push_disabled: disabled === true }, { merge: true });
  return { userId: target, disabled: disabled === true, devicesForgotten: disabled ? rows.docs.length : 0 };
};

// Saves chat room details (name, audience, ordering).
export const saveChatRoom = async ({ id, name, audience_keys, sort_order, archived }) => {
  const fields = {
    name: String(name || '').trim(),
    audience_keys: (Array.isArray(audience_keys) ? audience_keys : []).map((key) => String(key || '').trim()).filter(Boolean),
    sort_order: Number.isFinite(Number(sort_order)) ? Number(sort_order) : 999,
    archived: archived === true,
  };
  if (!fields.name) throw new Error('A room needs a name.');
  if (!fields.audience_keys.length) throw new Error('A room needs somebody who can see it.');

  const target = String(id || '').trim();
  const ref = target ? doc(firestore(), 'chat_conversations', target) : doc(collection(firestore(), 'chat_conversations'));
  await setDoc(ref, fields, { merge: true });
  return { id: ref.id, ...fields, saved: true };
};

// Deletes a chat room.
export const deleteChatRoom = async (id) => {
  const target = String(id || '').trim();
  if (!target) throw new Error('Which room?');
  await deleteDoc(doc(firestore(), 'chat_conversations', target));
  return { id: target, deleted: true };
};

// Updates the user's unread position and read timestamp in a chat conversation.
export const setChatRead = async ({ userId, conversationId, readCount, muted, readAt }) => {
  const uid = String(userId || '').trim();
  const room = String(conversationId || '').trim();
  if (!uid || !room) throw new Error('Which room?');
  const fields = {};
  if (readCount !== undefined) fields.read_count = Math.max(0, Number(readCount) || 0);
  if (muted !== undefined) fields.muted = muted === true;

  if (Object.keys(fields).length) {
    await setDoc(doc(firestore(), 'chat_inbox', uid, 'rooms', room), fields, { merge: true });
  }

  if (readAt !== undefined) {
    await setDoc(
      doc(firestore(), 'chat_receipts', room),
      { read_at: { [uid]: Math.max(0, Number(readAt) || 0) } },
      { merge: true }
    );
  }

  return { userId: uid, id: room, ...fields };
};

// Recognized boolean flags in user settings.
const BOOLEAN_USER_SETTINGS = new Set([
  'is_dark_mode',
  'hide_events_by_default',
  'colorblind_rank_labels',
  'notify_new_offer',
  'notify_offer_approved',
  'notify_offer_declined',
  'notify_announcements',
]);

const IGNORED_USER_SETTINGS = new Set(['id', 'action', 'token', 'fcm_token']);

const memberSettingValue = (key, value) => {
  const raw = value === undefined || value === null ? '' : value;
  if (BOOLEAN_USER_SETTINGS.has(key)) {
    const text = String(raw).trim().toUpperCase();
    return text === 'TRUE' || text === 'YES' || text === '1';
  }
  return String(raw);
};

// Saves user preferences like theme and notifications.
export const saveMemberSettings = async ({ userId, fields }) => {
  const target = String(userId || '').trim();
  if (!target) throw new Error('Which member do these settings belong to?');

  const document = {};
  Object.entries(fields || {}).forEach(([key, value]) => {
    if (IGNORED_USER_SETTINGS.has(key)) return;
    if (value === undefined) return;
    document[key] = memberSettingValue(key, value);
  });

  if (!Object.keys(document).length) return { userId: target, changed: 0 };
  await setDoc(doc(firestore(), 'user_settings', target), document, { merge: true });
  return { userId: target, changed: Object.keys(document).length };
};

// Builds a signature record.
const signatureRow = ({ documentId, itemId, memberId, signerId, role, revision, at }) => ({
  document_id: documentId,
  checklist_item_id: itemId || '',
  user_id: memberId,
  signed_by_user_id: signerId,
  signature_role: role,
  signed_at: at,
  content_revision: revision,
});

// Reads the signatures for a specific member.
const ownSignatureRows = (memberId) => rowsFor('document_signatures', 'user_id', memberId);

// Records a member's signature on a standalone document.
export const signDocument = async ({ userId, documentId }) => {
  const document = await visibleDocumentFor(userId, documentId);
  if (!document) return { success: false, message: 'That document is not available.' };
  if (String(document.doc_type || '').trim().toLowerCase() === 'checklist') {
    return { success: false, message: 'A checklist is signed item by item. Check and save the items instead.' };
  }
  if (document.is_sign_required !== true && String(document.is_sign_required || '').trim().toUpperCase() !== 'TRUE') {
    return { success: false, message: 'That document does not need a signature.' };
  }

  const already = await rowsFor('document_signatures', 'user_id', userId);
  const existing = already.find((row) => row.document_id === documentId && !String(row.checklist_item_id || '').trim());
  if (existing) {
    const signatures = await ownSignatureRows(userId);
    return { success: true, signed: 0, already_signed: true, signature: existing, signatures };
  }

  const created = await addDoc(collection(firestore(), 'document_signatures'), signatureRow({
    documentId,
    memberId: userId,
    signerId: userId,
    role: 'member',
    revision: parseInt(document.content_revision, 10) || 0,
    at: stationTimestamp(),
  }));

  return {
    success: true,
    signed: 1,
    id: created.id,
    signature: { ...(await getDoc(created)).data(), id: created.id },
    signatures: await ownSignatureRows(userId),
  };
};

// Records signatures for checked items on a checklist.
export const signChecklistItems = async ({ userId, documentId, itemIds }) => {
  const document = await visibleDocumentFor(userId, documentId);
  if (!document || String(document.doc_type || '').trim().toLowerCase() !== 'checklist') {
    return { success: false, message: 'That checklist is not available to sign.' };
  }

  const wanted = [...new Set((Array.isArray(itemIds) ? itemIds : []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!wanted.length) return { success: false, message: 'No items were named.' };

  const items = document.audience_keys?.length
    ? await rowsOf(query(
        collection(firestore(), 'document_checklist_items'),
        where('document_id', '==', documentId),
        where('audience_keys', 'array-contains-any', document.audience_keys)
      ))
    : [];
  const owned = new Set(items.map((item) => item.id));

  const mine = await ownSignatureRows(userId);
  const signed = new Set(
    mine
      .filter((row) => row.document_id === documentId && String(row.checklist_item_id || '').trim())
      .map((row) => row.checklist_item_id)
  );

  const at = stationTimestamp();
  const revision = parseInt(document.content_revision, 10) || 0;
  const batch = writeBatch(firestore());
  let added = 0;
  let skipped = 0;

  wanted.forEach((itemId) => {
    if (!owned.has(itemId) || signed.has(itemId)) {
      skipped += 1;
      return;
    }
    batch.set(
      doc(collection(firestore(), 'document_signatures')),
      signatureRow({ documentId, itemId, memberId: userId, signerId: userId, role: 'member', revision, at })
    );
    added += 1;
  });

  if (added) await batch.commit();
  return { success: true, signed: added, skipped, signatures: await ownSignatureRows(userId) };
};

// Verifies a signed item on another member's checklist.
export const verifyChecklistItem = async ({ verifierId, documentId, itemId, memberId }) => {
  const member = String(memberId || '').trim();
  const item = String(itemId || '').trim();
  if (!member || !item || !documentId) return { success: false, message: 'Which item, for which member?' };
  if (member === verifierId) return { success: false, message: 'A verification is somebody else looking at it.' };

  const signatures = await rowsFor('document_signatures', 'document_id', documentId);
  const theirs = signatures.filter((row) => row.user_id === member && row.checklist_item_id === item);
  if (!theirs.some((row) => row.signature_role === 'member')) {
    return { success: false, message: 'That member has not signed that item.' };
  }
  if (theirs.some((row) => row.signature_role === 'verifier')) {
    return { success: true, verified: 0, already_verified: true, signatures };
  }

  const newRow = signatureRow({ documentId, itemId: item, memberId: member, signerId: verifierId, role: 'verifier', revision: 0, at: stationTimestamp() });
  const createdRef = await addDoc(
    collection(firestore(), 'document_signatures'),
    newRow
  );
  return { success: true, verified: 1, signatures: [...signatures, { ...newRow, id: createdRef.id }] };
};

// Confirms another member's signature on a whole document.
export const verifyDocumentSignature = async ({ verifierId, documentId, memberId }) => {
  const member = String(memberId || '').trim();
  const document = String(documentId || '').trim();
  if (!member || !document) return { success: false, message: 'Which member, on which document?' };
  if (member === verifierId) return { success: false, message: 'A verification is somebody else looking at it.' };

  const source = await getDoc(doc(firestore(), 'documents', document));
  if (!source.exists()) return { success: false, message: 'That document is not available.' };
  if (!documentRequiresVerification({ ...source.data(), id: source.id })) {
    return { success: false, message: 'That document does not ask for its signature to be confirmed.' };
  }

  const signatures = await rowsFor('document_signatures', 'document_id', document);
  const state = documentVerificationState(signatures, document, member);
  if (!state.signed) return { success: false, message: 'That member has not signed this document.' };
  if (state.verified) {
    return { success: true, verified: 0, already_verified: true, signatures };
  }

  const newRow = signatureRow({
    documentId: document,
    itemId: WHOLE_DOCUMENT_ITEM,
    memberId: member,
    signerId: verifierId,
    role: 'verifier',
    revision: 0,
    at: stationTimestamp(),
  });
  const createdRef = await addDoc(
    collection(firestore(), 'document_signatures'),
    newRow
  );
  return { success: true, verified: 1, signatures: [...signatures, { ...newRow, id: createdRef.id }] };
};

// Verifies all remaining unverified items on a member's checklist in one batch.
export const verifyChecklistRemaining = async ({ verifierId, documentId, memberId }) => {
  const member = String(memberId || '').trim();
  if (!member || !documentId) return { success: false, message: 'Which member?' };
  if (member === verifierId) return { success: false, message: 'A verification is somebody else looking at it.' };

  const signatures = await rowsFor('document_signatures', 'document_id', documentId);
  const verified = new Set(
    signatures.filter((row) => row.user_id === member && row.signature_role === 'verifier').map((row) => row.checklist_item_id)
  );
  const pending = signatures.filter(
    (row) => row.user_id === member && row.signature_role === 'member' && !verified.has(row.checklist_item_id)
  );
  if (!pending.length) return { success: true, verified: 0, already_verified: true, signatures };

  const at = stationTimestamp();
  const batch = writeBatch(firestore());
  const newRows = [];
  pending.forEach((row) => {
    const ref = doc(collection(firestore(), 'document_signatures'));
    const sig = signatureRow({ documentId, itemId: row.checklist_item_id, memberId: member, signerId: verifierId, role: 'verifier', revision: 0, at });
    batch.set(ref, sig);
    newRows.push({ ...sig, id: ref.id });
  });
  await batch.commit();
  return { success: true, verified: pending.length, signatures: [...signatures, ...newRows] };
};

// Records a score on an assessment for a member.
export const setDocumentAssessmentScore = async ({ scorerId, documentId, memberId, score, scoredOn }) => {
  const member = String(memberId || '').trim();
  const document = String(documentId || '').trim();
  const value = String(score === undefined || score === null ? '' : score).trim();
  const on = parseSheetDateKey(scoredOn);

  if (!member || !document) return { success: false, message: 'Which member, on which assessment?' };
  if (member === scorerId) {
    return { success: false, message: 'You cannot record your own score. Somebody else administers the assessment.' };
  }
  if (!value) return { success: false, message: 'Enter a score.' };
  if (value.length > ASSESSMENT_SCORE_LIMIT) {
    return { success: false, message: `That score is too long (the limit is ${ASSESSMENT_SCORE_LIMIT} characters).` };
  }
  if (!on) return { success: false, message: 'Enter the date the score was taken.' };

  const source = await getDoc(doc(firestore(), 'documents', document));
  if (!source.exists()) return { success: false, message: 'That document is not available.' };
  if (!isAssessment({ ...source.data(), id: source.id })) {
    return { success: false, message: 'That document is not an assessment.' };
  }

  const id = assessmentScoreId(document, member);
  await setDoc(
    doc(firestore(), 'document_assessment_scores', id),
    {
      document_id: document,
      user_id: member,
      score: value,
      scored_on: on,
      scored_by_user_id: String(scorerId || '').trim(),
      updated_at: stationTimestamp(),
    },
    { merge: true }
  );

  const saved = await getDoc(doc(firestore(), 'document_assessment_scores', id));
  return { success: true, saved: 1, score: { ...(saved.data() || {}), id: saved.id } };
};

const DOCUMENT_REORDER_LIMIT = 500;
const DOCUMENT_FOLDER_LIMIT = 80;
const BACKFILL_CHUNK = 200;

// Reads all existing signatures for a document directly from the server.
const signaturesForDocument = (document) =>
  rowsOf(query(collection(firestore(), 'document_signatures'), where('document_id', '==', document)), {
    source: 'server',
  });

// Back-fills paper training and checklist records for a member.
export const backfillDocumentSignatures = async ({
  recorderId,
  documentId,
  memberId,
  itemIds = [],
  recordedOn = '',
  note = '',
  confirmVerified = false,
}) => {
  const recorder = String(recorderId || '').trim();
  const member = String(memberId || '').trim();
  const document = String(documentId || '').trim();
  if (!document) return { success: false, message: 'Which document?' };
  if (!member) return { success: false, message: 'Which member is this for?' };
  if (!recorder) return { success: false, message: 'Nobody to attribute the record to.' };
  if (member === recorder) {
    return {
      success: false,
      message: 'A back-fill is somebody else recording what they found. Enter your own items from your own checklist.',
    };
  }

  const source = await getDoc(doc(firestore(), 'documents', document));
  if (!source.exists()) return { success: false, message: 'That document is not available.' };
  const row = { ...source.data(), id: source.id };
  const isChecklist = String(row.doc_type || '').trim().toLowerCase() === 'checklist';

  const items = isChecklist ? await rowsFor('document_checklist_items', 'document_id', document) : [];
  const existing = await signaturesForDocument(document);

  const onDay = String(recordedOn || '').trim();
  const at = /^\d{4}-\d{2}-\d{2}$/.test(onDay) ? onDay : stationTimestamp();

  const plan = backfillSignaturePlan({
    documentId: document,
    items,
    signatures: existing,
    memberId: member,
    recorderId: recorder,
    itemIds: isChecklist ? itemIds : [WHOLE_DOCUMENT_ITEM],
    at,
    revision: row.content_revision,
    note,
    confirmVerified,
  });

  if (plan.member.length === 0) {
    return {
      success: true,
      recorded: 0,
      verified: 0,
      already_on_file: true,
      message: 'Everything you ticked is already recorded for that member.',
      signatures: await signaturesForDocument(document),
    };
  }

  const everything = [...plan.member, ...plan.verifier];
  for (let start = 0; start < everything.length; start += BACKFILL_CHUNK) {
    const slice = everything.slice(start, start + BACKFILL_CHUNK);
    const batch = writeBatch(firestore());
    slice.forEach((entry) => {
      batch.set(doc(collection(firestore(), 'document_signatures')), entry);
    });
    await batch.commit();
  }

  return {
    success: true,
    recorded: plan.member.length,
    verified: plan.verifier.length,
    signatures: await signaturesForDocument(document),
  };
};

// Deletes a document signature.
export const removeDocumentSignature = async ({ id }) => {
  const wanted = String(id || '').trim();
  if (!wanted) throw new Error('Which signature?');
  await deleteDoc(doc(firestore(), 'document_signatures', wanted));
  return { removed: 1 };
};

// Renames a document folder across all documents in that folder.
export const renameDocumentFolder = async ({ from, to }) => {
  const name = String(from || '').trim();
  if (!name) throw new Error('No folder was named.');
  const replacement = String(to === undefined || to === null ? '' : to).trim().slice(0, DOCUMENT_FOLDER_LIMIT);
  if (name === replacement) return { renamed: 0 };

  const documents = await rowsOf(collection(firestore(), 'documents'));
  const inFolder = documents.filter((document) => String(document.folder || '').trim() === name);
  if (!inFolder.length) return { renamed: 0 };

  const batch = writeBatch(firestore());
  inFolder.forEach((document) => {
    batch.set(doc(firestore(), 'documents', document.id), { folder: replacement }, { merge: true });
  });
  await batch.commit();
  return { renamed: inFolder.length };
};

// Updates document sort orders from drag-and-drop.
export const reorderDocuments = async ({ order }) => {
  const pairs = Array.isArray(order) ? order : [];
  if (!pairs.length) throw new Error('No order was given.');
  if (pairs.length > DOCUMENT_REORDER_LIMIT) {
    throw new Error(`That is too many documents to reorder at once (${DOCUMENT_REORDER_LIMIT} at most).`);
  }

  const existing = new Set((await rowsOf(collection(firestore(), 'documents'))).map((document) => document.id));
  const batch = writeBatch(firestore());
  let moved = 0;

  pairs.forEach((pair) => {
    const id = String((pair && pair.id) || '').trim();
    const position = parseInt(pair && pair.sort_order, 10);
    if (!id || !existing.has(id) || !Number.isFinite(position)) return;
    batch.set(doc(firestore(), 'documents', id), { sort_order: position }, { merge: true });
    moved += 1;
  });

  if (moved) await batch.commit();
  return { moved };
};

// Records member signatures for completed training courses.
export const signTrainings = async ({ userId, trainingIds }) => {
  const wanted = [...new Set((Array.isArray(trainingIds) ? trainingIds : []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!wanted.length) return { success: false, message: 'No trainings were named.' };

  const trainings = await rowsOf(collection(firestore(), 'trainings'));
  const byId = new Map(trainings.map((training) => [training.id, training]));

  const settingsDoc = await getDoc(doc(firestore(), 'settings', 'public'));
  const windowDays = signatureWindowDays(settingsRowsFrom(settingsDoc.exists() ? settingsDoc.data() : {}));

  const blocked = [];
  wanted.forEach((id) => {
    const training = byId.get(id);
    if (!training) return;
    const reason = trainingSignBlockedReason(normalizeTraining(training), {
      todayKey: stationTodayKey(),
      windowDays,
    });
    if (reason) blocked.push({ id, reason });
  });
  if (blocked.length) {
    return {
      success: false,
      message: `Training ${blocked.map((entry) => entry.id).join(', ')} cannot be signed. ${blocked[0].reason}`,
    };
  }

  const mine = await rowsFor('training_signatures', 'user_id', userId);
  const signed = new Set(mine.map((row) => String(row.training_id || '').trim()));

  const at = stationTimestamp();
  const batch = writeBatch(firestore());
  let added = 0;
  let skipped = 0;
  const newSignatures = [];

  wanted.forEach((trainingId) => {
    if (!byId.has(trainingId)) {
      skipped += 1;
      return;
    }
    if (signed.has(trainingId)) return;
    const ref = doc(collection(firestore(), 'training_signatures'));
    const sig = { training_id: trainingId, user_id: userId, signed_at: at };
    batch.set(ref, sig);
    newSignatures.push({ ...sig, id: ref.id });
    added += 1;
  });

  if (added) await batch.commit();
  return { success: true, signed: added, skipped, signatures: [...mine, ...newSignatures] };
};

// Removes a training signature.
export const removeTrainingSignature = async ({ id }) => {
  const wanted = String(id || '').trim();
  if (!wanted) throw new Error('A signature id is required.');
  await deleteDoc(doc(firestore(), 'training_signatures', wanted));
  return { removed: 1 };
};

// Updates private personnel record fields for a member.
export const saveMemberPrivateFields = async ({ userId, fields = {} } = {}) => {
  const target = String(userId || '').trim();
  if (!target) throw new Error('Which member are these details for?');
  const entries = Object.entries(fields || {});
  if (!entries.length) throw new Error('There is nothing to save.');
  const unknown = entries.map(([key]) => key).filter((key) => !MEMBER_PRIVATE_ADMIN_FIELDS.includes(key));
  if (unknown.length) throw new Error(`Not a member detail: ${unknown.join(', ')}.`);
  const clean = Object.fromEntries(entries.map(([key, value]) => [key, String(value ?? '').trim()]));
  await setDoc(doc(firestore(), 'users_private', target), clean, { merge: true });
  return { userId: target, ...clean };
};

// Updates a member's profile avatar picture URL.
export const saveMemberAvatarUrl = async ({ userId, url = '' } = {}) => {
  const target = String(userId || '').trim();
  if (!target) throw new Error('Which member is this picture for?');
  const clean = String(url || '').trim();
  if (clean.length > AVATAR_URL_MAX) throw new Error('That picture link is too long to store.');
  await setDoc(doc(firestore(), 'users', target), { avatar_url: clean }, { merge: true });
  return { userId: target, avatar_url: clean };
};

// Saves or updates a form definition template.
export const saveFormTemplate = async ({ id, definition, authorId = '' } = {}) => {
  const normalized = normalizeFormDefinition(definition || {});
  const documentId = String(id || '').trim() || doc(collection(firestore(), 'form_templates')).id;
  const reference = doc(firestore(), 'form_templates', documentId);
  const previous = await getDoc(reference);
  const createdBy = previous.exists() ? String(previous.get('created_by') || '') : String(authorId || '');
  await setDoc(
    reference,
    {
      ...normalized,
      created_by: createdBy,
      created_at: previous.exists() ? String(previous.get('created_at') || '') || stationTimestamp() : stationTimestamp(),
      updated_at: stationTimestamp(),
      updated_by: String(authorId || ''),
    },
    { merge: true }
  );
  return { id: documentId };
};

// Deletes a form template.
export const deleteFormTemplate = async ({ id } = {}) => {
  const wanted = String(id || '').trim();
  if (!wanted) throw new Error('Which form?');
  await deleteDoc(doc(firestore(), 'form_templates', wanted));
  return { id: wanted };
};

// Saves the drawing layer SVG for the district map.
export const saveMapLayer = async ({ svg, authorId = '' } = {}) => {
  const text = String(svg ?? '');
  const problem = mapSvgProblem(text);
  if (problem) throw new Error(problem);

  const fields = mapLayerFields(text);
  const reference = doc(firestore(), MAP_LAYER_COLLECTION, MAP_LAYER_DOC_ID);
  const previous = await getDoc(reference);
  await setDoc(
    reference,
    {
      ...fields,
      created_at: previous.exists()
        ? String(previous.get('created_at') || '') || stationTimestamp()
        : stationTimestamp(),
      created_by: previous.exists() ? String(previous.get('created_by') || '') : String(authorId || ''),
      updated_at: stationTimestamp(),
      updated_by: String(authorId || ''),
    },
    { merge: true }
  );
  return { id: MAP_LAYER_DOC_ID };
};

// Deletes the drawing layer from the district map.
export const deleteMapLayer = async () => {
  await deleteDoc(doc(firestore(), MAP_LAYER_COLLECTION, MAP_LAYER_DOC_ID));
  return { id: MAP_LAYER_DOC_ID };
};

// Saves the district boundary polygon coordinates.
export const saveMapBoundary = async ({ geojson, meta = {}, authorId = '' } = {}) => {
  const problem = boundaryProblem(geojson);
  if (problem) throw new Error(problem);

  const fields = boundaryDocument(geojson, meta);
  const reference = doc(firestore(), MAP_BOUNDARY_COLLECTION, MAP_BOUNDARY_DOC_ID);
  await setDoc(
    reference,
    { ...fields, saved_by: String(authorId || ''), updated_at: stationTimestamp() },
    { merge: true }
  );
  return { id: MAP_BOUNDARY_DOC_ID, points: fields.points };
};

// Deletes the district boundary polygon.
export const deleteMapBoundary = async () => {
  await deleteDoc(doc(firestore(), MAP_BOUNDARY_COLLECTION, MAP_BOUNDARY_DOC_ID));
  return { id: MAP_BOUNDARY_DOC_ID };
};

// Saves a map landmark pin (hydrant, station, etc.).
export const saveMapLandmark = async ({ id = '', fields = {}, authorId = '' } = {}) => {
  const problem = landmarkProblem(fields);
  if (problem) throw new Error(problem);

  const normal = landmarkFields(fields);
  const reference = String(id || '').trim()
    ? doc(firestore(), MAP_LANDMARK_COLLECTION, String(id).trim())
    : doc(collection(firestore(), MAP_LANDMARK_COLLECTION));
  const previous = await getDoc(reference);
  await setDoc(
    reference,
    {
      ...normal,
      created_at: previous.exists()
        ? String(previous.get('created_at') || '') || stationTimestamp()
        : stationTimestamp(),
      created_by: previous.exists() ? String(previous.get('created_by') || '') : String(authorId || ''),
      updated_at: stationTimestamp(),
      updated_by: String(authorId || ''),
    },
    { merge: true }
  );
  return { id: reference.id };
};

// Deletes a map landmark pin.
export const deleteMapLandmark = async ({ id } = {}) => {
  const wanted = String(id || '').trim();
  if (!wanted) throw new Error('Which landmark?');
  await deleteDoc(doc(firestore(), MAP_LANDMARK_COLLECTION, wanted));
  return { id: wanted };
};

// Saves a Pre-Incident Plan document.
export const savePreIncidentPlan = async ({ id = '', fields = {}, authorId = '' } = {}) => {
  const problem = preIncidentPlanProblem(fields);
  if (problem) throw new Error(problem);

  const normal = preIncidentPlanFields(fields);
  const reference = String(id || '').trim()
    ? doc(firestore(), PRE_INCIDENT_PLANS_COLLECTION, String(id).trim())
    : doc(collection(firestore(), PRE_INCIDENT_PLANS_COLLECTION));
  const previous = await getDoc(reference);
  await setDoc(
    reference,
    {
      ...normal,
      created_at: previous.exists()
        ? String(previous.get('created_at') || '') || stationTimestamp()
        : stationTimestamp(),
      created_by: previous.exists() ? String(previous.get('created_by') || '') : String(authorId || ''),
      updated_at: stationTimestamp(),
      updated_by: String(authorId || ''),
    },
    { merge: true }
  );

  // Synchronize any hydrants on this preplan into the shared hydrants collection in parallel
  if (Array.isArray(normal.nearby_hydrants) && normal.nearby_hydrants.length > 0) {
    const hydrantsToSync = normal.nearby_hydrants.filter((h) => h && (h.id || h.address || h.latitude));
    if (hydrantsToSync.length > 0) {
      await Promise.allSettled(
        hydrantsToSync.map((h) => saveHydrant({ id: h.hydrant_id || h.id, fields: h, authorId }))
      );
    }
  }

  return { id: reference.id };
};

// Deletes a Pre-Incident Plan document.
export const deletePreIncidentPlan = async ({ id } = {}) => {
  const wanted = String(id || '').trim();
  if (!wanted) throw new Error('Which pre-incident plan?');
  await deleteDoc(doc(firestore(), PRE_INCIDENT_PLANS_COLLECTION, wanted));
  return { id: wanted };
};

// Saves or updates a Hydrant document in the shared collection.
export const saveHydrant = async ({ id = '', fields = {}, authorId = '' } = {}) => {
  const normal = normalizeHydrant(fields);
  const tag = normal.id || 'Hydrant';
  const wantedId = String(id || normal.hydrant_id || '').trim();
  const reference = wantedId
    ? doc(firestore(), HYDRANTS_COLLECTION, wantedId)
    : doc(collection(firestore(), HYDRANTS_COLLECTION));

  const dataToSave = {
    ...normal,
    id: tag,
    hydrant_id: reference.id,
    updated_at: stationTimestamp(),
    updated_by: String(authorId || ''),
  };
  if (!wantedId) {
    dataToSave.created_at = stationTimestamp();
    dataToSave.created_by = String(authorId || '');
  }

  await setDoc(reference, dataToSave, { merge: true });
  return { id: reference.id };
};

// Deletes a Hydrant document from the shared collection.
export const deleteHydrant = async ({ id } = {}) => {
  const wanted = String(id || '').trim();
  if (!wanted) throw new Error('Which hydrant?');
  await deleteDoc(doc(firestore(), HYDRANTS_COLLECTION, wanted));
  return { id: wanted };
};

// Saves the station's landmark pin categories and icons.
export const saveMapTypes = async ({ types, authorId = '' } = {}) => {
  const problem = mapTypesProblem(types);
  if (problem) throw new Error(problem);
  const document = mapTypesDocument(types, { author: authorId });
  await setDoc(
    doc(firestore(), MAP_TYPES_COLLECTION, MAP_TYPES_DOC_ID),
    { ...document, updated_at: stationTimestamp() },
    { merge: true }
  );
  return { count: document.count, types: document.types };
};

// Saves a background map layer (roads, water, etc.).
export const saveMapBackdrop = async ({ layer, geojson, meta = {}, authorId = '' } = {}) => {
  const wanted = String(layer || '').trim();
  if (!MAP_BACKDROP_LAYERS.includes(wanted)) {
    throw new Error(`There is no map background called "${layer}".`);
  }
  const fields = MAP_BACKDROP_FIELDS[wanted] || [];
  const problem = backdropProblem(geojson, fields);
  if (problem) throw new Error(problem);

  const document = backdropDocument(geojson, { ...meta, layer: wanted, fields });
  await setDoc(
    doc(firestore(), MAP_BACKDROP_COLLECTION, wanted),
    { ...document, saved_by: String(authorId || ''), updated_at: stationTimestamp() },
    { merge: true }
  );
  return { id: wanted, features: document.features };
};

// Deletes a background map layer.
export const deleteMapBackdrop = async ({ layer } = {}) => {
  const wanted = String(layer || '').trim();
  if (!MAP_BACKDROP_LAYERS.includes(wanted)) {
    throw new Error(`There is no map background called "${layer}".`);
  }
  await deleteDoc(doc(firestore(), MAP_BACKDROP_COLLECTION, wanted));
  return { id: wanted };
};

// Checks whether an on-duty record matches a clock entry's start time.
const onDutyMatches = (onDuty, timeIn) => {
  if (!onDuty) return false;
  const live = String(onDuty.time_in || '').trim();
  const entry = String(timeIn || '').trim();
  return !!live && !!entry && live === entry;
};

// Creates or updates a timeclock entry and adjusts on-duty status accordingly.
export const saveTimeclockEntry = async ({ id, userId, timeIn, timeOut }) => {
  const member = String(userId || '').trim();
  const at = (value) => String(value === undefined || value === null ? '' : value).trim();
  if (!member || !at(timeIn)) return { success: false, message: 'User and time in are required.' };

  const db = firestore();
  const entryId = String(id || '').trim() || doc(collection(db, 'timeclock')).id;
  const fields = { user_id: member, time_in: at(timeIn), time_out: at(timeOut), is_manual: true };

  await runTransaction(db, async (transaction) => {
    const entryRef = doc(db, 'timeclock', entryId);
    const onDutyRef = doc(db, 'on_duty', member);
    const userRef = doc(db, 'users', member);
    const [existing, onDuty, userDoc] = await Promise.all([
      transaction.get(entryRef),
      transaction.get(onDutyRef),
      transaction.get(userRef),
    ]);
    const previousTimeIn = existing.exists() ? String((existing.data() || {}).time_in || '') : '';
    const onDutyRow = onDuty.exists() ? onDuty.data() : null;
    const userData = userDoc.exists() ? userDoc.data() : {};

    transaction.set(entryRef, fields, { merge: true });

    if (fields.time_out === '') {
      transaction.set(onDutyRef, {
        user_id: member,
        time_in: fields.time_in,
        name: String(userData.name || '').trim(),
        rank_id: String(userData.rank_id || '').trim(),
      });
      return;
    }
    if (onDutyMatches(onDutyRow, previousTimeIn)) transaction.delete(onDutyRef);
  });

  return { success: true, id: entryId };
};

// Deletes a timeclock entry and removes on-duty status if it was open.
export const deleteTimeclockEntry = async ({ id }) => {
  const entryId = String(id || '').trim();
  if (!entryId) return { success: false, message: 'Entry not found.' };

  const db = firestore();
  const removed = await runTransaction(db, async (transaction) => {
    const target = doc(db, 'timeclock', entryId);
    const snapshot = await transaction.get(target);
    if (!snapshot.exists()) return false;

    const row = snapshot.data() || {};
    const member = String(row.user_id || '').trim();
    const onDutyRef = member ? doc(db, 'on_duty', member) : null;
    const onDuty = onDutyRef ? await transaction.get(onDutyRef) : null;

    transaction.delete(target);
    if (onDutyRef && onDutyMatches(onDuty && onDuty.exists() ? onDuty.data() : null, String(row.time_in || ''))) {
      transaction.delete(onDutyRef);
    }
    return true;
  });

  return removed ? { success: true, message: 'Entry deleted.' } : { success: false, message: 'Entry not found.' };
};

// Deletes a document from a collection.
export const deleteDocument = async ({ collection: collectionName, id }) => {
  const target = String(id || '');
  if (collectionName === 'documents' && target) {
    const db = firestore();
    const items = await rowsFor('document_checklist_items', 'document_id', target);
    for (let offset = 0; offset < items.length; offset += 450) {
      const batch = writeBatch(db);
      items.slice(offset, offset + 450).forEach((item) => {
        batch.delete(doc(db, 'document_checklist_items', item.id));
      });
      await batch.commit();
    }
  }
  await deleteDoc(doc(firestore(), collectionName, target));
  return { id: target };
};

// Saves training courses in bulk.
export const saveTrainingRows = async ({ rows = [], deleteIds = [] }) => {
  const db = firestore();
  const batch = writeBatch(db);

  rows.forEach((row) => {
    const { action, token, row_version, id, date_key, ...fields } = row;
    void action;
    void token;
    void row_version;
    void date_key;
    const target = String(id || '').trim() || doc(collection(db, 'trainings')).id;
    batch.set(doc(db, 'trainings', target), { ...fields, id: target, date_key: parseSheetDateKey(fields.date) || '' }, { merge: true });
  });
  deleteIds.forEach((id) => batch.delete(doc(db, 'trainings', String(id))));

  await batch.commit();
  return { saved: rows.length, deleted: deleteIds.length };
};

// Saves certification records in bulk.
export const saveCertificationRows = async ({ records = [], updates = [], deleteIds = [] }) => {
  const db = firestore();
  const batch = writeBatch(db);

  records.forEach((row) => {
    const { action, token, id, ...fields } = row;
    void action;
    void token;
    const target = String(id || '').trim() || doc(collection(db, 'certifications')).id;
    batch.set(doc(db, 'certifications', target), { ...fields, id: target }, { merge: true });
  });

  updates.forEach((change) => {
    const { id, ...fields } = change || {};
    const target = String(id || '').trim();
    if (!target || Object.keys(fields).length === 0) return;
    batch.set(doc(db, 'certifications', target), fields, { merge: true });
  });

  deleteIds.forEach((id) => batch.delete(doc(db, 'certifications', String(id))));

  await batch.commit();
  return { saved: records.length, updated: updates.length, deleted: deleteIds.length };
};

export { badgeForRecord };

// Recomputes certification badges for all members or for a single member.
export const refreshCertificationBadges = async (targetUserId = '') => {
  const db = firestore();
  const today = badgeToday();
  const userId = String(targetUserId || '').trim();

  const sameBadges = (a = [], b = []) => JSON.stringify(a) === JSON.stringify(b);

  if (userId) {
    const [types, userRecords, existing] = await Promise.all([
      rowsOf(collection(db, 'certification_setup')),
      rowsFor('certifications', 'user_id', userId),
      rowsOf(collection(db, 'certification_badges')),
    ]);

    // If badges exist, rebuild for this member only.
    if (existing.length > 0) {
      const memberIndex = badgeIndexFor(userRecords, types, today);
      const targetBadges = memberIndex[userId] || [];

      const index = {};
      existing.forEach((row) => {
        const id = String(row.id);
        if (id !== userId && Array.isArray(row.badges) && row.badges.length) {
          index[id] = row.badges;
        }
      });
      if (targetBadges.length) {
        index[userId] = targetBadges;
      }

      const existingEntry = existing.find((row) => String(row.id) === userId);
      const prevBadges = existingEntry?.badges || [];
      if (!sameBadges(prevBadges, targetBadges)) {
        if (targetBadges.length) {
          await setDoc(doc(db, 'certification_badges', userId), { user_id: userId, badges: targetBadges }, { merge: true });
        } else if (existingEntry) {
          await deleteDoc(doc(db, 'certification_badges', userId));
        }
      }

      return index;
    }
  }

  // Full rebuild: reads all records and types.
  const [records, types] = await Promise.all([rowsOf(collection(db, 'certifications')), rowsOf(collection(db, 'certification_setup'))]);
  const index = badgeIndexFor(records, types, today);

  const existing = await rowsOf(collection(db, 'certification_badges'));
  const existingMap = new Map();
  existing.forEach((row) => {
    existingMap.set(String(row.id), row.badges || []);
  });

  const batch = writeBatch(db);
  let dirty = false;

  Object.entries(index).forEach(([uid, badges]) => {
    const prev = existingMap.get(uid);
    if (!existingMap.has(uid) || !sameBadges(prev, badges)) {
      batch.set(doc(db, 'certification_badges', uid), { user_id: uid, badges }, { merge: true });
      dirty = true;
    }
  });

  existing
    .filter((row) => !index[String(row.id)])
    .forEach((row) => {
      batch.delete(doc(db, 'certification_badges', String(row.id)));
      dirty = true;
    });

  if (dirty) {
    await batch.commit();
  }

  return index;
};

export const refreshCertificationBadgesForMember = async (userId) => refreshCertificationBadges(userId);

// Saves system settings to public or private documents.
export const saveSystemSettings = async ({ settings = [] } = {}) => {
  const bySide = { public: {}, private: {} };
  settings.forEach(({ key, value }) => {
    const name = String(key || '').trim();
    if (!name) return;
    bySide[settingSide(name)][name] = value === undefined || value === null ? '' : String(value);
  });

  await Promise.all(
    Object.entries(bySide).map(([side, fields]) =>
      Object.keys(fields).length
        ? setDoc(doc(firestore(), 'settings', side), fields, { merge: true })
        : Promise.resolve()
    )
  );
  return { saved: settings.length };
};

// Removes a single system setting key.
export const deleteSystemSetting = async (key) => {
  const name = String(key || '').trim();
  if (name) await setDoc(doc(firestore(), 'settings', settingSide(name)), { [name]: deleteField() }, { merge: true });
  return { key: name };
};
