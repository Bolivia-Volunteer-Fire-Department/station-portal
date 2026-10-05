/**
 * Verifies the month grid and the day picker built on it.
 *
 *   npm run verify:month-picker
 *
 * WHAT THIS EXISTS FOR: a day view steps one day at a time, so a day that is not today is reached by pressing an arrow
 * until it arrives - "the 14th of next month" was fourteen presses and a month boundary. Both schedules now have a
 * calendar button in the day view that opens the month in a modal, and pressing a day goes there. This is the harness for
 * that, and it holds three things that are easy to get quietly wrong:
 *
 *   1. THE GRID GEOMETRY. The 1st has to sit under its own weekday, the month has to be padded to whole weeks, and
 *      February has to know whether it is a leap year. All three calendars - both schedules and the picker - drew or
 *      would have drawn this for themselves, so it lives in ONE builder (utils/calendarConstants) and this is the proof
 *      it answers correctly, including for a month that starts on a Sunday and a month that needs six rows.
 *   2. ONE BUILDER, THREE CALLERS. A second inline copy is how the picker's month and the calendar behind it would come
 *      to disagree about which weekday the 1st is - so the two calendars are asserted to have no inline `firstWeekday`
 *      left, and the picker to use the shared one.
 *   3. THE PICKER IS ONLY A CALENDAR. "Nothing other than a month calendar on it" is the spec, not a detail: it imports
 *      no schedule data and draws no pills, so it cannot become a second board somebody tries to manage the schedule
 *      from. The button that opens it is offered in a DAY view and nowhere else - a picker over a month view would be a
 *      second grid saying what the one behind it already says.
 *
 * The BEHAVIOUR - that a day chosen moves the view, that a day in another month reads that month, and that a narrow
 * screen's member picker is a dialog - needs a real DOM and lives in the two runtime harnesses
 * (verify-member-schedule-runtime, verify-admin-schedule-runtime), which are the only places an effect runs.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MONTH_VIEW, monthGridCells, dayViewSpan, spanDayDates } from '../src/utils/calendarConstants.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`
  );
};
const checkIs = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` -> ${detail}`}`);
};

const source = (file) => readFileSync(path.resolve(process.cwd(), file), 'utf8');
const key = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

console.log('\n--- the month as a grid ---');
// March 2026 starts on a Sunday and needs five rows: the simplest case, and the one that says the leading blank count is
// the 1st's weekday rather than anything else.
const march = monthGridCells(2026, 2);
check('the grid is whole weeks', march.length % 7, 0);
check('March 2026 opens with no blank at all, because the 1st is a Sunday', march[0] && key(march[0]), '2026-03-01');
check('and holds every day of the month', march.filter(Boolean).length, 31);
check('ending on the 31st', key(march[30]), '2026-03-31');

// A month starting mid-week, which is where an off-by-one in the leading blanks shows up: October 2026 begins on a
// Thursday, so four cells are empty before the 1st and the 1st must land in column 5.
const october = monthGridCells(2026, 9);
check('October 2026 leads with four blanks', october.slice(0, 4), [null, null, null, null]);
check('putting the 1st under Thursday', key(october[4]), '2026-10-01');
check('and the 1st is a Thursday', new Date(2026, 9, 1).getDay(), 4);
check('with the month padded out to whole weeks', october.length % 7, 0);

// FEBRUARY, in both kinds of year, because the day count is the arithmetic that cannot be eyeballed: 28 or 29 is the
// difference between a leap year and a grid that silently loses a day (or invents one).
check('February 2026 is 28 days', monthGridCells(2026, 1).filter(Boolean).length, 28);
check('and February 2028 is 29', monthGridCells(2028, 1).filter(Boolean).length, 29);
check(
  'with the 29th present as the last day of that month',
  [key(monthGridCells(2028, 1).filter(Boolean)[28]), key(monthGridCells(2026, 1).filter(Boolean)[27])],
  ['2028-02-29', '2026-02-28']
);

// A SIX-ROW MONTH, which is what makes the padding loop observable: August 2026 runs 1st (Saturday) to 31st (Monday) and
// needs six weeks, so the grid is 42 cells rather than 35. A picker that assumed five rows would drop the last days.
const august = monthGridCells(2026, 7);
check('a month that needs six weeks gets six', august.length, 42);
check('with the 31st still on the grid', august.filter(Boolean).some((d) => key(d) === '2026-08-31'), true);

// December, so the year boundary is walked at least once, and the last cell is a day rather than a blank when the month
// ends the week.
check('December 2026 ends the year on the 31st', key(monthGridCells(2026, 11).filter(Boolean).at(-1)), '2026-12-31');

// The cells are REAL DATES at midnight local, which is what lets a caller compare them and format them - and never a
// shared instance, because a caller that mutated one would corrupt the month for everybody after it.
const july = monthGridCells(2026, 6);
const julyFirst = july.find(Boolean);
check('a cell carries no time of day', [julyFirst.getHours(), julyFirst.getMinutes()], [0, 0]);
check('and the grid hands back fresh objects each call', monthGridCells(2026, 6).find(Boolean) === julyFirst, false);

console.log('\n--- how many days a window shows ---');
// THREE SHAPES FROM TWO ANSWERS. The middle one is the feature: below the sidebar's 768px but above a phone's 640px the
// calendar shows TWO days, and it is the band that could not exist before there were two answers to ask for.
check('a desktop window draws the month', dayViewSpan({ isDesktop: true, isPhone: false }), MONTH_VIEW);
check('a window between a phone and the sidebar draws two days', dayViewSpan({ isDesktop: false, isPhone: false }), 2);
check('and a phone draws one', dayViewSpan({ isDesktop: false, isPhone: true }), 1);

// THE BANDS MUST NOT OVERLAP, which is the property the two queries are written to give. If they did, a 700px window would
// match both a `min-width: 640px` and a `max-width: 639px` question and no rule could decide; so the desktop question is
// asked FIRST and a window answering both takes the month view. That ordering is the safety property, and it is asserted
// rather than described.
check('a window that somehow answers both takes the desktop shape', dayViewSpan({ isDesktop: true, isPhone: true }), MONTH_VIEW);

console.log('\n--- the days a span covers ---');
// A two-day span is the START day and the day after it - which is why the view opens on today and tomorrow rather than on
// today and some other day of the week.
check('a two-day span is the day and the one after', spanDayDates(new Date(2026, 9, 3), 2).map(key), ['2026-10-03', '2026-10-04']);
check('a one-day span is just the day', spanDayDates(new Date(2026, 9, 3), 1).map(key), ['2026-10-03']);
check('and a zero-day span is empty rather than one day', spanDayDates(new Date(2026, 9, 3), 0), []);

// THE MONTH BOUNDARY, which is where a naive `getDate() + 1` would produce "32nd October" or a blank. The Date constructor
// normalises the overflow, and this is the assertion that it still does: the member's calendar READS THE NEXT MONTH when a
// span crosses, so a broken second day would show an empty column with no error anywhere.
check('a span across a month boundary lands on the 1st', spanDayDates(new Date(2026, 9, 31), 2).map(key), ['2026-10-31', '2026-11-01']);
check('and across a year boundary too', spanDayDates(new Date(2026, 11, 31), 2).map(key), ['2026-12-31', '2027-01-01']);
check('a leap day steps onto the 1st of March', spanDayDates(new Date(2028, 1, 29), 2).map(key), ['2028-02-29', '2028-03-01']);
// A junk span yields nothing rather than throwing, so a caller that has not decided its shape still gets a drawable list.
check('a nonsense span is empty, not a crash', spanDayDates(new Date(2026, 9, 3), MONTH_VIEW), []);
// A caller may hold on to one of these and shift it - the calendars do when the view moves - so the days have to be
// FRESH objects rather than one array the function hands out again. This is checked by actually breaking one: if
// `spanDayDates` reused a Date, the mutation below would leak into the next call.
//
// The first version of this check compared a returned day against `new Date(...)`, which is a reference comparison and so
// can never be true - it passed whatever the function did. oxlint flagged it (the 31st warning on this branch), and it
// earned the flag: an assertion that cannot fail is not coverage, it is decoration.
const borrowed = spanDayDates(new Date(2026, 9, 3), 1);
borrowed[0].setFullYear(1999);
check('and the days are fresh objects, so a caller cannot corrupt the next span', spanDayDates(new Date(2026, 9, 3), 1).map(key), ['2026-10-03']);

console.log('\n--- one rule, two callers ---');
// Both calendars must ask the SAME function. Two implementations that agree today are two implementations, and the day one
// of them is edited is the day they disagree.
const spanMember = source('src/components/ScheduleCalendar.jsx');
const spanBoard = source('src/components/admin/AdminScheduleManagementTab.jsx');
for (const [label, text] of [['the member calendar', spanMember], ['the board', spanBoard]]) {
  checkIs(`${label} asks the shared span rule`, /dayViewSpan\(\{ isDesktop, isPhone \}\)/.test(text));
  checkIs(`${label} draws its days with the shared span builder`, /spanDayDates\(/.test(text));
  checkIs(
    `${label} steps its arrows by the span`,
    /dayCount \|\| 1/.test(text) || /delta \* \(dayCount \|\| 1\)/.test(text)
  );
}
// ...AND NEITHER CARRIES A BREAKPOINT NUMBER OF ITS OWN, which is how the bands would drift apart. Comments are stripped
// first, because both files DISCUSS the numbers at length and a check that matched prose would pass on a deleted rule.
const withoutComments = (text) => text.replace(/\/\/.*$/gm, '');
checkIs(
  'neither calendar names a pixel width',
  !/min-width|max-width|\b768\b|\b639\b/.test(withoutComments(spanMember)) &&
    !/min-width|max-width|\b768\b|\b639\b/.test(withoutComments(spanBoard)),
  'a calendar is carrying its own breakpoint'
);
checkIs(
  'and the phone breakpoint is a disjoint upper bound, which is what the ordering above relies on',
  /PHONE_MEDIA_QUERY = '\(max-width: 639px\)'/.test(source('src/utils/viewport.js')),
  'the phone query is not the disjoint upper bound the span rule depends on'
);

console.log('\n--- one builder, three callers ---');
// The two calendars build the month; the picker builds the same month. One builder means they cannot disagree, and the
// assertion is the ABSENCE of a second copy - a regex for the inline arithmetic that each of them used to carry.
const memberCalendar = source('src/components/ScheduleCalendar.jsx');
const adminBoard = source('src/components/admin/AdminScheduleManagementTab.jsx');
const picker = source('src/components/MonthPickerModal.jsx');

checkIs('the member calendar uses the shared builder', /monthGridCells\(year, month\)/.test(memberCalendar));
checkIs(
  'and hands the reader the SAME span it draws, so a crossing span reads its second month',
  /spanDates : monthCells/.test(memberCalendar) && /dayView \? spanKeys : \[monthStartKey\]/.test(memberCalendar),
  'the drawn cells and the read range are derived from different things'
);
checkIs('the board uses the shared builder', /monthGridCells\(year, month\)/.test(adminBoard));
checkIs('and so does the picker', /monthGridCells\(year, month\)/.test(picker));
[['the member calendar', memberCalendar], ['the board', adminBoard]].forEach(([name, text]) => {
  checkIs(
    `${name} keeps no second copy of the arithmetic`,
    !/const firstWeekday = new Date\(year, month, 1\)\.getDay\(\)/.test(text),
    'two implementations of one fact drift, and this is the drift that puts the 1st under the wrong weekday'
  );
});

console.log('\n--- the picker is a calendar and nothing else ---');
// THE SPEC, in one place: a month, its weekday row and its days. No shifts, no events, no counts and no legend - the
// moment it draws one of those it becomes a screen somebody manages the schedule from, which is what the calendar behind
// it is for.
//
// ASSERTED AS THE WHOLE IMPORT LIST rather than as a blocklist of words, because a blocklist is only ever as good as the
// words somebody thought of - the first version of this check "failed" on `utils/scheduleDate`, which is the date
// formatter and has nothing to do with shifts. The list is short enough to state: calendar geometry, the date formatter,
// the furniture a dialog is made of, and icons.
const pickerImports = [...picker.matchAll(/from '([^']+)'/g)].map((match) => match[1]).sort();
check('it imports nothing but the calendar and a dialog', pickerImports, [
  '../utils/calendarConstants',
  '../utils/motion',
  '../utils/scheduleDate',
  '../utils/uiSounds',
  '../utils/viewportLayer',
  'lucide-react',
  'react',
]);
checkIs('it draws the weekday row', /WEEKDAYS\.map/.test(picker));
checkIs('and one button per day', /onPick\(key\)/.test(picker));
checkIs('marking the day the screen is on', /aria-current=\{isSelected \? 'date' : undefined\}/.test(picker));
checkIs(
  'and marking today differently, so the two are not confused',
  /isToday[\s\S]{0,400}border-red-400/.test(picker) && /isSelected[\s\S]{0,200}bg-red-600/.test(picker)
);
// A padding cell is not a day, so it is not a control: a disabled button would be announced as a control that does
// nothing, and a clickable one would be a day that is not a date.
checkIs('a padding cell is not a button', /if \(!day\) return <div key=\{`blank-\$\{index\}`\}/.test(picker));
// It can leave its month, which is the whole point of a picker: a day next month is exactly the case the arrows cannot
// reach cheaply.
checkIs('it can walk its own month without moving the screen behind it', /setMonthDate\(new Date\(year, month [+-] 1, 1\)\)/.test(picker));
checkIs(
  'opening on the month on screen, so the day being read is visible in it',
  /useState\(\s*\n?\s*\(\) => new Date\(viewDate\.getFullYear\(\), viewDate\.getMonth\(\), 1\)/.test(picker)
);
checkIs('it names its own tone', /modalSoundFor\('monthPicker'\)/.test(picker));
// Escape closes it through the same exit the backdrop uses, rather than unmounting in a frame: it is opened from a
// toolbar button a keyboard user has just pressed, so it is the dialog they will try to leave with the keyboard.
checkIs(
  'and Escape leaves it through that same exit',
  /if \(e\.key === 'Escape'\) dismiss\(\);/.test(picker),
  'Escape would either do nothing or unmount the dialog in a single frame'
);

console.log('\n--- the button, and where it is offered ---');
// A DAY VIEW NEEDS IT AND A MONTH VIEW DOES NOT: the month view already has every day on screen, so a picker over it
// would be a second grid saying what the first one says. Both screens gate it on `dayView` - asserted positionally,
// because the guard and the button are a comment apart and a character budget between them would break on a reflow.
const buttonIn = (text) => {
  const guard = text.indexOf('{dayView && (');
  const button = text.indexOf('aria-label="Choose a day"');
  return guard !== -1 && button > guard;
};
checkIs('the member calendar offers it in the day view only', buttonIn(memberCalendar));
checkIs('and so does the board', buttonIn(adminBoard));
checkIs(
  'each screen opens it from the toolbar rather than from a pill',
  (memberCalendar.match(/setPickerOpen\(true\)/g) || []).length === 1 &&
    (adminBoard.match(/setPickerOpen\(true\)/g) || []).length === 1,
  'the picker would have a second way in, which is one more than a picker needs'
);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);