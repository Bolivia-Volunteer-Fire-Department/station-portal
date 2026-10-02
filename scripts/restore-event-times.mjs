// Event times lost by the migration, restored from the sheet.
//
// WHY THIS EXISTS. `typedValue` used to run every DATE_COLUMN through a DAY parser, and `date_from`/`date_to` are date
// columns - but on an EVENT they carry a time as well. `'11/10/2026 18:00'` parsed to `'2026-11-10'` and the hour was
// gone, so every migrated event drew as "00:00 - 00:01". The map is fixed (see the comment on DATE_COLUMNS in
// scripts/migration-map.mjs), so a fresh migration is correct - but the rows already in Firestore still hold the
// day-only value, and NO REPAIR THAT READS ONLY FIRESTORE CAN FIX THEM: the time is not there to be reformatted.
// `scripts/normalize-date-columns.mjs` rewrites a value through the same parser, and a day-only value parses to
// itself, so it reports nothing to do. The hour survives in exactly one place, the spreadsheet, which is why this
// script reads it.
//
// WHAT IT REWRITES: `date_from` and `date_to` on an event that is NOT all-day and holds a day-only value, taking the
// time half from the sheet's own cell for that row - through the map's `typedValue`, so this repair and a fresh
// migration cannot disagree about the shape they produce.
//
// WHAT IT DELIBERATELY DOES NOT TOUCH:
//   - AN ALL-DAY EVENT. Day-only is the shape AdminEventsTab writes for one and the app compares its DATES
//     inclusively, so it is correct as it stands. Giving it an hour would invent a time nobody chose.
//   - THE DATE HALF. If the sheet's day differs from the stored day then either the sheet was edited after the
//     migration or the document was edited in the app since cutover, and which one is true is a human decision. This
//     script can only ever ADD A TIME to a day that is already right; it cannot move an event to another day.
//   - ANY OTHER FIELD. It writes with update() and only the two date keys - never set(), so a title, colour or
//     audience an officer has changed since cutover is not rolled back to the sheet's stale copy.
//   - A PAIR THE APP WOULD REJECT. An end at or before its start is refused rather than written, because writing it
//     would make the event unsaveable in the form - the very thing being fixed here.
//
// Anything it declines is COUNTED AND NAMED, never guessed at: a row whose time is unrecoverable is a row for an
// officer to re-enter, and saying so is the useful answer.
//
// SAFE TO RUN TWICE: it writes only what differs, so a second run reports nothing to do.
//
// Run with: npm run events:restore-times            (report only - the default)
//           npm run events:restore-times -- --apply (write)
//
// Needs the spreadsheet id (MIGRATE_SPREADSHEET_ID, or as the first argument - a full sheet URL works too) and the
// migration's own key, exactly as scripts/migrate-recon.mjs resolves them. The Admin SDK is imported INSIDE main() so
// a harness can import the decision below without touching a database.
import { readFileSync } from 'node:fs';
// The map's own coercion: the repair must produce what a fresh migration would, not its own idea of a datetime.
import { typedValue } from './migration-map.mjs';
// The migration's credentials and sheet access, so there is ONE convention for both rather than one per script.
import { accessTokenFor, resolveServiceAccount, resolveSpreadsheetId } from './migrate-recon.mjs';
import { rowsFrom } from './migrate-plan.mjs';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

// The two fields an event's clock lives in. On a RECURRING event they hold the TIMES ONLY - the date is just an
// anchor - so a day-only value there is an event with no time at all, which is the worst case rather than a special
// one: the same test finds it and the same repair fixes it.
export const TIME_FIELDS = ['date_from', 'date_to'];

export const hasClockTime = (value) => /\d{1,2}:\d{2}/.test(String(value ?? ''));
export const isDayOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '').trim());
// Mirrors `eventFlag` in src/utils/events.js. That module cannot be imported here - its imports are extensionless,
// which is Vite's resolution and not node's - so the flag rule is copied and the harness checks the copy.
export const isAllDayRow = (row) =>
  row.is_all_day === true || String(row.is_all_day ?? '').trim().toUpperCase() === 'TRUE';

// Every answer this repair can give, so a report groups by them and a harness can prove the list is closed. A reason
// is returned even when nothing is written: "why did this row change nothing" is the question the report has to
// answer, and a silent skip is how a repair hides the rows it could not help.
export const REASON_LABELS = {
  ok: 'restored from the sheet',
  'all-day': 'all-day, so day-only is already correct',
  'has-times': 'already carries a time',
  'no-dates': 'holds no readable date',
  'no-sheet-row': 'not in the sheet (created since cutover?)',
  'sheet-blank': 'the sheet cell is empty',
  'sheet-has-no-time': 'the sheet lost the time too - needs re-entry by an officer',
  'date-disagrees': 'the sheet dates a different DAY - a human decision, not this script',
  'time-unreadable': 'the restored time is not a real clock time',
  'pair-not-ordered': 'the restored end is not after its start - the app would reject it',
};

// Minutes past midnight of a datetime value, or null. Mirrors `eventMinutesOf` EXACTLY - including a bare date
// reading as midnight, which is the app's own answer - because the harness asserts the two are equal over a list of
// values, and a copy that differs anywhere is a copy that can drift. src/utils/events.js cannot be imported here (its
// imports are extensionless, which is Vite's resolution and not node's), so equality is checked there instead.
export const minutesOf = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const match = /^\d{4}-\d{2}-\d{2}[T ](\d{1,2}):(\d{2})/.exec(raw);
  if (match) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 0;
  return null;
};

const dayOf = (value) => String(value ?? '').trim().slice(0, 10);

// WHAT ONE DOCUMENT SHOULD HOLD, given what it holds now and what the sheet says: the fields to write, and an empty
// object plus a reason when nothing should be written. Pure, so the harness drives every case without a database.
export const eventTimeFixesFor = ({ stored = {}, sheetRow = null } = {}) => {
  const row = stored && typeof stored === 'object' ? stored : {};

  if (isAllDayRow(row)) return { updates: {}, reason: 'all-day' };

  const lost = TIME_FIELDS.filter((field) => isDayOnly(row[field]));
  if (!lost.length) {
    // Either it already carries a time, or its dates are absent/unreadable - neither is this repair's business, and
    // the two are told apart because the second is a problem worth seeing.
    return { updates: {}, reason: TIME_FIELDS.some((field) => hasClockTime(row[field])) ? 'has-times' : 'no-dates' };
  }

  if (!sheetRow) return { updates: {}, reason: 'no-sheet-row' };

  const updates = {};
  for (const field of lost) {
    const sheetValue = String(sheetRow[field] ?? '').trim();
    if (!sheetValue) return { updates: {}, reason: 'sheet-blank' };

    // Through the map's own coercion, so the shape written here is the shape a fresh migration writes.
    const candidate = typedValue(field, sheetValue);
    if (!hasClockTime(candidate)) return { updates: {}, reason: 'sheet-has-no-time' };
    // ONLY THE TIME HALF MAY CHANGE - see the header. This is the line that makes the repair unable to move an event.
    if (dayOf(candidate) !== dayOf(row[field])) return { updates: {}, reason: 'date-disagrees' };
    updates[field] = candidate;
  }

  // The pair is checked the way the form checks it, because writing one the form rejects would leave the event
  // unsaveable - `eventValidation` in src/utils/events.js is the authority and the harness compares the two.
  const patched = { ...row, ...updates };
  const from = minutesOf(patched.date_from);
  const to = minutesOf(patched.date_to);
  if (from === null || to === null) return { updates: {}, reason: 'time-unreadable' };
  const sameDay = dayOf(patched.date_from) === dayOf(patched.date_to);
  if (sameDay ? to <= from : dayOf(patched.date_to) < dayOf(patched.date_from)) {
    return { updates: {}, reason: 'pair-not-ordered' };
  }

  return { updates, reason: 'ok' };
};

const projectFromFirebaserc = () => {
  try {
    const parsed = JSON.parse(readFileSync(new URL('../.firebaserc', import.meta.url), 'utf8'));
    return (parsed.projects && parsed.projects.default) || '';
  } catch {
    return '';
  }
};

// The sheet's event rows keyed by id, so a Firestore document meets its own source row. A tab whose title differs in
// case is still the tab - a rename that only changed case should not make this script say "not in the sheet" for
// every row, which would read as "nothing to repair" rather than "I could not read the sheet".
const sheetRowsById = async ({ spreadsheetId, token }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const meta = await fetch(`${SHEETS_API}/${spreadsheetId}?fields=sheets.properties.title`, { headers }).then((r) => r.json());
  const titles = (meta.sheets || []).map((sheet) => sheet.properties.title);
  const title = titles.find((name) => String(name).trim().toLowerCase() === 'events');
  if (!title) {
    throw new Error(`The spreadsheet has no "events" tab. Its tabs are: ${titles.join(', ') || '(none readable)'}`);
  }
  const range = await fetch(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(`${title}!A1:ZZ`)}`, {
    headers,
  }).then((r) => r.json());
  const byId = new Map();
  rowsFrom(range.values).forEach((row) => {
    const id = String(row.id ?? '').trim();
    if (id) byId.set(id, row);
  });
  return { byId, title, rowCount: byId.size };
};

const main = async () => {
  const { initializeApp, applicationDefault, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || projectFromFirebaserc();

  // RESOLVED FIRST, before anything reaches for production. The sheet is the only place the lost hours still exist, so
  // without its id there is nothing to restore from - and failing here says so, rather than connecting to Firestore,
  // reading every event, and then reporting "nothing to do", which is the misleading answer.
  const spreadsheetId = resolveSpreadsheetId({ env: process.env, argv });

  // THE MIGRATION'S OWN KEY FIRST, which is why this needs no gcloud - the same resolution, and the same fallback, as
  // scripts/normalize-date-columns.mjs, so there is one credentials convention in this repository.
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
        'See scripts/normalize-date-columns.mjs for the credential options - they are identical, and nothing was written.',
      ].join('\n')
    );
    process.exit(1);
  }

  // Reading the sheet needs the migration's key: there is no application-default path to a spreadsheet, unlike the
  // Firestore connection above, so this is a hard requirement rather than a fallback.
  if (!account) {
    throw new Error('Reading the sheet needs the migration service-account key. See scripts/migrate-recon.mjs.');
  }
  const token = await accessTokenFor(account);
  const sheet = await sheetRowsById({ spreadsheetId, token });

  console.log(
    `Reading events from ${emulator ? 'the emulator' : projectId || 'production'} and their times from the ` +
      `"${sheet.title}" tab (${sheet.rowCount} sheet row(s))${apply ? '' : ' (report only)'}`
  );

  const snapshot = await db.collection('events').get();
  const grouped = new Map();
  const repairs = [];
  snapshot.forEach((document) => {
    const data = document.data() || {};
    const { updates, reason } = eventTimeFixesFor({ stored: data, sheetRow: sheet.byId.get(document.id) || null });
    const entry = { id: document.id, data, updates, reason };
    grouped.set(reason, [...(grouped.get(reason) || []), entry]);
    if (reason === 'ok') repairs.push(entry);
  });

  console.log(`\n${snapshot.size} event document(s):`);
  // The repairable count first, then every reason it declined - a repair that prints only its successes hides the
  // rows it could not help, which are exactly the ones somebody has to act on.
  Object.entries(REASON_LABELS).forEach(([reason, label]) => {
    const entries = grouped.get(reason);
    if (!entries || !entries.length) return;
    console.log(`  ${String(entries.length).padStart(3)}  ${label}`);
    entries.slice(0, 5).forEach((entry) => {
      if (reason === 'ok') {
        console.log(
          `       ${entry.id}  ${TIME_FIELDS.map((f) => `${entry.data[f]} -> ${entry.updates[f]}`).join('   ')}`
        );
        return;
      }
      console.log(`       ${entry.id}  ${TIME_FIELDS.map((f) => `${f}=${JSON.stringify(entry.data[f] ?? null)}`).join(' ')}`);
    });
    if (entries.length > 5) console.log(`       ... and ${entries.length - 5} more`);
  });

  if (!apply) {
    console.log(
      `\nNothing was written. Add --apply to restore ${repairs.length} event(s)` +
        (repairs.length ? '' : ' - there is nothing this script can restore') + '.'
    );
    return;
  }
  if (!repairs.length) {
    console.log('\nNothing to write.');
    return;
  }
  // update() and only the two date keys, never set(): see the header. 400 leaves room under Firestore's 500.
  for (let index = 0; index < repairs.length; index += 400) {
    const batch = db.batch();
    repairs.slice(index, index + 400).forEach((entry) =>
      batch.update(db.collection('events').doc(entry.id), entry.updates)
    );
    await batch.commit();
  }
  console.log(`\nRestored the times on ${repairs.length} event(s).`);
};

// Only when run as a command, so a harness can import eventTimeFixesFor without doing any of this.
if (process.argv[1] && process.argv[1].includes('restore-event-times')) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}




