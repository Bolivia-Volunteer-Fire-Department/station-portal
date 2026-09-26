// Shared formatting for schedule shift windows.
//
// Times in a shift can live in two places: on the schedule template a row
// belongs to, or directly on the row itself (custom shifts have no template).
// Every schedule view needs to read both and render them identically, so these
// helpers live here rather than inside a single component - the calendar and the
// pending-approvals table previously drifted apart on exactly this.

import { toTimeInputValue } from './timeInputValue';

// Time window stored on the schedule row itself.
export const rowTimeText = (row) => {
  const s = toTimeInputValue(row?.start_time);
  const e = toTimeInputValue(row?.end_time);
  return s && e ? `${s}–${e}` : s || e || '';
};

// Time window from a schedule template ("20:00–04:00").
export const templateTimeText = (template) => {
  const s = toTimeInputValue(template?.start_time);
  const e = toTimeInputValue(template?.end_time);
  return s && e ? `${s}–${e}` : s || e || '';
};

// Minutes past midnight for a sheet time value ("08:00" -> 480); null when
// there is no usable time.
export const timeToMinutes = (value) => {
  const t = toTimeInputValue(value);
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
};

// Formats an "HH:MM" 24h value as a readable 12h label ("8:00 AM", "10:30 PM").
export const prettyTime = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (!Number.isFinite(h)) return t;
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m ?? 0).padStart(2, '0')} ${period}`;
};

// Formats an "HH:MM" station wall-clock value honoring a 12h/24h preference.
//
// Template and row times are already station-local ("08:00"), so this is pure
// string work - no Date or timezone conversion, which would otherwise shift the
// value. `timeFormat` matches the app's `time_format` setting ('12' | '24').
export const formatClock = (t, timeFormat = '12') => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return t;
  if (String(timeFormat) === '24') {
    return `${String(h % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  return prettyTime(t);
};

// "08:00–18:00" -> "8:00 AM – 6:00 PM" (or "08:00 – 18:00" in 24h mode)
export const formatClockRange = (range, timeFormat = '12') =>
  range
    ? range.split('–').map((t) => formatClock(t, timeFormat)).filter(Boolean).join(' – ')
    : '';

// 12-hour convenience wrapper retained for the calendar's existing call sites.
export const prettyRange = (range) => formatClockRange(range, '12');

// Nickname configured on a schedule template, or '' when there is none. The column is
// optional on the sheet, so a missing or blank one simply means "no nickname".
export const templateNickname = (template) => String(template?.nickname ?? '').trim();

// The timing label a schedule shows for a shift: the template's nickname when one is
// set, otherwise the time text the caller would have shown.
//
// The fallback is passed in rather than formatted here, so each view keeps its own time
// formatting (the member calendar is 12-hour, the admin board is 24-hour) while the
// "nickname wins, times otherwise" rule lives in exactly one place - the calendar and
// the admin board previously drifted apart on exactly this kind of shared rule. A
// custom shift has no template to carry a nickname, so it always shows its own times.
export const shiftTimeLabel = (template, fallbackText) =>
  templateNickname(template) || String(fallbackText ?? '');