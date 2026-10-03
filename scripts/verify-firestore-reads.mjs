/**
 * Phase 2, part one: the member payload, read from Firestore.
 *
 *   npm run verify:firestore-reads
 *
 * What this proves is that the read path returns what the app already consumes - the same field names, the same
 * projections, and the same narrowing - because that is what lets api.js swap its internals without a single
 * component changing. The assertions are ported from the intent of verify-bootstrap.mjs, which has tested the sheet
 * version of this payload all along: the roster is three columns, the private half of an assignment does not travel,
 * a member's own rows and nobody else's, and the audience filtering that used to happen in a server function.
 */
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, seed } from './seed-emulator.mjs';
import { fetchAdminPayload, fetchMemberPayload, readAdminSections, readUsersOnce } from '../src/services/firestorePayload.js';
// The live reads, driven for real against the emulator: a listener has to be proven to FIRE, not inspected in the source.
import { subscribeLive } from '../src/services/liveReads.js';
// The decision the score-repair script makes, tested here against a real text score in the emulator rather than in isolation.
import { scoreToStore } from './normalize-runner-scores.mjs';
import { collection, doc, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { firebaseAuth, firebaseConfigured, firestore } from '../src/services/firebase.js';
import { syntheticEmail } from '../src/services/firebaseAuth.js';
// The app's own day arithmetic, so the window assertions below ask the question the way the reader does. Comparing a
// datetime column against a bare date key is what dropped the boundary day in the first place.
import { nextDateKey } from '../src/utils/scheduleDate.js';

let failures = 0;
let cases = 0;

// Waiting for something a listener will do on its own: a snapshot arrives over the wire, so there is no promise to await.
// The timeout is generous because a CI machine is slow, and a failure says what never arrived rather than hanging.
const waitUntil = async (condition, label = 'a listener snapshot', timeout = 8000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  checkIs(`WAITED for ${label} and it never arrived`, false);
  return false;
};
const settle = (ms = 500) => new Promise((resolve) => setTimeout(resolve, ms));

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

// The harness runs against the MODULE's own wiring rather than its own Firebase app: under `emulators:exec` the
// emulator host is in the environment, so src/services/firebase.js configures itself for the demo project and
// connects to the emulators - which means what this proves is what the app will actually use, not a parallel setup
// that happens to look the same.
checkIs('the module configured itself for the emulator', firebaseConfigured(), 'no Firebase config resolved');

const auth = firebaseAuth();

const signIn = (username) => signInWithEmailAndPassword(auth, syntheticEmail(username), DEMO_PASSWORD);

const accountFor = (uid) => {
  const entry = DEMO_ACCOUNTS.find((candidate) => candidate.uid === uid);
  return { userId: uid, roleId: entry.role, rankId: entry.rank };
};

// WHAT THE FIXTURES ARE DATED IN. Nothing takes a window any more - the payload carries no schedule at all (the screen in
// front of the member reads the month it is showing), so the fixtures simply use 2026 and the harness asserts that month
// through GET_SCHEDULE in the window section below.

const main = async () => {
  console.log('--- the demo station ---');
  await seed();
  checkIs('it seeded', true);

  // --- the officer's own payload: an administrator is a member too ---
  console.log('\n--- an officer signs in and reads the payload ---');
  await signIn('jane');
  const asOfficer = await fetchMemberPayload(accountFor('u1'));
  check('the payload reports success', asOfficer.success, true);
  // THE ROSTER IS NOT IN THE PAYLOAD ANY MORE - it is a directory, one document per member, and a member clocking in does not
  // need it. What a sign-in DOES carry is the on-duty list, joined to names by id (asserted below): two documents rather than
  // thirty at station scale. The screens that list people ask GET_ROSTER when they open, which is asserted in its own section.
  checkIs(
    'and the crew directory is not carried at sign-in',
    asOfficer.roster === undefined,
    JSON.stringify(asOfficer.roster && asOfficer.roster.length)
  );
  // The private halves of the split collections do not travel with the public ones.
  // THE SCHEDULE'S REFERENCE DATA IS NOT CARRIED FOR A MEMBER EITHER - the templates, the assignments and the shift definitions
  // (asserted where the readers are driven, below). The projection that keeps an officer's private note off a member's screen is
  // asserted THERE now, against GET_SCHEDULE_SETUP, because that is where those rows come from.
  // THE SCHEDULE IS DELIBERATELY NOT IN THE PAYLOAD any more: it is the one collection that grows without limit and no
  // screen in front of a member at sign-in draws one, so a calendar or the board asks GET_SCHEDULE for the month it is
  // showing (windowed - asserted in the section further down). This is the assertion that keeps it out of the sign-in.
  checkIs(
    'and nobody pays for the schedule at sign-in',
    asOfficer.schedule === undefined,
    JSON.stringify(Object.keys(asOfficer).filter((key) => key.includes('schedule')))
  );
  // The audience, which used to be filtered in a server function: an officer (role r1) sees the everyone-announcement
  // and the one for their role, but not the one addressed to a single member.
  check('an officer sees the announcements for everyone and for their role', asOfficer.announcements.map((row) => row.title).sort(), ['Everyone sees this', 'Officers only', 'Starts next year']);
  // THE BOUND IS A BOUND, and a fixture proves it. `Expired notice` is aimed at everyone and ended in February: it is in
  // the collection and in NOBODY's payload. Without a row like it, "announcements are read as what is in force" would be a
  // claim rather than a test - the other three stay visible either way.
  checkIs(
    'and an expired announcement is not in the payload at all',
    !asOfficer.announcements.some((row) => row.title === 'Expired notice')
  );
  // ...while one dated in the FUTURE is still carried: the read bounds what has ENDED, and whether it has STARTED yet is
  // the screen's decision (announcementIsLiveOn), not the query's.
  checkIs(
    'while a future-dated one is fetched and left to the screen to withhold',
    asOfficer.announcements.some((row) => row.title === 'Starts next year')
  );
  // EVENTS ARE NOT CARRIED EITHER. They are drawn by the three screens that have a calendar on them - the member's own, the
  // availability grid and the officer's board - so they arrive with the screen, read and watched (GET_EVENTS, and the listener
  // that follows that screen: see App.jsx's events effect). Nothing on the dashboard draws one.
  checkIs('and the calendar entries, which belong to those screens', asOfficer.events === undefined, JSON.stringify(asOfficer.events));
  checkIs('the settings arrive as key/value rows, the shape the app reads', Array.isArray(asOfficer.systemSettings) && asOfficer.systemSettings.every((row) => 'key' in row && 'value' in row));

  // --- the member's payload ---
  await signOut(auth);
  console.log('\n--- a member signs in ---');
  await signIn('bo');
  const asMember = await fetchMemberPayload(accountFor('u2'));
  // The mirror image of the officer's audience: the personal announcement and the everyone one, not the role one - and,
  // once more, not the expired one.
  check('the audience flips for a plain member', asMember.announcements.map((row) => row.title).sort(), ['Everyone sees this', 'For Bo', 'Starts next year']);
  checkIs(
    'and the expired notice is missing for a member too, not just for an officer',
    !asMember.announcements.some((row) => row.title === 'Expired notice')
  );
  // BOTH SHAPES OF CLAIM, because both are seeded while the module moves onto windows: the template-keyed row the
  // current screens read, and the window-keyed rows the new derivation reads. What the check is really about is the
  // SECOND half - the officer's own rows (av1, avw2) are absent.
  //
  // The row id is `window|day` (utils/availability.js), because the store is a month per member: a row is derived, not
  // stored, so it has no database id to carry. `aw1|2024-06-03` is not here, and that is the other half of the same
  // point: it lives in the member's 2024-06 month document, and the payload carries a NARROW band of months around today
  // ...AND THE CLAIMS ARE NOT CARRIED EITHER: they belong to the Availability screen, which reads the months it draws when it
  // is opened (GET_AVAILABILITY). What used to be asserted here - the member's own rows for a quarter, and nobody else's - is
  // now asserted against that reader, in the availability section below.
  checkIs(
    'their own claims are read when the grid opens, not at sign-in',
    asMember.availability === undefined,
    JSON.stringify(asMember.availability)
  );
  // THE CLOCK HISTORY IS DELIBERATELY NOT IN THE PAYLOAD, and this is the assertion that keeps it out. It is the one
  // per-member table that grows without limit - a five-year member has thousands of entries - and it was only read at sign-in
  // so the dashboard could answer "am I clocked in", a question the on-duty row answers for free. It is read now by the screen
  // that shows it, over a range.
  check('the clock history is not part of the sign-in payload', asMember.logs, undefined);
  checkIs('while the on-duty list it was standing in for is', Array.isArray(asMember.onDuty));
  // THE MEMBER'S OFFERS, SIGNATURES AND TRAINING LIST ARE NOT CARRIED EITHER, and each belongs to the screen that draws it:
  // offers to the calendar (GET_SHIFT_OFFERS, whose narrowing is asserted in its own section below), trainings and signatures to
  // the Training module (GET_TRAINING, the same section). A member who signs in to clock in opens neither.
  checkIs('their own offers are read by the calendar, not at sign-in', asMember.offers === undefined, JSON.stringify(asMember.offers));
  checkIs('and their training signatures by that module', asMember.signatures === undefined, JSON.stringify(asMember.signatures));
  checkIs('with the catalogue they are signed against', asMember.trainings === undefined, JSON.stringify(asMember.trainings));
  // CERTIFICATIONS, THOUGH, STAY: the dashboard's notice is drawn from them, and it is the one personal, time-critical thing on
  // a screen a member sees every day. Read on, with the catalogue they are named from.
  check('their own certifications', asMember.certifications.map((row) => row.id), ['cr1']);
  check('the certification catalogue they are named from', asMember.certificationSetup.map((row) => row.name), ['EMT']);
  // On duty is materialized by the clock transaction, joined to the roster here, and still three columns.
  check('who is on duty, with the name resolved', asMember.onDuty.map((row) => row.name), ['Jane Smith']);
  // THE NAMES ON THE ON-DUTY CARD ARE READ BY ID, not taken from a roster the sign-in used to carry: one document per person
  // on shift, which is the only directory read a dashboard costs. The columns are the same three a roster row has, and that is
  // the assertion that matters - the card, the name and the rank icon all draw from them.
  check('in the same three columns the roster projects', Object.keys(asMember.onDuty[0]).sort(), ['id', 'name', 'rank_id']);
  check('their own preference travels, which is what a 12-hour clock was losing', asMember.userSettings.map((row) => row.time_format), ['24']);
  check(
    'and the department name is in the settings rows',
    asMember.systemSettings.find((row) => row.key === 'department_name').value,
    'Bolivia Volunteer Fire Department'
  );
  checkIs(
    'and the schedule is not carried either, because no screen here draws one',
    asMember.schedule === undefined,
    JSON.stringify(asMember.schedule && asMember.schedule.length)
  );

  // --- the administrator payload: the member payload plus the sections an officer's tabs read ---
  await signOut(auth);
  console.log('\n--- an administrator reads the full payload ---');
  await signIn('jane');
  const asAdmin = await fetchAdminPayload(accountFor('u1'));
  // THREE roles now, not two: `r3` is the Assessor, seeded for the assessment-score rules - "an officer who may add scores
// still may not score themselves" needs an identity that HOLDS the permission and is not the subject, which the
// administrator cannot be (`is_admin` passes everything and would answer "allowed" for the wrong reason). The count is
// asserted rather than assumed, so adding a role again would fail here rather than silently pass.
checkIs(
    'the member half is still all there',
    Array.isArray(asAdmin.onDuty) && asAdmin.roles.length === 3,
    JSON.stringify({ onDuty: (asAdmin.onDuty || []).length, roles: (asAdmin.roles || []).length })
  );
  // THE SCHEDULE IS ASKED FOR RATHER THAN CARRIED, on both payloads - driven for real in the window section below, which is
  // where the month a screen would be showing gets read.
  checkIs(
    'and the schedule is asked for rather than carried',
    asAdmin.schedule === undefined,
    JSON.stringify(asAdmin.schedule && asAdmin.schedule.length)
  );
  // The directory joins the private half back on, which is exactly what the Users tab shows - under the SHEET'S field
  // name. The tab reads `user.user_name`; the first version of this payload called it `username`, so the column was blank
  // while the data it came from looked perfectly correct, which is how it was reported. This assertion follows the
  // COMPONENT rather than the payload, because a harness that agrees with the bug proves nothing.
  // THE DIRECTORY IS NOT IN THE PAYLOAD ANY MORE - one document per member, twice over, and only one tab draws it - so it is
  // read the way that tab reads it: a single section, on demand, over the same reader a save's refresh uses. That makes this the
  // assertion that the SECTION still projects correctly, which is what the tab actually receives.
  checkIs('and the user directory is not carried: its own tab reads it', asAdmin.users === undefined, JSON.stringify(asAdmin.users));
  const directory = await readAdminSections(['users']);
  check('the directory that tab reads carries names, usernames and status', directory.users.map((user) => [user.name, user.user_name, user.status]), [
    ['Jane Smith', 'jane', 'active'],
    ['Bo Jones', 'bo', 'active'],
    // Rae Nolan is the Assessor: the third seeded member, with `can_add_assessment_scores` and nothing else
    // administrative. Present so the rules harness has somebody who may score but must not score themselves.
    ['Rae Nolan', 'rae', 'active'],
  ]);
  checkIs('and no password, because there is none to leak', !JSON.stringify(directory.users).toLowerCase().includes('password'));
  // THE BOARD'S SECTIONS ARE NOT CARRIED EITHER - the assignments and templates with their private notes, the offers still waiting,
  // the shift definitions - because each of them belongs to a sub-tab that reads it when opened. They are read here the way those
  // tabs read them, one section at a time, which is also the assertion that the NOTE merge still happens: an officer's pickers and
  // notes read the whole record, while the member calendar's copies come from GET_SCHEDULE_SETUP without the notes.
  checkIs(
    'and no assignment or template rows at sign-in',
    asAdmin.assignments === undefined && asAdmin.scheduleTemplates === undefined,
    JSON.stringify(Object.keys(asAdmin).slice(0, 12))
  );
  const boardSections = await readAdminSections(['assignments', 'scheduleTemplates', 'scheduleOffers']);
  check('the assignment section merges the officer note back', boardSections.assignments[0].admin_note, 'checked monthly');
  // ...by ID rather than by index: the order is a rule (time, then the assignment's rank) instead of the collection's, so a row's
  // position is not a stable way to name it - which is exactly how this assertion broke once.
  check('and the template section likewise', boardSections.scheduleTemplates.find((row) => row.id === 't1').admin_note, 'temporary cover');
  // --- WHAT A SIGN-IN ACTUALLY READS, in the numbers a bill is made of -----------------------------------------------
  //
  // "READS" AND "FETCHES" ARE NOT THE SAME THING, and a browser console is the wrong instrument for judging this. The
  // Firestore transport keeps a WebChannel open, so its own POSTs appear there by the dozen while costing no document read
  // at all - and a getDoc is served through that same channel (the SDK's stack calls it readDocumentViaSnapshotListener),
  // which is why a handful of ordinary reads can look like a burst of traffic. Billing is per DOCUMENT: a getDocs bills one
  // per row it returns, and a getDoc one. So this counts documents.
  //
  // The counts come from the payload the app is handed, which is the honest source: it needs no instrumentation and it is
  // exactly what the read returned. The one-shot documents that are not rows in it are NAMED below rather than folded in -
  // inventing a number for them would be worse than saying where they are.
  console.log('\n--- the documents one sign-in reads ---');
  // THE COUNTER COUNTS DOCUMENTS OF BOTH SHAPES. An array is one document per row - that is how a getDocs bills - and a MAP OF
  // LISTS is one document per key, because that is what builds it: the certification badge index is `member id -> the icons to
  // draw`, read as one document per member. Counting only arrays hid it completely, which is worth saying out loud: the
  // instrument that measures this pass had a blind spot exactly where one of its wins was.
  const readCounts = (payload) =>
    Object.entries(payload || {})
      .map(([key, value]) => {
        if (Array.isArray(value)) return [key, value.length];
        const mapOfLists = value && typeof value === 'object' && Object.values(value).every(Array.isArray);
        if (mapOfLists) return [key, Object.keys(value).length];
        return [key, 0];
      })
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);
  const reportReads = (label, payload) => {
    const rows = readCounts(payload);
    console.log(`  ${label}: ${rows.reduce((sum, [, count]) => sum + count, 0)} documents`);
    rows.forEach(([key, count]) => console.log(`    ${String(count).padStart(4)}  ${key}`));
  };
  reportReads('member sign-in (u2)', asMember);
  reportReads('officer sign-in (u1, and the administration wave with it)', asAdmin);

  // --- WHAT THE DASHBOARD AND THE MENU STRICTLY NEED, which is the number that matters more than the total -----------
  //
  // A member signing in to clock in and leave sees the clock card, the on-duty list, the announcements, the certification
  // notice and the sidebar. Nothing on that screen draws a schedule, a template, an assignment, a shift, an offer, a
  // training, a document or the crew's claims - and the sidebar needs only the caller's own profile, their permissions and
  // their announcements. So every OTHER key below is a MODULE's data, and the goal is that it is read when that module is
  // opened rather than at sign-in.
  //
  // THE ESSENTIALS ARE CHECKED and the gap is PRINTED. A dashboard that cannot draw is a broken app rather than a slow one,
  // so that half must never regress; the distance to the whole payload is the work itself, and printing it is the point -
  // at fixture scale it is a dozen documents, and at station scale the three-month schedule alone is hundreds of rows for a
  // member who may only ever clock in.
  const SIGN_IN_ESSENTIALS = [
    'announcements',
    'certificationSetup',
    'certifications',
    'certificationRecords',
    'onDuty',
    'ranks',
    'roles',
    'systemSettings',
    'userSettings',
  ];
  const readSplit = (payload) => {
    const rows = readCounts(payload);
    const sum = (list) => list.reduce((total, [, count]) => total + count, 0);
    const essential = rows.filter(([key]) => SIGN_IN_ESSENTIALS.includes(key));
    const moduleData = rows.filter(([key]) => !SIGN_IN_ESSENTIALS.includes(key));
    return { essential: sum(essential), total: sum(essential) + sum(moduleData), moduleData };
  };
  const reportSplit = (label, payload) => {
    const split = readSplit(payload);
    console.log(`  ${label}: ${split.essential} of ${split.total} documents are what the dashboard and the menu draw`);
    console.log(
      `    carried at sign-in that no screen in front of the member reads: ${
        split.moduleData.map(([key, count]) => `${key} ${count}`).join(', ') || 'nothing'
      }`
    );
  };
  checkIs(
    'the dashboard’s own data is in the sign-in payload',
    SIGN_IN_ESSENTIALS.filter((key) => Array.isArray(asMember?.[key])).length >= 6,
    JSON.stringify(Object.keys(asMember || {}).sort())
  );
  reportSplit('member sign-in (u2)', asMember);
  reportSplit('officer sign-in (u1)', asAdmin);
  console.log('  single documents rather than rows: settings/public (before signing in), the caller’s users/{uid},');
  console.log('  users_private/{uid} on the sign-in path, and roles/{roleId} for the permission set - four at most.');
  console.log('  The live listeners bill per CHANGE, and the clock history is read only when its own screen opens.');

  // ...in the order the week reads in, not the order the collection hands them over: the sheet sent its own ROW order and
  // a collection has none, so every picker fed by this payload was shuffled. The seed's ids are deliberately NOT in this
  // order, and t3 and t1 START AT THE SAME TIME on the same day with different required ranks (a2 is the senior one), so
  // this asserts both keys: time first, then the assignment's rank.
  check('and in the week order: time first, then the assignment rank', boardSections.scheduleTemplates.map((row) => row.id), [
    't3',
    't1',
    't0',
    't2',
  ]);
  // `apparatus` is deliberately NOT in the payload any more: the client carries `apparatus_id` on rows and never renders
  // an apparatus name, so the collection was read on every load for no reader. The seed still holds it, which is what
  // makes this assertion mean something rather than being vacuous.
  check('the payload no longer reads the apparatus collection at all', asAdmin.apparatus, undefined);
  // Not "the whole offers table" any more: the officer's read is narrowed to the offers STILL WAITING, which is what the
  // board's slot flags are built from. The declined one is not an officer's business either - the member has been told, and
  // the slot is open again - so `of3` is absent here as well as `of2`.
  check('and the offers still waiting, not the whole table', boardSections.scheduleOffers.map((row) => row.id).sort(), ['of1']);
  // ...and the certification RECORDS are not carried either, for the same reason as the directory: every member's records, read by
  // the one tab that shows what is expiring next. Asserted through that section, which is what the tab receives.
  checkIs('and no certification records: their own tab reads them', asAdmin.certificationRecords === undefined, JSON.stringify(asAdmin.certificationRecords));
  const records = await readAdminSections(['certificationRecords']);
  check('the records that tab reads are every member’s, not only their own', records.certificationRecords.map((row) => row.id), ['cr1']);

  // --- and a member's payload does not carry any of them ---
  await signOut(auth);
  await signIn('bo');
  const asMemberAgain = await fetchMemberPayload(accountFor('u2'));
  ['users', 'apparatus', 'scheduleOffers', 'certificationRecords'].forEach((section) => {
    checkIs(`a member payload has no ${section} section`, !(section in asMemberAgain), 'an officer-only section travelled');
  });
  // THE BADGE INDEX IS NOT CARRIED EITHER - it is one document per member, and it left with the roster: the screens that draw a
  // name draw the icons beside it, and both come from GET_ROSTER now (asserted in that reader's own section below).
  checkIs(
    'and the badge index is not carried at sign-in',
    asMemberAgain.certificationBadges === undefined,
    JSON.stringify(asMemberAgain.certificationBadges)
  );

  // The harness's own guard: a section that stopped running would otherwise look like a pass.
  console.log('\n--- the harness itself ---');
  // --- and the ROUTED path, which is what the app actually calls -------------------------------------------------
  //
  // The reader above is called directly; this calls what api.js calls, through the router, with the gates open -
  // which is the only way to catch the difference between "the payload is right" and "the app receives it". That
  // difference is not hypothetical: the first version of this route returned the bare payload, the caller reads
  // `data.success` to decide whether a bootstrap loaded, and the whole read was dropped as a failed refresh. It
  // looked exactly like the read never moving to Firestore at all.
  console.log('\n--- through the router ---');
  process.env.VITE_FIRESTORE_FEATURES = 'memberPayload,memberReads,adminPayload,adminReads,documents';
  const { routeRead } = await import('../src/services/firestoreRouting.js');

  await signInWithEmailAndPassword(firebaseAuth(), syntheticEmail(DEMO_ACCOUNTS[0].username), DEMO_PASSWORD);
  // --- the schedule WINDOW: the collection a screen READS, rather than one the sign-in carries ------------------------
  //
  // `schedule` grows without limit - every shift the station has ever scheduled - and no screen at sign-in draws one, so the
  // payload does not carry it at all (asserted three times above). A calendar or the board asks GET_SCHEDULE for the month in
  // front of it, and the window travels back WITH the rows: that is what lets a screen tell "this month is empty" from "I
  // have not asked for this month", which is the difference between an empty calendar and a broken one.
  console.log('\n--- the schedule window ---');
  const narrow = await routeRead('GET_SCHEDULE', { from: '2026-03-09', to: '2026-03-09' });
  check('a one-day window brings back only that day', narrow.schedule.map((row) => row.id), ['s2']);
  check('and says which window it applied', narrow.schedule_window, { from: '2026-03-09', to: '2026-03-09' });
  // NAMING NO WINDOW ASKS FOR THE WHOLE COLLECTION, which is what a harness wants and what no screen does: slow rather than
  // wrong, so a screen that has not been scoped yet shows too much instead of silently showing nothing.
  const whole = await routeRead('GET_SCHEDULE');
  check('and with no window at all it is the whole collection', whole.schedule.length, 2);
  checkIs('with the open shift flagged, which is how the calendar finds it', whole.schedule.some((row) => row.is_open === true));

  // And the reader's own window, which is what a screen navigated outside the payload's months asks for. The session is
  // left exactly as it was found: everything after this point is signed in as jane, and a section that quietly changed
  // WHO is signed in would make the next permission assertion mean something else (as it did the first time).
  const ranged = await routeRead('GET_SCHEDULE', { from: '2026-03-09', to: '2026-03-09' });
  check('a reader asked for one day brings back one row', ranged.schedule.map((row) => row.id), ['s2']);
  check('and reports the window it applied', ranged.schedule_window, { from: '2026-03-09', to: '2026-03-09' });
  const unbounded = await routeRead('GET_SCHEDULE');
  // AND A WINDOW WITH NOTHING IN IT RETURNS NOTHING. A check that only asks whether rows came back passes just as happily
  // against a reader that ignored the window entirely - which is how a windowed read can look done while every member still
  // downloads the whole collection.
  const emptyWindow = await routeRead('GET_SCHEDULE', { from: '2035-01-01', to: '2035-01-31' });
  check('a schedule window with nothing in it returns nothing, not everything', emptyWindow.schedule, []);
  checkIs(
    'while a reader asked for nothing still answers with the whole collection',
    unbounded.schedule.length >= ranged.schedule.length && unbounded.schedule_window.from === '',
    JSON.stringify(unbounded.schedule_window)
  );

  // --- the shared `users` read: one read while in flight, never one across time --------------------------------
  //
  // Six readers project off this collection, and Firestore bills per document. The rule that makes sharing them safe is
  // that the entry is dropped the moment the read settles - so this asserts BOTH halves, and the second is the one that
  // matters: a shared read must never become a cache, or a save followed by a read could show the save that had not
  // landed. Identity is the proof, because the emulator cannot count reads.
  console.log('\n--- the shared users read ---');
  const [firstUsers, secondUsers] = await Promise.all([readUsersOnce(), readUsersOnce()]);
  checkIs('two readers in the same moment are handed one read', firstUsers === secondUsers);
  checkIs('and it is the collection, not an empty answer', Array.isArray(firstUsers) && firstUsers.length > 0);
  const laterUsers = await readUsersOnce();
  checkIs('while a later read is a new read rather than a cached one', laterUsers !== firstUsers);
  check(
    'with the same rows either way',
    laterUsers.map((row) => row.id).sort(),
    firstUsers.map((row) => row.id).sort()
  );

  // --- live reads: a listener fires on its own, with the shape the setters store ----------------------------------------
  //
  // This is the whole point of a listener and the two claims that matter are measured rather than assumed. First, that a
  // CHANGE reaches the app while it sits still - which is the thing a one-shot read cannot do, and what the dashboard's
  // "who is on duty" is for. Second, that what arrives has the SHAPE a payload row has: the app hands a live row and a read
  // row to the same setter, so a missing key here would empty the dashboard the moment somebody clocked in.
  //
  // The writes are the signed-in member's OWN on-duty row, because that is what the rules allow from here (`on_duty` is
  // `memberId == uid()`), and the seed leaves u1 on duty - so this restores the seed's value before it finishes.
  console.log('\n--- live reads ---');
  const live = { onDuty: [], announcements: [], errors: [] };
  const stopLive = subscribeLive({
    userId: 'u1',
    handlers: {
      onDuty: (rows) => live.onDuty.push(rows),
      announcements: (rows) => live.announcements.push(rows),
    },
    onError: (error) => live.errors.push(String((error && error.message) || error)),
  });
  await waitUntil(() => live.onDuty.length > 0 && live.announcements.length > 0, 'the two opening snapshots');
  checkIs('the duty list arrives unasked', live.onDuty.length > 0);
  checkIs('and so does the member’s own audience of announcements', live.announcements.length > 0);
  check('with nothing raised along the way', live.errors, []);

  const onDutyRef = doc(firestore(), 'on_duty', 'u1');
  const seedTimeIn = '2026-03-02 07:55';
  await setDoc(onDutyRef, { user_id: 'u1', time_in: '2026-03-09 08:00:00' });
  await waitUntil(() => live.onDuty.at(-1).some((row) => row.time_in === '2026-03-09 08:00:00'), 'the clock-in to arrive');
  const arrived = live.onDuty.at(-1).find((row) => row.id === 'u1') || {};
  check('a clock-in reaches the app while it sits still', arrived.time_in, '2026-03-09 08:00:00');
  checkIs('joined to a name', arrived.name === 'Jane Smith', JSON.stringify(arrived));
  // The field the dashboard's card draws its rank icon from, and the one the reader used to omit - which is why the reader
  // and this listener are asserted to AGREE below rather than trusted to.
  checkIs('and to a rank', Boolean(arrived.rank_id), JSON.stringify(arrived.rank_id));
  check(
    'in the same columns the payload fills',
    Object.keys(arrived).filter((key) => ['id', 'name', 'rank_id'].includes(key)).sort(),
    ['id', 'name', 'rank_id']
  );

  await deleteDoc(onDutyRef);
  await waitUntil(() => !live.onDuty.at(-1).some((row) => row.id === 'u1'), 'the clock-out to arrive');
  checkIs('and so does a clock-out, which is a removal rather than an edit', !live.onDuty.at(-1).some((row) => row.id === 'u1'));
  await setDoc(onDutyRef, { user_id: 'u1', time_in: seedTimeIn });
  await waitUntil(() => live.onDuty.at(-1).some((row) => row.time_in === seedTimeIn), 'the seed state to be restored');

  // What a one-shot read gives for the same collection, compared with what arrived live.
  const readBack = await routeRead('GET_ON_DUTY');
  check('the reader and the listener agree on who is on duty', readBack.onDuty.map((row) => row.id).sort(), live.onDuty.at(-1).map((row) => row.id).sort());
  checkIs('and both carry the rank the card draws', readBack.onDuty.every((row) => 'rank_id' in row));
  check('with the same rank for the same member', readBack.onDuty.find((row) => row.id === 'u1').rank_id, arrived.rank_id);

  // AND THE SAME FOR ANNOUNCEMENTS, which is where this one actually bit. The payload read and the listener have to produce
  // the SAME ROW, down to its id - and the seed's `an2` is deliberately a MIGRATED row, carrying a stale `sheet-1043` in its
  // own `id` column, because spreading that column over the document key is how a listener silently re-keys a row. That is
  // what happened in production: the dashboard drew the announcements correctly from the payload, the listener then REPLACED
  // them with rows keyed by a dead sheet id, and the screen changed shape the moment a change arrived. Both halves are asked
  // here so the two shapes cannot drift apart again.
  // The payload is asked directly rather than through the router, because this section's point is the SHAPE both halves
  // produce - not which feature flags are pinned on at the moment, which an earlier section controls on purpose.
  const readAnnouncements = await fetchMemberPayload(accountFor('u1'));
  const readAnnouncementIds = (readAnnouncements.announcements || []).map((row) => row.id).sort();
  const liveAnnouncementRows = live.announcements.at(-1) || [];
  check('the reader and the listener agree on the announcements', readAnnouncementIds, liveAnnouncementRows.map((row) => row.id).sort());
  checkIs(
    'and the migrated row is keyed by its document id, never the sheet id it still carries',
    readAnnouncementIds.includes('an2') && !readAnnouncementIds.includes('sheet-1043'),
    JSON.stringify(readAnnouncementIds)
  );
  check(
    'with the same fields on both sides',
    Object.keys(liveAnnouncementRows[0] || {}).sort(),
    Object.keys((readAnnouncements.announcements || [])[0] || {}).sort()
  );

  // WHAT A ONE-SHOT READ OF A WATCHED QUERY DOES, measured rather than assumed. The design note says a listener can make a
  // get() of the same query cache-served - and every collection watched here is also read by the sign-in payload, so that is
  // the difference between a payload read being free and it being a full collection read. `fromCache` is the SDK's own
  // answer; it is PRINTED as well as checked, so a change in that behaviour shows up in this output instead of being
  // inferred from a bill three months later.
  const watched = await getDocs(collection(firestore(), 'on_duty'));
  console.log(`     [live] a get() of a watched collection reports fromCache=${watched.metadata.fromCache}`);
  checkIs('and the cache question is answered rather than guessed', typeof watched.metadata.fromCache === 'boolean');

  stopLive();
  // AFTER THE TEARDOWN, SILENCE. A listener left running behind a signed-out screen is exactly the cost this pass exists to
  // remove, and it is invisible without a test like this one.
  //
  // Any snapshot already in flight is allowed to land FIRST, before the baseline is taken: otherwise the test would fail on
  // the write before it rather than on the write it makes, which is the sort of flake that teaches nobody anything.
  await settle();
  const beforeTeardown = live.onDuty.length;
  await setDoc(onDutyRef, { user_id: 'u1', time_in: '2026-03-09 09:00:00' });
  await settle();
  check('after the teardown a change is no longer delivered', live.onDuty.length, beforeTeardown);
  await setDoc(onDutyRef, { user_id: 'u1', time_in: seedTimeIn });

  // --- the leaderboard query, and the one way it can lose a member ------------------------------------------------------
  //
  // The board used to scan `users` and pick the top rows out in the browser; it is a bounded query now - 25 rows plus a
  // count, on the most repeated screen in the app. That trade has exactly ONE hazard, and it is demonstrated here rather
  // than described: a score stored as TEXT is not `> 0`, so its owner does not appear with a wrong number - they vanish.
  //
  // The assertions are relative to whatever the seed left, because this is not the only section that can put a score in.
  //
  // IT ENABLES ITS OWN ROUTE. Earlier in this harness a NARROW feature list is pinned on purpose (so a route that is not named
  // is proven to fall back), and `runner` is not in it - so the board would answer null here and this section would either
  // have to skip (proving nothing) or read a null as an empty board. It names the feature for its own length and puts the
  // list back, and the first assertion below is that the naming worked: if the flag stops being read live, this says so
  // rather than quietly testing nothing.
  const pinnedFeatures = process.env.VITE_FIRESTORE_FEATURES;
  process.env.VITE_FIRESTORE_FEATURES = `${pinnedFeatures},runner`;
  const board = () => routeRead('GET_RUNNER_LEADERBOARD');
  const beforeBoard = await board();
  checkIs('the board is routed for this section', Boolean(beforeBoard && Array.isArray(beforeBoard.leaderboard)));
  const beforeTotal = Number(beforeBoard.total) || 0;

  // HOW A TEXT SCORE CAN EXIST AT ALL: not from the app. The `users` rule allows only
  // ['name','rank_id','role_id','exclude_from_scheduling','runner_sound_profile'] - `hasOnly`, so a client CANNOT write this
  // field, and the assertion below proves it. The writers are the `saveRunnerScore` callable (which parses to an integer and
  // clamps it - asserted in verify-firestore-writes, where the functions emulator is running) and the MIGRATION, whose Admin
  // SDK ignores the rules. That is why this section drives the text-score case with the Admin SDK: a client-side test cannot
  // produce the state being tested, which is the whole reason the hazard is a migration-time one.
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore: getAdminFirestore, FieldValue: AdminFieldValue } = await import('firebase-admin/firestore');
  const admin = getAdminFirestore(
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-station-portal' }, 'verify-reads')
  );
  const setScore = (id, value) => admin.doc(`users/${id}`).set({ runner_score: value }, { merge: true });
  const clearScore = (id) => admin.doc(`users/${id}`).update({ runner_score: AdminFieldValue.delete() });

  // A score as the callable leaves it, and one as an untyped migration leaves it.
  await setScore('u1', 700);
  await setScore('u2', '1450');
  const typed = await board();
  check('a numeric score is on the board', typed.leaderboard.some((row) => row.id === 'u1' && row.score === 700), true);
  checkIs(
    'while one stored as text is invisible to the filter, which is the whole hazard',
    !typed.leaderboard.some((row) => row.id === 'u2')
  );
  check('and the total does not count it either', typed.total, beforeTotal + 1);
  checkIs('with the rows capped at the limit the reader asks for', typed.leaderboard.length <= 25);
  // ...and the app itself cannot create one, which is what keeps this a migration concern rather than a live bug: the rule is
  // `hasOnly`, so even an officer's own save is refused for carrying a field this document does not have.
  let clientRefused = '';
  try {
    await setDoc(doc(firestore(), 'users', 'u2'), { runner_score: 999 }, { merge: true });
  } catch (error) {
    clientRefused = String((error && error.code) || error);
  }
  check('a client cannot write a score at all', clientRefused, 'permission-denied');

  // The decision the repair script makes, asserted directly: a numeric string becomes a number, and anything that is not a
  // number is LEFT ALONE rather than turned into a 0 or a deletion.
  check('a numeric string is a score', scoreToStore('1450'), 1450);
  check('with the padding a cell can carry', scoreToStore(' 1450 '), 1450);
  check('a number needs nothing doing to it', scoreToStore(700), null);
  check('a blank is not a score', scoreToStore(''), null);
  check('nor is junk', scoreToStore('abc'), null);
  check('nor is an absent field', scoreToStore(undefined), null);

  // The repair, applied exactly as scripts/normalize-runner-scores.mjs applies it - through the Admin SDK, because that is the
  // door a repair has to use (see the note above about why a client cannot).
  await setScore('u2', scoreToStore('1450'));
  const fixed = await board();
  check('a repaired score joins the board', fixed.leaderboard.find((row) => row.id === 'u2')?.score, 1450);
  check('and the total follows it', fixed.total, beforeTotal + 2);
  check('in descending order', fixed.leaderboard.map((row) => row.score), [...fixed.leaderboard.map((row) => row.score)].sort((a, b) => b - a));

  // THE QUERY AND THE SCAN MUST AGREE, which is the real claim: the board is the same board the old client-side filter
  // produced, just computed by the database. Anything the query can do differently - a dropped document, a different order,
  // a count that misses - shows up here as a difference from the scan.
  const scanned = (await getDocs(collection(firestore(), 'users'))).docs
    .map((entry) => ({ id: entry.id, score: Number((entry.data() || {}).runner_score) || 0 }))
    .filter((row) => row.id && row.score > 0)
    .sort((a, b) => b.score - a.score);
  check('the query lists exactly the members the scan finds', fixed.leaderboard.map((row) => row.id).sort(), scanned.slice(0, fixed.leaderboard.length).map((row) => row.id).sort());
  check('with the same scores in the same order', fixed.leaderboard.map((row) => row.score), scanned.slice(0, fixed.leaderboard.length).map((row) => row.score));
  check('and a total the scan agrees with', fixed.total, scanned.length);
  check('projecting only the three fields the game draws', Object.keys(fixed.leaderboard[0]).sort(), ['id', 'name', 'score']);

  // A CAP AND A TOTAL ARE DIFFERENT NUMBERS, and the difference is invisible until a station has more scorers than a board
  // holds: the rows are capped at 25, the total counts everybody. Seeding more than a board's worth is the only way to see
  // it, and it is worth the writes - a total that reports "of 25" because the count inherited the cap is a wrong number on
  // a screen, with nothing else to notice it.
  const extras = Array.from({ length: 30 }, (_, index) => ({ id: `cap${index + 1}`, score: index + 1 }));
  for (let index = 0; index < extras.length; index += 15) {
    const batch = admin.batch();
    extras.slice(index, index + 15).forEach((extra) => {
      batch.set(admin.doc(`users/${extra.id}`), { name: `Cap ${extra.score}`, runner_score: extra.score }, { merge: true });
    });
    await batch.commit();
  }
  const capped = await board();
  check('the board holds no more rows than it draws', capped.leaderboard.length, 25);
  check('in descending order', capped.leaderboard.map((row) => row.score), [...capped.leaderboard.map((row) => row.score)].sort((a, b) => b - a));
  check('with the seeded extras on it', capped.leaderboard.some((row) => String(row.id).startsWith('cap')), true);
  check('while the total counts everybody with a score', capped.total, 30 + beforeTotal + 2);
  checkIs('which is more than the board is allowed to show', capped.total > capped.leaderboard.length);
  await Promise.all(extras.map((extra) => admin.doc(`users/${extra.id}`).delete()));

  // Left as it was found: neither member had a score before this section, and the sections after it read the roster.
  await clearScore('u1');
  await clearScore('u2');
  const restored = await board();
  check('and cleaning up returns the board to where it started', restored.total, beforeTotal);
  // ...and the feature list goes back exactly as it was, so every section after this one sees the environment it would have
  // seen if this one did not exist.
  process.env.VITE_FIRESTORE_FEATURES = pinnedFeatures;

  const routed = await routeRead('GET_BOOTSTRAP');
  checkIs('the router answers at all, with a Firebase user signed in', routed !== null, 'nothing was routed');
  check('and in the shape the caller decides on', routed.success, true);
  checkIs(
    'carrying the payload the screens read',
    // `schedule` is deliberately NOT among them any more - it is read per month by the screen that draws it - so the keys
    // asserted here are the ones a sign-in genuinely lands with.
    Array.isArray(routed.onDuty) && routed.scheduleTemplates === undefined && routed.schedule === undefined,
    JSON.stringify(Object.keys(routed || {}).slice(0, 8))
  );

  // --- the member's own claims and the options list: read by the screen that draws them -------------------------------
  //
  // Neither is in the sign-in payload any more (asserted above), because a member who signs in to clock in never opens the
  // Availability screen. The grid asks for the options list and for the months it draws, and the scope comes back with the
  // claims so a month outside it can be asked for rather than guessed at - the same arrangement GET_SCHEDULE uses.
  console.log('\n--- the availability grid reads its own data ---');
  const claims = await routeRead('GET_AVAILABILITY', { from: '2026-09-01', to: '2026-09-30' });
  check('the claims come back for the months the range covers', (claims.availability || []).map((row) => row.id).sort(), ['aw1|2026-09-01']);
  check('with the scope they were read over', claims.availability_window, { from: '2026-09-01', to: '2026-09-30' });
  const windowsForGrid = await routeRead('GET_AVAILABILITY_WINDOWS');
  check(
    'and the options list the grid draws from, retired windows and all',
    (windowsForGrid.availabilityWindows || []).map((row) => row.nickname).sort(),
    ['Next year pattern', 'Old weekday pattern', 'Saturday day', 'Tuesday night']
  );

  // --- the calendar's offers and the Training module's two lists, read by the screens that draw them -------------------
  //
  // Read as the MEMBER, deliberately: these are their own offers and their own signatures, and signing in as anybody else would
  // make the assertions below pass on an empty list - which is exactly how a scoped read fails quietly.
  await signOut(auth);
  await signIn('bo');
  //
  // THE OFFERS ARE STILL NARROWED, and this is where that is asserted now: pending and declined only. `of2` was approved -
  // approving fills the shift, so the slot is closed and there is no pill to colour - and it must NOT come back. `of3` was
  // declined and must, because the calendar shows a declined pill so the member knows the shift is closed to them rather than
  // open to anyone.
  console.log('\n--- offers and training, read where they are drawn ---');
  const myOffers = await routeRead('GET_SHIFT_OFFERS');
  check('the member’s own offers, over the statuses a calendar draws from', myOffers.offers.map((row) => row.id).sort(), ['of1', 'of3']);
  checkIs(
    'and no approved offer among them: the shift it filled has no open pill',
    !myOffers.offers.some((row) => row.status === 'approved'),
    JSON.stringify(myOffers.offers.map((row) => row.status))
  );
  // Both courses, and deliberately not an order: the sheet had none of its own for trainings (it sent row order, which a
  // collection cannot inherit), so this asserts the CONTENT rather than inventing a sequence the station never chose.
  const trainingNow = await routeRead('GET_TRAINING');
  check('the training list, both courses', trainingNow.trainings.map((row) => row.title).sort(), ['Hazmat Awareness', 'SCBA Fit Test']);
  check(
    'and this member’s own signatures with it, so one read answers signed and outstanding',
    (trainingNow.signatures || []).map((row) => row.id),
    ['ts1']
  );
  // The calendar entries, which the three calendar screens read - and whose listener follows that screen rather than the
  // session. Asserted as a member (this section signed in as one), because that is the audience the seed's events are aimed at.
  const calendarEvents = await routeRead('GET_EVENTS');
  checkIs('and the calendar entries come back for the member', Array.isArray(calendarEvents.events) && calendarEvents.events.length > 0, JSON.stringify(calendarEvents.events));
  checkIs('including the one aimed at everybody', calendarEvents.events.some((row) => row.title === 'Everyone'), JSON.stringify(calendarEvents.events.map((row) => row.title)));
  // ...and THE SCHEDULE'S REFERENCE DATA, which the calendar and the clock table read. The projection assertion that used to sit
  // on the member payload lives here now, and here it means more: these are the PUBLIC rows, and an officer's private note travels
  // in its own collection for the administration wave to merge. Both halves of that are checked - the note is absent from what the
  // member reads, and present in what the officer does (asserted further up, against the admin payload).
  const setup = await routeRead('GET_SCHEDULE_SETUP');
  check('the templates a shift is drawn from, in the week order', setup.scheduleTemplates.map((row) => row.id), ['t3', 't1', 't0', 't2']);
  checkIs('with no officer note anywhere in them', !('admin_note' in (setup.scheduleTemplates[0] || {})), JSON.stringify(setup.scheduleTemplates[0]));
  checkIs('and none in the assignments either', !('admin_note' in (setup.assignments[0] || {})), JSON.stringify(setup.assignments[0]));
  check('and the shift definitions a clock entry is labeled with', Array.isArray(setup.shifts) && setup.shifts.length > 0, true);
  // Back where this section found the session, so every assertion after it still means what it says.
  await signOut(auth);
  await signIn('jane');

  // The officer's payload through the same route. It is the member payload PLUS the tab sections, each gated in the
  // reader on the permission its tab needs, so this is also a check that the gating did not take the whole thing down.
  const adminRouted = await routeRead('ADMIN_GET_BOOTSTRAP');
  checkIs('the officer payload routes too', adminRouted !== null, 'nothing was routed');
  check('and in the same shape', adminRouted.success, true);
  checkIs(
    'and adding NOTHING to it: every officer-only section now belongs to a sub-tab',
    // THIS IS THE END OF THE PASS, STATED AS ONE LINE: an officer's sign-in is the member payload and no more. The board's
    // templates and assignments, the offers queue, the shift definitions, the directory and the certification records are each read
    // by the tab that draws them (App.jsx's admin section effect), and the private notes travel in their own collections for that
    // read to merge.
    adminRouted.users === undefined &&
      adminRouted.assignments === undefined &&
      adminRouted.scheduleTemplates === undefined &&
      adminRouted.scheduleOffers === undefined &&
      adminRouted.certificationRecords === undefined,
    JSON.stringify(Object.keys(adminRouted || {}).slice(0, 12))
  );

  // The refresh reads, through the same route. Their shapes have to be the PAYLOAD's shapes - data.onDuty, data.logs,
  // data.roster - because the app hands the payload and the refresh to the same setters, and a different key here is
  // a screen that empties when the refresh lands.
  const onDuty = await routeRead('GET_ON_DUTY');
  check(
    'the on-duty read routes, carrying the key the dashboard reads',
    [onDuty.success, Array.isArray(onDuty.onDuty)],
    [true, true]
  );
  // THE ROSTER IS A READ OF ITS OWN AGAIN, and the reason is exactly this pass: it used to ride along in the sign-in payload, so
  // nothing asked for it - and now the screens that LIST people do (App#loadRoster), which is what makes it worth routing. Its
  // three columns are asserted here because this is now the only place they are produced.
  const roster = await routeRead('GET_ROSTER');
  check('the roster read answers the crew directory', Object.keys(roster.roster[0]).sort(), ['id', 'name', 'rank_id']);
  checkIs('with no role in it, for anybody', !JSON.stringify(roster.roster).includes('role_id'), 'a role is in the roster');
  // ...AND THE BADGE INDEX RIDES WITH IT, because the screens that draw a NAME draw the icons beside it. It is public-safe by
  // design - derived from records a member may not read, but holding only what is safe to show - which is why it is not an
  // officer-only section, and why both viewers get exactly the same one.
  check('and the badge index that goes with the names', roster.certificationBadges.u2.map((badge) => badge.name), ['EMT']);
  checkIs(
    'shaped as the member id -> icons map the badges component reads',
    Array.isArray(roster.certificationBadges.u2),
    JSON.stringify(roster.certificationBadges)
  );
  const training = await routeRead('GET_TRAINING');
  checkIs('and training its list', Array.isArray(training.trainings), 'no trainings');
  checkIs('and the clock history, as an array', Array.isArray((await routeRead('GET_TIMECLOCK_LOGS')).logs), 'no logs');
  // SCOPED TO THE VIEWER - the property that the payload no longer states by carrying the history around. This session is
  // jane (u1), whose only seeded entry is c1, while bo's is c2: so this fails loudly if the reader ever loses its `user_id`
  // filter and starts handing a member the whole station's history (refused by the rules if it is lucky, allowed if not).
  //
  // CHECKED AS BO FIRST, WHO HAS NO TIME-CLOCK PERMISSION. An officer's read is widened (the assertions after this block),
  // and holding the member case here - BEFORE the widening - is what makes that widening safe: a change that dropped the
  // `user_id` filter unconditionally would fail THIS line and not the officer's, which is the direction that leaks.
  await signIn('bo');
  const memberLogs = await routeRead('GET_TIMECLOCK_LOGS');
  check(
    'a member without the timeclock permission reads only their own entries',
    memberLogs.logs.map((row) => row.id),
    ['c2']
  );
  // ...AND THE SAME FOR THE WINDOWED FORM, which is a DIFFERENT branch in the reader - and the one an officer's read
  // actually takes. Asserting only the unbounded form left the windowed query untested against widening.
  //
  // The reader resolves the permission BEFORE choosing a query, so this still returns bo's own row rather than an error.
  // That the reader could get this wrong is covered by verify:rules, which asks the RULES directly; what is asserted here
  // is that the client never even tries the wider query for a member - a refusal arriving as an exception rather than an
  // answer is the failure this guards.
  const memberWindow = await routeRead('GET_TIMECLOCK_LOGS', { from: '2026-01-01', to: '2026-12-31' });
  check(
    'and the same when a window is named, which is the query shape an officer uses',
    memberWindow.logs.map((row) => row.id),
    ['c2']
  );
  await signIn('jane');
  const logs = await routeRead('GET_TIMECLOCK_LOGS');

  // AN OFFICER SEES THE STATION'S, WHICH IS WHAT Clock Management IS FOR. This is the reported fault and it was not a
  // permissions problem: the rules have always allowed an officer to read anybody's entry
  // (`resource.data.user_id == uid() || permission('can_edit_timeclock')`) and the tab has always offered a member picker.
  // The reader hard-coded `where('user_id', '==', uid)`, so picking another member changed the filter and not the rows -
  // the dropdown was honest and the data was not. jane is signed in here and her role (r1) carries is_admin.
  check(
    'while an officer reads the whole station, not just their own',
    logs.logs.map((row) => row.id).sort(),
    ['c1', 'c2']
  );
  checkIs(
    'including their own, still attributed to them',
    logs.logs.some((row) => row.id === 'c1' && row.user_id === 'u1'),
    JSON.stringify(logs.logs)
  );
  checkIs(
    'and somebody else\'s entry is attributed to THAT member, so the picker can label it',
    logs.logs.some((row) => row.id === 'c2' && row.user_id === 'u2'),
    JSON.stringify(logs.logs)
  );

  // THE LAST DAY OF THE WINDOW, WHICH IS WHERE THE BUG WAS. Written here rather than left to the seed because the seed's
  // only entry (c1, '2026-03-02 07:55') sits in the MIDDLE of the window - which is why this read was wrong in the field
  // for as long as it was, with every harness green: nothing was ever stamped on the boundary day to be dropped.
  //
  // `time_in` is a datetime and the window's bounds are bare 'yyyy-MM-dd' keys, so Firestore compares them as TEXT and
  // an inclusive `<= '2026-03-31'` excludes every entry on the 31st, because the space after the date sorts before the
  // end of the string. On a screen asking for "[12 months back, TODAY]" that is exactly the entry a member has just
  // clocked in: the write succeeded, the row was not there, and every older row was. So the fixture is an entry dated
  // the LAST day of the window, and the assertion names it - a check over "the rows that came back" cannot notice one
  // that did not, which is precisely the gap that let this ship.
  const boundaryRef = doc(firestore(), 'timeclock', 'c-boundary');
  await setDoc(boundaryRef, { user_id: 'u1', time_in: '2026-03-31 14:33:12', time_out: '', is_manual: false });
  // WINDOWED, which is how the screen asks for it: a range is applied, and a range with nothing in it returns nothing rather
  // than quietly returning everything - which is the failure that would turn a saving into a larger read than before.
  //
  // The bound check cuts `time_in` to its day with nextDateKey rather than repeating the bare-key comparison, because
  // repeating it is what let a datetime row pass an assertion written for a date column in the first place.
  const windowed = await routeRead('GET_TIMECLOCK_LOGS', { from: '2026-03-01', to: '2026-03-31' });
  checkIs(
    'a window narrows the history to that range',
    windowed.logs.every((row) => {
      const day = nextDateKey(row.time_in.slice(0, 10));
      return day >= '2026-03-01' && day <= nextDateKey('2026-03-31');
    }),
    JSON.stringify(windowed.logs)
  );
  check('and says which window it applied', windowed.logs_window, { from: '2026-03-01', to: '2026-03-31' });
  // c2 IS HERE AND EXPECTED: this is jane's windowed read, and jane manages the timeclock, so the window spans the
  // STATION - bo's March entry is in it too. That IS the change. The April row NOT appearing below is what keeps the range
  // honest, and the block above (as bo) is what keeps the widening from reaching a member.
  check(
    'AND THE ENTRY DATED THE LAST DAY OF THE WINDOW COMES BACK - the one that used to vanish',
    windowed.logs.map((row) => row.id).sort(),
    ['c-boundary', 'c1', 'c2']
  );
  // ...while the day AFTER it still does not, so the bound is the day it claims to be rather than the whole month. An
  // "exclusive" bound that quietly became inclusive would pass the case above and lose this one.
  await setDoc(boundaryRef, { user_id: 'u1', time_in: '2026-04-01 00:00:01', time_out: '', is_manual: false });
  const afterWindow = await routeRead('GET_TIMECLOCK_LOGS', { from: '2026-03-01', to: '2026-03-31' });
  check(
    'and an entry a day past it is still excluded, so the bound did not simply widen',
    afterWindow.logs.map((row) => row.id).sort(),
    ['c1', 'c2']
  );
  // A one-day window is the tightest form of the same question, and it is what a member's date filter effectively asks
  // for when they pick the 31st on its own.
  await setDoc(boundaryRef, { user_id: 'u1', time_in: '2026-03-31 14:33:12', time_out: '', is_manual: false });
  const singleDay = await routeRead('GET_TIMECLOCK_LOGS', { from: '2026-03-31', to: '2026-03-31' });
  check('a one-day window still returns that day\'s entry', singleDay.logs.map((row) => row.id), ['c-boundary']);
  await deleteDoc(boundaryRef);
  const empty = await routeRead('GET_TIMECLOCK_LOGS', { from: '2026-04-01', to: '2026-04-30' });
  check('a window with nothing in it returns nothing, not everything', empty.logs, []);

  // A read that is NOT routed still answers null, so the hook in api.js leaves it alone.
  check('a read with no route still answers null', await routeRead('GET_SYSTEM_SETTINGS'), null);

  // The officer-only reads the tabs make for themselves, which is what the rules pass was for: without the officer
  // branch these were permission-denied, and the whole-collection read is exactly what the branch makes provable.
  const allAnnouncements = await routeRead('ADMIN_GET_ANNOUNCEMENTS');
  checkIs(
    'an officer reads every announcement, not just their own audience',
    allAnnouncements.success === true && Array.isArray(allAnnouncements.announcements) && allAnnouncements.announcements.length > 0,
    JSON.stringify(allAnnouncements && Object.keys(allAnnouncements))
  );
  // NOTHING IS HIDDEN, ONLY NOT NARROWED. The active bound lives on the member-facing reads, so the expired notice is
  // still here for the person who has to manage it - and that is the property that makes the bound safe to have: a row the
  // filter keeps out of a payload is one an officer can still find, edit and re-date, rather than one that vanished.
  checkIs(
    'and the expired notice is still visible to an officer, which is what keeps the bound safe',
    allAnnouncements.announcements.some((row) => row.title === 'Expired notice')
  );
  const allEvents = await routeRead('ADMIN_GET_EVENTS');
  checkIs('and every event', Array.isArray(allEvents.events), 'no events');
  const allDocuments = await routeRead('ADMIN_GET_DOCUMENTS');
  checkIs('and the documents collection, which had no rules at all until now', Array.isArray(allDocuments.documents), 'no documents');
  await signOut(firebaseAuth());

  // The last member read, and its two halves. The devices half is a member's own rows, which the rules allow because
  // the query says whose they are. The other half - "whose device is this browser?" - is a callable and is asserted in
  // the WRITES harness, which runs the functions emulator; here the read is asked WITHOUT a token, which is the shape
  // the card uses on a browser that has no subscription - so the callable is deliberately never reached from here.
  await signIn('bo');
  await setDoc(doc(firestore(), 'push_devices', 'dev-own'), {
    user_id: 'u2',
    token: 'token-of-bo',
    device_label: 'Firehouse iPad',
  });
  const devices = await routeRead('MY_PUSH_DEVICES');
  check('a member reads their own devices', devices.devices.map((row) => row.id), ['dev-own']);
  check('and no owner is claimed when the browser passed no token', devices.device_owner, null);

  // A verifier's view of another member's records: the documents THAT MEMBER can see, and their signatures. The
  // permission is the rules' - which is why a member is refused and an officer is not.
  await signIn('jane');
  const boRecords = await routeRead('GET_MEMBER_DOCUMENT_RECORDS', { user_id: 'u2' });
  check('a verifier reads another member records', boRecords.documents.map((entry) => entry.id).sort(), ['doc1', 'doc5', 'doc6']);
  checkIs('with that member own signatures', boRecords.signatures.every((row) => row.user_id === 'u2'), JSON.stringify(boRecords.signatures).slice(0, 100));
  check('and a member who does not exist is reported rather than throwing', (await routeRead('GET_MEMBER_DOCUMENT_RECORDS', { user_id: 'nobody' })).message, 'That member no longer exists.');

  await signIn('bo');
  checkIs(
    'while a member without the permission reads nothing at all',
    (await routeRead('GET_MEMBER_DOCUMENT_RECORDS', { user_id: 'u1' })) === null
  );

  // The member's library: the AUDIENCE and the two flags, because a document can be aimed at exactly the right people
  // and still not be available yet. Four fixtures, one per rule.
  await signIn('bo');
  const library = await routeRead('GET_DOCUMENTS');
  check('a member sees the documents aimed at them', library.documents.map((entry) => entry.id).sort(), ['doc1', 'doc5', 'doc6']);
  checkIs('and their own signatures come with it, so one read answers signed and outstanding', library.signatures.length >= 1, String(library.signatures.length));
  // The ORDER is the backend's job: the client draws the list as it arrives, so the folders-then-sort_order-then-title
  // rule has to survive the move or a library reads shuffled - and a drag that moved a document looks like it did
  // nothing. All three fixtures are unfiled, so this is the title order.
  check('and the library arrives in the order it is drawn in', library.documents.map((entry) => entry.id), ['doc1', 'doc6', 'doc5']);
  // A checklist's two counts, without which its row cannot say "3 of 12" at all: `item_count === 0` means "nothing is
  // being asked of you here", so a checklist with items and no counts reads as a document that asks nothing.
  const checklistRow = library.documents.find((entry) => entry.id === 'doc5');
  check('a checklist carries how many items it has', checklistRow.item_count, 2);
  check('and how many of them the reader has signed', checklistRow.items_signed, 0);

  // The detail read: the body, the items, and the reader's OWN signature. A document has to read as signed on its own
  // page exactly as it does in the list, and a checklist has to arrive WITH its items, because the screen draws them from
  // the document it opened (checklistSections(openDocument.items)) rather than fetching them.
  const opened = await routeRead('GET_DOCUMENT', { id: 'doc1' });
  check('and one document opens with its body', opened.document.title, 'Annual SOG Acknowledgement');
  checkIs('the body coming from its own collection', opened.document.content.includes('Annual SOG'), JSON.stringify(opened.document.content));
  check('with the signature that is on file for this reader', opened.signature.id, 'sg1');
  check('which is not stale, because it was taken against the current wording', opened.signature_stale, false);
  checkIs('and a plain document carries no items', Array.isArray(opened.document.items) && opened.document.items.length === 0);
  const openedChecklist = await routeRead('GET_DOCUMENT', { id: 'doc5' });
  check('while a checklist opens with its items in order', openedChecklist.document.items.map((item) => item.id), ['it3', 'it4']);

  // UNAVAILABLE, not forbidden: a document aimed at another rank answers as though it were not there, which is why a
  // crafted request learns nothing about what exists above the caller's rank.
  const above = await routeRead('GET_DOCUMENT', { id: 'doc2' });
  check('a document above their rank reads as unavailable, not as forbidden', [above.success, above.message], [false, 'That document is not available.']);
  check('and one that is not live yet answers the same way', (await routeRead('GET_DOCUMENT', { id: 'doc3' })).success, false);
  check('as does an unpublished one', (await routeRead('GET_DOCUMENT', { id: 'doc4' })).success, false);

  // An officer is not filtered: managing documents is the job, and the editor needs the WHOLE row.
  await signIn('jane');
  const officerView = await routeRead('ADMIN_GET_DOCUMENT', { id: 'doc2' });
  check('an officer opens any document, audience or not', officerView.success, true);
  check('with the whole row rather than a projection', officerView.document.audience_keys, ['rank:k1']);
  // Jane's own signature on doc1 was taken against revision 1 while the document now stands at 2, so the page has to warn
  // her - the same staleness judgment the sheet made in the same place, and the reason the flag is decided by the reader
  // rather than by each screen.
  const janeOpened = await routeRead('GET_DOCUMENT', { id: 'doc1' });
  check('a signature older than the wording it is on', janeOpened.signature.id, 'sg2');
  check('reads as stale on the page', janeOpened.signature_stale, true);

  // A document's checklist items and the signatures taken on it: the read that failed in the field, because the
  // collections and the rules existed and only the reader was missing - which nothing noticed while the sheet answered.
  await signIn('jane');
  const documentSignatures = await routeRead('GET_DOCUMENT_SIGNATURES', { id: 'doc1' });
  check('a document’s checklist items come back in order', documentSignatures.items.map((item) => item.id), ['it1', 'it2']);
  check('and its signatures newest first', documentSignatures.signatures.map((entry) => entry.id), ['sg2', 'sg1']);
  // Staleness is decided against the document's CURRENT revision, the way the sheet decided it and for the same reason:
  // every screen must show the same judgment. sg2 is the NEWER signature and still stale, because it was taken against
  // revision 1 - so this asserts the rule rather than the clock.
  check('a signature taken before the wording changed is stale', documentSignatures.signatures[0].stale, true);
  check('and one taken against the current revision is not', documentSignatures.signatures[1].stale, false);

  // The RULES decide who may read somebody's paperwork, not the reader: a member with neither document permission gets
  // nothing back at all, because the query cannot be proven.
  await signIn('bo');
  checkIs(
    'a member without the document permissions gets nothing',
    (await routeRead('GET_DOCUMENT_SIGNATURES', { id: 'doc1' })) === null
  );

  // The pre-login read, with NOBODY signed in - the one read in the app that works that way, and now ONE DOCUMENT: the
  // public settings the login and loading screens draw. It used to ask for roles, ranks, shifts and the login-screen
  // announcements as well; the rules refuse the first three to a stranger, so those were round trips spent being told no,
  // and the fourth is gone with the placement it served (utils/announcements). The assertion is therefore about what is NOT
  // asked for, which is the part that keeps this read cheap.
  await signOut(firebaseAuth());
  const preLogin = await routeRead('GET_INITIAL_DATA');
  checkIs('the loading screen reads without anybody signed in', preLogin !== null, 'nothing was routed');
  check('and gets the station settings it draws', [preLogin.success, Array.isArray(preLogin.systemSettings)], [true, true]);
  check(
    'and asks for nothing else at all',
    [preLogin.roles, preLogin.ranks, preLogin.shifts, preLogin.announcements],
    [undefined, undefined, undefined, undefined]
  );

  // The kill switch, which has to work whatever else is true.
  process.env.VITE_FIRESTORE_FEATURES = 'off';
  check('with the switch off the router answers null', await routeRead('GET_BOOTSTRAP'), null);
  delete process.env.VITE_FIRESTORE_FEATURES;

  checkIs('every case ran', cases >= 34, `only ${cases} cases: a section has stopped running`);
};

main()
  .then(() => {
    console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} (${cases} cases)`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error) => {
    if (String(error.code || '').includes('unavailable') || /ECONNREFUSED/.test(String(error.message))) {
      console.error('\nThe emulators are not reachable. Run `npm run verify:firestore-reads`, which starts them.');
    } else {
      console.error(error);
    }
    process.exit(1);
  });
