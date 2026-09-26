import { displayDate } from './scheduleDate';
import { formatClock } from './shiftTime';
import { toTimeInputValue } from './timeInputValue';

// The System Log tab: reading the `system_log` sheet.
//
// The log grows without bound, so the filtering, sorting and paging all happen SERVER-side and the
// client only ever holds one page. That is what keeps opening the tab cheap. The consequence is that
// every filter, sort or page change is one request - which is why the tab shows the spinner for each
// one rather than pretending to be instant.
//
// The display side of the System Log: parsing the stored timestamp, and building the request so the client
// and the backend agree on the parameter names. The paging arithmetic is shared with the events list
// (utils/pagination) so the footer's "1-20 of 431" is testable without a browser, and so two lists cannot
// mean different things by "page 3".
import { clampPage, pageRangeLabel, totalPages } from './pagination';

export const LOG_PAGE_SIZE = 20;

// The largest page a client may ask for. The server clamps to this too - never trust the request.
export const LOG_PAGE_SIZE_MAX = 100;

// Sorting is done by the backend, so these values are a contract rather than a client-side switch.
// The server whitelists them and falls back to the default, so a bad value can never arrive as
// "unsorted" (which would silently render the sheet's own row order).
export const LOG_SORT_OPTIONS = [
  { value: 'timestamp_desc', label: 'Timestamp (newest first)' },
  { value: 'timestamp_asc', label: 'Timestamp (oldest first)' },
  { value: 'action_asc', label: 'Action (A–Z)' },
  { value: 'member_asc', label: 'Member (A–Z)' },
];

export const DEFAULT_LOG_SORT = 'timestamp_desc';

// The RPC action name.
export const SYSTEM_LOG_ACTION = 'ADMIN_GET_SYSTEM_LOG';

// The request/response contract this client expects, matching SYSTEM_LOG_API_VERSION in Code.gs.
//
// The tab compares the two and says so when they differ, because the failure is otherwise invisible:
// a backend that reads the action filter under an older name returns an empty page, which looks
// exactly like an empty log rather than a deployment that needs updating.
export const SYSTEM_LOG_API_VERSION = 2;

export const emptyLogFilters = () => ({ from: '', to: '', action: '', member: '' });

const text = (value) => String(value ?? '').trim();

const MONTH_NUMBERS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

// The stored timestamp is written by `getEasternTimestamp()` as "yyyy-MM-dd HH:mm:ss" in station
// time. Both halves are needed separately: the date for filtering and display, the time for the
// 12/24-hour preference.
//
// A Date-shaped string is accepted as well. When the timestamp COLUMN is formatted as a date, Sheets
// hands the backend a Date object and `String(date)` is "Wed Sep 24 2026 22:15:00 GMT-0400 (…)" -
// weekday first. The backend normalizes that now, but a deployment that predates the fix still sends
// it, and the alternative is a table full of raw JavaScript date strings.
export const logTimestampParts = (value) => {
  const raw = text(value);
  if (raw === '') return { dateKey: '', timeText: '' };

  const match = raw.match(/^(\d{4}-\d{2}-\d{2})[T ]?(\d{2}:\d{2}(?::\d{2})?)?/);
  if (match) {
    return {
      dateKey: match[1],
      // Normalized through toTimeInputValue so formatClock gets an "HH:MM" it can read: it splits on
      // the colon, so handing it the whole "yyyy-MM-dd HH:mm:ss" would yield NaN.
      timeText: match[2] ? toTimeInputValue(match[2]) : '',
    };
  }

  // "Wed Sep 24 2026 22:15:00 GMT-0400 (Eastern Daylight Time)".
  const dated = raw.match(/^[A-Z][a-z]{2} ([A-Z][a-z]{2}) (\d{1,2}) (\d{4}) (\d{2}:\d{2}:\d{2})/);
  if (dated) {
    const month = MONTH_NUMBERS[dated[1].toLowerCase()];
    if (month) {
      return {
        dateKey: `${dated[3]}-${month}-${String(dated[2]).padStart(2, '0')}`,
        timeText: toTimeInputValue(dated[4]),
      };
    }
  }

  return { dateKey: '', timeText: '' };
};

// "Sat, Mar 14 2026 · 8:05 AM". `displayDate` alone omits the year, which a log needs - it can span
// several.
export const formatLogTimestamp = (value, timeFormat = '12') => {
  const { dateKey, timeText } = logTimestampParts(value);
  if (!dateKey) return text(value) || '—';

  const datePart = displayDate(dateKey);
  const year = dateKey.slice(0, 4);
  const clock = timeText ? formatClock(timeText, timeFormat) : '';

  return [datePart ? `${datePart} ${year}` : dateKey, clock].filter(Boolean).join(' · ');
};

// A log row, with the fields the table needs and nothing invented.
//
// `id` is coerced to a string so it can be a React key without a numeric/string mismatch. Unlike a
// training row, a log line is NOT dropped for having an odd id - the line itself is still evidence.
export const normalizeLogRow = (row) => {
  const source = row || {};
  const parts = logTimestampParts(source.timestamp);
  return {
    id: text(source.id),
    timestamp: text(source.timestamp),
    user_id: text(source.user_id),
    action: text(source.action),
    details: text(source.details),
    date_key: parts.dateKey,
    time_text: parts.timeText,
  };
};

export const normalizeLogRows = (rows) => (Array.isArray(rows) ? rows : []).map(normalizeLogRow);

// The request body for one page. Kept in one place so the parameter names cannot drift from what the
// backend reads, and so the query is inspectable in a test.
//
// The action FILTER travels as `action_filter`, NOT `action`.
//
// `action` is the RPC envelope key - every request in the app names its action that way - so a filter
// of the same name cannot coexist with it. It shipped as `action` and silently replaced the RPC name
// with the empty filter, which the backend answered with "Invalid action type.": the tab was
// completely broken while every unit test of this function passed, because the collision only exists
// once the query is composed into the envelope. Hence systemLogRequest below, which is tested for
// real. The component's own state key stays `action`, since that is what the filter is about.
export const logQueryParams = ({
  page = 1,
  sort = DEFAULT_LOG_SORT,
  filters = {},
  pageSize = LOG_PAGE_SIZE,
} = {}) => ({
  page: String(Math.max(1, Math.floor(Number(page) || 1))),
  page_size: String(
    Math.min(LOG_PAGE_SIZE_MAX, Math.max(1, Math.floor(Number(pageSize) || LOG_PAGE_SIZE)))
  ),
  sort: text(sort) || DEFAULT_LOG_SORT,
  from: text(filters.from),
  to: text(filters.to),
  action_filter: text(filters.action),
  member: text(filters.member),
});

// The complete request body: the RPC envelope plus the query.
//
// Composing the two here rather than at the call site is the point - it is the ONE place where the
// envelope and the query meet, so a name collision like the one above has somewhere to be caught.
// The action name is written last for the same reason: whatever the query contains, the RPC name
// cannot be shadowed.
export const systemLogRequest = (params = {}, token = '') => ({
  ...params,
  action: SYSTEM_LOG_ACTION,
  token,
});


// At least 1, so the footer never offers a range in a table with no pages. The arithmetic is shared with the
// events list (utils/pagination) rather than written twice: these are counts, not log entries.
export const totalLogPages = (total, pageSize = LOG_PAGE_SIZE) => totalPages(total, pageSize);

// Keeps the requested page inside the data. This matters after a filter change: page 8 of the old
// result may not exist in the new one, and asking for it would render an empty table.
export const clampLogPage = (page, total, pageSize = LOG_PAGE_SIZE) => clampPage(page, total, pageSize);

// "1–20 of 431", or "0 of 0" when there is nothing.
export const logPageRangeLabel = (total, page, pageSize = LOG_PAGE_SIZE) =>
  pageRangeLabel(total, page, pageSize);

// A color hint for the action badge, so a failure stands out from an ordinary event without reading
// every word. Deliberately coarse: three tones.
//
// Matched on TOKENS rather than substrings: a plain /LOCK/ test flags CLOCK_IN as an alert, because
// "CLOCK_IN" contains "LOCK". Splitting on underscores and matching each token from its start keeps
// CLOCK and LOCK apart, and still catches SHIFT_OFFER_DECLINED (tokens DECLINED) and USER_LOGIN.
const ALERT_TOKEN = /^(FAIL|ERROR|DENIED|UNAUTHORIZED|REJECT|DECLINE|DELETE|REMOVE|LOCK|STALE)/;
const EVENT_TOKEN = /^(LOGIN|APPROVE|SIGN|SAVE|SUBMIT|CREATE|UPDATE|CLOCK)/;

export const logActionTone = (action) => {
  const tokens = text(action).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (tokens.some((token) => ALERT_TOKEN.test(token))) return 'alert';
  if (tokens.some((token) => EVENT_TOKEN.test(token))) return 'event';
  return 'neutral';
};

export const LOG_ACTION_TONE_CLASSES = {
  alert:
    'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/60 dark:text-red-400 dark:border-red-800/70',
  event:
    'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800/70',
  neutral:
    'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-900/70 dark:text-slate-300 dark:border-slate-700',
};
