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

// THE MONTH VIEW, named rather than left as a falsy span. The day views answer with a NUMBER OF DAYS, and the month view
// has no day count at all - so the three shapes are three answers, and `dayViewSpan` returns this string for the third.
// A component that tested the span as a number would read the month view as a span of zero days.
export const MONTH_VIEW = 'month';

// HOW MANY DAYS A WINDOW SHOWS, OR THE WHOLE MONTH.
//
// Three shapes, from the two viewport answers (utils/viewport):
//
//   desktop  - the month grid, which is what a sidebar-and-a-board layout has the width for.
//   tablet   - TWO days, today and tomorrow. The sidebar has collapsed, so the month grid no longer fits, but two
//              columns do - and the question a member opens Schedule to answer is overwhelmingly "what have I got, and
//              what is coming", which is a day and the day after it.
//   phone    - ONE day, and the window's height to itself.
//
// THE ORDER OF THE TESTS IS THE POINT, and it is why the phone query is written as an upper bound rather than
// `min-width: 640px`. As two `min-width` queries the ranges OVERLAP - a 700px window matches both - so "is this a tablet"
// could not be answered by asking which query matched. Written as `(max-width: 639px)` they are disjoint, and `desktop`
// is checked first so that a window too wide for the month grid can never fall through to the tablet branch.
//
// Returned as data rather than decided in each component, because THREE places need this answer and they must not be
// able to disagree: the grid that draws the days, the arrows that step them, and the read that has to cover them. Two
// components (the member's Schedule and the officer's board) draw it, so the rule is shared rather than restated.
export const dayViewSpan = ({ isDesktop, isPhone }) => {
  if (isDesktop) return MONTH_VIEW;
  return isPhone ? 1 : 2;
};

// THE DAYS A SPAN COVERS, starting at the given date.
//
// ONE FUNCTION FOR BOTH CALENDARS AND THE ARROWS, because they must agree about where a span ENDS: the grid draws
// `[date, date + 1]` while a mistake here reads as a two-column grid whose second column is blank.
//
// A plain `new Date(y, m, d + i)` rather than anything cleverer, because the Date constructor NORMALISES an overflowing
// day - `new Date(2026, 0, 32)` is 1 February, which is what makes a span crossing a month boundary (or a leap day, or
// the 1st of March) come out right without a line of special-casing. A span of zero days yields an empty list, so a
// caller that cannot decide its span still gets something it can draw.
export const spanDayDates = (date, span) => {
  const count = Math.max(0, Math.floor(Number(span) || 0));
  return Array.from({ length: count }, (_, i) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + i));
};
