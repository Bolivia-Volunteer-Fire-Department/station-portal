import { certificationStateLabel } from './certifications.js';

const STATE_ORDER = { expired: 0, expiring: 1, upcoming: 2, active: 3 };

export const sortCertificationRows = (rows, memberNameFor = () => '') => {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return (Array.isArray(rows) ? rows : []).slice().sort((left, right) => {
    const stateOrder = (STATE_ORDER[left.state] ?? 9) - (STATE_ORDER[right.state] ?? 9);
    if (stateOrder) return stateOrder;

    const memberOrder = collator.compare(memberNameFor(left) || '', memberNameFor(right) || '');
    if (memberOrder) return memberOrder;

    const certificationOrder = collator.compare(left.name || '', right.name || '');
    if (certificationOrder) return certificationOrder;

    return String(left.effective_date || '').localeCompare(String(right.effective_date || '')) ||
      String(left.id || '').localeCompare(String(right.id || ''));
  });
};

const csvValue = (value) => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const certificationRowsCsv = (rows, memberNameFor = () => '') => {
  const header = [
    'Member',
    'Member Status',
    'Certification',
    'Effective Date',
    'End Date',
    'Certification Status',
    'Notes',
  ];
  const body = (Array.isArray(rows) ? rows : []).map((row) => [
    memberNameFor(row),
    row.member_status === 'inactive' ? 'Inactive' : 'Active',
    row.name || 'Unknown certification',
    row.effective_date || '',
    row.end_date || '',
    certificationStateLabel(row.state),
    row.notes || '',
  ]);

  return [header, ...body].map((row) => row.map(csvValue).join(',')).join('\r\n');
};