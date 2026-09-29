/**
 * Verifies the migration's WRITE step against the emulators.
 *
 * What this exists for: this is the only step that touches production data, and it writes with the Admin SDK, which
 * bypasses firestore.rules - so nothing downstream will catch a mistake here. Two properties in particular are load
 * bearing and neither is visible by reading the code:
 *
 *   1. **A second run must not duplicate anything.** If it did, "re-run it to see what drifted" would be advice to
 *      corrupt the database, and the drift check would not exist.
 *   2. **An empty document must be skipped.** Firestore deletes a document when you write {} to it, so the report
 *      would claim to have written something that is not there.
 *
 * It runs against the real Firestore and Auth emulators rather than a stubbed client, because the parts that would
 * break are the parts the emulator actually implements.
 *
 * Run with: npm run verify:migration-write
 */
import { generateKeyPairSync } from 'node:crypto';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import {
  chunk,
  createAccounts,
  documentIdFor,
  isWritable,
  temporaryPassword,
  writeCollections,
  writeList,
} from './migrate-write.mjs';
import { TAB_MAP } from './migration-map.mjs';

let failures = 0;
const checkIs = (label, condition, detail = '') => {
  const ok = condition === true;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `: ${detail || 'expected true'}`}`);
};
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`
  );
};

// --- the pure parts ----------------------------------------------------------------------------------------------

check(
  'a row lands on the id the sheet gives it',
  documentIdFor({ tab: 'users', spec: TAB_MAP.users, row: { id: 'u1' }, rowNumber: 2 }),
  'u1'
);
check(
  'and on a stable made-up id where the sheet has none',
  documentIdFor({ tab: 'system_log', spec: TAB_MAP.system_log, row: { id: '7' }, rowNumber: 9 }),
  'system_log-row-9'
);
checkIs('an empty document is not writable', !isWritable({}));
checkIs('and a document with one field is', isWritable({ a: '1' }));
check(
  'batches stay inside the 500-write limit',
  chunk(Array.from({ length: 1001 }, (_, index) => index)).map((batch) => batch.length),
  [400, 400, 201]
);
const password = temporaryPassword();
check('a temporary password is 16 characters', password.length, 16);
checkIs('with nothing ambiguous in it', /^[abcdefghjkmnpqrstuvwxyz23456789]+$/.test(password));

const { byCollection } = writeList({
  tabs: [
    {
      title: 'users',
      values: [['id', 'user_name', 'name', 'password', 'status'], ['u1', 'jdoe', 'J Doe', 'hash', 'active']],
    },
    { title: 'system_settings', values: [['key', 'value'], ['station_name', 'Bolivia VFD']] },
  ],
  ranks: [],
});
check('the write list is built by collection', Object.keys(byCollection).sort(), [
  'settings/private', 'settings/public', 'users', 'users_private',
]);
check('with the password nowhere in it', byCollection.users[0].document, { id: 'u1', name: 'J Doe' });

// --- against the emulators --------------------------------------------------------------------------------------

// Set here rather than relying on emulators:exec: the admin SDK reads these when the database is created, and the
// Firestore host is what stops it talking to Google. The credential still has to LOOK real - admin v13 rejects a
// hand-rolled `getAccessToken` object - so this signs nothing with a keypair generated in-process and never used.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const throwaway = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
initializeApp({
  projectId: process.env.GCLOUD_PROJECT || 'demo-station-portal',
  credential: cert({
    projectId: 'demo-station-portal',
    clientEmail: 'emulator@demo-station-portal.iam.gserviceaccount.com',
    privateKey: throwaway.privateKey,
  }),
});
const db = getFirestore();
const auth = getAuth();

const fixture = {
  users: [
    { collection: 'users', id: 'u1', document: { id: 'u1', name: 'J Doe', role_id: 'officer', rank_id: 'r2' } },
    { collection: 'users', id: 'u2', document: { id: 'u2', name: 'A Member', role_id: 'member', rank_id: 'r1' } },
  ],
  'settings/private': [{ collection: 'settings/private', id: 'private', document: {} }],
  system_log: [{ collection: 'system_log', id: 'system_log-row-2', document: { id: '7', action: 'LOGIN' } }],
};

const first = await writeCollections({ db, byCollection: fixture, apply: true });
check(
  'two users and one log row are written, and the empty one is not',
  first.map(({ collection, written }) => `${collection}:${written}`),
  ['settings/private:0', 'system_log:1', 'users:2']
);
checkIs(
  'and the empty document is counted as unwritable',
  first.find((result) => result.collection === 'settings/private').empty === 1
);

check('the emulator has the users', (await db.collection('users').get()).size, 2);
check('with the fields the mapping produced', (await db.doc('users/u1').get()).data(), {
  id: 'u1', name: 'J Doe', role_id: 'officer', rank_id: 'r2',
});
checkIs('the empty document does not exist', !(await db.doc('settings/private').get()).exists);
checkIs('and the made-up id landed where it was told to', (await db.doc('system_log/system_log-row-2').get()).exists);

// The property the whole drift-check story rests on: run it again, twice.
await writeCollections({ db, byCollection: fixture, apply: true });
await writeCollections({ db, byCollection: fixture, apply: true });
check('re-running writes the same documents, not more of them', (await db.collection('users').get()).size, 2);

// --- the Auth accounts ------------------------------------------------------------------------------------------

const userRows = [
  { id: 'sheet-u1', user_name: 'jdoe', name: 'J Doe' },
  { id: 'sheet-u2', user_name: 'amember', name: 'A Member' },
];
const created = await createAccounts({ auth, users: userRows, apply: true, makePassword: () => 'temporary1234567' });
check('two accounts are created', created.created.map((entry) => entry.username), ['jdoe', 'amember']);
check('on the station domain, not a real address', created.created[0].email, 'jdoe@boliviavfd.invalid');
// The uid is the sheet's id, because every document about a member is keyed by it and the rules compare that key to
// request.auth.uid. Leaving Firebase to mint one would file all 33 members' rows under ids they cannot authenticate
// as - and the app would show each of them an empty station.
check('and the uid is the sheet id, not one Firebase chose', (await auth.getUserByEmail('jdoe@boliviavfd.invalid')).uid, 'sheet-u1');
const again = await createAccounts({ auth, users: userRows, apply: true, makePassword: () => 'temporary1234567' });
check('and the second run creates none', [again.created.length, again.existing.length, again.mismatched.length], [0, 2, 0]);

// An account somebody made by hand in the console: right address, wrong uid. Reported, not tolerated.
await auth.createUser({ uid: 'firebase-chose-this', email: 'handmade@boliviavfd.invalid' });
const hand = await createAccounts({
  auth,
  users: [{ id: 'sheet-u9', user_name: 'handmade', name: 'H Made' }],
  apply: false,
});
check('an existing account with a different uid is reported', hand.mismatched.length, 1);
checkIs('naming both ids', hand.mismatched[0].includes('firebase-chose-this') && hand.mismatched[0].includes('sheet-u9'));

const account = await auth.getUserByEmail('jdoe@boliviavfd.invalid');
check('the account exists with its display name', account.displayName, 'J Doe');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
