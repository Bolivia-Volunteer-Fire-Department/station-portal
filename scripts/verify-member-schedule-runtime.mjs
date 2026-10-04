/**
 * MY SCHEDULE ON A NARROW SCREEN: one day, and arrows that walk days.
 *
 *   npm run verify:member-schedule-runtime
 *
 * The member calendar is two screens in one, exactly as Administration's Schedule Management is. Below Tailwind's `md`
 * (768px - the width the sidebar changes shape at) it shows TODAY rather than the month, its arrows walk DAYS, and a
 * day's pill is drawn large enough to carry the shift's window rather than clipping it into a 76px cell.
 *
 * WHY THIS NEEDS A REAL DOM, like its sibling verify-admin-schedule-runtime: this screen's data arrives from an EFFECT.
 * The month is read when it is looked at, so "did walking a day cost a read?" and "did widening the window cost one?"
 * are questions about a run of effects and promises, and a server render cannot run any of it - it does not even
 * commit. The arrows are also behind a media query, so a harness that renders once, server-side, sees only the month
 * view and would report the day view as never happening.
 *
 * AND THE VIEWPORT IS THE HARNESS'S OWN, through scripts/dom-env.mjs: `setViewportWidth` resizes the window and fires
 * the breakpoint, which is what makes "narrow the window and watch it switch" assertable at all.
 */
import { setViewportWidth } from './dom-env.mjs';
import React from 'react';
import { render, fireEvent, act, cleanup } from '@testing-library/react';
import ScheduleCalendar from '../src/components/ScheduleCalendar.jsx';

let failures = 0;
const check = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || detail === undefined ? '' : ` -> ${detail}`}`);
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_ORDER = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const THIS_YEAR = now.getFullYear();
const THIS_MONTH = now.getMonth();
const TODAY_DAY = now.getDate();
const LAST_DAY = new Date(THIS_YEAR, THIS_MONTH + 1, 0).getDate();
const dayKey = (year, month, day) => `${year}-${pad(month + 1)}-${pad(day)}`;
const monthStart = (year, month) => dayKey(year, month, 1);
const monthEnd = (year, month) => dayKey(year, month, new Date(year, month + 1, 0).getDate());
const monthLabel = (year, month) => `${MONTHS[month]} ${year}`;
// The day's own name, as the toolbar draws it: "Sat, Oct 3".
const dayLabelFor = (year, month, day) =>
  `${SHORT_DAYS[new Date(year, month, day).getDay()]}, ${MONTHS[month].slice(0, 3)} ${day}`;

const ME = { id: 'u1', name: 'Matt Rivers', role_id: 'r2', rank_id: 'k1' };
const OTHER = { id: 'u2', name: 'Ana Ruiz', role_id: 'r2', rank_id: 'k2' };
const ranks = [
  { id: 'k1', description: 'Officer', color: '#ef4444' },
  { id: 'k2', description: 'Driver', color: '#2563eb' },
];
// A template for EVERY weekday, so a row on any day of any month has a slot to sit in - otherwise the row falls into
// the open-shift list instead and the pill under test is not the pill being asserted about.
const scheduleTemplates = SHORT_DAYS.map((_, index) => ({
  id: `t-${index}`,
  day_of_week: DAY_ORDER[index],
  start_time: '08:00',
  end_time: '18:00',
  assignment_id: 'a1',
}));
const assignments = [{ id: 'a1', description: 'Firefighter 3', color: '#475569', icon: 'flame' }];

// ONE filled row on one day of a month, naming one member - so "which day (or month) is on screen" is a question about
// which day's label, or whose name, is in the DOM. The assignment is a parameter because a fixture needs two DIFFERENT
// shifts to tell "listed for this day" from "listed for this month".
const rowOn = (year, month, day, member, assignmentId = 'a1') => ({
  id: `s-${year}-${month}-${day}-${member.id}-${assignmentId}`,
  schedule_template_id: `t-${new Date(year, month, day).getDay()}`,
  assignment_id: assignmentId,
  user_id: member.id,
  date_from: dayKey(year, month, day),
  date_to: dayKey(year, month, day),
});
// A SECOND assignment, so a shift on another day can be recognised by name wherever it turns up.
const ENGINE_DRIVER = { id: 'a2', description: 'Engine Driver', color: '#0f766e', icon: 'truck' };

// Flushes the effect that asks for the month and the render that carries its answer. Two turns of the microtask queue
// then a macrotask, because the read is started in one effect and the rows are drawn by the next render.
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
// THE CALENDAR, WIRED THE WAY App WIRES IT: the reader asks for a month, and the ANSWER COMES BACK AS PROPS. That is the
// only way "it did not read again" can be observed, because the screen draws what it was handed rather than what it
// asked for - a harness that skipped this step would be asserting about an empty grid.
const Harness = ({ rowsByMonth, calls, overrides }) => {
  const [state, setState] = React.useState({ schedule: [], window: { from: '', to: '' } });
  const onNeedSchedule = (from, to) => {
    calls.push({ from, to });
    const rows = rowsByMonth[String(from).slice(0, 7)] || [];
    setState({ schedule: rows, window: { from, to } });
    return Promise.resolve(rows);
  };
  return React.createElement(ScheduleCalendar, {
    currentUser: ME,
    schedule: state.schedule,
    scheduleWindow: state.window,
    onNeedSchedule,
    assignments,
    scheduleTemplates,
    ranks,
    users: [ME, OTHER],
    offers: [],
    events: [],
    roles: [],
    token: 'test-token',
    canMakeOffers: false,
    canViewFullSchedule: true,
    ...overrides,
  });
};

const openCalendar = (rowsByMonth, overrides = {}) => {
  const calls = [];
  const view = render(React.createElement(Harness, { rowsByMonth, calls, overrides }));
  return { ...view, calls };
};

// The day cells - the one thing that says how many days are on screen. Counted rather than looked for by date, because
// the day view states its own date in a longer form than the toolbar uses.
const dayCells = (scope) =>
  [...scope.querySelectorAll('div')].filter((el) => /flex flex-col items-stretch/.test(String(el.className)));
// THE GRID ITSELF is the cells' own parent, which is a structural fact rather than a class name - and it is what the
// pills must be counted within. The details list below the calendar is full-width buttons too, so a search from the
// container would count those as pills and report the day view as still clipped.
const gridOf = (scope) => dayCells(scope)[0]?.parentElement || null;
const shiftPills = (scope) => (gridOf(scope) ? [...gridOf(scope).querySelectorAll('button')] : []);
const inBody = (selector) => document.body.querySelector(selector);
const title = () => (document.body.querySelector('h3')?.textContent || '').trim();
const arrowLabels = () =>
  [...document.body.querySelectorAll('button[aria-label]')].map((b) => b.getAttribute('aria-label')).join(', ');
// The month, asked for once and drawn by a second render. Every case below opens with this.
const readMonth = (calls, year, month) =>
  calls.length > 0 &&
  calls.every((c) => c.from === monthStart(year, month) && c.to === monthEnd(year, month)) &&
  calls.length <= 2;

// ONE PRESS OF AN ARROW, WHICH IS TWO PHASES OF A SLIDE.
//
// The calendar does not change its date when the arrow is pressed: the grid slides out, the swap happens WHILE IT IS OFF
// THE EDGE, and the new day slides in - and the animation is the clock (`onAnimationEnd`). jsdom runs no CSS, so nothing
// would ever fire and the calendar would sit on the same day forever; the harness rings the bell itself, twice, which is
// exactly what a browser does. A harness that pressed the button and stopped would report the arrows as broken.
const settle = async (scope) => {
  const grid = gridOf(scope);
  await act(async () => {
    fireEvent.animationEnd(grid);
  });
  await act(async () => {
    fireEvent.animationEnd(grid);
  });
  await flush();
};

const step = async (arrow, scope) => {
  fireEvent.click(inBody(`button[aria-label="${arrow}"]`));
  await settle(scope);
};

console.log('\n--- the month view, on a wide screen ---');
{
  setViewportWidth(1024);
  const { container, calls } = openCalendar({
    [`${THIS_YEAR}-${pad(THIS_MONTH + 1)}`]: [rowOn(THIS_YEAR, THIS_MONTH, 15, ME)],
  });
  await flush();

  check(
    'the month today falls in is read, once',
    readMonth(calls, THIS_YEAR, THIS_MONTH),
    calls.map((c) => `${c.from}..${c.to}`).join(' | ') || 'no read at all'
  );
  check('and the calendar draws it', dayCells(container).length > 27, `${dayCells(container).length} day cell(s)`);
  check('naming the month', title() === monthLabel(THIS_YEAR, THIS_MONTH), title());
  check(
    'with arrows labelled for months',
    Boolean(inBody('button[aria-label="Next month"]')) && Boolean(inBody('button[aria-label="Previous month"]')),
    arrowLabels()
  );
  check(
    'and the weekday row over the grid',
    // `includes` rather than a word-boundary match: the seven names are adjacent text ("SunMonTue..."), so there are no
    // word boundaries between them at all.
    document.body.textContent.includes('Sun') && document.body.textContent.includes('Sat'),
    'no weekday row'
  );
  // The month's pill is the CLIPPED one: 10px, one line each, no room for the window to breathe. Asserted as the shape
  // the day view is allowed to differ from, so "roomier on a phone" cannot creep into the calendar.
  const pills = shiftPills(container);
  check(
    'the month pill is still clipped into the cell',
    pills.length > 0 && pills.every((pill) => /truncate/.test(pill.innerHTML)),
    `${pills.length} pill(s)`
  );
  check(
    'and the details below list the month',
    document.body.textContent.includes(`Schedule Details — ${monthLabel(THIS_YEAR, THIS_MONTH)}`),
    'no details heading'
  );
  cleanup();
}
console.log('\n--- a month step keeps the day, so narrowing lands on it ---');
{
  // WHAT THIS PINS is the day surviving a MONTH step. Stepping a month is the one movement that has no day in it - the
  // calendar draws a month, not a day - so the obvious implementation drops the date back to the 1st, and the fault is
  // invisible on a wide screen: the month is drawn either way. It shows up when the window is narrowed afterwards, and
  // the day view then opens on the 1st instead of on the day the member was in the middle of.
  setViewportWidth(1024);
  const nextYear = THIS_MONTH === 11 ? THIS_YEAR + 1 : THIS_YEAR;
  const nextMonth = (THIS_MONTH + 1) % 12;
  const { container } = openCalendar({
    [`${THIS_YEAR}-${pad(THIS_MONTH + 1)}`]: [rowOn(THIS_YEAR, THIS_MONTH, TODAY_DAY, ME)],
    [`${nextYear}-${pad(nextMonth + 1)}`]: [],
  });
  await flush();

  await step('Next month', container);
  check('the month steps forward', title() === monthLabel(nextYear, nextMonth), title());

  await act(async () => {
    setViewportWidth(375);
  });
  await flush();
  // CLAMPED into the month it landed in - the 31st is the 28th or the 30th where there is no 31st - which is the one
  // rule that makes this safe for every date rather than only for the middle of a month.
  const landingDay = Math.min(TODAY_DAY, new Date(nextYear, nextMonth + 1, 0).getDate());
  check(
    'and narrowed, the day view is on that day, not on the 1st',
    title() === dayLabelFor(nextYear, nextMonth, landingDay),
    `${title()} (expected day ${landingDay})`
  );
  cleanup();
  setViewportWidth(1024);
}

console.log('\n--- a narrow window: one day, and arrows that walk days ---');

console.log('\n--- a narrow window: one day, and arrows that walk days ---');
{
  setViewportWidth(375);
  const otherDay = TODAY_DAY === 20 ? 21 : 20;
  const { container, calls } = openCalendar(
    {
      [`${THIS_YEAR}-${pad(THIS_MONTH + 1)}`]: [
        rowOn(THIS_YEAR, THIS_MONTH, TODAY_DAY, ME),
        // THE SECOND SHIFT, on another day of the same month and also the member's own. It is the fixture for the scope
        // of the details list below, and it is why the assignment is a different one.
        rowOn(THIS_YEAR, THIS_MONTH, otherDay, ME, ENGINE_DRIVER.id),
      ],
    },
    { assignments: [...assignments, ENGINE_DRIVER] }
  );
  await flush();

  // THE READ IS UNCHANGED: the day view draws one day of the month's rows, so it still asks for the month, and asks for
  // it once. That is the whole claim that a phone costs nothing extra.
  check(
    'a phone reads the month today falls in, once',
    readMonth(calls, THIS_YEAR, THIS_MONTH),
    calls.map((c) => `${c.from}..${c.to}`).join(' | ') || 'no read at all'
  );
  check('and draws exactly one day', dayCells(container).length === 1, `${dayCells(container).length} day cell(s)`);
  check('which is today', title() === dayLabelFor(THIS_YEAR, THIS_MONTH, TODAY_DAY), title());
  // THE WEEKDAY ROW GOES WITH THE CALENDAR, since it names seven days and this view draws one. Asserted by the class the
  // grid columns are made of, because the names are adjacent text with no word boundaries to match on.
  check(
    'and the seven-column weekday row is gone with the columns',
    !container.innerHTML.includes('grid-cols-7'),
    'the calendar header is drawn over a single day'
  );
  check(
    'and arrows labelled for days',
    Boolean(inBody('button[aria-label="Next day"]')) && Boolean(inBody('button[aria-label="Previous day"]')),
    arrowLabels()
  );

  // THE REGULAR INFORMATION IS ON THE PILL - the whole reason for the extra room. Nothing is truncated, and the window
  // has a line of its own rather than being appended to a 10px label.
  const pills = shiftPills(container);
  check('the day draws its shift as a pill', pills.length > 0, `${pills.length} pill(s)`);
  check(
    'and nothing on it is clipped',
    pills.every((pill) => !/truncate/.test(pill.innerHTML)),
    pills.map((p) => p.innerHTML).join(' || ').slice(0, 200)
  );
  // ...AND THE PILL ITSELF IS NOT THE CLIPPED SHAPE, which the innerHTML cannot see: the month's pill carries
  // `truncate` and `overflow-hidden` on the BUTTON, and a day drawn in that shape would cut off the very line the extra
  // room was for. Both are asserted, because a pill can be wrong in either half.
  check(
    'and it is drawn in the day shape rather than the month one',
    pills.every((pill) => !/truncate|overflow-hidden/.test(String(pill.className))) &&
      pills.every((pill) => /\btext-xs\b/.test(String(pill.className))),
    pills.map((p) => p.className).join(' || ')
  );
  check(
    "and it carries the shift's window",
    /8:00 AM/.test(document.body.textContent) && /6:00 PM/.test(document.body.textContent),
    document.body.textContent.slice(0, 200)
  );
  check(
    'on a line of its own, under the name',
    /class="block text-\[11px\] font-normal/.test(container.innerHTML),
    'the window is not drawn as its own line'
  );
  // THE DETAILS LIST FOLLOWS THE VIEW: a month of rows under a single day would be a list of things that are not on
  // screen, which is the same rule the schedule board's day view follows.
  check(
    'and the details below name the day rather than the month',
    document.body.textContent.includes(`Schedule Details — ${dayLabelFor(THIS_YEAR, THIS_MONTH, TODAY_DAY)}`) &&
      !document.body.textContent.includes(`Schedule Details — ${monthLabel(THIS_YEAR, THIS_MONTH)}`),
    document.body.textContent.slice(0, 200)
  );
  // ...AND THE SCOPE OF THAT LIST IS THE VIEW'S, which the heading alone cannot show: a day's heading over a month of
  // rows is exactly the fault. The member's own shift on ANOTHER day of the same month is the fixture - it is not drawn
  // in this day's grid, so if it is in the DOM at all it came in through the details list.
  check(
    "a shift on another day of the month is not listed for this day",
    /Firefighter 3/.test(container.textContent) && !document.body.textContent.includes(ENGINE_DRIVER.description),
    document.body.textContent.slice(0, 240)
  );
  // ...AND THE SAME SCREEN, WIDENED, DOES LIST IT - so the difference is the view's scope and not a fixture that was
  // never drawn at all. This half is what makes the check above mean something.
  await act(async () => {
    setViewportWidth(1024);
  });
  await flush();
  check(
    'while the calendar lists the whole month',
    document.body.textContent.includes(ENGINE_DRIVER.description),
    document.body.textContent.slice(0, 240)
  );
  await act(async () => {
    setViewportWidth(375);
  });
  await flush();

  // WALKING A DAY INSIDE THE MONTH COSTS NO READ: the day is a slice of rows already in hand.
  const stepDelta = TODAY_DAY > 1 ? -1 : 1;
  const steppedDay = TODAY_DAY + stepDelta;
  const readsBefore = calls.length;
  await step(stepDelta < 0 ? 'Previous day' : 'Next day', container);
  check(
    'the arrows walk a day, not a month',
    title() === dayLabelFor(THIS_YEAR, THIS_MONTH, steppedDay),
    title()
  );
  check(
    'and walking inside the month asks the reader for nothing',
    calls.length === readsBefore,
    `${calls.length - readsBefore} extra read(s) for a day already held`
  );

  // RESIZING. One component, one piece of state, so widening the window turns the SAME reading into the calendar: the
  // day is kept, the month is kept, and nothing is read to do it.
  const readsBeforeResize = calls.length;
  await act(async () => {
    setViewportWidth(1024);
  });
  await flush();
  check(
    'widening the window turns the same day into the month',
    dayCells(container).length > 27 && title() === monthLabel(THIS_YEAR, THIS_MONTH),
    `${dayCells(container).length} cell(s), title "${title()}"`
  );
  check(
    'without reading anything again',
    calls.length === readsBeforeResize,
    `${calls.length - readsBeforeResize} read(s) for a resize`
  );
  check(
    'and the calendar clips its pills to the cell again',
    shiftPills(container).some((pill) => /truncate/.test(pill.innerHTML)),
    'the month pills are still drawn in the day view shape'
  );

  // ...AND BACK, which is the half that proves the two views share ONE day: the calendar returns to the day that was
  // stepped to, not to today and not to the 1st.
  await act(async () => {
    setViewportWidth(375);
  });
  await flush();
  check(
    'narrowing it again comes back to the day that was on screen',
    title() === dayLabelFor(THIS_YEAR, THIS_MONTH, steppedDay),
    title()
  );
  cleanup();
  setViewportWidth(1024);
}

console.log('\n--- walking off the end of the month ---');
{
  setViewportWidth(375);
  const nextYear = THIS_MONTH === 11 ? THIS_YEAR + 1 : THIS_YEAR;
  const nextMonth = (THIS_MONTH + 1) % 12;
  const { container, calls } = openCalendar({
    [`${THIS_YEAR}-${pad(THIS_MONTH + 1)}`]: [rowOn(THIS_YEAR, THIS_MONTH, TODAY_DAY, ME)],
    [`${nextYear}-${pad(nextMonth + 1)}`]: [rowOn(nextYear, nextMonth, 1, ME)],
  });
  await flush();

  // Every press from today to the last day of the month, then one more to leave it. The calendar has no special case for
  // the boundary - `Date` normalizes the day overflow - so this is what proves the wrap is the calendar's rather than a
  // second implementation of one.
  for (let i = 0; i < LAST_DAY - TODAY_DAY + 1; i++) {
    await step('Next day', container);
  }
  check(
    'walking past the last day reads the month it walked into',
    calls.length > 1 &&
      calls[calls.length - 1].from === monthStart(nextYear, nextMonth) &&
      calls[calls.length - 1].to === monthEnd(nextYear, nextMonth),
    calls.map((c) => `${c.from}..${c.to}`).join(' | ')
  );
  check('and lands on the 1st of it', title() === dayLabelFor(nextYear, nextMonth, 1), title());
  check(
    'and draws that day, with the shift it holds',
    shiftPills(container).length > 0 && /Firefighter 3/.test(gridOf(container).textContent || ''),
    `grid says: ${(gridOf(container).textContent || '').slice(0, 120)}`
  );
  check(
    'having read the new month a bounded number of times',
    calls.length <= 3,
    `${calls.length} reads across one month boundary`
  );
  cleanup();
  setViewportWidth(1024);
}

console.log('\n--- Today, in both units ---');
{
  // The one control that has to mean something in both views: today's MONTH in the calendar, and TODAY in the day view.
  // It is also the case that proves stepping a month keeps a real day - otherwise a window narrowed afterwards would
  // land on the 1st rather than on today.
  setViewportWidth(1024);
  const nextYear = THIS_MONTH === 11 ? THIS_YEAR + 1 : THIS_YEAR;
  const nextMonth = (THIS_MONTH + 1) % 12;
  const { container, calls } = openCalendar({
    [`${THIS_YEAR}-${pad(THIS_MONTH + 1)}`]: [rowOn(THIS_YEAR, THIS_MONTH, TODAY_DAY, ME)],
    [`${nextYear}-${pad(nextMonth + 1)}`]: [],
  });
  await flush();

  await step('Next month', container);
  check('a month step walks the calendar forward', title() === monthLabel(nextYear, nextMonth), title());

  fireEvent.click([...document.body.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Today'));
  await settle(container);
  check('and Today comes back to the month today falls in', title() === monthLabel(THIS_YEAR, THIS_MONTH), title());

  // Narrowed, that same state has to be TODAY - not the 1st of the month, and not the day that happened to be in view.
  await act(async () => {
    setViewportWidth(375);
  });
  await flush();
  check(
    'and narrowed, it is today rather than the 1st',
    title() === dayLabelFor(THIS_YEAR, THIS_MONTH, TODAY_DAY),
    title()
  );
  check('with a bounded number of reads for all of it', calls.length <= 4, `${calls.length} reads`);
  cleanup();
  setViewportWidth(1024);
}
console.log('\n--- the crew view, in a day ---');
{
  // The one thing this view must not lose: the day view is a different SHAPE, not a different set of facts. In the crew
  // view the first line of a pill is a member's name, and that is where their rank dot and their certification icons go
  // (see components/RankDot and components/MemberName) - so a phone must still answer "who am I on with".
  setViewportWidth(375);
  const { container } = openCalendar({
    [`${THIS_YEAR}-${pad(THIS_MONTH + 1)}`]: [rowOn(THIS_YEAR, THIS_MONTH, TODAY_DAY, OTHER)],
  });
  await flush();

  // The personal view first, because it is the state the screen opens in: somebody else's shift is not drawn at all.
  check(
    "a day holding only somebody else's shift shows nothing of it",
    !container.textContent.includes(OTHER.name),
    container.textContent.slice(0, 160)
  );

  const crewToggle = [...document.body.querySelectorAll('button')].find((b) => b.textContent.includes('everyone'));
  check('the crew view is offered', Boolean(crewToggle), 'no toggle');
  fireEvent.click(crewToggle);
  await flush();
  check('and the day names them', container.textContent.includes(OTHER.name), container.textContent.slice(0, 160));
  // The rank dot, in the colour Administration → Ranks holds for Driver. The same assertion the calendar's own dot
  // harness makes, repeated here because the pill it sits on is a different size and shape in this view.
  const dots = [...container.querySelectorAll('span')].filter(
    (el) =>
      el.getAttribute('aria-hidden') === 'true' &&
      /rgb\(37, 99, 235\)|#2563eb/i.test(String(el.style.backgroundColor))
  );
  check('with their rank dot on the pill', dots.length === 1, `${dots.length} dot(s) in the Driver colour`);
  check(
    'inside the element that names them',
    (dots[0]?.parentElement?.textContent || '').includes(OTHER.name),
    dots[0]?.parentElement?.textContent
  );
  cleanup();
  setViewportWidth(1024);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);