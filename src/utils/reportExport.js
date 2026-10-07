import { REPORT_MEASURE_LABELS as MEASURE_LABELS } from './reportParameters';

const csvValue = (value) => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const GROUP_LABELS = {
  assignment: 'Assignment',
  template: 'Shift Template',
  member: 'Member',
  day: 'Day',
  month: 'Month',
  category: 'Category',
  training: 'Training',
};

// ONE LABEL PER LEVEL. A report groups by a LIST now, so this takes either shape: a report grouped by month and member
// reads "Month, Member" wherever a single label is needed, and one grouped by month alone reads exactly as it did.
export const reportGroupLabel = (groupBy) => {
  const levels = [].concat(groupBy || []).filter(Boolean);
  if (!levels.length) return 'Group';
  return levels.map((level) => GROUP_LABELS[level] || String(level)).join(', ');
};

const MEASURE_COLUMNS = ['scheduled_hours', 'clocked_hours', 'variance'];

// The measure columns a result carries, or an empty list when the result is one number per row. THE ORDER IS THE ORDER A
// READER WANTS THEM - what was scheduled, what was clocked, the difference - and `open_clock_entries` appears only when
// there is one, because a column of zeroes is furniture until it is not.
//
// It lives here rather than in the module because the printed sheet, the CSV and the screen all draw the same columns,
// and three copies of this list would be three chances to disagree about them.
export const reportMeasureColumns = (result) => {
  const rows = result?.rows || [];
  if (!rows.some((row) => row.values)) return [];
  return [...MEASURE_COLUMNS, ...(rows.some((row) => (row.values.open_clock_entries || 0) > 0) ? ['open_clock_entries'] : [])];
};

export const reportResultCsv = (result) => {
  const levels = [].concat(result?.report?.group_by || []).filter(Boolean);
  const measures = reportMeasureColumns(result);
  // ONE COLUMN PER GROUPING LEVEL. A spreadsheet has no headings to nest, so the cascade becomes columns and each row
  // carries its own path - which is what makes the file pivotable, and is the reason this is not the printed shape.
  const header = [
    ...(levels.length ? levels.map((level) => reportGroupLabel(level)) : ['Group']),
    ...(measures.length ? measures.map((key) => MEASURE_LABELS[key] || key) : [result?.report?.unit || 'Shifts']),
  ];
  const body = (result?.rows || []).map((row) => [
    ...(row.levels && row.levels.length ? row.levels : [row.label]),
    ...(measures.length ? measures.map((key) => row.values?.[key] ?? '') : [row.value]),
  ]);
  return [header, ...body].map((row) => row.map(csvValue).join(',')).join('\r\n');
};

export const reportCsvFileName = (result) => {
  const slug = String(result?.report?.name || 'report')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'report';
  return `${slug}-${result?.range?.from}-to-${result?.range?.to}.csv`;
};

export const downloadCsv = (content, fileName) => {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
