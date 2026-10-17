// Work Orders data models, status catalogs, categories, priorities, and normalizers.

export const WORK_ORDER_STATUSES = [
  { value: 'pending', label: 'Pending Review', color: 'amber', description: 'Newly submitted, awaiting review or assignment' },
  { value: 'scheduled', label: 'Scheduled', color: 'blue', description: 'Assigned and scheduled for repair/work' },
  { value: 'in_progress', label: 'In Progress', color: 'cyan', description: 'Actively being worked on or repaired' },
  { value: 'on_hold', label: 'On Hold', color: 'purple', description: 'Waiting on parts, approval, or vendor' },
  { value: 'complete', label: 'Complete', color: 'emerald', description: 'Repair/replenishment completed successfully' },
  { value: 'cancelled', label: 'Cancelled', color: 'slate', description: 'Ticket cancelled or duplicate' },
];

export const WORK_ORDER_PRIORITIES = [
  {
    value: 'urgent',
    label: 'Urgent',
    color: 'red',
    sortWeight: 4,
    description: 'Immediate safety or health hazard, or mission-critical apparatus/equipment out of service',
  },
  {
    value: 'high',
    label: 'High',
    color: 'amber',
    sortWeight: 3,
    description: 'Impairs operations or station function; requires prompt attention but not an immediate life safety emergency',
  },
  {
    value: 'medium',
    label: 'Medium',
    color: 'blue',
    sortWeight: 2,
    description: 'Standard maintenance, repairs, or replenishment needed during regular routines',
  },
  {
    value: 'low',
    label: 'Low',
    color: 'slate',
    sortWeight: 1,
    description: 'Minor cosmetic defects, deferred maintenance, or non-urgent suggestions',
  },
];

export const WORK_ORDER_CATEGORIES = [
  { value: 'apparatus', label: 'Apparatus / Fleet', description: 'Fire engine, ladder truck, brush truck, rescue vehicle' },
  { value: 'station', label: 'Station Facility', description: 'Building repair, door opener, plumbing, supplies, kitchen, bays' },
  { value: 'equipment', label: 'Equipment & Gear', description: 'Turnout gear, radios, SCBA bottles, hand tools, hoses, medical' },
  { value: 'other', label: 'Other', description: 'General request or unlisted asset' },
];

export const ACTIVE_STATUS_VALUES = ['pending', 'scheduled', 'in_progress', 'on_hold'];

export function isActiveWorkOrder(wo) {
  if (!wo || !wo.status) return true;
  return ACTIVE_STATUS_VALUES.includes(String(wo.status).toLowerCase());
}

export function getStatusMeta(statusValue) {
  const s = String(statusValue || 'pending').toLowerCase();
  return WORK_ORDER_STATUSES.find((item) => item.value === s) || {
    value: s,
    label: s,
    color: 'slate',
    description: '',
  };
}

export function getPriorityMeta(priorityValue) {
  const p = String(priorityValue || 'medium').toLowerCase();
  return WORK_ORDER_PRIORITIES.find((item) => item.value === p) || {
    value: p,
    label: p,
    color: 'slate',
    sortWeight: 1,
  };
}

export function getCategoryMeta(categoryValue) {
  const c = String(categoryValue || 'other').toLowerCase();
  return WORK_ORDER_CATEGORIES.find((item) => item.value === c) || {
    value: c,
    label: c,
    description: '',
  };
}

export function generateWorkOrderTicketNumber() {
  const year = new Date().getFullYear();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `WO-${year}-${rand}`;
}

export function normalizeWorkOrder(row, currentUser = null) {
  const id = String(row?.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `wo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`));
  const ticketNumber = String(row?.ticket_number || row?.ticketNumber || generateWorkOrderTicketNumber());

  const submittedAt = row?.submitted_at || row?.createdAt || row?.created_at || new Date().toISOString();
  const submittedById = String(row?.submitted_by_id || row?.submittedById || currentUser?.id || '');
  const submittedByName = String(
    row?.submitted_by_name ||
    row?.submittedByName ||
    currentUser?.name ||
    currentUser?.full_name ||
    'Member'
  );

  return {
    id,
    ticket_number: ticketNumber,
    title: String(row?.title || '').trim(),
    description: String(row?.description || '').trim(),
    category: String(row?.category || 'other').toLowerCase(),
    priority: String(row?.priority || 'medium').toLowerCase(),
    status: String(row?.status || 'pending').toLowerCase(),

    // Linked assets
    apparatus_id: String(row?.apparatus_id || '').trim(),
    apparatus_name: String(row?.apparatus_name || '').trim(),
    maintenance_record_id: String(row?.maintenance_record_id || '').trim(),

    equipment_id: String(row?.equipment_id || '').trim(),
    equipment_name: String(row?.equipment_name || '').trim(),

    station_location: String(row?.station_location || '').trim(),

    // Submitter
    submitted_by_id: submittedById,
    submitted_by_name: submittedByName,
    submitted_at: submittedAt,

    // Assignment (officers with can_manage_work_orders)
    assigned_to_id: String(row?.assigned_to_id || '').trim(),
    assigned_to_name: String(row?.assigned_to_name || '').trim(),
    assigned_at: row?.assigned_at || null,
    assigned_by_id: String(row?.assigned_by_id || '').trim(),

    // Resolution & costs
    cost: typeof row?.cost === 'number' ? row.cost : (parseFloat(row?.cost) >= 0 ? parseFloat(row.cost) : 0),
    resolution_notes: String(row?.resolution_notes || '').trim(),
    completed_at: row?.completed_at || null,
    completed_by_id: String(row?.completed_by_id || '').trim(),
    completed_by_name: String(row?.completed_by_name || '').trim(),

    // Internal notes & updates
    notes: Array.isArray(row?.notes) ? row.notes : [],

    // Attachments
    files: Array.isArray(row?.files) ? row.files : [],

    updated_at: row?.updated_at || submittedAt,
    updated_by: String(row?.updated_by || submittedById),
  };
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'have', 'need', 'needs',
  'some', 'been', 'there', 'they', 'what', 'when', 'where', 'which', 'will',
  'about', 'into', 'over', 'after', 'please', 'help', 'issue', 'problem', 'item'
]);

export function extractKeywords(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

/**
 * Searches active work orders for possible duplicates matching the draft title, description,
 * apparatus, equipment, or station area.
 */
export function findPotentialDuplicates(form, workOrdersList = [], currentTicketId = null) {
  if (!form || !Array.isArray(workOrdersList)) return [];

  const title = String(form.title || '').trim().toLowerCase();
  const desc = String(form.description || '').trim().toLowerCase();
  const titleWords = extractKeywords(title);
  const descWords = extractKeywords(desc);
  const allFormWords = [...new Set([...titleWords, ...descWords])];

  const appTarget = String(form.apparatus_id || '').trim();
  const eqTarget = String(form.equipment_id || '').trim();
  const locTarget = String(form.station_location || '').trim().toLowerCase();

  // If there's virtually no input yet, do not flag anything
  if (titleWords.length === 0 && !appTarget && !eqTarget && locTarget.length < 3) {
    return [];
  }

  const results = [];

  for (const wo of workOrdersList) {
    if (!wo || !wo.id) continue;
    if (currentTicketId && String(wo.id) === String(currentTicketId)) continue;
    // Only check active/open tickets to reduce duplicates
    if (!isActiveWorkOrder(wo)) continue;

    const reasons = [];
    let score = 0;

    // 1. Same apparatus
    if (appTarget && String(wo.apparatus_id || '').trim() === appTarget) {
      reasons.push(`Same apparatus (${wo.apparatus_name || 'Apparatus'})`);
      score += 2.5;
    }

    // 2. Same equipment
    if (eqTarget && String(wo.equipment_id || '').trim() === eqTarget) {
      reasons.push(`Same equipment (${wo.equipment_name || 'Equipment'})`);
      score += 2.5;
    }

    // 3. Station location match
    if (locTarget.length >= 3 && wo.station_location) {
      const woLoc = String(wo.station_location).trim().toLowerCase();
      if (woLoc === locTarget || woLoc.includes(locTarget) || locTarget.includes(woLoc)) {
        reasons.push(`Same station area ("${wo.station_location}")`);
        score += 2;
      }
    }

    // 4. Title & Description keyword overlap
    const woTitle = String(wo.title || '').toLowerCase();
    const woDesc = String(wo.description || '').toLowerCase();
    const woWords = new Set([...extractKeywords(woTitle), ...extractKeywords(woDesc)]);

    const commonWords = allFormWords.filter((w) => woWords.has(w));
    if (commonWords.length >= 2) {
      reasons.push(`Similar keywords (${commonWords.slice(0, 3).join(', ')})`);
      score += commonWords.length * 1.5;
    } else if (commonWords.length === 1 && (appTarget || eqTarget || locTarget)) {
      reasons.push(`Related keyword ("${commonWords[0]}")`);
      score += 1;
    } else if (title.length >= 5 && (woTitle.includes(title) || title.includes(woTitle))) {
      reasons.push('Matching issue title');
      score += 3;
    }

    if (score >= 2 && reasons.length > 0) {
      results.push({
        workOrder: wo,
        score,
        reasons,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 4);
}

