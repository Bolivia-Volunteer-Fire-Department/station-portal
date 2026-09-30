import { displayDate } from './scheduleDate';
import { formatClock } from './shiftTime';
import { toTimeInputValue } from './timeInputValue';

// Time formatting for the CLOCK log screens, which is all that is left of this module: the System Log tab it was
// written for is gone, along with its `system_log` collection, and the app's audits are Cloud Logging lines now (see
// `audit` in functions/index.js). What survives is the pair the clock history and the officer's clock management share -
// parsing a stored station-time timestamp, and formatting it for the reader's 12/24-hour preference - plus the sort
// labels those two screens offer.
//
// The name is now a little too broad for the contents. It is kept because the alternative is a rename across the clock
// screens and their harness, which is churn for no behaviour change.

// "unsorted" (which would silently render the sheet's own row order).
export const LOG_SORT_OPTIONS = [
  { value: 'timestamp_desc', label: 'Timestamp (newest first)' },
  { value: 'timestamp_asc', label: 'Timestamp (oldest first)' },
  { value: 'action_asc', label: 'Action (A–Z)' },
  { value: 'member_asc', label: 'Member (A–Z)' },
];

export const DEFAULT_LOG_SORT = 'timestamp_desc';

// The sorts the AUDIT LOG tab offers, which are the two the Logging API can do server-side. The shared list above is
// what the CLOCK screens offer, and it is shorter here on purpose: ordering by action or member needs the whole result
// in hand, and a paged API read cannot do that honestly - sorting one page of a log is not sorting a log.
export const AUDIT_SORT_OPTIONS = [
  { value: 'timestamp_desc', label: 'Timestamp (newest first)' },
  { value: 'timestamp_asc', label: 'Timestamp (oldest first)' },
];

// The RPC action name, unchanged from the collection's day so that a route, a harness and a permission all still say
// what they always said: only where the rows COME FROM has changed.
export const SYSTEM_LOG_ACTION = 'ADMIN_GET_SYSTEM_LOG';

// The request/response contract this client expects. Version 3 is the Cloud Logging one: the response carries a
// `next_page_token` instead of `total`/`total_pages`, because a paged API read has no total to give.
export const SYSTEM_LOG_API_VERSION = 3;

export const emptyLogFilters = () => ({ from: '', to: '', action: '', member: '' });

// The page sizes the tab offers and the ceiling it clamps to; the callable clamps again, because a client's number is a
// request rather than an instruction.
export const LOG_PAGE_SIZE = 20;
export const LOG_PAGE_SIZE_MAX = 100;

// One log row, with the fields the table needs and nothing invented.
//
// `id` is coerced to a string so it can be a React key without a numeric/string mismatch. Unlike a training row, a log
// line is NOT dropped for having an odd id - the line itself is evidence.
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

// The request body for one page. Kept in one place so the parameter names cannot drift from what the backend reads.
//
// THE ACTION FILTER TRAVELS AS `action_filter`, NOT `action`. `action` is the RPC envelope key - every request in the
// app names its action that way - so a filter of the same name cannot coexist with it. It shipped as `action` once and
// silently replaced the RPC name with the empty filter, which the backend answered with "Invalid action type": the tab
// was completely broken while every unit test of this function passed, because the collision only exists once the query
// is composed into the envelope. Hence systemLogRequest below, which is tested for real.
export const logQueryParams = ({ sort = DEFAULT_LOG_SORT, filters = {}, pageSize = LOG_PAGE_SIZE, pageToken = '' } = {}) => ({
  page_size: String(Math.min(LOG_PAGE_SIZE_MAX, Math.max(1, Math.floor(Number(pageSize) || LOG_PAGE_SIZE)))),
  sort: text(sort) || DEFAULT_LOG_SORT,
  from: text(filters.from),
  to: text(filters.to),
  action_filter: text(filters.action),
  member: text(filters.member),
  // Forward-only, because that is what the Logging API gives: the token from the previous reply, or nothing for the
  // newest page.
  page_token: text(pageToken),
});

// The complete request body: the RPC envelope plus the query, composed in the one place where the two meet - so a name
// collision like the one above has somewhere to be caught. The action name is written LAST for the same reason: whatever
// the query contains, the RPC name cannot be shadowed.
export const systemLogRequest = (params = {}, token = '') => ({
  ...params,
  action: SYSTEM_LOG_ACTION,
  token,
});


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

// A color hint for the action badge, so a failure stands out from an ordinary event without reading every word.
// Deliberately coarse: three tones.
//
// Matched on TOKENS rather than substrings: a plain /LOCK/ test flags CLOCK_IN as an alert, because "CLOCK_IN" contains
// "LOCK". Splitting on separators and matching each token from its start keeps CLOCK and LOCK apart, and still catches
// SHIFT_OFFER_DECLINED (tokens DECLINED) and USER_LOGIN.
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
