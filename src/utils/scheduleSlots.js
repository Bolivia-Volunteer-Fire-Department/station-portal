import { toDateKey, parseSheetDateKey } from './scheduleDate';
import { templateIsActiveOn } from './scheduleTemplates';
import { assignmentIsActiveOn } from './assignmentDates';
import { timeToMinutes } from './shiftTime';
import { DAY_ORDER } from './calendarConstants';
import { sortSlotOrder } from './crewOrder';
import { parseRankOrder } from './rankEligibility';
import { unnamedLabel } from './displayLabel';

// WHAT A SLOT IS, IN ONE PLACE.
//
// A "slot" is a place on the board the station means somebody to fill: ONE occurrence of ONE schedule template on ONE
// date. It is deliberately not a schedule ROW - a row is what fills a slot, and the two are separate things, which is
// why a month with no rows is a month of empty slots rather than a month with no shifts.
//
// This rule used to live inside the Schedule Management board alone. The Member Availability roster now offers the same
// slots to assign a member to, and two screens deciding independently what a slot is would drift the moment either was
// touched - the same reasoning that keeps the training summary's two copies pinned against each other by a harness. So
// the rule moved here, the board reads it from here, and scripts/verify-schedule-slots.mjs asserts the two agree.
//
// NOTHING HERE READS A GLOBAL OR A STORE: every function is handed the templates, assignments and rows it needs, so it
// gives the same answer on the board (which holds a working copy an officer is editing) and on the roster (which holds
// what the server last said).

// The key a slot is known by, and the one place its spelling is written down.
//
// TWO SPELLINGS OF "WHICH SLOT" EXIST IN THIS APP and they are not interchangeable, so it is worth being exact about
// which one this is. The BOARD and the shift-offer payloads use `slot-<YYYY-MM-DD>-<template id>`, which is what the
// member's calendar matches an offer against and what this returns. The server's saveScheduleBoard keys a slot as
// `<date_from> <template id>` when it checks that two members have not been handed one place. Same question, different
// punctuation, and nothing should try to convert between them by hand.
export const slotKeyOf = (dateKey, templateId) => `slot-${dateKey}-${templateId}`;

// The range a schedule row covers, as date keys.
//
// `date_to` falls back to `date_from` because a single-day row is stored with the end left blank rather than repeating
// the start. An unparseable date reads as '' rather than as today, so a row with no usable date covers NOTHING - the
// alternative silently gives a dateless row a day, and a row covering everything would fill every slot in the month.
export const rowDateRange = (row) => {
  const from = parseSheetDateKey(row?.date_from) || '';
  return { from, to: parseSheetDateKey(row?.date_to) || from };
};

export const rowCoversDate = (row, dateKey) => {
  const { from, to } = rowDateRange(row);
  return Boolean(from && to && from <= dateKey && dateKey <= to);
};

// The row that fills a slot: the same template, covering the slot's day.
//
// A row that SPANS the day counts, and that is the point of using the range rather than the start date - a long shift
// really does staff the later slots it reaches, and matching on the start day alone would leave a later slot of the same
// template looking vacant while somebody was on it.
export const slotOccupant = (slot, rows = []) =>
  rows.find(
    (row) =>
      String(row?.schedule_template_id ?? '') === String(slot.template.id) && rowCoversDate(row, slot.dateKey)
  ) || null;

// A one-off shift: a row with no template. It occupies no slot - it IS the shift - which is why the server's conflict
// check treats these as never colliding (a day may hold several) and why they are listed separately.
export const isCustomShift = (row) => !String(row?.schedule_template_id ?? '').trim();

// The field set a schedule row is WRITTEN with, in one place because getting it wrong loses data rather than failing.
//
// THE WRITER DOES NOT MERGE. functions/index.js#scheduleFieldsFrom builds a complete field set from what it is handed and
// writes that over the row, so an entry that omits a field BLANKS it - which is how a partial update would quietly wipe a
// custom shift's own times, or its apparatus, while appearing to succeed. Every key is therefore sent every time, empty
// string included. Both screens that write a row use this, so neither can send a different set from the other.
export const rowFieldsOf = (row) => ({
  id: row?.id || '',
  schedule_template_id: row?.schedule_template_id || '',
  date_from: row?.date_from || '',
  date_to: row?.date_to || '',
  start_time: row?.start_time || '',
  end_time: row?.end_time || '',
  apparatus_id: row?.apparatus_id || '',
  assignment_id: row?.assignment_id || '',
  user_id: row?.user_id || '',
});

// Every slot in a month: every date crossed with every template that runs on that weekday.
//
// A retired or not-yet-effective template draws nothing (utils/scheduleTemplates), and neither does one whose ASSIGNMENT
// is outside its own window (utils/assignmentDates) - a shift that has ended is not a place to put somebody.
//
// `startMin`/`endMin` are minutes from midnight, which is what a slot is ORDERED by. `endMin` is null for a shift with no
// end time rather than 0, because midnight and "no end" are different answers and 0 would sort a night shift to the top
// of the morning.
//
// `assignment` is carried on the slot as well as the fields derived from it, so a caller can colour or icon a slot
// without looking the assignment up a second time and possibly getting a different answer.
export const templateSlotsForMonth = ({ year, month, scheduleTemplates = [], assignmentById = () => null }) => {
  const slots = [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    const dateKey = toDateKey(date);
    const dow = DAY_ORDER[date.getDay()];
    for (const template of scheduleTemplates) {
      if (String(template.day_of_week ?? '').trim().toLowerCase() !== dow) continue;
      if (!templateIsActiveOn(template, dateKey)) continue;
      const assignment = assignmentById(template.assignment_id);
      if (!assignmentIsActiveOn(assignment, dateKey)) continue;
      slots.push({
        slotKey: slotKeyOf(dateKey, template.id),
        dateKey,
        template,
        assignment,
        startMin: timeToMinutes(template.start_time) ?? 0,
        endMin: timeToMinutes(template.end_time),
        // The rank the SHIFT requires, taken from its assignment rather than from whoever fills it - so the order a day
        // reads does not change when a different member is put in it.
        requiredRankOrder: parseRankOrder(assignment?.rank_order_required),
        name: `${assignment?.description || unnamedLabel('assignment')} ${template.nickname || ''}`.trim(),
      });
    }
  }
  return slots;
};

// The slots grouped by the day they fall on, each day in the order it reads: start time, then the assignment's required
// rank (utils/crewOrder's compareSlotOrder). The input's order is deliberately not trusted - a slot's rank comes from its
// assignment, and pinning the order here is what keeps a day reading the same however the list arrived.
export const slotsByDay = (slots = []) => {
  const map = {};
  for (const slot of slots) (map[slot.dateKey] = map[slot.dateKey] || []).push(slot);
  for (const dateKey of Object.keys(map)) map[dateKey] = sortSlotOrder(map[dateKey]);
  return map;
};

// A MISSING VALUE IS NOT MIDNIGHT. `Number(null)` is 0 and `Number('')` is 0, so reading these straight would turn "no
// end time" into "ends at midnight" - which is not a missing answer but a wrong one, and it would hide a shift from the
// window menu on the strength of it. This is the same trap utils/crewOrder's header records for a missing start time.
const minutesOf = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

// A span of hours placed on ONE timeline, anchored at the hour the comparison starts from.
const unwrapHours = (startMin, endMin, anchorMin) => {
  const start = minutesOf(startMin);
  const end = minutesOf(endMin);
  if (start === null || end === null) return null;
  // An end at or before the start runs PAST MIDNIGHT rather than being an error, which is how a 22:00-04:00 night is
  // stored. It is extended rather than rejected, and 00:00-00:00 reads as a full day rather than an empty one.
  let from = start;
  let to = end <= start ? end + 1440 : end;
  // A span that begins before the window does is the small hours of the FOLLOWING morning - which is where an overnight
  // window's tail actually lives - so it is moved onto the window's timeline rather than compared against its start.
  if (from < anchorMin) {
    from += 1440;
    to += 1440;
  }
  return { from, to };
};

// Whether a place's hours fall INSIDE an availability window's hours.
//
// This is the question the All Members menu asks, and the reason it asks it: a member who claimed 18:00-06:00 is
// offering those hours and no others, so a 06:00-18:00 day shift beside their name is not an answer to "who can cover
// this?" - it is a shift they have not said they can work.
//
// IT IS CONTAINMENT, NOT OVERLAP. A shift that starts inside the window and runs past its end is NOT offered: the
// member said they are free until 06:00, and a shift ending at 08:00 is one they would have to leave. Matching is
// containment's own edge case - a shift that is exactly the window fits exactly - so "matches or falls within" is this
// one test.
//
// NOTHING IS HIDDEN ON A MISSING VALUE. A window with no hours to compare against, or a place with no end time, cannot
// be judged at all, and hiding a shift on a guess would be a silent loss the officer could not see. Both are kept.
export const placeFitsWindow = (place, availabilityWindow) => {
  const windowStart = timeToMinutes(availabilityWindow?.start_time);
  if (windowStart === null) return true;
  const windowHours = unwrapHours(windowStart, timeToMinutes(availabilityWindow?.end_time), windowStart);
  if (!windowHours) return true;
  const placeHours = unwrapHours(place?.startMin, place?.endMin, windowHours.from);
  if (!placeHours) return true;
  return placeHours.from >= windowHours.from && placeHours.to <= windowHours.to;
};

// The places that fit, and the ones that do not - returned together so a caller can SAY how many it is hiding. An empty
// list that does not admit to a filter is the fault this whole view already earned once.
export const placesFittingWindow = (places = [], availabilityWindow) => {
  const fitted = [];
  const outside = [];
  for (const place of Array.isArray(places) ? places : []) {
    (placeFitsWindow(place, availabilityWindow) ? fitted : outside).push(place);
  }
  return { fitted, outside };
};

// Every place on a day somebody can be put, which is the whole answer to "what can I do with this day": its template
// slots, then its one-off shifts.
//
// EACH PLACE CARRIES WHO IS IN IT, filled or not, so one list answers both halves of the question - what is free, and
// what is taken by whom - rather than the caller asking twice and risking the two answers disagreeing. `userId` is the
// member already there, '' when the place is free.
//
// `fields` is what a NEW row for a slot must carry to BE a row in that slot, kept here so two screens cannot build two
// different rows for one place. It is null for a one-off shift, which is already a row: putting somebody on one means
// writing the member onto it, not creating it.
export const placesForDate = ({ dateKey, slots = [], rows = [] }) => {
  const slotted = slots.map((slot) => {
    const occupant = slotOccupant(slot, rows);
    return {
      key: slot.slotKey,
      kind: 'slot',
      dateKey,
      slot,
      name: slot.name,
      startMin: slot.startMin,
      endMin: slot.endMin,
      occupant,
      userId: String(occupant?.user_id ?? '').trim(),
      // A COMPLETE field set, not a partial one: the writer replaces the row's fields with what it is given, so every
      // key is sent every time and the caller only has to set `user_id` (see rowFieldsOf).
      fields: {
        ...rowFieldsOf({}),
        schedule_template_id: slot.template.id,
        date_from: dateKey,
        date_to: dateKey,
        apparatus_id: slot.template.apparatus_id ?? '',
        assignment_id: slot.template.assignment_id,
      },
    };
  });

  const oneOff = rows
    .filter((row) => isCustomShift(row) && rowCoversDate(row, dateKey))
    .map((row) => ({
      key: `row-${row.id}`,
      kind: 'row',
      dateKey,
      row,
      name: String(row.description ?? '').trim() || 'Custom shift',
      startMin: timeToMinutes(row.start_time) ?? 0,
      endMin: timeToMinutes(row.end_time),
      occupant: row,
      userId: String(row?.user_id ?? '').trim(),
      // A one-off shift is already a row, so putting somebody on it means writing the member onto the row it already is -
      // with its OWN times and apparatus, hence the full field set rather than the two keys this actually changes.
      fields: rowFieldsOf(row),
    }));

  return [...slotted, ...oneOff].sort(
    (a, b) => a.startMin - b.startMin || String(a.name).localeCompare(String(b.name))
  );
};
