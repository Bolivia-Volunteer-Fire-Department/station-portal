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
// The real rule the app applies to an UNAUTHORIZED reply, imported rather than re-implemented.
import { unauthorizedIsStale } from '../src/utils/sessionTimeout.js';

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
    ${extract('userNameToIdIndex')}
    ${extract('planIdReferences')}
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

console.log('\n--- what it refuses, and what it leaves alone ---');
// Two rows with one id: half the references would end up on the wrong row, whichever way it resolved them.
// This is AMBIGUITY, and it is the thing the run refuses.
const duplicate = migrationHarness({
  users: [['id', 'name'], [10, 'Matt'], [10, 'Impostor']],
});
const duplicatePlan = duplicate.helpers.planIdMigration(duplicate.ss);
check('a duplicate id is reported', duplicatePlan.problems.some((p) => /appears more than once/.test(p)), true);
check('and nothing is written', duplicate.ss.sheets.users.writes, 0);

// A reference that names nothing. This is NOT a refusal: it is history the migration cannot reconstruct - a
// deleted member, a legacy free-text value - so the run proceeds and leaves it exactly as it was.
const dangling = migrationHarness({
  users: [['id', 'name'], [10, 'Matt']],
  schedule: [['id', 'user_id'], [500, 999]],
});
const danglingPlan = dangling.helpers.planIdMigration(dangling.ss);
check('a reference that names nothing is not a blocking problem', danglingPlan.problems, []);
check('it is reported as left alone', danglingPlan.legacyValues.some((entry) => /row 2/.test(entry)), true);
check('the run still applies', dangling.helpers.migrateIdsToUuids({ dryRun: false }).ok, true);
check('and the value is left exactly as it was, not erased', dangling.ss.sheets.schedule.rows[1][1], 999);
check('while the id itself migrated', dangling.helpers.isUuidValue(dangling.ss.sheets.schedule.rows[1][0]), true);

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
// 4c. A reply from a superseded session
// ---------------------------------------------------------------------------
console.log('\n--- a reply for a session we are not holding ---');
// Every background refresh opens the "verify your username and password" prompt when its reply says
// UNAUTHORIZED. A reply that belongs to a DIFFERENT token than the one the app holds is obsolete - which is how a
// freshly signed-in member was asked to sign in again after the id migration invalidated every live session.
check('a reply for the token we hold is NOT stale', unauthorizedIsStale('token-a', 'token-a'), false);
check('a reply for an older token IS stale', unauthorizedIsStale('token-old', 'token-new'), true);
check('a reply for a token we no longer have at all is stale', unauthorizedIsStale('token-old', null), true);
check('a reply with no token is stale once we hold one', unauthorizedIsStale('', 'token-a'), true);
check('and a token is compared as a string, not by identity', unauthorizedIsStale('t', 't'), false);
// The guard is the ONLY way the prompt opens, at every one of the reply sites. (The definition reads
// `const sessionExpired = (...) => {`, so it is not counted here - every match is a call.)
const appSource = readFileSync('src/App.jsx', 'utf8');
const unauthorizedSites = (appSource.match(/code === 'UNAUTHORIZED'/g) || []).length;
const guardUses = (appSource.match(/sessionExpired\(/g) || []).length;
// Eight reply sites now: the sign-in payloads are one request each, so the six refreshers they replaced (and the
// two granular admin fetchers) are gone. What is asserted is unchanged - the two counts must match.
check('every UNAUTHORIZED reply goes through the guard', [unauthorizedSites, guardUses], [8, 8]);
check('and nothing opens the prompt directly', /queueReauth\(null\)/.test(appSource), false);
check('the guard compares against the token ref, not state', /unauthorizedIsStale\(usedToken, tokenRef\.current\)/.test(appSource), true);
// Order matters, not adjacency - the session-start stamp sits between them. The ref has to be written first, or a
// request started in the same tick as a sign-in would compare against the token it is replacing.
const refWriteAt = appSource.indexOf('tokenRef.current = token;');
const stateWriteAt = appSource.indexOf('setAuthToken(token);');
checkIs(
  'the ref is written before the state, so a same-tick request sees the new token',
  refWriteAt !== -1 && stateWriteAt !== -1 && refWriteAt < stateWriteAt,
  `ref at ${refWriteAt}, state at ${stateWriteAt}`
);
check('and every token change goes through applyToken', (appSource.match(/setAuthToken\(/g) || []).length, 1);

// The prompt has to explain itself: a bare "your session has expired" is indistinguishable from a session that
// was refused for some other reason, which is what made this take three rounds to diagnose.
checkIs(
  'the refusal records which request was refused and which token',
  /setReauthReason\(\{\s*\n\s*action: \(reply && reply\.requestAction\)/.test(appSource)
);
checkIs('and the api attaches the action to a refused reply', /data\.requestAction = body\.action;/.test(apiSource));
checkIs('and logs it for the console', /\[reauth\] \$\{body\.action\} was refused/.test(apiSource));
checkIs(
  'the modal shows the reason',
  /reason=\{reauthReason\}/.test(appSource) && /reasonText/.test(readFileSync('src/components/ReauthModal.jsx', 'utf8'))
);
checkIs('and the reason is cleared when the prompt closes', (appSource.match(/setReauthReason\(null\)/g) || []).length, 3);


// ---------------------------------------------------------------------------
// 4b. The legacy usernames in system_log
// ---------------------------------------------------------------------------
console.log('\n--- a username where an id should be ---');
// These are rows from an earlier version of the app that recorded the member's user_name in `user_id`. They
// name a real member, so they resolve to that member and carry through to their new id.
const legacyNames = migrationHarness({
  users: [['id', 'name', 'user_name'], [10, 'Matt Wills', 'mwills'], [11, 'Ana', 'ana']],
  system_log: [
    ['id', 'timestamp', 'user_id', 'action'],
    [1, '2026-01-01 08:00:00', 'mwills', 'CLOCK_IN'],
    [2, '2026-01-01 09:00:00', 'MWILLS', 'CLOCK_IN'],
    [3, '2026-01-01 10:00:00', 'Unknown', 'CLOCK_IN'],
    [4, '2026-01-01 11:00:00', 'crave', 'CLOCK_IN'],
    [5, '2026-01-01 12:00:00', 'ana', 'CLOCK_IN'],
  ],
  system_settings: [['key', 'value'], ['department_name', 'Test Fire']],
});
const legacyPlan = legacyNames.helpers.planIdMigration(legacyNames.ss);
check('a username is not a blocking problem', legacyPlan.problems, []);
check('it is resolved to the member', legacyPlan.resolvedNames.map((entry) => entry.replace(/^.*-> /, '')), [
  'Matt Wills',
  'Matt Wills',
  'Ana',
]);
// Matched case-insensitively: a legacy log holds both spellings of the same name.
check('including the upper-case spelling', legacyPlan.resolvedNames.filter((entry) => /"MWILLS"/.test(entry)).length, 1);
check('and a name nobody has any more is left alone', legacyPlan.legacyValues.map((entry) => /"([^"]+)"$/.exec(entry)[1]), [
  'Unknown',
  'crave',
]);

const legacyRun = legacyNames.helpers.migrateIdsToUuids({ dryRun: false });
check('the run applies', legacyRun.ok, true);
const legacyLog = legacyNames.ss.sheets.system_log;
const legacyMattId = cell(legacyNames.ss.sheets.users, 1, 'id');
const legacyAnaId = cell(legacyNames.ss.sheets.users, 2, 'id');
check('the log now names the member by id', [cell(legacyLog, 1, 'user_id'), cell(legacyLog, 2, 'user_id')], [legacyMattId, legacyMattId]);
check('and the other member too', cell(legacyLog, 5, 'user_id'), legacyAnaId);
check('a value that names nobody is untouched', [cell(legacyLog, 3, 'user_id'), cell(legacyLog, 4, 'user_id')], ['Unknown', 'crave']);
check('the log ids stay numeric', [cell(legacyLog, 1, 'id'), cell(legacyLog, 5, 'id')], [1, 5]);
check('and the run reports both kinds', [legacyRun.resolvedNameCount, legacyRun.legacyValueCount], [3, 2]);

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

// ---------------------------------------------------------------------------
// 6. A session survives being used, over and over
// ---------------------------------------------------------------------------
// The round trip the client actually makes, which the first version of the epoch work broke: the FIRST
// authenticated request rewrote the record for its sliding expiry and dropped the epoch, so the SECOND request
// compared "" against the member's real epoch - refused, and deleted the session. Two requests, and a member is
// asked to sign in again seconds after signing in.
console.log('\n--- a session survives repeated use ---');
const roundTrip = migrationHarness(stationFixture());
const authHelpers = (() => {
  const store = {};
  const props = {
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
  };
  const users = [{ id: 'user-1', user_name: 'mwills', role_id: 'role-1' }];
  const ss = { getSheetByName: () => null };
  const api = new Function('PropertiesService', 'Logger', 'getSheetData', 'Utilities', `
    ${constSource('SESSION_PROPERTY_PREFIX')}
    ${constSource('SESSION_EPOCH_PREFIX')}
    ${constSource('DEFAULT_SESSION_TTL_MINUTES')}
    ${extract('sessionEpochState')}
    ${extract('sessionEpochFor')}
    ${extract('bumpSessionEpoch')}
    ${extract('sessionRecordValue')}
    ${extract('parseSessionRecord')}
    ${extract('createSession')}
    ${extract('sessionTtlMs')}
    ${extract('parseSessionTimeoutMinutes')}
    ${extract('systemSettingsMap')}
    ${extract('getAuthContext')}
    return { createSession, getAuthContext, bumpSessionEpoch, SESSION_PROPERTY_PREFIX };
  `)(
    props,
    { log: (text) => store.__logs ? store.__logs.push(text) : (store.__logs = [text]) },
    () => users,
    { getUuid: () => 'token-round-trip' }
  );
  return { api, store, users };
})();

// A member who has been revoked at some point - which, after the migration, is everybody.
authHelpers.api.bumpSessionEpoch('user-1');
const roundTripToken = authHelpers.api.createSession('user-1', {
  getSheetByName: () => ({ getDataRange: () => ({ getValues: () => [['key', 'value']] }) }),
});
check('the session was created', typeof roundTripToken, 'string');
const afterCreate = authHelpers.store[authHelpers.api.SESSION_PROPERTY_PREFIX + roundTripToken];
check('and carries the member epoch', afterCreate.split('|')[3], authHelpers.store['fc_epoch_user-1']);

const first = authHelpers.api.getAuthContext(authHelpers.ssPlaceholder || {}, { token: roundTripToken });
check('the first request is accepted', !!first, true);
const afterFirst = authHelpers.store[authHelpers.api.SESSION_PROPERTY_PREFIX + roundTripToken];
check('and the epoch is still in the record', afterFirst.split('|')[3] !== '', true);

const second = authHelpers.api.getAuthContext({}, { token: roundTripToken });
check('the second request is accepted too', !!second, true);
const third = authHelpers.api.getAuthContext({}, { token: roundTripToken });
check('and so is the tenth', !!third, true);
for (let i = 0; i < 7; i++) authHelpers.api.getAuthContext({}, { token: roundTripToken });
check('after ten requests the session is still alive', authHelpers.store[authHelpers.api.SESSION_PROPERTY_PREFIX + roundTripToken] !== undefined, true);
check('and still carries its epoch', authHelpers.store[authHelpers.api.SESSION_PROPERTY_PREFIX + roundTripToken].split('|')[3] === authHelpers.store['fc_epoch_user-1'], true);

// A genuine revocation still refuses, and still deletes: the fix must not have disabled the check.
// (The epoch is a millisecond timestamp, so this writes the new one directly rather than spinning until
// Date.now() moves, which would be a race in a fast test.)
const epochBefore = authHelpers.store['fc_epoch_user-1'];
authHelpers.store['fc_epoch_user-1'] = 'revoked-later';
check('the epoch moved on', authHelpers.store['fc_epoch_user-1'] !== epochBefore, true);
check('a later revocation refuses the session', authHelpers.api.getAuthContext({}, { token: roundTripToken }), null);
check('and the record is gone', authHelpers.store[authHelpers.api.SESSION_PROPERTY_PREFIX + roundTripToken], undefined);

// An epoch that cannot be READ must not sign anybody out: a revocation check that cannot be performed is not
// evidence of revocation, and the old code's "" made it look like one.
const brokenStore = (() => {
  const state = { props: {}, throwOnEpoch: true };
  const props = {
    getScriptProperties: () => ({
      getProperty: (k) => {
        if (state.throwOnEpoch && k.indexOf('fc_epoch_') === 0) throw new Error('properties unavailable');
        return Object.prototype.hasOwnProperty.call(state.props, k) ? state.props[k] : null;
      },
      setProperty: (k, v) => {
        state.props[k] = String(v);
      },
      deleteProperty: (k) => {
        delete state.props[k];
      },
      getKeys: () => Object.keys(state.props),
    }),
  };
  return { state, props };
})();
const unavailableEpoch = new Function('PropertiesService', 'Logger', 'getSheetData', 'Utilities', `
  ${constSource('SESSION_PROPERTY_PREFIX')}
  ${constSource('SESSION_EPOCH_PREFIX')}
  ${constSource('DEFAULT_SESSION_TTL_MINUTES')}
  ${extract('sessionEpochState')}
  ${extract('sessionEpochFor')}
  ${extract('bumpSessionEpoch')}
  ${extract('sessionRecordValue')}
  ${extract('parseSessionRecord')}
  ${extract('sessionTtlMs')}
  ${extract('parseSessionTimeoutMinutes')}
  ${extract('systemSettingsMap')}
  ${extract('getAuthContext')}
  return { getAuthContext, SESSION_PROPERTY_PREFIX };
`)(
  brokenStore.props,
  { log: () => {} },
  () => [{ id: 'user-1', user_name: 'mwills' }],
  { getUuid: () => 'token-x' }
);
brokenStore.state.props['fc_auth_token-x'] = 'user-1|' + (Date.now() + 60000) + '|60000|an-epoch';
check(
  'an unreadable revocation epoch does NOT sign the member out',
  !!unavailableEpoch.getAuthContext({}, { token: 'token-x' }),
  true
);
check('and the session is not deleted for it', brokenStore.state.props['fc_auth_token-x'] !== undefined, true);

// A session written BEFORE the migration carries the member's OLD id and an empty epoch. Checking only the epoch
// deleted nothing (empty equals empty), so those records lingered as properties and the report claimed a sweep
// that had not happened. The member id is what identifies them.
const legacyRun2 = migrationHarness(stationFixture());
legacyRun2.store['fc_auth_old1'] = '10|9999999999999|1000|';
legacyRun2.store['fc_auth_old2'] = '11|9999999999999|1000|';
legacyRun2.store['fc_epoch_10'] = '';
const sweepResult = (() => {
  const props = {
    getScriptProperties: () => ({
      getProperty: (k) => (Object.prototype.hasOwnProperty.call(legacyRun2.store, k) ? legacyRun2.store[k] : null),
      setProperty: (k, v) => {
        legacyRun2.store[k] = String(v);
      },
      deleteProperty: (k) => {
        delete legacyRun2.store[k];
      },
      getKeys: () => Object.keys(legacyRun2.store),
    }),
  };
  const run = new Function('PropertiesService', 'getSheetData', `
    ${constSource('SESSION_PROPERTY_PREFIX')}
    ${constSource('SESSION_EPOCH_PREFIX')}
    ${extract('sessionEpochFor')}
    ${extract('bumpSessionEpoch')}
    ${extract('parseSessionRecord')}
    ${extract('resetSessionsForIdMigration')}
    return resetSessionsForIdMigration;
  `)(props, () => [{ id: 'new-uuid-1' }, { id: 'new-uuid-2' }]);
  return run(legacyRun2.ss);
})();
check('it reports the sessions it cleared', sweepResult.sessionsCleared, 2);
check('a session for an id that no longer exists is gone', ['fc_auth_old1', 'fc_auth_old2'].filter((k) => k in legacyRun2.store), []);
check('and the members are re-signed-out', sweepResult.usersBumped, 2);
check('with a fresh epoch recorded for each', Object.keys(legacyRun2.store).filter((k) => k.indexOf('fc_epoch_') === 0).length, 2);
// An epoch for a member id that no longer exists can never be matched again, so it is cleaned up too.
check('and the old id leaves no epoch behind', 'fc_epoch_10' in legacyRun2.store, false);

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

// ---------------------------------------------------------------------------
// 8. The editor entry points
// ---------------------------------------------------------------------------
console.log('\n--- the two things you can actually run ---');
// The Apps Script toolbar passes no arguments, so both halves have to be zero-argument functions or the
// instructions amount to "run it from the editor" with no way to run the applying half.
checkIs('a dry-run runner exists', /function checkIdMigration\(\) \{\s*return migrateIdsToUuids\(\{ dryRun: true \}\);\s*\}/.test(codeSource));
checkIs('an applying runner exists', /function applyIdMigration\(\) \{\s*return migrateIdsToUuids\(\{ dryRun: false \}\);\s*\}/.test(codeSource));
// ...and they have to be TOP-LEVEL, or the dropdown will not list them however plainly they appear in the
// pasted file. That is not hypothetical: the first version of this put them inside another function, and the
// only symptom was "I don't see either in the function dropdown". Brace depth, ignoring comments and strings.
const declarationDepth = (name) => {
  const lines = codeSource.split('\n');
  let depth = 0;
  let quote = null;
  let inLine = false;
  let inBlock = false;
  let found = null;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (new RegExp(`^function\\s+${name}\\s*\\(`).test(line.trim()) && found === null) found = depth;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const next = line[i + 1];
      if (inLine) break;
      if (inBlock) {
        if (ch === '*' && next === '/') {
          inBlock = false;
          i++;
        }
        continue;
      }
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '/' && next === '/') {
        inLine = true;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlock = true;
        i++;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    inLine = false;
  }

  return found;
};

['checkIdMigration', 'applyIdMigration', 'migrateIdsToUuids'].forEach((name) => {
  check(`${name} is declared at the top level (so the dropdown lists it)`, declarationDepth(name), 0);
});
check(
  'and the applying runner is the only thing that returns dryRun: false',
  // Counted as a statement, not as text: the dry run's message quotes the same call to tell the operator what to
  // do next, and that mention is not a second entry point.
  (codeSource.match(/return migrateIdsToUuids\(\{ dryRun: false \}\);/g) || []).length,
  1
);
// The runners are callable: run them against the fake station, as the editor would.
const runnerStation = migrationHarness(stationFixture());
const runnerCode = new Function('migrateIdsToUuids', `
  ${extract('checkIdMigration')}
  ${extract('applyIdMigration')}
  return { checkIdMigration, applyIdMigration };
`)(runnerStation.helpers.migrateIdsToUuids);
check('the dry runner reports and writes nothing', [runnerCode.checkIdMigration().dryRun, runnerStation.ss.sheets.users.writes], [true, 0]);
check('and the applying runner applies', runnerCode.applyIdMigration().ok, true);
check('with the ids actually changed', runnerStation.ss.sheets.users.rows[1][0] !== 10, true);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
