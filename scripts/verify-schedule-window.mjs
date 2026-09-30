// The schedule window: which months a load carries, and whether the month on screen is inside it.
//
// WHY THIS IS ITS OWN HARNESS. It decides how much of the ONE unbounded collection the app reads - and the two ways to
// get it wrong are opposites that both look like something else: too wide and every sign-in reads the station's history;
// too narrow, or mis-compared, and a screen shows an empty month instead of asking for it. The month boundaries are also
// where leap years and the December-to-January rollover live, which no amount of reading the code catches.
//
// Pure and dependency-free, so this needs no browser, no emulator and no Firebase.
//
// Run with: npm run verify:schedule-window
import { monthBoundsFor, monthKeyFor, scheduleWindowFor, windowCoversMonth } from '../src/utils/scheduleWindow.js';

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

console.log('--- the window is last month, this month and next ---');
check('from a day in March', scheduleWindowFor(new Date(2026, 2, 15)), { from: '2026-02-01', to: '2026-04-30' });
check('from the FIRST of a month', scheduleWindowFor(new Date(2026, 2, 1)), { from: '2026-02-01', to: '2026-04-30' });
check('from the LAST of a month', scheduleWindowFor(new Date(2026, 2, 31)), { from: '2026-02-01', to: '2026-04-30' });
check('and with no argument at all it is built from today', scheduleWindowFor(), scheduleWindowFor(new Date()));

console.log('\n--- across the year boundary, where a copy of this logic goes wrong ---');
check('January reaches back into the previous year', scheduleWindowFor(new Date(2026, 0, 10)), {
  from: '2025-12-01',
  to: '2026-02-28',
});
check('December reaches forward into the next', scheduleWindowFor(new Date(2026, 11, 20)), {
  from: '2026-11-01',
  to: '2027-01-31',
});

console.log('\n--- and the month it ends on is a real month ---');
check('February in a common year ends on the 28th', monthBoundsFor('2026-02'), { start: '2026-02-01', end: '2026-02-28' });
check('February in a leap year ends on the 29th', monthBoundsFor('2028-02'), { start: '2028-02-01', end: '2028-02-29' });
check('a 30-day month ends on the 30th', monthBoundsFor('2026-04'), { start: '2026-04-01', end: '2026-04-30' });
check('and a 31-day one on the 31st', monthBoundsFor('2026-01'), { start: '2026-01-01', end: '2026-01-31' });
check('nonsense is refused rather than guessed', monthBoundsFor('2026-13'), null);
check('as is a month that is not a month', monthBoundsFor('March'), null);
check('and nothing at all', monthBoundsFor(''), null);

console.log('\n--- the month key a screen asks about ---');
check('a date in March', monthKeyFor(new Date(2026, 2, 31)), '2026-03');
check('a date in January', monthKeyFor(new Date(2026, 0, 1)), '2026-01');

console.log('\n--- does the window cover the month on screen? ---');
const window = { from: '2026-02-01', to: '2026-04-30' };
check('the month in the middle is covered', windowCoversMonth(window, '2026-03'), true);
check('so is the first month it spans, exactly', windowCoversMonth(window, '2026-02'), true);
check('and the last, exactly', windowCoversMonth(window, '2026-04'), true);
check('one month before it is not', windowCoversMonth(window, '2026-01'), false);
check('one month after it is not', windowCoversMonth(window, '2026-05'), false);
// A window starting INSIDE the month is the case that would show a half-empty board rather than asking for the month.
check('a window that starts mid-month does NOT cover it', windowCoversMonth({ from: '2026-03-10', to: '2026-04-30' }, '2026-03'), false);
check('nor one that ends mid-month', windowCoversMonth({ from: '2026-02-01', to: '2026-03-20' }, '2026-03'), false);
check('a window of nothing covers nothing', windowCoversMonth({ from: '', to: '' }, '2026-03'), false);
check('and an absent window is not a licence to skip asking', windowCoversMonth(null, '2026-03'), false);
check('nor is an absent month', windowCoversMonth(window, ''), false);
checkIs('a window and a month from the same date always agree', windowCoversMonth(scheduleWindowFor(new Date(2026, 5, 10)), monthKeyFor(new Date(2026, 5, 1))));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
