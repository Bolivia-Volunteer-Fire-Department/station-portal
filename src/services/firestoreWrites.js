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
import { collection, deleteDoc, doc, getDocs, query, runTransaction, setDoc, where, writeBatch } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { firebaseFunctions, firestore } from './firebase.js';

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
