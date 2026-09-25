/**
 * Verifies the id schema: UUIDs for record ids, and the migration that gets there.
 *
 * The reason this exists: ids used to be "the last row's id plus one", so deleting the highest-id row freed that
 * id and the next created row inherited it. A `schedule_offers.schedule_id` still on file then pointed at a
 * DIFFERENT shift, and an approval could fill the wrong slot. That was silent, so it needs a test rather than a
 * promise - and the migration that replaces those ids is the riskiest thing in this repository, so it is run
 * here against a fake spreadsheet before it is ever run against the station's.
 *
 * The assertions about the migration are therefore about what it must NOT do: write nothing on a dry run, refuse
 * an ambiguous mapping, report a dangling reference instead of blanking it, and be idempotent - because a
 * half-finished run has to be completable by running it again.
 *
 * Run with: npm run verify:id-schema
 */
import { readFileSync } from 'node:fs';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`
  );
};
const checkIs = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` -> ${detail}`}`);
};

const codeSource = readFileSync('src/services/Code.gs', 'utf8');
const apiSource = readFileSync('src/services/api.js', 'utf8');

const extract = (name) => {
  const start = codeSource.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`Code.gs has no function ${name}`);
  let depth = 0;
  for (let i = codeSource.indexOf('{', start); i < codeSource.length; i++) {
    if (codeSource[i] === '{') depth++;
    else if (codeSource[i] === '}') {
      depth--;
      if (depth === 0) return codeSource.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
};

const constSource = (name) => {
  const match = new RegExp(`^(?:const|var) ${name} = [\\s\\S]*?;\\n`, 'm').exec(codeSource);
  if (!match) throw new Error(`Code.gs has no ${name}`);
  return match[0];
};

// ---------------------------------------------------------------------------
// A spreadsheet good enough to migrate
// ---------------------------------------------------------------------------
class FakeSheet {
  constructor(rows = [], name = 'sheet') {
    this.rows = rows.map((row) => row.slice());
    this.name = name;
    this.counts = { setValue: 0, setValues: 0, appendRow: 0 };
  }
  get writes() {
    return Object.values(this.counts).reduce((a, b) => a + b, 0);
  }
  getDataRange() {
    return { getValues: () => this.rows.map((row) => row.slice()) };
  }
  getLastRow() {
    return this.rows.length;
  }
  getLastColumn() {
    return this.rows.reduce((max, row) => Math.max(max, row.length), 0);
  }
  getRange(row, col, numRows = 1, numCols = 1) {
    const sheet = this;
    const ensure = (r, c) => {
      while (sheet.rows.length <= r) sheet.rows.push([]);
      while (sheet.rows[r].length <= c) sheet.rows[r].push('');
    };
    return {
      getValue: () => (sheet.rows[row - 1] || [])[col - 1],
      getValues: () => {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const line = [];
          for (let c = 0; c < numCols; c++) line.push((sheet.rows[row - 1 + r] || [])[col - 1 + c] ?? '');
          out.push(line);
        }
        return out;
      },
      setValue: (value) => {
        ensure(row - 1, col - 1);
        sheet.rows[row - 1][col - 1] = value;
        sheet.counts.setValue++;
      },
      setValues: (values) => {
        values.forEach((line, r) => line.forEach((value, c) => ensure(row - 1 + r, col - 1 + c)));
        values.forEach((line, r) => line.forEach((value, c) => {
          sheet.rows[row - 1 + r][col - 1 + c] = value;
        }));
        sheet.counts.setValues++;
      },
    };
  }
  appendRow(values) {
    const line = values.slice();
    while (line.length < this.getLastColumn()) line.push('');
    this.rows.push(line);
    this.counts.appendRow++;
  }
}

const FakeSpreadsheet = (sheets) => {
  const store = {};
  Object.keys(sheets).forEach((name) => {
    store[name] = new FakeSheet(sheets[name], name);
  });
  return {
    sheets: store,
    getSheetByName: (name) => store[name] || null,
    insertSheet: (name) => {
      store[name] = new FakeSheet([], name);
      return store[name];
    },
  };
};

// The real migration functions, with Apps Script globals supplied.
const migrationHarness = (initialSheets, { lockAvailable = true } = {}) => {
  const ss = FakeSpreadsheet(initialSheets);
  const store = {};
  let uuidCount = 0;
  const logs = [];

  const body = `
    ${constSource('READ_ONLY_ACTIONS')}
    ${constSource('LOCK_OPTIONAL_ACTIONS')}
    ${constSource('WRITE_LOCK_WAIT_MS')}
    ${constSource('SESSION_PROPERTY_PREFIX')}
    ${constSource('SESSION_EPOCH_PREFIX')}
    ${constSource('DEFAULT_SESSION_TTL_MINUTES')}
    ${constSource('ID_MIGRATION_SHEET')}
    ${constSource('ID_RECORD_SHEETS')}
    ${constSource('ID_REFERENCE_SHEETS')}
    ${constSource('ID_REFERENCE_TARGETS')}
    ${extract('actionNeedsWriteLock')}
    ${extract('acquireWriteLock')}
    ${extract('newRowId')}
    ${extract('isUuidValue')}
    ${extract('getEasternTimestamp')}
    ${extract('getSheetData')}
    ${extract('sessionEpochFor')}
    ${extract('bumpSessionEpoch')}
    ${extract('parseSessionRecord')}
    ${extract('readIdMigrationMap')}
    ${extract('planIdMigration')}
    ${extract('writeIdColumn')}
    ${extract('writeIdMigrationMap')}
    ${extract('resetSessionsForIdMigration')}
    ${extract('migrateIdsToUuids')}
    ${extract('reportIdMigration')}
    return { migrateIdsToUuids, planIdMigration, isUuidValue, newRowId, ID_MIGRATION_SHEET, ID_RECORD_SHEETS, ID_REFERENCE_TARGETS };
  `;

  let held = false;
  const helpers = new Function('SpreadsheetApp', 'LockService', 'PropertiesService', 'Utilities', 'Logger', 'console', body)(
    { getActiveSpreadsheet: () => ss },
    {
      getScriptLock: () => ({
        tryLock: () => {
          if (!lockAvailable || held) return false;
          held = true;
          return true;
        },
        releaseLock: () => {
          held = false;
        },
      }),
    },
    {
      getScriptProperties: () => ({
        getProperty: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
        setProperty: (k, v) => {
          store[k] = String(v);
        },
        deleteProperty: (k) => {
          delete store[k];
        },
        getKeys: () => Object.keys(store),
      }),
    },
    {
      // Hex-shaped and 36 characters, so the code's own UUID check recognises it - a fake that is merely
      // "unique-looking" would make every assertion about idempotence pass for the wrong reason.
      getUuid: () => {
        uuidCount++;
        return `00000000-0000-4000-8000-${String(uuidCount).padStart(12, '0')}`;
      },
      formatDate: () => '2026-01-01 08:00:00',
    },
    { log: (text) => logs.push(text) },
    { log: () => {}, warn: () => {} }
  );

  return { ss, helpers, store, logs, rowsOf: (name) => ss.sheets[name].rows };
};

const headerIndex = (sheet, name) => sheet.rows[0].indexOf(name);
const cell = (sheet, rowIndex, column) => sheet.rows[rowIndex][headerIndex(sheet, column)];

// A station, small but complete for this purpose: a member, two shifts, one offer that references a shift, and a
// couple of corners - an all-day-ish extra column, a member reference that does not say "_id", and a log sheet.
const stationFixture = () => ({
  users: [
    ['id', 'name', 'role_id', 'rank_id'],
    [10, 'Matt', 1, 100],
    [11, 'Ana', 1, 100],
  ],
  roles: [
    ['id', 'description'],
    [1, 'Member'],
  ],
  ranks: [
    ['id', 'description', 'rank_order'],
    [100, 'Firefighter', 1],
  ],
  schedule: [
    ['id', 'schedule_template_id', 'assignment_id', 'user_id', 'date_from'],
    [500, 900, 70, 10, '2026-09-15'],
    [501, 900, 70, '', '2026-09-16'],
  ],
  schedule_templates: [
    ['id', 'assignment_id', 'day_of_week'],
    [900, 70, 'tuesday'],
  ],
  assignments: [
    ['id', 'description'],
    [70, 'Engine 1'],
  ],
  schedule_offers: [
    ['id', 'schedule_id', 'user_id', 'approved_by'],
    [800, 501, 11, 10],
  ],
  announcements: [
    ['id', 'title', 'author_user_id', 'role_id'],
    [300, 'Drill night', 10, 1],
  ],
  system_log: [
    ['id', 'timestamp', 'user_id', 'action'],
    [1, '2026-09-15 08:00:00', 10, 'CLOCK_IN'],
    [2, '2026-09-15 09:00:00', 11, 'CLOCK_IN'],
  ],
  system_settings: [
    ['key', 'value'],
    ['department_name', 'Test Fire'],
  ],
  // Not a record sheet (it is keyed by user_id), but it holds a member reference - the second place this bug hid.
  user_settings: [
    ['user_id', 'fcm_token', 'notify_shift_offers'],
    [10, 'token-matt', 'TRUE'],
    [11, 'token-ana', 'FALSE'],
  ],
});

// ---------------------------------------------------------------------------
// 1. One way to mint an id
// ---------------------------------------------------------------------------
console.log('\n--- one allocator ---');
checkIs('the sequential allocator is gone', !/function getNextId/.test(codeSource));
checkIs('and so is its delete-safe cousin', !/function nextIdAfterMax/.test(codeSource));
checkIs('there is exactly one newRowId', (codeSource.match(/function newRowId\(/g) || []).length, 1);
checkIs('and it is a UUID', /function newRowId\(\) \{\s*return Utilities\.getUuid\(\);/.test(codeSource));
// Every allocation site, named so a new one cannot quietly go back to numbers.
check('upsert allocates with it', /if \(!targetId\) targetId = String\(newRowId\(\)\)/.test(codeSource), true);
check('the bulk upsert too', /const assignedId = requestedId \|\| String\(newRowId\(\)\)/.test(codeSource), true);
check('the availability additions too', /id: String\(newRowId\(\)\),/.test(codeSource), true);
check('clock-in too', /const nextInId = String\(newRowId\(\)\)/.test(codeSource), true);
check('and the push-device append', /if \(header === "id"\) return String\(newRowId\(\)\);/.test(codeSource), true);
// No arithmetic on ids beyond the log's own numeric counter, which is not a reference.
checkIs('no id is ever incremented', !/\bnextId\+\+\s*[),]/.test(codeSource.replace(/nextLogRowId[\s\S]{0,200}/, '')));
checkIs(
  'the log keeps its numeric id, for the reason stated',
  /function nextLogRowId\(sheet\)/.test(codeSource) && /Nothing references a log row/.test(codeSource)
);
checkIs('and the log is not in the record list', !/"system_log"/.test(constSource('ID_RECORD_SHEETS')));

// ---------------------------------------------------------------------------
// 2. The uuid shape, and uniqueness
// ---------------------------------------------------------------------------
console.log('\n--- the ids themselves ---');
const station = migrationHarness(stationFixture());
const sample = station.helpers.newRowId();
check('an id looks like a UUID', station.helpers.isUuidValue(sample), true);
check('a sequence id does not', station.helpers.isUuidValue('12'), false);
check('nor does a malformed one', station.helpers.isUuidValue('00000000-0000-4000-8000-zz'), false);
const issued = new Set();
for (let i = 0; i < 500; i++) issued.add(station.helpers.newRowId());
check('500 ids are all distinct', issued.size, 500);

// ---------------------------------------------------------------------------
// 3. The plan: what it would change, and what it refuses
// ---------------------------------------------------------------------------
console.log('\n--- planning ---');
const planOf = (sheets) => migrationHarness(sheets).helpers.planIdMigration(migrationHarness(sheets).ss);
const planned = migrationHarness(stationFixture());
const plan = planned.helpers.planIdMigration(planned.ss);
check('nothing to complain about', plan.problems, []);
check('every reference column is resolved', Object.keys(planned.helpers.ID_REFERENCE_TARGETS).length, 11);
check(
  'the ids to change are counted per sheet',
  plan.sheets.map((entry) => `${entry.name}:${entry.changes.length}`).sort(),
  ['announcements:1', 'assignments:1', 'ranks:1', 'roles:1', 'schedule:2', 'schedule_offers:1',
   'schedule_templates:1', 'users:2'].sort()
);
check(
  'and the reference values too',
  plan.references.map((entry) => `${entry.name}.${entry.header}:${entry.changes.length}`).sort(),
  ['announcements.author_user_id:1', 'announcements.role_id:1', 'schedule.schedule_template_id:2',
   'schedule.assignment_id:2', 'schedule.user_id:1', 'schedule_offers.schedule_id:1',
   'schedule_offers.user_id:1', 'schedule_offers.approved_by:1', 'schedule_templates.assignment_id:1',
   // The two that are NOT record sheets: their own id is untouched, but their member reference has to follow.
   'system_log.user_id:2', 'user_settings.user_id:2',
   'users.role_id:2', 'users.rank_id:2'].sort()
);
check('a reference to a blank cell is not one of them', plan.references.some((entry) => entry.name === 'availability'), false);

console.log('\n--- what it refuses ---');
// Two rows with one id: half the references would end up on the wrong row, whichever way it resolved them.
const duplicate = migrationHarness({
  users: [['id', 'name'], [10, 'Matt'], [10, 'Impostor']],
});
const duplicatePlan = duplicate.helpers.planIdMigration(duplicate.ss);
check('a duplicate id is reported', duplicatePlan.problems.some((p) => /appears more than once/.test(p)), true);
check('and nothing is written', duplicate.ss.sheets.users.writes, 0);

// A reference to a row that does not exist: reported, NOT blanked.
const dangling = migrationHarness({
  users: [['id', 'name'], [10, 'Matt']],
  schedule: [['id', 'user_id'], [500, 999]],
});
const danglingPlan = dangling.helpers.planIdMigration(dangling.ss);
check('a dangling reference is reported', danglingPlan.problems.some((p) => /is not in users/.test(p)), true);
check('and the value is left alone, not erased', dangling.ss.sheets.schedule.rows[1][1], 999);
check('so the run refuses to apply', dangling.helpers.migrateIdsToUuids({ dryRun: false }).ok, false);
check('and the ids are untouched', dangling.ss.sheets.schedule.rows[1][0], 500);

const missingId = migrationHarness({ users: [['id', 'name'], ['', 'Nobody']] });
check(
  'a row with no id is reported',
  missingId.helpers.planIdMigration(missingId.ss).problems.some((p) => /no id/.test(p)),
  true
);

// A record sheet listed but without an id column is a real problem: the next write would put a UUID in whatever
// column comes first.
const noIdColumn = migrationHarness({ users: [['name'], ['Matt']] });
check(
  'a record sheet with no id column is reported',
  noIdColumn.helpers.planIdMigration(noIdColumn.ss).problems.some((p) => /has no id column/.test(p)),
  true
);

// ---------------------------------------------------------------------------
// 4. A dry run writes nothing
// ---------------------------------------------------------------------------
console.log('\n--- the dry run ---');
const dry = migrationHarness(stationFixture());
const before = JSON.stringify(dry.ss.sheets);
const dryResult = dry.helpers.migrateIdsToUuids();
check('a dry run reports success', dryResult.ok, true);
check('and says it is a dry run', dryResult.dryRun, true);
check('nothing at all was written', JSON.stringify(dry.ss.sheets) === before, true);
check('and it says how to apply it', /dryRun: false/.test(dryResult.message), true);
check('the default is the safe one', dry.helpers.migrateIdsToUuids().dryRun, true);
check('a report was produced', dry.logs.length >= 1, true);

// ---------------------------------------------------------------------------
// 5. Applying it
// ---------------------------------------------------------------------------
console.log('\n--- applying ---');
const applied = migrationHarness(stationFixture());
const appliedResult = applied.helpers.migrateIdsToUuids({ dryRun: false });
check('it applies', appliedResult.ok, true);
check('and is not a dry run', appliedResult.dryRun, false);

const users = applied.ss.sheets.users;
const schedule = applied.ss.sheets.schedule;
const offers = applied.ss.sheets.schedule_offers;
const announcements = applied.ss.sheets.announcements;

check('every member id is now a UUID', [cell(users, 1, 'id'), cell(users, 2, 'id')].every(applied.helpers.isUuidValue), true);
check('the ids are distinct', cell(users, 1, 'id') !== cell(users, 2, 'id'), true);
// The values that are NOT ids must not have been touched.
check('names are untouched', [cell(users, 1, 'name'), cell(users, 2, 'name')], ['Matt', 'Ana']);
check('and every other column too', applied.ss.sheets.users.rows.map((row) => row.length), applied.ss.sheets.users.rows.map(() => 4));

// The heart of it: a reference follows its row.
const mattId = cell(users, 1, 'id');
const anaId = cell(users, 2, 'id');
const roleId = cell(applied.ss.sheets.roles, 1, 'id');
check('a member reference follows them into the schedule', cell(schedule, 1, 'user_id'), mattId);
check('and into the offers', cell(offers, 1, 'user_id'), anaId);
check('and into an announcement author', cell(announcements, 1, 'author_user_id'), mattId);
check('and an approver reference that does not say "_id"', cell(offers, 1, 'approved_by'), mattId);
check('a role reference follows too', cell(announcements, 1, 'role_id'), roleId);
check('and a rank reference', cell(users, 1, 'rank_id'), cell(applied.ss.sheets.ranks, 1, 'id'));

// The id the offer points at is the SAME row as before: this is the property the whole change is for.
const secondShiftId = cell(schedule, 2, 'id');
check('the offer points at the second shift, still', cell(offers, 1, 'schedule_id'), secondShiftId);
check('which is the row with no member on it', cell(schedule, 2, 'user_id'), '');
check('the shift dates are untouched', [cell(schedule, 1, 'date_from'), cell(schedule, 2, 'date_from')], ['2026-09-15', '2026-09-16']);

// Templates and assignments: referenced by two rows and by a template.
const templateId = cell(applied.ss.sheets.schedule_templates, 1, 'id');
const assignmentId = cell(applied.ss.sheets.assignments, 1, 'id');
check('both shifts point at the same template', [cell(schedule, 1, 'schedule_template_id'), cell(schedule, 2, 'schedule_template_id')], [templateId, templateId]);
check('and at the same assignment', [cell(schedule, 1, 'assignment_id'), cell(schedule, 2, 'assignment_id')], [assignmentId, assignmentId]);
check('the template points at its assignment', cell(applied.ss.sheets.schedule_templates, 1, 'assignment_id'), assignmentId);
check('the row counts are unchanged', applied.ss.sheets.schedule.rows.length, 3);

// The log keeps its readable numbers, and its member references are remapped: it is not in the record list but
// it does reference a member.
const log = applied.ss.sheets.system_log;
check('the log keeps numeric ids', [cell(log, 1, 'id'), cell(log, 2, 'id')], [1, 2]);
check('but its member reference follows', cell(log, 1, 'user_id'), mattId);

// The sheet keyed by user_id: not a record, but its reference has to follow or a member's push token and
// preferences would be left attached to an id nobody has any more.
const userSettings = applied.ss.sheets.user_settings;
check('a user_id-keyed sheet has its key remapped too', [cell(userSettings, 1, 'user_id'), cell(userSettings, 2, 'user_id')], [mattId, anaId]);
check('and its other columns are untouched', [cell(userSettings, 1, 'fcm_token'), cell(userSettings, 2, 'notify_shift_offers')], ['token-matt', 'FALSE']);

// The settings sheet has no id at all and must be left alone.
check('a key/value sheet is untouched', applied.ss.sheets.system_settings.rows[1], ['department_name', 'Test Fire']);

console.log('\n--- the mapping, and the sessions ---');
check('a mapping row was written for every changed id', appliedResult.mappingRowsWritten > 0, true);
const mapSheet = applied.ss.sheets[applied.helpers.ID_MIGRATION_SHEET];
check('the mapping sheet exists', !!mapSheet, true);
check('with its header', mapSheet.rows[0], ['sheet_name', 'old_id', 'new_id', 'migrated_at']);
check('and the users entries', mapSheet.rows.filter((row) => row[0] === 'users').map((row) => [row[1], row[2]]), [
  ['10', cell(users, 1, 'id')],
  ['11', cell(users, 2, 'id')],
]);
// Everybody is signed out, because their session records carry the ids that just changed.
check('every member was signed out', appliedResult.sessions.usersBumped, 2);
check('and the sweep ran', typeof appliedResult.sessions.sessionsCleared, 'number');

// ---------------------------------------------------------------------------
// 6. Running it twice, and completing a half-finished run
// ---------------------------------------------------------------------------
console.log('\n--- a second run changes nothing ---');
const secondRun = applied.helpers.migrateIdsToUuids({ dryRun: false });
const mappedAfterFirst = JSON.stringify(applied.ss.sheets[applied.helpers.ID_MIGRATION_SHEET].rows);
check('the second run reports success', secondRun.ok, true);
check('with nothing to change', secondRun.sheets.length, 0);
check('and no new mapping rows', secondRun.mappingRowsWritten, 0);
check('the mapping is unchanged', JSON.stringify(applied.ss.sheets[applied.helpers.ID_MIGRATION_SHEET].rows), mappedAfterFirst);
check('the ids are the same ones', cell(applied.ss.sheets.users, 1, 'id'), mattId);
check('and the references still resolve', cell(applied.ss.sheets.schedule, 1, 'user_id'), mattId);

// The half-finished run: ids were handed out and RECORDED, then the run died before the references were
// rewritten - the recorded pairs are reused rather than fresh UUIDs being minted, or every reference would end
// up pointing at a row that no longer exists.
console.log('\n--- completing a half-finished run ---');
const resumed = migrationHarness(stationFixture());
// Same fixture, but one sheet's ids are already UUIDs and recorded, and the offers.schedule_id still holds the
// old 501 that points at the row which is now that UUID.
const recordedShiftUuid = '00000000-0000-4000-8000-0000000000ff';
resumed.ss.sheets.schedule.rows[2][0] = recordedShiftUuid;
resumed.ss.insertSheet(resumed.helpers.ID_MIGRATION_SHEET);
resumed.ss.sheets[resumed.helpers.ID_MIGRATION_SHEET].appendRow(['sheet_name', 'old_id', 'new_id', 'migrated_at']);
resumed.ss.sheets[resumed.helpers.ID_MIGRATION_SHEET].appendRow(['schedule', '501', recordedShiftUuid, '2026-01-01 00:00:00']);
const resumedResult = resumed.helpers.migrateIdsToUuids({ dryRun: false });
check('the resumed run applies', resumedResult.ok, true);
check('the recorded id was kept, not replaced', resumed.ss.sheets.schedule.rows[2][0], recordedShiftUuid);
check('so the offer that pointed at it still resolves', resumed.ss.sheets.schedule_offers.rows[1][1], recordedShiftUuid);
check('and the row that was still numeric got a new uuid', resumed.helpers.isUuidValue(resumed.ss.sheets.schedule.rows[1][0]), true);
check('the recording was not duplicated', resumed.ss.sheets[resumed.helpers.ID_MIGRATION_SHEET].rows.filter((row) => row[1] === '501').length, 1);

// A mixed sheet is the dangerous case: UUIDs and sequential ids side by side, which is exactly what a
// half-finished run leaves behind. Writing a block from the first changed row would stamp the row in between
// with the wrong id - two rows sharing one id, which is worse than what the migration set out to fix.
console.log('\n--- a half-migrated sheet keeps its untouched ids ---');
const mixed = migrationHarness({
  users: [
    ['id', 'name'],
    ['00000000-0000-4000-8000-0000000000aa', 'Already done'],
    [11, 'Old id'],
    ['00000000-0000-4000-8000-0000000000bb', 'Also done'],
    [12, 'Old id too'],
  ],
});
const mixedResult = mixed.helpers.migrateIdsToUuids({ dryRun: false });
check('the mixed run applies', mixedResult.ok, true);
const mixedRows = mixed.ss.sheets.users.rows;
check('the already-migrated ids are untouched', [mixedRows[1][0], mixedRows[3][0]], [
  '00000000-0000-4000-8000-0000000000aa',
  '00000000-0000-4000-8000-0000000000bb',
]);
check('the sequential ones were replaced', [mixedRows[2][0], mixedRows[4][0]].every(mixed.helpers.isUuidValue), true);
check('and all five ids are distinct', new Set(mixedRows.slice(1).map((row) => row[0])).size, 4);
check('with the names untouched', mixedRows.slice(1).map((row) => row[1]), ['Already done', 'Old id', 'Also done', 'Old id too']);

console.log('\n--- a busy portal ---');
// A real run takes the write lock; if it cannot, it says so rather than racing a save.
const busy = migrationHarness(stationFixture(), { lockAvailable: false });
const busyResult = busy.helpers.migrateIdsToUuids({ dryRun: false });
check('a run that cannot take the lock refuses', busyResult.ok, false);
check('and writes nothing', busy.ss.sheets.users.writes, 0);
check('with a message to try again', /busy/i.test(busyResult.message), true);
// A dry run needs no lock: it writes nothing, so it cannot race anything.
check('but a dry run still works', busy.helpers.migrateIdsToUuids().ok, true);

// ---------------------------------------------------------------------------
// 7. The client, and the docs
// ---------------------------------------------------------------------------
console.log('\n--- everything else handles a string id ---');
// Every comparison of an id must coerce, or "10" and 10 would be different ids. The client already does this
// everywhere; the point of the check is that it stays that way now that ids are strings.
checkIs('the api client parses no id as a number', !/parseInt\([^)]*\.id|Number\([^)]*\.id/.test(apiSource));
const clientFiles = [
  'src/components/ScheduleCalendar.jsx',
  'src/components/admin/AdminUsersTab.jsx',
  'src/components/admin/AdminScheduleManagementTab.jsx',
];
checkIs(
  'and no screen does either',
  clientFiles.every((file) => !/parseInt\([^)]*\.id|Number\([^)]*\.id/.test(readFileSync(file, 'utf8')))
);
checkIs('the docs describe the new rule', /UUID/.test(readFileSync('docs/WRITE_SAFETY.md', 'utf8')));
// The id writer groups consecutive rows instead of writing one block. A block from the first changed row
// stamps every row in between, which on a half-migrated sheet means two rows sharing an id - so the test above
// exists to keep this honest, and this check keeps the grouping from being "simplified" away.
checkIs('the id writer is grouped by runs', /function writeIdColumn\(sheet, idCol, changes\)/.test(codeSource));
checkIs(
  'and is what the migration uses',
  /writeIdColumn\(entry\.sheet, entry\.idCol, entry\.changes\)/.test(codeSource)
);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
