// The order of one day's pills: shifts in time order, with events placed among them.
//
// Both calendars used to draw every event ABOVE every shift, which read well until a day held both: an event at
// 6:00 PM sat above a shift that started at 8:00 AM, and a calendar cell is read top to bottom, in the order the day
// happens. The two streams are interleaved by start time instead.
//
// Where an event and a shift start at the same minute the EVENT goes first. Neither is more important, but an event
// is context for the day rather than work within it, and a coincidence reads better as "the meeting that starts as
// your shift does" above the shift than below it.
//
// Each stream is sorted here by start minute only, and the sort is stable, so:
//
//   * a shift list that has already been put in crew order (utils/crewOrder - start, filled before open, required
//     rank, then name) keeps that order within each start minute: this decides where events go, and nothing else;
//   * an event that began on an earlier day counts as starting at midnight, the convention the engine already
//     applies when it segments a span (see eventSegment in utils/events), so a multi-day event heads each day it
//     continues into - the same way the printed sheet places it;
//   * anything with no readable start time sorts after everything timed, rather than pretending to be midnight.
//
// The two are kept as separate streams rather than one list of "things", because only one of them is a shift: the
// calendars colour, sort and click them differently, and only the shifts are offerable or draggable.
//
// Pure and dependency-free, so it can be exercised without React - see scripts/verify-crew-order.mjs.
const MISSING = Number.MAX_SAFE_INTEGER;

const minutesOf = (raw) => {
  // Number(null) and Number('') are both 0, so blanks have to be rejected explicitly or a shift with no time would
  // silently sort as midnight - and midnight is a real start time, so the two must not be confused.
  if (raw === null || raw === undefined || raw === '') return MISSING;
  const value = Number(raw);
  return Number.isFinite(value) ? value : MISSING;
};

// A shift's start minute, from the shape utils/crewOrder also reads.
export const shiftStartMinute = (shift) => minutesOf(shift?.startMin);

// An event segment's start minute on its own day. Already 0 when the segment continues from an earlier day.
export const eventStartMinute = (segment) => minutesOf(segment?.startMinutes);

const orderedByStart = (items, minuteOf) =>
  (Array.isArray(items) ? items : []).slice().sort((a, b) => minuteOf(a) - minuteOf(b));

/**
 * One day's items in the order they happen: `[{ kind: 'event'|'shift', value }]`.
 *
 * Shifts keep their incoming order within a start minute, so a crew-ordered list stays crew-ordered; events keep
 * theirs likewise. Callers pass the day's shifts and the day's event segments, and render by `kind`.
 */
export const mergeDayItems = (shifts, events) => {
  const shiftRows = orderedByStart(shifts, shiftStartMinute);
  const eventRows = orderedByStart(events, eventStartMinute);

  const merged = [];
  let shift = 0;
  let event = 0;
  while (shift < shiftRows.length && event < eventRows.length) {
    // The `<=` IS the tie rule: an event that starts at the same minute as a shift goes above it. A pair of
    // timeless items tie too, and the event leads, which is at least consistent with every other tie.
    if (eventStartMinute(eventRows[event]) <= shiftStartMinute(shiftRows[shift])) {
      merged.push({ kind: 'event', value: eventRows[event] });
      event += 1;
    } else {
      merged.push({ kind: 'shift', value: shiftRows[shift] });
      shift += 1;
    }
  }
  while (shift < shiftRows.length) merged.push({ kind: 'shift', value: shiftRows[shift++] });
  while (event < eventRows.length) merged.push({ kind: 'event', value: eventRows[event++] });
  return merged;
};
