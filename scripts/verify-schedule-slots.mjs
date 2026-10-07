// Verifies the slot rule in utils/scheduleSlots.js - what a slot IS, and who is in it.
//
// The rule moved out of the Schedule Management board so the Member Availability roster could offer the same slots to
// assign a member from. Two screens deciding independently what a slot is would drift the moment either was touched, so
// the agreement is asserted here rather than hoped for: the last checks read BOTH components' source and fail if either
// starts building slots of its own again.
//
// The cases below are the ones that were got wrong at least once while this rule lived in the board: a row that SPANS
// the slot's day does fill it (matching on the start day alone left a later slot looking vacant while somebody was on
// it), a dateless row covers NOTHING (the alternative fills every slot in the month), and "no end time" is not midnight.
//
// Run with: npm run verify:schedule-slots
import { readFileSync } from 'node:fs';
import { toDateKey } from '../src/utils/scheduleDate.js';
import {
  isCustomShift,
  placeFitsWindow,
  placesFittingWindow,
  placesForDate,
  rowCoversDate,
  rowFieldsOf,
  slotKeyOf,
  slotOccupant,
  slotsByDay,
  templateSlotsForMonth,
} from '../src/utils/scheduleSlots.js';
import { timeToMinutes } from '../src/utils/shiftTime.js';

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
const checkIs = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` -> ${detail}`}`);
};

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const YEAR = 2026;
const MONTH = 8; // September, 0-based

const weekdayDates = (dayName) => {
  const total = new Date(YEAR, MONTH + 1, 0).getDate();
  const keys = [];
  for (let day = 1; day <= total; day += 1) {
    const date = new Date(YEAR, MONTH, day);
    if (DAYS[date.getDay()] === dayName) keys.push(toDateKey(date));
  }
  return keys;
};

const ASSIGNMENTS = [
  { id: 'a1', description: 'Firefighter', rank_order_required: '1' },
  { id: 'a2', description: 'Officer', rank_order_required: '3' },
];
const assignmentById = (id) => ASSIGNMENTS.find((a) => String(a.id) === String(id)) || null;

const TEMPLATES = [
  { id: 't1', day_of_week: 'tuesday', start_time: '18:00', end_time: '22:00', assignment_id: 'a1', apparatus_id: 'E1' },
  { id: 't2', day_of_week: 'tuesday', start_time: '06:00', end_time: '18:00', assignment_id: 'a2', apparatus_id: 'E2', nickname: 'Day' },
  { id: 't3', day_of_week: 'wednesday', start_time: '08:00', end_time: '12:00', assignment_id: 'a1' },
];

console.log('--- the key, and the shape of a month ---');
check('a slot is known by its date and its template', slotKeyOf('2026-09-01', 't1'), 'slot-2026-09-01-t1');

const tuesdays = weekdayDates('tuesday');
const wednesdays = weekdayDates('wednesday');
const slots = templateSlotsForMonth({ year: YEAR, month: MONTH, scheduleTemplates: TEMPLATES, assignmentById });
check(
  'every date is crossed with every template that runs that weekday',
  slots.length,
  tuesdays.length * 2 + wednesdays.length
);
checkIs(
  'and nothing is drawn on a weekday no template runs',
  !slots.some((s) => weekdayDates('sunday').includes(s.dateKey)),
  `${slots.length} slot(s)`
);
check(
  'the first Tuesday carries both of its shifts',
  slots.filter((s) => s.dateKey === tuesdays[0]).length,
  2
);
check(
  'a slot names itself from its assignment and its nickname',
  slots.find((s) => s.slotKey === slotKeyOf(tuesdays[0], 't2')).name,
  'Officer Day'
);
check('and carries the rank the SHIFT requires', slots.find((s) => s.slotKey === slotKeyOf(tuesdays[0], 't2')).requiredRankOrder, 3);

console.log('\n--- a template, and an assignment, that are not in force ---');
const retired = templateSlotsForMonth({
  year: YEAR,
  month: MONTH,
  scheduleTemplates: [{ ...TEMPLATES[0], end_date: '2026-08-31' }],
  assignmentById,
});
check('a template whose window has ended draws nothing', retired.length, 0);
const scheduled = templateSlotsForMonth({
  year: YEAR,
  month: MONTH,
  scheduleTemplates: [{ ...TEMPLATES[0], effective_date: '2026-10-01' }],
  assignmentById,
});
check('and neither does one that has not started', scheduled.length, 0);
const expiredAssignment = templateSlotsForMonth({
  year: YEAR,
  month: MONTH,
  scheduleTemplates: [{ ...TEMPLATES[0], effective_date: '2026-01-01' }],
  assignmentById: () => ({ id: 'a1', description: 'Firefighter', effective_date: '2026-01-01', end_date: '2026-08-31' }),
});
check(
  'nor one whose ASSIGNMENT has ended, even while the template is running',
  expiredAssignment.length,
  0
);

console.log('\n--- the order a day reads ---');
const byDay = slotsByDay(slots);
check(
  'a day is ordered by start time, whatever order the templates arrived in',
  byDay[tuesdays[0]].map((s) => s.template.id),
  ['t2', 't1']
);
check('and the morning shift is the one that starts first', byDay[tuesdays[0]][0].startMin, 360);

console.log('\n--- what a row covers ---');
check(
  'a single-day row covers its own day',
  [rowCoversDate({ date_from: '2026-09-01', date_to: '' }, '2026-09-01'), rowCoversDate({ date_from: '2026-09-01', date_to: '' }, '2026-09-02')],
  [true, false]
);
check(
  'a blank end date falls back to the start rather than to nothing',
  rowCoversDate({ date_from: '2026-09-01', date_to: '' }, '2026-09-01'),
  true
);
check(
  'a row that spans the day covers every day it reaches',
  [rowCoversDate({ date_from: '2026-09-01', date_to: '2026-09-03' }, '2026-09-02'), rowCoversDate({ date_from: '2026-09-01', date_to: '2026-09-03' }, '2026-09-04')],
  [true, false]
);
check(
  'and a row with NO usable date covers nothing at all',
  [rowCoversDate({ date_from: '', date_to: '' }, '2026-09-01'), rowCoversDate({ date_from: 'not a date', date_to: '' }, '2026-09-01')],
  [false, false]
);

console.log('\n--- who is in a slot ---');
const evening = slots.find((s) => s.slotKey === slotKeyOf(tuesdays[0], 't1'));
check(
  'a row for that template, on that day, fills it',
  slotOccupant(evening, [{ id: 'r1', schedule_template_id: 't1', date_from: tuesdays[0], date_to: '', user_id: 'u1' }])?.id,
  'r1'
);
check(
  'a row for a DIFFERENT template does not',
  slotOccupant(evening, [{ id: 'r2', schedule_template_id: 't3', date_from: tuesdays[0], date_to: '', user_id: 'u1' }]),
  null
);
check(
  'a row that STARTED EARLIER and spans this day does fill it',
  slotOccupant(evening, [{ id: 'r3', schedule_template_id: 't1', date_from: tuesdays[0], date_to: tuesdays[1], user_id: 'u1' }])?.id,
  'r3'
);
check(
  'and a row for that template on ANOTHER day does not',
  slotOccupant(evening, [{ id: 'r4', schedule_template_id: 't1', date_from: tuesdays[1], date_to: '', user_id: 'u1' }]),
  null
);
check(
  'a row with nobody on it still occupies the slot, so it reads as vacant rather than as free',
  slotOccupant(evening, [{ id: 'r5', schedule_template_id: 't1', date_from: tuesdays[0], date_to: '', user_id: '' }])?.id,
  'r5'
);

console.log('\n--- every place on a day, filled or not ---');
const ROWS = [
  { id: 'x1', schedule_template_id: 't2', date_from: tuesdays[0], date_to: '', user_id: 'u1' },
  { id: 'c1', schedule_template_id: '', date_from: tuesdays[0], date_to: '', start_time: '09:00', end_time: '13:00', description: 'Detail' },
  { id: 'c2', schedule_template_id: '', date_from: tuesdays[0], date_to: '', start_time: '20:00', end_time: '23:00', description: 'Standby', user_id: 'u2' },
  // Neither of these belongs to the day being asked about, and a list that showed them would offer a shift from the
  // wrong day - which is the one way this view could put somebody on the wrong shift.
  { id: 'x2', schedule_template_id: 't1', date_from: tuesdays[1], date_to: '', user_id: 'u3' },
  { id: 'c3', schedule_template_id: '', date_from: tuesdays[1], date_to: '', start_time: '07:00', description: 'Elsewhere' },
];
const places = placesForDate({ dateKey: tuesdays[0], slots: byDay[tuesdays[0]], rows: ROWS });
check(
  'the day lists its slots and its one-off shifts, in the order the day reads',
  places.map((p) => p.key),
  [slotKeyOf(tuesdays[0], 't2'), 'row-c1', slotKeyOf(tuesdays[0], 't1'), 'row-c2']
);
check(
  'each place says who is in it, and an empty string where nobody is',
  places.map((p) => p.userId),
  ['u1', '', '', 'u2']
);
check('a place built from a template carries the row that belongs there', places[2].fields, {
  id: '',
  schedule_template_id: 't1',
  date_from: tuesdays[0],
  date_to: tuesdays[0],
  start_time: '',
  end_time: '',
  apparatus_id: 'E1',
  assignment_id: 'a1',
  user_id: '',
});
// THE WRITER DOES NOT MERGE, so this is the check that matters most in this file: an entry missing a field blanks it on
// the row. A one-off shift asserted here keeps its own times, which is exactly what a partial update destroys.
check('and a one-off shift is written with its OWN times rather than with blanks', places[1].fields, {
  id: 'c1',
  schedule_template_id: '',
  date_from: tuesdays[0],
  date_to: '',
  start_time: '09:00',
  end_time: '13:00',
  apparatus_id: '',
  assignment_id: '',
  user_id: '',
});
check(
  'a row with nobody on it is written with the member who was there, not an empty one',
  places[3].fields.user_id,
  'u2'
);
check(
  'every field a row is written with is always present, so nothing can be blanked by omission',
  Object.keys(rowFieldsOf({})).sort(),
  ['apparatus_id', 'assignment_id', 'date_from', 'date_to', 'end_time', 'id', 'schedule_template_id', 'start_time', 'user_id']
);
checkIs('and is marked as the kind that is written onto rather than created', places[1].kind === 'row' && places[2].kind === 'slot');
check('a one-off shift with nobody on it is listed, so it can be filled', places[1].name, 'Detail');
check(
  'an unnamed one-off shift still has a name to show',
  placesForDate({ dateKey: tuesdays[0], slots: [], rows: [{ id: 'c4', schedule_template_id: '', date_from: tuesdays[0], start_time: '05:00' }] })[0].name,
  'Custom shift'
);
checkIs(
  'and a template shift is not mistaken for a one-off',
  !isCustomShift({ schedule_template_id: 't1' }) && isCustomShift({ schedule_template_id: '' }) && isCustomShift({})
);

console.log('\n--- one definition, read by both screens ---');
const board = readFileSync('src/components/admin/AdminScheduleManagementTab.jsx', 'utf8');
checkIs(
  'the board reads the slot rule rather than keeping its own',
  /from '\.\.\/\.\.\/utils\/scheduleSlots'/.test(board) &&
    /templateSlotsForMonth\(\{ year, month, scheduleTemplates, assignmentById \}\)/.test(board),
  'the board builds its own slots again, so the two screens can disagree'
);
checkIs(
  'and no longer spells a slot key itself',
  !/slot-\$\{dateKey\}-\$\{/.test(board),
  'a second spelling of a slot key is how the offer matching broke before (see utils/shiftOfferRow)'
);
// The OTHER caller, and the reason the rule moved: the Member Availability roster offers the same slots to assign a
// member from. Both screens reading one rule is the whole point, so both are named here.
const rosterTab = readFileSync('src/components/admin/AdminAvailabilityTab.jsx', 'utf8');
checkIs(
  'and the availability roster reads the same rule rather than a second list',
  /from '\.\.\/\.\.\/utils\/scheduleSlots'/.test(rosterTab) &&
    /templateSlotsForMonth\(\{ year, month, scheduleTemplates, assignmentById \}\)/.test(rosterTab) &&
    /placesForDate\(\{ dateKey, slots: slotsForDay\[dateKey\] \|\| \[\], rows: schedule \}\)/.test(rosterTab),
  'the roster lists its own shifts, so the two screens can offer different things'
);
checkIs(
  'and the entry it writes is the whole field set rather than a partial one',
  /\{ \.\.\.entry\.fields, user_id: entry\.userId \}/.test(rosterTab),
  'the writer replaces a row with what it is handed, so a partial entry blanks every field it omits'
);

console.log('\n--- what the availability window offers ---');
// The menu beside a NAME lists only the shifts that fall inside the window that name was clicked under. These are the
// cases that decide it: an overnight window, containment rather than overlap, and the two things that must never be
// hidden on a guess.
const DAY_WINDOW = { nickname: 'Day', start_time: '08:00', end_time: '18:00' };
const NIGHT_WINDOW = { nickname: 'Night', start_time: '18:00', end_time: '06:00' };
const at = (from, to, key = `${from}-${to}`) => ({ key, startMin: timeToMinutes(from), endMin: to ? timeToMinutes(to) : null });

checkIs('a shift inside a day window is offered', placeFitsWindow(at('09:00', '12:00'), DAY_WINDOW));
checkIs('and one that IS the window matches it', placeFitsWindow(at('08:00', '18:00'), DAY_WINDOW));
checkIs('a shift running past the window is not offered', !placeFitsWindow(at('17:00', '19:00'), DAY_WINDOW));
checkIs('nor one entirely before it', !placeFitsWindow(at('06:00', '08:00'), DAY_WINDOW));
checkIs('a night shift inside an overnight window is offered', placeFitsWindow(at('18:00', '22:00'), NIGHT_WINDOW));
checkIs('and one ending exactly at the window end', placeFitsWindow(at('22:00', '06:00'), NIGHT_WINDOW));
checkIs('but one running past the end is not', !placeFitsWindow(at('20:00', '08:00'), NIGHT_WINDOW));
// The small hours belong to the window that is running through them, which is the whole point of an overnight window.
checkIs('the small hours count as inside an overnight window', placeFitsWindow(at('05:00', '06:00'), NIGHT_WINDOW));
checkIs(
  'and a plain day shift is not offered beside an overnight claim',
  !placeFitsWindow(at('06:00', '18:00'), NIGHT_WINDOW)
);
// NOTHING IS HIDDEN ON A MISSING VALUE: hours that were never filled in cannot be judged, and hiding a shift on a guess
// would be a silent loss the officer could not see.
checkIs('a window with no hours filters nothing', placeFitsWindow(at('09:00', '12:00'), { nickname: 'Any' }));
checkIs(
  'and a shift with no end time is kept rather than guessed at',
  placeFitsWindow({ startMin: timeToMinutes('09:00'), endMin: null }, DAY_WINDOW)
);
const split = placesFittingWindow([at('09:00', '12:00', 'fits'), at('17:00', '19:00', 'outside')], DAY_WINDOW);
check(
  'the ones that fit and the ones that do not are returned together, so a count can be admitted to',
  [split.fitted.map((place) => place.key), split.outside.map((place) => place.key)],
  [['fits'], ['outside']]
);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

