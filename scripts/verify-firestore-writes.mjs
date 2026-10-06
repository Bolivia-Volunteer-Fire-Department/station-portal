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
import { readFileSync } from 'node:fs';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { DEMO_PASSWORD, seed } from './seed-emulator.mjs';
import { firebaseAuth, firebaseFunctions, firestore } from '../src/services/firebase.js';
import { routeRead, routeWrite } from '../src/services/firestoreRouting.js';
// The app's OWN payload builder, rather than a body assembled in this file. That distinction is the whole reason the
// ranks section below exists: with `routeWrite` called directly the request body is written HERE, so it carries
// whatever this harness puts in it - and a column `adminSaveRank` forgot to send sails straight through to the
// emulator. Reintroducing that fault left the section green, which is how the gap was found.
//
// The builder is imported from utils rather than from services/api.js because api.js is a browser module: it pulls in
// the Firebase SDK through extensionless specifiers, which plain Node ESM does not resolve, so it cannot be imported
// here at all. The helper is pure and has no imports beyond the eligibility rule it shares a definition with.
// The board's own swap helper: the entries below are built with the code the client runs, so this cannot drift from
// what a swap really sends. It has no imports of its own, which is what makes it usable from here at all.
import { swapSlotFields } from '../src/utils/scheduleDrop.js';
// The approvals-row derivation, so the offers section can assert what the OFFICER'S TABLE shows rather than only what
// the row holds: "the offer carries its template" is not the same claim as "the queue shows a time".
import { describeShiftOffer } from '../src/utils/shiftOfferRow.js';
// The checklist arithmetic, so the back-fill section can assert that the rows it writes move the member's own progress -
// which is the claim that matters, and not the same as "the row exists".
import { checklistProgress } from '../src/utils/checklists.js';
import { syntheticEmail } from '../src/services/firebaseAuth.js';
import { settingSide } from '../src/utils/systemSettings.js';
import { OFFLINE_CLOCK_MESSAGE } from '../src/utils/connectivity.js';
import { rankFieldsFromForm } from '../src/utils/ranks.js';
// The document order helper, for the round trip at the documents section below: the reply the drag route really sends,
// fed through the function the tab really uses, so "what ends up on screen" is asserted rather than described. It loads
// under plain Node because its own imports carry `.js` specifiers - which is not true of services/api.js, and is why the
// helper lives in utils at all.
import {
  applyDocumentOrder,
  checklistItemSortOrder,
  documentOrderSignature,
  documentVerificationState,
  groupDocumentsByFolder,
  normalizeChecklistItemList,
  pendingDocumentOrderPairs,
} from '../src/utils/documents.js';
// The app's OWN badge registry, so the round trip at the badge section below is checked by what it DRAWS rather than
// by what the reply looks like - "is this the index?" is not a shape a reader can eyeball. Pure and import-free, which
// is what makes it usable from plain Node at all.
import { certificationBadgesFor, setCertificationBadges } from '../src/utils/certifications.js';
import {
  approveOffer,
  audienceKeysForWrite,
  badgeForRecord,
  makeOffer,
  saveAvailabilityMonth,
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

// Making the device answer "no connection", for the clock guard. The property is SHADOWED on the existing navigator rather
// than the global being replaced, so everything else the runtime and the SDKs read there stays intact; deleting the shadow
// restores whatever the platform said (in Node, nothing - which the guard reads as online).
const setOffline = (offline) => {
  if (!globalThis.navigator) return;
  if (!offline) {
    delete globalThis.navigator.onLine;
    return;
  }
  Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true, writable: true });
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
  const clockInReply = await routeWrite('CLOCK_IN', { gps_lat: '39.123', gps_lon: '-79.123' });
  checkIs('the routed clock-in succeeds', clockInReply.success === true, JSON.stringify(clockInReply));
  const entryId = clockInReply.id;
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
  const secondClockIn = await routeWrite('CLOCK_IN', { gps_lat: '', gps_lon: '' });
  check('a second clock-in is refused', secondClockIn.code, 'REFUSED');
  check('with the duplicate-clock message', secondClockIn.message, 'You are already clocked in.');
  // --- clocking out: the mirror ---
  console.log('\n--- and clocks out ---');
  const clockOutReply = await routeWrite('CLOCK_OUT', {});
  checkIs('the routed clock-out succeeds', clockOutReply.success === true, JSON.stringify(clockOutReply));
  const closed = (await getDoc(doc(db, 'timeclock', entryId))).data();
  checkIs('the entry is closed', /^\d{4}-\d{2}-\d{2} /.test(closed.time_out), JSON.stringify(closed.time_out));
  check('and the on-duty row went with it', (await getDoc(doc(db, 'on_duty', 'u2'))).exists(), false);
  const secondClockOut = await routeWrite('CLOCK_OUT', {});
  check('clocking out twice is refused', secondClockOut.code, 'REFUSED');
  const forgedClockOut = await httpsCallable(firebaseFunctions(), 'clockOut')({ entryId: 'c1' }).then(
    () => 'closed',
    (error) => error.code
  );
  checkIs('somebody else entry cannot be closed by a direct callable', forgedClockOut === 'functions/permission-denied', forgedClockOut);

  // --- offline: the pair of writes that must NOT queue ------------------------------------------------------------------
  //
  // A queued clock-in carries the DEVICE's clock rather than the server's (the README, "Offline"), so a member
  // in a dead spot would create a record asserting they arrived at a time nobody can vouch for - and that record is what the
  // station uses to say who was on duty. The guard lives in the WRITER, which is why this asserts through BOTH doors: the
  // function the app calls, and the route it travels.
  //
  // The assertion that matters most is that NOTHING was written. A refusal that still leaves a shift open behind it is worse
  // than the queued write it was avoiding - and the last two checks are the other half of the rule: the guard covers the
  // clock and NOTHING else, because a station with patchy coverage must keep accepting the writes that queue safely.
  console.log('\n--- the write layer never shadows a helper it calls ---');
  // THE BUG THIS EXISTS FOR WAS LIVE, and it is the reason "New window" did not save: `saveDocument({ collection, id, body })`
  // bound the SDK's `collection()` to a local of the same name, then called it to mint an id when the caller had none. So
  // every CREATE through that helper - New window, New shift, New role, New checklist item - died with "collection is not a
  // function", while editing an existing row (which passes an id, and never reaches that branch) worked perfectly.
  //
  // Neither the build nor the linter can see it: shadowing an import is valid JavaScript. And no harness had ever created a
  // document through this helper, so the first thing to try was an officer pressing Add window.
  //
  // The rule is mechanical, so it is checked mechanically: an SDK name that is BOTH bound by a shorthand destructure and
  // CALLED in the same file is an import that cannot be reached - the call is a TypeError. Binding it under a different
  // name (`{ collection: collectionName }`) is the fix, and is exactly what this allows.
  const writesSource = readFileSync('src/services/firestoreWrites.js', 'utf8');
  // The source with the three things that are NOT code removed: whole import STATEMENTS (an import list is a
  // `{ collection, doc, ... }` that matches every name by construction, and this file's runs over several lines), block
  // comments, and whole-line comments - because the comments above quote the broken line verbatim, and a detector that
  // fires on its own documentation is worse than none.
  const code = writesSource
    .replace(/^\s*import[\s\S]*?from\s*'[^']*';?/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const shadowsSdkName = (source, name) =>
    new RegExp(`[{,]\\s*${name}\\s*[,}]`).test(source) && new RegExp(`(?<![.\\w])${name}\\(`).test(source);
  const sdkNames = [...writesSource.matchAll(/import\s*\{([^}]*)\}\s*from\s*'firebase\/firestore'/g)]
    .flatMap((match) => match[1].split(',').map((part) => part.trim().split(/\s+as\s+/).pop()))
    .filter(Boolean);
  check('the write layer imports the SDK this checks against', sdkNames.includes('collection') && sdkNames.includes('doc'), true);
  check(
    'no SDK helper is shadowed by a binding of its own name',
    sdkNames.filter((name) => shadowsSdkName(code, name)),
    []
  );
  // And the check bites: the line as it was written is caught, so a reintroduction fails here rather than in front of an
  // officer who cannot save their first shift.
  check(
    'and it catches the binding it was written for',
    shadowsSdkName(
      'const { collection, id } = body;\nconst target = doc(collection(firestore(), collection)).id;',
      'collection'
    ),
    true
  );

  console.log('\n--- offline: clocking in refuses rather than queues ---');
  setOffline(true);
  const offlineRoute = await routeWrite('CLOCK_IN', { gps_lat: '', gps_lon: '', is_manual: false });
  check('the route answers with the sentence, not a transport error', offlineRoute.message, OFFLINE_CLOCK_MESSAGE);
  check('and says it was refused', offlineRoute.code, 'REFUSED');
  check('no shift was opened behind the refusal', (await getDoc(doc(db, 'on_duty', 'u2'))).exists(), false);
  const openEntries = await getDocs(query(collection(db, 'timeclock'), where('user_id', '==', 'u2'), where('time_out', '==', '')));
  check('and no entry was left open either', openEntries.docs.length, 0);
  // A REAL month, because the write is now "here is the month" and an empty payload is refused - which is the guard doing
  // its job (a missing month would otherwise write an empty document over a month the member had marked).
  const otherWrite = await routeWrite('SET_MY_AVAILABILITY', { month: '2026-10', claims: { aw1: ['2026-10-06'] } });
  checkIs('while a write that queues safely still goes through', otherWrite.success === true, JSON.stringify(otherWrite));
  setOffline(false);
  const backOnline = await routeWrite('CLOCK_IN', { gps_lat: '', gps_lon: '', is_manual: false });
  checkIs('and the same clock-in works the moment there is a connection', backOnline.success === true, JSON.stringify(backOnline));
  // Put the member back where this section found them, so the sections after it are unaffected by it.
  if (backOnline.id) await routeWrite('CLOCK_OUT', {});

  console.log('\n--- availability ---');
  // ONE WRITE REPLACES THE MONTH: the screen sends the month it was editing and the marks it now holds, and the document
  // is overwritten wholesale (utils/availability.js). So the cases worth asserting are that the whole month is one
  // document, and that a save REPLACES rather than merges - a merge would leave an un-marked day behind, which is the bug
  // this shape makes structurally impossible.
  const saved = await saveAvailabilityMonth({
    userId: 'u2',
    month: '2026-09',
    claims: { aw1: ['2026-09-01', '2026-09-08'], aw2: ['2026-09-05'] },
  });
  check('the month is written as one document', saved.id, 'u2_2026-09');
  check('and the write reports what it holds', saved.claimed, 3);
  const monthDoc = (await getDoc(doc(db, 'availability_months', 'u2_2026-09'))).data();
  check('carrying the owner and the month', [monthDoc.user_id, monthDoc.month], ['u2', '2026-09']);
  check('and the claims map the screen sent', monthDoc.claims, {
    aw1: ['2026-09-01', '2026-09-08'],
    aw2: ['2026-09-05'],
  });
  // THE REPLACEMENT CASE, and the reason it is here: two days simply are not in the map any more. Nothing was deleted by
  // id, because there are no row ids left to delete - so this is the assertion that un-marking actually un-marks.
  await saveAvailabilityMonth({ userId: 'u2', month: '2026-09', claims: { aw1: ['2026-09-01'] } });
  const replaced = (await getDoc(doc(db, 'availability_months', 'u2_2026-09'))).data();
  check('a save replaces the month rather than merging into it', replaced.claims, { aw1: ['2026-09-01'] });
  await refused(
    'an availability month cannot be written for somebody else',
    'permission-denied',
    () => saveAvailabilityMonth({ userId: 'u1', month: '2026-09', claims: { aw1: ['2026-09-15'] } })
  );

  // --- the windows those claims are made against -------------------------------------------------
  // Windows are edited here too, and they have their OWN permission: shaping the station's week is a different job from
  // correcting one member's claims, so the rules ask for `can_edit_availability_windows` rather than sharing the
  // availability permission as they used to. The seed has two roles - an administrator and a firefighter - so this is the
  // case that proves which of them may, which is the whole reason the split was worth making.
  const sundayWindow = {
    // NO ID: this is the "New window" path, and it is the one that matters. The id is empty, so the write has to MINT one
    // - and that is the branch that was broken, because the helper called the SDK's `collection()` through a parameter
    // that shadowed it ("collection is not a function"). Passing an id here, as this case first did, skips that branch
    // entirely and lets the bug through, so the empty id is deliberate and load-bearing.
    id: '',
    nickname: 'Sunday day',
    start_time: '08:00',
    end_time: '18:00',
    is_sunday: true,
    effective_date: '2026-01-01',
    end_date: '',
  };
  await signIn('bo');
  const windowAttempt = await routeWrite('ADMIN_SAVE_AVAILABILITY_WINDOW', sundayWindow);
  checkIs(
    'a member without the windows permission cannot save one',
    windowAttempt && windowAttempt.success === false,
    JSON.stringify(windowAttempt).slice(0, 160)
  );
  await signIn('jane');
  const created = await routeWrite('ADMIN_SAVE_AVAILABILITY_WINDOW', sundayWindow);
  checkIs('but an officer with it can', created.success === true, JSON.stringify(created).slice(0, 160));
  checkIs(
    'and the id the server minted comes back to the caller',
    typeof created.id === 'string' && created.id.length > 0,
    JSON.stringify(created.id)
  );
  const savedWindow = (await getDoc(doc(firestore(), 'availability_windows', created.id))).data();
  check('and the window is on the list every member reads', savedWindow?.nickname, 'Sunday day');
  check('with its days intact', savedWindow?.is_sunday, true);
  // AND THE LIST MUST HAND THE ID BACK. A save body carries `id` - empty when it is creating - and anything that reads that
  // field back over the document key leaves the row with no identity at all: Edit would save a SECOND window and Delete
  // would do nothing. So the assertion is that the id the server minted is the id the officer's own list shows.
  const listed = await routeRead('ADMIN_GET_AVAILABILITY_WINDOWS');
  const listedWindow = (listed.availabilityWindows || []).find((row) => row.nickname === 'Sunday day');
  check('and the officer list hands back the id the server minted', listedWindow?.id, created.id);
  // Put the session back where this section found it, so the offers below are raised by the member they are about.
  await signIn('bo');

  // --- ranks: the save carries the order, and the rules do not refuse it ---
  //
  // THE ROUND TRIP, against the emulator. The Ranks tab collected a rank's order and `adminSaveRank` never sent it, so
  // the number never reached Firestore while the save reported SUCCESS - which no rule, no source check and no server
  // render can see, because every one of those was looking at a save that was never asked to carry the field.
  //
  // So this writes through the SAME route the tab uses and reads the document back, because the claim being made is
  // "the number is in Firestore", and only a database can make that claim. The two halves that could have hidden it are
  // both covered: the payload carrying it (scripts/verify-write-safety.mjs) and the document holding it (here).
  console.log('\n--- ranks: the order reaches the document ---');
  await signIn('jane');
  // THROUGH THE APP'S OWN PAYLOAD BUILDER, which is the whole point and the first version of this case got wrong.
  // Calling `routeWrite` directly - as the sections above do - builds the request body HERE, in the harness, so it
  // passes whatever the test bothers to write and proves nothing about the app: reintroducing the fault (dropping
  // `rank_order` from the rank payload) left this section green, because the body the harness sent still had it.
  //
  // `rankFieldsFromForm` is what `adminSaveRank` spreads into its request, so the columns under test are the app's. The
  // envelope is assembled here for the same reason every other section assembles one: `id` and `row_version` are the
  // save's to carry, and the write strips them before it reaches Firestore (`withoutEnvelope` in firestoreWrites.js).
  const rankPayload = (form) => ({
    action: 'ADMIN_SAVE_RANK',
    id: form.id || '',
    ...rankFieldsFromForm(form),
  });

  await signIn('jane');
  const rankAttempt = await routeWrite(
    'ADMIN_SAVE_RANK',
    rankPayload({
      id: '',
      description: 'Rescue Tender',
      color: '#c2410c',
      icon: 'truck',
      rank_order: '4',
    })
  );
  checkIs(
    'an officer with the ranks permission saves one',
    rankAttempt && rankAttempt.success === true,
    JSON.stringify(rankAttempt).slice(0, 160)
  );
  const savedRank = (await getDoc(doc(db, 'ranks', rankAttempt.id))).data();
  // THE CLAIM. A rank document with no `rank_order` is not a rank the eligibility rule can use: an assignment's
  // `rank_order_required` has nothing to compare against, so every member's eligibility for it becomes unverifiable.
  check('and the order it was saved with is on the document', savedRank?.rank_order, '4');
  check('along with the rest of the rank', savedRank?.description, 'Rescue Tender');

  // EDITING IT, which is the other half of the report - and the same payload, so a fix that only covered the create
  // would still leave this broken.
  const reordered = await routeWrite(
    'ADMIN_SAVE_RANK',
    rankPayload({
      id: rankAttempt.id,
      description: 'Rescue Tender',
      color: '#c2410c',
      icon: 'truck',
      rank_order: '7',
    })
  );
  checkIs('and the same save edits it', reordered && reordered.success === true, JSON.stringify(reordered).slice(0, 160));
  check(
    'with the new order on the document',
    (await getDoc(doc(db, 'ranks', rankAttempt.id))).data()?.rank_order,
    '7'
  );

  // CLEARING IT. The blank is the case worth pinning: `Number('')` is 0, and an order of 0 is a real rank at the
  // bottom of the list, so a "helpful" coercion here would quietly change who may fill what rather than clearing
  // anything. What the tab writes is what the document must hold.
  // The FULL form, as the tab always sends it, and the result asserted - both because `setDoc` rejects an undefined
  // field (so a partial body would fail the write outright) and because `routeWrite` swallows a thrown write into a
  // failure object rather than raising, which is how a save that changed nothing can look like one that worked.
  const clearAttempt = await routeWrite(
    'ADMIN_SAVE_RANK',
    rankPayload({
      id: rankAttempt.id,
      description: 'Rescue Tender',
      color: '#c2410c',
      icon: 'truck',
      rank_order: '',
    })
  );
  checkIs('and clearing it is itself a successful save', clearAttempt?.success === true, JSON.stringify(clearAttempt).slice(0, 160));
  const clearedRank = (await getDoc(doc(db, 'ranks', rankAttempt.id))).data();
  check('and clearing it writes a blank rather than a zero', clearedRank?.rank_order, '');
  checkIs(
    'so it is unset rather than the lowest rank in the station',
    parseInt(clearedRank?.rank_order, 10) !== 0,
    `got ${JSON.stringify(clearedRank?.rank_order)}`
  );

  // The rules end: a rank is station data, so writing one is `can_edit_ranks` and nothing else. A member must be
  // refused - otherwise the permission this document sits behind is decoration.
  await signIn('bo');
  const memberAttempt = await routeWrite(
    'ADMIN_SAVE_RANK',
    rankPayload({ id: rankAttempt.id, description: 'Rescue Tender', rank_order: '9' })
  );
  checkIs(
    'and a member without that permission cannot save one',
    memberAttempt && memberAttempt.success === false,
    JSON.stringify(memberAttempt).slice(0, 160)
  );
  check(
    'so the order they tried to write is not on the document',
    (await getDoc(doc(db, 'ranks', rankAttempt.id))).data()?.rank_order,
    ''
  );

  await signIn('bo');

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
  check('and carries the shift it is for', offer.schedule_template_id, '');
  // THE OFFER KEEPS THE SHIFT IT IS FOR, which is the reported bug at its source. An offer raised against a TEMPLATE
  // OCCURRENCE has no schedule row - nothing is written until it is approved - so `schedule_template_id` is the only
  // thing that says what the shift IS. `makeOffer` used to drop it while `slot_key` was built from it, so the approvals
  // queue could not find the template, could not find its hours, and printed "Time not set" for every such offer while
  // the same shift read "8:00 AM – 6:00 PM" on the calendar. Nothing looked broken because the calendar's pill matches
  // on `slot_key`.
  //
  // Routed rather than called directly, because the routing is where the field was being thrown away.
  const occurrenceId = await routeWrite('SUBMIT_SHIFT_OFFER', {
    schedule_template_id: 't1',
    date_from: '2026-03-16',
    date_to: '2026-03-16',
    assignment_id: 'a1',
    schedule_id: '',
  });
  const occurrence = (await getDoc(doc(db, 'schedule_offers', occurrenceId.id))).data();
  check('a template-occurrence offer carries the template it is for', occurrence.schedule_template_id, 't1');
  check('and the end of its date range', occurrence.date_to, '2026-03-16');
  check('with the slot key the calendar matches on still built from it', occurrence.slot_key, 'slot-2026-03-16-t1');

  // ...AND THE OFFICER'S SCREEN CAN NOW READ IT, which is the claim that matters - "the row has a field" is not the same
  // as "the table shows a time". The row is fed through the app's own describeShiftOffer with the real template, exactly
  // as the approvals tab does, and the hours are asserted on what comes out.
  const seededTemplate = (await getDoc(doc(db, 'schedule_templates', 't1'))).data();
  const described = describeShiftOffer(
    { ...occurrence, id: occurrenceId.id },
    { schedule: [], scheduleTemplates: [{ ...seededTemplate, id: 't1' }], assignments: [], timeFormat: '12' }
  );
  check('so the shift\u2019s hours are what the queue shows', described.timeLabel, '8:00 AM – 6:00 PM');
  check('and the shift reads under its own name', described.shiftLabel, 'Day Shift');
  // THE SAME ROW WITHOUT THE FIELD - what is in the database from before this fix - still resolves, from the slot key.
  const recovered = describeShiftOffer(
    { ...occurrence, id: occurrenceId.id, schedule_template_id: '' },
    { schedule: [], scheduleTemplates: [{ ...seededTemplate, id: 't1' }], assignments: [], timeFormat: '12' }
  );
  check('and an offer written before the field existed is recovered from its slot key', recovered.timeLabel, '8:00 AM – 6:00 PM');
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

  // BOTH DECISIONS THROUGH THE ROUTE, which is how the admin tab resolves an offer, and which used to resolve NOTHING:
  // the decision travels in the button's vocabulary ('APPROVE' / 'DECLINE') and the router compared it against the
  // lowercase 'approved', so every call fell through as "not routed" and landed on Apps Script - gone. An officer could
  // not approve or decline anything. These two calls are the proof it works, and they are here rather than beside the
  // direct approveOffer above because the VOCABULARY is the thing that broke.
  await signOut(auth);
  await signIn('bo');
  const routedOffer = await makeOffer({
    userId: 'u2',
    scheduleId: 's2',
    dateFrom: '2026-03-16',
    assignmentId: 'a2',
    slotKey: 'slot-2026-03-16|a2',
  });
  const declinedOffer = await makeOffer({
    userId: 'u2',
    scheduleId: 's2',
    dateFrom: '2026-03-23',
    assignmentId: 'a2',
    slotKey: 'slot-2026-03-23|a2',
  });
  await signOut(auth);
  await signIn('jane');

  const approved = await routeWrite('ADMIN_RESOLVE_SHIFT_OFFER', { id: routedOffer, decision: 'APPROVE' });
  check('an APPROVE through the route reports success', approved && approved.success, true);
  check('and stamps the offer approved', (await getDoc(doc(db, 'schedule_offers', routedOffer))).data().status, 'approved');

  const rowBefore = (await getDoc(doc(db, 'schedule', 's2'))).data();
  const declined = await routeWrite('ADMIN_RESOLVE_SHIFT_OFFER', { id: declinedOffer, decision: 'DECLINE' });
  check('a DECLINE through the route reports success', declined && declined.success, true);
  check('and stamps the offer declined', (await getDoc(doc(db, 'schedule_offers', declinedOffer))).data().status, 'declined');
  check('recording which officer decided it', (await getDoc(doc(db, 'schedule_offers', declinedOffer))).data().declined_by, 'u1');
  // A decline is a decision about ONE MEMBER, not about the shift: nothing else may move.
  const rowAfter = (await getDoc(doc(db, 'schedule', 's2'))).data();
  check('and leaves the shift exactly as it was', [rowAfter.user_id, rowAfter.is_open], [rowBefore.user_id, rowBefore.is_open]);

  // ...and the member cannot ask again for the shift they were turned down for. This is the guard in makeOffer, and it is
  // the only thing standing between a member with a declined row and a second offer: their calendar hides the button, but a
  // page opened before the decline would still be holding one.
  await signOut(auth);
  await signIn('bo');
  let refusal = '';
  try {
    await makeOffer({
      userId: 'u2',
      scheduleId: 's2',
      dateFrom: '2026-03-23',
      assignmentId: 'a2',
      slotKey: 'slot-2026-03-23|a2',
    });
  } catch (error) {
    refusal = error.message;
  }
  checkIs('a declined member cannot offer for that shift again', /declined/.test(refusal), refusal || 'the offer went through');
  // ...and the rule closes ONE shift, not the member's ability to offer at all: another slot is still theirs to take.
  const elsewhere = await makeOffer({
    userId: 'u2',
    scheduleId: 's2',
    dateFrom: '2026-03-30',
    assignmentId: 'a2',
    slotKey: 'slot-2026-03-30|a2',
  });
  check('while a different shift is still open to them', typeof elsewhere, 'string');

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

  // The conflict: a NEW row claiming a TEMPLATE SLOT that is already somebody else's. Sending the same id would be a
  // hand-over of that row - which the board legitimately does - so this one arrives without an id. The template is what
  // makes it a slot at all: the board keys its slots by date and template (AdminScheduleManagementTab), so a row with no
  // template is a custom shift and belongs to no slot.
  await refused('a slot already held cannot be handed to somebody else', 'functions/failed-precondition', () =>
    saveScheduleBoard({
      entries: [
        { date_from: '2026-03-09', date_to: '2026-03-09', schedule_template_id: 't1', assignment_id: 'a1', user_id: 'u2' },
      ],
    })
  );

  // Two members claimed by ONE save for one slot: the entries are compared with EACH OTHER, because both rows would land
  // in that slot and nothing else would notice - the check only ever looked at what was already stored, and the sheet had
  // no such check at all. The message also names the slot exactly ONCE, which is the other half of the field report:
  // "Already filled by somebody else: 2026-09-29 <id>, 2026-09-29 <id>" was one problem described twice, and it read like
  // two. Counted rather than matched, because the count is the claim.
  let doubleClaim = '';
  try {
    await saveScheduleBoard({
      entries: [
        { date_from: '2026-06-01', date_to: '2026-06-01', schedule_template_id: 't1', assignment_id: 'a1', user_id: 'u1' },
        { date_from: '2026-06-01', date_to: '2026-06-01', schedule_template_id: 't1', assignment_id: 'a1', user_id: 'u2' },
      ],
    });
  } catch (error) {
    doubleClaim = String((error && error.message) || '');
  }
  checkIs('one save cannot give one slot to two members', doubleClaim.includes('Already filled by somebody else'), doubleClaim || 'the write was allowed');
  check('and the slot is named exactly once', doubleClaim.split('2026-06-01 t1').length - 1, 1);
  // Refused inside the transaction, so the refusal is the whole save and nothing was written for it.
  check(
    'with nothing written for the refused save',
    (await getDocs(query(collection(db, 'schedule'), where('date_from', '==', '2026-06-01')))).docs.length,
    0
  );

  // The SAME member twice on one slot. Not a contention - nobody else is involved - but still two rows in one slot, which
  // the board draws as a single pill, so the schedule would be unreadable rather than contested. A guard against a caller
  // that does not keep one occupant per slot, and the shape the "one row per slot" claim rests on.
  let duplicateClaim = '';
  try {
    await saveScheduleBoard({
      entries: [
        { date_from: '2026-06-02', date_to: '2026-06-02', schedule_template_id: 't1', assignment_id: 'a1', user_id: 'u1' },
        { date_from: '2026-06-02', date_to: '2026-06-02', schedule_template_id: 't1', assignment_id: 'a1', user_id: 'u1' },
      ],
    });
  } catch (error) {
    duplicateClaim = String((error && error.message) || '');
  }
  checkIs('and one save cannot put the same member on a slot twice', duplicateClaim.includes('same member is on one slot twice'), duplicateClaim || 'the write was allowed');
  check(
    'with nothing written for the duplicated save either',
    (await getDocs(query(collection(db, 'schedule'), where('date_from', '==', '2026-06-02')))).docs.length,
    0
  );

  // THE CHECK ITSELF, PINNED AS A SHAPE - what the behavioural cases above cannot state directly. The conflict check is a
  // read INSIDE the save's transaction, which is the only thing that covers two officers saving at once; and it asks two
  // questions, the request against itself and the request against the stored rows, because a swap makes each row hold the
  // slot the other is being given. A rewrite that dropped either would quietly raise the chance of two members landing on
  // one slot - so it fails here rather than in the field.
  const boardSource = readFileSync('functions/index.js', 'utf8');
  const saveBoardBody = (boardSource.match(/exports\.saveScheduleBoard = onCall\([\s\S]*?\n\}\);/) || [''])[0];
  checkIs('the board save was located in the functions source', saveBoardBody.length > 0);
  checkIs('its conflict check runs INSIDE the transaction, so it covers two officers saving at once', /db\.runTransaction\([\s\S]*?conflicts\.add/.test(saveBoardBody));
  checkIs(
    'and asks both the request-against-itself and the request-against-stored questions',
    /claimed\.has\(key\)/.test(saveBoardBody) && /transaction\.get\(/.test(saveBoardBody)
  );
  checkIs('refusing a duplicated slot as well as a contested one', /duplicates\.add\(key\)/.test(saveBoardBody));

  // THE SWAP, in the shape the board really produces - and the operation this check broke twice over.
  //
  // The two rows are DIFFERENT TEMPLATES ON ONE DAY (t1 and t0 share "Engine 1", and the date is a Monday so both
  // templates really are due that day), which is what swapping two people on a single day looks like. Two things have to
  // hold for it to be accepted: each row must be able to take the slot the other is vacating - the version that read only
  // stored rows refused that - and the two slots must be told apart by the TEMPLATE, because keying on the assignment
  // merged them and the swap read as two members claiming one place.
  const swapDate = '2026-07-06';
  const setup = await saveScheduleBoard({
    entries: [
      { date_from: swapDate, date_to: swapDate, schedule_template_id: 't1', assignment_id: 'a1', user_id: 'u1' },
      { date_from: swapDate, date_to: swapDate, schedule_template_id: 't0', assignment_id: 'a1', user_id: 'u2' },
    ],
  });
  checkIs('two templates are staffed on one day to set the swap up', setup.ids.length === 2 && setup.ids.every(Boolean), JSON.stringify(setup.ids));

  const swap = await saveScheduleBoard({
    entries: [
      { id: setup.ids[0], date_from: swapDate, date_to: swapDate, schedule_template_id: 't0', assignment_id: 'a1', user_id: 'u1' },
      { id: setup.ids[1], date_from: swapDate, date_to: swapDate, schedule_template_id: 't1', assignment_id: 'a1', user_id: 'u2' },
    ],
  });
  check('the swap is accepted', [...swap.ids].sort(), [...setup.ids].sort());
  check(
    'and each row took the other’s template, keeping its own member',
    [
      (await getDoc(doc(db, 'schedule', setup.ids[0]))).data().schedule_template_id,
      (await getDoc(doc(db, 'schedule', setup.ids[1]))).data().schedule_template_id,
      (await getDoc(doc(db, 'schedule', setup.ids[0]))).data().user_id,
    ],
    ['t0', 't1', 'u1']
  );
  // ...and the guard still bites: this save does not rewrite the row holding t1, so a NEW row for somebody else in it is
  // exactly what the check exists for. A swap may move rows; it may not hand a slot to a stranger.
  await refused('a swap does not open its slots to anybody else', 'functions/failed-precondition', () =>
    saveScheduleBoard({
      entries: [{ date_from: swapDate, date_to: swapDate, schedule_template_id: 't1', assignment_id: 'a1', user_id: 'u1' }],
    })
  );

  // And here the same swap is built by the CLIENT'S OWN HELPER (swapSlotFields) rather than by hand, so this cannot drift
  // from what the board actually sends: it is the check that would have caught the assignment key, because the helper
  // moves the TEMPLATE as well as the date and the old key ignored it. Swapping back also proves the exchange works in
  // both directions rather than only out of a slot nobody is holding.
  const current = await Promise.all(
    setup.ids.map(async (id) => ({ id, ...(await getDoc(doc(db, 'schedule', id))).data() }))
  );
  const [swappedA, swappedB] = swapSlotFields(current[0], current[1]);
  check('the client helper moves the template, not just the date', [swappedA.schedule_template_id, swappedB.schedule_template_id], ['t1', 't0']);
  const asEntry = (row) => ({
    id: row.id,
    schedule_template_id: row.schedule_template_id,
    date_from: row.date_from,
    date_to: row.date_to,
    start_time: row.start_time,
    end_time: row.end_time,
    apparatus_id: row.apparatus_id,
    assignment_id: row.assignment_id,
    user_id: row.user_id,
  });
  const back = await saveScheduleBoard({ entries: [asEntry(swappedA), asEntry(swappedB)] });
  checkIs('and the save it produces is accepted', back.ids.length === 2 && back.ids.every(Boolean), JSON.stringify(back.ids));
  check(
    'which puts the two rows back where they started',
    [
      (await getDoc(doc(db, 'schedule', setup.ids[0]))).data().schedule_template_id,
      (await getDoc(doc(db, 'schedule', setup.ids[1]))).data().schedule_template_id,
    ],
    ['t1', 't0']
  );

  // ...and a CUSTOM shift has no slot to collide in: a day may hold several, which is how the sheet's board worked and
  // why templates are what identify a slot. Two in one save, so this covers the request-against-itself pass as well.
  const custom = await saveScheduleBoard({
    entries: [
      { date_from: '2026-07-08', date_to: '2026-07-08', assignment_id: 'a1', user_id: 'u1', start_time: '06:00', end_time: '09:00' },
      { date_from: '2026-07-08', date_to: '2026-07-08', assignment_id: 'a1', user_id: 'u2', start_time: '09:00', end_time: '12:00' },
    ],
  });
  check('two custom shifts share a day without colliding', custom.ids.length, 2);

  const boardRemoval = await saveScheduleBoard({ deleteIds: [board.ids[1]] });
  check('the delete count comes back', boardRemoval.deleted, 1);
  check('and the row is gone', (await getDoc(doc(db, 'schedule', board.ids[1]))).exists(), false);

  // The board's audit trail is NO LONGER ASSERTABLE HERE, and that is a deliberate trade: the app's audit lines are
  // Cloud Logging entries now (see `audit` in functions/index.js) rather than `system_log` documents, and this harness
  // runs against the emulator, which does not hand its function logs back to a test. What the save DID is still
  // asserted all around this: the rows, the ids, the derived `is_open`. What is no longer asserted anywhere is that a
  // given action left a RECORD - the functionality behind it is Firestore's writes, and the record is Cloud Logging's.
  // (The emulator does run a Logging emulator, so this could be recovered by querying it; that is the follow-up if the
  // audit trail ever needs a regression test of its own.)
  // happened rather than pretending a save and a delete are one action.

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

  // "MINIMUM RANK", ROUND TRIPPED THROUGH THE REAL SAVE - and this is the assertion that matters, because the helper above
  // takes `rankAndAbove` as an argument and so cannot tell whether the DOCUMENT save passes it. It did not: the editor has
  // always labelled the field "Minimum rank" and both help pages have always described it as "a rank and above", but
  // `ADMIN_SAVE_DOCUMENT` stored the single rank id. `k2` is order 1 and `k1` is order 3, so a document with a minimum of
  // Firefighter was invisible to an Officer - the reported symptom, one rank id where a threshold belonged.
  //
  // Asserted through `routeWrite` on purpose: calling `audienceKeysForWrite` with the right flag would prove the helper
  // works, and the helper was never the problem. What has to be pinned is the row that reaches the database.
  await signIn('jane');
  await routeWrite('ADMIN_SAVE_DOCUMENT', {
    id: 'doc-minrank-probe',
    title: 'Minimum Rank Probe',
    body: 'Written by the harness.',
    rank_id: 'k2',
    is_published: true,
  });
  const probeDocument = (await getDoc(doc(firestore(), 'documents', 'doc-minrank-probe'))).data() || {};
  // SORTED, because the list is built in whatever order the ranks collection reads in and the claim is about WHICH ranks,
  // not which way round they arrived. Asserting the raw order would make this fail on a seed that renumbers a rank.
  check(
    'a document saved with a minimum rank is stored as that rank and every rank above it',
    [...(probeDocument.audience_keys || [])].sort(),
    ['rank:k1', 'rank:k2']
  );
  // ...AND AN ANNOUNCEMENT IS NOT, because announcements name the people they are for rather than the rank they apply
  // from. Asserted because the two saves are one table and a well-meaning "make them all consistent" edit would quietly
  // widen a broadcast channel - and because nothing else in this file would notice.
  await routeWrite('ADMIN_SAVE_ANNOUNCEMENT', {
    id: 'an-exact-rank-probe',
    title: 'Exact Rank Probe',
    body: 'Written by the harness.',
    rank_id: 'k2',
  });
  const probeAnnouncement = (await getDoc(doc(firestore(), 'announcements', 'an-exact-rank-probe'))).data() || {};
  check('while an announcement still targets that one rank exactly', probeAnnouncement.audience_keys, ['rank:k2']);

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

  // THE REPLY A SAVE HANDS THE SCREENS - asserted by USING it, because the shape is the whole subject.
  //
  // A certification save rebuilds the index and returns it, and App puts that reply STRAIGHT into the registry
  // (`onBadgesChanged={setCertificationBadges}`, which REPLACES rather than merges) - so whatever the reply's `badges`
  // field holds becomes every icon on screen. It held a SUMMARY of the rebuild (`{ members, cleared }`) while being
  // called `badges`, so saving one certification blanked every name on every screen until the next sign-in: the
  // Schedule module's pills, the board, the sidebar. Every layer looked right on its own - the field was named
  // `badges`, the value was about badges, and the setter was handed exactly what the route replied.
  //
  // SO THIS FEEDS THE REPLY TO THE APP AND CHECKS WHAT IT DRAWS. "Is this the index?" is not a question a source check
  // can answer: the count of call sites, the field's name and the setter are all identical either way. Only a summary
  // actually travelling through the registry can be seen to be one - it leaves every member with no icons at all.
  console.log('\n--- the badge index a save hands back ---');
  // The type is saved FIRST, because the seed's catalog deliberately does not ask to be drawn beside a name - so
  // without this the index would come back empty and the case would prove nothing. It goes through the route the Setup
  // tab uses, which is what makes the rebuild non-empty. THE BODY IS ASSEMBLED HERE, unlike the ranks section above:
  // what is under test is the REPLY, which the route produces, so a body written by this file cannot fake it.
  await signIn('jane');
  const setupAttempt = await routeWrite('ADMIN_SAVE_CERTIFICATION_SETUP', {
    action: 'ADMIN_SAVE_CERTIFICATION_SETUP',
    id: 'c9',
    name: 'Swiftwater',
    icon: 'sailboat',
    is_renewable: true,
    show_next_to_name: true,
  });
  checkIs(
    'an officer saves a type that asks to be drawn beside a name',
    setupAttempt && setupAttempt.success === true,
    JSON.stringify(setupAttempt).slice(0, 160)
  );

  const badgeSave = await routeWrite('ADMIN_SAVE_CERTIFICATION', {
    action: 'ADMIN_SAVE_CERTIFICATION',
    id: '',
    user_id: 'u2',
    certification_id: 'c9',
    effective_date: '2025-01-01',
    end_date: '2099-01-01',
  });
  checkIs('and a current record for a member saves', badgeSave && badgeSave.success === true, JSON.stringify(badgeSave).slice(0, 160));

  const repliedBadges = badgeSave && badgeSave.badges;
  // A summary would have two NUMBERS here and no arrays, which is what this shape test says.
  checkIs(
    'the reply is the index - member id to their badges - rather than a summary of the rebuild',
    Boolean(repliedBadges) &&
      Array.isArray(repliedBadges.u2) &&
      Object.values(repliedBadges).every((list) => Array.isArray(list)),
    JSON.stringify(repliedBadges).slice(0, 160)
  );
  check(
    "and it carries the member's badge, not just their id",
    (repliedBadges && repliedBadges.u2 ? repliedBadges.u2 : []).map((badge) => badge.icon),
    ['sailboat']
  );

  // USED THE WAY THE APP USES IT. This is the assertion the summary could not survive: the registry is replaced with
  // whatever it is handed, so a summary leaves every member drawing nothing.
  setCertificationBadges(repliedBadges);
  check(
    'and the app draws it once the reply goes through its own setter',
    certificationBadgesFor('u2').map((badge) => badge.icon),
    ['sailboat']
  );
  checkIs('while a member with no badges still draws none', certificationBadgesFor('u1').length === 0);

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
  // the rules' - an officer with can_edit_member_availability may write another member's months, and a member may not - so
  // these assert the rules rather than the dispatcher, which deliberately does not repeat the check. This is the
  // assumption the dispatcher was written on, and it is worth proving.
  await signIn('jane');
  await routeWrite('ADMIN_SET_AVAILABILITY', {
    user_id: 'u2',
    month: '2026-04',
    claims: { aw1: ['2026-04-07'] },
  });
  const forBo = (await getDoc(doc(firestore(), 'availability_months', 'u2_2026-04'))).data();
  checkIs('an officer writes another member\u2019s month', forBo?.claims?.aw1?.[0] === '2026-04-07');

  await signIn('bo');
  const boAttempt = await routeWrite('ADMIN_SET_AVAILABILITY', {
    user_id: 'u1',
    month: '2026-04',
    claims: { aw1: ['2026-04-14'] },
  });
  checkIs(
    'but a member cannot write somebody else\u2019s',
    boAttempt && boAttempt.success === false,
    JSON.stringify(boAttempt).slice(0, 140)
  );
  // Asked as an OFFICER, which is the only way it can be asked: a member cannot even READ another member's month (the
  // read rule wants the owner in the document id or the permission), which is why this read came back permission-denied
  // when it was run as bo - the rules refusing the document, exactly as they refused the write.
  await signIn('jane');
  const boMonth = (await getDoc(doc(firestore(), 'availability_months', 'u1_2026-04'))).data();
  check('and no month is left behind by the refused write', boMonth, undefined);

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

  // --- THE SECOND SIGNATURE: a document whose author asked for its signature to be confirmed -------------------------
  //
  // The same act as confirming a checklist item, one level up: the member signs the document, and somebody else
  // confirms they looked. What the round trip has to prove is that the ROW lands with the shape every reader looks for -
  // the empty item id, and the verifier's own id as the signer - and that the three refusals hold: confirming your own,
  // confirming a signature nobody gave, and confirming on a document that never asked for it.
  //
  // The flag is set through the SDK rather than put in the seed because this writer READS THE DOCUMENT BACK before it
  // writes anything: "does this document still ask for a second signature" is the author's stored decision, so a
  // document written outside the app is exactly the shape under test.
  await signIn('jane');
  await setDoc(doc(firestore(), 'documents', 'doc6'), { requires_verification: true }, { merge: true });
  const confirmedDocument = await routeWrite('VERIFY_DOCUMENT_SIGNATURE', { document_id: 'doc6', user_id: 'u2' });
  checkIs('a verifier confirms a document signature', confirmedDocument.verified === 1, JSON.stringify(confirmedDocument).slice(0, 140));
  const documentRows = await rowsOf(query(collection(firestore(), 'document_signatures'), where('document_id', '==', 'doc6')));
  const documentConfirmation = documentRows.find((row) => row.signature_role === 'verifier');
  check(
    'and the row says who it is about and who checked it',
    [documentConfirmation.user_id, documentConfirmation.signed_by_user_id],
    ['u2', 'u1']
  );
  check('it is the document own row, carrying no item', documentConfirmation.checklist_item_id, '');
  check(
    'and it is a second row rather than an edit of the member own',
    documentRows.filter((row) => row.user_id === 'u2').length,
    2
  );
  check(
    'so the app reads the signature as confirmed, by whom',
    [
      documentVerificationState(documentRows, 'doc6', 'u2').verified,
      documentVerificationState(documentRows, 'doc6', 'u2').verifiedByUserId,
    ],
    [true, 'u1']
  );
  const confirmedAgain = await routeWrite('VERIFY_DOCUMENT_SIGNATURE', { document_id: 'doc6', user_id: 'u2' });
  checkIs(
    'confirming twice is a double click',
    confirmedAgain.success === true && confirmedAgain.already_verified === true,
    JSON.stringify(confirmedAgain).slice(0, 140)
  );

  // The first three refusals are the WRITER's, and they are different ones.
  const ownDocumentSignature = await routeWrite('VERIFY_DOCUMENT_SIGNATURE', { document_id: 'doc6', user_id: 'u1' });
  checkIs('nobody confirms their own signature', ownDocumentSignature.success === false, JSON.stringify(ownDocumentSignature).slice(0, 140));
  const unsignedMember = await routeWrite('VERIFY_DOCUMENT_SIGNATURE', { document_id: 'doc6', user_id: 'u3' });
  checkIs(
    'nor one for a member who has not signed it - a confirmation of nothing is not a record',
    unsignedMember.success === false,
    JSON.stringify(unsignedMember).slice(0, 140)
  );
  const unaskedDocument = await routeWrite('VERIFY_DOCUMENT_SIGNATURE', { document_id: 'doc1', user_id: 'u2' });
  checkIs(
    'and a document that never asked for a confirmation is refused',
    unaskedDocument.success === false,
    JSON.stringify(unaskedDocument).slice(0, 140)
  );

  // The third is the RULES. The pair is valid - Jane signs the document - and a member who may not verify still cannot
  // write the confirmation, which is what makes "nobody confirms other people's paperwork without the permission" a
  // property of the data rather than of a screen.
  const janeSignedDocument = await routeWrite('SIGN_DOCUMENT', { id: 'doc6' });
  checkIs('an officer signs the document too', janeSignedDocument.signed === 1, JSON.stringify(janeSignedDocument).slice(0, 140));
  await signIn('bo');
  const memberConfirms = await routeWrite('VERIFY_DOCUMENT_SIGNATURE', { document_id: 'doc6', user_id: 'u1' });
  checkIs(
    'and a member without the permission cannot write the row either',
    memberConfirms.success === false,
    JSON.stringify(memberConfirms).slice(0, 140)
  );

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

  // ...AND WHAT THE DRAG ANSWERS WITH, which is the half that made a drop look like it had deleted the library. The reply
  // is a COUNT, not the library - so the tab, which used to redraw itself from `result.documents`, read a field that does
  // not exist: `normalizeDocumentList(undefined)` is `[]`, the list went blank, and the documents came back the next time
  // the tab was opened because the WRITE had succeeded all along. A screen that empties itself looks like data loss, and
  // the officer's own library was correctly ordered the whole time.
  //
  // An assertion of the SHAPE, because that is the fact the caller could not see: every line in the tab reads perfectly
  // well when it names a field the writer never sends. So this pins what the route really answers with, and then feeds
  // that reply through the app's OWN helper to show what ends up on screen - the same two-part technique the badge reply
  // uses above, and for the same reason.
  check('the drag answers with a count rather than the library', Object.keys(drag).sort(), ['moved', 'success']);
  check('so there is no `documents` field to build a list from', 'documents' in drag, false);

  const heldRows = [
    { id: 'doc6', title: 'New Policy Acknowledgement', folder: 'Standing Orders', sort_order: 99 },
    { id: 'doc1', title: 'Policy Acknowledgement', folder: 'Standing Orders', sort_order: 1 },
  ];
  const afterDrag = applyDocumentOrder(heldRows, [{ id: 'doc6', sort_order: 3 }]);
  check(
    'and the app applies the order it wrote to the rows it holds',
    afterDrag.map((row) => [row.id, row.sort_order]),
    [['doc6', 3], ['doc1', 1]]
  );
  check('leaving every other row exactly where it was', afterDrag.length, 2);
  check('so the list cannot be emptied by a reply that carries no list', applyDocumentOrder(heldRows, drag.order || undefined).length, 2);

  // ...AND ONE SAVE WRITES EVERY ROW THAT MOVED. Reordering is staged: the officer arranges the whole shelf and presses
  // Save order once, so the request body is the DIFFERENCE between the screen and the library rather than a working copy
  // of it. What this asserts is that the route honours a multi-row request - moving several rows in one call, and only
  // those rows - because a route that quietly wrote the first pair would leave a staged save half applied while the
  // reply still said `success`.
  const stagedOrder = documentOrderSignature([
    { id: 'doc6', sort_order: 3 },
    { id: 'doc1', sort_order: 1 },
  ]);
  const stagedRows = [
    { id: 'doc6', sort_order: 0 },
    { id: 'doc1', sort_order: 10 },
  ];
  const pending = pendingDocumentOrderPairs(stagedRows, stagedOrder);
  check('a staged save is the difference between the screen and the library', pending, [
    { id: 'doc6', sort_order: 0 },
    { id: 'doc1', sort_order: 10 },
  ]);
  const batch = await routeWrite('ADMIN_REORDER_DOCUMENTS', { order: pending });
  check('and one request moves every row of it', batch.moved, 2);
  const landed = [
    (await getDoc(doc(firestore(), 'documents', 'doc6'))).data().sort_order,
    (await getDoc(doc(firestore(), 'documents', 'doc1'))).data().sort_order,
  ];
  check('leaving both rows where the officer arranged them', landed, [0, 10]);
  const landedSignature = documentOrderSignature([
    { id: 'doc6', sort_order: landed[0] },
    { id: 'doc1', sort_order: landed[1] },
  ]);
  check(
    'so what the officer is looking at is what is stored, and nothing is left pending',
    pendingDocumentOrderPairs(stagedRows, landedSignature),
    []
  );
  check(
    'and the list draws that order, which is what makes the save visible at once',
    groupDocumentsByFolder([
      { id: 'doc6', title: 'Six', folder: 'Staged', sort_order: 0 },
      { id: 'doc1', title: 'One', folder: 'Staged', sort_order: 10 },
    ]).flatMap((group) => group.documents.map((row) => row.id)),
    ['doc6', 'doc1']
  );

  // --- a checklist item's order, and the 0 that used to become a 10 --------------------------------------------------
  //
  // The other reported fault, and it has the same shape as the drag above: nothing is wrong with the write path, which
  // stores exactly what it is handed - so no reading of the writer would ever find it. The 0 never arrived. The tab's
  // Order box held a NUMBER whose empty state was also 0, so the save separated "left blank" from "typed 0" with
  // `Number(value) || next-slot` - and `Number('0')` is falsy, so an item deliberately put at 0 fell through and was
  // renumbered to 10, 20, ...
  //
  // So the 0 is taken through the app's OWN reading of that field and written through the real route, then read BACK -
  // because "the order an author typed is the order stored" is a fact about the round trip, not about either half.
  // The reading that was replaced is exhibited beside it, so the fault is on the record rather than only described.
  const itemOrder = await routeWrite('ADMIN_SAVE_CHECKLIST_ITEM', {
    id: '',
    document_id: 'doc5',
    audience_keys: ['*'],
    label: 'Radio check',
    section: 'Engine',
    sort_order: checklistItemSortOrder('0', 10),
  });
  checkIs('an item created with a typed 0 is written', typeof itemOrder.id === 'string' && itemOrder.id !== '', JSON.stringify(itemOrder).slice(0, 140));
  const storedItem = (await getDoc(doc(firestore(), 'document_checklist_items', itemOrder.id))).data();
  check('and the order STORED is the 0 that was typed', storedItem.sort_order, 0);
  check('not the next vacant slot, which is what it used to get', storedItem.sort_order === 10, false);
  // The expression this replaced, evaluated: what the tab used to save when the author typed 0 on the second item.
  check('the reading this replaced would have moved it', Number('0') || (1 + 1) * 10, 20);

  const orderedItems = normalizeChecklistItemList(
    await rowsOf(query(collection(firestore(), 'document_checklist_items'), where('document_id', '==', 'doc5')))
  );
  check('so it sorts to the front of the checklist, where 0 belongs', orderedItems[0].label, 'Radio check');
  check('ahead of the items already at 1 and 2', orderedItems.map((item) => item.sort_order), [0, 1, 2]);

  // Re-opening it and saving again is the other half. The tab fills the box from the stored number as TEXT, so the
  // second save sends the same 0 rather than an empty box - which is the difference that would otherwise renumber it.
  const reopenedItem = await routeWrite('ADMIN_SAVE_CHECKLIST_ITEM', {
    id: itemOrder.id,
    document_id: 'doc5',
    audience_keys: ['*'],
    label: 'Radio check',
    section: 'Engine',
    sort_order: checklistItemSortOrder(String(storedItem.sort_order)),
  });
  checkIs('re-saving an item at 0 needs no new row', reopenedItem.id === itemOrder.id, JSON.stringify(reopenedItem).slice(0, 140));
  check(
    'and leaves it at 0 rather than renumbering it',
    (await getDoc(doc(firestore(), 'document_checklist_items', itemOrder.id))).data().sort_order,
    0
  );

  // A blank box is the other answer, and it still has to work: the author who never touches Order gets the next slot.
  const blankOrder = await routeWrite('ADMIN_SAVE_CHECKLIST_ITEM', {
    id: '',
    document_id: 'doc5',
    audience_keys: ['*'],
    label: 'Beacon check',
    section: 'Engine',
    sort_order: checklistItemSortOrder('', (3 + 1) * 10),
  });
  check(
    'while an item left blank takes the next slot as before',
    (await getDoc(doc(firestore(), 'document_checklist_items', blankOrder.id))).data().sort_order,
    40
  );

  // --- GRANDFATHERING: an officer enters what the paper file says, for somebody else --------------------------------
  //
  // The whole feature in one call, and the thing worth proving here is that the ROW IT LANDS is both useful and honest.
  // Useful: it counts as that member's signature everywhere, because every screen that reads progress keys off
  // `signature_role === 'member'`. Honest: it says an officer entered it, with the note and the moment, so it can never
  // be mistaken later for something the member tapped.
  //
  // It is also the case that no reading of the WRITER could have caught the risk: the danger is the RULES letting an
  // officer write an ordinary member row with no flag, which would be a forged signature. That is why the checks below
  // write without the flag directly, through the SDK, and assert the rules refuse it.
  await signIn('jane');
  const beforeFill = await rowsOf(query(collection(firestore(), 'document_signatures'), where('document_id', '==', 'doc5')));
  const raeBefore = beforeFill.filter((row) => row.user_id === 'u3' && row.signature_role === 'member').length;

  const filledRows = await routeWrite('BACKFILL_DOCUMENT_SIGNATURES', {
    document_id: 'doc5',
    user_id: 'u3',
    item_ids: ['it3', 'it4'],
    recorded_on: '2024-06-15',
    note: 'Paper file, engine checks 2024',
    confirm_verified: true,
  });
  checkIs('an officer records two items for a member', filledRows.success === true && filledRows.recorded === 2, JSON.stringify(filledRows).slice(0, 160));
  check('and the confirmations with them', filledRows.verified, 2);

  const raeRows = filledRows.signatures.filter((row) => row.user_id === 'u3' && row.signature_role === 'member');
  check('two member rows are on file for her now', raeRows.length, raeBefore + 2);
  const filledRow = raeRows.find((row) => row.checklist_item_id === 'it3');
  check('the row counts for the member', filledRow.user_id, 'u3');
  check('and is attributed to the officer who entered it, not to her', filledRow.signed_by_user_id, 'u1');
  check('it is flagged as a back-fill', filledRow.backfilled, true);
  check('with the note the officer gave', filledRow.backfill_note, 'Paper file, engine checks 2024');
  check('and the date off the paper rather than today', filledRow.signed_at, '2024-06-15');
  check('so the record carries the moment it was entered as well', Boolean(filledRow.backfilled_at), true);
  check(
    'and a verification row was created for it too',
    filledRows.signatures.some((row) => row.user_id === 'u3' && row.checklist_item_id === 'it3' && row.signature_role === 'verifier'),
    true
  );

  // IT COUNTS. The member's own progress moves, which is the entire point of grandfathering - asserted through the app's
  // own arithmetic rather than by reading the row back, because "the row exists" is not the claim.
  const raeItems = await rowsOf(query(collection(firestore(), 'document_checklist_items'), where('document_id', '==', 'doc5')));
  const raeProgress = checklistProgress(raeItems, filledRows.signatures, 'u3');
  check('her checklist then reads those items as done', raeProgress.signed, 2);
  check('and as confirmed', raeProgress.verified, 2);

  // A SECOND RUN IS NOTHING TO DO rather than an error, and it does not duplicate: the officer pressing the button twice
  // is a double click, and a second row for one item is exactly what `backfillableItemIds` exists to prevent.
  const again = await routeWrite('BACKFILL_DOCUMENT_SIGNATURES', { document_id: 'doc5', user_id: 'u3', item_ids: ['it3', 'it4'] });
  check('recording the same items again writes nothing', [again.recorded, again.already_on_file], [0, true]);
  const afterAgain = await rowsOf(query(collection(firestore(), 'document_signatures'), where('document_id', '==', 'doc5')));
  check(
    'and leaves no duplicate row behind',
    afterAgain.filter((row) => row.user_id === 'u3' && row.checklist_item_id === 'it3' && row.signature_role === 'member').length,
    1
  );

  // SELF-ENTRY IS REFUSED, by the writer and by the rules: "I did this" and "the station recorded this" must not be the
  // same statement, the position the assessment scores and the verifications already take.
  const own = await routeWrite('BACKFILL_DOCUMENT_SIGNATURES', { document_id: 'doc5', user_id: 'u1', item_ids: ['it3'] });
  checkIs('an officer cannot back-fill their own checklist', own.success === false, JSON.stringify(own).slice(0, 140));

  // AN ITEM ANOTHER CHECKLIST OWNS IS REFUSED, so a stale screen cannot point a row at somebody else's item.
  const foreign = await routeWrite('BACKFILL_DOCUMENT_SIGNATURES', { document_id: 'doc5', user_id: 'u3', item_ids: ['it1'] });
  check('an item belonging to another checklist is not written', foreign.recorded, 0);
  const everySignature = await rowsOf(collection(firestore(), 'document_signatures'));
  check('and no row was created pointing at it', everySignature.some((row) => row.user_id === 'u3' && row.checklist_item_id === 'it1'), false);

  // A MEMBER WITHOUT THE MANAGEMENT PERMISSION cannot do any of it, however the request is shaped.
  await signIn('bo');
  const memberFilled = await routeWrite('BACKFILL_DOCUMENT_SIGNATURES', { document_id: 'doc5', user_id: 'u3', item_ids: ['it3'] });
  checkIs('a member cannot record a signature for somebody else', memberFilled.success === false, JSON.stringify(memberFilled).slice(0, 140));

  // SIGNED IN AGAIN AS THE OFFICER, which the checks below depend on: the member above has no management permission,
  // so a refusal on the next two writes would be theirs rather than the flag's - an allowed-for-the-wrong-reason test in
  // reverse, and the trap the seed file warns about around the assessor account.
  await signIn('jane');
  // ...AND THE RULES REFUSE THE FORGERY THE WRITER WOULD NEVER SEND: an officer writing an ordinary 'member' row for
  // somebody else, with no `backfilled` flag. This is the check that matters most in the whole section, because that
  // shape is what would turn this feature into a way of writing signatures in another member's name.
  const forged = await setDoc(doc(firestore(), 'document_signatures', 'backfill-forged'), {
    document_id: 'doc5',
    checklist_item_id: 'it3',
    user_id: 'u3',
    signed_by_user_id: 'u1',
    signature_role: 'member',
    signed_at: '2024-06-15',
    content_revision: 0,
  }).then(
    () => ({ allowed: true }),
    (error) => ({ allowed: false, code: error.code })
  );
  checkIs(
    'and the rules refuse an unflagged member row written for somebody else',
    forged.allowed === false && forged.code === 'permission-denied',
    JSON.stringify(forged)
  );

  // THE SAME WRITE WITH THE FLAG IS ALLOWED, which is what shows the refusal above is the flag and not the caller.
  const flagged = await setDoc(doc(firestore(), 'document_signatures', 'backfill-flagged'), {
    document_id: 'doc5',
    checklist_item_id: 'it4',
    user_id: 'u3',
    signed_by_user_id: 'u1',
    signature_role: 'member',
    signed_at: '2024-06-15',
    content_revision: 0,
    backfilled: true,
    backfilled_at: '2024-06-15',
    backfill_note: '',
  }).then(
    () => ({ allowed: true }),
    (error) => ({ allowed: false, code: error.code })
  );
  checkIs('while the flagged one is allowed, which is the whole safety property', flagged.allowed === true, JSON.stringify(flagged));

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
    payload: {
      id: 'u2',
      time_format: '24',
      is_dark_mode: 'true',
      hide_events_by_default: 'true',
      colorblind_rank_labels: 'true',
      font_scale: '1.5',
      notify_announcements: 'FALSE',
    },
  });
  const boSettings = (await getDoc(doc(firestore(), 'user_settings', 'u2'))).data();
  check('the settings form writes the member own row', [boSettings.time_format, boSettings.is_dark_mode, boSettings.hide_events_by_default, boSettings.colorblind_rank_labels, boSettings.font_scale, boSettings.notify_announcements], ['24', true, true, true, '1.5', false]);
  check('with the flags as real booleans, not the strings the form sends', [typeof boSettings.is_dark_mode, typeof boSettings.hide_events_by_default, typeof boSettings.colorblind_rank_labels, typeof boSettings.notify_announcements], ['boolean', 'boolean', 'boolean', 'boolean']);

  await routeWrite('UPDATE_USER_SETTINGS', { payload: { id: 'u2', time_format: '12' } });
  const boAfter = (await getDoc(doc(firestore(), 'user_settings', 'u2'))).data();
  check('a second save changes only what it sent', boAfter.time_format, '12');
  check('and an earlier preference survives it', boAfter.notify_announcements, false);
  check('and the event visibility preference survives it', boAfter.hide_events_by_default, true);
  check('and the colorblind label preference survives it', boAfter.colorblind_rank_labels, true);
  check('and the font multiplier survives it', boAfter.font_scale, '1.5');
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

  // A SCORE THAT ARRIVED AS TEXT, and the repair the next run makes whatever it scores. Only a MIGRATION can leave text
  // here - a client cannot write this field at all (the `users` rule is `hasOnly`) - so this writes it the way a migration
  // would, with the Admin SDK.
  //
  // Why the repair exists: the leaderboard is a query comparing types, so a text score is invisible to it and its owner stays
  // off the board until they beat a score they already hold - for good, if they never do. The repair writes the SAME number,
  // so it changes nothing about what the member earned.
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore: getAdminFirestore } = await import('firebase-admin/firestore');
  const admin = getAdminFirestore(
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-station-portal' }, 'verify-writes')
  );
  const storeScore = (value) => admin.doc('users/u2').set({ runner_score: value }, { merge: true });
  const scoreOf = async () => (await getDoc(doc(db, 'users', 'u2'))).data().runner_score;

  await storeScore('1450');
  check('a run that beats nothing answers with the standing best', await routeWrite('SAVE_RUNNER_SCORE', { score: 90 }), {
    success: true,
    best: 1450,
    improved: false,
  });
  check('and repays it as a number, so the board can see it', await scoreOf(), 1450);
  check('a better run still wins, and stores a number too', await routeWrite('SAVE_RUNNER_SCORE', { score: 2000 }), {
    success: true,
    best: 2000,
    improved: true,
  });
  // NOT EVERY VALUE IS A SCORE: spelling is not a personal best, and turning it into a 0 would be inventing one. It is left
  // exactly as it was, which is also why the bulk repair script counts these and reports them rather than rewriting them.
  await storeScore('abc');
  check('a value that is not a score is not repaired into one', await routeWrite('SAVE_RUNNER_SCORE', { score: 0 }), {
    success: true,
    best: 0,
    improved: false,
  });
  check('so it is left exactly as it was', await scoreOf(), 'abc');
  await storeScore(2000);

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

  // The audit toggle is GONE, with the collection it wrote to. An officer used to be able to route straightforward
  // saves through a callable that wrote an audit row first, off by default; the app's audits are Cloud Logging lines
  // now (`audit` in functions/index.js), and the functions that need one always write it. So there is no setting to
  // read and no row to assert - see the note by the board's section above for what that costs this harness.

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
