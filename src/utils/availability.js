// Availability, expressed in the same shape as the schedule itself.
//
// One row on the `availability` sheet means "this member is available for THIS
// template occurrence on THIS date":
//
//   (id, schedule_template_id, date_from, date_to, apparatus_id, assignment_id, user_id)
//
// This replaced the old weekday-window whitelist (id, user_id, day_of_week, start_time,
// end_time). Availability is now per shift rather than per week, so a member can mark
// exactly the shifts they could work, and an administrator can ask the far more useful
// question "who is available for this shift on this date?". `apparatus_id` is carried
// for a future use and ignored here.
//
// Everything in this module is pure, so the derivation can be verified without React -
// see scripts/verify-availability-slots.mjs.

import { toDateKey, parseSheetDateKey } from './scheduleDate';
import { DAY_ORDER } from './calendarConstants';
import { memberCanFillAssignment } from './rankEligibility';
import { templateIsActiveOn } from './scheduleTemplates';
import { assignmentIsActiveOn } from './assignmentDates';
import { timeToMinutes } from './shiftTime';

// A slot is identified by its template AND its date: the same template recurs weekly,
// so the template id alone says nothing about which occurrence is meant.
export const availabilityKey = (templateId, dateKey) =>
  `${String(templateId ?? '').trim()}|${String(dateKey ?? '').trim()}`;

const templateIdOf = (row) => String(row?.schedule_template_id ?? '').trim();

// The assignment row for an id, or null when it cannot be found.
//
// A missing assignment is treated as "no restriction" by the date gate, which is the right failure mode:
// an id pointing at a row nobody can find should not silently blank a whole day of shift slots.
const findAssignment = (assignments, id) => {
  const key = String(id ?? '').trim();
  if (!key) return null;
  return (
    (Array.isArray(assignments) ? assignments : []).find(
      (a) => String(a?.id ?? '').trim() === key
    ) || null
  );
};

export const availabilityRowsFor = (availability, userId) => {
  const wanted = String(userId ?? '').trim();
  if (!wanted) return [];
  return (Array.isArray(availability) ? availability : []).filter(
    (row) => String(row?.user_id ?? '').trim() === wanted
  );
};

// The members who have marked themselves available for one slot, in name order.
//
// Rows pointing at a member missing from `users` still appear, labelled by id: silently
// dropping someone the sheet says is available would be worse than showing an id.
//
// `rank_id` travels with each member so the roster can colour the name and show the rank's icon.
// It comes from the member record rather than the availability row, which does not carry one.
export const availableMembersForSlot = (availability, slot, users = []) => {
  const templateId = String(slot?.templateId ?? '').trim();
  const dateKey = String(slot?.dateKey ?? '').trim();
  if (!templateId || !dateKey) return [];

  const seen = new Set();
  const members = [];
  for (const row of Array.isArray(availability) ? availability : []) {
    if (templateIdOf(row) !== templateId) continue;
    if (parseSheetDateKey(row?.date_from) !== dateKey) continue;
    const userId = String(row?.user_id ?? '').trim();
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    const user = (Array.isArray(users) ? users : []).find(
      (u) => String(u?.id ?? '').trim() === userId
    );
    members.push({
      id: userId,
      name: String(user?.name ?? '').trim() || `Member #${userId}`,
      rank_id: String(user?.rank_id ?? '').trim(),
    });
  }

  return members.sort((a, b) => a.name.localeCompare(b.name));
};

// Whether one member has marked one specific slot as available.
export const isAvailableForSlot = (availability, userId, templateId, dateKey) => {
  const id = String(templateId ?? '').trim();
  const day = String(dateKey ?? '').trim();
  if (!id || !day) return false;
  return availabilityRowsFor(availability, userId).some(
    (row) => templateIdOf(row) === id && parseSheetDateKey(row?.date_from) === day
  );
};

// Every template occurrence in a month that one member could actually fill.
//
// "Could fill" is the schedule calendar's own rule (memberCanFillAssignment): the
// template's weekday has to match the day, and the member's rank has to qualify for the
// template's assignment. This is what the availability editor preloads, so the two
// views can never disagree about which shifts are on offer.
export const availableSlotsForMonth = ({
  year,
  month,
  templates = [],
  assignments = [],
  ranks = [],
  member,
} = {}) => {
  const slots = [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const list = Array.isArray(templates) ? templates : [];

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dateKey = toDateKey(date);
    const dow = DAY_ORDER[date.getDay()];
    for (const template of list) {
      if (String(template?.day_of_week ?? '').trim().toLowerCase() !== dow) continue;
      // Retired and not-yet-effective templates offer nothing to be available for, and neither does one
      // whose assignment is outside its own window.
      if (!templateIsActiveOn(template, dateKey)) continue;
      if (!assignmentIsActiveOn(findAssignment(assignments, template?.assignment_id), dateKey)) continue;
      const assignmentId = String(template?.assignment_id ?? '').trim();
      const assignment =
        (Array.isArray(assignments) ? assignments : []).find(
          (a) => String(a?.id ?? '').trim() === assignmentId
        ) || null;
      if (!memberCanFillAssignment({ member, assignment, ranks })) continue;
      // Sort key for the day cell. A template with no usable time sorts last rather
      // than pretending to start at midnight.
      const startMin = timeToMinutes(template?.start_time);
      slots.push({
        key: availabilityKey(template.id, dateKey),
        dateKey,
        templateId: String(template?.id ?? '').trim(),
        assignmentId,
        template,
        startMin: startMin === null ? Number.MAX_SAFE_INTEGER : startMin,
      });
    }
  }

  return slots.sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.startMin - b.startMin);
};

// Slots grouped by date key, for a month grid that draws one cell per day.
export const slotsByDay = (slots) => {
  const map = new Map();
  for (const slot of Array.isArray(slots) ? slots : []) {
    if (!map.has(slot.dateKey)) map.set(slot.dateKey, []);
    map.get(slot.dateKey).push(slot);
  }
  return map;
};

// Every template occurrence in a month, with the members who marked themselves
// available for it. This is the "All Members" view.
//
// Slots nobody has marked stay in the list - an uncovered shift is exactly what an
// administrator needs to see - while members who said nothing are simply absent, which
// is the point of the view.
export const availabilityRosterForMonth = ({
  year,
  month,
  templates = [],
  availability = [],
  users = [],
  // Needed for the assignment date gate: a retired assignment must stop offering shifts here too.
  assignments = [],
} = {}) => {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const list = Array.isArray(templates) ? templates : [];
  const days = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dateKey = toDateKey(date);
    const dow = DAY_ORDER[date.getDay()];
    const slots = [];

    for (const template of list) {
      if (String(template?.day_of_week ?? '').trim().toLowerCase() !== dow) continue;
      // Same gate as the member's own availability grid, so an administrator's All Members view
      // lists exactly the shifts a member could have marked themselves available for.
      if (!templateIsActiveOn(template, dateKey)) continue;
      if (!assignmentIsActiveOn(findAssignment(assignments, template?.assignment_id), dateKey)) continue;
      const slot = {
        key: availabilityKey(template?.id, dateKey),
        dateKey,
        templateId: String(template?.id ?? '').trim(),
        assignmentId: String(template?.assignment_id ?? '').trim(),
        template,
      };
      slots.push({ ...slot, members: availableMembersForSlot(availability, slot, users) });
    }

    if (slots.length) days.push({ dateKey, date, slots });
  }

  return days;
};
