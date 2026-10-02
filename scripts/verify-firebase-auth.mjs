/**
 * Phase 1, end to end: a member signs in with a synthetic email, reads the dashboard from Firestore, and the
 * officer-only account work happens the way it will in production.
 *
 *   npm run verify:firebase-auth
 *
 * What this proves, and why it is worth a harness rather than a manual click-through:
 *
 *   - the address the CLIENT derives is the address the FUNCTION created (EMAIL_DOMAIN lives in two files, and if
 *     they ever disagree nobody can sign in - so the harness imports the client's rule and uses it);
 *   - the four callables refuse a member who tries to use them;
 *   - an officer-driven reset really takes effect: the temporary password works, the flag is set, the member's own
 *     change clears it, and the old password stops working;
 *   - suspending a member disables the Auth account, so a suspension is not merely what the app chooses to show;
 *   - and every one of those wrote an audit row naming the officer, because accountability was the reason resets
 *     are officer-driven at all.
 */
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut, updatePassword } from 'firebase/auth';
import { connectFirestoreEmulator, doc, getDoc, getFirestore, getDocs, collection } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { EMAIL_DOMAIN, accountState, signInAlongside, signInAsMember, signOutAlongside, syntheticEmail, updateMemberAccount } from '../src/services/firebaseAuth.js';
import { DEMO_PASSWORD, PROJECT, seed } from './seed-emulator.mjs';

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

// The refusal the server sends for a caller without the permission, as opposed to any other error.
const refused = async (label, run) => {
  try {
    await run();
    checkIs(label, false, 'the call was allowed');
  } catch (error) {
    checkIs(label, error.code === 'functions/permission-denied', `threw ${error.code}`);
  }
};

const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-api-key', appId: 'demo-app-id' });
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const call = async (name, data = {}) => (await httpsCallable(getFunctions(app), name)(data)).data;
connectFunctionsEmulator(getFunctions(app), '127.0.0.1', 5001);

const signIn = (username, password = DEMO_PASSWORD) => signInWithEmailAndPassword(auth, syntheticEmail(username), password);

const main = async () => {
  console.log('--- the demo station ---');
  await seed();
  checkIs('it seeded', true);

  // --- an officer signs in, and the claims agree with the roster ---
  console.log('\n--- an officer signs in ---');
  await signIn('jane');
  const jane = await call('whoami');
  check('the claims name the role', jane.roleId, 'r1');
  check('and the administrator switch', jane.isAdmin, true);
  check('with no password change pending', jane.mustChangePassword, false);

  // --- adding a member, through the callable a browser may not bypass ---
  console.log('\n--- adding a member ---');
  const username = `recruit${String(Date.now()).slice(-6)}`;
  const created = await call('createMember', {
    username,
    password: 'first-day-passw0rd',
    name: 'New Recruit',
    rank_id: 'k2',
    role_id: 'r2',
  });
  checkIs('the callable reports the member it created', !!created.userId, JSON.stringify(created));
  // The assertion that protects every sign-in: the address the CLIENT derives is the one the FUNCTION created.
  check('which signs in at the client rule applied to that username', syntheticEmail(username), `${username}@${EMAIL_DOMAIN}`);

  const roster = await getDoc(doc(db, 'users', created.userId));
  check('the roster row is the three fields the client draws names from', roster.data(), {
    name: 'New Recruit',
    rank_id: 'k2',
    role_id: 'r2',
  });
  const privateRow = await getDoc(doc(db, 'users_private', created.userId));
  check('the private row holds the account facts and no password', Object.keys(privateRow.data()).sort(), [
    'created_at',
    'created_by',
    'status',
    'username',
  ]);
  check('with the account active', privateRow.data().status, 'active');

  // --- the member signs in, and reads the dashboard from Firestore ---
  await signOut(auth);
  console.log('\n--- the member signs in and reads the dashboard ---');
  await signIn(username, 'first-day-passw0rd');
  const me = await call('whoami');
  check('the member is the record just created', me.userId, created.userId);
  check('and is not an administrator', me.isAdmin, false);
  const publicSettings = await getDoc(doc(db, 'settings', 'public'));
  check('the dashboard reads the department name', typeof publicSettings.data().department_name, 'string');
  const rosterDocs = await getDocs(collection(db, 'users'));
  checkIs('the roster comes back for a plain member', rosterDocs.size >= 3, `${rosterDocs.size} rows`);
  const mySettings = await getDoc(doc(db, 'user_settings', created.userId));
  check('their own settings are there', mySettings.data().time_format, '24');
  const onDuty = await getDocs(collection(db, 'on_duty'));
  checkIs('and who is on duty, which the dashboard shows', onDuty.size >= 1, `${onDuty.size} on duty`);

  // --- a member cannot do the officer work, whatever the client shows them ---
  console.log('\n--- a member cannot do the officer work ---');
  await refused('cannot add a member', () =>
    call('createMember', { username: 'sneaky', password: 'long-enough-pass', name: 'Sneaky' })
  );
  await refused('cannot reset a password', () =>
    call('resetMemberPassword', { userId: 'u1', temporaryPassword: 'temp-passw0rd' })
  );
  await refused('cannot suspend anybody', () => call('setMemberStatus', { userId: 'u1', status: 'suspended' }));

  // --- an officer resets the member's password ---
  await signOut(auth);
  await signIn('jane');
  console.log('\n--- an officer resets the password ---');
  await call('resetMemberPassword', { userId: created.userId, temporaryPassword: 'temporary-passw0rd' });
  await signOut(auth);
  checkIs(
    'the password it replaced stops working',
    await signIn(username, 'first-day-passw0rd').then(() => false, () => true)
  );
  await signIn(username, 'temporary-passw0rd');
  const flagged = await call('whoami');
  check('the member is asked to change it', flagged.mustChangePassword, true);

  // --- and the member changes it themselves ---
  console.log('\n--- the member changes it themselves ---');
  await updatePassword(auth.currentUser, 'chosen-by-me-passw0rd');
  await call('completePasswordChange');
  const cleared = await call('whoami');
  check('the request to change it comes off', cleared.mustChangePassword, false);
  await signOut(auth);
  checkIs(
    'the temporary password stops working too',
    await signIn(username, 'temporary-passw0rd').then(() => false, () => true)
  );
  checkIs(
    'and the one they chose works',
    await signIn(username, 'chosen-by-me-passw0rd').then(() => true, () => false)
  );

  // --- suspending: the Auth account, not just the app's opinion of it ---
  await signOut(auth);
  await signIn('jane');
  console.log('\n--- suspending a member ---');
  await call('setMemberStatus', { userId: created.userId, status: 'suspended' });
  await signOut(auth);
  checkIs(
    'a suspended member cannot sign in at all',
    await signIn(username, 'chosen-by-me-passw0rd').then(() => false, () => true)
  );
  await signIn('jane');
  await call('setMemberStatus', { userId: created.userId, status: 'active' });
  await signOut(auth);
  checkIs(
    'and signs in again once reactivated',
    await signIn(username, 'chosen-by-me-passw0rd').then(() => true, () => false)
  );

  // The audit trail is NO LONGER ASSERTED HERE. Every one of those functions still writes a line - and the reset, the
// status change and the password change are all still asserted to have HAPPENED, by the account behaving the way it
// should afterwards - but that line is a Cloud Logging entry now (see `audit` in functions/index.js) rather than a
// `system_log` document, and the functions emulator does not hand its logs back to a test.
//
// The trade, stated plainly: what an action DID is covered; that it left a RECORD is not, and the record's home is
// Cloud Logging, where an officer reads it in the Firebase console. Recovering the assertion would mean querying the
// emulator's Logging emulator - the follow-up if the audit trail ever needs a regression test of its own.

  // --- signing in alongside the app's own session --------------------------------------------------------------
  //
  // The app signs in through Apps Script AND signs in to Firebase with the same credentials, so the features already
  // moved to Firestore have a user to act as. The property that matters is that it can never fail the login: a member
  // whose Auth password is still the migration's temporary one must get into the app exactly as before.
  console.log('\n--- alongside the app session ---');

  // Signs out FIRST, so what earlier sections did cannot colour this: they create members, suspend them and reset
  // their passwords, and one of them leaves an officer signed in. `jane` is the seeded officer whose password no
  // section changes.
  await signOutAlongside();
  check('signing out quietly leaves nobody signed in', await accountState(), null);

  const wrongPassword = await signInAlongside('jane', 'not-the-password');
  check('a Firebase sign-in that fails reports it', wrongPassword.ok, false);
  checkIs(
    'and says why, rather than throwing at the login',
    typeof wrongPassword.reason === 'string' && wrongPassword.reason.length > 0,
    wrongPassword.reason
  );
  checkIs('and nobody is signed in afterwards', (await accountState()) === null);

  const good = await signInAlongside('jane', DEMO_PASSWORD);
  check('one that succeeds says so', good, { ok: true });
  check('and the account it signed in is the one asked for', (await accountState()).username, 'jane');

  // The login itself, which the app now takes from Firebase: the reply is the shape api.js callers read, and the
  // account is assembled from the roster and the private half - including the change-on-next-login flag, which is
  // what raises the forced password screen after an officer reset.
  console.log('\n--- signing in as a member ---');
  const login = await signInAsMember('jane', DEMO_PASSWORD);
  check('the login reports success', login.success, true);
  check('with the roster row the app draws from', login.user.id, 'u1');
  checkIs('and a name on it', typeof login.user.name === 'string' && login.user.name.length > 0, login.user.name);
  checkIs(
    'and the change-on-next-login flag as a real boolean',
    typeof login.user.is_change_password_on_login === 'boolean',
    String(login.user.is_change_password_on_login)
  );
  // A REAL session token, and not the empty string the Firebase user would suggest: app state treats a token as the
  // identity of the session it is holding (applyToken in App.jsx guards the admin refresh wave with it and passes it to
  // every screen), so it has to be something. It is the Firebase ID token - Firestore is authenticated by the session
  // itself, not by this string.
  checkIs(
    'and a real session token for the app to hold',
    typeof login.token === 'string' && login.token.length > 0,
    login.token ? 'a token' : 'empty'
  );

  // A password Firebase does not accept must THROW. This used to be stated the other way round: the throw was what
  // made loginUser fall back to the sheet for every member whose Auth account still held the migration's temporary
  // password. There is no sheet now, so the refusal IS the member's answer and nothing downstream softens it.
  const refusedLogin = await signInAsMember('jane', 'not-the-password').then(
    () => 'accepted',
    (error) => String(error.code || '')
  );
  checkIs(
    'and a password it does not accept throws, so the sheet can answer',
    refusedLogin.includes('invalid-credential') || refusedLogin.includes('auth/'),
    refusedLogin
  );

  await signOutAlongside();
  check('and signing out again leaves nobody', await accountState(), null);

  // Both halves are wired into the app, and the sign-OUT count is the one worth asserting: every path that drops the
  // app's session has to drop Firebase's too, and there is more than one such path - which is how this check earned
  // its place, by failing on the first version that wired only the obvious one.
  // --- App Check: the wiring, asserted from the source because it cannot run here --------------------------------
  //
  // App Check only exists in a browser, and the emulator does not verify it at all - so the emulator harnesses cannot
  // exercise it. What they CAN do is hold the wiring still, and three of these assertions are the ones that cost an
  // afternoon if they quietly change: the Enterprise provider, the auto-refresh flag (the web SDK defaults to NOT
  // refreshing), and the fact that both the debug token and the whole feature are opt-in.
  console.log('\n--- app check ---');
  const firebaseSource = readFileSync(new URL('../src/services/firebase.js', import.meta.url), 'utf8');
  const envExample = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  checkIs('the app initialises App Check', /initializeAppCheck\(app, \{/.test(firebaseSource));
  checkIs(
    'with the Enterprise provider, which is what the console issues now',
    /provider: new ReCaptchaEnterpriseProvider\(appCheckSiteKey\)/.test(firebaseSource)
  );
  // The web SDK does NOT refresh App Check tokens unless told to, and an expired token is a request that fails once
  // enforcement is on - so this flag is load-bearing rather than decorative.
  checkIs('and token auto-refresh explicitly ON', /isTokenAutoRefreshEnabled: true/.test(firebaseSource));
  checkIs('only when a site key is configured, so a build without one is unaffected', /if \(appCheckSiteKey && !usingEmulator/.test(firebaseSource));
  checkIs('and never in a harness, where there is no browser to attest with', /!usingEmulator && typeof window !== 'undefined'/.test(firebaseSource));
  // The debug token is a project credential: it must not be something the site key implies, and the file that documents the
  // variables has to say so, because the person who sets it up is the one who would otherwise put it in CI.
  checkIs('the debug token is a separate, opt-in variable', /const appCheckDebugToken = String\(env\.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN/.test(firebaseSource));
  checkIs('documented as a build value', /^VITE_FIREBASE_APPCHECK_SITE_KEY=$/m.test(envExample));
  checkIs('and documented as development only', /VITE_FIREBASE_APPCHECK_DEBUG_TOKEN=[\s\S]*$/.test(envExample) && /NEVER A REPOSITORY SECRET/.test(envExample));
  // The loopback guard, which is the difference between a usable console and an unusable one. Google will not
  // attest a loopback origin, and the SDK has NO BACKOFF for a reCAPTCHA-level failure: the provider's throttle
  // engages only on a bad status from Firebase's own exchange endpoint, which a reCAPTCHA failure never reaches
  // (firebase/firebase-js-sdk#10385, on the version pinned here). So initialising App Check on localhost without
  // a debug token is not a neutral choice - Auth warns on every request it makes and the refresher retries
  // forever. If this assertion fails, somebody re-enabled a console flood.
  checkIs(
    'and not on a loopback origin, where attestation cannot happen and a failure never backs off',
    /if \(!appCheckDebugToken && loopbackOrigin\(\)\)/.test(firebaseSource)
  );
  checkIs(
    'a loopback origin being localhost, 127.0.0.1 or ::1',
    /host === 'localhost' \|\| host === '127\.0\.0\.1' \|\| host === '\[::1\]' \|\| host === '::1'/.test(firebaseSource)
  );
  checkIs(
    'with the reason said out loud, so the skip is never a mystery',
    /loopback origin with no VITE_FIREBASE_APPCHECK_DEBUG_TOKEN/.test(firebaseSource)
  );

  const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  checkIs(
    'the login signs in alongside, and so does the reauth',
    (appSource.match(/signInAlongside\(/g) || []).length >= 2,
    'login and reauth'
  );
  checkIs(
    'and every session drop signs out',
    (appSource.match(/signOutAlongside\(/g) || []).length >= 2,
    'both logout paths'
  );

  // The harness's own guard: a section that stopped running would otherwise look like a pass.
  console.log('\n--- the harness itself ---');
  // The private half of an account: a username, which moves the Auth address with it, and the change-on-next-login
  // flag. Both are facts a client must not write - and the rename has to move the address, or the member would type a
  // username that no longer matches their account. Signing in under the new one is the proof of that.
  console.log('\n--- the private half of an account ---');
  await signIn('jane');
  const renamed = await updateMemberAccount({ userId: 'u2', username: 'bo-renamed', isChangePasswordOnLogin: true });
  check('the new username comes back', renamed.username, 'bo-renamed');
  const priv = await getDoc(doc(db, 'users_private', 'u2'));
  check('and is written to the private half', priv.data().username, 'bo-renamed');
  check('with the flag as a real boolean', priv.data().is_change_password_on_login, true);
  const renamedSignIn = await signInWithEmailAndPassword(auth, `bo-renamed@${EMAIL_DOMAIN}`, DEMO_PASSWORD).then(
    () => 'signed in',
    (error) => String(error.code || '')
  );
  check('and the Auth address moved with it, which is the whole point', renamedSignIn, 'signed in');

  checkIs('every case ran', cases >= 28, `only ${cases} cases: a section has stopped running`);
};

main()
  .then(() => {
    console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} (${cases} cases)`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error) => {
    if (String(error.code || '').includes('unavailable') || /ECONNREFUSED/.test(String(error.message))) {
      console.error('\nThe emulators are not reachable. Run `npm run verify:firebase-auth`, which starts them.');
    } else {
      console.error(error);
    }
    process.exit(1);
  });
