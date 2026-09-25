/**
 * Verifies clock-entry filtering, sorting and totals (utils/clockLogs).
 *
 * This logic is shared by My Clock History and Administration -> Clock Management, so a bug here is a
 * bug in two screens. The comparators are where the subtle faults live, and each one is pinned:
 *
 *   - an entry with an unreadable time_in must sort LAST in BOTH directions. The admin tab used to
 *     coerce a bad timestamp to 0, which put a malformed row at the TOP of "oldest first".
 *   - the date range compares Eastern yyyy-MM-dd keys, not Date instants, because time_in arrives as
 *     wall-clock text ("yyyy-MM-dd HH:mm:ss") with no timezone marker.
 *   - hours fall back to measuring the two timestamps, so a completed entry with a blank calc_hours
 *     still contributes to the total.
 *
 * Run with: npm run verify:clock-logs
 */
import { readFileSync } from 'node:fs';
import {
  DEFAULT_CLOCK_LOG_SORT,
  clockLogHours,
  clockLogTotals,
  emptyClockLogFilters,
  filterAndSortClockLogs,
  formatClockHours,
  hasClockLogFilters,
} from '../src/utils/clockLogs.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${
      ok ? '' : ` (expected ${JSON.stringify(expected)})`
    }`
  );
};

const log = (overrides = {}) => ({
  id: '1',
  user_id: '10',
  time_in: '2026-03-10 08:00:00',
  time_out: '2026-03-10 16:00:00',
  calc_hours: '8',
  ...overrides,
});

const users = [
  { id: '10', name: 'Member 1' },
  { id: '11', name: 'Member 3' },
];

const ids = (list) => list.map((entry) => entry.id);

console.log('--- hours ---');
check('a stored number wins', clockLogHours(log({ calc_hours: 8 })), 8);
check('a stored string is parsed', clockLogHours(log({ calc_hours: '7.5' })), 7.5);
check('a blank calc_hours is measured from the timestamps', clockLogHours(log({ calc_hours: '' })), 8);
check('so is a junk value', clockLogHours(log({ calc_hours: 'n/a' })), 8);
check('an unfinished entry has no hours', clockLogHours(log({ calc_hours: '', time_out: '' })), null);
check('a backwards entry has no hours', clockLogHours(log({ calc_hours: '', time_out: '2026-03-10 07:00:00' })), null);
check('and an unreadable start has none', clockLogHours(log({ calc_hours: '', time_in: 'nonsense' })), null);

console.log('\n--- sorting ---');
const spread = [
  log({ id: 'a', time_in: '2026-03-10 08:00:00', calc_hours: '2' }),
  log({ id: 'b', time_in: '2026-03-12 08:00:00', calc_hours: '10' }),
  log({ id: 'c', time_in: '2026-03-11 08:00:00', calc_hours: '5' }),
  log({ id: 'd', user_id: '11', time_in: '2026-03-09 08:00:00', calc_hours: '1' }),
];

check('newest first by default', ids(filterAndSortClockLogs(spread, {})), ['b', 'c', 'a', 'd']);
check('the default is applied when none is given', ids(filterAndSortClockLogs(spread, { sortBy: '' })), ['b', 'c', 'a', 'd']);
check('oldest first', ids(filterAndSortClockLogs(spread, { sortBy: 'time_in_asc' })), ['d', 'a', 'c', 'b']);
check('longest duration first', ids(filterAndSortClockLogs(spread, { sortBy: 'duration_desc' })), ['b', 'c', 'a', 'd']);
// Within one name the entries stay newest-first, so "by member" does not scramble each member's own
// entries. Member 1 holds a/b/c and Member 3 holds d, hence b,c,a then d.
check('member name A-Z keeps each member in date order', ids(filterAndSortClockLogs(spread, { sortBy: 'name_asc' }, { users })), ['b', 'c', 'a', 'd']);
check('an unknown sort falls back to the default', ids(filterAndSortClockLogs(spread, { sortBy: 'nope' })), ['b', 'c', 'a', 'd']);

// The regression the shared helper fixes: the admin tab coerced a bad timestamp to 0, which sorted a
// malformed row FIRST under "oldest first".
const withBad = [log({ id: 'good', time_in: '2026-03-10 08:00:00' }), log({ id: 'bad', time_in: 'nonsense' })];
check('an unreadable time sorts last, newest first', ids(filterAndSortClockLogs(withBad, { sortBy: 'time_in_desc' })), ['good', 'bad']);
check('and last under oldest first too', ids(filterAndSortClockLogs(withBad, { sortBy: 'time_in_asc' })), ['good', 'bad']);
check('and last by duration', ids(filterAndSortClockLogs(withBad.map((l) => ({ ...l, calc_hours: '' })), { sortBy: 'duration_desc' })).slice(-1), ['bad']);
check('an unnamed member sorts last by name', ids(filterAndSortClockLogs([log({ id: 'x', user_id: '99' }), log({ id: 'y' })], { sortBy: 'name_asc' }, { users })), ['y', 'x']);

check('sorting does not mutate the input', ids(spread), ['a', 'b', 'c', 'd']);
check('the sort is stable for equal timestamps', ids(filterAndSortClockLogs([log({ id: 'first' }), log({ id: 'second' })], {})), ['first', 'second']);

console.log('\n--- filtering ---');
const mixed = [
  log({ id: 'mine-done', user_id: '10', time_in: '2026-03-10 08:00:00', time_out: '2026-03-10 16:00:00', calc_hours: '8' }),
  log({ id: 'mine-active', user_id: '10', time_in: '2026-03-12 08:00:00', time_out: '', calc_hours: '' }),
  log({ id: 'theirs-done', user_id: '11', time_in: '2026-03-11 08:00:00', time_out: '2026-03-11 12:00:00', calc_hours: '4' }),
];

check('no filters keeps everything', filterAndSortClockLogs(mixed, {}).length, 3);
check('the default status is "all"', filterAndSortClockLogs(mixed, { status: 'all' }).length, 3);
check('by member', ids(filterAndSortClockLogs(mixed, { userId: '10' })), ['mine-active', 'mine-done']);
check('a member id is compared as text', ids(filterAndSortClockLogs(mixed, { userId: 10 })), ['mine-active', 'mine-done']);
check('active only', ids(filterAndSortClockLogs(mixed, { status: 'active' })), ['mine-active']);
check('completed only', ids(filterAndSortClockLogs(mixed, { status: 'completed' })), ['theirs-done', 'mine-done']);
check('member and status together', ids(filterAndSortClockLogs(mixed, { userId: '10', status: 'completed' })), ['mine-done']);
check('an unknown status is treated as "all"', filterAndSortClockLogs(mixed, { status: 'nonsense' }).length, 3);

console.log('\n--- the date range ---');
// Eastern wall-clock text, so the KEY is the date the entry happened on, with no timezone guessing.
check('an open start', ids(filterAndSortClockLogs(mixed, { from: '2026-03-11' })), ['mine-active', 'theirs-done']);
check('an open end', ids(filterAndSortClockLogs(mixed, { to: '2026-03-10' })), ['mine-done']);
check('both ends', ids(filterAndSortClockLogs(mixed, { from: '2026-03-11', to: '2026-03-11' })), ['theirs-done']);
check('a range with nothing in it', filterAndSortClockLogs(mixed, { from: '2027-01-01' }).length, 0);
check('both ends on the same day includes that day', ids(filterAndSortClockLogs(mixed, { from: '2026-03-10', to: '2026-03-10' })), ['mine-done']);

// An entry whose date cannot be read cannot be shown to fall inside the range, so a date filter
// excludes it rather than quietly including it.
const undated = [log({ id: 'ok', time_in: '2026-03-10 08:00:00' }), log({ id: 'bad', time_in: 'nonsense' })];
check('an unreadable date is excluded by a range', ids(filterAndSortClockLogs(undated, { from: '2026-03-01' })), ['ok']);
check('but kept when no range is set', ids(filterAndSortClockLogs(undated, {})), ['ok', 'bad']);

console.log('\n--- totals ---');
const totals = clockLogTotals(mixed);
check('the entry count', totals.count, 3);
check('the hours sum', totals.hours, 12);
check('the active count', totals.activeCount, 1);
check('an empty list totals zero', clockLogTotals([]), { count: 0, hours: 0, activeCount: 0 });
check('nulls are ignored', clockLogTotals([null, undefined, mixed[0]]).count, 1);
check('a non-array is safe', clockLogTotals(null).count, 0);

// The floating-point sum a naive reduce produces.
check(
  'the sum is rounded to 2dp',
  clockLogTotals([log({ calc_hours: '0.1' }), log({ calc_hours: '0.2' })]).hours,
  0.3
);
check(
  'an unreadable duration contributes nothing rather than breaking the total',
  clockLogTotals([log({ calc_hours: '', time_out: '' }), log({ calc_hours: '5' })]).hours,
  5
);

console.log('\n--- formatting and the clear-filters flag ---');
check('zero', formatClockHours(0), '0 hrs');
check('one is singular', formatClockHours(1), '1 hr');
check('a fraction', formatClockHours(12.5), '12.5 hrs');
check('a long value is rounded', formatClockHours(12.345), '12.35 hrs');
check('nonsense reads as zero', formatClockHours('n/a'), '0 hrs');

check('a fresh filter set is not filtered', hasClockLogFilters(emptyClockLogFilters()), false);
check('and the default sort is the default', emptyClockLogFilters().sortBy, DEFAULT_CLOCK_LOG_SORT);
check('a member narrows it', hasClockLogFilters({ ...emptyClockLogFilters(), userId: '10' }), true);
check('a date narrows it', hasClockLogFilters({ ...emptyClockLogFilters(), from: '2026-03-01' }), true);
check('a status narrows it', hasClockLogFilters({ ...emptyClockLogFilters(), status: 'active' }), true);
check('"all" does not count as narrowing', hasClockLogFilters({ ...emptyClockLogFilters(), status: 'all' }), false);
check('a non-default sort counts', hasClockLogFilters({ ...emptyClockLogFilters(), sortBy: 'time_in_asc' }), true);

console.log('\n--- both screens share this logic ---');
for (const path of ['src/components/MyClockHistory.jsx', 'src/components/admin/AdminClockManagementTab.jsx']) {
  const source = readFileSync(path, 'utf8');
  check(`${path} uses the shared filter`, source.includes('filterAndSortClockLogs('), true);
  check(`${path} has no comparator of its own`, /\.sort\(\(a, b\)/.test(source), false);
  check(`${path} takes the sort options from the shared list`, source.includes('CLOCK_LOG_SORT_OPTIONS'), true);
}

const memberSource = readFileSync('src/components/MyClockHistory.jsx', 'utf8');
check('the member view totals the filtered rows', memberSource.includes('clockLogTotals(visibleLogs)'), true);
check('and labels the cards when filtered', memberSource.includes("Total Hours Logged{isFiltered ? ' (filtered)' : ''}"), true);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
