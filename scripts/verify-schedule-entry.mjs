// Verifies the bulk-save entry normalization in Code.gs.
//
// This exists because of a specific silent failure: the schedule save used to
// require BOTH a date and a user_id, so an admin adding a shift with no member
// ("create it as Open") had the entry dropped while the save still reported
// success. Nothing in the UI could show that - the row simply never appeared.
//
// The function under test is extracted from the real backend file, so this covers
// the code that ships.
//
// Run with: npm run verify:schedule-entry
import fs from 'node:fs';
import path from 'node:path';

const CODE_GS = path.resolve(process.cwd(), 'src/services/Code.gs');

const extractFunction = (source, name) => {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`Could not find ${name} in Code.gs`);
  const end = source.indexOf('\n}\n', start);
  if (end === -1) throw new Error(`Could not find the end of ${name} in Code.gs`);
  const block = source.slice(start, end + 3);
  const build = new Function(`${block}\nreturn ${name};`);
  return build();
};

const normalizeScheduleEntry = extractFunction(fs.readFileSync(CODE_GS, 'utf8'), 'normalizeScheduleEntry');

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

console.log('--- an open shift (no member) is stored, not skipped ---');
const openShift = normalizeScheduleEntry(
  {
    schedule_template_id: '',
    date_from: '2026-03-14',
    date_to: '2026-03-14',
    assignment_id: 'a-drv',
    user_id: ''
  },
  true
);
check('an entry with no member survives', openShift !== null, true);
check('its user_id is blank in the row', openShift?.user_id, '');
check('the rest of the row is kept', [openShift?.date_from, openShift?.date_to, openShift?.assignment_id], [
  '2026-03-14',
  '2026-03-14',
  'a-drv'
]);

console.log('\n--- an open CUSTOM shift keeps its window ---');
const openCustom = normalizeScheduleEntry(
  {
    schedule_template_id: '',
    date_from: '2026-03-14',
    date_to: '2026-03-14',
    start_time: '08:00',
    end_time: '18:00',
    assignment_id: 'a-drv',
    user_id: ''
  },
  true
);
check('window kept on an unassigned custom shift', [openCustom?.start_time, openCustom?.end_time], ['08:00', '18:00']);

console.log('\n--- a date is still required ---');
check('no date_from at all', normalizeScheduleEntry({ user_id: 'u-1' }, true), null);
check('empty date_from', normalizeScheduleEntry({ date_from: '', user_id: 'u-1' }, true), null);
check('blank entry', normalizeScheduleEntry({}, true), null);
check('null entry', normalizeScheduleEntry(null, true), null);
check('undefined entry', normalizeScheduleEntry(undefined, true), null);

console.log('\n--- a filled shift is unchanged ---');
const filled = normalizeScheduleEntry(
  { id: '12', schedule_template_id: 't-3', date_from: '2026-03-14', date_to: '2026-03-14', assignment_id: 'a-off', user_id: 'u-7' },
  true
);
check('id passed through', filled?.id, '12');
check('member kept', filled?.user_id, 'u-7');
check('template kept', filled?.schedule_template_id, 't-3');

console.log('\n--- values are coerced to strings, and missing ones become blank ---');
const coerced = normalizeScheduleEntry({ date_from: 20260314, user_id: 42, assignment_id: null }, true);
check('numbers become strings', [coerced?.date_from, coerced?.user_id], ['20260314', '42']);
check('null becomes an empty string', coerced?.assignment_id, '');
check('absent optional fields become empty strings', [coerced?.apparatus_id, coerced?.date_to], ['', '']);

console.log('\n--- older sheets without the time columns ---');
const noTimes = normalizeScheduleEntry({ date_from: '2026-03-14', user_id: '' }, false);
check('no time keys written at all', ['start_time' in noTimes, 'end_time' in noTimes], [false, false]);

console.log('\n--- blank/whitespace members both mean "open" ---');
check('a whitespace-only member becomes blank (open)', normalizeScheduleEntry({ date_from: '2026-03-14', user_id: '   ' }, true)?.user_id, '');
check('a space-padded member id is trimmed', normalizeScheduleEntry({ date_from: '2026-03-14', user_id: ' u-9 ' }, true)?.user_id, 'u-9');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
