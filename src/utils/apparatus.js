// Helpers and type definitions for fire department apparatus asset tracking.

export const APPARATUS_TYPES = [
  { value: 'Engine', label: 'Engine / Pumper' },
  { value: 'Ladder', label: 'Ladder / Tower / Aerial' },
  { value: 'Rescue', label: 'Heavy Rescue / Squad' },
  { value: 'Brush', label: 'Brush Truck / Wildland' },
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

export const MAINTENANCE_TYPES = [
  { value: 'routine_service', label: 'Routine Service / Oil & Lube', color: 'emerald' },
  { value: 'repair', label: 'Mechanical / Electrical Repair', color: 'amber' },
  { value: 'annual_inspection', label: 'Annual DOT / Safety Inspection', color: 'sky' },
  { value: 'pump_test', label: 'Annual Pump Test & Certification', color: 'blue' },
  { value: 'ladder_test', label: 'Aerial / Ladder Testing & Certification', color: 'indigo' },
  { value: 'tires_brakes', label: 'Tires & Brakes', color: 'purple' },
  { value: 'fluid_service', label: 'Transmission / Coolant / Hydraulic Service', color: 'cyan' },
  { value: 'emergency_repair', label: 'Emergency Out-of-Service Repair', color: 'rose' },
  { value: 'body_upfit', label: 'Body Work / Equipment Upfitting', color: 'slate' },
  { value: 'other', label: 'Other Service / Maintenance', color: 'zinc' },
];

export function maintenanceTypeMeta(type) {
  const found = MAINTENANCE_TYPES.find((t) => t.value === type);
  return found || { value: type || 'other', label: type || 'Maintenance', color: 'zinc' };
}

export function formatCurrency(amount) {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
}

export function normalizeMaintenanceRecord(record, defaultUser = null) {
  return {
    id: record?.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `maint_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
    description: String(record?.description || '').trim(),
    type: record?.type || 'routine_service',
    cost: typeof record?.cost === 'number'
      ? (Number.isFinite(record.cost) && record.cost >= 0 ? record.cost : 0)
      : (Number.isFinite(parseFloat(record?.cost)) && parseFloat(record?.cost) >= 0 ? parseFloat(record?.cost) : 0),
    date: record?.date || new Date().toISOString().slice(0, 10),
    recorded_by_id: record?.recorded_by_id || defaultUser?.id || '',
    recorded_by_name: record?.recorded_by_name || defaultUser?.name || defaultUser?.full_name || 'Staff',
    created_at: record?.created_at || new Date().toISOString(),
    files: Array.isArray(record?.files) ? record.files : [],
  };
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
    show_on_widget: Boolean(row?.show_on_widget),
    maintenance_records: Array.isArray(row?.maintenance_records)
      ? row.maintenance_records.map((r) => normalizeMaintenanceRecord(r))
      : [],
  };
}

export function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Comparator to organize apparatuses alphanumerically ascending by unit identifier
 * (e.g. Brush 4, E-1, Engine 2, Engine 10, Ladder 1, Squad 2).
 * Falls back to description if unit identifier is missing or identical.
 */
export function sortApparatusByIdentifier(a, b) {
  const idA = String(a?.identifier || a?.unit_number || '').trim();
  const idB = String(b?.identifier || b?.unit_number || '').trim();

  if (idA && idB) {
    const cmp = idA.localeCompare(idB, undefined, { numeric: true, sensitivity: 'base' });
    if (cmp !== 0) return cmp;
  } else if (idA && !idB) {
    return -1;
  } else if (!idA && idB) {
    return 1;
  }

  const descA = String(a?.description || a?.name || '').trim();
  const descB = String(b?.description || b?.name || '').trim();
  const descCmp = descA.localeCompare(descB, undefined, { numeric: true, sensitivity: 'base' });
  if (descCmp !== 0) return descCmp;

  return String(a?.id || '').localeCompare(String(b?.id || ''));
}


