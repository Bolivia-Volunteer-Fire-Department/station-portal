// Effective and end dates for schedule templates.
//
// A template used to run forever once created: the only way to stop one was to delete it, which lost the
// record of what the station used to run. These two columns let a template start on a date and retire on
// a date instead, so history stays intact.
//
// The rule itself lives in utils/effectiveDates, because the assignments sheet gained the same two columns
// for the same reason and both must read dates identically. These names are the template-facing spellings
// of it, so a call site reads as what it is about.
//
// The gate is used by every place that turns a template into a dated occurrence - the member calendar,
// the administrator's board, the Add Shift picker and both availability views - so a retired template
// disappears from all of them at once rather than from whichever view happened to be updated.

import {
  dateLifecycle,
  dateWindow,
  dateWindowError,
  dateWindowLabel,
  effectiveDateKey,
  isActiveOnDate,
  needsEffectiveDate,
} from './effectiveDates';

// A sheet date cell as a yyyy-MM-dd key, or '' when it is blank or unreadable.
export const templateDateKey = effectiveDateKey;

// The effective window, with blanks left open.
export const templateDateRange = dateWindow;

// Whether a template runs on a date. Both ends are inclusive.
export const templateIsActiveOn = isActiveOnDate;

// 'scheduled' | 'active' | 'retired', for badges.
export const templateLifecycle = dateLifecycle;

// A short label for the window, or '' when the template has neither date.
export const templateDateLabel = dateWindowLabel;

// Whether a pair of dates makes sense. Shared with the backend's own check.
//
// The effective date is REQUIRED: a template must say when it started, so a pattern can be understood
// later. Enforced on save only - see dateWindowError for why existing blanks must keep working.
export const templateDateError = (effectiveDate, endDate) =>
  dateWindowError(effectiveDate, endDate, { requireFrom: true });

// Whether a template already in the sheet predates that rule and still has no effective date.
export const templateNeedsDate = needsEffectiveDate;
