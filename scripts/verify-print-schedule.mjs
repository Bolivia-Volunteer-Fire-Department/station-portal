/**
 * Verifies the printable schedule (utils/printSchedule, PrintableSchedule, print.css).
 *
 * Printing is hard to eyeball, so the data is built by pure functions and tested here - the grid, which
 * day a shift lands on, whose shifts are listed, and what each line says. What cannot be checked without
 * a printer is the ink, so the CSS is asserted for the rules that make the sheet printable at all: the
 * app is hidden, the sheet is shown, and colours are kept.
 *
 * The trap this guards: a sheet that includes the app around it, or one that is hidden because the rule
 * hides its ancestor. Both produce a blank page, and neither is obvious from the code.
 *
 * Run with: npm run verify:print-schedule
 */
import { readFileSync } from 'node:fs';
import {
  PRINT_WEEKDAYS,
  printHeader,
  printLinesForDate,
  printMonth,
  printMonthGrid,
  printShiftCount,
} from '../src/utils/printSchedule.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${
      ok ? '' : ` (expected ${JSON.stringify(expected)})`
    }`
  );
};

const assignments = [
  { id: '1', description: 'Engine 1' },
  { id: '2', description: 'Officer' },
];
const templates = [
  { id: 't1', day_of_week: 'monday', start_time: '08:00', end_time: '18:00', assignment_id: '1', effective_date: '2020-01-01' },
  { id: 't2', day_of_week: 'tuesday', start_time: '08:00', end_time: '18:00', assignment_id: '2', nickname: 'Day Shift', effective_date: '2020-01-01' },
];
const users = [
  { id: '10', name: 'Member 1' },
  { id: '11', name: 'Member 3' },
];

// 2026-03-02 is a Monday, 2026-03-03 a Tuesday.
const MONDAY = '2026-03-02';
const TUESDAY = '2026-03-03';

console.log('--- the month grid ---');
const march = printMonthGrid(2026, 2);
check('March 2026 starts on a Sunday', new Date(2026, 2, 1).getDay(), 0);
check('so the grid leads with six blank cells', march[0].filter((c) => c.outside).length, 6);
// A Sunday start lands the 1st in the LAST column of a Monday-first week, not the second.
check('and the 1st sits in the Sunday column', march[0][6].dayOfMonth, 1);
check('every week has seven cells', march.every((week) => week.length === 7), true);
check('no day is missing', march.flat().filter((c) => !c.outside).length, 31);
check('the 31st is the last day', march.flat().filter((c) => !c.outside).pop().dayOfMonth, 31);
check('the weekday headings run Monday first', PRINT_WEEKDAYS[0], 'Mon');
// A month starting on a Monday needs no lead-in at all.
check('June 2026 starts on a Monday and needs no lead', printMonthGrid(2026, 5)[0][0].dayOfMonth, 1);
check('and its first cell is not blank', printMonthGrid(2026, 5)[0][0].outside, false);
check('every day sits in its own weekday column', march.flat().filter((c) => !c.outside).every((c) => c.weekdayIndex === (new Date(c.dateKey + 'T12:00:00').getDay() + 6) % 7), true);
check('February 2026 has 28 days', printMonthGrid(2026, 1).flat().filter((c) => !c.outside).length, 28);
check('a leap February has 29', printMonthGrid(2028, 1).flat().filter((c) => !c.outside).length, 29);

console.log('\n--- whose shifts are listed ---');
const schedule = [
  { id: 's1', user_id: '10', schedule_template_id: 't1', assignment_id: '1', date_from: MONDAY, date_to: MONDAY },
  { id: 's2', user_id: '11', schedule_template_id: 't2', assignment_id: '2', date_from: TUESDAY, date_to: TUESDAY },
  { id: 's3', user_id: '', schedule_template_id: 't2', assignment_id: '2', date_from: TUESDAY, date_to: TUESDAY },
];

const memberLines = printLinesForDate({
  dateKey: MONDAY,
  mode: 'member',
  member: { id: '10' },
  schedule,
  scheduleTemplates: templates,
  assignments,
  users,
});
check('a member sees their own shift', memberLines.length, 1);
check('labelled with the time and assignment', memberLines[0].text, '8:00 AM – 6:00 PM · Engine 1');
check('and no member name, since it is their own sheet', /Member 1/.test(memberLines[0].text), false);
check('with the automatic assignment colour', typeof memberLines[0].color === 'string' && /^#[0-9a-f]{6}$/.test(memberLines[0].color), true);

check(
  "another member's shift is not on their sheet",
  printLinesForDate({ dateKey: TUESDAY, mode: 'member', member: { id: '10' }, schedule, scheduleTemplates: templates, assignments, users }).length,
  0
);

const adminLines = printLinesForDate({
  dateKey: TUESDAY,
  mode: 'admin',
  schedule,
  scheduleTemplates: templates,
  assignments,
  users,
});
check('an administrator sees the filled shift', adminLines.some((l) => /Member 3/.test(l.text)), true);
// The filled line and the Open line share a start time, so the tiebreak is alphabetical - "Open" sorts
// before "Member 3". What matters is that the filled line NAMES the member, which is asserted separately.
check('and names the member on their line', adminLines.some((l) => l.text.startsWith('Member 3')), true);
check('a nickname replaces the times', adminLines[0].text.includes('Day Shift'), true);
check('an unfilled row prints as Open', adminLines.some((l) => l.text.startsWith('Open')), true);
check(
  'and an Open line never names a member',
  // Member names in this fixture are the "Member N" placeholders, so an Open line containing one would be a bug.
  adminLines.filter((l) => l.text.startsWith('Open')).every((l) => !/Member \d/.test(l.text)),
  true
);

console.log('\n--- the rules the printed sheet inherits ---');
// A vacancy with no row at all: the template runs but nobody is scheduled.
const uncovered = printLinesForDate({
  dateKey: MONDAY,
  mode: 'admin',
  schedule: [],
  scheduleTemplates: templates,
  assignments,
  users,
});
check('a template with no row prints as Open', uncovered.length, 1);
check('labelled Open with the window', uncovered[0].text, 'Open · 8:00 AM – 6:00 PM · Engine 1');
// A member's own sheet lists only real assignments, so a vacancy is not on it.
check(
  'but a member sheet does not invent vacancies',
  printLinesForDate({ dateKey: MONDAY, mode: 'member', member: { id: '10' }, schedule: [], scheduleTemplates: templates, assignments, users }).length,
  0
);

// A retired template must not print, exactly as it does not draw.
check(
  'a retired template prints nothing',
  printLinesForDate({ dateKey: MONDAY, mode: 'admin', schedule: [], scheduleTemplates: [{ ...templates[0], end_date: '2021-01-01' }], assignments, users }).length,
  0
);

// A retired assignment stops its templates printing too.
check(
  'a retired assignment prints nothing',
  printLinesForDate({ dateKey: MONDAY, mode: 'admin', schedule: [], scheduleTemplates: templates, assignments: [{ id: '1', description: 'Engine 1', end_date: '2021-01-01' }, assignments[1]], users }).length,
  0
);

// An overnight shift belongs to the day it starts, so a printed month does not show it twice.
const overnight = [
  { id: 'o1', user_id: '10', schedule_template_id: '', assignment_id: '1', date_from: '2026-03-06', date_to: '2026-03-07' },
];
const overnightArgs = { mode: 'member', member: { id: '10' }, schedule: overnight, scheduleTemplates: [], assignments: [], users: [] };
check('an overnight shift prints on its start day', printLinesForDate({ ...overnightArgs, dateKey: '2026-03-06' }).length, 1);
check('and not on the day it runs into', printLinesForDate({ ...overnightArgs, dateKey: '2026-03-07' }).length, 0);

// A row with no readable date must not be pinned to the first of the month.
check(
  'an undated row prints nowhere',
  printLinesForDate({ dateKey: MONDAY, mode: 'member', member: { id: '10' }, schedule: [{ id: 'x', user_id: '10', date_from: 'nonsense' }], scheduleTemplates: [], assignments: [], users }).length,
  0
);

console.log('\n--- ordering ---');
const mixedTimes = [
  { id: 'late', user_id: '10', schedule_template_id: '', assignment_id: '1', date_from: MONDAY, date_to: MONDAY, start_time: '20:00', end_time: '23:00' },
  { id: 'bad', user_id: '10', schedule_template_id: '', assignment_id: '2', date_from: MONDAY, date_to: MONDAY, start_time: 'nonsense', end_time: '' },
  { id: 'early', user_id: '10', schedule_template_id: '', assignment_id: '1', date_from: MONDAY, date_to: MONDAY, start_time: '06:00', end_time: '08:00' },
];
const ordered = printLinesForDate({ dateKey: MONDAY, mode: 'member', member: { id: '10' }, schedule: mixedTimes, scheduleTemplates: [], assignments, users });
check('earliest first', ordered[0].text.startsWith('6:00 AM'), true);
check('then the later one', ordered[1].text.startsWith('8:00 PM'), true);
check('and the unreadable time sorts last', ordered[2].text.includes('Officer'), true);

console.log('\n--- the header and the whole month ---');
const memberHeader = printHeader({ mode: 'member', departmentName: 'Bolivia Fire Department', memberName: 'Member 1', year: 2026, month: 2, generatedAt: new Date(2026, 2, 15) });
check('the department name', memberHeader.departmentName, 'Bolivia Fire Department');
check('the title', memberHeader.title, 'My Schedule');
check('the subtitle names the member and the month', memberHeader.subtitle, 'March 2026 · Member 1');
check('and the printed date is a date, not a time', memberHeader.generated, 'Printed 2026-03-15');
check('a missing department falls back rather than blanking', printHeader({ year: 2026, month: 2 }).departmentName, 'Fire Department');

const adminHeader = printHeader({ mode: 'admin', departmentName: 'BFD', year: 2026, month: 2 });
check('the administrator title differs', adminHeader.title, 'Shift Schedule');
check('and its subtitle says all members', adminHeader.subtitle, 'March 2026 · All members');

const marchWeeks = printMonth({ year: 2026, month: 2, mode: 'member', member: { id: '10' }, schedule, scheduleTemplates: templates, assignments, users });
check('the month is whole weeks', marchWeeks.every((week) => week.length === 7), true);
check('and every day carries a lines array', marchWeeks.flat().every((cell) => Array.isArray(cell.lines)), true);
check('the member has one shift that month', printShiftCount(marchWeeks), 1);
check('and it lands on the 2nd', marchWeeks.flat().find((c) => c.dayOfMonth === 2).lines.length, 1);
check('no other day has one', marchWeeks.flat().filter((c) => !c.outside && c.dayOfMonth !== 2).every((c) => c.lines.length === 0), true);
check('a blank cell holds no lines', marchWeeks.flat().filter((c) => c.outside).every((c) => c.lines.length === 0), true);

const adminWeeks = printMonth({ year: 2026, month: 2, mode: 'admin', schedule, scheduleTemplates: templates, assignments, users });
check('the administrator sheet covers more shifts', printShiftCount(adminWeeks) > printShiftCount(marchWeeks), true);

console.log('\n--- the stylesheet, and the one thing that would blank the page ---');
const css = readFileSync('src/print.css', 'utf8');
check('the sheet is hidden on screen', /\.print-sheet\s*\{\s*display:\s*none/.test(css), true);
check('and shown on paper', /\.print-sheet\s*\{\s*display:\s*block\s*!important/.test(css), true);
// Hiding is done from <body>, not from #root: the sheet is portalled into <body>, so a #root-level rule
// would hide the sheet's own ancestor and print a blank page. Matched as a SELECTOR, because the
// stylesheet's own comment mentions #root and a bare /#root/ would match the prose.
check('the app is hidden by a body-level rule', /body\s*>\s*\*:not\(\.print-sheet\)\s*\{\s*display:\s*none\s*!important/.test(css), true);
check('not by a #root rule', /#root\s*[>{]/.test(css), false);
check('assignment colours are preserved', /print-color-adjust:\s*exact/.test(css), true);
check('a page size is declared', /@page\s*\{[\s\S]{0,80}size:\s*letter portrait/.test(css), true);
check('a week is not split across pages', /\.print-week\s*\{\s*break-inside:\s*avoid/.test(css), true);

console.log('\n--- the sheet, the buttons and the logo ---');
const sheetSource = readFileSync('src/components/PrintableSchedule.jsx', 'utf8');
// Matched as two facts rather than one windowed regex: the portal's JSX body runs to several thousand
// characters before its `document.body` argument, so any character budget would be arbitrary.
check('the sheet is portalled out of the app tree', /return createPortal\(/.test(sheetSource), true);
check('into <body>', /document\.body\s*\)/.test(sheetSource), true);

// The props contract. Every prop the body uses must be destructured: a missing one is a ReferenceError at
// RENDER, not at build, so neither the build nor a source-pattern check catches it on its own. This was a
// real shipped bug - `year` and `month` were dropped while rearranging this list, and the sheet crashed
// every time anyone pressed Print.
const propsBlock = /export default function PrintableSchedule\(\{([\s\S]*?)\n\}\) \{/.exec(sheetSource)?.[1] || '';
check('the props block was found', propsBlock.length > 0, true);
for (const prop of ['mode', 'departmentName', 'year', 'month', 'member', 'schedule', 'scheduleTemplates', 'assignments', 'users', 'ranks', 'memberName', 'onDone']) {
  check(`the sheet destructures ${prop}`, new RegExp(`(^|[\\s,{])${prop}(\\s*=|\\s*[,}])`).test(propsBlock), true);
}
check('it prints itself', /window\.print\(\)/.test(sheetSource), true);
check('and reports back when the browser is done', /addEventListener\('afterprint'/.test(sheetSource), true);
check('with a safety net so a failed print cannot hide the app', /setTimeout\(finish, 30000\)/.test(sheetSource), true);
check('it shows the station logo in the header', /stationLogoUrl\(\)/.test(sheetSource), true);
check('and says so when the month is empty', /No shifts are scheduled/.test(sheetSource), true);

const calendar = readFileSync('src/components/ScheduleCalendar.jsx', 'utf8');
check('My Schedule offers a print button', /onClick=\{\(\) => setPrintOpen\(true\)\}/.test(calendar), true);
// The printed mode FOLLOWS the Show everyone toggle, so the sheet matches what is on screen.
check('the sheet mode follows Show everyone', /mode=\{showEveryone \? 'crew' : 'member'\}/.test(calendar), true);
check('printing the month on screen', /year=\{viewDate\.getFullYear\(\)\}/.test(calendar), true);
check('with the member on the header', /memberName=\{currentUser\?\.name/.test(calendar), true);
check('and the ranks needed to judge a vacancy', /ranks=\{ranks\}/.test(calendar), true);

const board = readFileSync('src/components/admin/AdminScheduleManagementTab.jsx', 'utf8');
check('the board offers a print button', /onClick=\{\(\) => setPrintOpen\(true\)\}/.test(board), true);
check('and mounts the sheet in admin mode', /mode="admin"/.test(board), true);
// The printed sheet must be the SAVED schedule, not the in-memory draft, or a printout could claim to be
// the record while differing from it.
check('printing the SAVED schedule rather than the draft', /mode="admin"[\s\S]{0,400}schedule=\{schedule\}/.test(board), true);
check('and saying so when there are unsaved changes', /Unsaved changes are not included/.test(board), true);

console.log('\n--- the station logo is reachable from a subdirectory ---');
const login = readFileSync('src/components/LoginScreen.jsx', 'utf8');
const sidebar = readFileSync('src/components/Sidebar.jsx', 'utf8');
const app = readFileSync('src/App.jsx', 'utf8');
const assets = readFileSync('src/utils/assets.js', 'utf8');
// A literal "/logo.svg" resolves to the domain root and 404s when the app is served from a subdirectory,
// which is exactly how it is deployed to GitHub Pages.
check('the login screen builds the logo URL from the base path', /stationLogoUrl\(\)/.test(login), true);
check('and the sidebar', /stationLogoUrl\(\)/.test(sidebar), true);
check('and the mobile header', /stationLogoUrl\(\)/.test(app), true);
check('no component hardcodes the logo path', /src="\/Bolivia/.test(login + sidebar + app), false);
check('the helper encodes the filename', /encodeURI\(/.test(assets), true);
check('and uses the configured base', /import\.meta\.env\.BASE_URL/.test(assets), true);

console.log('\n--- crew mode: everyone\'s shifts, and vacancies the member could take ---');
// A member may fill their own rank and below. Engine 1 needs order 1, the Officer shift needs order 3.
const ranks = [
  { id: 'r1', description: 'Firefighter', rank_order: 1 },
  { id: 'r3', description: 'Captain', rank_order: 3 },
];
const crewMember = { id: '10', rank_id: 'r1' };
const senior = { id: '1', description: 'Engine 1', rank_order_required: '1' };
const seniorOnly = { id: '2', description: 'Officer', rank_order_required: '3' };

// Past vacancies are worth nothing to a member, so the sheet is judged against a fixed "today".
const TODAY = '2026-03-01';
const crewArgs = { mode: 'crew', member: crewMember, ranks, todayKey: TODAY };

check(
  'every member is named',
  printLinesForDate({
    ...crewArgs,
    dateKey: TUESDAY,
    schedule,
    scheduleTemplates: templates,
    assignments: [senior, seniorOnly],
    users,
  }).some((l) => l.text.startsWith('Member 3')),
  true
);

// A template occurrence with nobody on it, on a fillable assignment, inside the month.
const vacancyArgs = {
  ...crewArgs,
  schedule: [],
  scheduleTemplates: [{ id: 't3', day_of_week: 'monday', start_time: '08:00', end_time: '18:00', assignment_id: '1', effective_date: '2020-01-01' }],
  assignments: [senior, seniorOnly],
  users,
};
check(
  'a vacancy the member could fill is offered',
  printLinesForDate({ ...vacancyArgs, dateKey: MONDAY }).length,
  1
);

// The same vacancy on an assignment above their rank must not be: the calendar hides it, so the sheet does.
check(
  'a vacancy above their rank is not offered',
  printLinesForDate({
    ...vacancyArgs,
    dateKey: MONDAY,
    scheduleTemplates: [{ id: 't3', day_of_week: 'monday', start_time: '08:00', end_time: '18:00', assignment_id: '2', effective_date: '2020-01-01' }],
  }).length,
  0
);

// A vacancy that has already passed is not something anyone can pick up.
const pastVacancy = { ...vacancyArgs, scheduleTemplates: [{ ...vacancyArgs.scheduleTemplates[0], day_of_week: 'sunday' }] };
check('a past vacancy is not offered', printLinesForDate({ ...pastVacancy, dateKey: '2026-02-22' }).length, 0);

// ...but a FILLED shift in the past still prints: the sheet is a record of the month.
check(
  'a past filled shift still prints for the crew',
  printLinesForDate({ ...crewArgs, dateKey: MONDAY, schedule, scheduleTemplates: templates, assignments: [senior, seniorOnly], users }).length,
  1
);

// Administrator mode is unchanged: every vacancy, whatever the rank and whenever it is.
const adminVacancies = {
  mode: 'admin',
  schedule: [],
  dateKey: '2026-02-22',
  scheduleTemplates: [{ id: 't9', day_of_week: 'sunday', start_time: '08:00', end_time: '18:00', assignment_id: '2', effective_date: '2020-01-01' }],
  assignments: [senior, seniorOnly],
  users,
};
check('an administrator sees a past vacancy', printLinesForDate(adminVacancies).length, 1);
check('and one above any rank they hold', printLinesForDate(adminVacancies)[0].text.startsWith('Open'), true);
check('with no ranks needed', printLinesForDate({ ...adminVacancies, ranks: [] }).length, 1);

// The member's own sheet lists a vacancy they could fill - the calendar shows it, so the sheet does too.
// todayKey is pinned here too, or the fixture's March date would be in the past relative to the real clock
// and the vacancy would be filtered out for the wrong reason.
const ownVacancy = {
  mode: 'member',
  member: crewMember,
  ranks,
  todayKey: TODAY,
  schedule: [],
  scheduleTemplates: vacancyArgs.scheduleTemplates,
  assignments: [senior, seniorOnly],
  users: [],
  dateKey: MONDAY,
};
check('a member sheet offers a vacancy they could fill', printLinesForDate(ownVacancy).length, 1);
check('a member sheet hides one above their rank', printLinesForDate({ ...ownVacancy, scheduleTemplates: [{ ...vacancyArgs.scheduleTemplates[0], assignment_id: '2' }] }).length, 0);

// The mode changes the title, since a crew sheet is not "My Schedule".
check('the crew sheet is titled as a shift schedule', printHeader({ mode: 'crew', year: 2026, month: 2 }).title, 'Shift Schedule');
check('and says whose shifts it lists', printHeader({ mode: 'crew', year: 2026, month: 2 }).subtitle, 'March 2026 · All members');
check('saying who printed it', printHeader({ mode: 'crew', memberName: 'Member 1', year: 2026, month: 2 }).printedBy, 'Member 1');
check('and the member sheet does not claim the crew', printHeader({ mode: 'member', memberName: 'Member 1', year: 2026, month: 2 }).title, 'My Schedule');
check('nor name a printer', printHeader({ mode: 'member', memberName: 'Member 1', year: 2026, month: 2 }).printedBy, '');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
