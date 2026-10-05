export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const DAY_ORDER = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// A MONTH AS A GRID: leading blanks up to the 1st's weekday, one cell per day, trailing blanks to the row's end.
//
// ONE BUILDER FOR THREE CALLERS. Both calendars built this inline - identically, down to the variable names - and the
// month picker needs exactly the same thing to be able to offer a day at all. A third copy is how the picker's calendar
// and the calendar behind it would come to disagree about which weekday the 1st falls on, so the geometry lives here
// and the two calendars were switched to it in the same change.
//
// Blanks are `null` rather than an empty Date, because "no day here" is a branch every caller has to take anyway (a
// padding cell is not clickable, not a drop target, and not a date) - and a sentinel Date would invite one of them to
// forget.
export const monthGridCells = (year, month) => {
  const cells = [];
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
};
