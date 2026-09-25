// Verifies where a shift is drawn in the calendar (utils/shiftPlacement).
//
// This pins a reported bug: an overnight OPEN shift appeared on both days it
// covered, so one vacancy looked like two - and a member could try to offer on a
// day the shift does not start. The rule is now "the day it starts, and only that
// day", for both the member calendar and the admin board.
//
// Run with: npm run verify:shift-placement
import { isShiftDay } from '../src/utils/shiftPlacement.js';

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

console.log('--- a plain one-day shift ---');
check('drawn on its own day', isShiftDay('2026-03-14', '2026-03-14'), true);
check('not drawn the day before', isShiftDay('2026-03-14', '2026-03-13'), false);
check('not drawn the day after', isShiftDay('2026-03-14', '2026-03-15'), false);

console.log('\n--- an overnight shift spanning two days appears EXACTLY once ---');
const overnightFrom = '2026-03-13'; // Friday 22:00 -> Saturday 04:00
const overnightTo = '2026-03-14';
const overnightDays = ['2026-03-12', '2026-03-13', '2026-03-14', '2026-03-15'];
check('appears on the start day only', overnightDays.filter((d) => isShiftDay(overnightFrom, d)), [
  overnightFrom
]);
check('the day it runs into is NOT a shift day', isShiftDay(overnightFrom, overnightTo), false);

console.log('\n--- a multi-day shift also appears on its start day only ---');
const multiFrom = '2026-03-14';
const multiTo = '2026-03-16';
const span = ['2026-03-13', '2026-03-14', '2026-03-15', '2026-03-16', '2026-03-17'];
check('exactly one day in the span matches', span.filter((d) => isShiftDay(multiFrom, d)), [multiFrom]);

console.log('\n--- every day of a month maps to at most one rendering per row ---');
const marchDays = Array.from({ length: 31 }, (_, i) => `2026-03-${String(i + 1).padStart(2, '0')}`);
check('31 days, one match', marchDays.filter((d) => isShiftDay('2026-03-09', d)).length, 1);

console.log('\n--- missing or malformed dates never claim a day ---');
check('blank from key', isShiftDay('', '2026-03-14'), false);
check('null from key', isShiftDay(null, '2026-03-14'), false);
check('undefined from key', isShiftDay(undefined, '2026-03-14'), false);
check('blank day key', isShiftDay('2026-03-14', ''), false);
check('null day key', isShiftDay('2026-03-14', null), false);
check('two blanks do not match each other', isShiftDay('', ''), false);
check('padded values still compare equal', isShiftDay(' 2026-03-14 ', '2026-03-14'), true);
check('a different month does not match', isShiftDay('2026-03-14', '2026-04-14'), false);
check('a different year does not match', isShiftDay('2026-03-14', '2025-03-14'), false);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
