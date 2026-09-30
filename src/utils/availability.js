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
import { unnamedLabel } from './displayLabel';
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
// Rows pointing at a member missing from `users` still appear, labeled by id: silently
// dropping someone the sheet says is available would be worse than showing an id.
//
// `rank_id` travels with each member so the roster can color the name and show the rank's icon.
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
      name: String(user?.name ?? '').trim() || unnamedLabel('member'),
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

// ---------------------------------------------------------------------------------------------------------------
// AVAILABILITY WINDOWS: the model this module is moving to.
//
// A window is a station-wide, recurring weekly pattern with a nickname:
//
//   availability_windows/{id}: (id, nickname, start_time, end_time, is_sunday..is_saturday, effective_date, end_date)
//
// A member's claim points at one window and one day - the same day-by-day choice the module has always made. What
// changes is where the OPTIONS come from. They used to be the member's rank-eligible schedule templates, so drawing a
// month's grid needed templates, assignments AND ranks; windows are station-wide and rank-blind on purpose, so the
// options come from one small collection an officer maintains, and a member sees every window that falls on the day.
//
// THE WEEKDAY FLAG IS THE DAY THE WINDOW STARTS. `is_tuesday` with 18:00-08:00 describes a Tuesday night: the shift
// begins on Tuesday and runs into Wednesday morning, so its pill belongs to Tuesday - and the flags are the only thing
// that decides which days a window appears on.
//
// EFFECTIVE AND END DATES ARE THE CONFIGURATION'S LIFE, NOT AN OCCURRENCE. A department that changes its shift
// structure ends the old windows on the last day they applied - keeping them, because claims reference them and the
// history should still read - and adds new ones with an effective date. Both ends are inclusive; a blank end means
// "still current", and blank dates mean the window was never scheduled to start or stop.
//
// The member module and the administration roster are being moved onto this. Until that lands, the template-based
// derivations above stay in place and in use - both sets are tested in scripts/verify-availability-slots.mjs.

// A window's own date fields, through the same parser the screens use, so a window cannot be live in one place and
// expired in another.
const windowDay = (value) => parseSheetDateKey(value);

// The window a claim points at, and the day it is for - the two halves of a claim's identity.
const windowIdOf = (row) => String(row?.availability_window_id ?? '').trim();

const rowDayOf = (row) => parseSheetDateKey(row?.date_from);

const flagOn = (value) => value === true || String(value ?? '').trim().toUpperCase() === 'TRUE';

const weekdayOf = (dateKey) => DAY_ORDER[new Date(`${dateKey}T12:00:00`).getDay()];

// Whether a window's configuration is in force on a date: effective <= day <= end, either end optional.
export const windowIsLiveOn = (window, dateKey) => {
  const day = String(dateKey ?? '').trim();
  if (!day) return false;
  const from = windowDay(window?.effective_date);
  const to = windowDay(window?.end_date);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
};

// Whether a window falls on a date: in force, and flagged for that date's weekday. This IS the pill rule - a Tuesday
// night shows on Tuesdays, and the Wednesday morning it ends on is not its day.
export const windowCoversDate = (window, dateKey) => {
  const day = windowDay(dateKey);
  if (!day) return false;
  if (!windowIsLiveOn(window, day)) return false;
  return flagOn(window?.[`is_${weekdayOf(day)}`]);
};

// The windows that fall on one date, in start-time order: what a day's cell lists.
export const windowsOnDate = (windows, dateKey) =>
  (Array.isArray(windows) ? windows : [])
    .filter((window) => windowCoversDate(window, dateKey))
    .sort((a, b) => {
      const aMin = timeToMinutes(a?.start_time);
      const bMin = timeToMinutes(b?.start_time);
      const aKey = aMin === null ? Number.MAX_SAFE_INTEGER : aMin;
      const bKey = bMin === null ? Number.MAX_SAFE_INTEGER : bMin;
      if (aKey !== bKey) return aKey - bKey;
      return String(a?.nickname ?? '').localeCompare(String(b?.nickname ?? ''));
    });

// One member's claims, as the set of `window|day` keys the grid diffs against.
export const claimedKeysFor = (availability, userId) =>
  new Set(
    availabilityRowsFor(availability, userId)
      .map((row) => availabilityKey(windowIdOf(row), rowDayOf(row)))
      .filter((key) => key !== '|')
  );

// Whether one member has claimed one window on one date.
export const isAvailableForWindow = (availability, userId, windowId, dateKey) => {
  const key = availabilityKey(windowId, dateKey);
  return key !== '|' && claimedKeysFor(availability, userId).has(key);
};

// The members who claimed one window on one date, in name order. A row pointing at a member missing from `users` still
// appears, labeled by id: silently dropping someone the data says is available would be worse than showing an id.
export const availableMembersForWindow = (availability, windowId, dateKey, users = []) => {
  const wanted = availabilityKey(windowId, dateKey);
  if (wanted === '|') return [];
  const seen = new Set();
  const members = [];
  for (const row of Array.isArray(availability) ? availability : []) {
    if (availabilityKey(windowIdOf(row), rowDayOf(row)) !== wanted) continue;
    const userId = String(row?.user_id ?? '').trim();
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    const user = (Array.isArray(users) ? users : []).find((u) => String(u?.id ?? '').trim() === userId);
    members.push({
      id: userId,
      name: String(user?.name ?? '').trim() || unnamedLabel('member'),
      rank_id: String(user?.rank_id ?? '').trim(),
    });
  }
  return members.sort((a, b) => a.name.localeCompare(b.name));
};

// Every day of a month with at least one window, and - when `availability` is given - who claimed each one. ONE
// derivation for the member's grid and the administration's roster, so the two cannot disagree about which windows
// fall on a day.
export const windowDaysForMonth = ({ year, month, windows = [], availability = [], users = [] } = {}) => {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = toDateKey(new Date(year, month, day));
    const found = windowsOnDate(windows, dateKey);
    if (!found.length) continue;
    days.push({
      dateKey,
      windows: found.map((window) => ({
        ...window,
        id: String(window?.id ?? '').trim(),
        key: availabilityKey(window?.id, dateKey),
        claimed: availableMembersForWindow(availability, window?.id, dateKey, users),
      })),
    });
  }
  return days;
};

// The member module and the administration roster are being moved onto this. Until that lands, the template-based
// derivations above stay in place and in use - both sets are tested in scripts/verify-availability-slots.mjs.

