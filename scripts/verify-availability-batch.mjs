/**
 * Verifies the availability batch write in Code.gs (setAvailabilityRows).
 *
 * This is the one place availability data is WRITTEN, and it is destructive by design: it
 * deletes the rows a change refers to before writing them back, so it is the code most
 * likely to corrupt the sheet silently. It also cannot be exercised from the UI here, so
 * the real functions are extracted from Code.gs and run against a fake sheet that records
 * every write.
 *
 * The claims under test:
 *   - rows are mapped by HEADER NAME (user_id is last on this sheet, so a positional write
 *     would put a member id in a date column)
 *   - a whole batch costs exactly ONE setValues call (the reason for batching at all)
 *   - adding a slot that is already marked does not duplicate it
 *   - other members' rows are never touched
 *   - a malformed entry is skipped instead of failing the batch
 *
 *   npm run verify:availability-batch
 */
import fs from 'node:fs';
import path from 'node:path';

const CODE_GS = path.resolve(process.cwd(), 'src/services/Code.gs');
const source = fs.readFileSync(CODE_GS, 'utf8');
const lines = source.split('\n');

function extract(startMarker, endMarker) {
  const start = lines.findIndex((line) => line.startsWith(startMarker));
  const end = lines.findIndex((line, i) => i > start && line.startsWith(endMarker));
  if (start === -1) throw new Error(`Could not find "${startMarker}" in Code.gs`);
  if (end === -1 || end <= start) throw new Error(`Could not find the end of "${startMarker}"`);
  return lines.slice(start, end).join('\n');
}

const dateHelpers = extract('function pad2(value) {', 'function todayDateKey() {');
const batchHelpers = extract(
  'function newRowId() {',
  '// Inserts or updates a row in a key/value sheet'
);
for (const symbol of ['rowValuesForHeaders', 'setAvailabilityRows', 'newRowId']) {
  if (!batchHelpers.includes(`function ${symbol}`)) {
    throw new Error(`Extracted block is missing ${symbol}`);
  }
}

// ---------------------------------------------------------------------------
// Apps Script stubs
// ---------------------------------------------------------------------------
// Station-timezone formatting, matching what Utilities.formatDate returns.
const pad2 = (n) => String(n).padStart(2, '0');
const formatYmd = (date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};
const Utilities = {
  formatDate: (value) => formatYmd(value instanceof Date ? value : new Date(value)),
  // Deterministic, hex-shaped and 36 characters, so the code's own UUID check recognises it.
  getUuid: (() => {
    let issued = 0;
    return () => {
      issued++;
      return `00000000-0000-4000-8000-${String(issued).padStart(12, '0')}`;
    };
  })(),
};

// A sheet that behaves like a real one for the calls this code makes, and counts writes.
function makeSheet(headers, rows = []) {
  const data = [headers.slice(), ...rows.map((row) => row.slice())];
  const stats = { deletes: 0, setValuesCalls: 0, writtenRows: 0 };

  return {
    stats,
    rows: () => data.map((row) => row.slice()),
    getDataRange: () => ({ getValues: () => data.map((row) => row.slice()) }),
    getLastRow: () => data.length,
    deleteRow: (rowNumber) => {
      stats.deletes++;
      data.splice(rowNumber - 1, 1);
    },
    getRange: (row, col, numRows, numCols) => {
      if (row < 1 || col < 1) throw new Error('getRange called with a non-1-based range');
      return {
        setValues: (values) => {
          if (values.length !== numRows) throw new Error('setValues row count mismatch');
          if (values[0].length !== numCols) throw new Error('setValues column count mismatch');
          stats.setValuesCalls++;
          stats.writtenRows += values.length;
          for (let i = 0; i < values.length; i++) {
            const target = row - 1 + i;
            while (data.length <= target) data.push(new Array(numCols).fill(''));
            data[target] = values[i].slice();
          }
        },
      };
    },
  };
}

// An independent UUID check, so these assertions are not reading the same regex the code under test uses.
const uuidShaped = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value));

const HEADERS = [
  'id',
  'schedule_template_id',
  'date_from',
  'date_to',
  'apparatus_id',
  'assignment_id',
  'user_id',
];

// findRowById is a trivial id lookup and is exercised by the app itself; stubbing it keeps
// the extraction to the write path, which is what this file is about.
const findRowByIdStub = (rows, id) =>
  (Array.isArray(rows) ? rows : []).find((row) => String(row?.id ?? '').trim() === String(id ?? '').trim()) ||
  null;

const makeApi = (sheet, templates) => {
  const factory = new Function(
    'Utilities',
    'getSheetData',
    'findRowById',
    `${dateHelpers}\n${batchHelpers}\nreturn { setAvailabilityRows, rowValuesForHeaders };`
  );
  const ss = { getSheetByName: (name) => (name === 'availability' ? sheet : null) };
  const getSheetDataStub = (target, name) => (name === 'schedule_templates' ? templates : []);
  return { api: factory(Utilities, getSheetDataStub, findRowByIdStub), ss };
};

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` -> ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`}`
  );
};

// One existing row for u2, so every test can prove it is left alone.
const EXISTING = [7, 't1', '2026-09-07', '2026-09-07', '', 'a1', 'u2'];
const templates = [
  { id: 't1', assignment_id: 'a1', apparatus_id: '' },
  { id: 't2', assignment_id: 'a2', apparatus_id: 'E1' },
];
const slot = (templateId, dateFrom) => ({ schedule_template_id: templateId, date_from: dateFrom });

console.log('--- adding marks rows by header name ---');
{
  const sheet = makeSheet(HEADERS, [EXISTING]);
  const { api, ss } = makeApi(sheet, templates);
  const result = api.setAvailabilityRows(ss, 'u1', [slot('t1', '2026-09-07')], []);

  check('reports what it did', [result.ok, result.added, result.cleared, result.skipped], [true, 1, 0, 0]);
  const rows = sheet.rows();
  check('the row went in beneath the existing data', rows.length, 3);
  // Column order comes from the headers: user_id LAST, not second.
  check('the member id landed in the user_id column', rows[2][6], 'u1');
  check('the template id is in its own column', rows[2][1], 't1');
  check('the assignment came from the template', rows[2][5], 'a1');
  check('date_to defaults to the start date', rows[2][3], '2026-09-07');
  // A UUID, not a number following the row above: sequential ids were reused after a delete, so a reference to
  // the freed id silently pointed at a different row (see utils/../../src/services/Code.gs, newRowId).
  check('the new row gets a UUID', uuidShaped(rows[2][0]), true);
  check('which is not the existing row id', rows[2][0] !== rows[1][0], true);
  check('one write for the batch', sheet.stats.setValuesCalls, 1);
  check("another member's row is untouched", rows[1], EXISTING);
}

console.log('\n--- a whole batch costs one write ---');
{
  const sheet = makeSheet(HEADERS, []);
  const { api, ss } = makeApi(sheet, templates);
  const result = api.setAvailabilityRows(
    ss,
    'u1',
    [slot('t1', '2026-09-07'), slot('t1', '2026-09-14'), slot('t2', '2026-09-14')],
    []
  );
  check('all three added', result.added, 3);
  check('still a single setValues call', sheet.stats.setValuesCalls, 1);
  check('three rows written', sheet.stats.writtenRows, 3);
  // rows() includes the header, so the data rows start at index 1.
  const batchIds = sheet.rows().slice(1).map((r) => r[0]);
  check('every new row gets its own UUID', batchIds.every((id) => uuidShaped(id)), true);
  check('and no two are alike', new Set(batchIds).size, 3);
  check('the second template keeps its own assignment', sheet.rows()[3][5], 'a2');
  check('and its apparatus link', sheet.rows()[3][4], 'E1');
}

console.log('\n--- the same slot twice is still one row ---');
{
  const sheet = makeSheet(HEADERS, []);
  const { api, ss } = makeApi(sheet, templates);
  api.setAvailabilityRows(ss, 'u1', [slot('t1', '2026-09-07'), slot('t1', '2026-09-07')], []);
  check('duplicates inside one batch collapse', sheet.rows().length - 1, 1);

  // ...and re-adding what is already marked must not duplicate it either.
  const second = api.setAvailabilityRows(ss, 'u1', [slot('t1', '2026-09-07')], []);
  check('re-adding is idempotent', second.added, 1);
  check('so the row count is unchanged', sheet.rows().length - 1, 1);
  // The row is deleted and re-added, so it carries a NEW id rather than the freed one - which is the point:
  // nothing can be holding a reference to the old id and silently get this row instead.
  check('and the row carries a fresh UUID', uuidShaped(sheet.rows()[1][0]), true);
  check('not the id the deleted row had', sheet.rows()[1][0] === EXISTING[0], false);
  check('after clearing the old row first', second.cleared, 1);
}

console.log('\n--- removing ---');
{
  const sheet = makeSheet(HEADERS, []);
  const { api, ss } = makeApi(sheet, templates);
  api.setAvailabilityRows(ss, 'u1', [slot('t1', '2026-09-07'), slot('t2', '2026-09-07')], []);
  const result = api.setAvailabilityRows(ss, 'u1', [], [slot('t1', '2026-09-07')]);
  check('the removal is reported', [result.ok, result.cleared], [true, 1]);
  check('only the other slot is left', sheet.rows().slice(1).map((r) => r[1]), ['t2']);

  const noop = api.setAvailabilityRows(ss, 'u1', [], [slot('t1', '2026-09-21')]);
  check('removing something that was never there is a no-op', [noop.ok, noop.cleared], [true, 0]);
  check('and touches nothing', sheet.rows().length - 1, 1);
}

console.log('\n--- a wrong date must not match ---');
{
  const sheet = makeSheet(HEADERS, []);
  const { api, ss } = makeApi(sheet, templates);
  api.setAvailabilityRows(ss, 'u1', [slot('t1', '2026-09-07')], []);
  const result = api.setAvailabilityRows(ss, 'u1', [], [slot('t1', '2026-09-08')]);
  check('a neighbouring date does not delete it', [result.cleared, sheet.rows().length - 1], [0, 1]);
}

console.log('\n--- other members are never touched ---');
{
  const sheet = makeSheet(HEADERS, []);
  const { api, ss } = makeApi(sheet, templates);
  api.setAvailabilityRows(ss, 'u1', [slot('t1', '2026-09-07')], []);
  api.setAvailabilityRows(ss, 'u2', [slot('t1', '2026-09-07')], []);
  check('the same slot for two members is two rows', sheet.rows().length - 1, 2);
  const result = api.setAvailabilityRows(ss, 'u1', [], [slot('t1', '2026-09-07')]);
  check('removing one leaves the other', sheet.rows().slice(1).map((r) => r[6]), ['u2']);
  check('and reports one removal', result.cleared, 1);
}

console.log('\n--- unusable input is skipped, not fatal ---');
{
  const sheet = makeSheet(HEADERS, []);
  const { api, ss } = makeApi(sheet, templates);
  const result = api.setAvailabilityRows(
    ss,
    'u1',
    [
      { schedule_template_id: 't1' }, // no date
      { date_from: '2026-09-07' }, // no template
      { schedule_template_id: '', date_from: '' },
      slot('t1', '2026-09-07'), // the only usable one
      slot('t-ghost', '2026-09-07'), // template that no longer exists
      null,
    ],
    'not-an-array'
  );
  check('one usable slot was written', result.added, 1);
  check('the missing template is counted as skipped', result.skipped, 1);
  check('and the sheet holds only that row', sheet.rows().length - 1, 1);
  check('a non-array removes list is safe', result.ok, true);
}

console.log('\n--- refusals ---');
{
  const sheet = makeSheet(HEADERS, []);
  const { api, ss } = makeApi(sheet, templates);
  check('no member', api.setAvailabilityRows(ss, '', [slot('t1', '2026-09-07')], []).ok, false);
  check('and nothing was written', sheet.rows().length, 1);

  const wrongHeaders = makeSheet(['id', 'day_of_week', 'start_time'], []);
  const wrong = makeApi(wrongHeaders, templates);
  const bad = wrong.api.setAvailabilityRows(wrong.ss, 'u1', [slot('t1', '2026-09-07')], []);
  check('a sheet without the right columns is refused', bad.ok, false);
  check('with an explanation', typeof bad.message === 'string' && bad.message.includes('date_from'), true);
  check('and no write attempted', wrongHeaders.stats.setValuesCalls, 0);

  const missing = makeApi(null, templates);
  check(
    'a missing sheet is refused',
    missing.api.setAvailabilityRows({ getSheetByName: () => null }, 'u1', [], []).ok,
    false
  );
}

console.log('\n--- header order is respected (the reason for mapping by name) ---');
{
  // Same columns, shuffled - as a hand edit could leave them.
  const shuffled = [
    'user_id',
    'date_from',
    'assignment_id',
    'id',
    'schedule_template_id',
    'date_to',
    'apparatus_id',
  ];
  const sheet = makeSheet(shuffled, []);
  const { api, ss } = makeApi(sheet, templates);
  api.setAvailabilityRows(ss, 'u1', [slot('t1', '2026-09-07')], []);
  const row = sheet.rows()[1];
  check('user_id still lands under user_id', row[0], 'u1');
  check('date_from under date_from', row[1], '2026-09-07');
  check('assignment under assignment_id', row[2], 'a1');
  check('id under id', uuidShaped(row[3]), true);
  check('template under schedule_template_id', row[4], 't1');
  check('date_to under date_to', row[5], '2026-09-07');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

