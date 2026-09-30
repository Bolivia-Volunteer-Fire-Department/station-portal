// The window of `schedule` rows a load carries: LAST month, THIS month and NEXT month.
//
// WHY A WINDOW AT ALL. `schedule` is the one collection that grows without limit - every shift the station has ever
// scheduled - and the sign-in payload used to read all of it, on every sign-in and after every admin save. A station
// three years in was reading three years of rows to draw a month.
//
// WHY THESE THREE MONTHS. A calendar is read at the month it is on, and the two neighbouring months are what its arrows
// reach for next; a schedule is edited forward, and last month is what "who was on that night?" asks about. A screen that
// goes further than that asks for what it needs - see the window on GET_SCHEDULE and the month the schedule board
// fetches before it edits one.
//
// DEPENDENCY-FREE ON PURPOSE, including its own date formatting: these are the same three lines as utils/scheduleDate's
// toDateKey, and a copy is cheaper than a Node harness being unable to load this module at all (see the note in
// firestoreWrites.js about app utils that import each other). Pure, so scripts/verify-schedule-window.mjs drives it.
const dateKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// 'YYYY-MM' for a date, which is the shape `windowCoversMonth` is asked about.
export const monthKeyFor = (date = new Date()) => dateKey(date).slice(0, 7);

// The first and last day of a 'YYYY-MM' month, as keys. Day 0 of the NEXT month is the last day of this one, which is
// what makes February and leap years somebody else's problem.
export const monthBoundsFor = (monthKey) => {
  const text = String(monthKey || '').trim();
  if (!/^\d{4}-\d{2}$/.test(text)) return null;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(5, 7));
  if (month < 1 || month > 12) return null;
  return { start: `${text}-01`, end: dateKey(new Date(year, month, 0)) };
};

// The window itself: the first of last month to the last day of next month. Both ends INCLUSIVE, and both in the
// 'YYYY-MM-DD' shape the app stores its date keys in - which sort chronologically as text, so comparisons need no parsing.
export const scheduleWindowFor = (date = new Date()) => {
  const year = date.getFullYear();
  const month = date.getMonth();
  return {
    from: dateKey(new Date(year, month - 1, 1)),
    to: dateKey(new Date(year, month + 2, 0)),
  };
};

// Whether a window covers a whole month, so a screen can tell "I already have this" from "I need to ask for it".
//
// BOTH ENDS ARE COMPARED, and a window that covers only PART of the month answers no: a board editing March needs all of
// March, and half a month of rows would look exactly like a month with missing shifts.
export const windowCoversMonth = (window, monthKey) => {
  const bounds = monthBoundsFor(monthKey);
  if (!bounds || !window) return false;
  return String(window.from || '') <= bounds.start && String(window.to || '') >= bounds.end;
};
