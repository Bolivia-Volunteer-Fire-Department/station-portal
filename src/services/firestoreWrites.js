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
import { collection, deleteDoc, doc, getDoc, getDocs, query, runTransaction, setDoc, where, writeBatch } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { firebaseFunctions, firestore } from './firebase.js';
import { rowsOf } from './firestorePayload.js';
import { settingSide } from '../utils/systemSettings.js';
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

export const clockIn = async ({ userId, gps, isManual = false }) => {
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

// The one thing about the move that a station has to DECIDE: whether an officer's straightforward saves are audited.
//
// On the sheet they were, because the server did the work and wrote the row. Firestore has no audit log, and a client
// cannot write one - an audit row a browser can forge is not an audit row - so the choice is between no record and a
// callable that writes one before it writes the document.
//
// DEFAULT OFF, which is the owner's decision: the rules record who MAY write, and that is enough for a station that
// trusts its officers. An officer turns it on by adding the setting `audit_client_writes` = TRUE in the System
// Settings tab's table, which is public because the CLIENT has to read it to know which way to write.
//
// Read per save rather than cached: it is one small document read, and a station that has just switched this on
// should not have to wait for a cache to expire to believe it.
export const clientWritesAreAudited = async () => {
  try {
    const settings = await getDoc(doc(firestore(), 'settings', 'public'));
    const value = (settings.data() || {}).audit_client_writes;
    return value === true || String(value ?? '').trim().toUpperCase() === 'TRUE';
  } catch {
    return false;
  }
};

// A save that is ONE DOCUMENT, which is what most of the admin tabs are. The action's own fields become the document:
// the sheet's columns were already the document's field names, so there is nothing to translate, and `action` /
// `token` / `row_version` are the envelope and the sheet's conflict check rather than data. Firestore has no
// equivalent of row_version - a set replaces what the last writer wrote, and the app's rule is that the last writer
// wins.
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

  // One decision, in one place, covering every straightforward save in the app: straight to the document, or through
  // the callable that writes an audit row first. See clientWritesAreAudited above.
  if (await clientWritesAreAudited()) {
    const result = await httpsCallable(firebaseFunctions(), 'saveDocumentWithAudit')({ collection, id: target, document });
    return { id: result.data?.id || target };
  }

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

export const deleteDocument = async ({ collection, id }) => {
  const target = String(id || '');
  if (await clientWritesAreAudited()) {
    await httpsCallable(firebaseFunctions(), 'saveDocumentWithAudit')({ collection, id: target, remove: true });
    return { id: target };
  }
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
