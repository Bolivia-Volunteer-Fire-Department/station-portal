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
import './dom-env.mjs';
import React from 'react';
import { render, fireEvent, act, cleanup } from '@testing-library/react';
import AdminScheduleManagementTab from '../src/components/admin/AdminScheduleManagementTab.jsx';

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
  fireEvent.click(nextButton);
  await flush();

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
  fireEvent.click(nextButton);
  await flush();
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

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
