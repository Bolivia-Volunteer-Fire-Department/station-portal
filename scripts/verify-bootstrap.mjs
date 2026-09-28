/**
 * Verifies the batched sign-in payloads in Code.gs by RUNNING them against a fake workbook.
 *
 * What this exists for: signing in fired seventeen Apps Script executions for an administrator (two waves of nine,
 * six of them fetching what the other had), and the calls at the end of that pile were the ones that ran out of the
 * client's 60-second patience. GET_BOOTSTRAP and ADMIN_GET_BOOTSTRAP replace the two waves with one request each.
 *
 * Source checks can show the batch calls the same helpers as the actions it replaces (verify-refresh-wiring does),
 * but only running it shows what actually comes back. So the real functions are evaluated out of Code.gs against a
 * fake spreadsheet, and the fields they return are compared with what the member-facing actions return:
 *
 *   - the member payload carries the schedule, availability, roster, offers, training, announcements, events,
 *     clock history and who is on duty;
 *   - the roster and the on-duty list are the SAME three columns (no password, no username, no role);
 *   - the member's own preference (time_format) travels, which is what a 12-hour clock was losing;
 *   - the admin payload adds the user directory with passwords stripped, the full template/assignment rows and the
 *     offers table;
 *   - and, the point of the gating, a role WITHOUT a permission loses that section and keeps the rest - the batch
 *     must not answer a narrow administrator with an empty response.
 *
 *   npm run verify:bootstrap
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

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

// ---------------------------------------------------------------------------
// A fake spreadsheet: enough of the read API for the payload builders.
// ---------------------------------------------------------------------------
const sheets = {};
const addSheet = (name, rows) => {
  sheets[name] = rows;
};

const rangeStub = (rows) => ({
  getValues: () => rows.map((row) => row.slice()),
  getDisplayValues: () => rows.map((row) => row.map((cell) => String(cell))),
  setValue: () => {},
  setValues: () => {},
});

const sheetStub = (rows) => ({
  getDataRange: () => rangeStub(rows),
  getRange: () => rangeStub(rows),
  appendRow: () => {},
});

const ss = {
  getSheetByName: (name) => (sheets[name] ? sheetStub(sheets[name]) : null),
  getName: () => 'Fake spreadsheet',
};

// ---------------------------------------------------------------------------
// The real Code.gs, evaluated with Apps Script stubbed out.
// ---------------------------------------------------------------------------
const CODE_GS = path.resolve(process.cwd(), 'src/services/Code.gs');
const source = readFileSync(CODE_GS, 'utf8');

const propertyStore = new Map();
const PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (key) => (propertyStore.has(key) ? propertyStore.get(key) : null),
    setProperty: (key, value) => propertyStore.set(key, value),
    deleteProperty: (key) => propertyStore.delete(key),
  }),
};

const pad2 = (n) => String(n).padStart(2, '0');
const Utilities = {
  formatDate: (value) => {
    const date = value instanceof Date ? value : new Date(value);
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  },
  getUuid: (() => {
    let issued = 0;
    return () => {
      issued += 1;
      return `00000000-0000-4000-8000-${String(issued).padStart(12, '0')}`;
    };
  })(),
};

const noop = () => {};
const cacheStub = { get: () => null, put: noop, remove: noop };
const loggerStub = { log: noop };

let bootstrap;
try {
  bootstrap = new Function(
    'SpreadsheetApp',
    'PropertiesService',
    'CacheService',
    'LockService',
    'Utilities',
    'Logger',
    'Session',
    'UrlFetchApp',
    'ContentService',
    'Base64',
    'console',
    `${source}
     return { memberBootstrapPayload, adminBootstrapPayload, rosterRowsFor, onDutyRowsFor, getSheetData, isAdminUser };`
  )(
    { getActiveSpreadsheet: () => ss },
    PropertiesService,
    { getScriptCache: () => cacheStub },
    { getScriptLock: () => ({ tryLock: () => true, releaseLock: noop }) },
    Utilities,
    loggerStub,
    { getActiveUser: () => ({ getEmail: () => 'test@example.com' }) },
    { fetch: () => ({ getResponseCode: () => 200, getContentText: () => '{}' }) },
    { createTextOutput: () => ({ setMimeType: () => ({}) }) },
    { encode: (s) => s, decode: (s) => s },
    { log: noop, warn: noop, error: noop }
  );
} catch (error) {
  checkIs('Code.gs evaluates with Apps Script stubbed', false, `${error.name}: ${error.message}`);
  process.exit(1);
}
checkIs('Code.gs evaluates with Apps Script stubbed', true);

// ---------------------------------------------------------------------------
// A workbook with one administrator, one member, and one shift on duty.
// ---------------------------------------------------------------------------
addSheet('users', [
  ['id', 'user_name', 'name', 'password', 'role_id', 'rank_id', 'status', 'is_change_password_on_login'],
  ['u1', 'jane', 'Jane Smith', 'HASHED-ADMIN-SECRET', 'r1', 'k1', 'active', 'FALSE'],
  ['u2', 'bo', 'Bo Jones', 'HASHED-MEMBER-SECRET', 'r2', 'k2', 'active', 'FALSE'],
]);
addSheet('roles', [
  ['id', 'description', 'is_admin', 'can_edit_users', 'can_edit_schedule_templates', 'can_edit_schedule'],
  ['r1', 'Administrator', 'TRUE', 'FALSE', 'FALSE', 'FALSE'],
  // A narrow role: it may read the schedule (everybody may) but not the user directory or the offers table.
  ['r2', 'Firefighter', 'FALSE', 'FALSE', 'FALSE', 'FALSE'],
]);
addSheet('ranks', [
  ['id', 'description', 'rank_order', 'color', 'icon'],
  ['k1', 'Officer', '3', '#ef4444', 'shield'],
  ['k2', 'Firefighter', '1', '#ef4444', 'flame'],
]);
addSheet('schedule', [
  ['id', 'schedule_template_id', 'assignment_id', 'user_id', 'date_from', 'date_to', 'start_time', 'end_time'],
  ['s1', 't1', 'a1', 'u1', '2026-03-02', '2026-03-02', '08:00', '18:00'],
]);
// Two members' slots, so "the member's own only" is a claim with something to get wrong: u1's row must reach u1 and
// u2's must not.
addSheet('availability', [
  ['id', 'schedule_template_id', 'date_from', 'date_to', 'user_id'],
  ['av1', 't1', '2026-03-06', '2026-03-06', 'u1'],
  ['av2', 't1', '2026-03-07', '2026-03-07', 'u2'],
]);
// `admin_note` is not in either member projection: it is the column that shows the two payloads apart, so an
// administrator's pickers get the whole row while a member's calendar gets the six fields it draws.
addSheet('schedule_templates', [
  ['id', 'day_of_week', 'start_time', 'end_time', 'assignment_id', 'nickname', 'admin_note'],
  ['t1', 'monday', '08:00', '18:00', 'a1', 'Day Shift', 'temporary cover'],
]);
addSheet('assignments', [
  ['id', 'description', 'color', 'icon', 'rank_order_required', 'admin_note'],
  ['a1', 'Engine 1', '#ef4444', 'flame', '1', 'checked monthly'],
]);
addSheet('apparatus', [['id', 'description'], ['a1', 'Engine 1']]);
addSheet('timeclock', [
  ['id', 'user_id', 'time_in', 'time_out'],
  ['c1', 'u1', '2026-03-02 07:55', ''],
  ['c2', 'u2', '2026-03-01 08:00', '2026-03-01 17:00'],
]);
addSheet('schedule_offers', [['id', 'user_id', 'schedule_id', 'status']]);
addSheet('trainings', [['id', 'title']]);
addSheet('training_signatures', [['id', 'training_id', 'user_id']]);
addSheet('announcements', [['id', 'title', 'is_visible_on_login', 'is_visible_on_dashboard', 'is_visible_on_sidebar']]);
addSheet('events', [['id', 'title', 'date_from', 'date_to']]);
addSheet('shifts', [['id', 'description', 'start_time', 'end_time']]);
addSheet('system_settings', [['key', 'value']]);
// The member's own preference: the 24-hour clock that a failed payload used to lose.
addSheet('user_settings', [
  ['user_id', 'time_format', 'is_dark_mode'],
  ['u1', '24', 'FALSE'],
  ['u2', '24', 'FALSE'],
]);

console.log('\n--- the member payload ---');
const { memberBootstrapPayload, adminBootstrapPayload, rosterRowsFor, onDutyRowsFor, getSheetData } = bootstrap;

const member = memberBootstrapPayload(ss, { userId: 'u1' });

checkIs('it reports success', member.success === true);
check('the schedule rows, whole - a member is meant to see the crew', member.schedule, getSheetData(ss, 'schedule'));
// The two unbounded sheets, cut to the viewer. Both are per-member tables - an availability row per member per
// date, a clock entry per shift - and every sign-in used to carry them whole, which is about 3.5 MB a year of
// growth at a station of thirty. Every member screen reads its own rows and filters by user id itself, so the rest
// was transferred only to be thrown away (and it was everybody's comings and goings leaving the spreadsheet).
//
// Asserted against u2, a plain member, because the payload above is u1's - and u1 is this workbook's ADMINISTRATOR,
// who legitimately receives both tables whole (asserted with the admin payload below).
const asMember = memberBootstrapPayload(ss, { userId: 'u2' });
check('availability is only their own slots', asMember.availability.map((row) => row.id), ['av2']);
check('and clock history only their own entries', asMember.logs.map((log) => log.id), ['c2']);
// The reason their own rows are enough: this is the lookup that decides whether the clock card offers "clock out",
// so the member's own open entry has to be in their payload. Here it is u1's, in the whole table an administrator
// gets - and for a member the same row arrives through the same filter, which is what the assertions below pin.
check(
  'and their own open shift is in what they get, so "am I clocked in" still answers',
  member.logs.filter((log) => !log.time_out).map((log) => log.id),
  ['c1']
);
check('the roster the same helper produces', member.roster, rosterRowsFor(ss));
check('who is on duty, clocked-out members excluded', member.onDuty, onDutyRowsFor(ss));
check('with only the one member on duty', member.onDuty.map((u) => u.id), ['u1']);
check('the member\u2019s own preference is in the payload', member.userSettings.filter((s) => String(s.user_id) === 'u1').map((s) => s.time_format), ['24']);
checkIs('so a 24-hour clock cannot be lost by a failed payload', member.userSettings.some((s) => String(s.user_id) === 'u1' && String(s.time_format) === '24'));
// The settings sheet is world-readable through GET_INITIAL_DATA, and the device token is the one column that must
// not travel with it - it is replaced by a boolean.
checkIs('and no device token travels with the settings', !JSON.stringify(member.userSettings).includes('fcm_token'));

// The projection is a security boundary, not a nicety: the roster is visible to every signed-in member.
const rosterKeys = [...new Set(member.roster.flatMap((row) => Object.keys(row)))].sort();
check('the roster carries exactly three columns', rosterKeys, ['id', 'name', 'rank_id']);
checkIs('and never a password', !JSON.stringify(member.roster).includes('HASHED'));
checkIs('nor a username or a role', !JSON.stringify(member.roster).includes('jane') && !JSON.stringify(member.roster).includes('role_id'));
checkIs('the same for the on-duty list', !JSON.stringify(member.onDuty).includes('HASHED'));

console.log('\n--- the administrator payload ---');
const admin = adminBootstrapPayload(ss, { userId: 'u1' });

// Everything the member needs is in it, because the two waves land on the same screen - EXCEPT the two per-member
// tables, which an administrator gets whole: the Clock Management and Member Availability tabs list everybody.
for (const field of ['schedule', 'roster', 'onDuty', 'trainings', 'events', 'userSettings']) {
  checkIs(`it carries ${field} too`, JSON.stringify(admin[field]) === JSON.stringify(member[field]));
}
// The whole tables, through the same helper the member path uses - isAdminUser is the single place that decides.
check('the whole clock table for an administrator', admin.logs.map((log) => log.id), ['c1', 'c2']);
check('and every member\u2019s availability', admin.availability.map((row) => row.id), ['av1', 'av2']);
check('the user directory', admin.users.map((u) => u.id), ['u1', 'u2']);
checkIs('with the passwords stripped', !JSON.stringify(admin.users).includes('HASHED'));
checkIs('and the usernames kept, because an administrator edits them', JSON.stringify(admin.users).includes('jane'));
checkIs('the full template rows are there', Array.isArray(admin.scheduleTemplates) && Array.isArray(admin.assignments));
// The difference between the two payloads, in one column: an administrator's pickers read the whole assignment
// row, and the member's calendar must NOT be handed the narrower copy.
checkIs('the full assignment rows, not the member projection', 'admin_note' in (admin.assignments[0] || {}));
checkIs('so the member projection really is narrower', !('admin_note' in (member.assignments[0] || {})));
checkIs('and the same for the templates', 'admin_note' in (admin.scheduleTemplates[0] || {}) && !('admin_note' in (member.scheduleTemplates[0] || {})));
checkIs('the offers table', Array.isArray(admin.scheduleOffers));
checkIs('and the login-screen announcements', Array.isArray(admin.loginAnnouncements));

console.log('\n--- a narrower role loses a section, not the response ---');
// The claim that makes the batch safe for a role that may only have some of it: an omitted section must not take
// the schedule, the roster or the clock history down with it - which IS what an ADMIN_GET_* refusal would do.
const narrow = adminBootstrapPayload(ss, { userId: 'u2' });
checkIs('no user directory', narrow.users === undefined);
checkIs('no offers table', narrow.scheduleOffers === undefined);
check('and the templates are the MEMBER projection, not the admin rows', narrow.scheduleTemplates, member.scheduleTemplates);
checkIs('so no admin-only column is in them', !('admin_note' in (narrow.scheduleTemplates[0] || {})));
checkIs('and it is not an error response', narrow.success === true);
check('but the schedule is still there', narrow.schedule, member.schedule);
check('and the roster', narrow.roster, member.roster);
check('and the clock history, still only their own', narrow.logs.map((log) => log.id), ['c2']);
check('with that member\u2019s own availability as well', narrow.availability.map((row) => row.id), ['av2']);
check('and this member\u2019s own preference', narrow.userSettings.filter((s) => String(s.user_id) === 'u2').map((s) => s.time_format), ['24']);
checkIs('with the members\u2019 own offers still present for them', Array.isArray(narrow.offers));

console.log('\n--- the individual actions still exist and still agree ---');
// The batch is additive: a tab that reloads its own list keeps its own action, and both must be in the same
// read-only list, or a sign-in would queue behind whatever write is in flight.
const gsSource = source;
for (const action of ['GET_BOOTSTRAP', 'ADMIN_GET_BOOTSTRAP']) {
  checkIs(`${action} is dispatched`, gsSource.includes(`case "${action}": {`));
  checkIs(`${action} is listed as read-only`, new RegExp(`^\\s{2}${action}: true`, 'm').test(gsSource));
}
checkIs('and it requires a session', /case "GET_BOOTSTRAP"[\s\S]{0,300}getAuthContext\(ss, data\)/.test(gsSource));
// The admin batch is guarded by is_admin, which is what grants Administration at all.
checkIs('the admin batch is guarded by is_admin', /case "ADMIN_GET_BOOTSTRAP"[\s\S]{0,400}isAdminUser\(ss, authAdminBootstrap\.userId\)/.test(gsSource));
checkIs('and the member actions it replaces are still dispatched', gsSource.includes('case "GET_SCHEDULE": {'));

console.log('\n--- the two per-member sheets are cut for the viewer, on every path ---');
// The claim the cut rests on: every member screen that reads these sheets draws the SIGNED-IN member's own rows. If
// one of them started listing the crew, the server would now be hiding rows that screen needs - so it is asserted
// here, beside the payload that depends on it, rather than assumed.
const clockHistory = readFileSync('src/components/MyClockHistory.jsx', 'utf8');
checkIs(
  'My Clock History filters the rows to the signed-in member',
  /String\(log\.user_id\) === String\(currentUser\.id\)/.test(clockHistory)
);
const appSource = readFileSync('src/App.jsx', 'utf8');
checkIs(
  'and so does the "am I clocked in" lookup that arms the clock card',
  /String\(log\.user_id\) === String\(currentUser\.id\) && !log\.time_out/.test(appSource)
);
const availabilityScreen = readFileSync('src/components/MyAvailability.jsx', 'utf8');
checkIs('My Availability is built for that member', /member=\{currentUser\}/.test(availabilityScreen));
// And both read actions go through the same viewer check, so a background refresh cannot put back what the payload
// narrowed - the failure that would otherwise show up as a member's clock history quietly growing to the whole crew.
checkIs(
  'the clock action is scoped for its viewer too',
  /case "GET_TIMECLOCK_LOGS"[\s\S]{0,400}clockLogsForViewer\(ss, authLogs\.userId\)/.test(gsSource)
);
checkIs(
  'and so is the availability action',
  /case "GET_AVAILABILITY"[\s\S]{0,400}availabilityForViewer\(ss, authAvail\.userId\)/.test(gsSource)
);
// One helper decides for both, by asking whether the viewer is an administrator - the same question the Clock
// Management and Member Availability tabs' own gate asks.
checkIs(
  'with isAdminUser the single decision for both',
  /function clockLogsForViewer[\s\S]{0,200}isAdminUser\(ss, userId\)/.test(gsSource) &&
    /function availabilityForViewer[\s\S]{0,200}isAdminUser\(ss, userId\)/.test(gsSource)
);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
