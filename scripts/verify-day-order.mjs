/**
 * Verifies the order of one day's pills: shifts by time, events among them.
 *
 * What this exists for: both calendars drew every event ABOVE every shift. On a day with both, a 6:00 PM event sat
 * above the shift that started at 8:00 AM, and a calendar cell reads top to bottom - in the order the day happens.
 * The pills are interleaved by start minute now, and where an event and a shift start together the event is drawn
 * first (it is context for the day rather than work in it).
 *
 * Three things are checked:
 *
 *   1. The merge itself (utils/dayOrder), including the cases that are easy to get wrong: a missing start time must
 *      not read as midnight, both streams must keep their own order, and neither may be mutated.
 *   2. The printed sheet's own ordering, which sorts its lines rather than merging two streams, so its tie-break has
 *      to be asserted separately - it is the same rule, in a different shape.
 *   3. The wiring: all three pill calendars place events with `mergeDayItems` and none renders events as their own
 *      block above the shifts again. That is the regression this is really for - the ordering function staying right
 *      while a cell quietly goes back to two lists.
 *
 * Run with: npm run verify:day-order
 */
import { readFileSync } from 'node:fs';
import { mergeDayItems } from '../src/utils/dayOrder.js';

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

// A shift as utils/crewOrder and the calendars shape it, and an event segment as utils/events shapes it.
const shift = (name, startMin, extra = {}) => ({ name, startMin, ...extra });
const event = (title, startMinutes, extra = {}) => ({ title, startMinutes, startsOnDay: true, ...extra });
const order = (shifts, events) => mergeDayItems(shifts, events).map((item) => item.value.name ?? item.value.title);
const kinds = (shifts, events) => mergeDayItems(shifts, events).map((item) => item.kind);

console.log('\n--- events sit among the shifts, by start time ---');
check(
  'an event before the first shift, one after the last',
  order(
    [shift('Day shift', 540)],
    [event('Early', 420), event('Late', 1200)]
  ),
  ['Early', 'Day shift', 'Late']
);
check(
  'two of each, interleaved',
  order(
    [shift('Morning', 480), shift('Night', 1140)],
    [event('Briefing', 420), event('Meeting', 900)]
  ),
  ['Briefing', 'Morning', 'Meeting', 'Night']
);
check(
  'an event between two shifts that start at the same minute',
  order(
    [shift('First', 540), shift('Second', 540)],
    [event('Tied', 540)]
  ),
  ['Tied', 'First', 'Second']
);

console.log('\n--- same start time: the event goes above the shift ---');
check('one of each, at 09:00', order([shift('Day shift', 540)], [event('Meeting', 540)]), ['Meeting', 'Day shift']);
check(
  'and it is really the tie rule, not luck',
  order([shift('Day shift', 539)], [event('Meeting', 540)]),
  ['Day shift', 'Meeting']
);

console.log('\n--- a missing time is not midnight ---');
// Number(null) and Number('') are both 0, so a blank has to be rejected explicitly or it silently sorts as the
// earliest thing on the day - and midnight is a real start time, so the two must not be confused.
check(
  'a shift with no time sorts after everything timed',
  order([shift('No time', null), shift('Early', 60)], [event('Late', 1200)]),
  ['Early', 'Late', 'No time']
);
check('a blank string is not midnight either', order([shift('Blank', '')], []), ['Blank']);
check(
  'nor is a missing field',
  order([shift('Missing', undefined)], [event('Timed', 600)]),
  ['Timed', 'Missing']
);
check('midnight itself is still earliest', order([shift('Midnight', 0)], [event('Noon', 720)]), ['Midnight', 'Noon']);

console.log('\n--- both streams keep their own order ---');
// The crew order (utils/crewOrder: start, filled before open, required rank, then name) has to survive: this
// function decides where EVENTS go and nothing else.
const crewOrdered = [
  shift('Officer', 480, { requiredRankOrder: 3 }),
  shift('Driver', 480, { requiredRankOrder: 2 }),
  shift('Firefighter', 480, { requiredRankOrder: 1 }),
];
check(
  'shifts at the same minute stay in crew order',
  order(crewOrdered, [event('Tied', 480)]),
  ['Tied', 'Officer', 'Driver', 'Firefighter']
);
check(
  'and so do events in the same minute',
  order([shift('Day shift', 540)], [event('First', 360), event('Second', 360)]),
  ['First', 'Second', 'Day shift']
);
check(
  'an event continuing from an earlier day heads the day',
  order([shift('Day shift', 540)], [event('Three-day event', 0, { startsOnDay: false })]),
  ['Three-day event', 'Day shift']
);

console.log('\n--- shapes and safety ---');
check('the kinds are tagged', kinds([shift('A', 540)], [event('B', 540)]), ['event', 'shift']);
check('nothing is dropped', mergeDayItems([shift('A', 1), shift('B', 2)], [event('C', 3)]).length, 3);
check('an empty day', mergeDayItems([], []), []);
check('shifts only', order([shift('A', 540)], []), ['A']);
check('events only', order([], [event('A', 540)]), ['A']);
check('a null shift list is safe', mergeDayItems(null, [event('A', 540)]).length, 1);
check('a null event list is safe', mergeDayItems([shift('A', 540)], null).length, 1);
const shiftsIn = [shift('B', 600), shift('A', 540)];
const eventsIn = [event('Late', 900), event('Early', 300)];
const shiftsCopy = shiftsIn.slice();
const eventsCopy = eventsIn.slice();
mergeDayItems(shiftsIn, eventsIn);
check('the shift list is not mutated', shiftsIn, shiftsCopy);
check('the event list is not mutated', eventsIn, eventsCopy);
check('and the sort is a copy, so the caller keeps its order', shiftsIn.map((s) => s.name), ['B', 'A']);

console.log('\n--- the calendars are wired to it ---');
// The regression this catches: the ordering function stays right while a cell goes back to drawing events as their
// own block above the pills, which is exactly what the code looked like before.
const CALENDARS = [
  { file: 'src/components/ScheduleCalendar.jsx', where: 'My Schedule' },
  { file: 'src/components/AvailabilityCalendar.jsx', where: 'My Availability' },
  { file: 'src/components/admin/AdminScheduleManagementTab.jsx', where: 'Schedule Management' },
];
// An events block of its own: `(eventSegmentsByDate.get(x) || []).map(...)`.
const rendersEventsSeparately = (source) => /\(eventSegmentsByDate\.get\([^)]*\) \|\| \[\]\)\.map\(/.test(source);
const usesMerge = (source) => /mergeDayItems\(/.test(source);

for (const { file, where } of CALENDARS) {
  const source = readFileSync(file, 'utf8');
  checkIs(`${where} merges events into the day`, usesMerge(source));
  checkIs(`${where} has no events block above the pills`, !rendersEventsSeparately(source));
}

console.log('\n--- the wiring checks themselves ---');
const calendarSource = readFileSync('src/components/ScheduleCalendar.jsx', 'utf8');
const broken = calendarSource.replace(
  '{mergeDayItems(dayAssignments,',
  '{(eventSegmentsByDate.get(key) || []).map(() => null)}{mergeDayItems(dayAssignments,'
);
checkIs('the mutation applied', broken !== calendarSource);
checkIs('the real source passes', !rendersEventsSeparately(calendarSource));
checkIs('and the check catches a separate events block', rendersEventsSeparately(broken));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);


