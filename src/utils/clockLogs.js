// Filtering, sorting and totals for clock entries.
//
// Shared by My Clock History and Administration -> Clock Management, which is the point: both screens
// let a reader narrow the same list, and two hand-written comparators drift (a missing time_in sorting
// to the top of "oldest first" in one view and the bottom in the other is exactly the class of bug this
// avoids). The logic lives here, the screens only hold the filter state and render.
//
// `time_in` / `time_out` arrive as Eastern wall-clock text ("yyyy-MM-dd HH:mm:ss"), so the date range
// compares yyyy-MM-dd keys via parseSheetDateKey - the same helper the schedule uses - rather than
// round-tripping through Date and picking up the browser's timezone.

import { parseSheetDateKey } from './scheduleDate';

export const DEFAULT_CLOCK_LOG_SORT = 'time_in_desc';

export const CLOCK_LOG_SORT_OPTIONS = [
  { value: 'time_in_desc', label: 'Time In (Newest First)' },
  { value: 'time_in_asc', label: 'Time In (Oldest First)' },
  { value: 'duration_desc', label: 'Duration (Longest First)' },
  { value: 'name_asc', label: 'Member Name (A-Z)' },
];

export const CLOCK_LOG_STATUS_OPTIONS = [
  { value: 'all', label: 'All Entries' },
  { value: 'active', label: 'Active (Clocked In)' },
  { value: 'completed', label: 'Completed' },
];

// An empty filter set, for a component's initial state. `status: 'all'` is the "no filter" value,
// matching the select's own value rather than an empty string.
export const emptyClockLogFilters = () => ({
  userId: '',
  status: 'all',
  from: '',
  to: '',
  sortBy: DEFAULT_CLOCK_LOG_SORT,
});

const text = (value) => String(value ?? '').trim();

// The instant an entry started, as milliseconds, or null when it is unreadable.
export const clockLogStartedAt = (log) => {
  const raw = log?.time_in;
  if (raw === undefined || raw === null || raw === '') return null;
  const parsed = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

// Duration in hours: the sheet's own calc_hours when it is a usable number, otherwise measured from the
// two timestamps so a completed entry with a blank calc_hours still contributes.
export const clockLogHours = (log) => {
  const stored = parseFloat(log?.calc_hours);
  if (Number.isFinite(stored)) return stored;

  const start = clockLogStartedAt(log);
  const end = log?.time_out ? new Date(log.time_out).getTime() : NaN;
  if (start === null || !Number.isFinite(end) || end < start) return null;
  return (end - start) / 3600000;
};

// Newest first by default. An entry with no readable start sorts LAST in both directions: it is not the
// newest entry, and it is not the oldest either - it is unknown, and burying it is friendlier than
// letting a malformed row head the list.
const compareStart = (a, b, direction) => {
  const aTime = clockLogStartedAt(a);
  const bTime = clockLogStartedAt(b);
  if (aTime === null && bTime === null) return 0;
  if (aTime === null) return 1;
  if (bTime === null) return -1;
  return (aTime - bTime) * direction;
};

const compareHours = (a, b) => {
  const aHours = clockLogHours(a);
  const bHours = clockLogHours(b);
  if (aHours === null && bHours === null) return 0;
  if (aHours === null) return 1;
  if (bHours === null) return -1;
  return bHours - aHours;
};

const nameOf = (log, users) => {
  const match = (users || []).find((user) => String(user?.id) === String(log?.user_id));
  return text(match?.name || log?.user_name || '');
};

const comparatorFor = (sortBy, users) => {
  switch (sortBy) {
    case 'time_in_asc':
      return (a, b) => compareStart(a, b, 1);
    case 'duration_desc':
      return (a, b) => compareHours(a, b) || compareStart(a, b, -1);
    case 'name_asc':
      return (a, b) => {
        const aName = nameOf(a, users);
        const bName = nameOf(b, users);
        if (aName === bName) return compareStart(a, b, -1);
        if (!aName) return 1;
        if (!bName) return -1;
        return aName.localeCompare(bName);
      };
    case 'time_in_desc':
    default:
      return (a, b) => compareStart(a, b, -1);
  }
};

// The entries matching a filter set, in the chosen order.
//
// `from` / `to` are yyyy-MM-dd date keys and either end may be left open. An entry whose start date
// cannot be read is excluded by a date filter rather than silently included, because it cannot be shown
// to fall inside the range the reader asked for.
export const filterAndSortClockLogs = (logs, filters = {}, { users = [] } = {}) => {
  const userId = text(filters.userId);
  const status = text(filters.status) || 'all';
  const from = text(filters.from);
  const to = text(filters.to);
  const sortBy = text(filters.sortBy) || DEFAULT_CLOCK_LOG_SORT;

  const matched = (Array.isArray(logs) ? logs : []).filter((log) => {
    if (!log) return false;
    if (userId && String(log.user_id) !== userId) return false;
    if (status === 'active' && log.time_out) return false;
    if (status === 'completed' && !log.time_out) return false;

    if (from || to) {
      const dateKey = parseSheetDateKey(log.time_in);
      if (!dateKey) return false;
      if (from && dateKey < from) return false;
      if (to && dateKey > to) return false;
    }

    return true;
  });

  // Ties keep their existing order rather than being reshuffled, so an unfiltered view stays stable.
  return matched.sort(comparatorFor(sortBy, users));
};

// What the filtered entries add up to. `hours` is the number the summary cards show, and it is computed
// from the SAME rows the table lists - a total over a different set than the one on screen would be
// worse than no total.
export const clockLogTotals = (logs) => {
  const list = (Array.isArray(logs) ? logs : []).filter(Boolean);
  let hours = 0;
  let activeCount = 0;

  list.forEach((log) => {
    const value = clockLogHours(log);
    if (value !== null) hours += value;
    if (!log.time_out) activeCount++;
  });

  // Guard the floating-point sum: 0.1 + 0.2 hours should read as 0.3, not 0.30000000000000004.
  return { count: list.length, hours: Math.round(hours * 100) / 100, activeCount };
};

// "0 hrs", "1 hr", "12.5 hrs". Unlike the shared duration formatter this accepts zero, because a
// filtered view with nothing in it legitimately totals nothing.
export const formatClockHours = (hours) => {
  const value = Number(hours);
  if (!Number.isFinite(value) || value <= 0) return '0 hrs';
  const rounded = Math.round(value * 100) / 100;
  return `${rounded} ${rounded === 1 ? 'hr' : 'hrs'}`;
};

// True when anything is narrowed, for a "Clear filters" affordance. A non-default sort counts too,
// since the list is then not in the order it opens with.
export const hasClockLogFilters = (filters = {}) => {
  const status = text(filters.status);
  return Boolean(
    text(filters.userId) ||
      text(filters.from) ||
      text(filters.to) ||
      (status && status !== 'all') ||
      (text(filters.sortBy) && text(filters.sortBy) !== DEFAULT_CLOCK_LOG_SORT)
  );
};
