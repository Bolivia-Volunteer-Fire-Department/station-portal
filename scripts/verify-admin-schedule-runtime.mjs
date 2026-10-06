// MOUNTS THE ADMIN SCHEDULE BOARD IN A REAL DOM, WITH ITS EFFECTS RUNNING.
//
//   npm run verify:admin-schedule-runtime
//
// WHY THIS FILE EXISTS. Every other harness here server-renders, and a server render never commits - so it never runs an
// effect. This board's whole data path lives in effects, and that gap let a run of bugs ship past a full green suite, each
// one found by an officer looking at a board that would not load:
//
//   1. `onNeedSchedule` was passed by App and dropped by AdminPanel. The board had no reader, so it drew a stale array.
//      A prop that arrives nowhere produces no error - only a board that quietly shows the wrong month.
//   2. The read effect listed `onNeedSchedule` as a dependency. App re-creates that function on every render, so the
//      effect re-ran after every read it had just started: an unbounded loop of Firestore reads.
//   3. The fix for (2) added a cleanup flag plus an "already reading this month" guard. `main.jsx` wraps the app in
//      StrictMode, which mounts, unmounts and remounts - so run one was cancelled, run two started nothing, and the
//      answer that arrived was discarded because it had been cancelled. The board never loaded at all.
//   4. The month's rows were seeded from a shared array a save had not refreshed, so a moved shift appeared to move back.
//
// The cases below assert what the officer SEES rather than how the code is shaped: the month is drawn, the spinner stops,
// and the reader is asked a bounded number of times. (1) is a wiring fact and is still pinned by a source check in
// scripts/verify-admin-render.mjs, which is the right tool for "does this JSX pass this prop"; (4) is covered by the
// month-walking case, which proves the board draws the month it read and not the one it left.
//
// IT FOUND A FIFTH BUG ON ITS FIRST RUN, which is the argument for it: a failed read left the spinner running forever,
// because "pending" was defined as "no rows loaded for this month" and a failed read never loads any. Reads do fail - a
// permission, a dropped channel - so on a bad network the board spun for as long as it was open. No server render can see
// that, and no source check was looking for it. See case 4.
//
// THE VIEWPORT IS THE HARNESS'S OWN since case 6: jsdom has no matchMedia, scripts/dom-env.mjs now answers width
// queries from `window.innerWidth`, and `setViewportWidth` resizes it. Its default is 1024px, so every case above is a
// DESKTOP window - which is what makes them cases about the calendar. Without that, the board would take its narrow
// branch in every one of them and quietly stop being tested.
import { setViewportWidth } from './dom-env.mjs';
import React from 'react';
import { render, fireEvent, act, cleanup } from '@testing-library/react';
import AdminScheduleManagementTab from '../src/components/admin/AdminScheduleManagementTab.jsx';
import { viewportPopoverPosition } from '../src/utils/viewportPopover.js';

let failures = 0;
const check = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || detail === undefined ? '' : ` -> ${detail}`}`);
};

// ---------------------------------------------------------------------------
// The month, and rows that belong to it
// ---------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const now = new Date();
const THIS_YEAR = now.getFullYear();
const THIS_MONTH = now.getMonth();
const dayKey = (year, month, day) => `${year}-${pad(month + 1)}-${pad(day)}`;
const monthStart = (year, month) => dayKey(year, month, 1);
const monthEnd = (year, month) => dayKey(year, month, new Date(year, month + 1, 0).getDate());
const monthLabel = (year, month) => `${MONTHS[month]} ${year}`;
const dowOf = (year, month, day) => WEEKDAYS[new Date(year, month, day).getDay()];

// A template for EVERY weekday, so a row on any day of any month has a slot to land in. The board matches a row to its
// slot by template and date, and a row whose template is not active that day would fall into the unmatched list instead -
// which would make every assertion below about the wrong thing.
const scheduleTemplates = WEEKDAYS.map((dow) => ({
  id: `t-${dow}`,
  day_of_week: dow,
  start_time: '08:00',
  end_time: '18:00',
  assignment_id: 'a1',
}));
const assignments = [{ id: 'a1', description: 'Firefighter 3' }];

// Two members, so a test can tell one month's rows from another's: the board names whoever a row is filled with, and
// "which month is on screen" is then a question about which name is in the DOM.
const MEMBERS = {
  thisMonth: { id: 'u9', name: 'Zed Quarles', role_id: 'r1', rank_id: 'k1', status: 'active' },
  nextMonth: { id: 'u8', name: 'Yara Nunez', role_id: 'r1', rank_id: 'k1', status: 'active' },
};
const users = Object.values(MEMBERS);

const filledRow = (id, member, year, month, day) => ({
  id,
  schedule_template_id: `t-${dowOf(year, month, day)}`,
  assignment_id: 'a1',
  user_id: member.id,
  date_from: dayKey(year, month, day),
  date_to: dayKey(year, month, day),
});

// Rows for one month: a single filled shift on the 15th, naming that month's member.
const rowsFor = (year, month, member) => [filledRow(`s-${year}-${month}`, member, year, month, 15)];

// Flushes effects and the promises they started. Two turns of the microtask queue, then a macrotask, because the board
// reads in one effect and seeds its copies in another that runs after the first one's promise lands.
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

// THE GRID THE SLIDE ANIMATES - the day cells' own parent, which is a fact about the markup rather than a class name
// that could be renamed out from under this harness. The predicate is `dayCells`'s own (defined further down, after
// the first case that needs it); a day cell always exists in every view, so there is always one to find.
const gridOf = (scope) => {
  const cell = [...scope.querySelectorAll('div')].find((el) => /flex flex-col gap-1/.test(String(el.className)));
  return cell ? cell.parentElement : null;
};

// ONE PRESS OF AN ARROW, WHICH IS TWO PHASES OF A SLIDE.
//
// The board does not change its date when the button is pressed: the grid slides out, the swap happens WHILE IT IS OFF
// THE EDGE, and the new day slides in - and the animation is the clock (`onAnimationEnd`). jsdom runs no CSS, so
// nothing would ever fire and the board would sit on the same day forever; the harness rings the bell itself, twice,
// which is exactly what a browser does. A harness that pressed the button and stopped would report every arrow on this
// screen as broken. See scripts/verify-member-schedule-runtime.mjs, which settles the member's calendar the same way.
const settle = async (scope) => {
  const grid = gridOf(scope);
  if (grid) {
    await act(async () => {
      fireEvent.animationEnd(grid);
    });
    await act(async () => {
      fireEvent.animationEnd(grid);
    });
  }
  await flush();
};

// A press of one of the board's own buttons, followed by the two phases of whatever slide it started.
const press = async (scope, button) => {
  fireEvent.click(button);
  await settle(scope);
};

// A reader that records every call, which is the only way to see a loop: the board renders the same thing whether it read
// the month once or two hundred times.
const makeReader = (rowsByMonth) => {
  const calls = [];
  const read = (from, to) => {
    calls.push({ from, to });
    const month = String(from).slice(0, 7);
    return Promise.resolve(rowsByMonth[month] ?? []);
  };
  return { read, calls };
};

const boardProps = (overrides = {}) => ({
  token: 'test-token',
  scheduleTemplates,
  assignments,
  ranks: [],
  users,
  rosterAvailability: [],
  rosterClaimsFrom: '',
  rosterClaimsTo: '',
  offers: [],
  events: [],
  timeFormat: '12',
  departmentName: 'Bolivia Volunteer Fire Department',
  onOffersChanged: async () => {},
  onAdminDataChanged: async () => {},
  ...overrides,
});

const text = (container) => container.textContent || '';

// ---------------------------------------------------------------------------
// 1. The board reads the month on screen, draws it, and stops spinning
// ---------------------------------------------------------------------------
console.log('\n--- the board reads the month on screen ---');
{
  const rowsByMonth = {
    [`${THIS_YEAR}-${pad(THIS_MONTH + 1)}`]: rowsFor(THIS_YEAR, THIS_MONTH, MEMBERS.thisMonth),
  };
  const { read, calls } = makeReader(rowsByMonth);
  const rosterCalls = [];
  const { container } = render(
    React.createElement(
      AdminScheduleManagementTab,
      boardProps({
        onNeedSchedule: read,
        onRosterMonth: (year, month) => {
          rosterCalls.push({ year, month });
          return Promise.resolve([]);
        },
      })
    )
  );

  // Before the read lands the board must SAY it is reading. An empty grid with no word about it looks like a station
  // with nothing scheduled, which is the failure this whole arrangement exists to avoid.
  check(
    'before the rows arrive the board says which month it is reading',
    text(container).includes(`Loading ${monthLabel(THIS_YEAR, THIS_MONTH)}`),
    text(container).slice(0, 160)
  );
  check('and it has asked for the month on screen', calls.length > 0, `${calls.length} reads`);
  check(
    'asking for that month from its first day to its last',
    calls.length > 0 &&
      calls[0].from === monthStart(THIS_YEAR, THIS_MONTH) &&
      calls[0].to === monthEnd(THIS_YEAR, THIS_MONTH),
    calls.length > 0 ? `${calls[0].from}..${calls[0].to}` : 'no read'
  );

  await flush();

  check(
    'the month it read is drawn, naming the member the row is filled with',
    text(container).includes(MEMBERS.thisMonth.name),
    text(container).slice(0, 200)
  );
  check(
    'and the spinner stops once the rows land',
    !text(container).includes(`Loading ${monthLabel(THIS_YEAR, THIS_MONTH)}`),
    'the board is still saying it is reading a month that has already arrived'
  );
  check(
    'and the vacant slot still names its assignment',
    text(container).includes('Firefighter 3'),
    'the board drew nothing from the templates'
  );

  // THE LOOP. The board looks identical whether it read the month once or forever, so the only way to see the fault that
  // shipped is to count. App re-creates `onNeedSchedule` on every render; an effect that depended on it re-ran after
  // every read it had started, and each read set state, which re-rendered App, which made a new function.
  const readsAfterLoad = calls.length;
  await flush();
  await flush();
  check(
    'and it does not keep reading the month it already has',
    calls.length === readsAfterLoad,
    `${calls.length} reads and counting - the effect is re-running after every read it starts`
  );
  check('having read the month a bounded number of times', calls.length <= 2, `${calls.length} reads`);
  check(
    'and asked for the crew claims over that month only',
    rosterCalls.length <= 1 && rosterCalls.every((c) => c.year === THIS_YEAR && c.month === THIS_MONTH),
    JSON.stringify(rosterCalls)
  );

  cleanup();
}

// ---------------------------------------------------------------------------
// 2. The same board under StrictMode, which mounts, unmounts and mounts again
// ---------------------------------------------------------------------------
console.log('\n--- the board loads under StrictMode ---');
{
  const rowsByMonth = {
    [`${THIS_YEAR}-${pad(THIS_MONTH + 1)}`]: rowsFor(THIS_YEAR, THIS_MONTH, MEMBERS.thisMonth),
  };
  const { read, calls } = makeReader(rowsByMonth);
  const { container } = render(
    React.createElement(
      React.StrictMode,
      null,
      React.createElement(AdminScheduleManagementTab, boardProps({ onNeedSchedule: read }))
    )
  );

  await flush();

  // This is the case that shipped broken. A cleanup flag plus an "already reading this month" guard meant the first run
  // was cancelled, the second run started nothing, and the answer that arrived was discarded because it had been
  // cancelled - so nothing was ever drawn and the spinner never stopped. `main.jsx` wraps the whole app in StrictMode,
  // which is why it only ever happened in the browser.
  check(
    'StrictMode does not stop the month loading',
    text(container).includes(MEMBERS.thisMonth.name),
    'the board is blank: the second mount started no read and the first was discarded as cancelled'
  );
  check(
    'and the spinner still stops',
    !text(container).includes(`Loading ${monthLabel(THIS_YEAR, THIS_MONTH)}`),
    'the spinner never stops under StrictMode'
  );
  check('and StrictMode costs at most one extra read, not a stream of them', calls.length <= 2, `${calls.length} reads`);

  cleanup();
}

// ---------------------------------------------------------------------------
// 3. Walking to the next month reads that month, and draws it instead
// ---------------------------------------------------------------------------
console.log('\n--- walking to the next month ---');
{
  const nextYear = THIS_MONTH === 11 ? THIS_YEAR + 1 : THIS_YEAR;
  const nextMonth = (THIS_MONTH + 1) % 12;
  const rowsByMonth = {
    [`${THIS_YEAR}-${pad(THIS_MONTH + 1)}`]: rowsFor(THIS_YEAR, THIS_MONTH, MEMBERS.thisMonth),
    [`${nextYear}-${pad(nextMonth + 1)}`]: rowsFor(nextYear, nextMonth, MEMBERS.nextMonth),
  };
  const { read, calls } = makeReader(rowsByMonth);
  const { container } = render(
    React.createElement(AdminScheduleManagementTab, boardProps({ onNeedSchedule: read }))
  );
  await flush();

  const nextButton = container.querySelector('button[aria-label="Next month"]');
  check('the board has a next-month button', Boolean(nextButton));
  const readsBefore = calls.length;
  await press(container, nextButton);

  check(
    'walking forward reads the month it walked to',
    calls.length > readsBefore &&
      calls[calls.length - 1].from === monthStart(nextYear, nextMonth) &&
      calls[calls.length - 1].to === monthEnd(nextYear, nextMonth),
    calls.map((c) => `${c.from}..${c.to}`).join(' | ')
  );
  check(
    'and draws that month, naming its member',
    text(container).includes(MEMBERS.nextMonth.name),
    text(container).slice(0, 200)
  );
  // The month left behind must go: two months on one grid is the other way this board has been wrong.
  check(
    'and no longer draws the month it walked away from',
    !text(container).includes(MEMBERS.thisMonth.name),
    'both months are on the grid at once'
  );
  check(
    'and reads the new month a bounded number of times',
    calls.length - readsBefore <= 2,
    `${calls.length - readsBefore} reads for one arrow press`
  );

  cleanup();
}

// ---------------------------------------------------------------------------
// 4. A month that could not be read says so, and stops spinning
// ---------------------------------------------------------------------------
console.log('\n--- a month that could not be read ---');
{
  // `loadScheduleWindow` resolves null when the read fails, rather than rejecting - so a failed month and an empty one
  // arrive the same way, and only the message tells them apart. A board that spun forever on the first, or drew an empty
  // grid and said nothing, would leave an officer with no idea which had happened.
  const failed = 'Could not read the schedule: permission-denied.';
  let calls = 0;
  const read = () => {
    calls += 1;
    return Promise.resolve(null);
  };
  const { container } = render(
    React.createElement(
      AdminScheduleManagementTab,
      boardProps({ onNeedSchedule: read, scheduleWindowError: failed })
    )
  );
  await flush();

  check('the board survives a failed read', text(container).length > 0);
  check(
    'and the spinner stops rather than spinning forever',
    !text(container).includes(`Loading ${monthLabel(THIS_YEAR, THIS_MONTH)}`),
    'a failed read leaves the board spinning'
  );
  check('and says why the month is empty', text(container).includes(failed), text(container).slice(0, 200));
  check('having tried the month once, not in a loop', calls <= 2, `${calls} reads`);

  cleanup();
}

// ---------------------------------------------------------------------------
// 5. A late answer from a month already left cannot overwrite the one on screen
// ---------------------------------------------------------------------------
console.log('\n--- a late answer from a month already left ---');
{
  const nextYear = THIS_MONTH === 11 ? THIS_YEAR + 1 : THIS_YEAR;
  const nextMonth = (THIS_MONTH + 1) % 12;
  // Reads the officer can be resolved by hand, in any order - which is what a slow network does on its own.
  const pending = [];
  const read = (from, to) => {
    const entry = { from, to, resolve: null, promise: null };
    entry.promise = new Promise((resolve) => {
      entry.resolve = resolve;
    });
    pending.push(entry);
    return entry.promise;
  };
  const { container } = render(
    React.createElement(AdminScheduleManagementTab, boardProps({ onNeedSchedule: read }))
  );
  check('the first month is asked for', pending.length > 0);

  const nextButton = container.querySelector('button[aria-label="Next month"]');
  await press(container, nextButton);
  check('and so is the month walked to', pending.length > 1, `${pending.length} reads`);

  const [firstRead, secondRead] = pending;
  // The month on screen answers first...
  await act(async () => {
    secondRead.resolve(rowsFor(nextYear, nextMonth, MEMBERS.nextMonth));
  });
  check(
    'the month on screen is drawn when its answer arrives',
    text(container).includes(MEMBERS.nextMonth.name),
    text(container).slice(0, 200)
  );

  // ...and the month already left behind answers afterwards. Its rows do not belong to the month on screen, so applying
  // them would scope to nothing and EMPTY the grid - the officer would watch a loaded month go blank.
  await act(async () => {
    firstRead.resolve(rowsFor(THIS_YEAR, THIS_MONTH, MEMBERS.thisMonth));
  });
  check(
    'and a late answer from the month left behind does not empty the board',
    text(container).includes(MEMBERS.nextMonth.name),
    'the newest month was overwritten by an older read'
  );
  check(
    'nor draw the month that was left',
    !text(container).includes(MEMBERS.thisMonth.name),
    'the month left behind came back'
  );

  cleanup();
}

// ---------------------------------------------------------------------------
// 6. A NARROW WINDOW: one day, and arrows that walk days
// ---------------------------------------------------------------------------
// The board is two screens in one. Below Tailwind's `md` (768px - the same threshold the sidebar switches at) it draws
// TODAY rather than the month, and its arrows walk DAYS; at or above it, the calendar, as before. What makes this worth
// a runtime case rather than a source check is the thing it must NOT do: change how the data is read. The month is still
// read once, and one day of it is drawn - so a phone costs no extra read, and widening the window costs none at all.
console.log('\n--- a narrow window: one day, and arrows that walk days ---');

const TODAY_DAY = now.getDate();
const LAST_DAY = new Date(THIS_YEAR, THIS_MONTH + 1, 0).getDate();
// A day label exactly as the board renders it (displayDate): "Sun, Oct 5". `SHORT_DAYS` rather than the harness's own
// WEEKDAYS, which is the lowercase list the TEMPLATES are matched by - a different thing that would make this expect
// "sunday, Oct 5".
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayLabelFor = (year, month, day) =>
  `${SHORT_DAYS[new Date(year, month, day).getDay()]}, ${MONTHS[month].slice(0, 3)} ${day}`;
// One member on ONE day of a month, so "which day is on screen" is a question about which name is in the DOM. The month
// is a parameter because the boundary case below needs a row in the month AFTER this one.
const rowsOn = (member, dayOfMonth, year = THIS_YEAR, month = THIS_MONTH) => [
  filledRow(`s-${member.id}-${year}-${month}-${dayOfMonth}`, member, year, month, dayOfMonth),
];
// The draggable pills - a staffed shift or an unfilled row. Used to read their SHAPE, which is what the two views
// differ in; an empty slot is a control rather than a pill and is not draggable.
const shiftPills = (scope) =>
  [...scope.querySelectorAll('div')].filter((el) => /cursor-grab/.test(String(el.className)));
// EVERY pill on the board, staffed or empty - for the facts that must appear once on each of them, whatever kind it is.
// A staffed pill is draggable; an empty slot carries the transition its hover states animate.
const boardPills = (scope) =>
  [...scope.querySelectorAll('div')].filter((el) => /cursor-grab|transition-colors/.test(String(el.className)));
// THE DAY CELLS THEMSELVES, by the layout class they all share - the one thing that says how many days are on screen.
// Counted rather than looked for by date, because the day view's cell states its own date in a long form the toolbar
// does not use, so a text search for another day's label finds nothing whether that day is drawn or not.
const dayCells = (scope) =>
  [...scope.querySelectorAll('div')].filter((el) => /flex flex-col gap-1/.test(String(el.className)));

{
  setViewportWidth(375);
  const rowsByMonth = { [`${THIS_YEAR}-${pad(THIS_MONTH + 1)}`]: rowsOn(MEMBERS.thisMonth, TODAY_DAY) };
  const { read, calls } = makeReader(rowsByMonth);
  const { container } = render(
    React.createElement(AdminScheduleManagementTab, boardProps({ onNeedSchedule: read }))
  );
  await flush();

  // THE MONTH IS STILL READ, AND READ ONCE - the whole claim of this shape. A narrow screen draws one day of the
  // month's rows, so it wants the month that day falls in and nothing else.
  check(
    'a phone reads the month today falls in, once',
    calls.length > 0 &&
      calls.every((c) => c.from === monthStart(THIS_YEAR, THIS_MONTH) && c.to === monthEnd(THIS_YEAR, THIS_MONTH)) &&
      calls.length <= 2,
    calls.map((c) => `${c.from}..${c.to}`).join(' | ') || 'no read at all'
  );
  check(
    'and opens on TODAY rather than on the 1st',
    text(container).includes(dayLabelFor(THIS_YEAR, THIS_MONTH, TODAY_DAY)),
    text(container).slice(0, 120)
  );
  check(
    "so today's shift is on screen",
    text(container).includes(MEMBERS.thisMonth.name),
    text(container).slice(0, 200)
  );
  // ONE day, not thirty-five - counted, because a text search cannot tell the two apart (see dayCells): the other days
  // would be drawn with their own dates in the long form, and the toolbar's short label for them is not on screen
  // either way. The seven-column weekday header goes with the calendar, since a single cell states its own weekday.
  check(
    'with exactly one day cell drawn, not thirty-five',
    dayCells(container).length === 1,
    `${dayCells(container).length} day cell(s)`
  );
  check(
    'with no seven-column header over it',
    !container.innerHTML.includes('grid-cols-7'),
    'the calendar weekday header is drawn over the day view'
  );
  check(
    'and its arrows are labelled for days',
    Boolean(container.querySelector('button[aria-label="Next day"]')) &&
      Boolean(container.querySelector('button[aria-label="Previous day"]')),
    [...container.querySelectorAll('button[aria-label]')].map((b) => b.getAttribute('aria-label')).join(', ')
  );

  // THE REGULAR INFORMATION IS ON THE PILL, which is the point of the extra room: the month view clips a pill to one
  // line and leaves the shift's window to the tooltip, and this is where it fits.
  const pills = shiftPills(container);
  check('the day draws its staffed shift as a pill', pills.length > 0, `${pills.length} pill(s)`);
  check(
    'and the pill is not clipped to one line',
    pills.every((pill) => !/truncate/.test(String(pill.className))),
    pills.map((p) => p.className).join(' || ')
  );
  check(
    "so the shift's window is on it",
    /08:00/.test(text(container)) && /18:00/.test(text(container)),
    text(container).slice(0, 240)
  );
  // ...ON ITS OWN LINE, which is the shape claim: the month view has the window in the same line as the name, and this
  // is the fact the extra height bought. Asserted structurally, because the text alone cannot tell the two apart.
  check(
    'on a line of its own, rather than appended to the name',
    /class="mt-0\.5 block text-\[11px\]/.test(container.innerHTML),
    'the window is not drawn as its own line'
  );
  // EACH FACT ONCE. An empty slot's LABEL is already the window joined to the assignment - that is `slotLabelText`, and
  // it is what the tooltips and the popover use - so handing the pill body the window as a separate fact as well drew it
  // twice, on every vacancy in both views. Nothing about the shape of the markup could see that (the second copy is in
  // the right place, in the right style, saying the right thing twice), which is why this counts instead.
  check(
    'and no pill says the shift window twice',
    boardPills(container).every((pill) => (String(pill.textContent).match(/08:00/g) || []).length <= 1),
    boardPills(container).map((pill) => pill.textContent).join(' | ')
  );
  check(
    'and the cell has the height a month cell cannot give it',
    /min-h-\[60vh\]/.test(container.innerHTML),
    'the day is drawn in a month cell'
  );

  // WALKING A DAY INSIDE THE MONTH COSTS NO READ: the day is a slice of rows already in hand, so the reader is not asked
  // again. Stepping TOWARD the middle of the month, because stepping off either end is the next case.
  const stepDelta = TODAY_DAY > 1 ? -1 : 1;
  const steppedDay = TODAY_DAY + stepDelta;
  const readsBefore = calls.length;
  await press(
    container,
    container.querySelector(`button[aria-label="${stepDelta < 0 ? 'Previous day' : 'Next day'}"]`)
  );
  check(
    'the arrows walk a day, not a month',
    text(container).includes(dayLabelFor(THIS_YEAR, THIS_MONTH, steppedDay)),
    text(container).slice(0, 120)
  );
  check(
    'and walking inside the month asks the reader for nothing',
    calls.length === readsBefore,
    `${calls.length - readsBefore} extra read(s) for a day already held`
  );

  // RESIZING. One component, one piece of state, so widening the window has to turn the SAME reading into the calendar:
  // the day is kept, the month is kept, and nothing is read to do it.
  const readsBeforeResize = calls.length;
  await act(async () => {
    setViewportWidth(1024);
  });
  await flush();
  check(
    "widening the window turns the same day into the month's calendar",
    text(container).includes(MEMBERS.thisMonth.name) && text(container).includes(monthLabel(THIS_YEAR, THIS_MONTH)),
    text(container).slice(0, 200)
  );
  check(
    'without reading anything again',
    calls.length === readsBeforeResize,
    `${calls.length - readsBeforeResize} read(s) for a resize`
  );
  // ...AND THE CALENDAR IS THE WHOLE MONTH AGAIN - the other half of the day-cell count above, so "one cell" cannot be
  // satisfied by a board that only ever draws one.
  check(
    "and the calendar draws the month's cells again",
    dayCells(container).length > 27,
    `${dayCells(container).length} day cell(s)`
  );
  check(
    'and the calendar clips its pills to the cell again',
    shiftPills(container).some((pill) => /truncate/.test(String(pill.className))),
    'the month pills are drawn in the day view shape'
  );
  check(
    'with arrows that walk months again',
    Boolean(container.querySelector('button[aria-label="Next month"]')),
    [...container.querySelectorAll('button[aria-label]')].map((b) => b.getAttribute('aria-label')).join(', ')
  );

  // ...AND BACK, which is the half that proves the two views share ONE day: the board returns to the day stepped to,
  // not to today and not to the 1st.
  await act(async () => {
    setViewportWidth(375);
  });
  await flush();
  check(
    'narrowing it again comes back to the day that was on screen',
    text(container).includes(dayLabelFor(THIS_YEAR, THIS_MONTH, steppedDay)),
    text(container).slice(0, 120)
  );

  cleanup();
  setViewportWidth(1024);
}

// ---------------------------------------------------------------------------
// 6b. A day nobody is on: the vacancy's own shape, and the facts said once
// ---------------------------------------------------------------------------
// The day view's vacancy is a third shape (see emptySlotShapeClass) and the only one whose LABEL already carries the
// shift's window - `slotLabelText` joins the window to the assignment for the tooltips and the popover. So this is the
// case that catches a pill body being handed both the label and the window: the duplication is in the right place, in
// the right style, saying the right thing twice, and nothing about the markup shape can see it.
console.log('\n--- a day with nobody on it ---');
{
  setViewportWidth(375);
  const { read } = makeReader({});
  const { container } = render(
    React.createElement(
      AdminScheduleManagementTab,
      // The assignment carries an ICON here, so "nothing personal on a vacancy" can be asserted as an exact count: the
      // slot draws its assignment's icon and nothing else. With no icon configured the count would be zero either way,
      // and the check would pass whether or not a badge or a dot had leaked onto it.
      boardProps({
        onNeedSchedule: read,
        assignments: [{ id: 'a1', description: 'Firefighter 3', icon: 'flame' }],
      })
    )
  );
  await flush();

  const vacancy = container.querySelector('div[class*="transition-colors"]');
  check('the empty day still draws the slot itself', Boolean(vacancy), 'no slot at all');
  check(
    'in the day view shape, not the calendar clipped one',
    /text-xs/.test(String(vacancy?.className)) && !/truncate/.test(String(vacancy?.className)),
    String(vacancy?.className)
  );
  check(
    'naming the shift once',
    (String(vacancy?.textContent).match(/Firefighter 3/g) || []).length === 1,
    vacancy?.textContent
  );
  check(
    'and its window once',
    (String(vacancy?.textContent).match(/08:00/g) || []).length === 1,
    vacancy?.textContent
  );
  check(
    'while carrying its assignment icon and nothing personal',
    vacancy?.querySelectorAll('svg').length === 1,
    `${vacancy?.querySelectorAll('svg').length} icon(s)`
  );

  cleanup();
  setViewportWidth(1024);
}

// ---------------------------------------------------------------------------
// 6c. The member picker as a DIALOG, and the day picker beside it
// ---------------------------------------------------------------------------
// On a phone-sized board the picker is the one thing the day view cannot fix by giving the day more room: a 300px panel
// anchored to a pill, in a card that is already the full width of the window, has nowhere to hang. So the day view opens
// the SAME picker as a dialog - same list, same two actions, one frame instead of the other - and the claims that need a
// real DOM are that the dialog is what appears, that it is the picker rather than a menu, and that the day picker beside
// it costs exactly the read an arrow walk would have.
console.log('\n--- a narrow screen: the picker is a dialog, and the calendar is one press away ---');
{
  setViewportWidth(375);
  const rowsByMonth = { [`${THIS_YEAR}-${pad(THIS_MONTH + 1)}`]: rowsOn(MEMBERS.thisMonth, TODAY_DAY) };
  // Only the reader: this case is about which FRAME the picker opens in, not about how many times the month was read.
  const { read } = makeReader(rowsByMonth);
  const { container } = render(
    React.createElement(AdminScheduleManagementTab, boardProps({ onNeedSchedule: read }))
  );
  await flush();

  // THE PILL OPENS THE DIALOG. It is the member's name in the day view; clicking it is what an officer does to fill or
  // change the shift. Found by the class every drag-source shares rather than by `draggable`, which is the board's own
  // helper (`shiftPills`) and the shape the pill is drawn in.
  const pill = shiftPills(container).find((el) => String(el.textContent).includes(MEMBERS.thisMonth.name));
  check('the day draws the shift it read', Boolean(pill), text(container).slice(0, 140));
  fireEvent.click(pill);
  await flush();

  const dialog = document.body.querySelector('[role="dialog"]');
  check('clicking a pill opens a dialog, not a menu', Boolean(dialog), 'no dialog');
  check(
    'which is named after the member whose shift it is',
    String(dialog?.getAttribute('aria-label') || '').includes(MEMBERS.thisMonth.name),
    dialog?.getAttribute('aria-label') || 'nothing'
  );
  check(
    'and offers the same members the wide-screen popover does',
    [...document.body.querySelectorAll('[role="dialog"] button')].some((b) => /Zed Quarles/.test(b.textContent || '')),
    [...document.body.querySelectorAll('[role="dialog"] button')].map((b) => b.textContent).join(' | ').slice(0, 160)
  );

  // ESCAPE LEAVES THROUGH THE DIALOG. jsdom runs no CSS, so the exit animation never ends by itself - which is what makes
  // this observable: the overlay takes the exit class and the board is still holding the picker open. Had the board's own
  // Escape handler closed it, the class would never have been applied.
  fireEvent.keyDown(window, { key: 'Escape' });
  const overlay = document.body.querySelector('.animate-overlayOut');
  check('Escape leaves through the exit animation rather than snapping shut', Boolean(overlay), 'no exit class');
  // The fallback timer in useDismissAnimation is the safety net for a browser that never fires animationend, and it is
  // also this harness's way of finishing the dismissal.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 420));
  });
  check('and the dialog does eventually close', !document.body.querySelector('[role="dialog"]'), 'the dialog stayed up');

  cleanup();
  setViewportWidth(1024);
}

// THE DAY PICKER, and the read it does or does not cost. `Next month` inside the picker walks the PICKER's month: the
// board must not move until a day is chosen.
console.log('\n--- a narrow screen: the day picker, and one press to any day ---');
{
  setViewportWidth(375);
  const rowsByMonth = { [`${THIS_YEAR}-${pad(THIS_MONTH + 1)}`]: rowsOn(MEMBERS.thisMonth, TODAY_DAY) };
  const { read, calls } = makeReader(rowsByMonth);
  const { container } = render(
    React.createElement(AdminScheduleManagementTab, boardProps({ onNeedSchedule: read }))
  );
  await flush();

  const readsBeforePicker = calls.length;
  fireEvent.click(container.querySelector('button[aria-label="Choose a day"]'));
  await flush();
  const picker = document.body.querySelector('[role="dialog"][aria-label="Choose a day"]');
  check('the toolbar offers the day picker in a day view', Boolean(picker), 'no picker');
  check(
    'and it is the calendar, drawing the month on screen',
    (picker?.querySelector('h2')?.textContent || '').includes(monthLabel(THIS_YEAR, THIS_MONTH)),
    picker?.querySelector('h2')?.textContent || 'no heading'
  );
  fireEvent.click(picker.querySelector('button[aria-label="Next month"]'));
  await flush();
  check(
    'browsing inside it moves nothing behind it',
    text(container).includes(dayLabelFor(THIS_YEAR, THIS_MONTH, TODAY_DAY)) && calls.length === readsBeforePicker,
    `${calls.length - readsBeforePicker} read(s) while browsing`
  );

  // A DAY OF ANOTHER MONTH: one press, and the month arrived at is read - the same read as walking there.
  const nextYear = THIS_MONTH === 11 ? THIS_YEAR + 1 : THIS_YEAR;
  const nextMonth = (THIS_MONTH + 1) % 12;
  const pickerDay = document.body.querySelector(`button[aria-label="${dayKey(nextYear, nextMonth, 14)}"]`);
  check('and it offers days of the month it walked to', Boolean(pickerDay), 'no day button');
  await press(container, pickerDay);
  check(
    'choosing one takes the board to that day',
    text(container).includes(dayLabelFor(nextYear, nextMonth, 14)),
    text(container).slice(0, 140)
  );
  check(
    'reading that month, once, exactly as an arrow walk would have',
    calls.length === readsBeforePicker + 1 &&
      calls[calls.length - 1].from === monthStart(nextYear, nextMonth) &&
      calls[calls.length - 1].to === monthEnd(nextYear, nextMonth),
    calls.map((c) => `${c.from}..${c.to}`).join(' | ')
  );
  check(
    'and the picker closes on the day chosen',
    !document.body.querySelector('[role="dialog"][aria-label="Choose a day"]'),
    'the picker stayed up'
  );

  // THE WIDE SCREEN KEEPS ITS POPOVER, which is the other half of the claim: the same click, on the same shift, is
  // anchored where it always was rather than becoming a dialog everywhere - and the toolbar stops offering a picker that
  // would only say what the month already says.
  //
  // Back to today first, because the board is on the 14th of the next month and this case's row is in THIS one: the
  // pill has to be on the day being drawn for the click to have anything to open.
  await press(
    container,
    [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Today')
  );
  await act(async () => {
    setViewportWidth(1024);
  });
  await flush();
  const widePill = shiftPills(container).find((el) => String(el.textContent).includes(MEMBERS.thisMonth.name));
  check('the calendar draws the same day as one of the month again', Boolean(widePill), text(container).slice(0, 140));
  let anchorRect = { left: 980, right: 1012, top: 720, bottom: 744, width: 32, height: 24 };
  Object.defineProperty(widePill, 'getBoundingClientRect', { configurable: true, value: () => anchorRect });
  fireEvent.click(widePill);
  await flush();
  let positionedPopover = document.body.querySelector('.animate-popoverIn');
  const desktopLeft = Number.parseFloat(positionedPopover?.style.left || 'NaN');
  const desktopTop = Number.parseFloat(positionedPopover?.style.top || 'NaN');
  const desktopWidth = Number.parseFloat(positionedPopover?.style.width || 'NaN');
  const desktopHeight = Number.parseFloat(positionedPopover?.style.maxHeight || 'NaN');
  check(
    'a bottom-right assignment popover fits the desktop viewport',
    desktopLeft >= 0 && desktopTop >= 0 && desktopLeft + desktopWidth <= window.innerWidth && desktopTop + desktopHeight <= window.innerHeight,
    positionedPopover?.getAttribute('style') || 'no positioned popover'
  );
  check(
    'and widening the window puts the picker back on the pill it belongs to',
    !document.body.querySelector('[role="dialog"]') && Boolean(document.body.querySelector('.animate-popoverIn')),
    'the calendar lost its popovers'
  );
  check(
    'with the toolbar offering no day picker, because every day is on screen',
    !container.querySelector('button[aria-label="Choose a day"]'),
    'a picker over a month view says what the month already says'
  );

  anchorRect = { left: 980, right: 1012, top: 200, bottom: 220, width: 32, height: 20 };
  window.innerHeight = 240;
  await act(async () => window.dispatchEvent(new Event('resize')));
  await flush();
  positionedPopover = document.body.querySelector('.animate-popoverIn');
  const shortLeft = Number.parseFloat(positionedPopover?.style.left || 'NaN');
  const shortTop = Number.parseFloat(positionedPopover?.style.top || 'NaN');
  const shortWidth = Number.parseFloat(positionedPopover?.style.width || 'NaN');
  const shortHeight = Number.parseFloat(positionedPopover?.style.maxHeight || 'NaN');
  check(
    'the open assignment popover repositions after the viewport shrinks',
    shortLeft >= 0 && shortTop >= 0 && shortLeft + shortWidth <= window.innerWidth && shortTop + shortHeight <= window.innerHeight,
    positionedPopover?.getAttribute('style') || 'no positioned popover'
  );
  fireEvent.click(document.body.querySelector('div.fixed.inset-0.z-40'));
  await flush();

  window.innerHeight = 768;
  await act(async () => window.dispatchEvent(new Event('resize')));
  const quickAddButton = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('Quick Add'));
  Object.defineProperty(quickAddButton, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 980, right: 1012, top: 720, bottom: 744, width: 32, height: 24 }),
  });
  fireEvent.click(quickAddButton);
  await flush();
  const quickAddMenu = [...document.body.querySelectorAll('div.fixed')].find((element) =>
    element.textContent.includes('Pick a member, then click any empty slot')
  );
  const quickLeft = Number.parseFloat(quickAddMenu?.style.left || 'NaN');
  const quickTop = Number.parseFloat(quickAddMenu?.style.top || 'NaN');
  const quickWidth = Number.parseFloat(quickAddMenu?.style.width || 'NaN');
  const quickHeight = Number.parseFloat(quickAddMenu?.style.maxHeight || 'NaN');
  check(
    'Quick Add is portaled and fits the viewport at the bottom-right edge',
    Boolean(quickAddMenu) && quickLeft >= 0 && quickTop >= 0 && quickLeft + quickWidth <= window.innerWidth && quickTop + quickHeight <= window.innerHeight,
    quickAddMenu?.getAttribute('style') || 'no Quick Add menu'
  );
  fireEvent.mouseDown(quickAddMenu);
  check('interacting inside the portaled Quick Add menu keeps it open', Boolean(
    [...document.body.querySelectorAll('div.fixed')].find((element) =>
      element.textContent.includes('Pick a member, then click any empty slot')
    )
  ));
  fireEvent.mouseDown(document.body);
  check('clicking outside the portaled Quick Add menu closes it', ![...document.body.querySelectorAll('div.fixed')].some((element) =>
    element.textContent.includes('Pick a member, then click any empty slot')
  ));

  cleanup();
  window.innerHeight = 768;
  setViewportWidth(1024);
}

// ---------------------------------------------------------------------------
// 7. Walking off the end of the month, and the util behind all of it
// ---------------------------------------------------------------------------
console.log('\n--- walking off the end of the month ---');
{
  setViewportWidth(375);
  const nextYear = THIS_MONTH === 11 ? THIS_YEAR + 1 : THIS_YEAR;
  const nextMonth = (THIS_MONTH + 1) % 12;
  const rowsByMonth = {
    [`${THIS_YEAR}-${pad(THIS_MONTH + 1)}`]: rowsOn(MEMBERS.thisMonth, TODAY_DAY),
    [`${nextYear}-${pad(nextMonth + 1)}`]: rowsOn(MEMBERS.nextMonth, 1, nextYear, nextMonth),
  };
  const { read, calls } = makeReader(rowsByMonth);
  const { container } = render(
    React.createElement(AdminScheduleManagementTab, boardProps({ onNeedSchedule: read }))
  );
  await flush();

  // Every press from today to the last day of the month, then one more to leave it. The board has no special case for
  // the wrap - `Date` normalizes the day overflow - so this is what proves the boundary is the calendar's rather than a
  // second implementation of one.
  const presses = LAST_DAY - TODAY_DAY + 1;
  for (let i = 0; i < presses; i++) {
    await press(container, container.querySelector('button[aria-label="Next day"]'));
  }

  check(
    'walking past the last day of the month reads the month it walked into',
    calls.length > 1 &&
      calls[calls.length - 1].from === monthStart(nextYear, nextMonth) &&
      calls[calls.length - 1].to === monthEnd(nextYear, nextMonth),
    calls.map((c) => `${c.from}..${c.to}`).join(' | ')
  );
  check(
    'and lands on the 1st of it',
    text(container).includes(dayLabelFor(nextYear, nextMonth, 1)),
    text(container).slice(0, 140)
  );
  check(
    "and draws that month's day, naming its member",
    text(container).includes(MEMBERS.nextMonth.name),
    text(container).slice(0, 200)
  );
  // ONE month at a time, whatever unit the board is showing: the rows of the month walked out of are not on the board.
  check(
    'and no longer draws the month it walked out of',
    !text(container).includes(MEMBERS.thisMonth.name),
    'both months are on the board at once'
  );
  check(
    'having read the new month a bounded number of times',
    calls.length <= 3,
    `${calls.length} reads across one month boundary`
  );

  cleanup();
  setViewportWidth(1024);
}

console.log('\n--- the viewport question, and who is listening ---');
{
  const { DESKTOP_MEDIA_QUERY, desktopViewport: isDesktopNow, subscribeViewport } = await import(
    '../src/utils/viewport.js'
  );

  setViewportWidth(500);
  check('below the breakpoint is not the desktop shape', isDesktopNow() === false, String(isDesktopNow()));
  setViewportWidth(1024);
  check('at or above it is', isDesktopNow() === true, String(isDesktopNow()));

  // THE SUBSCRIPTION, which is what makes a resize redraw anything at all: a store whose value changes and wakes nobody
  // leaves the screen in the shape it was born with. Counted rather than described - one call per CROSSING and none for
  // a resize that stays on the same side, which is what a media query does and what stops dragging a window edge from
  // re-rendering the board on every pixel.
  let woken = 0;
  const unsubscribe = subscribeViewport(() => {
    woken++;
  });
  setViewportWidth(900);
  check('a resize on the same side of the breakpoint wakes nobody', woken === 0, `${woken} wake-up(s)`);
  setViewportWidth(400);
  check('crossing it wakes the subscriber once', woken === 1, `${woken} wake-up(s)`);
  setViewportWidth(1200);
  check('and crossing back wakes it once more', woken === 2, `${woken} wake-up(s)`);
  unsubscribe();
  setViewportWidth(400);
  check('while an unsubscribed listener is not woken again', woken === 2, `${woken} wake-up(s)`);
  setViewportWidth(1024);


console.log('\n--- popovers stay inside the viewport ---');
for (const { label, width, height, anchor } of [
  {
    label: 'bottom-right trigger on a standard desktop',
    width: 1280,
    height: 720,
    anchor: { left: 1230, top: 680, bottom: 704 },
  },
  {
    label: 'bottom-right trigger on a short viewport',
    width: 320,
    height: 240,
    anchor: { left: 285, top: 212, bottom: 232 },
  },
  {
    label: 'tiny viewport narrower than the default panel',
    width: 200,
    height: 150,
    anchor: { left: 180, top: 130, bottom: 146 },
  },
]) {
  const position = viewportPopoverPosition({
    anchor,
    viewportWidth: width,
    viewportHeight: height,
  });
  check(
    `${label}: width and horizontal position fit`,
    position.width <= width && position.left >= 0 && position.left + position.width <= width,
    JSON.stringify(position)
  );
  check(
    `${label}: height and vertical position fit`,
    position.maxHeight <= height && position.top >= 0 && position.top + position.maxHeight <= height,
    JSON.stringify(position)
  );
}
  // THE THRESHOLD IS THE SHELL'S, which is why the module holds it rather than each screen writing its own number: the
  // sidebar is a drawer below `md` and a column at `md`, so a board that switched at a different width would rearrange
  // out of step with the layout around it.
  const { readFileSync } = await import('node:fs');
  const sidebar = readFileSync('src/components/Sidebar.jsx', 'utf8');
  check(
    'the breakpoint is the md the sidebar switches at',
    DESKTOP_MEDIA_QUERY === '(min-width: 768px)' && /fixed md:static/.test(sidebar),
    `${DESKTOP_MEDIA_QUERY} against the sidebar's md`
  );
  // The board must ask the SHARED module for its shape rather than carrying a number of its own. Matched on the imported
  // NAMES and not on the text of the import statement, because a reformatted import is not a behaviour change and a check
  // that fails on one sends the next person to "fix" a line that was never wrong.
  const boardSource = readFileSync('src/components/admin/AdminScheduleManagementTab.jsx', 'utf8');
  const viewportImports = boardSource.match(/import \{([^}]*)\} from '\.\.\/\.\.\/utils\/viewport'/s);
  const viewportNames = viewportImports ? viewportImports[1] : '';
  check(
    'and the board asks it through the shared module rather than a number of its own',
    ['desktopViewport', 'subscribeViewport'].every((name) => viewportNames.includes(name)),
    `the board imports ${viewportNames.replace(/\s+/g, ' ').trim()} from utils/viewport`
  );

  // ...AND IT ASKS FOR ALL THREE SHAPES, not the two it used to. The middle band - narrower than the sidebar's 768px and
  // wider than a phone's 640px - is the whole feature, and it is invisible to a check that only proves the desktop and
  // phone answers are imported: a board that asked `dayViewSpan` with `isPhone` hard-coded false would pass the line above.
  check(
    'and it asks for the phone answer too, which is what makes the two-day band exist',
    ['phoneViewport', 'subscribePhoneViewport'].every((name) => viewportNames.includes(name)) &&
      /dayViewSpan\(\{ isDesktop, isPhone \}\)/.test(boardSource),
    'the board imports no phone query, or never passes isPhone to dayViewSpan'
  );
  // ...AND THE MEMBER'S CALENDAR USES THE SAME ONE, which is the only reason "the same narrow-view logic in both places"
  // is a fact rather than two implementations that happen to agree today.
  check(
    'and the member calendar asks the same shared rule rather than repeating the bands',
    /dayViewSpan\(\{ isDesktop, isPhone \}\)/.test(readFileSync('src/components/ScheduleCalendar.jsx', 'utf8')),
    'the two calendars no longer share dayViewSpan'
  );
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
