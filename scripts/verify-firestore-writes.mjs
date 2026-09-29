/**
 * Phase 3, part one: the member write paths.
 *
 *   npm run verify:firestore-writes
 *
 * The claims being tested are the ones verify-write-safety.mjs makes about the sheet version, translated to a
 * database that has no lock:
 *
 *   - a member may not act for somebody else, and the RULES say so rather than the server;
 *   - where two documents have to agree - a clock entry and the on-duty row, an offer's status and the shift it
 *     fills - they change together or not at all;
 *   - a double tap cannot open two shifts, or approve an offer twice;
 *   - and owning a row does not mean being able to change the field that matters. A member owns their offer; they
 *     still cannot approve it.
 */
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { DEMO_PASSWORD, seed } from './seed-emulator.mjs';
import { firebaseAuth, firebaseFunctions, firestore } from '../src/services/firebase.js';
import { syntheticEmail } from '../src/services/firebaseAuth.js';
import { settingSide } from '../src/utils/systemSettings.js';
import {
  approveOffer,
  audienceKeysForWrite,
  badgeForRecord,
  clientWritesAreAudited,
  clockIn,
  clockOut,
  makeOffer,
  saveAvailability,
  saveScheduleBoard,
  withdrawOffer,
} from '../src/services/firestoreWrites.js';

let failures = 0;
let cases = 0;

const check = (label, actual, expected) => {
  cases++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};

const checkIs = (label, condition, detail) => {
  cases++;
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` -> ${detail}`}`);
};

// A call expected to be refused, and the error it should be refused with.
const refused = async (label, expected, run) => {
  try {
    await run();
    checkIs(label, false, 'the write was allowed');
  } catch (error) {
    checkIs(label, error.message === expected || error.code === expected, `threw ${error.code || error.message}`);
  }
};

const auth = firebaseAuth();
const db = firestore();
const signIn = (username) => signInWithEmailAndPassword(auth, syntheticEmail(username), DEMO_PASSWORD);
const rowsOf = async (target) => (await getDocs(target)).docs.map((entry) => ({ id: entry.id, ...entry.data() }));

const main = async () => {
  console.log('--- the demo station ---');
  await seed();
  checkIs('it seeded', true);

  // --- clocking in: the entry and the on-duty row, together ---
  console.log('\n--- a member clocks in ---');
  await signIn('bo');
  const entryId = await clockIn({ userId: 'u2', gps: { latitude: 39.123, longitude: -79.123 }, isManual: false });
  const entry = (await getDoc(doc(db, 'timeclock', entryId))).data();
  check('the entry belongs to the member who clocked in', entry.user_id, 'u2');
  check('and is open', entry.time_out, '');
  checkIs('with the coordinates the browser supplied', entry.gps_lat === '39.123' && entry.gps_lon === '-79.123', JSON.stringify(entry));
  checkIs('and a timestamp in the format the app reads', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(entry.time_in), entry.time_in);
  // The pair: the dashboard reads this collection, and it cannot disagree with the entry above.
  const onDuty = await getDoc(doc(db, 'on_duty', 'u2'));
  check('the on-duty row appeared with it', onDuty.exists(), true);
  check('carrying the same timestamp', onDuty.data().time_in, entry.time_in);
  // The double tap: the check is inside the transaction, so the second one cannot win the race.
  await refused('a second clock-in is refused', 'already-clocked-in', () => clockIn({ userId: 'u2' }));

  // --- clocking out: the mirror ---
  console.log('\n--- and clocks out ---');
  await clockOut({ userId: 'u2', entryId });
  const closed = (await getDoc(doc(db, 'timeclock', entryId))).data();
  checkIs('the entry is closed', /^\d{4}-\d{2}-\d{2} /.test(closed.time_out), JSON.stringify(closed.time_out));
  check('and the on-duty row went with it', (await getDoc(doc(db, 'on_duty', 'u2'))).exists(), false);
  await refused('clocking out twice is refused', 'already-clocked-out', () => clockOut({ userId: 'u2', entryId }));
  // Somebody else's entry: the RULES refuse even the read inside the transaction.
  await refused(
    'somebody else entry cannot be closed',
    'permission-denied',
    () => clockOut({ userId: 'u2', entryId: 'c1' })
  );

  // --- availability: one batch, own rows only ---
  console.log('\n--- availability ---');
  await saveAvailability({
    userId: 'u2',
    adds: [
      { schedule_template_id: 't1', date_from: '2026-03-20', date_to: '2026-03-20' },
      { schedule_template_id: 't1', date_from: '2026-03-21', date_to: '2026-03-21' },
    ],
  });
  const mine = await rowsOf(query(collection(db, 'availability'), where('user_id', '==', 'u2')));
  // Three rows, not two: the seed already gave u2 one for 2026-03-07, which is the point of the assertion below.
  check('both slots were written alongside the one the seed left', mine.map((row) => row.date_from).sort(), [
    '2026-03-07',
    '2026-03-20',
    '2026-03-21',
  ]);
  const removal = mine.find((row) => row.date_from === '2026-03-20');
  await saveAvailability({ userId: 'u2', removes: [removal.id] });
  const afterRemoval = await rowsOf(query(collection(db, 'availability'), where('user_id', '==', 'u2')));
  check('and one was removed in the same batch', afterRemoval.map((row) => row.date_from).sort(), [
    '2026-03-07',
    '2026-03-21',
  ]);
  await refused(
    'an availability row cannot be written for somebody else',
    'permission-denied',
    () => saveAvailability({ userId: 'u1', adds: [{ schedule_template_id: 't1', date_from: '2026-04-01' }] })
  );

  // --- offers: raise one, and the hole that is not there ---
  console.log('\n--- offers ---');
  const offerId = await makeOffer({
    userId: 'u2',
    scheduleId: 's2',
    dateFrom: '2026-03-09',
    assignmentId: 'a1',
    slotKey: '2026-03-09|a1',
  });
  const offer = (await getDoc(doc(db, 'schedule_offers', offerId))).data();
  check('the offer starts pending', offer.status, 'pending');
  check('against the member who raised it', offer.user_id, 'u2');
  // The hole worth an explicit case: owning the offer must not mean being able to approve it. The first version of
  // this rule allowed exactly that, because "you own the row" covered every field including the status. Now it is a
  // function that refuses, so the refusal arrives as a callable error rather than a rules one.
  await refused('the member cannot approve their own offer', 'functions/permission-denied', () =>
    approveOffer({ offerId })
  );

  // --- an officer approves it, and the shift fills in the same transaction ---
  await signOut(auth);
  console.log('\n--- an officer approves it ---');
  await signIn('jane');
  await approveOffer({ offerId });
  check('the offer is approved', (await getDoc(doc(db, 'schedule_offers', offerId))).data().status, 'approved');
  const filled = (await getDoc(doc(db, 'schedule', 's2'))).data();
  check('and the shift went to the member who offered', filled.user_id, 'u2');
  check('with the open flag cleared, so the calendar stops offering it', filled.is_open, false);
  check('and the row records which officer wrote it', filled.updated_by, 'u1');
  await refused('approving it twice is refused', 'functions/failed-precondition', () => approveOffer({ offerId }));

  // Withdrawing is a delete, which the owner may do.
  await signOut(auth);
  await signIn('bo');
  const secondOffer = await makeOffer({
    userId: 'u2',
    scheduleId: 's1',
    dateFrom: '2026-03-02',
    assignmentId: 'a1',
    slotKey: 'x',
  });
  await withdrawOffer(secondOffer);
  check('a member may withdraw their own offer', (await getDoc(doc(db, 'schedule_offers', secondOffer))).exists(), false);

  // --- the board: the officer's bulk save, its conflict check, and the audit trail ---
  // Back to the officer: the section above ends signed in as the member, and the board is an officer's tool.
  await signOut(auth);
  await signIn('jane');
  console.log('\n--- the board ---');
  const board = await saveScheduleBoard({
    entries: [
      // A row for the seeded open shift's slot: nobody holds it yet, so this fills it.
      { id: 's2', date_from: '2026-03-09', date_to: '2026-03-09', assignment_id: 'a1', schedule_template_id: 't1', user_id: 'u1', start_time: '08:00', end_time: '18:00' },
      // And a fresh row, which the function creates an id for.
      { date_from: '2026-04-01', date_to: '2026-04-01', assignment_id: 'a1', schedule_template_id: 't1', user_id: '', start_time: '08:00', end_time: '18:00' },
    ],
  });
  check('the filled row kept the id the board sent', board.ids[0], 's2');
  checkIs('and the new row was given one', !!board.ids[1] && board.ids[1] !== 's2', JSON.stringify(board.ids));
  check('the filled row now names its member', (await getDoc(doc(db, 'schedule', 's2'))).data().user_id, 'u1');
  const openRow = (await getDoc(doc(db, 'schedule', board.ids[1]))).data();
  // A blank user_id is MEANINGFUL - it is what marks an open shift - so it must survive the round trip, and is_open
  // is derived from it rather than trusted from the client.
  check('the blank member survived, because that is what "open" means', openRow.user_id, '');
  check('and is_open was derived from it', openRow.is_open, true);

  // The conflict: a NEW row claiming a slot that is already somebody else's. Sending the same id would be a
  // hand-over of that row - which the board legitimately does - so this one arrives without an id, which is what a
  // second slot on an occupied date looks like.
  await refused('a slot already held cannot be handed to somebody else', 'functions/failed-precondition', () =>
    saveScheduleBoard({ entries: [{ date_from: '2026-03-09', date_to: '2026-03-09', assignment_id: 'a1', user_id: 'u2' }] })
  );

  const boardRemoval = await saveScheduleBoard({ deleteIds: [board.ids[1]] });
  check('the delete count comes back', boardRemoval.deleted, 1);
  check('and the row is gone', (await getDoc(doc(db, 'schedule', board.ids[1]))).exists(), false);

  // The audit trail, which is one of the reasons this is a function: a client may not write the log at all. Two
  // rows, because the harness made two calls - one saving, one deleting - and the function reports each as it
  // happened rather than pretending a save and a delete are one action.
  const log = await getDocs(collection(db, 'system_log'));
  const boardRows = log.docs.map((entry) => entry.data()).filter((row) => row.action === 'ADMIN_BULK_SAVE_SCHEDULE');
  checkIs('the board save left audit rows', boardRows.length >= 2, `${boardRows.length} rows`);
  check('each naming the officer who did it', [...new Set(boardRows.map((row) => row.user_id))], ['u1']);
  checkIs(
    'and saying what it did',
    boardRows.some((row) => /Saved 2 schedule entries/.test(row.details)) &&
      boardRows.some((row) => /deleted 1/.test(row.details)),
    boardRows.map((row) => row.details).join(' | ')
  );

  // And a member cannot reach the board at all.
  await signOut(auth);
  await signIn('bo');
  await refused('a member cannot save the board', 'functions/permission-denied', () =>
    saveScheduleBoard({ entries: [{ date_from: '2026-05-01', assignment_id: 'a1', user_id: 'u2' }] })
  );
  // Nor write a schedule row directly, now that the function is its only writer.
  await refused('nor write a schedule row directly', 'permission-denied', () =>
    setDoc(doc(db, 'schedule', 'sneaky'), { date_from: '2026-05-02', assignment_id: 'a1', user_id: 'u2', is_open: false })
  );

  // The harness's own guard: a section that stopped running would otherwise look like a pass. The number is a little
  // under the count this file reaches, so a section that stops running is caught without the guard itself being
  // brittle about a case being added or removed.
  console.log('\n--- the harness itself ---');
  // --- the audience list, computed as the document is written -------------------------------------------------------
  //
  // This is the one piece of the admin writes that is LOGIC rather than a field copy, and getting it wrong is silent:
  // the row saves, and then nobody can see it. So each rule the sheet had is asserted here.
  console.log('\n--- the audience list ---');
  const ranks = [
    { id: 'r-a', rank_order: '1' },
    { id: 'r-b', rank_order: '2' },
    { id: 'r-c', rank_order: '3' },
  ];
  check('nobody targeted means everybody', audienceKeysForWrite({ ranks }), ['*']);
  check('a role audience', audienceKeysForWrite({ roleId: 'officer', ranks }), ['role:officer']);
  check('a personal audience', audienceKeysForWrite({ userId: 'u9', ranks }), ['user:u9']);
  check('an announcement targets one rank', audienceKeysForWrite({ rankId: 'r-b', ranks }), ['rank:r-b']);
  check(
    'and an event targets that rank and above, which needs the ranks themselves',
    audienceKeysForWrite({ rankId: 'r-b', ranks, rankAndAbove: true }),
    ['rank:r-b', 'rank:r-c']
  );
  const twoAudiences = (() => {
    try {
      audienceKeysForWrite({ roleId: 'officer', rankId: 'r-b', ranks });
      return 'accepted';
    } catch (error) {
      return String(error.message || '');
    }
  })();
  checkIs(
    'two audiences are refused, because no single list can express an AND',
    twoAudiences.includes('more than one audience'),
    twoAudiences
  );
  const ghostRank = (() => {
    try {
      audienceKeysForWrite({ rankId: 'nobody-has-this', ranks, rankAndAbove: true });
      return 'accepted';
    } catch (error) {
      return String(error.message || '');
    }
  })();
  checkIs('and a rank that does not exist is refused rather than hiding the row', ghostRank.includes('does not exist'), ghostRank);

  // --- the badge index: the one piece of the certifications tab that makes a CLAIM about a member ---
  //
  // "This member is a paramedic" is worth being wrong about only in one direction, so the two cases that must earn
  // nothing - not started yet, and lapsed - are asserted as carefully as the one that must.
  console.log('\n--- the badge index ---');
  const badgeType = { id: 'emtb', name: 'EMT-Basic', icon: 'ambulance', show_next_to_name: true };
  const today = '2026-09-28';
  check('a current certification earns its badge', badgeForRecord({ effective_date: '2024-01-01', end_date: '2027-01-01' }, badgeType, today), {
    id: 'emtb', name: 'EMT-Basic', icon: 'ambulance',
  });
  checkIs('one with no end date never lapses', badgeForRecord({ effective_date: '2024-01-01', end_date: '' }, badgeType, today) !== null);
  check('one that has not started yet earns nothing', badgeForRecord({ effective_date: '2027-01-01', end_date: '' }, badgeType, today), null);
  check('and one that has lapsed earns nothing either', badgeForRecord({ effective_date: '2020-01-01', end_date: '2025-01-01' }, badgeType, today), null);
  check(
    'a type that does not ask to be shown earns nothing, however current',
    badgeForRecord({ effective_date: '2024-01-01' }, { ...badgeType, show_next_to_name: false }, today),
    null
  );
  check('and neither does one with no icon to draw', badgeForRecord({ effective_date: '2024-01-01' }, { ...badgeType, icon: '' }, today), null);

  // --- the side a setting belongs on, decided in one place for the app AND the migration ---
  console.log('\n--- which side a setting belongs on ---');
  check('a setting the browser draws is public', settingSide('loading_message3'), 'public');
  check('and so is the fence the browser checks', settingSide('required_clock_latitude'), 'public');
  check('a setting nobody outside the office needs is private', settingSide('some_officer_thing'), 'private');
  check('and a setting added later starts private, which is the safe way round', settingSide('a_key_nobody_named_yet'), 'private');
  check('whitespace does not change the answer', settingSide('  station_name  '), 'public');

  // Whose device is this browser? The one question a member cannot answer for themselves, and the reason a callable
  // exists for it: a member may read their OWN push_devices rows and nobody else's - correctly - so another member's
  // token reads as nothing at all against a rules-constrained query, and a shared computer would look like the
  // signed-in member's own. The sheet's own comment says that is what this change exists to close, so the shared
  // computer is the case asserted here: jane asks about a token registered to BO, and has to be told it is his.
  const pushDeviceOwner = httpsCallable(firebaseFunctions(), 'pushDeviceOwner');

  await signIn('jane');
  await setDoc(doc(firestore(), 'push_devices', 'dev-jane'), {
    user_id: 'u1',
    token: 'token-of-jane',
    device_label: 'Front desk',
  });
  await signIn('bo');
  await setDoc(doc(firestore(), 'push_devices', 'dev-bo'), {
    user_id: 'u2',
    token: 'token-of-bo',
    device_label: 'Firehouse iPad',
  });

  await signIn('jane');
  const ownDevice = await pushDeviceOwner({ token: 'token-of-jane' });
  check('a device this member registered is theirs', ownDevice.data.device_owner.user_id, 'u1');
  check('and it is named the way the card shows it', ownDevice.data.device_owner.name, 'Jane Smith');

  const someoneElses = await pushDeviceOwner({ token: 'token-of-bo' });
  check('a device registered to ANOTHER member says so', someoneElses.data.device_owner.user_id, 'u2');
  check('and names them, which is the whole point of asking', someoneElses.data.device_owner.name, 'Bo Jones');

  const unregistered = await pushDeviceOwner({ token: 'a-token-nobody-registered' });
  checkIs(
    'a token nobody registered claims no owner rather than failing',
    unregistered.data.device_owner === null,
    String(unregistered.data.device_owner)
  );

  await signOut(firebaseAuth());
  // The callable's own code, as the client sees it: the app's custom codes come through bare, and the SDK's own
  // come through with the `functions/` prefix.
  await refused('an unsigned caller cannot ask whose device a token is', 'functions/unauthenticated', () => pushDeviceOwner({ token: 'token-of-bo' }));

  // The audit toggle, asserted BOTH ways because the wrong default here is invisible: the save succeeds either way,
  // and only the audit row differs. Off unless an officer asks for it is the owner's decision, so 'off' is a case
  // rather than a comment. Written last, and switched back off, so nothing above it is affected.
  //
  // Jane writes it because the setting needs can_edit_system_settings - and bo, who is a plain member here, is
  // refused by the rules at exactly that line. The READ is open to anybody, which is why the client can consult it.
  const settingsDoc = doc(firestore(), 'settings', 'public');
  check('the audit toggle is off unless an officer asks for it', await clientWritesAreAudited(), false);
  await signIn('jane');
  await setDoc(settingsDoc, { audit_client_writes: 'TRUE' }, { merge: true });
  check('and it turns on as soon as the setting says so', await clientWritesAreAudited(), true);
  await setDoc(settingsDoc, { audit_client_writes: 'FALSE' }, { merge: true });
  check('and off again when it is set to anything but TRUE', await clientWritesAreAudited(), false);

  checkIs('every case ran', cases >= 30, `only ${cases} cases: a section has stopped running`);
};

main()
  .then(() => {
    console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} (${cases} cases)`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error) => {
    if (String(error.code || '').includes('unavailable') || /ECONNREFUSED/.test(String(error.message))) {
      console.error('\nThe emulators are not reachable. Run `npm run verify:firestore-writes`, which starts them.');
    } else {
      console.error(error);
    }
    process.exit(1);
  });
