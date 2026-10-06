const csvValue = (value) => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const GROUP_LABELS = {
  assignment: 'Assignment',
  member: 'Member',
  day: 'Day',
  month: 'Month',
  category: 'Category',
  training: 'Training',
};

export const reportGroupLabel = (groupBy) => GROUP_LABELS[groupBy] || String(groupBy || 'Group');

export const reportResultCsv = (result) => {
  const header = [reportGroupLabel(result?.report?.group_by), result?.report?.unit || 'Shifts'];
  const body = (result?.rows || []).map((row) => [row.label, row.value]);
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
