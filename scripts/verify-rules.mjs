/**
 * Verifies firestore.rules against the emulator, by signing in as the demo station's members and running the
 * queries and writes the app will run - then asserting what each of them may NOT do.
 *
 *   npm run verify:rules
 *
 * The reason this exists in this shape: a rules test that only calls `getDoc` proves the rule fires, but not that
 * the client's query is one the rule will accept. The classic Firestore failure is a correct rule paired with a
 * query the rule refuses (or the reverse), so the checks below sign in for real, run the real queries, and treat
 * "the query was rejected" as a failure of the pair rather than of the data.
 *
 * It seeds through scripts/seed-emulator.mjs, so the fixture the tests use and the fixture a developer sees in the
 * emulator UI cannot drift apart.
 */
import { initializeApp } from 'firebase/app';
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  setDoc,
  setLogLevel,
  where,
} from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, PROJECT, seed } from './seed-emulator.mjs';

// The SDK logs every refused write to the console, which would bury the checks below in noise. The refusals are
// the point of this file, and each one is reported by name instead.
setLogLevel('silent');

let failures = 0;
let cases = 0;

const checkIs = (label, condition, detail) => {
  cases++;
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` -> ${detail}`}`);
};

// One read, expected to be allowed or refused. Refused means the error code Firestore uses for a rule denial; any
// other error is reported as itself, because "it threw" is not the same as "the rules said no".
const read = (label, allowed, ...args) => {
  const target = args[0];
  return getDoc(target).then(
    () => checkIs(label, allowed, allowed ? '' : 'the read was allowed'),
    (error) => checkIs(label, !allowed && error.code === 'permission-denied', `threw ${error.code}`)
  );
};

const write = (label, allowed, ...args) => {
  const [target, data] = args;
  return setDoc(target, data).then(
    () => checkIs(label, allowed, allowed ? '' : 'the write was allowed'),
    (error) => checkIs(label, !allowed && error.code === 'permission-denied', `threw ${error.code}`)
  );
};

// An `owner` app is not needed anywhere below: the seed does the privileged writes over REST, so every check here
// goes through the same door the browser uses.
const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-api-key', appId: 'demo-app-id' });
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });

const signInAs = async (uid) => {
  const account = DEMO_ACCOUNTS.find((entry) => entry.uid === uid);
  await signInWithEmailAndPassword(auth, account.email, DEMO_PASSWORD);
};

const main = async () => {
  console.log('--- the demo station ---');
  await seed();
  checkIs('it seeded', true);

  // --- the login screen: the public settings, with no session at all ---
  console.log('\n--- before signing in ---');
  await read('the login screen reads the public settings', true, doc(db, 'settings', 'public'));
  await read('and cannot read the private ones', false, doc(db, 'settings', 'private'));
  await read('nor the roster', false, doc(db, 'users', 'u1'));

  // --- a plain member: bo, the firefighter ---
  console.log('\n--- a member ---');
  await signInAs('u2');
  await read('reads the roster', true, doc(db, 'users', 'u1'));
  await read('and the permission table, to shape its own navigation', true, doc(db, 'roles', 'r2'));
  await read('reads its own settings', true, doc(db, 'user_settings', 'u2'));
  await read('but not another member settings', false, doc(db, 'user_settings', 'u1'));
  await read('reads its own account record', true, doc(db, 'users_private', 'u2'));
  await read('but not another member account record', false, doc(db, 'users_private', 'u1'));
  // Nobody writes this collection from a client, not even their own row: creating an account and changing a
  // username or a status goes through a callable function, so a browser cannot un-suspend itself.
  await write('writes its own account record', false, doc(db, 'users_private', 'u2'), {
    username: 'bo',
    status: 'active',
    created_at: '2026-01-01 08:00:00',
  });
  await read('reads the private half of an assignment', false, doc(db, 'assignment_private', 'a1'));
  await read('reads the audit trail', false, doc(db, 'system_log', 'l1'));
  await write('writes an audit row', false, doc(db, 'system_log', 'l2'), { user_id: 'u2', action: 'FORGED' });
  await write('edits the roster', false, doc(db, 'users', 'u2'), { name: 'Bo Jones', rank_id: 'k2', role_id: 'r2' });
  await write('edits its own role', false, doc(db, 'roles', 'r2'), { description: 'Firefighter', is_admin: true });
  await read('reads a collection whose rules are not written yet', false, doc(db, 'certifications', 'x1'));

  // The calendar asks two questions rather than one clever one, and both have to be accepted as written - which is
  // the whole reason for that decision.
  const mine = await getDocs(query(collection(db, 'schedule'), where('user_id', '==', 'u2')));
  checkIs('the calendar asks for its own shifts, and the query is accepted', true, `got ${mine.size} rows`);
  const open = await getDocs(query(collection(db, 'schedule'), where('is_open', '==', true)));
  checkIs('and asks for the open ones as a separate question', open.size === 1, `got ${open.size}`);

  await read('reads its own availability', true, doc(db, 'availability', 'av2'));
  await read('but not another member availability', false, doc(db, 'availability', 'av1'));
  await read('reads its own clock entry', true, doc(db, 'timeclock', 'c2'));
  await read('but not another member clock entry', false, doc(db, 'timeclock', 'c1'));
  await write('opens its own clock entry', true, doc(db, 'timeclock', 'c3'), {
    user_id: 'u2',
    time_in: '2026-03-03 08:00',
    time_out: '',
    is_manual: false,
  });
  await write('and cannot open one against another member', false, doc(db, 'timeclock', 'c4'), {
    user_id: 'u1',
    time_in: '2026-03-03 08:00',
    time_out: '',
    is_manual: false,
  });
  await read('reads who is on duty', true, doc(db, 'on_duty', 'u1'));
  await write('marks itself on duty', true, doc(db, 'on_duty', 'u2'), { user_id: 'u2', time_in: '2026-03-03 08:00' });
  await write('and cannot mark somebody else on duty', false, doc(db, 'on_duty', 'u1'), {
    user_id: 'u1',
    time_in: '2026-03-03 08:00',
  });

  // --- an officer: jane, whose role is the administrator (is_admin implies every permission) ---
  await signOut(auth);
  console.log('\n--- an officer ---');
  await signInAs('u1');
  await read('reads another member account record', true, doc(db, 'users_private', 'u2'));
  await read('and the private settings', true, doc(db, 'settings', 'private'));
  await read('and the audit trail', true, doc(db, 'system_log', 'l1'));
  await write('edits a member name, rank and role', true, doc(db, 'users', 'u2'), {
    name: 'Bo Jones',
    rank_id: 'k1',
    role_id: 'r2',
  });
  // The document shape IS the projection here: a field an officer may not set does not exist, so smuggling one in
  // has to fail rather than be ignored.
  await write('but cannot smuggle a password field in with them', false, doc(db, 'users', 'u2'), {
    name: 'Bo Jones',
    rank_id: 'k1',
    role_id: 'r2',
    password: 'HASHED-FORGERY',
  });
  await write('writes the schedule', true, doc(db, 'schedule', 's2'), {
    schedule_template_id: 't1',
    assignment_id: 'a1',
    user_id: 'u2',
    date_from: '2026-03-09',
    date_to: '2026-03-09',
    start_time: '08:00',
    end_time: '18:00',
    is_open: false,
  });
  await write('and still cannot write an audit row', false, doc(db, 'system_log', 'l3'), {
    user_id: 'u1',
    action: 'FORGED',
    created_at: '2026-03-03 08:00:00',
  });

  // The harness's own guard: a section that stopped running would otherwise look like a pass.
  console.log('\n--- the harness itself ---');
  checkIs('every case ran', cases >= 27, `only ${cases} cases: a section has stopped running`);
};

main()
  .then(async () => {
    console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} (${cases} cases)`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error) => {
    // The one failure worth spelling out: the emulator is not running, which is a setup problem rather than a
    // rules problem, and saying so is more useful than a stack trace.
    if (String(error.code || '').includes('unavailable') || /ECONNREFUSED/.test(String(error.message))) {
      console.error('\nThe Firestore emulator is not reachable. Start it with `npm run verify:rules`, which wraps\n' +
        'this script in `firebase emulators:exec` and tears it down afterwards.');
    } else {
      console.error(error);
    }
    process.exit(1);
  });
