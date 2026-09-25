/**
 * Verifies the write-safety rules in Code.gs and services/api.js.
 *
 * The bug this file exists for could not be seen from the UI: a write that could not take the script lock ran
 * ANYWAY, unlocked - `locked` was only consulted to decide whether to release it. Two overlapping writers can
 * lose one of the two updates, and nothing in
 * the app reported it. The gate now REFUSES that write instead, which is only worth anything if the refusal
 * touches nothing at all.
 *
 * So the assertions below are about writing nothing, not about the failure message:
 *
 *   * a refused write must leave the fake sheet byte-identical (no cell, no log row, no session);
 *   * a read must still take no lock at all, or the refresh wave regresses;
 *   * the two timeclock halves must produce ONE write each, addressed by header name rather than position.
 *
 * The real backend functions are extracted out of Code.gs and run here against a fake sheet and a lock that
 * can be made to fail, so this exercises the code that ships rather than a description of it - the same
 * approach as verify-push-devices.mjs and verify-auth-security.mjs. Run with: npm run verify:write-safety
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`
  );
};
// For a plain yes/no read off the source, where there is no "actual" to print.
const checkIs = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` -> ${detail}`}`);
};

const codeSource = readFileSync('src/services/Code.gs', 'utf8');
const apiSource = readFileSync('src/services/api.js', 'utf8');

// ---------------------------------------------------------------------------
// 0. The backend parses
// ---------------------------------------------------------------------------
// Nothing else in this repository compiles Code.gs: it is pasted into the Apps Script editor, so a stray brace
// would be found by whichever member signed in first. Node's own parser is the same job Apps Script does, so
// this is a syntax check of the file as a script rather than of the fragments the sections below extract.
const backendParses = () => {
  const dir = mkdtempSync(join(tmpdir(), 'station-portal-codegs-'));
  const file = join(dir, 'Code.js');
  writeFileSync(file, codeSource);
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    return '';
  } catch (err) {
    return String(err.stderr || err.message).split('\n').slice(0, 4).join(' | ');
  }
};
check('the backend parses as a script', backendParses(), '');

// ---------------------------------------------------------------------------
// 0b. Every function is TOP-LEVEL
// ---------------------------------------------------------------------------
// Apps Script only offers top-level functions in the editor's function dropdown, and only top-level ones are
// globals. A nested declaration is therefore invisible: it cannot be selected to run, and that is exactly how
// `checkIdMigration` and `applyIdMigration` went missing from the dropdown while being plainly visible in the
// pasted code. Caught here, once, instead of by whoever goes looking for the function.
//
// Depth is counted with comments and string literals skipped, so a brace inside a comment cannot throw it off.
const declarationDepths = (source) => {
  // Depth at the START of each line: line 1 starts at 0, and each newline pushes the depth the next line begins
  // with. Getting this off by one line makes every declaration look nested - which is what this check asserts
  // against, so it has to be right itself.
  const lineDepth = [0];
  let depth = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let quote = null;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '\n') {
      inLineComment = false;
      lineDepth.push(depth);
      continue;
    }
    if (inLineComment) continue;
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      // A backslash escape inside a quoted string, and the closing quote.
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
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

  return source
    .split('\n')
    .map((text, index) => ({ line: index + 1, text: text.trim(), depth: lineDepth[index] || 0 }))
    .filter((entry) => /^function\s+[A-Za-z0-9_]+\s*\(/.test(entry.text));
};

const declarations = declarationDepths(codeSource);
const nested = declarations.filter((entry) => entry.depth !== 0);
check('every function declaration is at the top level', nested.length, 0);
checkIs(
  'and there are plenty of them (the scan is really reading the file)',
  declarations.length > 100,
  `${declarations.length} declarations found`
);
// The ones a human runs by hand, by name, from the editor's dropdown.
['doGet', 'doPost', 'migrateLegacyPasswords', 'diagnoseFcmSetup', 'checkIdMigration', 'applyIdMigration'].forEach(
  (name) => {
    const found = declarations.find((entry) => new RegExp(`^function ${name}\\(`).test(entry.text));
    checkIs(`${name} is runnable from the editor`, !!found && found.depth === 0);
  }
);
check('and the API client parses', (() => {
  try {
    new Function(apiSource.replace(/^import .*$/gm, '').replace(/^export /gm, ''));
    return '';
  } catch (err) {
    return String(err.message);
  }
})(), '');

// ---------------------------------------------------------------------------
// Extraction: the real functions, by name, brace-balanced
// ---------------------------------------------------------------------------
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

const constSource = (name, source = codeSource) => {
  const match = new RegExp(`^(?:const|var) ${name} = [\\s\\S]*?;\\n`, 'm').exec(source);
  if (!match) throw new Error(`no ${name}`);
  return match[0];
};

// A `const name = (...) => { ... };` declaration, brace-balanced.
//
// The lazy regex above cannot do this one: it stops at the first `;\n`, which for an arrow function is a
// `return` inside the body - so the extracted source would be a truncated function that throws when run.
const constBodySource = (name, source) => {
  const at = source.indexOf(`const ${name} = `);
  if (at === -1) throw new Error(`no ${name}`);
  const open = source.indexOf('{', at);
  if (open === -1) throw new Error(`${name} has no braced body`);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(at, i + 2); // through the trailing ";"
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
};

// The switch arms live inside doPost, so they are sliced by text rather than by brace matching. Extracting an
// arm and running it under a `switch` wrapper is what makes the real clock-in and clock-out code testable:
// their `break` statements are legal there, and `responseData` can be read afterwards.
const actionBlock = (name) => {
  const start = codeSource.indexOf(`case "${name}":`);
  if (start === -1) throw new Error(`Code.gs has no case ${name}`);
  const rest = codeSource.slice(start + name.length + 8);
  const end = rest.search(/\n {6}(case "|default:)/);
  const body = end === -1 ? rest : rest.slice(0, end);
  // Drop the arm's opening brace and the closing one, leaving statements that `break` out of a switch.
  return body.replace(/^\s*\{/, '').replace(/\}\s*$/, '');
};

// ---------------------------------------------------------------------------
// A sheet good enough for these functions, counting every write separately
// ---------------------------------------------------------------------------
class FakeSheet {
  constructor(rows = [], name = 'sheet') {
    this.rows = rows.map((row) => row.slice());
    this.name = name;
    // Counted separately so "one write, not four" is assertable rather than implied by a total.
    this.counts = { setValue: 0, setValues: 0, appendRow: 0, deleteRow: 0 };
    this.log = [];
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
    return this.rows.length ? this.rows[0].length : 0;
  }
  getRange(row, col, numRows = 1, numCols = 1) {
    const sheet = this;
    const ensure = (target, at) => {
      while (sheet.rows.length <= target) sheet.rows.push([]);
      while (sheet.rows[target].length <= at) sheet.rows[target].push('');
    };
    return {
      getValue: () => (sheet.rows[row - 1] ? sheet.rows[row - 1][col - 1] : undefined),
      getValues: () => {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const values = [];
          for (let c = 0; c < numCols; c++) values.push((sheet.rows[row - 1 + r] || [])[col - 1 + c] ?? '');
          out.push(values);
        }
        return out;
      },
      setValue: (value) => {
        ensure(row - 1, col - 1);
        sheet.rows[row - 1][col - 1] = value;
        sheet.counts.setValue++;
        sheet.log.push({ op: 'setValue', row, col, value });
      },
      setValues: (values) => {
        for (let r = 0; r < values.length; r++) {
          for (let c = 0; c < values[r].length; c++) ensure(row - 1 + r, col - 1 + c);
          for (let c = 0; c < values[r].length; c++) sheet.rows[row - 1 + r][col - 1 + c] = values[r][c];
        }
        sheet.counts.setValues++;
        sheet.log.push({ op: 'setValues', row, col, values: values.map((line) => line.slice()) });
      },
    };
  }
  appendRow(values) {
    // The values are logged AS GIVEN, before the pad to the sheet's width: "the app did not write this column"
    // is only assertable if the fake keeps the difference between a padded '' and a written ''.
    this.log.push({ op: 'appendRow', values: values.slice() });
    const line = values.slice();
    while (line.length < this.getLastColumn()) line.push('');
    this.rows.push(line);
    this.counts.appendRow++;
  }
  deleteRow(index) {
    this.rows.splice(index - 1, 1);
    this.counts.deleteRow++;
  }
}

// A lock that can be told to refuse, and that remembers whether anyone asked for it.
const makeLock = ({ available = true } = {}) => {
  let held = false;
  return {
    attempts: 0,
    releases: 0,
    lastWaitMs: null,
    tryLock(waitMs) {
      this.attempts++;
      this.lastWaitMs = waitMs;
      if (!available || held) return false;
      held = true;
      return true;
    },
    releaseLock() {
      held = false;
      this.releases++;
    },
    get isHeld() {
      return held;
    },
  };
};

const rowsOf = (sheet) => JSON.stringify(sheet.rows);

// The Apps Script allocator, deterministic for the tests. Hex-shaped and 36 characters, so the id assertions
// below are about a real UUID rather than a placeholder - and so isUuidValue would recognise one.
const uuidStub = {
  getUuid: (() => {
    let issued = 0;
    return () => {
      issued++;
      return `00000000-0000-4000-8000-${String(issued).padStart(12, '0')}`;
    };
  })(),
};

// ---------------------------------------------------------------------------
// 1. The gate, executed
// ---------------------------------------------------------------------------
console.log('\n--- the lock gate ---');
const gate = new Function(`
  ${constSource('READ_ONLY_ACTIONS')}
  ${constSource('LOCK_OPTIONAL_ACTIONS')}
  ${constSource('WRITE_LOCK_WAIT_MS')}
  ${extract('actionNeedsWriteLock')}
  ${extract('acquireWriteLock')}
  ${extract('busyResponseData')}
  return { actionNeedsWriteLock, acquireWriteLock, busyResponseData, WRITE_LOCK_WAIT_MS, READ_ONLY_ACTIONS, LOCK_OPTIONAL_ACTIONS };
`)();

check('a read does not need the lock', gate.actionNeedsWriteLock('GET_SCHEDULE'), false);
check('a write does', gate.actionNeedsWriteLock('CLOCK_IN'), true);
// An unknown action must still be treated as a write: doPost reaches it before the switch, and guessing "read"
// for a name nobody listed is how a new write action would silently lose its serialisation.
check('an unknown action is treated as a write', gate.actionNeedsWriteLock('SOMETHING_NEW'), true);
check('no action is lock-optional yet', Object.keys(gate.LOCK_OPTIONAL_ACTIONS).length, 0);
check('the wait is longer than any single save holds it', gate.WRITE_LOCK_WAIT_MS, 20000);

const takenLock = makeLock();
const taken = gate.acquireWriteLock(takenLock, 'CLOCK_IN');
check('a free lock is taken', taken.ok, true);
check('and reported as taken, so it is released later', taken.took, true);
check('with the configured wait', takenLock.lastWaitMs, 20000);
check('and it is actually held', takenLock.isHeld, true);

const readLock = makeLock();
const readResult = gate.acquireWriteLock(readLock, 'GET_SCHEDULE');
check('a read acquires nothing', readResult, { ok: true, took: false });
// The whole point of the read-only list: no lock, so a save's refresh wave runs concurrently.
check('and never even asks for the lock', readLock.attempts, 0);

const refusedLock = makeLock({ available: false });
const refused = gate.acquireWriteLock(refusedLock, 'ADMIN_SAVE_USER');
check('a busy lock is refused, not waited out', refused.ok, false);
check('with a retry hint in seconds', refused.retryAfterSeconds >= 1, true);
check('and nothing is held afterwards', refusedLock.isHeld, false);

const busy = gate.busyResponseData(5);
check('the refusal names itself', busy.code, 'BUSY');
check('it is not a success', busy.success, false);
check('it asks for a specific wait', busy.retry_after, 5);
// The message has to say the change was NOT saved: the alternative reading ("it saved and is busy") is how
// somebody ends up re-typing a form that did land.
check('and says the change was not saved', /NOT saved/.test(busy.message), true);

// ---------------------------------------------------------------------------
// 2. Two writers, one slot - the invariant this all exists for
// ---------------------------------------------------------------------------
console.log('\n--- two writers that overlap ---');
const slots = new FakeSheet([['id', 'user_id']]);

// A faithful model of the overlap: the first execution is INSIDE its request (lock held, write not yet made)
// when the second arrives.
const sharedLock = makeLock();
const first = gate.acquireWriteLock(sharedLock, 'ADMIN_SAVE_SCHEDULE');
const second = gate.acquireWriteLock(sharedLock, 'ADMIN_SAVE_SCHEDULE');
check('the first writer takes the lock', first.ok, true);
check('the second is refused while it is held', second.ok, false);
check('and the refusal wrote nothing at all', slots.writes, 0);

// What the first writer then does: allocate the next id from the last row and append.
if (first.ok) {
  slots.appendRow([slots.getLastRow(), 'u1']);
  sharedLock.releaseLock();
}
check('the first write landed', slots.rows.length, 2);
check('the lock is free again', sharedLock.isHeld, false);

// The retry the client makes on a BUSY reply is served normally.
const retry = gate.acquireWriteLock(sharedLock, 'ADMIN_SAVE_SCHEDULE');
check('the retry is served', retry.ok, true);
if (retry.ok) {
  slots.appendRow([slots.getLastRow(), 'u2']);
  sharedLock.releaseLock();
}
check('two rows, two ids', slots.rows.length, 3);
check('and the ids are unique - nothing collided', new Set(slots.rows.slice(1).map((r) => r[0])).size, 2);

// The control, proving those assertions are testing something. This is the OLD path: both executions read the
// next id before either appends, which is exactly what an overlap does when nobody holds the lock.
const oldSlots = new FakeSheet([['id', 'user_id']]);
const firstRead = oldSlots.getLastRow(); // the old allocator read the last row's id
const secondRead = oldSlots.getLastRow(); // ...and so does the other execution, before any write
oldSlots.appendRow([firstRead, 'u1']);
oldSlots.appendRow([secondRead, 'u2']);
check('without the lock the ids collide', new Set(oldSlots.rows.slice(1).map((r) => r[0])).size, 1);
check('and the sheet grew a duplicate-id row', oldSlots.rows.length, 3);

// ---------------------------------------------------------------------------
// 3. doPost itself: the refusal comes first, and writes nothing on the way
// ---------------------------------------------------------------------------
console.log('\n--- doPost refuses before it writes ---');
checkIs('doPost gates on the action', /const gate = acquireWriteLock\(lock, action\)/.test(codeSource));
checkIs(
  'and only counts itself as locked when it really is',
  /locked = gate\.ok && gate\.took;/.test(codeSource),
  'a refused gate must not look like a held lock, or the finally would release somebody else\'s'
);
checkIs('a refused write is returned as BUSY', /if \(!gate\.ok\)[\s\S]{0,400}busyResponseData\(gate\.retryAfterSeconds\)/.test(codeSource));
checkIs('and only what was taken is released', /if \(locked\) lock\.releaseLock\(\)/.test(codeSource));

// Nothing that writes may sit between the gate and the refusal: an early return is only safe if the sheet is
// still untouched at that point.
const gateAt = codeSource.indexOf('const gate = acquireWriteLock(lock, action)');
const busyAt = codeSource.indexOf('busyResponseData(gate.retryAfterSeconds)');
const between = codeSource.slice(gateAt, busyAt);
const WRITE_CALLS = /appendRow\(|setValue\(|setValues\(|deleteRow\(|insertSheet\(|logSystemEvent|createSession|revokeSessionsForUser|retuneSessions|upsertSheetRowById|upsertKeyValueRow|saveRunnerScore/;
check('the gate runs before the switch', gateAt !== -1 && gateAt < codeSource.indexOf('switch (action)', gateAt), true);
checkIs('and the refusal writes nothing', !WRITE_CALLS.test(between));
// The old gate, which ignored the answer, must be gone - otherwise the whole file is theatre.
checkIs('the fail-open gate is gone', !/tryLock\(10000\)/.test(codeSource), 'a 10s tryLock whose result is discarded is still there');

// ---------------------------------------------------------------------------
// 4. The timeclock, executed - the real switch arms
// ---------------------------------------------------------------------------
console.log('\n--- clock-in ---');
// The real header order, including the columns the app does not write (the clock-in calc_address is filled by
// the sheet itself).
const CLOCK_HEADERS = ['id', 'time_in', 'time_out', 'user_id', 'gps_lon', 'gps_lat', 'is_manual', 'calc_address',
  'gps_lon_out', 'gps_lat_out', 'calc_address_out'];

// Runs one real switch arm out of Code.gs. The arm is wrapped in a `case`, so its own `break` statements work
// exactly as they do inside doPost, and `responseData` is read back afterwards.
const timeclockHarness = ({ rows = [CLOCK_HEADERS.slice()], geocodeThrows = false } = {}) => {
  const timeclock = new FakeSheet(rows, 'timeclock');
  const ss = { getSheetByName: (name) => (name === 'timeclock' ? timeclock : null) };
  const logged = [];
  const geocodes = [];

  const arm = (name) => `
    case ${JSON.stringify(name)}: {
      let responseData = { success: false };
      switch (1) { case 1: {
        ${actionBlock(name)}
      } }
      responseDataRef.value = responseData;
      break;
    }`;

  const runner = new Function('ss', 'timeclock', 'logged', 'geocodes', 'actionName', 'data', 'payload', 'Utilities', `
    ${extract('getSheetData')}
    ${extract('newRowId')}
    ${extract('rowValuesForHeaders')}
    ${extract('findOpenClockRow')}
    const getEasternTimestamp = () => '2026-01-01 08:00:00';
    const getAuthContext = () => ({ userId: 'u1' });
    const hasRolePermission = () => true;
    const clockLocationRejection = () => '';
    const logSystemEvent = (spreadsheet, userId, action) => { logged.push(action); };
    const GOOGLEMAPS_REVERSEGEOCODE = (lat, lon) => {
      geocodes.push([lat, lon]);
      ${geocodeThrows ? "throw new Error('Maps is unavailable');" : "return '1 Fire Hall Rd';"}
    };
    const responseDataRef = { value: null };
    switch (actionName) {
      ${arm('CLOCK_IN')}
      ${arm('CLOCK_OUT')}
      default: responseDataRef.value = { success: false, message: 'unknown' };
    }
    return responseDataRef.value;
  `);

  return {
    timeclock,
    logged,
    geocodes,
    run: (name, data = {}) => runner(ss, timeclock, logged, geocodes, name, data, {}, uuidStub),
  };
};

const colOf = (sheet, name) => sheet.rows[0].indexOf(name);
const valueOf = (sheet, rowIndex, name) => sheet.rows[rowIndex][colOf(sheet, name)];

const clockIn = timeclockHarness();
const firstClockIn = clockIn.run('CLOCK_IN', { user_id: 'u1', gps_lat: '39.2', gps_lon: '-78.1' });
check('a clock-in succeeds', firstClockIn.success, true);
check('it appended exactly one row', clockIn.timeclock.counts.appendRow, 1);
check('with a UUID for its id', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(valueOf(clockIn.timeclock, 1, 'id')), true);
check('the member is in user_id', valueOf(clockIn.timeclock, 1, 'user_id'), 'u1');
check('and the clock-in stamp is there', valueOf(clockIn.timeclock, 1, 'time_in'), '2026-01-01 08:00:00');

// The values are addressed by header name, so a reordered sheet still files a clock-in correctly - the old
// positional append would have written the member id into whichever column happened to be fourth.
const reordered = timeclockHarness({ rows: [['user_id', 'id', 'gps_lat', 'time_in', 'gps_lon', 'time_out', 'is_manual']] });
reordered.run('CLOCK_IN', { user_id: 'u1', gps_lat: '39.2', gps_lon: '-78.1' });
check('a reordered sheet still files the member correctly', valueOf(reordered.timeclock, 1, 'user_id'), 'u1');
check('and the latitude', valueOf(reordered.timeclock, 1, 'gps_lat'), '39.2');
check('and the longitude', valueOf(reordered.timeclock, 1, 'gps_lon'), '-78.1');
check('and the timestamp', valueOf(reordered.timeclock, 1, 'time_in'), '2026-01-01 08:00:00');
check('and the id is a UUID too', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(valueOf(reordered.timeclock, 1, 'id')), true);
// The row stops at the last value it actually has. On the real header order that means the clock-in
// `calc_address` and the three `_out` columns are not written at all, rather than written as empty strings -
// the sheet fills calc_address itself, and a written "" would replace whatever it puts there.
const clockInAppend = clockIn.timeclock.log.find((entry) => entry.op === 'appendRow');
check('it writes only the columns it owns values for', clockInAppend.values.length, 7);
check('stopping before the columns it does not own', clockInAppend.values.length < CLOCK_HEADERS.length, true);
check('the last value it owns is is_manual', clockInAppend.values.at(-1), false);

console.log('\n--- clock-in twice ---');
const alreadyOpen = [
  CLOCK_HEADERS.slice(),
  [7, '2026-01-01 06:00:00', '', 'u1', '', '', '', '', '', '', ''],
];
const doubleClockIn = timeclockHarness({ rows: alreadyOpen.map((r) => r.slice()) });
const secondAttempt = doubleClockIn.run('CLOCK_IN', { user_id: 'u1' });
check('a second clock-in is refused', secondAttempt.success, false);
check('and says why', secondAttempt.code, 'ALREADY_CLOCKED_IN');
// The refusal is the whole point: an open row plus a second one needs an administrator to spot and delete.
check('it appended nothing', doubleClockIn.timeclock.counts.appendRow, 0);
check('and wrote nothing at all', doubleClockIn.timeclock.writes, 0);
check('nor logged anything', doubleClockIn.logged.length, 0);

// A CLOSED entry does not block a new one, and neither does somebody else's open entry.
const closedRow = [
  CLOCK_HEADERS.slice(),
  [1, '2026-01-01 06:00:00', '2026-01-01 07:00:00', 'u1', '', '', '', '', '', '', ''],
];
const afterClockOut = timeclockHarness({ rows: closedRow.map((r) => r.slice()) });
check('a member who clocked out can clock in again', afterClockOut.run('CLOCK_IN', { user_id: 'u1' }).success, true);
check('adding one row', afterClockOut.timeclock.counts.appendRow, 1);

const otherMemberOpen = [
  CLOCK_HEADERS.slice(),
  [1, '2026-01-01 06:00:00', '', 'u2', '', '', '', '', '', '', ''],
];
const otherMember = timeclockHarness({ rows: otherMemberOpen.map((r) => r.slice()) });
check("another member's open entry does not block this one", otherMember.run('CLOCK_IN', { user_id: 'u1' }).success, true);

console.log('\n--- clock-out ---');
const openForOut = [
  CLOCK_HEADERS.slice(),
  [1, '2026-01-01 06:00:00', '', 'u1', '', '', '', '', '', '', ''],
];
const clockOut = timeclockHarness({ rows: openForOut.map((r) => r.slice()) });
const outResult = clockOut.run('CLOCK_OUT', { user_id: 'u1', gps_lat: '39.3', gps_lon: '-78.2' });
check('the clock-out succeeds', outResult.success, true);
// ONE write, not four: that is what stops a failure mid-way from leaving the row stamped out with no address.
check('the whole row went in with one setValues', clockOut.timeclock.counts.setValues, 1);
check('and there were no single-cell writes at all', clockOut.timeclock.counts.setValue, 0);
check('the member is still there', valueOf(clockOut.timeclock, 1, 'user_id'), 'u1');
check('the clock-in stamp is untouched', valueOf(clockOut.timeclock, 1, 'time_in'), '2026-01-01 06:00:00');
check('the time_out is stamped', valueOf(clockOut.timeclock, 1, 'time_out'), '2026-01-01 08:00:00');
check('the out latitude', valueOf(clockOut.timeclock, 1, 'gps_lat_out'), '39.3');
check('the out longitude', valueOf(clockOut.timeclock, 1, 'gps_lon_out'), '-78.2');
check('and the address', valueOf(clockOut.timeclock, 1, 'calc_address_out'), '1 Fire Hall Rd');
check('the clock-in address column was left alone', valueOf(clockOut.timeclock, 1, 'calc_address'), '');
check('the address was looked up once', clockOut.geocodes.length, 1);
check('and the clock-out was logged', clockOut.logged, ['CLOCK_OUT']);

// The geocode is a network call. If it fails, nothing may have been written: the row used to be left stamped
// out with no address, and the script lock was held across the lookup for the whole round trip.
const failingGeocode = [
  CLOCK_HEADERS.slice(),
  [1, '2026-01-01 06:00:00', '', 'u1', '', '', '', '', '', '', ''],
];
const broken = timeclockHarness({ rows: failingGeocode.map((r) => r.slice()), geocodeThrows: true });
let threw = false;
try {
  broken.run('CLOCK_OUT', { user_id: 'u1', gps_lat: '39.3', gps_lon: '-78.2' });
} catch (err) {
  threw = true;
}
check('a failed address lookup throws rather than half-writing', threw, true);
check('and the sheet is untouched', broken.timeclock.writes, 0);
check('so the entry is still open', valueOf(broken.timeclock, 1, 'time_out'), '');

// No open entry: the failure path must not write either.
const nothingOpen = timeclockHarness();
const noEntry = nothingOpen.run('CLOCK_OUT', { user_id: 'u1' });
check('clocking out with no entry fails', noEntry.success, false);
check('with a message naming the reason', /No active shift/.test(noEntry.message), true);
check('and writes nothing', nothingOpen.timeclock.writes, 0);
check('but still records the attempt', nothingOpen.logged, ['CLOCK_OUT_FAILED']);

// ---------------------------------------------------------------------------
// 5. Settings batches - all-or-nothing, and one read rather than ten
// ---------------------------------------------------------------------------
console.log('\n--- a settings batch ---');
const settingsHarness = ({ rows = [['key', 'value']] } = {}) => {
  const settings = new FakeSheet(rows, 'system_settings');
  const ss = {
    getSheetByName: (name) => (name === 'system_settings' ? settings : null),
    insertSheet: (name) => settings,
  };
  const helpers = new Function('ss', `
    ${constSource('SETTINGS_BATCH_LIMIT')}
    ${constSource('SETTING_KEY_MAX_LENGTH')}
    ${extract('rowValuesForHeaders')}
    ${extract('settingPairsFrom')}
    ${extract('settingBatchRefusal')}
    ${extract('setSystemSettingsBatch')}
    return { settingPairsFrom, settingBatchRefusal, setSystemSettingsBatch, SETTINGS_BATCH_LIMIT };
  `)(ss);
  return { settings, helpers, ss };
};

const batch = settingsHarness();
const tenMessages = Array.from({ length: 10 }, (_, i) => ({ key: `loading_message${i}`, value: `Message ${i}` }));
check('a batch of ten is accepted', batch.helpers.settingBatchRefusal(tenMessages, { canEditAll: true }), '');
const written = batch.helpers.setSystemSettingsBatch(batch.ss, batch.helpers.settingPairsFrom(tenMessages));
check('and all ten keys are reported written', written.length, 10);
check('the sheet gained ten rows', batch.settings.rows.length, 11);
check('the first message is stored', batch.settings.rows[1].slice(0, 2), ['loading_message0', 'Message 0']);
check('and the last', batch.settings.rows[10].slice(0, 2), ['loading_message9', 'Message 9']);
// The block of new rows goes in with ONE setValues, and the lookup is ONE read: ten requests' worth of work
// used to happen here, because each message was its own call from the browser.
check('the new rows went in as one block', batch.settings.counts.setValues, 1);
check('and no cell was written individually for a new row', batch.settings.counts.setValue, 0);

// Re-saving the same ten UPDATES the rows rather than appending duplicates: the bug this replaces was a form
// that appeared to save and quietly wrote nothing.
const secondBatch = settingsHarness({ rows: batch.settings.rows.map((r) => r.slice()) });
secondBatch.helpers.setSystemSettingsBatch(
  secondBatch.ss,
  secondBatch.helpers.settingPairsFrom([{ key: 'loading_message3', value: 'Changed' }])
);
check('a re-save does not add a row', secondBatch.settings.rows.length, 11);
check('it changed the value in place', secondBatch.settings.rows[4].slice(0, 2), ['loading_message3', 'Changed']);
check('with one cell write', secondBatch.settings.counts.setValue, 1);
check('and no appended block', secondBatch.settings.counts.setValues, 0);

console.log('\n--- what a batch refuses ---');
const refusalHarness = settingsHarness();
check('nothing supplied', refusalHarness.helpers.settingBatchRefusal([], { canEditAll: true }), 'No settings were supplied.');
check('not a list', refusalHarness.helpers.settingBatchRefusal('nope', { canEditAll: true }), 'No settings were supplied.');
check(
  'more than the limit',
  /too many/.test(refusalHarness.helpers.settingBatchRefusal(
    Array.from({ length: 51 }, (_, i) => ({ key: `k${i}`, value: 'v' })),
    { canEditAll: true }
  )),
  true
);
check(
  'a key that is absurdly long',
  /too long/.test(refusalHarness.helpers.settingBatchRefusal([{ key: 'k'.repeat(65), value: 'v' }], { canEditAll: true })),
  true
);
check('a blank key is dropped, not refused', refusalHarness.helpers.settingPairsFrom([{ key: '  ', value: 'v' }]), []);
check(
  'a notify-only role may not touch other keys',
  /Manage system settings/.test(
    refusalHarness.helpers.settingBatchRefusal([{ key: 'department_name', value: 'x' }], { canEditNotificationsOnly: true })
  ),
  true
);
check(
  'but may write notify_ keys',
  refusalHarness.helpers.settingBatchRefusal([{ key: 'notify_shift_offers', value: 'TRUE' }], { canEditNotificationsOnly: true }),
  ''
);
// The escalation this check exists for: one permitted pair must not carry an unrelated one along with it.
check(
  'and cannot smuggle another key in beside a permitted one',
  /Manage system settings/.test(
    refusalHarness.helpers.settingBatchRefusal(
      [{ key: 'notify_shift_offers', value: 'TRUE' }, { key: 'department_name', value: 'x' }],
      { canEditNotificationsOnly: true }
    )
  ),
  true
);
check(
  'a refusal writes nothing',
  refusalHarness.settings.writes,
  0
);
check('a batch is capped before writing', refusalHarness.helpers.settingPairsFrom(Array.from({ length: 60 }, (_, i) => ({ key: `k${i}`, value: '' }))).length, 50);
check('a repeated key is collapsed to the last value', refusalHarness.helpers.settingPairsFrom([
  { key: 'a', value: 'first' },
  { key: 'a', value: 'second' },
]), [{ key: 'a', value: 'second' }]);
check('values are coerced to strings', refusalHarness.helpers.settingPairsFrom([{ key: 'a', value: 5 }]), [{ key: 'a', value: '5' }]);

// ---------------------------------------------------------------------------
// 6. Session epochs - a revocation that sticks
// ---------------------------------------------------------------------------
console.log('\n--- a revoked session cannot come back ---');
// The real session functions, against a fake property store. Sliding expiry writes on every authenticated
// request (including the unlocked reads), so "delete the token" was never enough on its own: a request that
// had already validated the session could write it back.
const sessionHarness = () => {
  const store = {};
  const PropertiesService = {
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
  const helpers = new Function('PropertiesService', 'Utilities', 'Date', `
    ${constSource('SESSION_PROPERTY_PREFIX')}
    ${constSource('SESSION_EPOCH_PREFIX')}
    ${constSource('DEFAULT_SESSION_TTL_MINUTES')}
    ${extract('sessionEpochState')}
    ${extract('sessionEpochFor')}
    ${extract('bumpSessionEpoch')}
    ${extract('sessionRecordValue')}
    ${extract('parseSessionRecord')}
    ${extract('revokeSessionsForUser')}
    return { sessionEpochFor, bumpSessionEpoch, sessionRecordValue, parseSessionRecord, revokeSessionsForUser, SESSION_PROPERTY_PREFIX, SESSION_EPOCH_PREFIX };
  `)(PropertiesService, { getUuid: () => 'token-fixed' }, Date);
  return { store, helpers };
};

const s1 = sessionHarness();
const { SESSION_PROPERTY_PREFIX: PREFIX, SESSION_EPOCH_PREFIX: EPOCH_PREFIX } = s1.helpers;
check('a fresh member has no epoch', s1.helpers.sessionEpochFor('u1'), '');
// A record written by an EARLIER deploy has three fields and no epoch - it has to keep working, or deploying
// this would sign everybody out.
const legacy = s1.helpers.parseSessionRecord('u1|' + (Date.now() + 60000) + '|60000');
check('a legacy record parses', legacy.userId, 'u1');
check('with no epoch', legacy.epoch, '');
check('and still gets a window', legacy.ttlMs, 60000);
check(
  'so a legacy session is NOT invalidated by deploying this',
  legacy.epoch === s1.helpers.sessionEpochFor('u1'),
  true
);

// Two devices for one member.
s1.store[PREFIX + 'dev1'] = s1.helpers.sessionRecordValue('u1', Date.now() + 60000, 60000, '');
s1.store[PREFIX + 'dev2'] = s1.helpers.sessionRecordValue('u1', Date.now() + 60000, 60000, '');
s1.store[PREFIX + 'other'] = s1.helpers.sessionRecordValue('u2', Date.now() + 60000, 60000, '');

s1.helpers.revokeSessionsForUser('u1', 'dev1');
check('the other device is deleted outright', s1.store[PREFIX + 'dev2'], undefined);
check('the kept device survives', typeof s1.store[PREFIX + 'dev1'], 'string');
check("another member's session is untouched", typeof s1.store[PREFIX + 'other'], 'string');
const kept = s1.helpers.parseSessionRecord(s1.store[PREFIX + 'dev1']);
check('the kept device carries the NEW epoch', kept.epoch, s1.helpers.sessionEpochFor('u1'));
check('and it is a real epoch, not empty', kept.epoch !== '', true);
check('its expiry is preserved, not reset', kept.expiry > Date.now(), true);

// The resurrection: a request that validated dev2 before the revoke writes its sliding expiry back AFTER the
// delete. It is still refused, because its epoch is stale.
s1.store[PREFIX + 'dev2'] = s1.helpers.sessionRecordValue('u2'.replace('u2', 'u1'), Date.now() + 60000, 60000, '');
// (the record as the racing request would have rewritten it - with the epoch it read BEFORE the bump)
s1.store[PREFIX + 'dev2'] = s1.helpers.sessionRecordValue('u1', Date.now() + 60000, 60000, '');
const resurrected = s1.helpers.parseSessionRecord(s1.store[PREFIX + 'dev2']);
check('a resurrected record exists', typeof s1.store[PREFIX + 'dev2'], 'string');
check(
  'but its epoch no longer matches the member',
  resurrected.epoch === s1.helpers.sessionEpochFor('u1'),
  false
);
check('so the guard refuses it', resurrected.epoch !== s1.helpers.sessionEpochFor('u1'), true);

// Nothing else lives in the session key space, or a session sweep would delete it / read it as a session.
check('the epoch is not stored under the session prefix', EPOCH_PREFIX.indexOf(PREFIX), -1);
check('and it is actually recorded', Object.keys(s1.store).some((k) => k.indexOf(EPOCH_PREFIX) === 0), true);

checkIs(
  'the request path compares the epoch',
  /if \(epoch\.readable && record\.epoch !== epoch\.epoch\)/.test(codeSource)
);
// An unreadable epoch must not be treated as a revocation: the check is skipped, not failed.
checkIs(
  'and only acts on it when the epoch could be read',
  /sessionEpochState\(userId\)/.test(codeSource) && !/record\.epoch !== sessionEpochFor\(userId\)/.test(codeSource),
  'the old shape treats an unreadable epoch as "never revoked", which signs a valid session out'
);
checkIs(
  'and the sliding-expiry write happens AFTER that check',
  codeSource.indexOf('record.epoch !== epoch.epoch') <
    codeSource.indexOf('sessionRecordValue(userId, Date.now() + record.ttlMs, record.ttlMs, record.epoch)'),
  'a session could be extended before it was checked'
);
// The refresh must CARRY the epoch. Dropping it here was the bug that had members signing in again two seconds
// later, because the second request compared "" against their real epoch.
checkIs(
  'and the refresh carries the epoch rather than dropping it',
  /sessionRecordValue\(userId, Date\.now\(\) \+ record\.ttlMs, record\.ttlMs, record\.epoch\)/.test(codeSource),
  'the sliding write drops the epoch, so every session dies on its second request'
);
checkIs('a session carries its epoch when created', /sessionRecordValue\(userId, Date\.now\(\) \+ ttlMs, ttlMs, sessionEpochFor\(userId\)\)/.test(codeSource));
checkIs('and a retune preserves it', /sessionRecordValue\(record\.userId, lastSeen \+ ttlMs, ttlMs, record\.epoch\)/.test(codeSource));
checkIs('and a revocation preserves the kept session epoch', /sessionRecordValue\(kept\.userId, kept\.expiry, kept\.ttlMs, epoch\)/.test(codeSource));

// ---------------------------------------------------------------------------
// 7. Row versions - two editors, one record
// ---------------------------------------------------------------------------
console.log('\n--- a stale save is refused ---');
const versionHarness = ({ rows = [['id', 'name', 'row_version']] } = {}) => {
  const sheet = new FakeSheet(rows, 'users');
  const helpers = new Function('sheet', 'Utilities', `
    ${extract('newRowId')}
    ${constSource('ROW_VERSION_COLUMN')}
    ${constSource('ROW_VERSION_FIRST')}
    ${extract('ensureRowVersionColumn')}
    ${extract('rowVersionConflict_')}
    ${extract('upsertSheetRowById')}
    return { upsertSheetRowById, ensureRowVersionColumn };
  `)(sheet, uuidStub);
  const save = (fields) => {
    try {
      return { id: helpers.upsertSheetRowById(sheet, fields), ok: true };
    } catch (err) {
      return { ok: false, conflict: err.conflict, message: err.message };
    }
  };
  return { sheet, save };
};

// Two administrators open the same user.
const users = versionHarness({ rows: [['id', 'name', 'row_version'], [1, 'Matt', 1]] });
check('the row starts at version 1', users.sheet.rows[1][2], 1);

// The first saves: the version matches, so it is applied and the version advances.
const firstSave = users.save({ id: 1, name: 'Matthew', row_version: 1 });
check('the first save is applied', firstSave.ok, true);
check('and the name changed', users.sheet.rows[1][1], 'Matthew');
check('the version advanced', users.sheet.rows[1][2], 2);

// The second still holds version 1: refused, with the row as it now stands so it can be reloaded.
const staleSave = users.save({ id: 1, name: 'Mat', row_version: 1 });
check('the stale save is refused', staleSave.ok, false);
check('and the sheet did not change', users.sheet.rows[1].slice(0, 3), [1, 'Matthew', 2]);
check('the refusal says the change was not saved', /NOT saved/.test(staleSave.message), true);
check('and carries the current row so it can be reloaded', staleSave.conflict.current.name, 'Matthew');
check('with the id it refused', staleSave.conflict.id, '1');

// Reloading and reapplying works.
check('after reloading, the save is applied', users.save({ id: 1, name: 'Mat', row_version: 2 }).ok, true);
check('and the version advanced again', users.sheet.rows[1][2], 3);

console.log('\n--- compatibility: an absent version is not a conflict ---');
const legacyClient = versionHarness({ rows: [['id', 'name', 'row_version'], [1, 'Matt', 5]] });
// A page built before versioning sends no version and must keep saving: the page and the backend are
// deployed separately, so this is the lever that makes the rollout safe in either order.
check('a save with no version is applied', legacyClient.save({ id: 1, name: 'Old Page' }).ok, true);
check('and still advances the version', legacyClient.sheet.rows[1][2], 6);
check('a blank version is treated as absent', legacyClient.save({ id: 1, name: 'Blank', row_version: '' }).ok, true);
check('a whitespace version too', legacyClient.save({ id: 1, name: 'Spaces', row_version: '  ' }).ok, true);

console.log('\n--- the version column appears on its own ---');
// A sheet that predates this feature: the column is added on the next save, and existing rows start at 1.
const freshSheet = versionHarness({ rows: [['id', 'name'], [1, 'Matt'], [2, 'Ana']] });
check('the column is not there yet', freshSheet.sheet.rows[0].length, 2);
freshSheet.save({ id: 1, name: 'Matthew', row_version: 1 });
check('the header gained the column', freshSheet.sheet.rows[0], ['id', 'name', 'row_version']);
check('existing rows were backfilled', [freshSheet.sheet.rows[1][2], freshSheet.sheet.rows[2][2]], [2, 1]);
check('and the save was applied', freshSheet.sheet.rows[1][1], 'Matthew');
// A NEW row starts at version 1 without the caller sending anything.
const created = freshSheet.save({ id: '', name: 'New Person' });
check('a create still works', created.ok, true);
check('and is born at version 1', freshSheet.sheet.rows.at(-1)[2], 1);

console.log('\n--- the version is ours, not the caller\'s ---');
const protectedSheet = versionHarness({ rows: [['id', 'name', 'row_version'], [1, 'Matt', 7]] });
// The version is compared but never written: a caller cannot pin a row back to an old version by sending one,
// and cannot skip the check by sending a fresh one either.
const attempted = protectedSheet.save({ id: 1, name: 'Sneaky', row_version: 8 });
check('a version that does not match is refused', attempted.ok, false);
check('so the row is untouched', protectedSheet.sheet.rows[1].slice(0, 3), [1, 'Matt', 7]);
protectedSheet.save({ id: 1, name: 'Fine', row_version: 7 });
check('the correct one writes the next version, not the sent one', protectedSheet.sheet.rows[1][2], 8);

console.log('\n--- the wiring ---');
checkIs('doPost answers a conflict with CONFLICT', /code: "CONFLICT"/.test(codeSource));
checkIs('and carries the current row', /current: err\.conflict\.current/.test(codeSource));
checkIs(
  'the check runs before the row is written',
  /stored !== String\(supplied\)\.trim\(\)\) throw rowVersionConflict_/.test(codeSource)
);
checkIs('the client sends the version on a user save', /row_version: rowVersionField\(userData\)/.test(apiSource));
checkIs('and on the other single-record saves', (apiSource.match(/row_version: rowVersionField\(/g) || []).length, 8);
checkIs(
  'the forms carry it from the row they were opened on',
  ['AdminUsersTab', 'AdminRolesTab', 'AdminRanksTab', 'AdminShiftsTab', 'AdminAssignmentsTab',
   'AdminAnnouncementsTab', 'AdminEventsTab'].every((tab) =>
    /row_version: [a-zA-Z]+\.row_version/.test(readFileSync(`src/components/admin/${tab}.jsx`, 'utf8'))
  ),
  'a form does not carry the version, so its saves would never be checked'
);
checkIs(
  'and the template form does too, including the drag',
  (readFileSync('src/components/admin/AdminScheduleTemplatesTab.jsx', 'utf8').match(/row_version: template\.row_version/g) || []).length >= 2
);
checkIs(
  'a create sends no version, so it is never checked',
  /const rowVersionField = \(record\) => \(record && record\.row_version !== undefined \? record\.row_version : undefined\)/.test(apiSource)
);
// The bulk writers must stay out of this: they own a whole month of rows, and the first version they did not
// send would refuse every one of them.
checkIs('bulk upserts are not versioned', !/rowVersionConflict_/.test(extract('bulkUpsertSheetRowsById')));

// ---------------------------------------------------------------------------
// 8. The client half: one safe retry for a refusal, never for a network error
// ---------------------------------------------------------------------------
console.log('\n--- the client retry ---');

const settingsCardSource = readFileSync('src/components/admin/AdminSystemSettingsTab.jsx', 'utf8');
checkIs('the card saves a batch', /adminSaveSystemSettings\(/.test(settingsCardSource));
checkIs(
  'falling back to per-key saves on an older deployment',
  /isUnknownAction\(result\)[\s\S]{0,400}adminSaveSystemSetting\(key, value, token\)/.test(settingsCardSource)
);
checkIs('the fallback still reports the failure it hits', /Failed to save \$\{label\}/.test(settingsCardSource));
checkIs('the API has the batch action', /action: 'ADMIN_SAVE_SYSTEM_SETTINGS'/.test(apiSource));
checkIs('and the backend case exists', /case "ADMIN_SAVE_SYSTEM_SETTINGS":/.test(codeSource));
checkIs(
  'the batch validates before it writes',
  codeSource.indexOf('settingBatchRefusal(') < codeSource.indexOf('setSystemSettingsBatch(ss, batchPairs)'),
  'a batch could write before being validated'
);

const clientHelpers = new Function(`
  ${constSource('BUSY_RETRY_DEFAULT_MS', apiSource)}
  ${constSource('BUSY_RETRY_CAP_MS', apiSource)}
  ${constBodySource('busyRetryWaitMs', apiSource)}
  return { busyRetryWaitMs, BUSY_RETRY_DEFAULT_MS, BUSY_RETRY_CAP_MS };
`)();
check('a refusal with a wait uses it', clientHelpers.busyRetryWaitMs({ retry_after: 3 }), 3000);
check('a nonsensical wait falls back to the default', clientHelpers.busyRetryWaitMs({}), clientHelpers.BUSY_RETRY_DEFAULT_MS);
check('a zero wait falls back too', clientHelpers.busyRetryWaitMs({ retry_after: 0 }), clientHelpers.BUSY_RETRY_DEFAULT_MS);
check('a negative one as well', clientHelpers.busyRetryWaitMs({ retry_after: -5 }), clientHelpers.BUSY_RETRY_DEFAULT_MS);
check('a hostile wait is capped', clientHelpers.busyRetryWaitMs({ retry_after: 3600 }), clientHelpers.BUSY_RETRY_CAP_MS);

checkIs('the client retries a refusal once', /if \(data && data\.code === 'BUSY'\)/.test(apiSource));
checkIs('and only on the explicit code, never on a thrown error', /catch \(err\)[\s\S]{0,400}if \(!retryOnNetworkError\) throw failure;/.test(apiSource));
checkIs(
  'a mutation still never retries a network failure',
  /Mutations never retry on network errors/.test(apiSource),
  'the comment that documents the rule is gone'
);
checkIs('the refusal is not swallowed', !/code === 'BUSY'[\s\S]{0,200}return \{\s*success: true/.test(apiSource));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
