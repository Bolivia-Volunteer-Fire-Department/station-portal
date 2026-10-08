import { displayDate } from './scheduleDate.js';
import { formatClock } from './shiftTime.js';
import { toTimeInputValue } from './timeInputValue.js';

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
