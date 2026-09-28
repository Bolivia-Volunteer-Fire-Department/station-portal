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
import { fetchAdminPayload, fetchMemberPayload } from '../src/services/firestorePayload.js';
import { firebaseAuth, firebaseConfigured } from '../src/services/firebase.js';
import { syntheticEmail } from '../src/services/firebaseAuth.js';

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

const main = async () => {
  console.log('--- the demo station ---');
  await seed();
  checkIs('it seeded', true);

  // --- the officer's own payload: an administrator is a member too ---
  console.log('\n--- an officer signs in and reads the payload ---');
  await signIn('jane');
  const asOfficer = await fetchMemberPayload(accountFor('u1'));
  check('the payload reports success', asOfficer.success, true);
  // The roster is the projection, not the row: three fields, and no role for anybody.
  check('the roster is the three columns the client draws', Object.keys(asOfficer.roster[0]).sort(), ['id', 'name', 'rank_id']);
  checkIs('and no role leaked into it', !JSON.stringify(asOfficer.roster).includes('role_id'), 'a role is in the roster');
  // The private halves of the split collections do not travel with the public ones.
  checkIs('assignments arrive without the officer-only note', !('admin_note' in (asOfficer.assignments[0] || {})));
  checkIs('and templates likewise', !('admin_note' in (asOfficer.scheduleTemplates[0] || {})));
  check('everybody sees the whole schedule', asOfficer.schedule.length, 2);
  // The audience, which used to be filtered in a server function: an officer (role r1) sees the everyone-announcement
  // and the one for their role, but not the one addressed to a single member.
  check('an officer sees the announcements for everyone and for their role', asOfficer.announcements.map((row) => row.title).sort(), ['Everyone sees this', 'Officers only']);
  check('and the events for everyone and for their rank', asOfficer.events.map((row) => row.title).sort(), ['Everyone', 'Officer and firefighter']);
  checkIs('the settings arrive as key/value rows, the shape the app reads', Array.isArray(asOfficer.systemSettings) && asOfficer.systemSettings.every((row) => 'key' in row && 'value' in row));

  // --- the member's payload ---
  await signOut(auth);
  console.log('\n--- a member signs in ---');
  await signIn('bo');
  const asMember = await fetchMemberPayload(accountFor('u2'));
  // The mirror image of the officer's audience: the personal announcement and the everyone one, not the role one.
  check('the audience flips for a plain member', asMember.announcements.map((row) => row.title).sort(), ['Everyone sees this', 'For Bo']);
  check('their own availability and nobody else', asMember.availability.map((row) => row.id), ['av2']);
  check('their own clock history and nobody else', asMember.logs.map((row) => row.id), ['c2']);
  check('their own offers', asMember.offers.map((row) => row.id), ['of1']);
  check('their own signatures', asMember.signatures.map((row) => row.id), ['ts1']);
  check('their own certifications', asMember.certifications.map((row) => row.id), ['cr1']);
  check('the certification catalogue they are named from', asMember.certificationSetup.map((row) => row.name), ['EMT']);
  check('and the training list', asMember.trainings.map((row) => row.title), ['SCBA Fit Test']);
  // On duty is materialized by the clock transaction, joined to the roster here, and still three columns.
  check('who is on duty, with the name resolved', asMember.onDuty.map((row) => row.name), ['Jane Smith']);
  check('in the same three columns as the roster', Object.keys(asMember.onDuty[0]).sort(), ['id', 'name', 'rank_id']);
  check('their own preference travels, which is what a 12-hour clock was losing', asMember.userSettings.map((row) => row.time_format), ['24']);
  check(
    'and the department name is in the settings rows',
    asMember.systemSettings.find((row) => row.key === 'department_name').value,
    'Bolivia Volunteer Fire Department'
  );
  check('the schedule arrives whole, because a member is meant to see the crew', asMember.schedule.length, 2);
  checkIs('with the open shift flagged, which is how the calendar finds it', asMember.schedule.some((row) => row.is_open === true));

  // --- the administrator payload: the member payload plus the sections an officer's tabs read ---
  await signOut(auth);
  console.log('\n--- an administrator reads the full payload ---');
  await signIn('jane');
  const asAdmin = await fetchAdminPayload(accountFor('u1'));
  checkIs(
    'the member half is still all there',
    asAdmin.schedule.length === 2 && asAdmin.roster.length === 2,
    JSON.stringify({ schedule: asAdmin.schedule.length, roster: asAdmin.roster.length })
  );
  // The directory joins the private half back on, which is exactly what the Users tab shows.
  check('the user directory carries names, usernames and status', asAdmin.users.map((user) => [user.name, user.username, user.status]), [
    ['Jane Smith', 'jane', 'active'],
    ['Bo Jones', 'bo', 'active'],
  ]);
  checkIs('and no password, because there is none to leak', !JSON.stringify(asAdmin.users).toLowerCase().includes('password'));
  // The private halves come back merged for an officer's pickers and notes.
  check('the full assignment rows, note and all', asAdmin.assignments[0].admin_note, 'checked monthly');
  check('and the full template rows', asAdmin.scheduleTemplates[0].admin_note, 'temporary cover');
  check('with the apparatus list', asAdmin.apparatus.map((row) => row.description), ['Engine 1']);
  check('and the whole offers table', asAdmin.scheduleOffers.map((row) => row.id), ['of1']);
  check('and every certification record, not only their own', asAdmin.certificationRecords.map((row) => row.id), ['cr1']);

  // --- and a member's payload does not carry any of them ---
  await signOut(auth);
  await signIn('bo');
  const asMemberAgain = await fetchMemberPayload(accountFor('u2'));
  ['users', 'apparatus', 'scheduleOffers', 'certificationRecords'].forEach((section) => {
    checkIs(`a member payload has no ${section} section`, !(section in asMemberAgain), 'an officer-only section travelled');
  });
  // The badge index is public-safe by design, so both viewers get the same one.
  check('the badge index names who has a badge', asMemberAgain.certificationBadges.u2.map((badge) => badge.name), ['EMT']);
  checkIs(
    'and an officer sees exactly the same index',
    JSON.stringify(asAdmin.certificationBadges) === JSON.stringify(asMemberAgain.certificationBadges)
  );

  // The harness's own guard: a section that stopped running would otherwise look like a pass.
  console.log('\n--- the harness itself ---');
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
