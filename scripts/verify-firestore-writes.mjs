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
import { routeRead, routeWrite } from '../src/services/firestoreRouting.js';
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

  // The officer's availability edit: the SAME write as a member's own, for the member the form names. The permission is
  // the rules' - an officer with can_edit_member_availability may write another member's rows, and a member may not - so
  // these assert the rules rather than the dispatcher, which deliberately does not repeat the check. This is the
  // assumption the dispatcher was written on, and it is worth proving.
  await signIn('jane');
  await routeWrite('ADMIN_SET_AVAILABILITY', {
    user_id: 'u2',
    adds: [{ schedule_template_id: 't1', date_from: '2026-04-01', date_to: '2026-04-01' }],
    removes: [],
  });
  const forBo = await rowsOf(query(collection(firestore(), 'availability'), where('user_id', '==', 'u2')));
  checkIs('an officer adds availability for another member', forBo.some((row) => row.date_from === '2026-04-01'));

  await signIn('bo');
  const boAttempt = await routeWrite('ADMIN_SET_AVAILABILITY', {
    user_id: 'u1',
    adds: [{ schedule_template_id: 't1', date_from: '2026-04-02', date_to: '2026-04-02' }],
    removes: [],
  });
  checkIs(
    'but a member cannot write somebody else\u2019s',
    boAttempt && boAttempt.success === false,
    JSON.stringify(boAttempt).slice(0, 140)
  );
  // Asked as an OFFICER, which is the only way it can be asked: a member cannot even list another member's availability
  // (the read rule needs `user_id == uid()` or the permission), which is why this query came back permission-denied when
  // it was run as bo - the rules refusing the read of somebody else's rows, exactly as they refused the write.
  await signIn('jane');
  const forJane = await rowsOf(
    query(collection(firestore(), 'availability'), where('user_id', '==', 'u1'))
  );
  check('and no row is left behind by the refused batch', forJane.filter((row) => row.date_from === '2026-04-02').length, 0);

  // --- signing and verifying: the everyday half of documents ---------------------------------------------------------
  //
  // Every identity comes from the SESSION here, so what these assert is mostly that the SUBJECT travels separately from
  // the signer: a member signs their own, and a verification is a row ABOUT somebody else written by the verifier.
  await signIn('bo');
  const signedDocument = await routeWrite('SIGN_DOCUMENT', { id: 'doc6' });
  checkIs('a member signs a document', signedDocument.signed === 1, JSON.stringify(signedDocument).slice(0, 140));
  const signedAgain = await routeWrite('SIGN_DOCUMENT', { id: 'doc1' });
  checkIs('and signing twice is a repeated click, not an error', signedAgain.success === true && signedAgain.already_signed === true, JSON.stringify(signedAgain).slice(0, 140));

  // Two refusals, and they are different ones: a checklist is signed item by item, and a document nobody has to sign
  // cannot be signed either.
  const wholeChecklist = await routeWrite('SIGN_DOCUMENT', { id: 'doc5' });
  checkIs('a checklist refuses a document-level signature', wholeChecklist.success === false, JSON.stringify(wholeChecklist).slice(0, 140));
  const notRequired = await routeWrite('SIGN_DOCUMENT', { id: 'doc2' });
  checkIs('and so does a document that does not ask for one', notRequired.success === false, JSON.stringify(notRequired).slice(0, 140));

  const items = await routeWrite('SIGN_CHECKLIST_ITEM', { document_id: 'doc5', item_ids: ['it3', 'it4', 'it_from_elsewhere'] });
  check('the checklist batch signs the items it owns and counts the rest', [items.signed, items.skipped], [2, 1]);
  const itemsAgain = await routeWrite('SIGN_CHECKLIST_ITEM', { document_id: 'doc5', item_ids: ['it3'] });
  check('an item already signed is skipped rather than refused', [itemsAgain.success, itemsAgain.signed, itemsAgain.skipped], [true, 0, 1]);

  // A verification is a SEPARATE ROW about somebody else, written by the verifier - the only row a client may create
  // that is not about itself, and the rules allow it only as 'verifier'.
  await signIn('jane');
  const verified = await routeWrite('VERIFY_CHECKLIST_ITEM', { document_id: 'doc5', item_id: 'it3', user_id: 'u2' });
  check('a verifier marks a signed item', verified.verified, 1);
  const checklistRows = await rowsOf(query(collection(firestore(), 'document_signatures'), where('document_id', '==', 'doc5')));
  const verification = checklistRows.find((row) => row.signature_role === 'verifier');
  check('and the row says who it is about and who checked it', [verification.user_id, verification.signed_by_user_id], ['u2', 'u1']);
  check('which is a second row rather than an edit of the member own', checklistRows.filter((row) => row.checklist_item_id === 'it3').length, 2);

  const verifiedAgain = await routeWrite('VERIFY_CHECKLIST_ITEM', { document_id: 'doc5', item_id: 'it3', user_id: 'u2' });
  checkIs('verifying twice is a double click', verifiedAgain.success === true && verifiedAgain.already_verified === true, JSON.stringify(verifiedAgain).slice(0, 140));
  const rest = await routeWrite('VERIFY_CHECKLIST_REMAINING', { document_id: 'doc5', user_id: 'u2' });
  checkIs('and the rest of a member list goes in one call', rest.verified >= 1, JSON.stringify(rest).slice(0, 140));

  // Jane signs an item of her own, so there is a valid pair for the two refusals below to be told apart by.
  const janeSigned = await routeWrite('SIGN_CHECKLIST_ITEM', { document_id: 'doc5', item_ids: ['it4'] });
  checkIs('a second member signs their own item', janeSigned.signed === 1, JSON.stringify(janeSigned).slice(0, 140));

  // Nobody verifies their own - and this is the writer refusing, because the pair is otherwise perfectly valid.
  const ownChecklist = await routeWrite('VERIFY_CHECKLIST_ITEM', { document_id: 'doc5', item_id: 'it4', user_id: 'u1' });
  checkIs('nobody verifies their own checklist', ownChecklist.success === false, JSON.stringify(ownChecklist).slice(0, 140));

  // And a member who may not verify cannot write the row AT ALL: the pair is valid, the writer allows the attempt, and
  // the RULES refuse it - which is what makes it a property of the data rather than of a screen.
  await signIn('bo');
  const memberVerifies = await routeWrite('VERIFY_CHECKLIST_ITEM', { document_id: 'doc5', item_id: 'it4', user_id: 'u1' });
  checkIs('and a member without the permission cannot write the row either', memberVerifies.success === false, JSON.stringify(memberVerifies).slice(0, 140));

  // --- the administrator's half of documents: removal, folders, and a drag -------------------------------------------
  await signIn('jane');
  check('the signature is there to remove', (await getDoc(doc(firestore(), 'document_signatures', 'sg1'))).exists(), true);
  const removedSignature = await routeWrite('ADMIN_REMOVE_DOCUMENT_SIGNATURE', { id: 'sg1' });
  checkIs('an officer removes a signature', removedSignature.success === true, JSON.stringify(removedSignature).slice(0, 140));
  check('and the row is gone', (await getDoc(doc(firestore(), 'document_signatures', 'sg1'))).exists(), false);

  // A member cannot, even their own: the rules are the permission, not the writer.
  await signIn('bo');
  const memberRemoval = await routeWrite('ADMIN_REMOVE_DOCUMENT_SIGNATURE', { id: 'sg2' });
  checkIs('and a member cannot remove one', memberRemoval.success === false, JSON.stringify(memberRemoval).slice(0, 140));

  // A folder renames every document carrying it - and touches NOTHING else. That second half is the property the sheet's
  // version was built to protect, so it is asserted rather than assumed: the title is the witness.
  await signIn('jane');
  await routeWrite('ADMIN_SAVE_DOCUMENT', { id: 'doc6', title: 'New Policy Acknowledgement', folder: 'Policies', body: 'Read it.' });
  const renamed = await routeWrite('ADMIN_RENAME_DOCUMENT_FOLDER', { from: 'Policies', to: 'Standing Orders' });
  checkIs('a folder renames every document carrying it', renamed.renamed === 1, JSON.stringify(renamed).slice(0, 140));
  const renamedDocument = (await getDoc(doc(firestore(), 'documents', 'doc6'))).data();
  check('and nothing else about those documents moves', [renamedDocument.folder, renamedDocument.title], ['Standing Orders', 'New Policy Acknowledgement']);
  checkIs('renaming a folder to itself is not a write', (await routeWrite('ADMIN_RENAME_DOCUMENT_FOLDER', { from: 'Standing Orders', to: 'Standing Orders' })).renamed === 0);

  // A drag writes `sort_order` and nothing else. The pairs come from the client's own pure helper; what is asserted here
  // is that an honest request stays honest, including a row that is not there and a position that is not a number -
  // both skipped rather than failing the drag.
  const drag = await routeWrite('ADMIN_REORDER_DOCUMENTS', {
    order: [{ id: 'doc6', sort_order: 3 }, { id: 'a-row-that-is-gone', sort_order: 4 }, { id: 'doc1', sort_order: 'not a number' }],
  });
  check('a drag moves the rows it can name', drag.moved, 1);
  const draggedDocument = (await getDoc(doc(firestore(), 'documents', 'doc6'))).data();
  check('writing only the position', [draggedDocument.sort_order, draggedDocument.title], [3, 'New Policy Acknowledgement']);

  // --- training signatures: the same add-only shape, and a lock that means its signatures too ------------------------
  await signIn('jane');
  const signedTraining = await routeWrite('SIGN_TRAINING', { payload: { training_ids: ['tr1', 'a-training-that-is-gone'] } });
  check('a member signs the trainings they name, and is told about the ones that are not there', [signedTraining.signed, signedTraining.skipped], [1, 1]);
  const signedRow = signedTraining.signatures.find((row) => row.training_id === 'tr1');
  checkIs('with the date stamped, because an undated signature cannot be listed in order', typeof (signedRow || {}).signed_at === 'string', JSON.stringify(signedRow));

  const trainingAgain = await routeWrite('SIGN_TRAINING', { payload: { training_ids: ['tr1'] } });
  check('signing the same training twice is nothing to do rather than an error', [trainingAgain.signed, trainingAgain.skipped], [0, 0]);

  // A training entered into an external system accepts no new signatures: the lock has to mean its signatures as well as
  // its fields, or somebody attends a course that is already on the record.
  const lockedTraining = await routeWrite('SIGN_TRAINING', { payload: { training_ids: ['tr2'] } });
  checkIs('a locked training refuses a new signature', lockedTraining.success === false, JSON.stringify(lockedTraining).slice(0, 160));

  // A member cannot withdraw their OWN acknowledgment. This is the rules refusing rather than the writer, which is the
  // point: the sheet refused it in a handler, and a rule that allows a crafted request to do what a handler refuses is
  // not the rule the handler describes.
  await signIn('bo');
  const boSignature = (await rowsOf(query(collection(firestore(), 'training_signatures'), where('user_id', '==', 'u2'))))[0];
  const withdrawn = await routeWrite('ADMIN_REMOVE_TRAINING_SIGNATURE', { signature_id: boSignature.id });
  checkIs('a member cannot withdraw their own signature', withdrawn.success === false, JSON.stringify(withdrawn).slice(0, 140));

  // The administrator can, and that is the only path that ever removes one.
  await signIn('jane');
  const removedTraining = await routeWrite('ADMIN_REMOVE_TRAINING_SIGNATURE', { signature_id: 'ts1' });
  checkIs('an officer removes one', removedTraining.success === true, JSON.stringify(removedTraining).slice(0, 140));
  check('and the row is gone', (await getDoc(doc(firestore(), 'training_signatures', 'ts1'))).exists(), false);

  // --- the officer's clock management, and the on_duty row it has to keep in step -----------------------------------
  //
  // The interesting assertions here are not about the entry: they are about `on_duty`, because an officer's correction is
  // a second door onto the pair the member's own clock-in writes in a transaction. A correction that closes somebody's
  // entry and leaves them "on duty" is the dashboard lying, which is the bug that pairing exists to prevent.
  await signIn('jane');
  const closedEntry = await routeWrite('ADMIN_SAVE_TIMECLOCK_ENTRY', {
    id: 'c1',
    user_id: 'u1',
    time_in: '2026-03-02 07:55',
    time_out: '2026-03-02 17:00',
  });
  checkIs('an officer corrects an entry', closedEntry.success === true && closedEntry.id === 'c1', JSON.stringify(closedEntry).slice(0, 140));
  const closedRow = (await getDoc(doc(firestore(), 'timeclock', 'c1'))).data();
  check('and the entry is marked as written by a person', closedRow.is_manual, true);
  check('while closing it takes the member OFF duty', (await getDoc(doc(firestore(), 'on_duty', 'u1'))).exists(), false);

  // Reopening it puts them back, from the entry's own time rather than from now.
  await routeWrite('ADMIN_SAVE_TIMECLOCK_ENTRY', { id: 'c1', user_id: 'u1', time_in: '2026-03-02 07:55', time_out: '' });
  const backOnDuty = await getDoc(doc(firestore(), 'on_duty', 'u1'));
  check('and reopening it puts them back on duty', [backOnDuty.exists(), backOnDuty.data().time_in], [true, '2026-03-02 07:55']);

  // Deleting the only open entry is the same promise from the other direction.
  const deletedEntry = await routeWrite('ADMIN_DELETE_TIMECLOCK_ENTRY', { id: 'c1' });
  checkIs('an officer deletes an entry', deletedEntry.success === true, JSON.stringify(deletedEntry).slice(0, 140));
  check('and that takes them off duty too', (await getDoc(doc(firestore(), 'on_duty', 'u1'))).exists(), false);
  check('with the row gone', (await getDoc(doc(firestore(), 'timeclock', 'c1'))).exists(), false);

  const missingEntry = await routeWrite('ADMIN_DELETE_TIMECLOCK_ENTRY', { id: 'an-entry-that-is-gone' });
  checkIs('deleting what is not there is answered rather than thrown', missingEntry.success === false, JSON.stringify(missingEntry).slice(0, 140));

  // A member cannot write somebody else's clock: the rules, not the writer - which is what stops the management tab's
  // power being available to anyone who can open a console.
  await signIn('bo');
  const memberEntry = await routeWrite('ADMIN_SAVE_TIMECLOCK_ENTRY', {
    id: '',
    user_id: 'u1',
    time_in: '2026-03-03 08:00',
    time_out: '2026-03-03 16:00',
  });
  checkIs('and a member cannot add an entry for somebody else', memberEntry.success === false, JSON.stringify(memberEntry).slice(0, 140));

  // --- the member's own settings ------------------------------------------------------------------------------------
  //
  // A MERGE, and three things about it are asserted because each is a way to be wrong quietly: an absent preference must
  // stay absent (writing false is how a form that never asked silently unsubscribes somebody), the flags must be real
  // booleans rather than the strings the form sends, and a device token must not be copied into this document.
  await signIn('bo');
  await routeWrite('UPDATE_USER_SETTINGS', {
    payload: { id: 'u2', time_format: '24', is_dark_mode: 'true', notify_announcements: 'FALSE' },
  });
  const boSettings = (await getDoc(doc(firestore(), 'user_settings', 'u2'))).data();
  check('the settings form writes the member own row', [boSettings.time_format, boSettings.is_dark_mode, boSettings.notify_announcements], ['24', true, false]);
  check('with the flags as real booleans, not the strings the form sends', [typeof boSettings.is_dark_mode, typeof boSettings.notify_announcements], ['boolean', 'boolean']);

  await routeWrite('UPDATE_USER_SETTINGS', { payload: { id: 'u2', time_format: '12' } });
  const boAfter = (await getDoc(doc(firestore(), 'user_settings', 'u2'))).data();
  check('a second save changes only what it sent', boAfter.time_format, '12');
  check('and an earlier preference survives it', boAfter.notify_announcements, false);
  check('while a preference nobody ever mentioned is not invented', Object.keys(boAfter).includes('notify_offer_approved'), false);

  await routeWrite('UPDATE_USER_SETTINGS', { payload: { id: 'u2', fcm_token: 'a-device-token' } });
  check('and a device token is not written into the settings document', Object.keys((await getDoc(doc(firestore(), 'user_settings', 'u2'))).data()).includes('fcm_token'), false);

  // Somebody else's row is refused by the RULES rather than by the dispatcher, which defaults to the session but cannot
  // stop a hand-made request naming anybody.
  const janeSettingsAttempt = await routeWrite('UPDATE_USER_SETTINGS', { payload: { id: 'u1', time_format: '24' } });
  checkIs('and a member cannot write somebody else settings', janeSettingsAttempt && janeSettingsAttempt.success === false, JSON.stringify(janeSettingsAttempt).slice(0, 140));

  // --- push devices: the member's own card, and the administrator's switch -----------------------------------------
  //
  // Registering is a CALLABLE, and the assertions here are the reasons why: an ordinary registration is a member writing
  // their own row, a device that belongs to somebody else is refused WITH THEIR NAME (which the rules cannot say), and
  // a transfer is allowed, logged, and visible in the audit trail - because neither member can see it from their side.
  await signIn('bo');
  const boRegister = await routeWrite('REGISTER_PUSH_DEVICE', {
    device_token: 'token-of-jane-phone',
    device_label: 'Shared station phone',
  });
  checkIs('a member registers their own device', boRegister && boRegister.success === true, JSON.stringify(boRegister).slice(0, 140));

  // Jane tries to claim the same browser without asking for a transfer: refused, and told whose it is.
  await signIn('jane');
  const stolen = await routeWrite('REGISTER_PUSH_DEVICE', {
    device_token: 'token-of-jane-phone',
    device_label: "Jane's laptop",
  });
  checkIs('another member cannot take it without a transfer', stolen && stolen.success === false, JSON.stringify(stolen).slice(0, 140));
  checkIs('and the refusal names the owner so the card can offer the button', stolen.owner_name === 'Bo Jones', String(stolen.owner_name));

  // With the transfer the card's button sends, it moves - and the move is audited, which is the second reason this is a
  // function: a client cannot write a log row at all.
  const moved = await routeWrite('REGISTER_PUSH_DEVICE', {
    device_token: 'token-of-jane-phone',
    device_label: "Jane's laptop",
    transfer: true,
  });
  checkIs('a transfer moves it', moved && moved.success === true, JSON.stringify(moved).slice(0, 140));
  const transferRows = await rowsOf(query(collection(firestore(), 'system_log'), where('action', '==', 'PUSH_DEVICE_TRANSFERRED')));
  checkIs('and is recorded in the audit log', transferRows.length >= 1, `${transferRows.length} rows`);
  const afterMove = await rowsOf(query(collection(firestore(), 'push_devices'), where('token', '==', 'token-of-jane-phone')));
  check('with the new owner on the row', afterMove.map((row) => row.user_id), ['u1']);

  // The administrator's switch, and its asymmetry: turning it off FORGETS the devices as well as setting the flag,
  // because the member's card re-registers any subscription its browser still holds the moment settings are opened.
  const turnedOff = await routeWrite('ADMIN_SET_PUSH_DISABLED', { user_id: 'u1', disabled: true });
  checkIs('an officer turns notifications off for a member', turnedOff && turnedOff.success === true, JSON.stringify(turnedOff).slice(0, 140));
  const devicesAfter = await rowsOf(query(collection(firestore(), 'push_devices'), where('user_id', '==', 'u1')));
  check('and that member device rows are forgotten', devicesAfter.length, 0);
  const flagRow = await getDoc(doc(firestore(), 'user_settings', 'u1'));
  check('with the flag set on their settings', flagRow.data().is_push_disabled, true);

  // The block holds at the DOOR, not at the card: a member whose browser still holds a subscription cannot register it
  // again while an administrator has switched them off.
  await signIn('jane');
  const blocked = await routeWrite('REGISTER_PUSH_DEVICE', {
    device_token: 'token-of-jane-phone',
    device_label: 'Try again',
  });
  checkIs('and the member cannot register a device again', blocked.code === 'PUSH_DISABLED_BY_ADMIN', JSON.stringify(blocked).slice(0, 140));

  // Lifting it clears the flag only: the device has to be enabled again from the device itself.
  await routeWrite('ADMIN_SET_PUSH_DISABLED', { user_id: 'u1', disabled: false });
  check('turning it back on clears the flag', (await getDoc(doc(firestore(), 'user_settings', 'u1'))).data().is_push_disabled, false);

  // Unregistering is an ordinary client delete of the member's own row, which the rules allow without a function.
  const boAgain = await routeWrite('REGISTER_PUSH_DEVICE', { device_token: 'token-of-bo-tablet', device_label: 'Tablet' });
  checkIs('a device registers for bo again', boAgain && boAgain.success === true, JSON.stringify(boAgain).slice(0, 140));
  const removed = await routeWrite('UNREGISTER_PUSH_DEVICE', { device_token: 'token-of-bo-tablet' });
  checkIs('and the member can forget it', removed && removed.success === true, JSON.stringify(removed).slice(0, 140));
  const gone = await rowsOf(query(collection(firestore(), 'push_devices'), where('token', '==', 'token-of-bo-tablet')));
  check('leaving no row behind', gone.length, 0);

  // The FCM status, which is the runtime answering for itself: there is nothing to configure on Firebase, so the honest
  // answer is "ready" plus the device count - and this also proves the count aggregation works in the deployed runtime,
  // which no other assertion touches.
  const fcm = await routeRead('ADMIN_GET_FCM_STATUS');
  checkIs('the runtime reports that it can send notifications', fcm.ready === true, JSON.stringify(fcm).slice(0, 140));
  checkIs('with the device count alongside it', typeof fcm.devices === 'number', String(fcm.devices));

  // The system log, one page at a time: the last read in the app, and the one whose answer is more than a page. The
  // fixtures live in March 2026 while the audit rows this harness provokes are written "now", so a date range that stops
  // in March isolates the fixtures from everything else in the collection - which is what makes these deterministic
  // rather than hopeful.
  const readSystemLog = httpsCallable(firebaseFunctions(), 'readSystemLog');
  const march = { from: '2026-03-01', to: '2026-03-31' };
  await signIn('jane');

  const firstPage = await readSystemLog({ ...march, page_size: 2 });
  check('the log answers the contract version the tab checks', firstPage.data.api, 2);
  check('the fixtures page in timestamp order, newest first', firstPage.data.rows.map((row) => row.id), ['log4', 'log2']);
  // Five rows in March, not four: the seed has an audit row of its own (l1, 2026-03-02 08:00:00), and it is welcome here
  // - it holds station-time text in `created_at`, which is the OTHER legacy shape, and it sorts between log1 and log3.
  check('and the counts describe the filtered set', [firstPage.data.total, firstPage.data.total_pages, firstPage.data.page], [5, 3, 1]);

  const secondPage = await readSystemLog({ ...march, page_size: 2, page: 2 });
  check('the second page holds the rest', secondPage.data.rows.map((row) => row.id), ['log1', 'l1']);
  const thirdPage = await readSystemLog({ ...march, page_size: 2, page: 3 });
  const pastTheEnd = await readSystemLog({ ...march, page_size: 2, page: 99 });
  checkIs('a page past the end is clamped to the last page rather than rendering empty', pastTheEnd.data.page === 3 && pastTheEnd.data.rows.length === 1, String(pastTheEnd.data.page));

  // The two legacy timestamps, both CONVERTED or normalized rather than trimmed:
  //   log3 carries an ISO `created_at` and no `timestamp` at all, and 12:00 UTC is 07:00 in station time in March -
  //   rendering it as 12:00 would look like a real time rather than like a bug.
  //   l1 carries station-time text in `created_at` (what a row written before both fields existed looks like), which
  //   has to be read as it stands rather than re-parsed as if it were UTC.
  check('an ISO timestamp is converted to station time', thirdPage.data.rows[0].timestamp, '2026-03-02 07:00:00');
  check('and station-time text in created_at is taken as it stands', secondPage.data.rows[1].timestamp, '2026-03-02 08:00:00');

  // The action filter is case-INSENSITIVE, as the sheet matched it: a station whose log holds both 'USER_LOGIN' and
  // 'user_login' sees one group rather than two. Whole value, though - not a prefix.
  const lowercase = await readSystemLog({ ...march, action_filter: 'user_login' });
  check('the action filter matches a differently-cased action', lowercase.data.rows.map((row) => row.id).sort(), ['log1', 'log3']);
  check('and it matches the whole value rather than a prefix', (await readSystemLog({ ...march, action_filter: 'CLOCK' })).data.total, 0);

  const byMember = await readSystemLog({ ...march, member: 'u2' });
  check('the member filter matches on the id', byMember.data.rows.map((row) => row.id), ['log4', 'log2']);

  const oneDay = await readSystemLog({ from: '2026-03-04', to: '2026-03-04' });
  check('a one-day range includes both of that day\u2019s rows', oneDay.data.rows.map((row) => row.id), ['log2', 'log1']);

  const byMemberAsc = await readSystemLog({ ...march, sort: 'member_asc' });
  check('member order sorts by id, newest first within it', byMemberAsc.data.rows.map((row) => row.id), ['log1', 'l1', 'log3', 'log4', 'log2']);
  const byActionAsc = await readSystemLog({ ...march, sort: 'action_asc' });
  check('action order sorts by action, newest first within it', byActionAsc.data.rows.map((row) => row.id), ['log2', 'l1', 'log4', 'log1', 'log3']);
  check('an unknown sort falls back to the default rather than to unsorted', (await readSystemLog({ ...march, sort: 'nonsense' })).data.sort, 'timestamp_desc');

  // The facets come from the WHOLE log rather than the page, because a dropdown offering only the values on the current
  // page could never select the value somebody is looking for.
  check(
    'the action facets cover the whole log',
    // Case-insensitive on purpose: the facets carry the RAW values, which is what lets this list hold both 'USER_LOGIN'
    // and 'user_login' - and a case-sensitive filter here would silently skip the lowercase one and prove nothing.
    firstPage.data.actions.filter((action) => /login|clock|sign_in/i.test(action)).sort(),
    ['CLOCK_IN', 'SIGN_IN_FAILED', 'USER_LOGIN', 'user_login']
  );
  check('and the member facets are ids, which the roster puts names to', firstPage.data.members.includes('u2'), true);
  checkIs('and the log total counts every row, not just the filtered ones', firstPage.data.log_total >= 4, String(firstPage.data.log_total));

  // The permission, checked where it cannot be talked around: the tab is officer-only, and the log names members and
  // records failed sign-ins. Bo is a firefighter, and the seed gives that role no `can_view_system_log`.
  await signOut(firebaseAuth());
  await refused('nobody signed in cannot read the log at all', 'functions/unauthenticated', () => readSystemLog({ ...march }));
  await signIn('bo');
  await refused('a member without the permission cannot read the log', 'functions/permission-denied', () => readSystemLog({ ...march }));
  await signIn('jane');

  // --- the runner: a personal best, and the board that shows it ---
  console.log('\n--- the runner ---');
  await signIn('bo');
  // The seed leaves u2 with no runner_score, so the first run is the first personal best.
  check('a first run is stored', await routeWrite('SAVE_RUNNER_SCORE', { score: 120 }), { success: true, best: 120, improved: true });
  // A worse run is not a personal best: nothing is written, and the answer carries the score that still stands, which is
  // what lets the game say "your best is 120" without a second read.
  check('a worse run changes nothing', await routeWrite('SAVE_RUNNER_SCORE', { score: 90 }), { success: true, best: 120, improved: false });
  check('so the stored score is untouched', (await getDoc(doc(db, 'users', 'u2'))).data().runner_score, 120);
  check('and an equal run is not a new best either', await routeWrite('SAVE_RUNNER_SCORE', { score: 120 }), {
    success: true,
    best: 120,
    improved: false,
  });

  // The clamp, which is the whole reason this is a callable rather than a client write: the board is SHARED, so an
  // impossible number must not reach it. 999999 becomes the station's ceiling rather than a refusal, because a doctored
  // request is not an error worth explaining to whoever sent it.
  check('an impossible score is clamped to the ceiling', await routeWrite('SAVE_RUNNER_SCORE', { score: 999999 }), {
    success: true,
    best: 100000,
    improved: true,
  });
  check('and the ceiling is what is stored', (await getDoc(doc(db, 'users', 'u2'))).data().runner_score, 100000);
  // A refusal here is a REPLY rather than a throw: routed writes catch their errors and answer with failureFor(), which
  // is what the app's screens branch on. So these assert the reply, not an exception.
  const notANumber = await routeWrite('SAVE_RUNNER_SCORE', { score: 'lots' });
  checkIs('a score that is not a number is refused', notANumber.success === false, JSON.stringify(notANumber));
  checkIs('and the reason says what a score has to be', /number/i.test(notANumber.message || ''), JSON.stringify(notANumber));

  // The board, read as bo - a plain firefighter with no permission at all, which is the claim: "anyone who can play can
  // see the board". The projection matters as much as the contents: an id to highlight your own row, a name, a score,
  // and nothing else out of anybody's personnel record.
  // Named runnerBoard rather than board: the schedule board's section above owns that name, and this harness runs in one
  // scope.
  const runnerBoard = await routeRead('GET_RUNNER_LEADERBOARD', {});
  check('a member with no permission reads the board', runnerBoard.leaderboard.map((row) => row.id), ['u2']);
  check('carrying a name rather than just an id', runnerBoard.leaderboard[0].name, 'Bo Jones');
  check('and the score', runnerBoard.leaderboard[0].score, 100000);
  check('and the total counts everybody with a score', runnerBoard.total, 1);
  check('and the row is exactly three fields', Object.keys(runnerBoard.leaderboard[0]).sort(), ['id', 'name', 'score']);
  checkIs(
    'a member with no score is left off the board entirely',
    runnerBoard.leaderboard.every((row) => row.score > 0),
    JSON.stringify(runnerBoard.leaderboard)
  );

  // --- deleting a member: the account, the documents, and what is deliberately kept ---
  console.log('\n--- deleting a member ---');
  await signIn('bo');
  const boDelete = await routeWrite('ADMIN_DELETE_USER', { id: 'u1' });
  checkIs('a member cannot delete anybody', boDelete.success === false, JSON.stringify(boDelete));
  // Refused for WHO HE IS rather than for what he asked: the answer names the permission, and the roster row is untouched.
  checkIs('and the reason is the permission, not the record', /permission/i.test(boDelete.message || ''), JSON.stringify(boDelete));
  check('and the other member is still there', (await getDoc(doc(db, 'users', 'u1'))).exists(), true);

  await signIn('jane');
  // Yourself: the surest way to leave a station with nobody who can administer it, and there is no undoing it. (The
  // same hole - the LAST administrator - is guarded too, but a seed with one administrator cannot reach it: this case
  // is the one that fires first here, and with more than one administrator the other is what protects the station.)
  const selfDelete = await routeWrite('ADMIN_DELETE_USER', { id: 'u1' });
  checkIs('an officer cannot delete their own account', selfDelete.success === false, JSON.stringify(selfDelete));
  checkIs('and is told why', /your own account/i.test(selfDelete.message || ''), JSON.stringify(selfDelete));
  // Somebody who is not there is answered rather than thrown, because the members tab shows the message.
  check('deleting somebody who does not exist is answered', await routeWrite('ADMIN_DELETE_USER', { id: 'u404' }), {
    success: false,
    message: 'User not found.',
  });

  // A real deletion, on a seeded member, because the seed is re-run at the top of every run. Bo's records are what make
  // this worth doing: the clock entry from the section at the top of this file is HISTORY, and it has to survive him.
  await signIn('bo');
  await routeWrite('REGISTER_PUSH_DEVICE', { device_token: 'device-to-be-orphaned', device_label: 'Delete me' });
  await signIn('jane');
  check('the member is deleted', await routeWrite('ADMIN_DELETE_USER', { id: 'u2' }), { success: true, message: 'User deleted.' });
  check('so the roster row is gone', (await getDoc(doc(db, 'users', 'u2'))).exists(), false);
  check('and any on-duty row with it', (await getDoc(doc(db, 'on_duty', 'u2'))).exists(), false);
  // The device: a row that outlives its member keeps delivering a departed member's alerts to a phone nobody in the
  // roster owns any more.
  check(
    'and their push devices, so nothing is delivered to a stranger',
    (await rowsOf(query(collection(db, 'push_devices'), where('user_id', '==', 'u2')))).length,
    0
  );
  // ...and the records stay. This is the deliberate half: who was on duty that night does not stop being true because
  // somebody has left, and the sheet kept them too.
  check('but the clock entry they made is kept as history', (await getDoc(doc(db, 'timeclock', entryId))).exists(), true);
  check('and deleting them again says so rather than failing', await routeWrite('ADMIN_DELETE_USER', { id: 'u2' }), {
    success: false,
    message: 'User not found.',
  });

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
