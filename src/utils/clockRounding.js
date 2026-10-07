// How the station rounds the hours it reports.
//
// ONE SETTING, TWO SCREENS. The Clock History a member reads and the Clocked-vs-scheduled report an officer pays from both
// round the same way, so the two can never disagree about an hour that was worked - which is what a pay structure needs.
// The setting lives in System Settings under Clock Settings, beside the clock-in geofence, because it is the same kind of
// thing: a station-wide policy about the timeclock rather than a display preference.
//
// WHAT IT ROUNDS, AND WHAT IT DOES NOT. It rounds the hours the app REPORTS, in the places hours are what is being read:
// an entry's duration in the history and its total, the shift each entry fell in, and the clocked hours a reconciliation
// compares against the schedule. It never touches the recorded timestamps or the measured length of an entry, so nothing
// is lost - a station that changes its pay period can change this setting and the exact times are still all there.
//
// NOTHING IS ROUNDED UNLESS SOMETHING SAYS HOW. `roundClockHours` with no step is the identity, deliberately: the raw
// measurement functions (utils/clockLogs#clockLogHours and the report's clockEntryHours) stay exact so the two can be
// checked against each other, and only the screen that PRINTS a figure decides how to round it.
//
// The import names its own extension because the harnesses that run under plain Node (scripts/verify-firestore-writes)
// cannot resolve an extensionless specifier, while Vite - and therefore the app - accepts either.
import { getSettingValue } from './systemSettings.js';

export const CLOCK_ROUNDING_KEY = 'clock_hours_rounding';

// The three a station picks between. Nearest, rather than up or down: the value stored is the step in MINUTES, and the
// labels are what the settings card offers.
export const CLOCK_ROUNDING_OPTIONS = [
  { value: '15', label: 'Nearest 15 minutes' },
  { value: '30', label: 'Nearest 30 minutes' },
  { value: '60', label: 'Nearest hour' },
];

// Fifteen minutes when the station has never chosen: it is the finest step on offer, so it changes the least, and an
// hour that was worked is never worth more than it should be on the report that pays for it.
export const DEFAULT_CLOCK_ROUNDING_MINUTES = 15;

// The station's step in minutes. A value that is not one of the three on offer - a typo, a stray character, a step
// somebody added to the document by hand - falls back to the default rather than rounding by something nobody chose.
export const clockRoundingMinutes = (systemSettings) => {
  const chosen = Number(String(getSettingValue(systemSettings, CLOCK_ROUNDING_KEY, '')).trim());
  return CLOCK_ROUNDING_OPTIONS.some((option) => Number(option.value) === chosen) ? chosen : DEFAULT_CLOCK_ROUNDING_MINUTES;
};

// Hours rounded to the nearest step, with a half rounded up. `minutes` of 0 (or anything unusable) rounds nothing, which
// is what keeps the measured rules above exact.
export const roundClockHours = (hours, minutes) => {
  const step = Number(minutes);
  if (!Number.isFinite(hours) || !Number.isFinite(step) || step <= 0) return hours;
  return (Math.round((hours * 60) / step) * step) / 60;
};
