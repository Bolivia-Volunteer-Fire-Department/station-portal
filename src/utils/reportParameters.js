// [value, label] - the values are the server's REPORT_RANGE_PRESETS.
export const REPORT_RANGE_PRESETS = [
  ['this_month', 'This month'],
  ['last_month', 'Last month'],
  ['last_30_days', 'Last 30 days'],
  ['this_year', 'This year'],
  ['last_year', 'Last year'],
];

export const REPORT_GROUPINGS = {
  schedule: [['assignment', 'Assignment'], ['member', 'Member'], ['day', 'Day'], ['month', 'Month']],
  training: [['category', 'Category'], ['member', 'Member'], ['training', 'Training'], ['day', 'Day'], ['month', 'Month']],
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

const pad = (value) => String(value).padStart(2, '0');
const key = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;

// `todayKey` is yyyy-mm-dd; the arithmetic is on the calendar, so no time zone can shift it.
export const resolveReportRange = (preset, todayKey) => {
  const [year, month, day] = todayKey.split('-').map(Number);
  const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  switch (preset) {
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
