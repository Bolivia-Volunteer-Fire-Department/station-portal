/**
 * Verifies the printable training sheets (utils/printTraining, PrintableTraining, print.css, and the two
 * buttons in the Training report).
 *
 * Printing is hard to eyeball, so the sheet's CONTENT is built by pure functions and tested here: which
 * trainings appear, what each line says, who is listed under a training, what a filtered sheet admits to,
 * and what a single training's record contains. What cannot be checked without a printer is the ink, so the
 * stylesheet is asserted for the rules that make a sheet printable at all, and the wiring for the promises
 * that would silently break the feature:
 *
 *   * the list sheet is given the FILTERED rows. Handed the full sheet it would print something the reader
 *     never saw, which is the failure this whole file is most concerned with;
 *   * the printed row carries the report's columns and the signers and NOTHING ELSE - no narrative, no
 *     administrative detail - which is what "not any other information not shown in the list" means;
 *   * the single-training sheet is the opposite: everything the record holds, in full.
 *
 * The sheet's own DOM is not rendered here: it goes through createPortal, which server-side rendering skips
 * entirely. The component is therefore asserted at the source, the same way verify-print-schedule does for
 * the calendar sheet.
 *
 * Run with: npm run verify:print-training
 */
import { readFileSync } from 'node:fs';
import { normalizeTraining } from '../src/utils/training.js';
import { displayDate } from '../src/utils/scheduleDate.js';
import {
  PRINT_TRAINING_COLUMNS,
  printSignerNames,
  printTrainingDetail,
  printTrainingFilterSummary,
  printTrainingHeader,
  printTrainingList,
  printTrainingRow,
  printTrainingTotals,
} from '../src/utils/printTraining.js';

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

const USERS = [
  { id: 'u1', name: 'Zoe Adams' },
  { id: 'u2', name: 'Matt Brown' },
  { id: 'u3', name: 'Ana Cruz' },
];

const TRAININGS = [
  normalizeTraining({
    id: 't1',
    date: '2026-03-14',
    title: 'SCBA Refresher',
    start_time: '08:00',
    duration: '2',
    location: 'Station 1',
    instructors: 'Capt. Alvarez',
    narrative: 'Masks and bottles.\nSecond line.',
    is_hazmat: 'TRUE',
    is_ems: 'TRUE',
    signature_count: 3,
  }),
  normalizeTraining({
    id: 't2',
    date: '2026-03-02',
    title: 'Driver Recertification',
    duration: '4',
    location: 'Academy',
    is_driver_training: 'TRUE',
    signature_count: 0,
  }),
  normalizeTraining({
    id: 't3',
    date: '2026-02-10',
    title: 'Filed Externally',
    duration: '1',
    is_company_training: 'TRUE',
    is_entered_into_external: 'TRUE',
    signature_count: 1,
  }),
];

// u3 is missing from the roster on purpose, and u1 has a duplicate signature row: both are shapes a
// hand-edited sheet produces, and both are handled below rather than printed as-is.
const SIGNATURES = [
  { id: 's1', training_id: 't1', user_id: 'u1' },
  { id: 's2', training_id: 't1', user_id: 'u2' },
  { id: 's3', training_id: 't1', user_id: 'u1' },
  { id: 's4', training_id: 't1', user_id: 'u9' },
  { id: 's5', training_id: 't3', user_id: 'u3' },
];


console.log('\n--- one training, in full ---');
const detail = printTrainingDetail({ training: TRAININGS[0], signatures: SIGNATURES, users: USERS });
check('the record is headed by the training', detail.title, 'SCBA Refresher');
check('with every field the form collects', detail.fields.map((field) => field.label), [
  'Date',
  'Start time',
  'Duration',
  'Location',
  'Instructors',
]);
check('the field values', detail.fields.map((field) => field.value), [
  'Sat, Mar 14, 2026',
  '8:00 AM',
  '2 hrs',
  'Station 1',
  'Capt. Alvarez',
]);
// The full labels, not the badges' abbreviations: this sheet has room to be unambiguous.
check('the categories in full', detail.categories, ['Hazmat', 'EMS']);
checkIs('and not their badge abbreviations', !detail.categories.includes('Company'), detail.categories.join(', '));
check('the narrative, as written', detail.narrative, 'Masks and bottles.\nSecond line.');
check('and the signers', detail.signers, ['Matt Brown', 'Unnamed member', 'Zoe Adams']);
check('with a count that matches', detail.signedCount, 3);
// t2 carries driver training, so the flagless case needs its own row rather than borrowing a fixture.
const noCategories = normalizeTraining({ id: 't9', date: '2026-01-05', title: 'Nothing tagged' });
check('a training with no categories says so by listing none', printTrainingDetail({ training: noCategories, users: USERS }).categories, []);
check('a training with no narrative has none', printTrainingDetail({ training: noCategories, users: USERS }).narrative, '');
check('and nobody signed is an empty list, not a blank name', printTrainingDetail({ training: noCategories, users: USERS }).signers, []);
check('an externally entered training is flagged on its record', printTrainingDetail({ training: TRAININGS[2], users: USERS }).locked, true);
check('and an ordinary one is not', detail.locked, false);

console.log('\n--- the header and the totals ---');
check('a list sheet is titled as a report', printTrainingHeader({ mode: 'list' }).title, 'Training Report');
check('a single training is titled as a record', printTrainingHeader({ mode: 'training' }).title, 'Training Record');
check('with the station named', printTrainingHeader({ departmentName: 'Bolivia VFD' }).departmentName, 'Bolivia VFD');
check('falling back rather than printing nothing', printTrainingHeader({ departmentName: '' }).departmentName, 'Fire Department');
check('the subtitle is whatever the caller passes', printTrainingHeader({ subtitle: 'Filtered list · 2 trainings' }).subtitle, 'Filtered list · 2 trainings');
check('and has a sensible default per mode', [
  printTrainingHeader({ mode: 'list' }).subtitle,
  printTrainingHeader({ mode: 'training' }).subtitle,
], ['All trainings', 'One training']);
check('who printed it is carried for the record', printTrainingHeader({ memberName: 'Matt Brown' }).printedBy, 'Matt Brown');
check('and printed on a date, not at a time', /^Printed \d{4}-\d{2}-\d{2}$/.test(printTrainingHeader({}).generated), true);

// The totals come from the same helper the report's tiles use, so paper and screen cannot disagree.
check('the totals count what is listed', printTrainingTotals(TRAININGS).count, 3);
check('and add up the hours the same way', printTrainingTotals(TRAININGS).hoursLabel, '7 hrs');
check('an empty list totals nothing rather than breaking', printTrainingTotals([]).hoursLabel, '0 hrs');

console.log('--- the printed list ---');
const list = printTrainingList({ rows: TRAININGS, signatures: SIGNATURES, users: USERS });
check('one printed row per training', list.length, 3);
check('in the order the report is showing them', list.map((row) => row.id), ['t1', 't2', 't3']);

// The columns are the report's own, plus the signers underneath - which is the whole shape of this sheet.
check('the columns are the report columns', PRINT_TRAINING_COLUMNS, [
  'Date',
  'Training',
  'Location',
  'Instructors',
  'Signed',
  'External',
]);
check('and a printed row carries exactly those and the signers', Object.keys(list[0]).sort(), [
  'badges',
  'date',
  'external',
  'id',
  'instructors',
  'location',
  'signedCount',
  'signers',
  'title',
  'when',
].sort());
// The requirement, asserted rather than described: nothing the list does not show may reach the sheet.
checkIs(
  'with no narrative in a list row',
  list.every((row) => !('narrative' in row)),
  'a list sheet shows the list, not the records behind it'
);

check('the date is printed with the year the screen drops', [displayDate('2026-03-14'), list[0].date], ['Sat, Mar 14', 'Sat, Mar 14, 2026']);
check('the title', list[0].title, 'SCBA Refresher');
check('the time label under it, as on screen', list[0].when, '8:00 AM · 2 hrs');
check('and the category badges, in the sheet order', list[0].badges, ['Hazmat', 'EMS']);
check('a location', list[0].location, 'Station 1');
check('instructors', list[0].instructors, 'Capt. Alvarez');
check('and blanks stay blank rather than printing undefined', [list[1].instructors, list[1].location], ['', 'Academy']);
check('the external marker is on the row that has it', [list[0].external, list[2].external], [false, true]);

console.log("--- who signed ---");
const names = printSignerNames(SIGNATURES, USERS, "t1");
check("the signers are listed A-Z", names, ["Matt Brown", "Unnamed member", "Zoe Adams"]);
check("a duplicate signature row lists the member once", names.filter((n) => n === "Zoe Adams").length, 1);
check("so the count matches the names", printTrainingRow({ training: TRAININGS[0], signatures: SIGNATURES, users: USERS }).signedCount, 3);
check("a training nobody signed lists nobody", printSignerNames(SIGNATURES, USERS, "t2"), []);
check("and only its own signatures", printSignerNames(SIGNATURES, USERS, "t3"), ["Ana Cruz"]);
check("an unknown member is not printed as a raw id", names.some((n) => n === "u9"), false);

console.log("--- what the sheet admits to ---");
check("an unfiltered sheet claims no filters", printTrainingFilterSummary({}, { users: USERS, sort: "" }), []);
check("a category is named as the control names it", printTrainingFilterSummary({ category: "is_hazmat" }, { users: USERS }), [{ label: "Category", value: "Hazmat" }]);
check("the new EMS category too", printTrainingFilterSummary({ category: "is_ems" }, { users: USERS }), [{ label: "Category", value: "EMS" }]);
check("a renamed one under its new name", printTrainingFilterSummary({ category: "is_company_training" }, { users: USERS }), [{ label: "Category", value: "Company Training" }]);
check("the no-category option", printTrainingFilterSummary({ category: "none" }, { users: USERS }), [{ label: "Category", value: "No category" }]);
check("a stale category is left off rather than claimed", printTrainingFilterSummary({ category: "is_drill" }, { users: USERS }), []);
check("a member filter is named, not id-ed", printTrainingFilterSummary({ member: "u2" }, { users: USERS }), [{ label: "Member", value: "Matt Brown" }]);
check("a location", printTrainingFilterSummary({ location: "Academy" }, { users: USERS }), [{ label: "Location", value: "Academy" }]);
check("the signature filter reads as the control does", printTrainingFilterSummary({ signed: "yes" }, { users: USERS }), [{ label: "Signatures", value: "Signed only" }]);
check("and its inverse", printTrainingFilterSummary({ signed: "no" }, { users: USERS }), [{ label: "Signatures", value: "Not signed only" }]);
check('a date range', printTrainingFilterSummary({ from: '2026-03-01', to: '2026-03-31' }, { users: USERS }), [{ label: 'Dates', value: 'Sun, Mar 1, 2026 to Tue, Mar 31, 2026' }]);
check('an open-ended range says which end is open', printTrainingFilterSummary({ from: '2026-03-01' }, { users: USERS }), [{ label: 'Dates', value: 'from Sun, Mar 1, 2026' }]);
check("the sort is admitted to as well", printTrainingFilterSummary({}, { users: USERS, sort: "date_desc" }), [{ label: "Sorted by", value: "Date (newest first)" }]);
check("several filters together", printTrainingFilterSummary({ category: "is_ems", location: "Academy" }, { users: USERS }).length, 2);

// --- the wiring that cannot be rendered here ---------------------------------------------------------
console.log('\n--- the sheet that gets printed ---');
const css = readFileSync('src/print.css', 'utf8');
check('the sheet is hidden on screen', /\.print-sheet\s*\{\s*display:\s*none/.test(css), true);
check('and shown on paper', /\.print-sheet\s*\{\s*display:\s*block\s*!important/.test(css), true);
// Hiding is done from <body>: the sheet is portalled there, so a #root-level rule would hide the sheet's
// own ancestor and print a blank page.
check('the app is hidden by a body-level rule', /body\s*>\s*\*:not\(\.print-sheet\)\s*\{\s*display:\s*none\s*!important/.test(css), true);
check('and a training cannot be split from its signatures', /\.print-training-row\s*\{\s*break-inside:\s*avoid/.test(css), true);

const sheetSource = readFileSync('src/components/PrintableTraining.jsx', 'utf8');
check('the sheet is portalled out of the app tree', /return createPortal\(/.test(sheetSource), true);
check('into <body>, where the stylesheet expects it', /document\.body\s*\)/.test(sheetSource), true);
check('and marked as the printable sheet', /className="print-sheet/.test(sheetSource), true);
check('it prints itself', /window\.print\(\)/.test(sheetSource), true);
check('and reports back when the browser is done', /addEventListener\('afterprint'/.test(sheetSource), true);
// A sheet that never unmounts leaves the app hidden for the rest of the session.
check('with a safety net if afterprint never fires', /setTimeout\(finish, 30000\)/.test(sheetSource), true);

// The props contract: a prop used but not destructured is a ReferenceError at print time, which is the
// worst moment to discover it.
const propsBlock = /export default function PrintableTraining\(\{([\s\S]*?)\n\}\) \{/.exec(sheetSource)?.[1] || '';
check('the props block was found', propsBlock.length > 0, true);
for (const prop of ['mode', 'departmentName', 'memberName', 'rows', 'filters', 'sort', 'training', 'signatures', 'users', 'onDone']) {
  check(`the sheet destructures ${prop}`, new RegExp(`(^|[\\s,{])${prop}(\\s*=|\\s*[,}])`).test(propsBlock), true);
}

// The two bodies, and the line that makes the list sheet usable as an attendance record.
check('the list prints the columns', /PRINT_TRAINING_COLUMNS\.map/.test(sheetSource), true);
check('and who signed each training', /Signed by: \$\{row\.signers\.join/.test(sheetSource), true);
check('saying so when nobody has', /Nobody has signed this training yet/.test(sheetSource), true);
check('the detail prints the narrative', /detail\.narrative/.test(sheetSource), true);
check('and the categories in full', /detail\.categories\.join/.test(sheetSource), true);

console.log('\n--- the two buttons in the report ---');
const tab = readFileSync('src/components/admin/AdminTrainingTab.jsx', 'utf8');
check('the report offers to print the list', /setPrinting\(\{ mode: 'list' \}\)/.test(tab), true);
check('with nothing to print, the button is off', /disabled=\{rows\.length === 0\}/.test(tab), true);
check('each training offers its own record', /setPrinting\(\{ mode: 'training', training \}\)/.test(tab), true);
// Printing a locked training has to stay possible: it is the record most likely to be wanted on paper. The
// button is located first, then asserted to carry no disabled attribute - a lock check anywhere near it is
// the bug, and this is the only way to say so without matching the Edit and Delete buttons beside it.
const rowPrintButton =
  /onClick=\{\(\) => setPrinting\(\{ mode: 'training', training \}\)\}[\s\S]{0,700}?<\/button>/.exec(tab)?.[0] || '';
check('the row print button was found', rowPrintButton.length > 0, true);
checkIs('and a locked training can still be printed', !/disabled=/.test(rowPrintButton), 'an external-system record is exactly the one to keep a copy of');
check('the sheet is mounted only while printing', /\{printing && \(/.test(tab), true);

// The requirement, asserted against the call: the sheet is given the rows the TABLE is showing. Handed
// `allRows` it would print the whole sheet under a filtered heading - the failure worth guarding. (The filter
// bar legitimately takes allRows itself, for its location options, so this looks inside the sheet's own props.)
const sheetCall = /<PrintableTraining[\s\S]*?\/>/.exec(tab)?.[0] || '';
check('the sheet was found in the tab', sheetCall.length > 0, true);
check('the sheet is given the filtered rows, not every training', /rows=\{rows\}/.test(sheetCall), true);
checkIs('and not the unfiltered list', !/allRows/.test(sheetCall), 'rows is the filtered, sorted list');
check('with the filters that produced them', /filters=\{filters\}/.test(sheetCall) && /sort=\{sort\}/.test(sheetCall), true);
check('the station name for the header', /departmentName=\{departmentName\}/.test(sheetCall), true);
check('and who is printing it', /memberName=\{printedByName\}/.test(sheetCall), true);

// Without these two from the panel, the header would print "Fire Department" for everyone and claim nobody
// printed it.
const panel = readFileSync('src/components/admin/AdminPanel.jsx', 'utf8');
check('the panel passes the station name through', /departmentName=\{departmentName\}/.test(panel), true);
check('and the current user id, for the name', /currentUserId=\{currentUserId\}/.test(panel), true);

// The member module prints nothing: this was asked for on the administration report only.
const memberModule = readFileSync('src/components/TrainingModule.jsx', 'utf8');
checkIs('the member module is untouched', !/PrintableTraining/.test(memberModule), 'the print options sit on the admin report');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

