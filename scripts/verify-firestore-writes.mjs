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
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { DEMO_PASSWORD, seed } from './seed-emulator.mjs';
import { firebaseAuth, firestore } from '../src/services/firebase.js';
import { syntheticEmail } from '../src/services/firebaseAuth.js';
import {
  approveOffer,
  clockIn,
  clockOut,
  makeOffer,
  saveAvailability,
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
  // this rule allowed exactly that, because "you own the row" covered every field including the status.
  await refused('the member cannot approve their own offer', 'permission-denied', () =>
    approveOffer({ offerId, approverId: 'u2' })
  );

  // --- an officer approves it, and the shift fills in the same transaction ---
  await signOut(auth);
  console.log('\n--- an officer approves it ---');
  await signIn('jane');
  await approveOffer({ offerId, approverId: 'u1' });
  check('the offer is approved', (await getDoc(doc(db, 'schedule_offers', offerId))).data().status, 'approved');
  const filled = (await getDoc(doc(db, 'schedule', 's2'))).data();
  check('and the shift went to the member who offered', filled.user_id, 'u2');
  check('with the open flag cleared, so the calendar stops offering it', filled.is_open, false);
  await refused('approving it twice is refused', 'already-resolved', () => approveOffer({ offerId, approverId: 'u1' }));

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

  // The harness's own guard: a section that stopped running would otherwise look like a pass. The number is the
  // count this file actually reaches, so a section that stops running is caught rather than quietly assumed.
  console.log('\n--- the harness itself ---');
  checkIs('every case ran', cases >= 23, `only ${cases} cases: a section has stopped running`);
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
