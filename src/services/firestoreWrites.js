// The member's write paths, and the first place the SHAPE of the data does work a server used to do.
//
// Two things to know about everything below:
//
//   - Where two documents have to agree, it is a transaction. Clocking in writes the entry AND the on_duty row; if
//     they could be written apart, the dashboard could show somebody on duty with no entry, or an entry nobody can
//     see. That is the class of bug the script-wide lock used to hide, and a transaction covers it without a lock.
//   - What the rules can check, they check - a member may only open a shift for themselves. What they cannot (that
//     the coordinates are honest) was never checked by the sheet version either: it validated what the browser sent,
//     and so does this.
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, runTransaction, setDoc, where, writeBatch } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { firebaseFunctions, firestore } from './firebase.js';
// Which fields a browser may write on a member's PRIVATE record - see utils/memberFields, and the assertion in
// scripts/verify-rules that the rules name the same set.
//
// THE WRITER CHECKS THE WIDER LIST ON PURPOSE. Which of these a given caller may write is the RULES' decision (a member
// gets the narrower set, an officer the wider one), and this function cannot see who is calling - so it refuses anything
// that is not a member detail at all and lets the rules answer the rest.
import { MEMBER_PRIVATE_ADMIN_FIELDS } from '../utils/memberFields.js';
import { rowsFor, rowsOf } from './firestorePayload.js';
// The badge rule, shared with the repair script that rebuilds the index (scripts/normalize-certification-badges.mjs).
import { badgeForRecord, badgeIndexFor, badgeToday } from '../utils/certificationBadges.js';
import { normalizeFormDefinition } from '../utils/formDefinition.js';
// The SAME visibility test the readers apply, imported rather than copied: this is what decides whether a document
// exists as far as a member is concerned, and two implementations of that would drift.
import { visibleDocumentFor } from './firestoreReads.js';
import { settingSide } from '../utils/systemSettings.js';
// The app's own date parser, shared rather than re-implemented: what the save path materializes below and what the screen
// compares against must be the same reading of the same column, or an announcement can be live on screen and expired in
// the query that feeds it.
import { availabilityMonthId } from '../utils/availability.js';
// The app's own date parser, shared rather than re-implemented: what the save path materializes below and what the screen
// compares against must be the same reading of the same column, or an announcement can be live on screen and expired in
// the query that feeds it.
import { parseSheetDateKey } from '../utils/scheduleDate.js';
// The assessment score's row id and type guard, shared with the reader so the two cannot disagree about which documents
// carry scores or what a score row is called.
import {
  WHOLE_DOCUMENT_ITEM,
  assessmentScoreId,
  assessmentScoreLimit as ASSESSMENT_SCORE_LIMIT,
  backfillSignaturePlan,
  documentRequiresVerification,
  documentVerificationState,
  isAssessment,
} from '../utils/documents.js';
// The trustworthy-clock rule: clocking in and out refuses while offline rather than queueing a record stamped with the
// device's clock. See the note in that module - it is the whole reason the guard is here and not in the UI.
import { deleteField } from 'firebase/firestore';

// The timestamp format the app reads everywhere: 'YYYY-MM-DD HH:MM:SS' in station time. Apps Script had
// getEasternTimestamp(); this is the same shape and the same timezone, which keeps a clock entry written by one
// side readable by the other during the move. A per-station timezone is a change worth making deliberately rather
// than as a side effect of this one.
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

// The member's open entry, or null. This is the "am I clocked in" question the clock card asks.
export const openClockEntryFor = async (userId) => {
  const open = await getDocs(
    query(collection(firestore(), 'timeclock'), where('user_id', '==', userId), where('time_out', '==', ''))
  );
  return open.docs[0] ? { id: open.docs[0].id, ...open.docs[0].data() } : null;
};

// REFUSED BEFORE ANYTHING IS ATTEMPTED, and thrown as a name `failureFor` already knows (firestoreRouting.js), so the
// AVAILABILITY: one batch per save, which is how the app already sends it - the slots marked and unmarked in one
// commit. The sheet version held the script lock for this; a batch is atomic without one, and the rules see to it
// that every row written belongs to the member writing it.
// A MONTH OF CLAIMS, IN ONE WRITE.
//
// `claims` is a map of window id -> the days claimed, e.g. `{ w1: ['2026-09-01', '2026-09-08'] }`, and the document is
// replaced wholesale. That is the whole point of the shape: no rows to add, none to delete, no ids to carry, and nothing
// that can get out of step - the screen holds the month it is editing and sends it back. The previous shape wrote one
// row per claimed day and deleted one per day un-claimed, which is both more writes and more ways to be wrong.
//
// The owner is in the document id, so the rules prove who may write it without reading anything else.
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

// OFFERS: a member raises one, withdraws their own, and an officer approves one - and the approval is the write that
// fills the shift, in a transaction, so the offer's status and the schedule row cannot end up disagreeing.
//
// A DECLINE IS FINAL FOR THE MEMBER, and this is where that is enforced. The calendar hides the offer button on a declined
// shift, but a screen that was already open when the officer said no would still be holding a live button - so the refusal
// belongs on the write, not only on the screen. Their own offers are what gets read: the rules allow that (they are the
// caller's own rows) and it costs one small query, with no index beyond `user_id`.
export const makeOffer = async ({ userId, scheduleId, templateId, dateFrom, dateTo, assignmentId, slotKey }) => {
  const key = String(slotKey || '');
  const mine = await rowsFor('schedule_offers', 'user_id', userId);
  if (mine.some((row) => String(row.slot_key ?? '') === key && row.status === 'declined')) {
    throw new Error('Your offer for this shift was declined, so you cannot offer for it again. Ask an officer to put you on it.');
  }

  const created = doc(collection(firestore(), 'schedule_offers'));
  await setDoc(created, {
    user_id: userId,
    schedule_id: String(scheduleId || ''),
    // THE SHIFT, NOT ONLY THE SLOT. `schedule_template_id` is what makes an offer readable as a shift: the times and the
    // nickname live on the template, so an offer that does not carry it can only be shown as a date and an assignment -
    // which is exactly what the approvals queue used to do, printing "Time not set" for every offer raised against a
    // template occurrence (the ones with no schedule row, which is most of them). It was derivable from `slot_key`, and
    // the calendar's open pill matched on that, so nothing looked broken until somebody tried to approve a shift without
    // knowing when it was.
    schedule_template_id: String(templateId || ''),
    date_from: String(dateFrom || ''),
    // The END date too, for a shift that runs across days: the read falls back to the start date, so leaving it off
    // silently flattened a multi-day occurrence into its first day.
    date_to: String(dateTo || dateFrom || ''),
    assignment_id: String(assignmentId || ''),
    status: 'pending',
    slot_key: key,
  });
  return created.id;
};

export const withdrawOffer = async (offerId) => {
  await deleteDoc(doc(firestore(), 'schedule_offers', String(offerId)));
};

// Approving an offer FILLS the shift, so it writes the schedule row - which makes it a function rather than a
// transaction here. `schedule` is write-denied to clients and the function is its only writer (one writer per fact);
// the browser version of this was the second one.
export const approveOffer = async ({ offerId }) => {
  const result = await httpsCallable(firebaseFunctions(), 'approveOffer')({ offerId: String(offerId) });
  return result.data;
};

// Declining is the other half of resolving an offer, and it is a function for the same reason: an officer's decision is
// not a member's write, and the notification the member gets watches the STATUS change (onShiftOfferDecided), so
// whatever sets that status has to be something the rules trust.
//
// It writes nothing else. Declining deliberately leaves the shift open - "no" to one member is not a decision about the
// shift - and the member cannot offer for it again afterwards (ScheduleCalendar#offerStateFor, makeOffer).
export const declineOffer = async ({ offerId }) => {
  const result = await httpsCallable(firebaseFunctions(), 'declineOffer')({ offerId: String(offerId) });
  return result.data;
};

// The officer's schedule board: entries to save and rows to delete, in one call. It is a function for three
// reasons the browser cannot satisfy - the audit row, a slot-conflict check against the rows as they are at that
// moment, and doing both in one transaction. See saveScheduleBoard in functions/index.js.
export const saveScheduleBoard = async ({ entries = [], deleteIds = [] }) => {
  const result = await httpsCallable(firebaseFunctions(), 'saveScheduleBoard')({ entries, deleteIds });
  return result.data;
};

// A save that is ONE DOCUMENT, which is what most of the admin tabs are. The action's own fields become the document:
// the sheet's columns were already the document's field names, so there is nothing to translate, and `action` /
// `token` / `row_version` are the envelope and the sheet's conflict check rather than data. Firestore has no
// equivalent of row_version - a set replaces what the last writer wrote, and the app's rule is that the last writer
// wins.
//
// THE AUDIT TOGGLE IS GONE, and with it this branch. An officer's straightforward saves used to be routeable through a
// callable that wrote an audit row first, off by default; that row was a Firestore document per save, read back to
// render one tab. The app's audits are Cloud Logging lines now (`audit` in functions/index.js), so there is nothing to
// write here for - the callable, `saveDocumentWithAudit`, remains in the functions for a station that wants its
// administrative saves to go through the server, and its audit lines go to the same place as everything else's.
// The fields a save may carry, minus the envelope. `id` goes with the envelope: it is the DOCUMENT KEY, which the caller
// passes separately, and a stored copy of it is a second place for the truth to live - one that is empty on every create,
// and that would win over the real key when the row is read back (see rowsOf in firestorePayload.js).
const withoutEnvelope = (body = {}) => {
  const { action, token, row_version, id, ...fields } = body;
  void action;
  void token;
  void row_version;
  void id;
  return fields;
};

// One document, saved. `collection` arrives as a NAME - the routing decides which collection an action writes - and it is
// bound here as `collectionName` rather than `collection`, which is not cosmetic: the SDK's `collection()` is an import,
// and a local binding of the same name SHADOWS it. The auto-id line below used to call that shadowed value, so every
// CREATE through this helper - New window, New shift, New role, New checklist item - failed with "collection is not a
// function" while editing an existing row, which passes an id and never touches that branch, worked fine.
export const saveDocument = async ({ collection: collectionName, id, body, extra = {} }) => {
  // An empty id means CREATE, exactly as it did on the sheet - and Firestore mints the id the sheet's generated
  // column used to. It has to be this way round: the caller awaits the reply and puts the new id in its table.
  const target = String(id || '').trim() || doc(collection(firestore(), collectionName)).id;
  const document = { ...withoutEnvelope(body), ...extra };

  await setDoc(doc(firestore(), collectionName, target), document, { merge: true });
  return { id: target };
};

// The audience list, computed AS the document is written - option D in the model, and it cannot be skipped: the
// member payload asks `array-contains-any` against its own keys, so a document without this list is a document nobody
// sees. That failure looks like an empty screen, not like a bad save.
//
// The rules are the sheet's, and two of them are easy to get wrong:
//
//   - The sheet ANDs the three targeting columns - "fill one and only that group sees it" - and an array cannot
//     express an AND. So a form that fills more than one is REFUSED rather than widened to anyone matching either.
//   - ANNOUNCEMENTS and DOCUMENTS target the rank exactly, while EVENTS target that rank AND ABOVE. That is why the
//     expansion needs the rank DOCUMENTS rather than just the id, and why this reads them.
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

// THE OPEN END OF A LIVE WINDOW, for the materialized `live_until` below. A date key far enough out that no station will
// reach it, in the same `YYYY-MM-DD` shape as every other key in the app - so "still live" stays a string comparison.
export const LIVE_UNTIL_OPEN = '9999-12-31';

// A save for the three collections a member sees by audience. It reads the ranks, computes the list, and writes it
// with the document - and it stamps the author on CREATE only, which is what the sheet's server did rather than
// letting an edit rewrite who wrote it.
//
// `liveUntilFrom` names the body field holding the row's END date, and it is the second thing materialized here, for the
// same reason as the first. Deciding "is this in force today" takes TWO columns, either of which may be blank - and a
// blank end date means INDEFINITELY (utils/announcements#announcementDateWindow), which is the normal state for an
// announcement nobody has scheduled an end for. A Firestore range filter excludes documents where the field is absent,
// and a query may filter on only ONE range field, so neither `effective_date` nor `end_date` can be asked for directly:
// `end_date >= today` would silently drop every announcement that has no end date, which is the one failure that must
// not be quiet. So the row carries what the query needs, computed on the way in - the same trick `audience_keys` plays
// for the audience, for the same reason.
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

// A member's own device, gone. The rules decide whether this caller may - their own row, or an officer's permission -
// and the row is found BY TOKEN because that is what a browser holds: it has no idea what id the row was given, and a
// stale token must not be able to leave a row behind that keeps delivering.
export const removePushDevice = async ({ token }) => {
  const wanted = String(token || '').trim();
  if (!wanted) return { removed: false };
  const found = await getDocs(query(collection(firestore(), 'push_devices'), where('token', '==', wanted)));
  await Promise.all(found.docs.map((row) => deleteDoc(row.ref)));
  return { removed: found.docs.length > 0 };
};

// An administrator's switch, in both directions, and the two directions are NOT symmetrical.
//
// Turning notifications OFF forgets the member's devices AND sets a flag, because the member's own card re-registers
// any subscription the browser still holds the moment User Settings is opened - without the flag the switch would
// quietly undo itself on that person's next visit. Lifting it clears the flag only: each device has to be enabled again
// from the device, which is the only place its push subscription can be turned back on.
export const setPushDisabled = async ({ userId, disabled }) => {
  const target = String(userId || '').trim();
  if (!target) throw new Error('Which member?');

  const rows = await getDocs(query(collection(firestore(), 'push_devices'), where('user_id', '==', target)));
  if (disabled) await Promise.all(rows.docs.map((row) => deleteDoc(row.ref)));

  await setDoc(doc(firestore(), 'user_settings', target), { is_push_disabled: disabled === true }, { merge: true });
  return { userId: target, disabled: disabled === true, devicesForgotten: disabled ? rows.docs.length : 0 };
};

// The member's own settings row: a time format, a theme, and which notifications they want.
//
// A MERGE, and the merge is the point: the settings form and the "enable notifications on this device" flow are the same
// call carrying different fields, and a field one of them did not send must be left exactly as it was.
//
// Which makes two things mandatory rather than tidy:
//
//   UNDEFINED FIELDS ARE DROPPED. Firestore rejects an undefined value outright, and the client sends its absences as
//   undefined on purpose - "not stated" is a real state here, not a zero.
//
//   THE TWO FLAGS BECOME REAL BOOLEANS. The form stringifies them ("false"), and a string is one careless reader away
//   from meaning the opposite: the push path already compares `is_push_disabled === true` strictly, and a 'false' that
//   is truthy is exactly the kind of bug that takes an afternoon.
//
// Unknown keys PASS THROUGH rather than being filtered against a list. The sheet had a whitelist, and the file that kept
// one drifted from the catalog twice - a new switch existed in two of three lists and silently did nothing. A document
// store has no columns to match, so the honest rule is: store what the form sent, and know which keys mean something.
const BOOLEAN_USER_SETTINGS = new Set([
  'is_dark_mode',
  'hide_events_by_default',
  'colorblind_rank_labels',
  'notify_new_offer',
  'notify_offer_approved',
  'notify_offer_declined',
  'notify_announcements',
]);

// Stored on the device, not on the member. A token in this document would be a second copy: nothing reads it, and
// nothing would clear it when the device unregisters - which is the whole reason `push_devices` exists.
const IGNORED_USER_SETTINGS = new Set(['id', 'action', 'token', 'fcm_token']);

const memberSettingValue = (key, value) => {
  const raw = value === undefined || value === null ? '' : value;
  if (BOOLEAN_USER_SETTINGS.has(key)) {
    const text = String(raw).trim().toUpperCase();
    return text === 'TRUE' || text === 'YES' || text === '1';
  }
  return String(raw);
};

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

// Signing, and the three rules that make it safe to be add-only.
//
// A signature is an ACKNOWLEDGMENT, so there is no un-sign: an administrator removes one. A request carrying removals is
// REFUSED rather than ignored, because a silent no-op looks like a working un-sign to a caller that expected one.
//
// BOTH identities come from the SESSION and never from the request: who signed, and who it was for. That is what makes
// "a member cannot sign another member's checklist" a fact rather than a convention a crafted request can ignore - and
// the rules check the same thing on the way in, so a client that skipped this function entirely still cannot.
//
// WHAT `content_revision` IS FOR: the document's revision AT THE MOMENT OF SIGNING. Comparing it with the document's
// current one is how a signature that predates an edit is reported as stale - the same judgment GET_DOCUMENT_SIGNATURES
// makes, which is why it is stamped here and not computed later.
const signatureRow = ({ documentId, itemId, memberId, signerId, role, revision, at }) => ({
  document_id: documentId,
  checklist_item_id: itemId || '',
  user_id: memberId,
  signed_by_user_id: signerId,
  signature_role: role,
  signed_at: at,
  content_revision: revision,
});

// The signatures this member owns, which is what the member-facing screens re-render from after a sign.
const ownSignatureRows = (memberId) => rowsFor('document_signatures', 'user_id', memberId);

export const signDocument = async ({ userId, documentId }) => {
  const document = await visibleDocumentFor(userId, documentId);
  if (!document) return { success: false, message: 'That document is not available.' };
  if (String(document.doc_type || '').trim().toLowerCase() === 'checklist') {
    // A checklist is signed ITEM BY ITEM, so signing the document would record an acknowledgment that means nothing
    // and clear the "to sign" badge while every item was still outstanding.
    return { success: false, message: 'A checklist is signed item by item. Check and save the items instead.' };
  }
  if (document.is_sign_required !== true && String(document.is_sign_required || '').trim().toUpperCase() !== 'TRUE') {
    return { success: false, message: 'That document does not need a signature.' };
  }

  const already = await rowsFor('document_signatures', 'user_id', userId);
  const existing = already.find((row) => row.document_id === documentId && !String(row.checklist_item_id || '').trim());
  if (existing) {
    // Signing twice is a repeated click, not an error. The caller is told what is already on file rather than being
    // given a failure it would show as one.
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
    // Id last, as everywhere else: the row may carry a stale `id` column of its own, and the document key is the truth.
    signature: { ...(await getDoc(created)).data(), id: created.id },
    signatures: await ownSignatureRows(userId),
  };
};

// A checklist is signed ITEM BY ITEM, and the batch is what the screen sends: ticking several boxes and saving once.
//
// Two things are deliberately NOT errors, and both are counted rather than failing the batch: an item that belongs to
// another checklist (or to no checklist at all), because a stale page must not be able to create a signature pointing
// at an item it does not own; and an item already signed, which is most likely an earlier press of the same button.
//
// The whole batch shares ONE timestamp, because it was one act - a member ticking five boxes did not sign five times.
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

// A VERIFICATION IS A SEPARATE ROW, not an edit of the member's. The two are different people, and a row that says who
// signed and who checked it is the whole point of the exercise - which is also why the rules let a verifier create a row
// that is not their own, as long as it is theirs to attribute and says 'verifier'.
//
// `content_revision` is 0 on these deliberately: a verification is not a signature OF a revision. The member's row
// carries the revision it was signed against, and this one only records that somebody else looked.
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
    // Verifying twice is a double click, not an error.
    return { success: true, verified: 0, already_verified: true, signatures };
  }

  await addDoc(
    collection(firestore(), 'document_signatures'),
    signatureRow({ documentId, itemId: item, memberId: member, signerId: verifierId, role: 'verifier', revision: 0, at: stationTimestamp() })
  );
  return { success: true, verified: 1, signatures: await rowsFor('document_signatures', 'document_id', documentId) };
};

// THE DOCUMENT'S OWN SIGNATURE, confirmed by somebody else - the same act as verifying a checklist item, one level up.
//
// The row it writes is the item verification's shape with the item left empty, which is how this collection has always
// said "the document itself" (see WHOLE_DOCUMENT_ITEM): the member's signature and the confirmation standing beside each
// other, told apart by `signature_role` and attributed to two different people. Nothing new is needed from the rules -
// the branch that lets a verifier write a row about somebody else already covers it.
//
// THREE REFUSALS, and none of them is paranoia:
//
//   - THE VERIFIER CANNOT BE THE MEMBER. "I checked my own work" is not a check, which is the same position the item
//     path and the assessment scores take.
//   - THE MEMBER MUST HAVE SIGNED IT. A confirmation with no signature under it asserts something that never happened,
//     and a screen - or an old link - must not be able to produce one.
//   - THE DOCUMENT MUST STILL ASK FOR IT. An author who turns the requirement off is saying the second signature is no
//     longer wanted, so a stale screen offering a button must not be able to record one anyway.
export const verifyDocumentSignature = async ({ verifierId, documentId, memberId }) => {
  const member = String(memberId || '').trim();
  const document = String(documentId || '').trim();
  if (!member || !document) return { success: false, message: 'Which member, on which document?' };
  if (member === verifierId) return { success: false, message: 'A verification is somebody else looking at it.' };

  // Read rather than trusted from the request: whether this document wants a second signature is the author's stored
  // decision, and a client that says otherwise is either stale or lying.
  const source = await getDoc(doc(firestore(), 'documents', document));
  if (!source.exists()) return { success: false, message: 'That document is not available.' };
  if (!documentRequiresVerification({ ...source.data(), id: source.id })) {
    return { success: false, message: 'That document does not ask for its signature to be confirmed.' };
  }

  const signatures = await rowsFor('document_signatures', 'document_id', document);
  const state = documentVerificationState(signatures, document, member);
  if (!state.signed) return { success: false, message: 'That member has not signed this document.' };
  if (state.verified) {
    // Confirming twice is a double click rather than an error, and the caller is told what is already on file - the
    // same reading as the item path above.
    return { success: true, verified: 0, already_verified: true, signatures };
  }

  await addDoc(
    collection(firestore(), 'document_signatures'),
    signatureRow({
      documentId: document,
      itemId: WHOLE_DOCUMENT_ITEM,
      memberId: member,
      signerId: verifierId,
      role: 'verifier',
      // A verification is not a signature OF a revision, exactly as on the item path: the member's row carries the
      // revision it was signed against, and this one only records that somebody else looked.
      revision: 0,
      at: stationTimestamp(),
    })
  );
  return { success: true, verified: 1, signatures: await rowsFor('document_signatures', 'document_id', document) };
};

// Everything that member has signed and nobody has verified, in ONE call: a verifier going down a list wants the list
// finished, and doing it one at a time is how a checklist ends up half-verified with no way to tell which half.
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
  pending.forEach((row) => {
    batch.set(
      doc(collection(firestore(), 'document_signatures')),
      signatureRow({ documentId, itemId: row.checklist_item_id, memberId: member, signerId: verifierId, role: 'verifier', revision: 0, at })
    );
  });
  await batch.commit();
  return { success: true, verified: pending.length, signatures: await rowsFor('document_signatures', 'document_id', documentId) };
};

// -----------------------------------------------------------------------------------------------------------
// ASSESSMENT SCORES
// -----------------------------------------------------------------------------------------------------------
// One member's score on one assessment, recorded by somebody who may add scores. The ONLY way a score is ever written -
// there is no member path, not even for their own, and the rules refuse one independently of anything said here.
//
// WHY A WRITE AND NOT A DELETE-THEN-ADD. The row id is `{documentId}_{userId}`, so this is a `set` and re-scoring
// REPLACES the previous value rather than accumulating rows. `merge` is used so `updated_at` is refreshed without the
// caller's values being able to drop a field the rules require - a plain overwrite is the same thing here and says so
// more clearly.
//
// The refusals are the sheet's own, restated: a score for yourself, a score with no text (indistinguishable from never
// having been scored), a score with no date (a result with no day is not a record of anything), and a document that is
// not an assessment. `String(score)` deliberately, with NO numeric coercion anywhere: the score is a string because
// stations score time, counts and pass/fail with the same field.
export const setDocumentAssessmentScore = async ({ scorerId, documentId, memberId, score, scoredOn }) => {
  const member = String(memberId || '').trim();
  const document = String(documentId || '').trim();
  const value = String(score === undefined || score === null ? '' : score).trim();
  const on = parseSheetDateKey(scoredOn);

  if (!member || !document) return { success: false, message: 'Which member, on which assessment?' };
  if (member === scorerId) {
    // The rules refuse this too. It is refused HERE as well so the officer is told why in words rather than by a
    // permission error, and because a screen that offers the control and then fails is worse than one that does not.
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
      // The caller, always - the rules require it, so it could not be anyone else, but writing it truthfully means the
      // field says who administered the test rather than only that somebody did.
      scored_by_user_id: String(scorerId || '').trim(),
      updated_at: stationTimestamp(),
    },
    { merge: true }
  );

  const saved = await getDoc(doc(firestore(), 'document_assessment_scores', id));
  // Id last, as everywhere else: the row may carry a stale `id` of its own and the document key is the truth.
  return { success: true, saved: 1, score: { ...(saved.data() || {}), id: saved.id } };
};

// The two limits the sheet enforced, kept at the same numbers: a reorder is one batch request, and a folder name is a
// label rather than a document body.
const DOCUMENT_REORDER_LIMIT = 500;
const DOCUMENT_FOLDER_LIMIT = 80;

// -----------------------------------------------------------------------------------------------------------
// GRANDFATHERING: an officer records what the paper file says, for a member
// -----------------------------------------------------------------------------------------------------------
// The write behind the Back-fill panel on the Documents tab, and it is ONE action on purpose. The alternative - the
// officer ticking items as the member, one request each - is the typing exercise this exists to remove, and it would
// mean forty rows written by forty requests with no way to say which half landed.
//
// WHAT MAKES THIS SAFE TO OFFER is the shape of the row rather than the permission attached to it. The row is a
// 'member' signature - so the member's own progress, badges and completion read correctly, and nothing downstream had to
// change - and it is marked `backfilled`, with `signed_by_user_id` naming the officer. The rules REQUIRE that flag for
// any 'member' row a caller creates for somebody else, which is the most important line in this change: without it this
// action would be a way to forge an ordinary in-app signature; with it, an officer can only ever say "the paper file
// says so", never "they tapped the button".
//
// WHAT IT REFUSES: a record against the recorder themselves, because self-entering would quietly make "I did this" and
// "the station recorded this" the same statement - the same position the assessment scores and verifications take. A
// document that does not exist. And an item belonging to another checklist, which `backfillableItemIds` filters out, so
// a stale screen cannot point a row at somebody else's checklist.
//
// CHUNKED, because a matrix can be large: Firestore takes 500 writes in a batch, and a 40-item checklist across a dozen
// members is 480 member rows before a single verification. The rows go out in chunks that leave room for the verifier
// half, and the caller is told what landed - a back-fill is a RECORDING rather than a transaction, so half of it written
// and counted honestly is more use to the officer than all of it refused.
//
// ONE TIMESTAMP for the call, because the officer is recording a session's worth of paper rather than ticking forty
// separate boxes. The DATE is theirs to choose: a paper file is dated, and "when did they do this" is the reason the
// field is on the screen at all.
const BACKFILL_CHUNK = 200;

// The signatures on a document, read from the SERVER rather than from the browser's cache.
//
// THIS IS NOT A DETAIL, and it is the same trap the schedule board documents. Both reads below follow a write - the
// `existing` one decides what a second back-fill will skip, and the one at the end is what the panel redraws its grid
// from - and a cache-first read hands back the PRE-WRITE rows. The visible failure is the one this whole area of the
// app has already had twice: the save succeeds, the rows are on the server, and the screen says nothing happened. The
// dangerous failure is the other direction - a cache that says an item is NOT yet recorded when somebody else has just
// recorded it, which would write a second member row for one item.
const signaturesForDocument = (document) =>
  rowsOf(query(collection(firestore(), 'document_signatures'), where('document_id', '==', document)), {
    source: 'server',
  });

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

  // A checklist's rows are its items; a plain document's is one row for the whole thing. So the item ids are read from
  // the document rather than trusted from the request - a non-checklist answers with none, whatever was sent.
  const items = isChecklist ? await rowsFor('document_checklist_items', 'document_id', document) : [];
  const existing = await signaturesForDocument(document);

  // The date the officer gave, or now. Kept in the station's own stamp format so a back-filled row sorts and reads
  // beside every other signature - `signatureDateLabel` takes the date half and shows no clock, which is right for
  // "this happened some time in 2024".
  const onDay = String(recordedOn || '').trim();
  const at = /^\d{4}-\d{2}-\d{2}$/.test(onDay) ? onDay : stationTimestamp();

  // THE ROWS ARE WORKED OUT BY THE CLIENT'S OWN PURE HELPER, like `reorderDocuments` above and for the same reason: "a
  // tick becomes a signature unless one is already on file" is a rule a test can pin down, and the screen counts off the
  // same answer. A non-checklist asks for the whole-document row, which is the one carrying no item.
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

  // Member rows first, then the verifications, so a chunk boundary can never leave a verification whose signature is
  // missing. That ordering matters in one direction only, and this is it: a verifier row asserts that the member's row
  // exists, so the other order would briefly record a confirmation of nothing.
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

// Removing a signature is an ADMINISTRATOR's action, and it is the only way one goes: a member cannot withdraw their
// own acknowledgment, which is why the signing writers refuse a request that carries removals rather than ignoring it.
export const removeDocumentSignature = async ({ id }) => {
  const wanted = String(id || '').trim();
  if (!wanted) throw new Error('Which signature?');
  await deleteDoc(doc(firestore(), 'document_signatures', wanted));
  return { removed: 1 };
};

// A folder is a NAME on the documents rather than a record of its own, so renaming one is a write to every document that
// carries it - and ONLY to the folder field, because this must never be a way to save a document.
export const renameDocumentFolder = async ({ from, to }) => {
  const name = String(from || '').trim();
  if (!name) throw new Error('No folder was named.');
  const replacement = String(to === undefined || to === null ? '' : to).trim().slice(0, DOCUMENT_FOLDER_LIMIT);
  // Renaming a folder to itself is not a failure and not a write.
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

// Drag-and-drop ordering.
//
// The pairs are worked out by the CLIENT's own pure helper (utils/documents.reorderDocuments), deliberately: "what does
// dropping A onto B mean" is a rule a person can see and a test can pin down, and it has no business being restated in a
// language that cannot be unit-tested.
//
// What this owns is that the request is HONEST: rows that exist, whole numbers, and only `sort_order` written. A drag
// can therefore never rewrite a title, a body or - above all - a signature, which is the property the sheet's version
// was built to protect and the reason it is worth stating again here.
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
    // A row that is not there, or a position that is not a whole number, is SKIPPED rather than failing the drag: a
    // page open while somebody else deleted a document should still be able to move the others, and a partially applied
    // order is still an order.
    if (!id || !existing.has(id) || !Number.isFinite(position)) return;
    batch.set(doc(firestore(), 'documents', id), { sort_order: position }, { merge: true });
    moved += 1;
  });

  if (moved) await batch.commit();
  return { moved };
};

// The app's TRUE parsing, kept local rather than imported.
//
// It looks like something to share, and there IS a helper for it (utils/rankEligibility) - but that module's own imports
// are extension-less, which Vite resolves and plain Node does not, and this file is loaded by Node harnesses as well as
// by the app. One three-line function is cheaper than a dependency that breaks a test runner, and it matches what the
// audit check in this file already does inline.
const isTrue = (value) => {
  if (value === true) return true;
  if (value === false) return false;
  const text = String(value === undefined || value === null ? '' : value).trim().toUpperCase();
  return text === 'TRUE' || text === 'YES' || text === '1';
};

// Signing trainings, in bulk, because the module collects a set of ticked trainings and saves once.
//
// ADD-ONLY, like every other signature: a request carrying removals is REFUSED rather than ignored, so a caller that
// expected an un-sign is told it did not happen instead of being quietly lied to. Removal is the administrator's action,
// which the rules now enforce as well as this points at.
//
// TWO THINGS ARE COUNTED RATHER THAN SIGNED, and they are counted differently on purpose: an id that names no training
// is a SKIP the caller is told about (a stale page must not be able to create a signature pointing at nothing), while a
// training already signed is simply nothing to do - signing twice is a repeated click, not an error, and the sheet must
// not gain a second row for the same member and training.
export const signTrainings = async ({ userId, trainingIds }) => {
  const wanted = [...new Set((Array.isArray(trainingIds) ? trainingIds : []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!wanted.length) return { success: false, message: 'No trainings were named.' };

  const trainings = await rowsOf(collection(firestore(), 'trainings'));
  const byId = new Map(trainings.map((training) => [training.id, training]));
  const closed = wanted.filter((id) => {
    const training = byId.get(id);
    return training && isTrue(training.is_entered_into_external);
  });
  // A training that has been entered into an external system is LOCKED, and the lock has to mean its signatures as well
  // as its fields - otherwise it is only half a lock, and somebody attends a course that is already on the record.
  if (closed.length) {
    return {
      success: false,
      message: `Training ${closed.join(', ')} has been entered into an external system and is locked, so it cannot be changed.`,
    };
  }

  const mine = await rowsFor('training_signatures', 'user_id', userId);
  const signed = new Set(mine.map((row) => String(row.training_id || '').trim()));

  const at = stationTimestamp();
  const batch = writeBatch(firestore());
  let added = 0;
  let skipped = 0;

  wanted.forEach((trainingId) => {
    if (!byId.has(trainingId)) {
      skipped += 1;
      return;
    }
    if (signed.has(trainingId)) return;
    // `signed_at` is stamped here rather than left to the reader: a signature without a date cannot be ordered, and the
    // training report lists them in the order they were given.
    batch.set(doc(collection(firestore(), 'training_signatures')), { training_id: trainingId, user_id: userId, signed_at: at });
    added += 1;
  });

  if (added) await batch.commit();
  return { success: true, signed: added, skipped, signatures: await rowsFor('training_signatures', 'user_id', userId) };
};

// The only way a training signature is ever removed, behind its own permission rather than can_edit_trainings: removing
// somebody else's acknowledgment is exactly the thing that has to be deliberate.
export const removeTrainingSignature = async ({ id }) => {
  const wanted = String(id || '').trim();
  if (!wanted) throw new Error('A signature id is required.');
  await deleteDoc(doc(firestore(), 'training_signatures', wanted));
  return { removed: 1 };
};

// THE DETAILS ON A MEMBER'S PRIVATE HALF THAT A BROWSER MAY WRITE, merged rather than replaced so writing them cannot
// disturb the username, the status or the password flag sitting beside them on the same document - none of which a browser
// may write at all.
//
// AN UNKNOWN FIELD IS REFUSED OUT LOUD rather than dropped: silently ignoring a key is how a screen ends up saving four
// fields and reporting success for five.
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

// A form definition: which blank, which source, and where each value goes.
//
// WRITTEN FROM THE BROWSER, and the rules are what decide whether it may be (`can_configure_forms`) - this does not
// repeat that check where it could drift. What it does do is NORMALISE, through the same pure function the admin screen
// uses, so a definition that reaches Firestore is one `utils/formDefinition` has already accepted - and the audience is
// materialized on the way in, exactly as an announcement's is, because that is the column the reader queries and the
// rule proves.
//
// `created_by` is stamped once and never overwritten, so "who made this form" survives an edit by somebody else.
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

// A definition gone. The rules decide who may (the same permission that let them write it); nothing else references a
// definition by id, so there is no dangling row to clean up - a generated sheet already lives in somebody's hand.
export const deleteFormTemplate = async ({ id } = {}) => {
  const wanted = String(id || '').trim();
  if (!wanted) throw new Error('Which form?');
  await deleteDoc(doc(firestore(), 'form_templates', wanted));
  return { id: wanted };
};

// The officer's clock management: correcting a member's entry, or removing one.
//
// IT KEEPS `on_duty` IN STEP, which is the one thing this action could quietly break. The member's own clock-in and
// clock-out write the entry AND the on_duty row in a transaction, because a dashboard showing somebody on duty with no
// entry - or an entry nobody can see - is the bug that pairing exists to prevent. An officer correcting an entry is a
// write to the same pair through a different door, so this recomputes on_duty from the member's remaining OPEN entries
// rather than guessing: one open entry means on duty, none means not.
//
// (The member's own two paths still do this inline. They are asserted by the write harness, which is why they are left
// alone here - unifying all three is a small job to do deliberately rather than as a side effect of adding a tab.)
// The pairing is maintained with DOCUMENT reads only, no query, and that is not an accident - it is what the member's own
// clock-in and clock-out do, for the reason the emulator was happy to demonstrate: a query inside a transaction is a
// different kind of read, and the write paths here are the last place to discover that.
//
// What makes it possible is the invariant the clock-in already enforces: A member has AT MOST ONE OPEN ENTRY. So the
// `on_duty` row IS the answer to "is this entry the live one" - it carries the time_in the member went on duty at - and an
// officer closing a historical entry must not take them off duty.
const onDutyMatches = (onDuty, timeIn) => {
  if (!onDuty) return false;
  const live = String(onDuty.time_in || '').trim();
  const entry = String(timeIn || '').trim();
  return !!live && !!entry && live === entry;
};

// Writes the entry and the on_duty row for it, from the two documents the transaction has already read.

export const saveTimeclockEntry = async ({ id, userId, timeIn, timeOut }) => {
  const member = String(userId || '').trim();
  const at = (value) => String(value === undefined || value === null ? '' : value).trim();
  // The sheet's two required fields, and its message for them.
  if (!member || !at(timeIn)) return { success: false, message: 'User and time in are required.' };

  const db = firestore();
  const entryId = String(id || '').trim() || doc(collection(db, 'timeclock')).id;
  // `is_manual` is what tells the record a PERSON wrote this rather than the clock: the member's own entries come from
  // the clock-in transaction and never carry it.
  const fields = { user_id: member, time_in: at(timeIn), time_out: at(timeOut), is_manual: true };

  await runTransaction(db, async (transaction) => {
    const entryRef = doc(db, 'timeclock', entryId);
    const onDutyRef = doc(db, 'on_duty', member);
    // Both reads BEFORE any write: a transaction refuses a read after a write, and the on_duty decision needs what the
    // entry looks like now.
    const [existing, onDuty] = await Promise.all([transaction.get(entryRef), transaction.get(onDutyRef)]);
    const previousTimeIn = existing.exists() ? String((existing.data() || {}).time_in || '') : '';
    const onDutyRow = onDuty.exists() ? onDuty.data() : null;

    transaction.set(entryRef, fields, { merge: true });

    if (fields.time_out === '') {
      // Still open: on duty from this entry's time_in, whether it is new or corrected.
      transaction.set(onDutyRef, { user_id: member, time_in: fields.time_in });
      return;
    }
    // Closed: off duty only if this was the entry they were on duty FROM. An officer tidying up an old entry must not
    // sign somebody out of a shift they are still on.
    if (onDutyMatches(onDutyRow, previousTimeIn)) transaction.delete(onDutyRef);
  });

  return { success: true, id: entryId };
};

// Deleting an entry is the other half of the same promise: removing a member's only OPEN entry takes them off duty,
// rather than leaving the dashboard showing somebody at the station whose entry no longer exists.
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
    // Off duty only if the entry being removed is the one they were on duty from - which the on_duty row itself says,
    // by carrying the time_in they went on duty at.
    if (onDutyRef && onDutyMatches(onDuty && onDuty.exists() ? onDuty.data() : null, String(row.time_in || ''))) {
      transaction.delete(onDutyRef);
    }
    return true;
  });

  // The sheet's shape: a boolean rather than a thrown error, and a message either way.
  return removed ? { success: true, message: 'Entry deleted.' } : { success: false, message: 'Entry not found.' };
};

// A document, gone. Bound the same way and for the same reason as saveDocument above: `collection` is a name the routing
// chose, and it must not shadow the SDK's `collection()` - the day somebody adds an auto-id lookup here, that shadowing
// would be a runtime error rather than a lint warning.
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

// The bulk training save: rows upserted (a blank id creates one) and rows removed, in ONE commit - the same shape as
// the availability batch and for the same reason. A half-applied bulk save is a training record that exists for some
// of the people who attended it, which is worse than one that failed outright.
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
    // The id is written as a FIELD as well as used as the key, because the migration put it there and the app reads
    // it off every row it lists.
    // `date_key` is what reports range-query; it is derived from the date here so it can never disagree with it.
    batch.set(doc(db, 'trainings', target), { ...fields, id: target, date_key: parseSheetDateKey(fields.date) || '' }, { merge: true });
  });
  deleteIds.forEach((id) => batch.delete(doc(db, 'trainings', String(id))));

  await batch.commit();
  return { saved: rows.length, deleted: deleteIds.length };
};

// The certification report's batch: records for SEVERAL members at once, changes to SEVERAL rows at once, and
// removals - in one commit.
//
// WHY A BATCH rather than a call per row: an officer recording that eight members sat the same course is ONE act, and
// eight round trips are eight chances to half-finish it. Firestore commits a batch atomically, so the screen either
// has the whole thing or none of it - which is also why the request is capped by the batch limit (500 writes) rather
// than by anything this file decides.
//
// ONE SHAPE FOR BOTH KINDS OF ROW. A new record is written exactly as the single save writes it, so a bulk add and a
// one-off add produce rows nothing downstream can tell apart. A change is MERGED over the row it names, so a bulk
// edit that fixes one date cannot blank a note nobody touched - the fields the officer did not tick are simply absent
// from the request.
//
// The id is written as a FIELD as well as being the document key, because the migration put it there and the app reads
// it off every row it lists (see rowsOf: the key wins, but the field has to agree with it).
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
    // A change with nothing to name cannot be applied to anything. Skipped rather than guessed at: the alternative is
    // creating a row out of a half-built change, which is how a bulk edit would quietly ADD records.
    if (!target || Object.keys(fields).length === 0) return;
    batch.set(doc(db, 'certifications', target), fields, { merge: true });
  });

  deleteIds.forEach((id) => batch.delete(doc(db, 'certifications', String(id))));

  await batch.commit();
  return { saved: records.length, updated: updates.length, deleted: deleteIds.length };
};

// The badge index: member id -> the [{ id, name, icon }] of the types that asked to be shown beside a name, and only
// for records that are CURRENT. This mirrors the sheet's certificationBadgeIndex, including the part that matters
// most: a paramedic badge on somebody whose licence lapsed is worse than no badge, because it is the app making a
// claim the station cannot back.
//
// It refreshes EVERY member rather than the one just edited, which is the honest trade. The inputs are the records,
// the types and today, so editing a TYPE changes other people's badges, and a record quietly ageing past its end date
// changes its own. At station scale that is a few dozen small writes per save, and it is the only way the roster
// cannot end up showing a stale claim it cannot back.
//
// THE RULE ITSELF LIVES IN utils/certificationBadges.js, shared with scripts/normalize-certification-badges.mjs - the
// repair script that rebuilds this index for a station that has none. It used to sit here, where a browser module
// importing the Firebase SDK cannot be reached from a script, so the one function that knew the rule was the one function
// no operator could run: a rebuild was only ever a side effect of a save. It is re-exported below because harnesses have
// always imported it from here and that is the address a reader of this file expects.
export { badgeForRecord };

// IT RETURNS THE INDEX IT WROTE - the same `member id -> [{ id, name, icon }]` map the roster read hands the app, so a
// caller can put it straight into the registry. What that reply shape is NOT is a summary of the rebuild: see the
// return statement at the foot of this function for the day it was one, and what it cost.
export const refreshCertificationBadges = async () => {
  const db = firestore();
  const today = badgeToday();
  const [records, types] = await Promise.all([rowsOf(collection(db, 'certifications')), rowsOf(collection(db, 'certification_setup'))]);

  // The whole index, from the shared rule rather than from a loop of our own that could drift from the script's.
  const index = badgeIndexFor(records, types, today);

  // A member whose last badge lapsed loses the document, rather than keeping an empty one: the roster draws whatever
  // this returns, and an empty list and a missing document have to mean the same thing.
  //
  // WHICH IS ALSO WHY ONE REBUILD CAN EMPTY THE COLLECTION, and it is worth stating plainly because that is what has been
  // happening to this station: if a run cannot see the records - a narrower role, a read refused, a `certifications`
  // collection that was never migrated - the index comes out empty and every badge document is deleted. The badges are not
  // corrupted, they are REMOVED, and they come back the moment a rebuild can see the records again. That is what
  // scripts/normalize-certification-badges.mjs is for, and why it reports before it writes anything.
  const existing = await rowsOf(collection(db, 'certification_badges'));
  const batch = writeBatch(db);
  Object.entries(index).forEach(([userId, badges]) => {
    batch.set(doc(db, 'certification_badges', userId), { user_id: userId, badges }, { merge: true });
  });
  existing
    .filter((row) => !index[String(row.id)])
    .forEach((row) => batch.delete(doc(db, 'certification_badges', String(row.id))));
  await batch.commit();

  // THE INDEX, AND NOTHING ELSE - one shape, so no caller can pick the wrong one.
  //
  // This used to return a SUMMARY of the rebuild (`{ members, cleared }`) while the caller needed the INDEX, and the
  // route reply carried that summary under the name `badges`. App hands the reply straight to
  // `setCertificationBadges`, which REPLACES the registry rather than merging it, so saving ONE certification replaced
  // every member's icons with `{ members: 3, cleared: 0 }`: every name on every screen went bare - the Schedule
  // module's pills, the board, the sidebar, the dashboard's on-duty card - for the rest of the session, because the
  // roster that would refill the registry is read once and the summary looks exactly like an answer. The counts were
  // never wrong, they were just not what the name said, and a reply cannot be checked by reading its caller.
  return index;
};

// Settings are one document per SIDE - `settings/public` and `settings/private` - rather than one per key, because a
// document is the unit of permission and a key's side has to be a fact rather than a judgement made at each call.
// settingSide decides it, in one place the migration reads too, so a key cannot land on a different side depending on
// who wrote it.
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

// Removing a setting removes the FIELD, not a document: the side's document holds every key on that side.
export const deleteSystemSetting = async (key) => {
  const name = String(key || '').trim();
  if (name) await setDoc(doc(firestore(), 'settings', settingSide(name)), { [name]: deleteField() }, { merge: true });
  return { key: name };
};
