// `runner_score` after a migration that did not type it.
//
// WHY THIS EXISTS. The leaderboard is a QUERY - `where('runner_score', '>', 0).orderBy('runner_score', 'desc').limit(25)` -
// and Firestore compares types: a score stored as TEXT is not greater than zero, so its owner does not appear with a wrong
// number, they disappear from the board entirely. The sheet held that column as a cell, and the migration carries any column
// it does not know to be numeric as text. `runner_score` is in NUMERIC_COLUMNS now (scripts/migration-map.mjs), so a
// migration run from here writes numbers; a database migrated BEFORE that fix can still hold text, and this is the cure:
// it reads every `users` document, reports the ones holding a numeric-looking string, and rewrites them as numbers.
//
// WHAT IT DELIBERATELY DOES NOT TOUCH: a value that is not a number - blank, junk, absent - is left exactly as it is. None of
// those are on the board either, and turning them into 0 or deleting them would be a decision about somebody's personal best
// that this script has no business making. It counts them and says so, so the number is never a surprise.
//
// SAFE TO RUN TWICE, which is what makes it usable as a check as well as a fix: it writes only the documents that need it,
// so a second run reports nothing to do.
//
// THE DECISION IS EXPORTED AND TESTED (scoreToStore, exercised by scripts/verify-firestore-reads.mjs against a real text
// score); the loop around it is three lines of reading documents and writing the ones that need it.
//
// Run with: npm run scores:normalize            (report only - the default)
//           npm run scores:normalize -- --apply (write)
//
// The project comes from .firebaserc and the credentials from application default credentials; see the guidance it prints if
// either is missing. It is OPTIONAL: the score callable repairs a text score by itself the next time that member plays.
//
// THE ADMIN SDK IS IMPORTED INSIDE main(), NOT HERE, and that is deliberate: it lives in functions/node_modules, so a static
// import would make this module unloadable from anywhere else - and scripts/verify-firestore-reads.mjs imports scoreToStore
// from here to test the decision against a real text score. Same reason readSystemLog requires @google-cloud/logging lazily.
//
// What a stored `runner_score` should be: a number, and NOTHING else - a member's best is either a number the game can be
// beaten against or it is not a score. `null` means "leave this document exactly as it is".
export const scoreToStore = (value) => {
  // Already a number: nothing to do. (This is the common case, and it is what makes a second run silent.)
  if (typeof value === 'number') return null;
  const text = String(value ?? '').trim();
  if (text === '') return null;
  const number = Number(text);
  if (!Number.isFinite(number)) return null;
  return number;
};

import { readFileSync } from 'node:fs';

// The project this checkout deploys to, from .firebaserc - the same file `firebase deploy` reads, so there is one place that
// says which project this is and no environment variable to remember.
const projectFromFirebaserc = () => {
  try {
    const text = readFileSync(new URL('../.firebaserc', import.meta.url), 'utf8');
    return String((JSON.parse(text).projects || {}).default || '');
  } catch {
    return '';
  }
};

const main = async () => {
  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const apply = process.argv.includes('--apply');
  const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  // THE PROJECT COMES FROM .firebaserc, so this works in a checkout without exporting anything. Credentials are the one thing
  // that cannot be defaulted, and the failure below says what to do rather than repeating the SDK's own words - which talk
  // about a project id even when the real problem is a missing credential.
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || projectFromFirebaserc();
  console.log(`Reading users from ${emulator ? 'the emulator' : projectId || 'production'}${apply ? '' : ' (report only)'}`);

  let users;
  let db;
  try {
    const app = emulator
      ? initializeApp({ projectId: projectId || 'demo-station-portal' })
      : initializeApp({ credential: applicationDefault(), projectId });
    db = getFirestore(app);
    users = await db.collection('users').get();
  } catch (error) {
    console.error(
      [
        `Could not read \`users\` from ${emulator ? 'the emulator' : projectId ? `project ${projectId}` : 'a project'}:`,
        `  ${(error && error.message) || error}`,
        '',
        'Against a real project this needs application default credentials - the one thing the Admin SDK cannot invent:',
        `  gcloud auth application-default login${projectId ? ` && gcloud config set project ${projectId}` : ''}`,
        'Against the emulator, run it inside one:',
        '  firebase emulators:exec --only firestore "npm run scores:normalize"',
        '',
        'NOTHING WAS WRITTEN, and nothing needs to be: the score callable repairs a text score by itself the next time that',
        'member finishes a run, whatever they score. This script is for fixing the whole station at once.',
      ].join('\n')
    );
    process.exit(1);
  }
  const wanted = [];
  let leftAlone = 0;
  users.forEach((document) => {
    const value = (document.data() || {}).runner_score;
    if (value === undefined) return;
    const stored = scoreToStore(value);
    if (stored === null) {
      // Only count the ones that LOOK like a score somebody meant: a number already stored numerically needs nothing.
      if (typeof value !== 'number') leftAlone++;
      return;
    }
    wanted.push({ id: document.id, from: value, to: stored });
  });

  console.log(`  ${users.size} users, ${wanted.length} holding a score as text, ${leftAlone} holding something that is not a number`);
  wanted.slice(0, 20).forEach((entry) => console.log(`    ${entry.id}: ${JSON.stringify(entry.from)} -> ${entry.to}`));
  if (wanted.length > 20) console.log(`    ... and ${wanted.length - 20} more`);

  if (!apply) {
    console.log('\nNothing was written. Add --apply to rewrite those as numbers (the board cannot see them until then).');
    return;
  }
  // Batched, like every other write path here: 400 leaves room under Firestore's 500.
  for (let index = 0; index < wanted.length; index += 400) {
    const batch = db.batch();
    wanted.slice(index, index + 400).forEach((entry) => batch.update(db.doc(`users/${entry.id}`), { runner_score: entry.to }));
    await batch.commit();
  }
  console.log(`\nRewrote ${wanted.length} score(s) as numbers.`);
};

// Only when run as a command, so the harness can import scoreToStore without doing any of this.
if (process.argv[1] && process.argv[1].includes('normalize-runner-scores')) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
