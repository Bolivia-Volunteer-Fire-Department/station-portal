/**
 * Verifies assignment effective/end dates (utils/assignmentDates + utils/effectiveDates).
 *
 * The assignments sheet gained the same two columns as schedule_templates, so the rule itself is shared -
 * this checks both that the assignment-facing spelling behaves identically AND that both sheets still read
 * dates through one implementation rather than two.
 *
 * The blank case is the one that matters most, exactly as for templates: every existing assignment has
 * empty cells, so a blank must mean "no restriction" rather than "never". Getting that backwards retires
 * every assignment in the station at once.
 *
 * Run with: npm run verify:assignment-dates
 */
import { readFileSync } from 'node:fs';
import {
  assignmentDateError,
  assignmentDateKey,
  assignmentDateLabel,
  assignmentDateRange,
  assignmentDateText,
  assignmentIsActiveOn,
  assignmentLifecycle,
  choosableAssignments,
  templatesAffectedByEndDate,
} from '../src/utils/assignmentDates.js';
import {
  dateKeyText,
  dateWindowLabel,
  effectiveDateKey,
} from '../src/utils/effectiveDates.js';
import { templateDateError, templateIsActiveOn } from '../src/utils/scheduleTemplates.js';

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

const assignment = (overrides = {}) => ({
  id: '3',
  description: 'Engine 1',
  rank_order_required: '2',
  ...overrides,
});

console.log('--- reading a date cell ---');
check('a text yyyy-MM-dd passes through', assignmentDateKey('2026-07-01'), '2026-07-01');
check('a US text date is read', assignmentDateKey('7/1/2026'), '2026-07-01');
check('an ISO string is read in station time', assignmentDateKey('2026-07-01T04:00:00.000Z'), '2026-07-01');
check('a Date object is read', assignmentDateKey(new Date(2026, 6, 1)), '2026-07-01');
check('blank is blank', assignmentDateKey(''), '');
check('null is blank', assignmentDateKey(null), '');
check('nonsense is blank', assignmentDateKey('not a date'), '');

console.log('\n--- the rule ---');
check('no dates means always in force', assignmentIsActiveOn(assignment(), '2026-07-01'), true);
check('and in the past', assignmentIsActiveOn(assignment(), '2001-01-01'), true);

const fromOnly = assignment({ effective_date: '2026-07-01' });
check('a start date excludes the day before', assignmentIsActiveOn(fromOnly, '2026-06-30'), false);
check('and INCLUDES the effective date', assignmentIsActiveOn(fromOnly, '2026-07-01'), true);

const toOnly = assignment({ end_date: '2026-06-30' });
check('an end date excludes the day after', assignmentIsActiveOn(toOnly, '2026-07-01'), false);
check('and INCLUDES the end date', assignmentIsActiveOn(toOnly, '2026-06-30'), true);

const windowed = assignment({ effective_date: '2026-01-01', end_date: '2026-12-31' });
check('inside the window', assignmentIsActiveOn(windowed, '2026-06-15'), true);
check('before the window', assignmentIsActiveOn(windowed, '2025-12-31'), false);
check('after the window', assignmentIsActiveOn(windowed, '2027-01-01'), false);

// A null assignment is what an id pointing at a missing row resolves to. Treating that as active is
// deliberate: a dangling id must not blank a whole day of slots.
check('a missing assignment is not a restriction', assignmentIsActiveOn(null, '2026-07-01'), true);
check('and neither is undefined', assignmentIsActiveOn(undefined, '2026-07-01'), true);

console.log('\n--- lifecycle and labels ---');
check('retired', assignmentLifecycle(assignment({ end_date: '2026-06-01' }), '2026-06-15'), 'retired');
check('not yet effective', assignmentLifecycle(fromOnly, '2026-06-15'), 'scheduled');
check('active', assignmentLifecycle(windowed, '2026-06-15'), 'active');
check('a start-only label', assignmentDateLabel(fromOnly), 'From Jul 1, 2026');
check('an end-only label', assignmentDateLabel(toOnly), 'Until Jun 30, 2026');
check('a window label', assignmentDateLabel(windowed), 'Jan 1, 2026 - Dec 31, 2026');
check('no dates means no label', assignmentDateLabel(assignment()), '');
check('a single date reads on its own', assignmentDateText('2026-06-30'), 'Jun 30, 2026');
check('and a window keeps blanks open', assignmentDateRange(assignment()), { from: '', to: '', openStart: true, openEnd: true });

console.log('\n--- validation ---');
// The effective date is REQUIRED on save now. The sheet still tolerates a blank cell for rows created
// before the rule, which is why the reading tests above are unchanged.
check('both blank is refused', /effective date is required/i.test(assignmentDateError('', '')), true);
check('an end with no start is refused', /effective date is required/i.test(assignmentDateError('', '2026-06-30')), true);
check('whitespace is refused as missing', /effective date is required/i.test(assignmentDateError('   ', '')), true);
check('a start alone is valid', assignmentDateError('2026-07-01', ''), '');
check('a normal window is valid', assignmentDateError('2026-01-01', '2026-12-31'), '');
check('the same day is valid', assignmentDateError('2026-03-14', '2026-03-14'), '');
check('an inverted window is refused', /must not be before/i.test(assignmentDateError('2026-12-31', '2026-01-01')), true);
check('an unreadable date is refused', /not a readable date/i.test(assignmentDateError('nonsense', '2026-12-31')), true);
// Both sheets must answer identically, since the rule is one shared function.
check('the rule matches the templates sheet', assignmentDateError('', ''), templateDateError('', ''));

console.log('\n--- what an administrator may choose ---');
const list = [
  assignment({ id: '1', description: 'Always on' }),
  assignment({ id: '2', description: 'Retired', effective_date: '2020-01-01', end_date: '2021-01-01' }),
  assignment({ id: '3', description: 'Future', effective_date: '2099-01-01' }),
];
check('only in-force assignments are offered', choosableAssignments(list, '2026-06-15').map((a) => a.id), ['1']);
check('a future date offers the future one', choosableAssignments(list, '2099-06-15').map((a) => a.id), ['1', '3']);
check("the record's own retired assignment is kept", choosableAssignments(list, '2026-06-15', '2').map((a) => a.id), ['1', '2']);
check('keeping one does not duplicate it', choosableAssignments(list, '2026-06-15', '1').map((a) => a.id), ['1']);
check('a blank date offers everything dated or not', choosableAssignments(list, '').map((a) => a.id), ['1', '2', '3']);
check('a non-array is safe', choosableAssignments(null, '2026-06-15'), []);
check('and a null entry is skipped', choosableAssignments([null, list[0]], '2026-06-15').length, 1);

console.log('\n--- the warning about affected templates ---');
const templates = [
  { id: 't1', assignment_id: '3' },
  { id: 't2', assignment_id: '3' },
  { id: 't3', assignment_id: '9' },
];
check('counts the templates using it', templatesAffectedByEndDate('3', templates), 2);
check('and none for an unused assignment', templatesAffectedByEndDate('7', templates), 0);
check('and nothing for a blank id', templatesAffectedByEndDate('', templates), 0);
check('a non-array of templates is safe', templatesAffectedByEndDate('3', null), 0);

console.log('\n--- one date implementation for both sheets ---');
// The point of the shared core: if these disagree, a template and its assignment could be read on
// different days and a shift would appear or vanish depending on which was consulted.
for (const value of ['2026-07-01', '7/1/2026', '2026-07-01T04:00:00.000Z', '', null, 'nonsense']) {
  check(`both sheets read ${JSON.stringify(value)} the same`, assignmentDateKey(value), effectiveDateKey(value));
}
check('an assignment and a template are judged by the same function', templateIsActiveOn(list[1], '2020-06-01'), assignmentIsActiveOn(list[1], '2020-06-01'));
check('and labelled by the same one', assignmentDateLabel(list[1]), dateWindowLabel(list[1]));
check('and a single date formatted the same', assignmentDateText('2026-06-30'), dateKeyText('2026-06-30'));

const coreSource = readFileSync('src/utils/effectiveDates.js', 'utf8');
check('there is exactly one window comparator', (coreSource.match(/export const isActiveOnDate/g) || []).length, 1);
check('there is exactly one date parser call', (coreSource.match(/parseSheetDateKey\(/g) || []).length, 1);
check('scheduleTemplates delegates rather than reimplementing', /export const templateIsActiveOn = isActiveOnDate/.test(readFileSync('src/utils/scheduleTemplates.js', 'utf8')), true);
check('and assignments delegates to the same core', /export const assignmentIsActiveOn = isActiveOnDate/.test(readFileSync('src/utils/assignmentDates.js', 'utf8')), true);
check('neither wrapper parses dates itself', [
  /parseSheetDateKey\(/.test(readFileSync('src/utils/scheduleTemplates.js', 'utf8')),
  /parseSheetDateKey\(/.test(readFileSync('src/utils/assignmentDates.js', 'utf8')),
], [false, false]);

console.log('\n--- every place the gate is needed ---');
// Generation: a retired assignment must stop producing shifts through its templates. The counts are
// CALL SITES, not imports (an import has no parenthesis after the name).
const generators = [
  ['src/components/ScheduleCalendar.jsx', 'the member calendar', 1],
  ['src/components/admin/AdminScheduleManagementTab.jsx', "the administrator's board and picker", 2],
  ['src/utils/availability.js', 'both availability views', 2],
];
for (const [path, what, minimum] of generators) {
  const source = readFileSync(path, 'utf8');
  const references = (source.match(/assignmentIsActiveOn\(/g) || []).length;
  check(`${what} gates on the assignment window (${references})`, references >= minimum, true);
}

// The pickers: a retired assignment must not be offered for new work.
const templatesForm = readFileSync('src/components/admin/AdminScheduleTemplatesTab.jsx', 'utf8');
const boardTab = readFileSync('src/components/admin/AdminScheduleManagementTab.jsx', 'utf8');
check('the templates form filters its assignment picker', /choosableAssignments\(assignments, todayKeyValue, formData\.assignment_id\)/.test(templatesForm), true);
check('the board filters its assignment picker', /assignmentsForAddForm[\s\S]{0,300}choosableAssignments/.test(boardTab), true);
check('the board picker passes the date being added', /choosableAssignments\(assignments, addForm\.date_from/.test(boardTab), true);
// The picker must not still be rendering the raw list, or the filter above would be dead code.
check('the board picker no longer maps the raw list', /assignments\.map\(\(a\) => \(/.test(boardTab), false);
check('and neither does the templates form', /assignments\.map\(\(a\) => \(/.test(templatesForm), false);

// The assignments tab itself: form, validation and the affected-templates warning.
const assignmentsTab = readFileSync('src/components/admin/AdminAssignmentsTab.jsx', 'utf8');
check('the empty form carries both fields', /effective_date: ''[\s\S]{0,40}end_date: ''/.test(assignmentsTab), true);
check('editing seeds the effective date', /effective_date: assignmentDateKey\(/.test(assignmentsTab), true);
check('the form validates before saving', /assignmentDateError\(formData\.effective_date, formData\.end_date\)/.test(assignmentsTab), true);
check('it shows the window in the list', /assignmentDateLabel\(assignment\)/.test(assignmentsTab), true);
check('marks a retired assignment', /· Retired/.test(assignmentsTab), true);
check('warns about the templates a new end date affects', /templatesAffectedByEndDate\(formData\.id, scheduleTemplates\)/.test(assignmentsTab), true);

console.log('\n--- the backend keeps up ---');
const code = readFileSync('src/services/Code.gs', 'utf8');
check('the save action accepts the effective date', /assignmentFields\.effective_date = toDateKeyValue\(rawEffective\)/.test(code), true);
check('and the end date', /assignmentFields\.end_date = toDateKeyValue\(rawEnd\)/.test(code), true);
check('and refuses an inverted window', /end date must not be before the effective date/i.test(code), true);
check('the member projection includes the effective date', /effective_date: toDateKeyValue\(row\.effective_date\)/.test(code), true);
check('and the end date', /end_date: toDateKeyValue\(row\.end_date\)/.test(code), true);
check('it still has exactly one date parser helper', (code.match(/function toDateKeyValue/g) || []).length, 1);

const apiSource = readFileSync('src/services/api.js', 'utf8');
check('the API sends the effective date', /effective_date: assignmentData\.effective_date/.test(apiSource), true);
check('and the end date', /end_date: assignmentData\.end_date/.test(apiSource), true);

const panelSource = readFileSync('src/components/admin/AdminPanel.jsx', 'utf8');
check('the panel passes templates to the assignments tab', /<AdminAssignmentsTab[\s\S]{0,400}scheduleTemplates=\{scheduleTemplates\}/.test(panelSource), true);

const rosterSource = readFileSync('src/components/admin/AdminAvailabilityRoster.jsx', 'utf8');
check('the availability roster passes assignments down', /availabilityRosterForMonth\(\{[\s\S]{0,200}assignments,/.test(rosterSource), true);
check('and the generator accepts them', /availabilityRosterForMonth = \(\{[\s\S]{0,400}assignments = \[\]/.test(readFileSync('src/utils/availability.js', 'utf8')), true);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
