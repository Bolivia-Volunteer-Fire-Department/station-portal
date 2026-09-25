// Derives the display fields for one pending shift offer, and the shared rules
// for what counts as pending.
//
// Deliberately pure and outside the component so it can be exercised directly.
// Getting this wrong is what made the approvals table show no date, the
// assignment instead of the time, and then the assignment again under
// "Working With":
//   - the date needed the backend-normalized `date_key`, not the raw sheet value
//   - the time comes from the schedule template, not from the assignment
//   - co-workers are whoever overlaps the shift in time

import { displayDate, parseSheetDateKey } from './scheduleDate';
import { rowTimeText, templateTimeText, timeToMinutes, formatClockRange } from './shiftTime';

// --- offer state -----------------------------------------------------------

// An offer still needs a decision when neither an approval nor a decline is
// recorded. This mirrors the backend's offerStatus(), which trims its values, so
// the table and the admin badge cannot disagree about what is outstanding.
export function isPendingOffer(offer) {
  if (!offer) return false;

  // Normalized offers carry the status the backend derived from the same two
  // columns; prefer it so both sides share one definition.
  const status = String(offer.status ?? '').trim();
  if (status) return status === 'pending';

  // Fallback for any payload that predates the derived status.
  return String(offer.approved_by ?? '').trim() === '' &&
    String(offer.declined_by ?? '').trim() === '';
}

// The subset an approvals queue should render. Anything that is not an array
// yields an empty list rather than throwing.
export function pendingOffersOnly(offers) {
  return (Array.isArray(offers) ? offers : []).filter(isPendingOffer);
}

// The schedule row an offer refers to. `schedule_id` is set when the offer was
// made against an existing unassigned row; a template-occurrence offer has no
// row until it is approved, so this returns null for those.
export function scheduleRowForOffer(offer, schedule = []) {
  const scheduleId = String(offer?.schedule_id ?? '').trim();
  if (!scheduleId) return null;
  return schedule.find((row) => String(row?.id ?? '').trim() === scheduleId) || null;
}

// "yyyy-MM-dd" for the day the offer covers. Prefers the date key the backend
// computes (normalizeOffer), falling back to parsing the raw sheet value.
export function offerDateKey(offer) {
  const key = String(offer?.date_key ?? '').trim();
  if (key) return key;
  return parseSheetDateKey(offer?.date_from) || '';
}

export function offerDateToKey(offer) {
  const to = String(offer?.date_to_key ?? '').trim();
  if (to) return to;
  return parseSheetDateKey(offer?.date_to) || offerDateKey(offer);
}

// The template an offer belongs to: from the offer itself, else from the row it
// fills.
export function offerTemplateId(offer, row = null) {
  const fromOffer = String(offer?.schedule_template_id ?? '').trim();
  if (fromOffer) return fromOffer;
  return String(row?.schedule_template_id ?? '').trim();
}

// The shift window. Template times win, then the row's own times (custom shifts
// carry theirs on the row), then any times stored on the offer. Same resolution
// order ScheduleCalendar uses, so both views agree.
export function offerTimeText(offer, row, template) {
  if (template) {
    const fromTemplate = templateTimeText(template);
    if (fromTemplate) return fromTemplate;
  }
  if (row) {
    const fromRow = rowTimeText(row);
    if (fromRow) return fromRow;
  }
  return rowTimeText(offer);
}

// --- shift windows ---------------------------------------------------------

// Start/end minutes for a schedule row: the template's window wins, else the
// row's own (custom shifts carry theirs directly).
function rowShiftInfo(row, templates) {
  const template = (templates || []).find(
    (t) => String(t?.id ?? '').trim() === String(row?.schedule_template_id ?? '').trim()
  ) || null;

  const range = (template ? templateTimeText(template) : '') || rowTimeText(row);
  const [start, end] = range ? range.split('–') : ['', ''];

  return {
    template,
    range,
    startMin: timeToMinutes(start),
    endMin: timeToMinutes(end),
  };
}

// A span of minutes-of-day, with the end pushed past midnight when the window
// wraps (20:00-04:00). Start equal to end counts as a full 24h window, matching
// the convention in utils/shiftHours.js.
function toWindow(startMin, endMin) {
  if (startMin === null || endMin === null) return null;
  return { start: startMin, end: endMin <= startMin ? endMin + 1440 : endMin };
}

const windowsOverlap = (a, b) => !!a && !!b && a.start < b.end && b.start < a.end;

// Everyone else on the clock at the same time on the same day, excluding the
// member whose offer this is.
//
// Overlap is what matters here, NOT a shared assignment: a Driver/Operator and
// an Officer both working 08:00-18:00 are working together even though their
// assignments differ. When a window is missing on either side the comparison
// can't be made, so those fall back to "same shift definition" (same schedule
// template) - the best signal available.
export function shiftCoworkers(offer, {
  schedule = [],
  scheduleTemplates = [],
  assignments = [],
  ownWindow = null,
  ownTemplateId = '',
  dateKey = '',
  userName = (id) => id,
} = {}) {
  const ownUserId = String(offer?.user_id ?? '').trim();
  if (!dateKey) return [];

  const found = [];
  const seen = new Set();

  schedule.forEach((row) => {
    const userId = String(row?.user_id ?? '').trim();
    if (!userId || userId === ownUserId || seen.has(userId)) return;

    // The row has to cover the day the offer is for.
    const from = parseSheetDateKey(row?.date_from);
    const to = parseSheetDateKey(row?.date_to) || from;
    if (!from || !to || dateKey < from || dateKey > to) return;

    const info = rowShiftInfo(row, scheduleTemplates);
    const rowWindow = toWindow(info.startMin, info.endMin);

    const sameShift = ownTemplateId !== '' &&
      String(row?.schedule_template_id ?? '').trim() === ownTemplateId;

    const overlapping = windowsOverlap(ownWindow, rowWindow);
    const fallbackMatch = (!ownWindow || !rowWindow) && sameShift;
    if (!overlapping && !fallbackMatch) return;

    seen.add(userId);

    const assignmentId = String(row?.assignment_id ?? info.template?.assignment_id ?? '').trim();
    const assignment = assignments.find((a) => String(a?.id ?? '').trim() === assignmentId) || null;

    found.push({
      userId,
      name: userName(userId),
      assignmentName: assignment?.description || '',
      range: info.range,
      // Earliest start first, so the list reads in shift order.
      startMin: info.startMin === null ? Number.MAX_SAFE_INTEGER : info.startMin,
    });
  });

  return found.sort((a, b) => a.startMin - b.startMin || a.name.localeCompare(b.name));
}

// --- filtering and sorting the queue ---------------------------------------
//
// These work on "rows": one entry per offer, already described, of the shape
//   { offer, shift, memberId, memberName }
// Built once by the tab and passed straight in, so nothing here needs a lookup and the whole thing
// stays a pure function of its input - which is what makes the ordering rules testable.
//
// Ascending by shift date is the default: this is a queue of things to decide, and the soonest
// shift is the one that needs a decision first. Within a day, shifts are ordered by start time so
// a row reads in the same order as the schedule does.

export const OFFER_SORT_OPTIONS = [
  { value: 'date_asc', label: 'Shift date (soonest first)' },
  { value: 'date_desc', label: 'Shift date (latest first)' },
  { value: 'member_asc', label: 'Member (A–Z)' },
  { value: 'assignment_asc', label: 'Assignment (A–Z)' },
];

export const DEFAULT_OFFER_SORT = 'date_asc';

const text = (value) => String(value ?? '').trim();

// Comparing two text keys, in either direction.
//
// The "missing sorts last" rule lives OUTSIDE the direction on purpose: negating a comparator also
// negates its tiebreaks, which put undated offers at the TOP of "latest first" and blank
// assignments at the top of the assignment sort. A value that is not there is neither earliest nor
// latest, and it should never lead the table.
const compareText = (aValue, bValue, direction = 1) => {
  const a = text(aValue);
  const b = text(bValue);
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return (a < b ? -1 : 1) * direction;
};

// Start minutes are numbers, so they need their own comparison: comparing them as text would sort
// "1080" before "480", putting an 18:00 shift ahead of an 08:00 one. Always ascending within a day,
// even when the dates run descending, so a day's shifts read in the order the schedule shows them.
const compareStarts = (aValue, bValue) => {
  const aOk = Number.isFinite(aValue);
  const bOk = Number.isFinite(bValue);
  if (!aOk && !bOk) return 0;
  if (!aOk) return 1;
  if (!bOk) return -1;
  return aValue - bValue;
};

const COMPARATORS = {
  date_asc: (a, b) =>
    compareText(a?.shift?.dateKey, b?.shift?.dateKey, 1) ||
    compareStarts(a?.shift?.startMin, b?.shift?.startMin) ||
    compareText(a?.memberName, b?.memberName),
  date_desc: (a, b) =>
    compareText(a?.shift?.dateKey, b?.shift?.dateKey, -1) ||
    compareStarts(a?.shift?.startMin, b?.shift?.startMin) ||
    compareText(a?.memberName, b?.memberName),
  member_asc: (a, b) =>
    compareText(a?.memberName, b?.memberName) ||
    compareText(a?.shift?.dateKey, b?.shift?.dateKey) ||
    compareStarts(a?.shift?.startMin, b?.shift?.startMin),
  assignment_asc: (a, b) =>
    compareText(a?.shift?.assignmentName, b?.shift?.assignmentName) ||
    compareText(a?.shift?.dateKey, b?.shift?.dateKey) ||
    compareStarts(a?.shift?.startMin, b?.shift?.startMin),
};

// The distinct members and assignments present in the queue, as sorted {value,label} options.
//
// Built from the offers rather than from the whole roster: a filter listing every member in the
// department, most of whom have nothing pending, would be mostly dead ends.
export const offerFilterOptions = (rows) => {
  const members = new Map();
  const assignments = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row) return;
    const memberId = text(row.memberId);
    if (memberId && !members.has(memberId)) members.set(memberId, text(row.memberName) || memberId);
    const assignmentId = text(row?.shift?.assignmentId);
    if (assignmentId && !assignments.has(assignmentId)) {
      assignments.set(assignmentId, text(row?.shift?.assignmentName) || assignmentId);
    }
  });

  const toOptions = (map) =>
    [...map.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => compareText(a.label, b.label));

  return { members: toOptions(members), assignments: toOptions(assignments) };
};

// The queue as the table should show it: filtered, then sorted.
//
// Blank filter values mean "no filter", which is what the selects send for "All".
export const filterAndSortOffers = (
  rows,
  { member = '', assignment = '', sort = DEFAULT_OFFER_SORT } = {}
) => {
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean);
  const memberId = text(member);
  const assignmentId = text(assignment);

  const filtered = list.filter((row) => {
    if (memberId && text(row.memberId) !== memberId) return false;
    if (assignmentId && text(row?.shift?.assignmentId) !== assignmentId) return false;
    return true;
  });

  const comparator = COMPARATORS[sort] || COMPARATORS[DEFAULT_OFFER_SORT];
  return [...filtered].sort(comparator);
};

// Everything the approvals table renders for one offer. `userName` resolves a
// user id to a display name and `timeFormat` is the station's 12h/24h
// preference; both are injected so this module stays React-free.
export function describeShiftOffer(offer, {
  schedule = [],
  scheduleTemplates = [],
  assignments = [],
  timeFormat = '12',
  userName = (id) => id,
} = {}) {
  const row = scheduleRowForOffer(offer, schedule);
  const templateId = offerTemplateId(offer, row);
  const template = scheduleTemplates.find((t) => String(t?.id ?? '').trim() === templateId) || null;

  const dateKey = offerDateKey(offer);
  const dateToKey = offerDateToKey(offer);
  const fromLabel = displayDate(dateKey);
  const toLabel = dateToKey && dateToKey !== dateKey ? displayDate(dateToKey) : '';

  // A multi-day range reads as "Tue, Sep 16 – Wed, Sep 17".
  const dateLabel = [fromLabel, toLabel].filter(Boolean).join(' – ');

  // The assignment can be recorded on the offer, on the row it fills, or only on
  // the template it came from.
  const assignmentId = String(
    offer?.assignment_id ?? row?.assignment_id ?? template?.assignment_id ?? ''
  ).trim();
  const assignment = assignments.find((a) => String(a?.id ?? '').trim() === assignmentId) || null;

  // This offer's own window, used to decide who else is on at the same time.
  const ownRange = offerTimeText(offer, row, template);
  const [ownStart, ownEnd] = ownRange ? ownRange.split('–') : ['', ''];
  const startMin = timeToMinutes(ownStart);
  const ownWindow = toWindow(startMin, timeToMinutes(ownEnd));

  return {
    row,
    templateId,
    dateKey,
    dateToKey,
    dateLabel: dateLabel || '—',
    timeLabel: formatClockRange(ownRange, timeFormat),
    // Minutes past midnight, for ordering shifts within a day. Null when the shift has no
    // readable start time, which the sorts treat as "last".
    startMin,
    assignmentId,
    assignmentName: assignment?.description || '',
    // Optional icon configured on the assignment (Administration → Assignments), so the
    // approvals queue draws the same glyph the schedule does. Blank means none.
    assignmentIcon: String(assignment?.icon ?? '').trim(),
    coworkers: shiftCoworkers(offer, {
      schedule,
      scheduleTemplates,
      assignments,
      ownWindow,
      ownTemplateId: templateId,
      dateKey,
      userName,
    }).map((coworker) => ({
      ...coworker,
      timeLabel: formatClockRange(coworker.range, timeFormat),
    })),
  };
}