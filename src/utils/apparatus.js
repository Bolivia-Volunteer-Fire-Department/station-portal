// Helpers and type definitions for fire department apparatus asset tracking.

export const APPARATUS_TYPES = [
  { value: 'Engine', label: 'Engine / Pumper' },
  { value: 'Ladder', label: 'Ladder / Tower / Aerial' },
  { value: 'Rescue', label: 'Heavy Rescue / Squad' },
  { value: 'Brush Truck', label: 'Brush Truck / Wildland' },
  { value: 'Tanker', label: 'Tanker / Water Tender' },
  { value: 'Ambulance', label: 'Ambulance / Medic Unit' },
  { value: 'Command', label: 'Chief / Command Vehicle' },
  { value: 'Utility', label: 'Utility / Service Truck' },
  { value: 'Marine', label: 'Marine / Fireboat' },
  { value: 'Other', label: 'Other Apparatus' },
];

export const APPARATUS_STATUSES = [
  { value: 'in_service', label: 'In Service', color: 'emerald', description: 'Front-line ready for emergency dispatch' },
  { value: 'out_of_service', label: 'Out of Service', color: 'rose', description: 'Down for urgent repair or safety defect' },
  { value: 'in_shop', label: 'In Shop / Maintenance', color: 'amber', description: 'Undergoing routine service or maintenance' },
  { value: 'reserve', label: 'Reserve', color: 'sky', description: 'Backup vehicle available when front-line is down' },
  { value: 'retired', label: 'Retired', color: 'slate', description: 'Decommissioned or sold' },
];

export function apparatusStatusBadge(status) {
  const normalized = String(status || '').toLowerCase().trim();
  switch (normalized) {
    case 'in_service':
      return {
        label: 'In Service',
        className: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
        dotClass: 'bg-emerald-500',
      };
    case 'out_of_service':
      return {
        label: 'Out of Service',
        className: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
        dotClass: 'bg-rose-500',
      };
    case 'in_shop':
      return {
        label: 'In Shop',
        className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
        dotClass: 'bg-amber-500',
      };
    case 'reserve':
      return {
        label: 'Reserve',
        className: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800',
        dotClass: 'bg-sky-500',
      };
    case 'retired':
      return {
        label: 'Retired',
        className: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
        dotClass: 'bg-slate-400',
      };
    default:
      return {
        label: status || 'In Service',
        className: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
        dotClass: 'bg-emerald-500',
      };
  }
}

export function evaluateServiceDue(nextServiceDate) {
  if (!nextServiceDate) return null;
  const target = new Date(nextServiceDate);
  if (isNaN(target.getTime())) return null;
  const now = new Date();
  const diffDays = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    return { status: 'overdue', days: Math.abs(diffDays), label: `${Math.abs(diffDays)}d overdue` };
  }
  if (diffDays <= 30) {
    return { status: 'due_soon', days: diffDays, label: `Due in ${diffDays}d` };
  }
  return { status: 'good', days: diffDays, label: `${diffDays}d remaining` };
}

export function normalizeApparatusRecord(row) {
  return {
    id: row?.id || '',
    description: row?.description || row?.name || 'Unnamed Apparatus',
    type: row?.type || 'Other',
    identifier: row?.identifier || row?.unit_number || '',
    make_model: row?.make_model || '',
    year: row?.year || '',
    vin: row?.vin || '',
    license_plate: row?.license_plate || '',
    status: row?.status || 'in_service',
    station: row?.station || '',
    pump_capacity: row?.pump_capacity || '',
    tank_capacity: row?.tank_capacity || '',
    mileage: row?.mileage || '',
    engine_hours: row?.engine_hours || '',
    last_service_date: row?.last_service_date || '',
    next_service_due: row?.next_service_due || '',
    last_pump_test: row?.last_pump_test || '',
    notes: row?.notes || '',
  };
}

