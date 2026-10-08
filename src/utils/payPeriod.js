// THE PAY PERIOD: how long the station's pay cycle is, and which day it starts on.
//
// WHY THE LENGTH IS A SETTING AT ALL. The clock history opens on ONE pay period, and that window is a READ decision as much
// as a display one: `timeclock` grows on its own, so whatever the window is, every officer pays it on every visit (see
// App#loadLogs). A station whose period is not a week should not need that argued in a code review - it is a number in
// System Settings, and this module is what reads it.
//
// TWO KEYS, AND ONLY ONE OF THEM SHAPES THE WINDOW TODAY:
//
//   pay_period_days   the number of days one period covers (7 unless somebody says otherwise). This IS the window the clock
//                     history opens on: the last N days INCLUDING today, so N = 7 is today and the six before it.
//   pay_week_start    the weekday a period begins on. STORED AND NOT YET APPLIED - it is here because reports that total
//                     by pay period will need it, and because the day a period starts is a station fact rather than a
//                     constant somebody guesses later. Nothing does arithmetic with it yet, and the card says so out loud
//                     so nobody has to read this to find out.
//
// AN UNREADABLE VALUE IS IGNORED RATHER THAN APPLIED - the rule the session timeout and the training signing window both
// follow, and it matters twice as much here: a typo must not collapse the window to a single day, and it must not widen it
// to a year of the station's clock entries either.
import { dateKeyDaysBack } from './scheduleDate.js';
import { getSettingValue } from './systemSettings.js';

export const PAY_PERIOD_DAYS_KEY = 'pay_period_days';
export const PAY_WEEK_START_KEY = 'pay_week_start';

export const DEFAULT_PAY_PERIOD_DAYS = 7;
export const MIN_PAY_PERIOD_DAYS = 1;
// A "period" longer than a year is not a pay period, and the read it would buy is the whole collection again.
export const MAX_PAY_PERIOD_DAYS = 366;

// The weekdays the dropdown offers, in calendar order - Sunday first, as the app's month grid and its other weekday lists
// are, so the list reads the way the calendar does.
export const PAY_WEEKDAYS = [
  { value: 'sunday', label: 'Sunday' },
  { value: 'monday', label: 'Monday' },
  { value: 'tuesday', label: 'Tuesday' },
  { value: 'wednesday', label: 'Wednesday' },
  { value: 'thursday', label: 'Thursday' },
  { value: 'friday', label: 'Friday' },
  { value: 'saturday', label: 'Saturday' },
];
export const DEFAULT_PAY_WEEK_START = 'sunday';

const text = (value) => String(value ?? '').trim();

// The period's length and its first weekday, as one object, whatever the settings document holds.
export const payPeriodConfig = (systemSettings) => {
  const rawDays = text(getSettingValue(systemSettings, PAY_PERIOD_DAYS_KEY, ''));
  const rawWeekStart = text(getSettingValue(systemSettings, PAY_WEEK_START_KEY, '')).toLowerCase();
  const digitsOnly = /^\d+$/.test(rawDays);
  const parsed = digitsOnly ? Number(rawDays) : null;
  const usable = parsed !== null && parsed >= MIN_PAY_PERIOD_DAYS && parsed <= MAX_PAY_PERIOD_DAYS;
  const knownWeekday = PAY_WEEKDAYS.some((day) => day.value === rawWeekStart);

  return {
    days: usable ? parsed : DEFAULT_PAY_PERIOD_DAYS,
    rawDays,
    // A BLANK IS NOT AN ERROR - it means "the default" - while a value somebody TYPED and cannot be used IS reported, so the
    // card can say which of the two the reader is looking at rather than guessing.
    invalidDays: rawDays !== '' && !usable,
    weekStart: knownWeekday ? rawWeekStart : DEFAULT_PAY_WEEK_START,
    rawWeekStart,
    invalidWeekStart: rawWeekStart !== '' && !knownWeekday,
  };
};

// THE WINDOW THE CLOCK HISTORY OPENS ON: N days INCLUDING today, as the two ends of a range.
//
// `days - 1` RATHER THAN `days` is the off-by-one this exists to keep in one place: a seven-day period that ends today
// begins six days ago. The count comes back with the dates, so a screen can say "the last 7 days" without working it out
// from the keys - and so the harness has one number to assert rather than two dates to subtract.
export const payPeriodWindow = (config, todayKey) => {
  const days = Math.max(
    MIN_PAY_PERIOD_DAYS,
    Math.min(MAX_PAY_PERIOD_DAYS, Number(config?.days) || DEFAULT_PAY_PERIOD_DAYS)
  );
  return { days, from: dateKeyDaysBack(days - 1, todayKey), to: text(todayKey) };
};
