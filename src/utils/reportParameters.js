// [value, label] - the values are the server's REPORT_RANGE_PRESETS.
export const REPORT_RANGE_PRESETS = [
  ['this_month', 'This month'],
  // A CALENDAR week and a rolling week are different questions and both get asked: "last week" is the seven days the
  // schedule drew as one week, "last 7 days" is the seven days ending today.
  ['last_week', 'Last week'],
  ['last_7_days', 'Last 7 days'],
  ['last_month', 'Last month'],
  ['last_30_days', 'Last 30 days'],
  ['this_year', 'This year'],
  ['last_year', 'Last year'],
];

export const REPORT_GROUPINGS = {
  // `template` is the SHIFT PATTERN - "Officer - Day" beside "Officer - Night" - which is the level an assignment cannot
  // reach: one assignment can carry several patterns, and they are what a pay rate is attached to.
  schedule: [['assignment', 'Assignment'], ['template', 'Shift Template'], ['member', 'Member'], ['day', 'Day'], ['month', 'Month']],
  training: [['category', 'Category'], ['member', 'Member'], ['training', 'Training'], ['day', 'Day'], ['month', 'Month']],
  reconciliation: [['member', 'Member'], ['template', 'Shift Template'], ['day', 'Day'], ['month', 'Month']],
};

export const TRAINING_CATEGORY_FILTERS = [
  ['', 'All categories'],
  ['is_company_training', 'Company Training'],
  ['is_hazmat', 'Hazmat'],
  ['is_ems', 'EMS'],
  ['is_fire_prevention', 'Fire prevention'],
  ['is_multicompany', 'Multi-company'],
  ['is_training_facility', 'Training Facility'],
  ['is_officer_training', 'Officer training'],
  ['is_driver_training', 'Driver training'],
  ['none', 'No category'],
];

// The label an ORDER BY or a table column uses for a report's measure. The keys are functions/reporting's own measure
// names, so the config screen and the engine cannot disagree about what a column is.
export const REPORT_MEASURE_LABELS = {
  value: 'Value',
  shifts: 'Shifts',
  hours: 'Hours',
  variance: 'Difference',
  scheduled_hours: 'Scheduled',
  clocked_hours: 'Clocked in',
  open_clock_entries: 'Still open',
};

// What each dataset's single measure is CALLED, which is what an order-by list offers beside the grouping levels.
export const REPORT_DATASET_MEASURE_LABELS = {
  schedule: 'Shifts',
  training: 'Hours',
  reconciliation: 'Difference',
};

const pad = (value) => String(value).padStart(2, '0');
const key = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;

// `todayKey` is yyyy-mm-dd; the arithmetic is on the calendar, so no time zone can shift it.
export const resolveReportRange = (preset, todayKey) => {
  const [year, month, day] = todayKey.split('-').map(Number);
  const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  // A number of days back from today, on the calendar rather than on a clock.
  const daysBack = (count) => {
    const start = new Date(Date.UTC(year, month - 1, day - count));
    return key(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate());
  };
  switch (preset) {
    case 'last_7_days':
      // SEVEN DAYS INCLUDING TODAY, which is what "last 7 days" means beside "last 30 days" - the same arithmetic, one
      // week rather than a month.
      return { from: daysBack(6), to: todayKey };
    case 'last_week': {
      // THE PREVIOUS CALENDAR WEEK, Sunday to Saturday. The app's own week starts on Sunday (utils/calendarConstants
      // DAY_ORDER), so this is the seven days the schedule draws as one week rather than a rolling window - which is the
      // difference between "the week we just finished" and "the last seven days".
      const today = Date.UTC(year, month - 1, day);
      const thisSunday = today - new Date(today).getUTCDay() * 86400000;
      const lastSunday = new Date(thisSunday - 7 * 86400000);
      const lastSaturday = new Date(thisSunday - 86400000);
      return {
        from: key(lastSunday.getUTCFullYear(), lastSunday.getUTCMonth() + 1, lastSunday.getUTCDate()),
        to: key(lastSaturday.getUTCFullYear(), lastSaturday.getUTCMonth() + 1, lastSaturday.getUTCDate()),
      };
    }
    case 'last_month': {
      const y = month === 1 ? year - 1 : year;
      const m = month === 1 ? 12 : month - 1;
      return { from: key(y, m, 1), to: key(y, m, lastDay(y, m)) };
    }
    case 'last_30_days': {
      const start = new Date(Date.UTC(year, month - 1, day - 29));
      return { from: key(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate()), to: todayKey };
    }
    case 'this_year':
      return { from: key(year, 1, 1), to: todayKey };
    case 'last_year':
      return { from: key(year - 1, 1, 1), to: key(year - 1, 12, 31) };
    default:
      return { from: key(year, month, 1), to: todayKey };
  }
};
