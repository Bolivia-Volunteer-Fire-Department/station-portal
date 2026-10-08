/**
 * Verifies storage.rules against the emulator, by uploading and downloading real bytes as each of the demo
 * station's members - then asserting what each of them may NOT do.
 *
 *   npm run verify:storage-rules
 *
 * WHY THIS FILE EXISTS, in the shape it does. A certification scan is a photocopy of somebody's ticket, so "the
 * member it belongs to, and an officer who records certifications" is the whole security story of the bucket. The
 * rule that says so is a COPY of the permission check in firestore.rules - security rules cannot import each
 * other - and two copies of one rule are exactly the arrangement that drifts. So the pair that matters most is
 * asserted here by name: u4 holds `can_manage_certifications` and is NOT an administrator, and may upload; u2 is
 * the member the record belongs to, and may not. An administrator is a third case rather than the only one,
 * because `is_admin` passes every permission and would answer "allowed" for the wrong reason.
 *
 * PLAIN FETCH, NOT THE WEB SDK, and that is not a shortcut: the Storage SDK's upload path is built on
 * XMLHttpRequest, which does not exist in Node. Signing in still goes through the Auth SDK, as it does in every
 * other harness here, so the tokens the rules read are real ones. The routes are the Storage emulator's own
 * Firebase API (/v0/b/{bucket}/o), which is what the SDK calls underneath.
 *
 * The fixture is scripts/seed-emulator.mjs, so what the rules are tested against and what a developer sees in the
 * emulator UI cannot drift apart.
 */
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, PROJECT, seed } from './seed-emulator.mjs';

const STORAGE = 'http://127.0.0.1:9199';
const BUCKET = `${PROJECT}.appspot.com`;
// The record the seed gives to u2, so these paths are that member's evidence.
const RECORD = 'certifications/u2/cr1';
const MAX_BYTES = 5 * 1024 * 1024;

let failures = 0;

const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` -> ${actual} (expected ${expected})`}`);
};

// A refusal, reported by the STATUS the emulator answers with. A rule denial is 403; anything else - a 404, a 500 -
// is printed as itself, because "it threw" is not the same as "the rules said no".
const refused = (label, status) => check(label, status, 403);

const app = initializeApp({ apiKey: 'demo-api-key', projectId: PROJECT, appId: 'demo-app-id' });
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });

// One token per member, fetched once: signing in again for every case would be slower and no more convincing.
const tokens = new Map();
const tokenFor = async (uid) => {
  if (!tokens.has(uid)) {
    const account = DEMO_ACCOUNTS.find((entry) => entry.uid === uid);
    await signInWithEmailAndPassword(auth, account.email, DEMO_PASSWORD);
    tokens.set(uid, await auth.currentUser.getIdToken());
    await signOut(auth);
  }
  return tokens.get(uid);
};

const authHeader = async (uid) => (uid ? { Authorization: `Bearer ${await tokenFor(uid)}` } : {});
const objectUrl = (path, query = '') => `${STORAGE}/v0/b/${BUCKET}/o/${encodeURIComponent(path)}${query}`;

const upload = async (uid, path, { contentType, bytes }) => {
  const response = await fetch(`${STORAGE}/v0/b/${BUCKET}/o?name=${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: { ...(await authHeader(uid)), 'Content-Type': contentType },
    body: bytes,
  });
  await response.text();
  return response.status;
};

const download = async (uid, path) => {
  const response = await fetch(objectUrl(path, '?alt=media'), { headers: await authHeader(uid) });
  const body = await response.text();
  return { status: response.status, body };
};

const remove = async (uid, path) => {
  const response = await fetch(objectUrl(path), { method: 'DELETE', headers: await authHeader(uid) });
  await response.text();
  return response.status;
};

const bytes = (text) => Buffer.from(text);
const pdf = bytes('%PDF-1.4 one scanned certification card');

console.log('--- seeding the demo station ---');
await seed();
console.log('seeded\n');

console.log('--- an officer attaches a scan ---');
check(
  'the certification officer (no administrator rights) uploads a PDF',
  await upload('u4', `${RECORD}/evidence-1`, { contentType: 'application/pdf', bytes: pdf }),
  200
);
check(
  'and a JPEG',
  await upload('u4', `${RECORD}/evidence-2`, { contentType: 'image/jpeg', bytes: bytes('jpeg bytes') }),
  200
);
check(
  'and a PNG',
  await upload('u4', `${RECORD}/evidence-3`, { contentType: 'image/png', bytes: bytes('png bytes') }),
  200
);
check(
  'an administrator can too',
  await upload('u1', `${RECORD}/evidence-4`, { contentType: 'application/pdf', bytes: pdf }),
  200
);
// Not a bug, and worth knowing: this rule grants a permission and a size, and does NOT know whether a record with
// that id exists. The record the file belongs to is checked where the metadata row is written (functions/index.js),
// which is the only place that can read both documents at once.
check(
  'and either may attach one for a different member',
  await upload('u4', 'certifications/u1/cr9/evidence-1', { contentType: 'application/pdf', bytes: pdf }),
  200
);

console.log('\n--- a member may view a scan, never attach one ---');
refused(
  'the member the record belongs to may not upload',
  await upload('u2', `${RECORD}/evidence-5`, { contentType: 'application/pdf', bytes: pdf })
);
refused(
  'nor may a member with no certification permission',
  await upload('u3', `${RECORD}/evidence-6`, { contentType: 'application/pdf', bytes: pdf })
);
refused(
  'nor may a signed-out browser',
  await upload(null, `${RECORD}/evidence-7`, { contentType: 'application/pdf', bytes: pdf })
);

console.log('\n--- the caps: 5 MB, and three types ---');
refused(
  'a file one byte over the cap',
  await upload('u4', `${RECORD}/too-big`, { contentType: 'application/pdf', bytes: Buffer.alloc(MAX_BYTES + 1) })
);
check(
  'and one exactly at the cap',
  await upload('u4', `${RECORD}/at-the-cap`, { contentType: 'application/pdf', bytes: Buffer.alloc(MAX_BYTES) }),
  200
);
refused(
  'an .svg, which is a picture that can carry script',
  await upload('u4', `${RECORD}/vector`, { contentType: 'image/svg+xml', bytes: bytes('<svg/>') })
);
refused(
  'a HEIC photo, which no browser can open',
  await upload('u4', `${RECORD}/photo.heic`, { contentType: 'image/heic', bytes: bytes('heic bytes') })
);
refused(
  'a web page',
  await upload('u4', `${RECORD}/page`, { contentType: 'text/html', bytes: bytes('<html></html>') })
);
refused(
  'and anything outside the one prefix this bucket serves',
  await upload('u4', 'documents/u2/cr1/evidence', { contentType: 'application/pdf', bytes: pdf })
);

console.log('\n--- who may open one ---');
const own = await download('u2', `${RECORD}/evidence-1`);
check('the member it belongs to opens their own scan', own.status, 200);
check('and gets the bytes back', own.body, pdf.toString());
check('an officer opens it', (await download('u4', `${RECORD}/evidence-1`)).status, 200);
check('and an administrator', (await download('u1', `${RECORD}/evidence-1`)).status, 200);
refused('another member may not', (await download('u3', `${RECORD}/evidence-1`)).status);
refused('nor may a signed-out browser', (await download(null, `${RECORD}/evidence-1`)).status);

console.log('\n--- removing a scan is an officer\u2019s act, not the member\u2019s ---');
refused('the member may not delete their own', await remove('u2', `${RECORD}/evidence-2`));
refused('nor may a signed-out browser', await remove(null, `${RECORD}/evidence-2`));
check('an officer may', await remove('u4', `${RECORD}/evidence-2`), 204);
check('and the bytes are gone with it', (await download('u4', `${RECORD}/evidence-2`)).status, 404);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
