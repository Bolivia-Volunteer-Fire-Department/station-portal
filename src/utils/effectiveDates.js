// Effective and end dates, shared by schedule templates and assignments.
//
// Both sheets gained the same pair of columns for the same reason: to start a new record on a date and
// retire an old one on a date, without deleting it and losing the history of what the station used to run.
// The rule is identical for both, so it lives here once - two hand-written copies would drift, and the
// failure mode of drifting date logic is shifts silently appearing or disappearing.
//
// A blank cell means NO RESTRICTION, not "no date, so never":
//
//   blank effective_date -> no start, has always run
//   blank end_date       -> no end, still running
//   both blank           -> exactly the previous behaviour, forever
//
// That is what makes these columns safe to add: every existing record keeps doing what it did before,
// because an empty cell is "no restriction" rather than "retired".

import { parseSheetDateKey } from './scheduleDate';

const text = (value) => String(value ?? '').trim();

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// A sheet date cell as a yyyy-MM-dd key, or '' when it is blank or unreadable. Reuses the schedule's own
// parser, so a date typed as text, a real date cell (an ISO string over the API) and a Date object all
// normalize the same way the rest of the app reads dates.
export const effectiveDateKey = (value) => {
  if (value === undefined || value === null || value === '') return '';
  return parseSheetDateKey(value) || '';
};

// The window, with blanks left open. `openStart` / `openEnd` are what the labels read from.
export const dateWindow = (record) => ({
  from: effectiveDateKey(record?.effective_date),
  to: effectiveDateKey(record?.end_date),
  openStart: !effectiveDateKey(record?.effective_date),
  openEnd: !effectiveDateKey(record?.end_date),
});

export const hasDateWindow = (record) => {
  const { from, to } = dateWindow(record);
  return Boolean(from || to);
};

// Whether a record is in force on a date. A date key of '' cannot be checked, so it is treated as inside
// the window - the caller has no date to reason about, and refusing would blank a calendar for a bad
// input rather than showing the pattern.
//
// Both ends are inclusive: an effective date of 2026-07-01 is in force ON 1 July, and an end date of
// 2026-06-30 is still in force on 30 June. Anything else would need a reader to remember which end was
// exclusive.
export const isActiveOnDate = (record, dateKey) => {
  const key = text(dateKey);
  if (!key) return true;

  const { from, to } = dateWindow(record);
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
};

// Where a record sits in its own life, for badges and warnings. `todayKey` is passed in rather than read
// from the clock so the three cases are testable.
export const dateLifecycle = (record, todayKey) => {
  const key = text(todayKey);
  const { from, to } = dateWindow(record);

  if (key && from && key < from) return 'scheduled';
  if (key && to && key > to) return 'retired';
  return 'active';
};

// A single yyyy-MM-dd key as "Jul 1, 2026", for a date shown on its own rather than as a window.
export const dateKeyText = (value) => {
  const key = effectiveDateKey(value);
  if (!key) return '';
  const [year, month, day] = key.split('-').map(Number);
  if (!year || !month || !day) return key;
  return `${MONTHS_SHORT[month - 1]} ${day}, ${year}`;
};

// A human label for the window, or '' when there is neither date. Kept short because it sits on a card:
// "Until Jun 30, 2026", "From Jul 1, 2026", "Jul 1, 2026 - Jun 30, 2027".
export const dateWindowLabel = (record) => {
  const { from, to } = dateWindow(record);
  if (!from && !to) return '';

  if (from && to) return `${dateKeyText(from)} - ${dateKeyText(to)}`;
  if (from) return `From ${dateKeyText(from)}`;
  return `Until ${dateKeyText(to)}`;
};

// Whether a pair of dates makes sense, for the form and the backend to agree on. Returns '' when valid,
// otherwise the reason.
//
// `requireFrom` makes the effective date mandatory, which both the templates and the assignments sheet
// now ask for. It is enforced on SAVE only: a record already in the sheet with a blank effective date is
// still read as "no restriction", because treating existing blanks as invalid would remove every
// template and assignment created before the rule from the schedule at once.
export const dateWindowError = (effectiveDate, endDate, { requireFrom = false } = {}) => {
  const from = effectiveDateKey(effectiveDate);
  const to = effectiveDateKey(endDate);

  if (requireFrom && !text(effectiveDate)) return 'An effective date is required.';

  // A value that was typed but could not be read is an error rather than a silent blank, since silently
  // dropping it would quietly put the record back to being in force forever.
  if (text(effectiveDate) && !from) return 'The effective date is not a readable date.';
  if (text(endDate) && !to) return 'The end date is not a readable date.';
  if (from && to && from > to) return 'The end date must not be before the effective date.';
  return '';
};

// Whether a record already in the sheet is missing the now-required effective date. Used to nudge an
// administrator towards fixing rows created before the rule existed, since those rows keep working
// (blank = no restriction) and would otherwise never be noticed.
export const needsEffectiveDate = (record) => !effectiveDateKey(record?.effective_date);
