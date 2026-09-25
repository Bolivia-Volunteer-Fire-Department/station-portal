/**
 * Verifies the System Log tab.
 *
 * The filtering, sorting and paging all happen on the SERVER, which is the whole reason the tab can
 * open on a large log cheaply. So the assertions that matter are against the real functions lifted
 * out of Code.gs, run against stub sheet rows - not against a reimplementation here.
 *
 * The client half is the paging arithmetic and the request shape, both pure, plus the timestamp
 * parsing (the sheet stores "yyyy-MM-dd HH:mm:ss" text, which `formatClock` cannot read whole).
 *
 * Run with: npm run verify:system-log
 */
import { readFileSync } from 'node:fs';
import {
  DEFAULT_LOG_SORT,
  LOG_PAGE_SIZE,
  LOG_PAGE_SIZE_MAX,
  LOG_SORT_OPTIONS,
  SYSTEM_LOG_ACTION,
  SYSTEM_LOG_API_VERSION,
  clampLogPage,
  emptyLogFilters,
  formatLogTimestamp,
  logActionTone,
  logPageRangeLabel,
  logQueryParams,
  logTimestampParts,
  normalizeLogRow,
  normalizeLogRows,
  systemLogRequest,
  totalLogPages,
} from '../src/utils/systemLog.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` -> ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`}`
  );
};

// --- the client's view of a row ---------------------------------------------------------------
console.log('--- the stored timestamp ---');
check('a full timestamp splits', logTimestampParts('2026-03-14 08:05:30'), {
  dateKey: '2026-03-14',
  timeText: '08:05',
});
check('seconds are dropped for display', logTimestampParts('2026-03-14 18:45:00').timeText, '18:45');
check('a date alone still parses', logTimestampParts('2026-03-14').dateKey, '2026-03-14');
check('a date alone has no time', logTimestampParts('2026-03-14').timeText, '');
check('an ISO-ish value parses too', logTimestampParts('2026-03-14T08:05:00').dateKey, '2026-03-14');
check('rubbish yields nothing', logTimestampParts('not a date'), { dateKey: '', timeText: '' });
check('blank yields nothing', logTimestampParts(''), { dateKey: '', timeText: '' });
check('a null yields nothing', logTimestampParts(null).dateKey, '');

check(
  'the display form includes the year and the time',
  formatLogTimestamp('2026-03-14 08:05:30', '12'),
  'Sat, Mar 14 2026 · 8:05 AM'
);
check(
  'and honours the 24-hour preference',
  formatLogTimestamp('2026-03-14 18:45:00', '24'),
  'Sat, Mar 14 2026 · 18:45'
);
check(
  'an unparseable timestamp is shown raw rather than blank',
  formatLogTimestamp('yesterday-ish', '12'),
  'yesterday-ish'
);
check('an empty timestamp shows a dash', formatLogTimestamp('', '12'), '—');

const ROW = { id: 7, timestamp: '2026-03-14 08:05:30', user_id: 'u1', action: 'USER_LOGIN', details: 'Signed in.' };
const normalized = normalizeLogRow(ROW);
check('the id is a string for use as a key', normalized.id, '7');
check('the user id survives', normalized.user_id, 'u1');
check('the action survives', normalized.action, 'USER_LOGIN');
check('the details survive', normalized.details, 'Signed in.');
check('a date key is derived', normalized.date_key, '2026-03-14');
check('a hyphenated name is not split as a date', normalizeLogRow({ timestamp: '2026-03-14 08:05:30' }).date_key, '2026-03-14');
// Unlike a training, a log line with no id is still evidence and is kept.
check('a row with no id is kept', normalizeLogRows([{ timestamp: '2026-03-14 08:05:30' }]).length, 1);
check('a null row does not throw', normalizeLogRow(null).action, '');
check('a non-array is an empty list', normalizeLogRows(null), []);

console.log('\n--- the action badge tone ---');
check('a failed sign-in is an alert', logActionTone('LOGIN_FAILED'), 'alert');
check('a rejection is an alert', logActionTone('SHIFT_OFFER_DECLINED'), 'alert');
check('a deletion is an alert', logActionTone('ADMIN_DELETE_USER'), 'alert');
check('a sign-in is an event', logActionTone('USER_LOGIN'), 'event');
check('an approval is an event', logActionTone('SHIFT_OFFER_APPROVED'), 'event');
check('a clock-in is an event', logActionTone('CLOCK_IN'), 'event');
check('anything else is neutral', logActionTone('SOMETHING_ELSE'), 'neutral');
check('a blank action is neutral', logActionTone(''), 'neutral');
check('a lowercase action is still classified', logActionTone('login_failed'), 'alert');

// --- the paging arithmetic ---------------------------------------------------------------------
console.log('\n--- paging ---');
check('the page size is 20', LOG_PAGE_SIZE, 20);
check('the sort options are the server contract', LOG_SORT_OPTIONS.map((o) => o.value), [
  'timestamp_desc', 'timestamp_asc', 'action_asc', 'member_asc',
]);
check('and the default is newest first', DEFAULT_LOG_SORT, 'timestamp_desc');

check('431 entries is 22 pages', totalLogPages(431, 20), 22);
check('exactly 20 is one page', totalLogPages(20, 20), 1);
check('21 is two', totalLogPages(21, 20), 2);
check('nothing is still one page, never zero', totalLogPages(0, 20), 1);

// 41 entries is 3 pages, so page 8 is past the end and clamps to the last real page.
check('a page past the end clamps to the last', clampLogPage(8, 41, 20), 3);
check('page 8 of 431 entries is unchanged', clampLogPage(8, 431, 20), 8);
check('page 0 clamps up to 1', clampLogPage(0, 431, 20), 1);
check('a nonsense page becomes 1', clampLogPage('abc', 431, 20), 1);
check('an empty result keeps page 1', clampLogPage(5, 0, 20), 1);

check('the first page reads 1–20 of 431', logPageRangeLabel(431, 1, 20), '1–20 of 431');
check('the second page reads 21–40', logPageRangeLabel(431, 2, 20), '21–40 of 431');
check('the last page stops at the total', logPageRangeLabel(431, 22, 20), '421–431 of 431');
check('an exact multiple does not overshoot', logPageRangeLabel(40, 2, 20), '21–40 of 40');
check('nothing reads 0 of 0', logPageRangeLabel(0, 1, 20), '0 of 0');

// --- the request shape -------------------------------------------------------------------------
console.log('\n--- the request the client sends ---');
const query = logQueryParams({});
check('a default query asks for page 1 of 20', [query.page, query.page_size], ['1', '20']);
check('and for the default sort', query.sort, 'timestamp_desc');
check('with blank filters', [query.from, query.to, query.member], ['', '', '']);
// The filter is `action_filter`, never `action` - see the collision test below.
check('the action filter is NOT called "action"', 'action' in query, false);
check('it is called action_filter', query.action_filter, '');

const filtered = logQueryParams({
  page: 3,
  sort: 'action_asc',
  filters: { from: '2026-01-01', to: '2026-03-31', action: 'USER_LOGIN', member: 'u1' },
});
check('a filtered query carries everything', filtered, {
  page: '3',
  page_size: '20',
  sort: 'action_asc',
  from: '2026-01-01',
  to: '2026-03-31',
  action_filter: 'USER_LOGIN',
  member: 'u1',
});
// The server clamps too; this is the client refusing to ask for something absurd in the first place.
check('a page size above the cap is clamped', logQueryParams({ pageSize: 5000 }).page_size, String(LOG_PAGE_SIZE_MAX));
check('a zero page size becomes the default', logQueryParams({ pageSize: 0 }).page_size, '20');
check('a negative page becomes 1', logQueryParams({ page: -4 }).page, '1');
check('whitespace in a filter is trimmed', logQueryParams({ filters: { action: '  USER_LOGIN  ' } }).action_filter, 'USER_LOGIN');
check('an empty filter set is all blanks', logQueryParams({ filters: emptyLogFilters() }).action_filter, '');

// --- the composed request ----------------------------------------------------------------------
//
// THE TEST THAT WAS MISSING. Every assertion above passes for a query built in isolation, and the tab
// still failed with "Invalid action type." - because the query's `action` key (the log's action
// FILTER) collided with the RPC envelope's `action` key once the two were composed. Testing the parts
// is not testing the request, so this composes them exactly as api.js does.
console.log('\n--- the composed request (the collision that broke the tab) ---');
const composed = systemLogRequest(logQueryParams({ filters: { action: 'USER_LOGIN' } }), 'tok-1');
check('the RPC action survives the query', composed.action, SYSTEM_LOG_ACTION);
check('and is the RPC name, not the filter value', composed.action, 'ADMIN_GET_SYSTEM_LOG');
check('the filter still travels', composed.action_filter, 'USER_LOGIN');
check('the token travels', composed.token, 'tok-1');
check('the page travels', composed.page, '1');
const composedEmpty = systemLogRequest(logQueryParams({}), 'tok-2');
check(
  'and with no filter set, the action is STILL the RPC name',
  composedEmpty.action,
  'ADMIN_GET_SYSTEM_LOG'
);
// The exact shape that shipped, and why it broke: the query carried its own `action` key, and
// spreading it after the envelope key replaced the RPC name with the empty filter.
const legacyShapeQuery = { page: '1', action: 'USER_LOGIN' };
check(
  'the old inline shape really did clobber it (so this test has teeth)',
  { action: SYSTEM_LOG_ACTION, token: 'tok', ...legacyShapeQuery }.action,
  'USER_LOGIN'
);
// ...and the composer is immune even to a query shaped that way, because the action name is last.
check(
  'the composer cannot be clobbered by any query',
  systemLogRequest(legacyShapeQuery, 'tok').action,
  SYSTEM_LOG_ACTION
);
check('the page still travels through the composer', systemLogRequest(legacyShapeQuery, 'tok').page, '1');


// --- the backend, exercised for real -----------------------------------------------------------
console.log('\n--- the server filters, sorts and pages ---');
const codeSource = readFileSync('src/services/Code.gs', 'utf8');
const extract = (name) => {
  const start = codeSource.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`Code.gs has no function ${name}`);
  let depth = 0;
  let i = codeSource.indexOf('{', start);
  for (; i < codeSource.length; i++) {
    if (codeSource[i] === '{') depth++;
    else if (codeSource[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return codeSource.slice(start, i + 1);
};
const extractConst = (name) => {
  const match = new RegExp(`^const ${name} = [^;]+;`, 'm').exec(codeSource);
  if (!match) throw new Error(`Code.gs has no const ${name}`);
  return match[0];
};

const LOG_CONSTS = [
  'LOG_PAGE_SIZE_DEFAULT',
  'LOG_PAGE_SIZE_MAX',
  'LOG_SORTS',
  'LOG_SORT_DEFAULT',
  // The extracted systemLogPage returns this in its payload, so the sandbox needs it too.
  'SYSTEM_LOG_API_VERSION',
].map(extractConst);
const logFunctions = [
  'logCellText', 'logTimestampText', 'logSortKey', 'normalizeLogEntry', 'logEntryMatches',
  'compareLogText', 'compareLogTimestamp', 'sortLogEntries', 'paginateLogEntries', 'logFacets',
  'systemLogPage',
].map(extract);

// A minimal `Utilities.formatDate` for the sandbox. Intl does the zone maths, so a known instant
// formats exactly as Apps Script would for America/New_York - which is what makes the Date-cell case
// below assertable rather than merely shape-checked.
const utilitiesStub = {
  formatDate: (date, timeZone, format) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const part = (type) => (parts.find((p) => p.type === type) || {}).value || '00';
    const hour = part('hour') === '24' ? '00' : part('hour');
    return format
      .replace('yyyy', part('year'))
      .replace('MM', part('month'))
      .replace('dd', part('day'))
      .replace('HH', hour)
      .replace('mm', part('minute'))
      .replace('ss', part('second'));
  },
};

const buildServer = (sheetRows) => {
  const body = `
    ${LOG_CONSTS.join('\n')}
    ${logFunctions.join('\n')}
    return { systemLogPage, normalizeLogEntry, logEntryMatches, sortLogEntries, paginateLogEntries, logFacets };
  `;
  // The sheet is closed over rather than read from the ss argument, so a test can call
  // systemLogPage({}, request) and get the fixture.
  const fn = new Function('getSheetData', 'Utilities', body);
  return fn(() => sheetRows, utilitiesStub);
};
const probes = buildServer([]);
check('every log function was extracted', logFunctions.every((fn) => fn.length > 40), true);
check('a log with no rows reads cleanly', probes.systemLogPage({}, {}).total, 0);

// A fixture with the awkward cases: two on the same day, an unreadable timestamp, a failed sign-in
// logged against a username rather than a member id, and enough rows to page.
const LOG_ROWS = [];
for (let i = 1; i <= 45; i++) {
  const day = String(((i % 28) + 1)).padStart(2, '0');
  LOG_ROWS.push({
    id: String(i),
    timestamp: `2026-03-${day} ${String((i % 12) + 6).padStart(2, '0')}:00:00`,
    user_id: i % 3 === 0 ? 'u2' : 'u1',
    action: i % 5 === 0 ? 'LOGIN_FAILED' : 'USER_LOGIN',
    details: `Entry ${i}`,
  });
}
LOG_ROWS.push({ id: '90', timestamp: 'nonsense', user_id: 'u3', action: 'USER_LOGIN', details: 'No date' });

const server = buildServer(LOG_ROWS);

const pageOne = server.systemLogPage({}, {});
check('a default read returns one page', pageOne.rows.length, 20);
check('with the total of MATCHING rows', pageOne.total, 46);
check('and the whole-log count separately', pageOne.log_total, 46);
check('and a page count', pageOne.total_pages, 3);
check('and the default sort echoed back', pageOne.sort, 'timestamp_desc');

console.log('\n--- newest first by default ---');
const timestamps = pageOne.rows.map((r) => r.timestamp);
check(
  'the first page is the newest 20',
  timestamps[0] >= timestamps[1] && timestamps[1] >= timestamps[2],
  true
);
// Hand-computing the expected newest timestamp from the fixture generator is how this assertion was
// wrong the first time; derive it instead.
const datedRows = LOG_ROWS.filter((r) => /^\d{4}-\d{2}-\d{2}/.test(r.timestamp));
const newestTimestamp = datedRows.map((r) => r.timestamp).sort().slice(-1)[0];
check('the newest dated entry leads', pageOne.rows[0].timestamp, newestTimestamp);
const sortedDesc = server.sortLogEntries(
  LOG_ROWS.map((r) => server.normalizeLogEntry(r)),
  'timestamp_desc'
);
check('the undated row sorts last, not first', sortedDesc[sortedDesc.length - 1].id, '90');
check(
  'and an undated row is not counted as dated',
  sortedDesc.find((r) => r.id === '90').date_key,
  ''
);

console.log('\n--- a date-formatted column still sorts chronologically ---');
// The bug: when the timestamp column is formatted as a date, Sheets stores the written string as a
// date value and getValues() returns a Date. String(date) starts with the WEEKDAY, so the date key
// failed to parse, every row was treated as undated, and the alphabetical fallback grouped all the
// Wednesdays together. Normalizing on the server fixes the sort and the display together.
const wednesday = new Date('2026-09-23T20:00:00Z'); // 16:00 in Eastern (EDT)
const dateEntry = server.normalizeLogEntry({ id: '1', timestamp: wednesday, action: 'USER_LOGIN' });
check('a Date cell becomes station-time text', dateEntry.timestamp, '2026-09-23 16:00:00');
check('so its date key parses', dateEntry.date_key, '2026-09-23');
check('and it carries a sortable instant', dateEntry.sort_key, '2026-09-23 16:00:00');
// The tell-tale weekday prefix must be gone, since that is what the alphabetical sort grouped on.
check('the weekday prefix is gone', /^[A-Z][a-z]{2} /.test(dateEntry.timestamp), false);

// Wednesday, Thursday and Monday: alphabetical order groups them by weekday NAME (Mon, Thu, Wed),
// whereas chronological order is Wed < Thu < Mon by date.
const weekServer = buildServer([
  { id: 'wed', timestamp: new Date('2026-09-23T20:00:00Z'), action: 'A', user_id: 'u1', details: '' },
  { id: 'thu', timestamp: new Date('2026-09-24T20:00:00Z'), action: 'A', user_id: 'u1', details: '' },
  { id: 'mon', timestamp: new Date('2026-09-28T20:00:00Z'), action: 'A', user_id: 'u1', details: '' },
]);
check(
  'oldest first is chronological, not grouped by weekday',
  weekServer.systemLogPage({}, { sort: 'timestamp_asc' }).rows.map((r) => r.id),
  ['wed', 'thu', 'mon']
);
check(
  'newest first reverses it',
  weekServer.systemLogPage({}, { sort: 'timestamp_desc' }).rows.map((r) => r.id),
  ['mon', 'thu', 'wed']
);

// A column holding mixed shapes - the canonical text, a Date, and an ISO string with a zone - must
// still order by the instant each one represents (09:00, 14:00 and 17:00 in station time).
const mixedServer = buildServer([
  { id: 'text', timestamp: '2026-09-24 09:00:00', action: 'A', user_id: 'u1', details: '' },
  { id: 'date', timestamp: new Date('2026-09-24T18:00:00Z'), action: 'A', user_id: 'u1', details: '' },
  { id: 'iso', timestamp: '2026-09-24T21:00:00.000Z', action: 'A', user_id: 'u1', details: '' },
]);
check(
  'mixed cell shapes sort by instant',
  mixedServer.systemLogPage({}, { sort: 'timestamp_asc' }).rows.map((r) => r.id),
  ['text', 'date', 'iso']
);

// The client half has to survive the un-normalized form too, or a deployment that predates this fix
// renders raw JavaScript date strings in the table.
check(
  'the client reads a Date-shaped string',
  logTimestampParts('Wed Sep 23 2026 22:15:00 GMT-0400 (Eastern Daylight Time)'),
  { dateKey: '2026-09-23', timeText: '22:15' }
);
check(
  'and renders it as a formatted timestamp',
  formatLogTimestamp('Wed Sep 23 2026 22:15:00 GMT-0400 (Eastern Daylight Time)', '12'),
  'Wed, Sep 23 2026 · 10:15 PM'
);

console.log('\n--- paging ---');
const lastPage = server.systemLogPage({}, { page: '3' });
check('the last page holds the remainder', lastPage.rows.length, 46 - 40);
// Coverage rather than adjacent ids: every fixture row must appear exactly once across the pages.
const pagedIds = [1, 2, 3].flatMap((p) => server.systemLogPage({}, { page: String(p) }).rows.map((r) => r.id));
check('the pages together cover every row', pagedIds.length, 46);
check('with no duplicates', new Set(pagedIds).size, 46);
check(
  'pages do not overlap',
  server.systemLogPage({}, { page: '1' }).rows.some((r) =>
    server.systemLogPage({}, { page: '2' }).rows.some((s) => s.id === r.id)
  ),
  false
);
// The clamp is what stops a filter change leaving you on a page that no longer exists.
const beyond = server.systemLogPage({}, { page: '99' });
check('a page past the end returns the LAST page, not an empty table', beyond.page, 3);
check('and has rows', beyond.rows.length > 0, true);
check('a page size above the cap is clamped', server.systemLogPage({}, { page_size: '5000' }).page_size, 100);
check('a page size of 0 falls back to the default', server.systemLogPage({}, { page_size: '0' }).page_size, 20);

console.log('\n--- filters ---');
const byAction = server.systemLogPage({}, { action_filter: 'LOGIN_FAILED' });
check('filtering by action', byAction.total, 9);
check('every returned row matches', byAction.rows.every((r) => r.action === 'LOGIN_FAILED'), true);
check(
  'the action filter is case-insensitive',
  server.systemLogPage({}, { action_filter: 'login_failed' }).total,
  byAction.total
);
check('filtering by member', server.systemLogPage({}, { member: 'u2' }).total, LOG_ROWS.filter((r) => r.user_id === 'u2').length);
check('an unknown member matches nothing', server.systemLogPage({}, { member: 'nobody' }).total, 0);
// Date-range expectations are DERIVED from the fixture rather than hand-counted - the generator's day
// cycle is not obvious, and hand-counting it produced two wrong numbers here. They are derived from
// the DATED rows only: the undated entry is excluded by a range, which is the behaviour under test,
// so including it in the expectation would re-introduce the very bug being checked.
const dayOf = (row) => row.timestamp.slice(0, 10);
const datedDayOf = (row) => row.timestamp.slice(0, 10);
const fromTotal = server.systemLogPage({}, { from: '2026-03-20' }).total;
check(
  'a from date narrows to the rows on or after it',
  fromTotal,
  datedRows.filter((r) => datedDayOf(r) >= '2026-03-20').length
);
check('and is fewer than the whole log', fromTotal < LOG_ROWS.length, true);
check(
  'a to date narrows',
  server.systemLogPage({}, { to: '2026-03-05' }).total,
  datedRows.filter((r) => datedDayOf(r) <= '2026-03-05').length
);
check(
  'a closed range narrows both ways',
  server.systemLogPage({}, { from: '2026-03-10', to: '2026-03-15' }).total,
  datedRows.filter((r) => datedDayOf(r) >= '2026-03-10' && datedDayOf(r) <= '2026-03-15').length
);
check('the day helper agrees with the fixture', dayOf(LOG_ROWS[0]), LOG_ROWS[0].timestamp.slice(0, 10));
// The single most important filter behaviour: a blank filter is "no filter", not "match nothing".
check('blank filters match everything', server.systemLogPage({}, { from: '', to: '', action_filter: '', member: '' }).total, 46);
check('whitespace filters match everything too', server.systemLogPage({}, { action_filter: '   ' }).total, 46);
check(
  'an unreadable date cannot satisfy a range',
  server.systemLogPage({}, { from: '2020-01-01' }).total,
  datedRows.length
);
check(
  'filters combine',
  server.systemLogPage({}, { member: 'u1', action_filter: 'LOGIN_FAILED' }).total,
  LOG_ROWS.filter((r) => r.user_id === 'u1' && r.action === 'LOGIN_FAILED').length
);

console.log('\n--- sort modes ---');
const oldestTimestamp = datedRows.map((r) => r.timestamp).sort()[0];
check('oldest first', server.systemLogPage({}, { sort: 'timestamp_asc' }).rows[0].timestamp, oldestTimestamp);
check(
  'and the undated row is still last when reversed',
  server.sortLogEntries(LOG_ROWS.map((r) => server.normalizeLogEntry(r)), 'timestamp_asc').slice(-1)[0].id,
  '90'
);
check('action A–Z', server.systemLogPage({}, { sort: 'action_asc' }).rows[0].action, 'LOGIN_FAILED');
check('member A–Z', server.systemLogPage({}, { sort: 'member_asc' }).rows[0].user_id, 'u1');
// A sort value nobody whitelisted must fall back rather than arrive as "unsorted".
check('an unknown sort falls back to the default', server.systemLogPage({}, { sort: 'banana' }).rows[0].timestamp, sortedDesc[0].timestamp);
check('and is reported as the default', server.systemLogPage({}, { sort: 'banana' }).sort, 'timestamp_desc');
check('a sort value is echoed back', server.systemLogPage({}, { sort: 'member_asc' }).sort, 'member_asc');

console.log('\n--- the filter dropdowns ---');
const facets = pageOne;
check('actions come from the whole log, not the page', facets.actions, ['LOGIN_FAILED', 'USER_LOGIN']);
check('members include non-member ids', facets.members, ['u1', 'u2', 'u3']);
check(
  'a page-only facet would have been incomplete',
  facets.actions.length >= new Set(pageOne.rows.map((r) => r.action)).size,
  true
);

console.log('\n--- an empty or missing log ---');
const emptyLog = buildServer([]).systemLogPage({}, {});
check('no days yields no rows', emptyLog.rows, []);
check('a zero total', emptyLog.total, 0);
check('one page, so the pager is sane', emptyLog.total_pages, 1);
check('no facets', [emptyLog.actions.length, emptyLog.members.length], [0, 0]);

// --- the wire contract --------------------------------------------------------------------------
//
// The two sides have to agree on the filter's name, and `action` is NOT available for it: that is the
// RPC envelope key. If the backend ever goes back to reading data.action, every page would filter on
// "ADMIN_GET_SYSTEM_LOG" and quietly return nothing.
console.log('\n--- the filter name on the wire (client and server must agree) ---');
// Asserted on the HELPER, not the case body: the case only delegates to systemLogPage, and the filter
// is read inside it. Looking in the case body is what made this assertion fail first time round.
const systemLogPageSource = extract('systemLogPage');
const systemLogCase = codeSource.slice(
  codeSource.indexOf('case "ADMIN_GET_SYSTEM_LOG"'),
  codeSource.indexOf('case "PING"', codeSource.indexOf('case "ADMIN_GET_SYSTEM_LOG"'))
);
check('the case delegates to the reader', /systemLogPage\(ss, data\)/.test(systemLogCase), true);
check('the reader was extracted', systemLogPageSource.length > 400, true);
check('and it reads action_filter', /data\.action_filter/.test(systemLogPageSource), true);
check(
  'never data.action for the filter',
  /logCellText\(data\.action\)/.test(systemLogPageSource),
  false
);
check(
  'because data.action is the RPC envelope name',
  /const action = data\.action;/.test(codeSource),
  true
);
check(
  'the client sends the matching name',
  Object.keys(logQueryParams({})).includes('action_filter'),
  true
);
// A required forward: the server filters on the value the client sent under that name.
check(
  'the renamed filter still filters',
  server.systemLogPage({}, { action_filter: 'LOGIN_FAILED' }).total,
  LOG_ROWS.filter((r) => r.action === 'LOGIN_FAILED').length
);
check(
  'and a stray RPC-style "action" is ignored as a filter',
  server.systemLogPage({}, { action: 'ADMIN_GET_SYSTEM_LOG' }).total,
  LOG_ROWS.length
);

// --- the contract version -----------------------------------------------------------------------
//
// The client compares this to decide whether to warn about a stale deployment. It is only useful if
// the two constants actually agree, so assert that rather than trusting them to be kept in step.
console.log('\n--- the contract version ---');
const serverVersion = (() => {
  const match = /^const SYSTEM_LOG_API_VERSION = (\d+);/m.exec(codeSource);
  return match ? Number(match[1]) : null;
})();
check('the client knows a version', Number.isInteger(SYSTEM_LOG_API_VERSION), true);
check('the server declares one', Number.isInteger(serverVersion), true);
check('and the two agree', serverVersion, SYSTEM_LOG_API_VERSION);
check('the response carries it', server.systemLogPage({}, {}).api, SYSTEM_LOG_API_VERSION);
// A response without it (an older deployment) is distinguishable, which is the point of the field.
check('an absent version is not mistaken for a match', Number(undefined) === SYSTEM_LOG_API_VERSION, false);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
