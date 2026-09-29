// The migration's WRITE step: read the sheet, map it exactly as the plan did, and put it in Firestore.
//
// It writes as the ADMIN SDK, which bypasses firestore.rules entirely. That is not a shortcut, it is the only way
// anything can be written: users_private is `allow write: if false` precisely so no browser can invent an account,
// and the same is true of the audit log. Which means the rules are not a safety net here - the MAPPING is the only
// thing between a mistake and production data, which is why it is a separate, reviewable file and why this step
// refuses to write while the plan reports a problem without an explicit --force.
//
// Two properties matter more than speed:
//
//   - **NOTHING IS WRITTEN WITHOUT --apply.** The default run prints what it would do.
//   - **A second run is safe.** Every document is written by id with set(), so re-running rewrites rather than
//     duplicating, and the Auth accounts are looked up before being created. That is what makes this usable as a
//     drift check after a cutover rather than a one-shot script.
//
// Run with: npm run migration:write            (report only)
//           npm run migration:write -- --apply (write)
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { accessTokenFor, resolveServiceAccount, resolveSpreadsheetId } from './migrate-recon.mjs';
import { TAB_MAP } from './migration-map.mjs';
import { planForTab, rowsFrom } from './migrate-plan.mjs';
import { syntheticEmail } from '../src/services/firebaseAuth.js';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
// Firestore takes 500 writes per batch; 400 leaves room for the odd future addition without re-deciding this.
const BATCH_LIMIT = 400;

// --- the pieces worth testing on their own ----------------------------------------------------------------------

// The document id a row lands on. Stable across runs, because a migration that renames its own documents cannot be
// re-run: the sheet's id where it has one, and the sheet's row number where it does not (`mintIds` - system_log's id
// column is a row counter, so 35 rows would have overwritten each other).
export const documentIdFor = ({ tab, spec, row, rowNumber }) =>
  spec.mintIds ? `${tab}-row-${rowNumber}` : String(row[spec.key] ?? '').trim();

// Firestore cannot hold an empty document - writing {} deletes the document instead of creating it - so an empty
// one is skipped rather than reported as written. `settings/private` is the case today: every setting is public.
export const isWritable = (document) => Object.keys(document || {}).length > 0;

export const chunk = (items, size = BATCH_LIMIT) => {
  const batches = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
};

// A temporary password the officer hands over, which the member then has to change: is_change_password_on_login is
// already in users_private and the app's own flow does the rest. Unambiguous characters only, because this gets read
// aloud over a radio more often than it gets copied.
export const temporaryPassword = (random = Math.random) => {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const pick = () => alphabet[Math.floor(random() * alphabet.length)];
  return Array.from({ length: 16 }, pick).join('');
};

// What the plan says, turned into (collection, id, document) triples. Pure, so a harness can assert the ids.
export const writeList = ({ tabs, ranks }) => {
  const idsByTab = {};
  tabs.forEach(({ title, values }) => {
    idsByTab[title] = new Set(rowsFrom(values).map((row) => String(row.id || '').trim()).filter(Boolean));
  });

  const byCollection = {};
  const problems = [];
  const notes = [];

  tabs
    .filter(({ title }) => TAB_MAP[title] && !TAB_MAP[title].skip)
    .forEach(({ title, values }) => {
      const spec = TAB_MAP[title];
      const rows = rowsFrom(values);
      const { collections, problems: found, notes: decided } = planForTab({
        tab: title,
        spec,
        rows,
        ranks,
        knownIds: idsByTab,
      });
      problems.push(...found);
      notes.push(...decided);
      Object.entries(collections).forEach(([collection, documents]) => {
        (byCollection[collection] = byCollection[collection] || []).push(
          ...documents.map((document, index) => ({
            collection,
            // Row numbers are 1-based over the sheet INCLUDING its header, so row 1 of the data is sheet row 2 - the
            // number somebody would see in the sheet's own row gutter.
            id: documentIdFor({ tab: title, spec, row: rows[index], rowNumber: index + 2 }),
            document,
          }))
        );
      });
    });

  return { byCollection, problems, notes };
};

// --- writing ----------------------------------------------------------------------------------------------------

// Every document is a set() by id, so this is idempotent: running it twice writes the same documents twice rather
// than writing them again somewhere else. Collections with no writable documents are skipped - an empty collection
// does not exist in Firestore, and saying otherwise in the report would be a lie.
export const writeCollections = async ({ db, byCollection, apply = false }) => {
  const results = [];
  for (const [collection, entries] of Object.entries(byCollection).sort()) {
    const writable = entries.filter(({ document }) => isWritable(document));
    const empty = entries.length - writable.length;
    if (apply) {
      for (const batch of chunk(writable)) {
        const write = db.batch();
        batch.forEach(({ id, document }) => write.set(db.doc(`${collection}/${id}`), document));
        await write.commit();
      }
    }
    results.push({ collection, written: writable.length, empty, skipped: !writable.length });
  }
  return results;
};

// The members' Auth accounts. Created rather than updated: an account that already exists is left alone, which is
// what makes a second run a no-op - and the reason this does not touch an existing account's password.
//
// THE uid IS THE SHEET'S id, and that is not a detail. Every document about a member is keyed by their id - users,
// users_private, user_settings, and every user_id in every other collection - and firestore.rules compares that key
// to request.auth.uid. If Firebase were left to mint its own uid, the migration would write 33 members' rows under
// ids nothing could ever authenticate as. The Admin SDK accepts a chosen uid, so the two line up by construction and
// no reference anywhere has to be rewritten.
export const createAccounts = async ({ auth, users, apply = false, makePassword = temporaryPassword }) => {
  const created = [];
  const existing = [];
  const mismatched = [];
  for (const row of users) {
    const username = String(row.user_name || '').trim();
    const uid = String(row.id || '').trim();
    if (!username || !uid) continue;
    const email = syntheticEmail(username);
    const found = await auth.getUserByEmail(email).catch(() => null);
    if (found) {
      // An account created by hand in the console has a uid of Firebase's choosing, so its rows would be filed under
      // an id it cannot authenticate as. Reported rather than silently tolerated: it is one click to fix now and a
      // member who cannot see their own timesheet later.
      if (found.uid !== uid) mismatched.push(`${username}: account uid ${found.uid}, sheet id ${uid}`);
      existing.push(username);
      continue;
    }
    const password = makePassword();
    if (apply) await auth.createUser({ uid, email, password, displayName: String(row.name || '').trim() });
    created.push({ username, uid, email, password });
  }
  return { created, existing, mismatched };
};

// --- the run ----------------------------------------------------------------------------------------------------

const main = async () => {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const force = argv.includes('--force');
  const skipAuth = argv.includes('--skip-auth');

  const spreadsheetId = resolveSpreadsheetId({ argv });
  const account = resolveServiceAccount();
  const token = await accessTokenFor(account);

  const meta = await fetch(`${SHEETS_API}/${spreadsheetId}?fields=properties.title,sheets.properties`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((response) => response.json());
  const titles = (meta.sheets || []).map((sheet) => sheet.properties.title);
  const ranges = titles.map((title) => `ranges=${encodeURIComponent(`${title}!A1:ZZ`)}`).join('&');
  const batch = await fetch(`${SHEETS_API}/${spreadsheetId}/values:batchGet?${ranges}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((response) => response.json());
  const tabs = titles.map((title, index) => ({ title, values: batch.valueRanges?.[index]?.values }));
  const valuesOf = (title) => rowsFrom(tabs.find((tab) => tab.title === title)?.values) || [];

  const { byCollection, problems, notes } = writeList({ tabs, ranks: valuesOf('ranks') });
  const users = valuesOf('users');
  const total = Object.values(byCollection).reduce((sum, entries) => sum + entries.length, 0);

  console.log(`Spreadsheet: ${meta.properties?.title || '(untitled)'}  ->  project ${account.projectId}`);
  console.log(`${total} document(s) across ${Object.keys(byCollection).length} collection(s)`);
  console.log(`\nProblems (${problems.length}):`);
  if (!problems.length) console.log('  nothing');
  problems.forEach((problem) => console.log(`  - ${problem}`));
  console.log(`\nDecided (${notes.length}) - the plan prints these in full.`);

  // The gate. A problem means the mapping and the sheet disagree about something, and this step writes with the
  // Admin SDK, where no rule will catch a mistake. So it stops instead of pressing on.
  if (apply && problems.length && !force) {
    console.error('\nRefusing to write while there are problems. Read them, then re-run with --force if they are expected.');
    process.exit(1);
  }

  initializeApp({ credential: cert(account.file), projectId: account.projectId });
  const db = getFirestore();

  const results = await writeCollections({ db, byCollection, apply });
  console.log(`\n${apply ? 'WROTE' : 'WOULD WRITE'}:`);
  results.forEach(({ collection, written, empty, skipped }) => {
    if (skipped) return console.log(`  ${String(0).padStart(5)}  ${collection}  (nothing writable)`);
    console.log(`  ${String(written).padStart(5)}  ${collection}${empty ? `  (+${empty} empty, not writable)` : ''}`);
  });

  if (!skipAuth) {
    const { created, existing, mismatched } = await createAccounts({ auth: getAuth(), users, apply });
    console.log(`\nAuth accounts: ${created.length} ${apply ? 'created' : 'to create'}, ${existing.length} already there`);
    if (mismatched.length) {
      // The one thing the migration cannot decide for you: an existing account with Firebase's own uid would leave
      // that member unable to read their own rows, because every document about them is keyed by the sheet's id.
      console.error(`\n${mismatched.length} account(s) whose uid is NOT the sheet's id:`);
      mismatched.forEach((line) => console.error(`  - ${line}`));
      console.error('Those members would sign in and see nothing. Fix the account (or the sheet id), then re-run.');
      if (apply) process.exitCode = 1;
    }
    if (created.length && apply) {
      // Written to the ignored secrets/ directory rather than the scrollback: they are handed to members one at a
      // time, and a terminal is the wrong place for thirty-three passwords.
      const file = 'secrets/temp-passwords.txt';
      writeFileSync(file, `${created.map(({ username, password }) => `${username}\t${password}`).join('\n')}\n`, {
        mode: 0o600,
      });
      console.log(`Temporary passwords written to ${file} (ignored by git). The app forces a change on first sign-in.`);
    }
  }

  console.log(apply ? '\nDone. Re-running is safe: every write is by id.' : '\nNOTHING WAS WRITTEN. Add --apply to write.');
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`\n${error.message}`);
    process.exit(1);
  });
}

export { main };
