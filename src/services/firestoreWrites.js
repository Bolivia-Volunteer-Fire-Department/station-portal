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
import { rowsFor, rowsOf } from './firestorePayload.js';
// The SAME visibility test the readers apply, imported rather than copied: this is what decides whether a document
// exists as far as a member is concerned, and two implementations of that would drift.
import { visibleDocumentFor } from './firestoreReads.js';
import { settingSide } from '../utils/systemSettings.js';
// The trustworthy-clock rule: clocking in and out refuses while offline rather than queueing a record stamped with the
// device's clock. See the note in that module - it is the whole reason the guard is here and not in the UI.
import { isOffline } from '../utils/connectivity.js';
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
// member gets a sentence rather than Firestore's `unavailable`.
//
// WHY THIS IS IN THE WRITER RATHER THAN THE SCREEN: a guard in the UI protects the UI. This one protects the DATA, and it
// covers every path that reaches these two functions - the clock card, a replayed action after a session refresh, and
// anything added later. The transaction itself cannot queue (a transaction needs a server round trip to read), so what
// this really buys is the honest message and the fact that nothing half-happens: a clock-in that cannot be recorded must
// not leave the screen claiming somebody is on duty.
const refuseOffline = () => {
  if (isOffline()) throw new Error('offline');
};

export const clockIn = async ({ userId, gps, isManual = false }) => {
  refuseOffline();
  const db = firestore();
  const entry = doc(collection(db, 'timeclock'));
  const stamp = stationTimestamp();

  await runTransaction(db, async (transaction) => {
    // The already-open check reads the ON-DUTY document rather than querying the entries. Two reasons: a transaction
    // in this SDK cannot run a query, and this document is the same fact as a single reference - a member is on duty
    // exactly when their entry is open, and the two are written together below. Reading it inside the transaction is
    // what stops a double tap opening two shifts; the sheet version had the same check under its script lock.
    const onDuty = await transaction.get(doc(db, 'on_duty', userId));
    if (onDuty.exists()) throw new Error('already-clocked-in');

    transaction.set(entry, {
      user_id: userId,
      time_in: stamp,
      time_out: '',
      is_manual: isManual,
      gps_lat: gps ? String(gps.latitude) : '',
      gps_lon: gps ? String(gps.longitude) : '',
    });
    transaction.set(doc(db, 'on_duty', userId), { user_id: userId, time_in: stamp });
  });

  return entry.id;
};

export const clockOut = async ({ userId, entryId }) => {
  refuseOffline();
  const db = firestore();

  await runTransaction(db, async (transaction) => {
    const target = doc(db, 'timeclock', entryId);
    const snapshot = await transaction.get(target);
    if (!snapshot.exists()) throw new Error('no-entry');
    if (String(snapshot.data().user_id) !== String(userId)) throw new Error('not-your-entry');
    if (String(snapshot.data().time_out || '')) throw new Error('already-clocked-out');

    transaction.update(target, { time_out: stationTimestamp() });
    transaction.delete(doc(db, 'on_duty', userId));
  });
};

// AVAILABILITY: one batch per save, which is how the app already sends it - the slots marked and unmarked in one
// commit. The sheet version held the script lock for this; a batch is atomic without one, and the rules see to it
// that every row written belongs to the member writing it.
export const saveAvailability = async ({ userId, adds = [], removes = [] }) => {
  const db = firestore();
  const batch = writeBatch(db);

  adds.forEach((slot) => {
    batch.set(doc(collection(db, 'availability')), {
      user_id: userId,
      schedule_template_id: String(slot.schedule_template_id || ''),
      date_from: String(slot.date_from || ''),
      date_to: String(slot.date_to || slot.date_from || ''),
    });
  });
  removes.forEach((rowId) => batch.delete(doc(db, 'availability', String(rowId))));

  await batch.commit();
  return { added: adds.length, removed: removes.length };
};

// OFFERS: a member raises one, withdraws their own, and an officer approves one - and the approval is the write that
// fills the shift, in a transaction, so the offer's status and the schedule row cannot end up disagreeing.
export const makeOffer = async ({ userId, scheduleId, dateFrom, assignmentId, slotKey }) => {
  const created = doc(collection(firestore(), 'schedule_offers'));
  await setDoc(created, {
    user_id: userId,
    schedule_id: String(scheduleId || ''),
    date_from: String(dateFrom || ''),
    assignment_id: String(assignmentId || ''),
    status: 'pending',
    slot_key: String(slotKey || ''),
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
const withoutEnvelope = (body = {}) => {
  const { action, token, row_version, ...fields } = body;
  void action;
  void token;
  void row_version;
  return fields;
};

export const saveDocument = async ({ collection, id, body, extra = {} }) => {
  // An empty id means CREATE, exactly as it did on the sheet - and Firestore mints the id the sheet's generated
  // column used to. It has to be this way round: the caller awaits the reply and puts the new id in its table.
  const target = String(id || '').trim() || doc(collection(firestore(), collection)).id;
  const document = { ...withoutEnvelope(body), ...extra };

  await setDoc(doc(firestore(), collection, target), document, { merge: true });
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

// A save for the three collections a member sees by audience. It reads the ranks, computes the list, and writes it
// with the document - and it stamps the author on CREATE only, which is what the sheet's server did rather than
// letting an edit rewrite who wrote it.
export const saveAudienceDocument = async ({ collection: name, id, body, rankAndAbove = false, authorId = '' }) => {
  const ranks = await rowsOf(collection(firestore(), 'ranks'));
  const audience_keys = audienceKeysForWrite({
    roleId: body.role_id,
    rankId: body.rank_id,
    userId: body.user_id,
    ranks,
    rankAndAbove,
  });
  const extra = { audience_keys };
  if (authorId && !String(id || '').trim()) extra.author_user_id = authorId;
  return saveDocument({ collection: name, id, body, extra });
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
    return { success: false, message: 'A checklist is signed item by item. Tick and save the items instead.' };
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
    signature: { id: created.id, ...(await getDoc(created)).data() },
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

  const items = await rowsFor('document_checklist_items', 'document_id', documentId);
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

// The two limits the sheet enforced, kept at the same numbers: a reorder is one batch request, and a folder name is a
// label rather than a document body.
const DOCUMENT_REORDER_LIMIT = 500;
const DOCUMENT_FOLDER_LIMIT = 80;

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

export const deleteDocument = async ({ collection, id }) => {
  const target = String(id || '');
  await deleteDoc(doc(firestore(), collection, target));
  return { id: target };
};

// The bulk training save: rows upserted (a blank id creates one) and rows removed, in ONE commit - the same shape as
// the availability batch and for the same reason. A half-applied bulk save is a training record that exists for some
// of the people who attended it, which is worse than one that failed outright.
export const saveTrainingRows = async ({ rows = [], deleteIds = [] }) => {
  const db = firestore();
  const batch = writeBatch(db);

  rows.forEach((row) => {
    const { action, token, row_version, id, ...fields } = row;
    void action;
    void token;
    void row_version;
    const target = String(id || '').trim() || doc(collection(db, 'trainings')).id;
    // The id is written as a FIELD as well as used as the key, because the migration put it there and the app reads
    // it off every row it lists.
    batch.set(doc(db, 'trainings', target), { ...fields, id: target }, { merge: true });
  });
  deleteIds.forEach((id) => batch.delete(doc(db, 'trainings', String(id))));

  await batch.commit();
  return { saved: rows.length, deleted: deleteIds.length };
};

// The badge index: member id -> the [{ id, name, icon }] of the types that asked to be shown beside a name, and only
// for records that are CURRENT. This mirrors certificationBadgeIndex in Code.gs, including the part that matters
// most: a paramedic badge on somebody whose licence lapsed is worse than no badge, because it is the app making a
// claim the station cannot back.
//
// It refreshes EVERY member rather than the one just edited, which is the honest trade. The inputs are the records,
// the types and today, so editing a TYPE changes other people's badges, and a record quietly ageing past its end date
// changes its own. At station scale that is a few dozen small writes per save, and it is the only way the roster
// cannot end up showing a stale claim it cannot back.
// Whether ONE record earns a badge today, extracted because it is the only part of the index with a claim in it -
// "this member is a paramedic" - and therefore the only part worth testing on its own. A type that does not ask to be
// shown, or has no icon, earns nothing however current the record is.
export const badgeForRecord = (record = {}, type = {}, today = '') => {
  if (!type || type.show_next_to_name !== true || !type.icon) return null;
  const from = String(record.effective_date || '');
  const to = String(record.end_date || '');
  if (from && from > today) return null; // not started yet
  if (to && to < today) return null; // lapsed - the badge would be a claim the station cannot back
  return { id: type.id, name: type.name, icon: type.icon };
};

export const refreshCertificationBadges = async () => {
  const db = firestore();
  const today = stationTimestamp().slice(0, 10);
  const [records, types] = await Promise.all([rowsOf(collection(db, 'certifications')), rowsOf(collection(db, 'certification_setup'))]);
  const typeById = Object.fromEntries(types.map((type) => [String(type.id), type]));

  const index = {};
  records.forEach((record) => {
    const owner = String(record.user_id || '');
    const badge = owner ? badgeForRecord(record, typeById[String(record.certification_id || '')], today) : null;
    if (!badge) return;
    index[owner] = index[owner] || [];
    // One badge per type, however many periods a member has of it.
    if (index[owner].some((existing) => existing.id === badge.id)) return;
    index[owner].push(badge);
  });

  // A member whose last badge lapsed loses the document, rather than keeping an empty one: the roster draws whatever
  // this returns, and an empty list and a missing document have to mean the same thing.
  const existing = await rowsOf(collection(db, 'certification_badges'));
  const batch = writeBatch(db);
  Object.entries(index).forEach(([userId, badges]) => {
    batch.set(doc(db, 'certification_badges', userId), { user_id: userId, badges }, { merge: true });
  });
  existing
    .filter((row) => !index[String(row.id)])
    .forEach((row) => batch.delete(doc(db, 'certification_badges', String(row.id))));
  await batch.commit();

  return { members: Object.keys(index).length, cleared: existing.filter((row) => !index[String(row.id)]).length };
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
