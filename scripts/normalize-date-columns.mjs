// Date columns after a migration that left them as the sheet's DISPLAY text.
//
// WHY THIS EXISTS. The app QUERIES dates. `where('date_from', '>=', '2026-09-01')` is a string range, and the sheet held
// `date_from` as a cell its display formatted - `3/6/2026` - which the migration carried as text, because text is what an
// unrecognised column becomes. `'3/6/2026'` sorts AFTER `'2026-09-30'`, so those rows are excluded from every month a screen
// asks for: the calendar and the board show an empty month and say nothing about why. It is the same failure `runner_score` had
// (see scripts/normalize-runner-scores.mjs) from the same cause - a value a query filters on has to be what the query expects.
//
// WHAT IT REWRITES: the date-only columns the map names (dateColumns()), through the map's own `typedValue`, so this repair and
// a fresh migration cannot disagree about what a date means. It then RE-DERIVES the fields the map derives - a shift's `is_open`,
// an offer's `slot_key` - because those were derived from the same unreadable value, and a `slot_key` built from `3/6/2026`
// matches nothing the calendar computes.
//
// WHAT IT DELIBERATELY DOES NOT TOUCH: a value the parser cannot read. Blanking it would hide the row rather than the problem, so
// it is counted and named instead. DATETIMES are not in the list at all - a day-only parser would destroy the time - and the
// report counts them, so nobody assumes they were checked.
//
// SAFE TO RUN TWICE: it writes only what differs, so a second run reports nothing to do.
//
// Run with: npm run dates:normalize            (report only - the default)
//           npm run dates:normalize -- --apply (write)
//
// The project comes from .firebaserc and the credentials from THE MIGRATION'S OWN KEY - a file named by
// MIGRATE_SERVICE_ACCOUNT, or the single .json in secrets/, which is the file the migration itself used. That is the path that
// needs no gcloud at all. Application default credentials are the fallback, for a machine that has them.
//
// The Admin SDK is imported INSIDE main() so this module stays importable by a harness - the same reason
// normalize-runner-scores.mjs does it.
import { readFileSync } from 'node:fs';
import { TAB_MAP, dateColumns, typedValue } from './migration-map.mjs';
// The migration's account resolution, so there is ONE credentials convention in this repository rather than one per script.
import { resolveServiceAccount } from './migrate-recon.mjs';

// WHAT A DOCUMENT SHOULD HOLD, given what it holds now: the fields to write, and an empty object when nothing needs writing.
// Pure, so scripts/verify-migration-map.mjs drives every case without a database.
export const dateFixesFor = (data, derive = {}) => {
  const row = data && typeof data === 'object' ? data : {};
  const updates = {};
  for (const column of dateColumns()) {
    const current = row[column];
    // A document that does not carry the column is not this script's business: the repair is about values that are THERE.
    if (current === undefined || current === null || current === '') continue;
    const next = typedValue(column, current);
    if (next !== current) updates[column] = next;
  }
  // The derivations run against the PATCHED row, which is the point: a `slot_key` is only right once its date is.
  const patched = { ...row, ...updates };
  for (const [field, deriveOne] of Object.entries(derive || {})) {
    const next = deriveOne(patched);
    if (next !== undefined && next !== row[field]) updates[field] = next;
  }
  return updates;
};

// The datetime columns the app stores alongside the date ones. Counted, never rewritten - see the header.
const DATETIME_COLUMNS = ['time_in', 'time_out', 'created_at', 'signed_at'];

// Collections to walk: everything the migration writes. A skipped tab has no Firestore collection at all, and a tab may map to a
// single DOCUMENT rather than a collection (`settings/public`) - which `db.collection()` refuses outright, because a path with an
// even number of components is not a collection path. Those hold no date columns in any case.
export const dateRepairTargets = () =>
  Object.values(TAB_MAP)
    .filter((spec) => !spec.skip && Array.isArray(spec.collections))
    .flatMap((spec) => spec.collections.map((name) => ({ name, derive: spec.derive || {} })))
    .filter((target) => !target.name.includes('/'));

const projectFromFirebaserc = () => {
  try {
    const parsed = JSON.parse(readFileSync(new URL('../.firebaserc', import.meta.url), 'utf8'));
    return (parsed.projects && parsed.projects.default) || '';
  } catch {
    return '';
  }
};


const main = async () => {
  const { initializeApp, applicationDefault, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const apply = process.argv.includes('--apply');
  const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || projectFromFirebaserc();

  // THE MIGRATION'S OWN KEY FIRST, which is why this script needs no gcloud: `resolveServiceAccount` reads
  // MIGRATE_SERVICE_ACCOUNT, or the single .json in secrets/ - the same file the migration used. It THROWS when it finds none (or
  // several, which is a real ambiguity), and that is caught here rather than being fatal, because a machine with application
  // default credentials is a perfectly good second answer.
  let account = null;
  try {
    account = resolveServiceAccount();
  } catch {
    account = null;
  }

  let db;
  try {
    db = getFirestore(
      emulator
        ? initializeApp({ projectId: projectId || 'demo-station-portal' })
        : account
          ? initializeApp({ credential: cert(account.file), projectId: projectId || account.projectId })
          : initializeApp({ credential: applicationDefault(), projectId })
    );
  } catch (error) {
    console.error(
      [
        `Could not reach Firestore${projectId ? ` in project ${projectId}` : ''}:`,
        `  ${(error && error.message) || error}`,
        '',
        'NO CREDENTIALS WERE FOUND. The migration has a key - if it is still on this machine, this script will use it:',
        '  secrets/<name>.json          (any single .json in that folder), or',
        '  MIGRATE_SERVICE_ACCOUNT=/path/to/key.json npm run dates:normalize',
        '',
        'A key comes from the Firebase console: Project settings -> Service accounts -> Generate new private key.',
        'The alternative is application default credentials, which needs the Google Cloud CLI (NOT an npm package -',
        '`npm i gcloud` installs something else entirely):',
        '  gcloud auth application-default login',
        '',
        'Against the emulator none of this is needed:',
        '  firebase emulators:exec --only firestore "npm run dates:normalize"',
        '',
        'NOTHING WAS WRITTEN.',
      ].join('\n')
    );
    process.exit(1);
  }

  console.log(
    `Reading the migrated collections from ${emulator ? 'the emulator' : projectId || 'production'}` +
      `${apply ? '' : ' (report only)'}${emulator ? '' : account ? ` using ${account.file}` : ' using application default credentials'}`
  );

  const wanted = [];
  let datetimes = 0;
  let unreadable = 0;
  for (const { name, derive } of dateRepairTargets()) {
    const snapshot = await db.collection(name).get();
    snapshot.forEach((document) => {
      const data = document.data() || {};
      DATETIME_COLUMNS.forEach((column) => {
        if (data[column] !== undefined && data[column] !== '') datetimes += 1;
      });
      // Only counted when a date is THERE and the parser cannot read it: that is the state the report is for.
      unreadable += dateColumns().filter((column) => {
        const value = data[column];
        if (value === undefined || value === null || value === '') return false;
        return typedValue(column, value) === value && !/^\d{4}-\d{2}-\d{2}$/.test(String(value));
      }).length;
      const updates = dateFixesFor(data, derive);
      if (!Object.keys(updates).length) return;
      wanted.push({
        path: `${name}/${document.id}`,
        from: Object.keys(updates).map((field) => [field, data[field]]),
        to: updates,
      });
    });
  }

  const byCollection = {};
  wanted.forEach((entry) => {
    const name = entry.path.split('/')[0];
    byCollection[name] = (byCollection[name] || 0) + 1;
  });

  console.log(
    `  ${wanted.length} document(s) holding a date the app cannot compare` +
      (unreadable ? `, ${unreadable} value(s) unreadable and left exactly as they are` : '')
  );
  // BY COLLECTION FIRST, because that is the question somebody actually asks: "which of my data is affected".
  Object.entries(byCollection)
    .sort((a, b) => b[1] - a[1])
    .forEach(([name, count]) => console.log(`    ${String(count).padStart(4)}  ${name}`));
  if (wanted.length) console.log('    (up to three from each affected collection, field by field)');
  const shown = {};
  wanted.forEach((entry) => {
    const name = entry.path.split('/')[0];
    shown[name] = (shown[name] || 0) + 1;
    if (shown[name] > 3) return;
    console.log(`    ${entry.path}`);
    entry.from.forEach(([field, value]) =>
      console.log(`      ${field}: ${JSON.stringify(value)} -> ${JSON.stringify(entry.to[field])}`)
    );
  });
  // Nothing is hidden by the cap above: the per-collection counts are the whole picture, and this is the shape of it.
  const more = Object.entries(byCollection).filter(([name, count]) => count > shown[name]);
  if (more.length) {
    console.log(`    ... and the rest: ${more.map(([name, count]) => `${count - shown[name]} more ${name}`).join(', ')}`);
  }
  if (datetimes) {
    console.log(`\n  ${datetimes} datetime value(s) were NOT examined - a day-only parser would destroy the time, so they are outside`);
    console.log('  this repair rather than silently wrong in it. If a clock entry or a signature reads oddly, that is a separate');
    console.log('  decision with a separate script; this one neither fixes nor breaks them.');
  }

  if (!apply) {
    console.log('\nNothing was written. Add --apply to rewrite them (until then those rows are invisible to every month).');
    return;
  }
  // Batched, like every other write path here: 400 leaves room under Firestore's 500.
  for (let index = 0; index < wanted.length; index += 400) {
    const batch = db.batch();
    wanted.slice(index, index + 400).forEach((entry) => batch.update(db.doc(entry.path), entry.to));
    await batch.commit();
  }
  console.log(`\nRewrote ${wanted.length} document(s).`);
};

// Only when run as a command, so a harness can import dateFixesFor without doing any of this.
if (process.argv[1] && process.argv[1].includes('normalize-date-columns')) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
