// Verifies the availability derivation (utils/availability).
//
// Availability is a list of recurring WINDOWS (a nickname, hours, and the days of the week the window runs on) and, per
// member, the days they claimed one - stored as one document per member per MONTH. Both availability screens are derived
// entirely from these functions, so a mistake here either shows a window on the wrong day or shows nobody as available
// for a shift somebody did mark.
//
// The cases that matter are the ones that make the two screens disagree with reality: the midnight crossing (a Tuesday
// night belongs to Tuesday, not to the Wednesday morning it runs into), a retired or not-yet-effective configuration
// leaking into a month, and the month documents themselves - the flattening, and the claims map a save writes back.
//
// Run with: npm run verify:availability-slots
import {
  availabilityKey,
  availabilityMonthId,
  availableMembersForWindow,
  claimRowsFromMonths,
  claimedKeysFor,
  claimsMapFromKeys,
  isAvailableForWindow,
  memberDayKeys,
  monthKeyOf,
  monthKeysBetween,
  windowCoversDate,
  windowDaysForMonth,
  windowIsLiveOn,
  windowsOnDate,
} from '../src/utils/availability.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` -> ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`}`
  );
};

// ---------------------------------------------------------------------------------------------------------------
// availability windows: which days a recurring pattern falls on.
//
// The cases that matter here are the ones that make a window appear on the wrong day or vanish from a week it applies
// to. Top of the list is the midnight crossing: a window ticked for Tuesday and running 18:00-08:00 is a Tuesday night,
// so it belongs to Tuesday and its pill must NOT appear on the Wednesday morning it ends on.

console.log('\n--- a window is live between its dates, and the weekdays are when it starts ---');
const tuesdayNight = {
  id: 'aw1',
  nickname: 'Tuesday night',
  start_time: '18:00',
  end_time: '08:00',
  is_tuesday: true,
  effective_date: '2026-01-01',
  end_date: '',
};
// 2026-09-01 is a Tuesday; 2026-09-02 the Wednesday it runs into.
check('a Tuesday night falls on a Tuesday', windowCoversDate(tuesdayNight, '2026-09-01'), true);
check('and NOT on the Wednesday morning it ends on', windowCoversDate(tuesdayNight, '2026-09-02'), false);
check('nor on any other weekday', ['2026-08-31', '2026-09-03', '2026-09-04'].map((d) => windowCoversDate(tuesdayNight, d)), [false, false, false]);
check('before its effective date it does not apply', windowCoversDate(tuesdayNight, '2025-12-30'), false);
check('on the effective date it does', windowCoversDate(tuesdayNight, '2026-01-06'), true);
check('an end date is inclusive', windowCoversDate({ ...tuesdayNight, end_date: '2026-09-01' }, '2026-09-01'), true);
check('and stops the week after', windowCoversDate({ ...tuesdayNight, end_date: '2026-09-01' }, '2026-09-08'), false);
check('blank dates mean always in force', windowIsLiveOn({}, '2026-09-01'), true);
check('a window with no day flags covers nothing', windowCoversDate({ ...tuesdayNight, is_tuesday: false }, '2026-09-01'), false);
check('sheet-style TRUE is a ticked day', windowCoversDate({ ...tuesdayNight, is_tuesday: 'TRUE' }, '2026-09-01'), true);
check('and a missing day field is not', windowCoversDate({ start_time: '08:00' }, '2026-09-01'), false);

console.log('\n--- the windows a day lists, earliest first ---');
const saturdayDay = { id: 'aw2', nickname: 'Saturday day', start_time: '08:00', end_time: '18:00', is_saturday: true, effective_date: '2026-01-01', end_date: '' };
const retired = { id: 'aw3', nickname: 'Old pattern', start_time: '06:00', end_time: '14:00', is_tuesday: true, effective_date: '2024-01-01', end_date: '2024-12-31' };
const notYet = { id: 'aw4', nickname: 'Next year', start_time: '08:00', end_time: '18:00', is_tuesday: true, effective_date: '2027-01-01', end_date: '' };
const windows = [saturdayDay, tuesdayNight, retired, notYet];
check('a Tuesday in force lists only the Tuesday window', windowsOnDate(windows, '2026-09-01').map((w) => w.id), ['aw1']);
// A retired configuration: in force INSIDE its life, absent after it. Both halves matter - the first is why old claims
// still read, the second is what "retired" means.
check('a retired configuration still applies inside its life', windowsOnDate(windows, '2024-06-04').map((w) => w.id), ['aw3']);
check('and lists nothing after its end date', windowsOnDate(windows, '2025-06-03').map((w) => w.id), []);
check('a window that has not taken effect yet lists nothing', windowsOnDate(windows, '2026-09-01').map((w) => w.id), ['aw1']);
check('and applies on its own first Tuesday', windowsOnDate(windows, '2027-06-01').map((w) => w.id), ['aw4', 'aw1']);
check('a Saturday lists the Saturday window', windowsOnDate(windows, '2026-09-05').map((w) => w.id), ['aw2']);
check('two windows on one day run earliest first', windowsOnDate([
  { ...tuesdayNight, id: 'late', start_time: '20:00' },
  { ...tuesdayNight, id: 'early', start_time: '06:00' },
], '2026-09-01').map((w) => w.id), ['early', 'late']);
check('a window with no usable start time sorts last', windowsOnDate([
  { ...tuesdayNight, id: 'timed', start_time: '18:00' },
  { ...tuesdayNight, id: 'untimed', start_time: '' },
], '2026-09-01').map((w) => w.id), ['timed', 'untimed']);
check('an empty list is no windows', windowsOnDate(undefined, '2026-09-01').length, 0);

console.log('\n--- claims, and who made them ---');
const claims = [
  { id: 'c1', user_id: 'u2', availability_window_id: 'aw1', date_from: '2026-09-01' },
  { id: 'c2', user_id: 'u1', availability_window_id: 'aw1', date_from: '2026-09-01' },
  { id: 'c3', user_id: 'u2', availability_window_id: 'aw2', date_from: '2026-09-05' },
  { id: 'c4', user_id: 'u2', availability_window_id: 'aw3', date_from: '2024-06-03' },
  { id: 'c5', user_id: 'u9', availability_window_id: 'aw1', date_from: '2026-09-01' },
];
const directory = [
  { id: 'u1', name: 'Zoe', rank_id: 'k1' },
  { id: 'u2', name: 'Abe', rank_id: 'k2' },
  { id: 'u3', name: 'Nobody' },
];
check('the claims for one window and day, in name order', availableMembersForWindow(claims, 'aw1', '2026-09-01', directory).map((m) => m.name), ['Abe', 'Unnamed member', 'Zoe']);
check('a member missing from the directory is labeled rather than dropped', availableMembersForWindow(claims, 'aw1', '2026-09-01', directory).map((m) => m.id), ['u2', 'u9', 'u1']);
check('the rank travels with the name', availableMembersForWindow(claims, 'aw1', '2026-09-01', directory).map((m) => m.rank_id), ['k2', '', 'k1']);
check('a different day is a different answer', availableMembersForWindow(claims, 'aw1', '2026-09-08', directory), []);
check('claims for another window are not counted', availableMembersForWindow(claims, 'aw2', '2026-09-05', directory).map((m) => m.id), ['u2']);
check('one member cannot appear twice for the same window and day', availableMembersForWindow([...claims, { id: 'c6', user_id: 'u2', availability_window_id: 'aw1', date_from: '2026-09-01' }], 'aw1', '2026-09-01', directory).length, 3);
check('a claim needs a window id', availableMembersForWindow([{ id: 'x', user_id: 'u2', date_from: '2026-09-01' }], 'aw1', '2026-09-01', directory), []);
check('a template-keyed row is not a window claim', availableMembersForWindow([{ id: 'y', user_id: 'u2', schedule_template_id: 't1', date_from: '2026-09-01' }], 'aw1', '2026-09-01', directory), []);
check('one member has claimed this window and day', isAvailableForWindow(claims, 'u2', 'aw1', '2026-09-01'), true);
check('and has not claimed the next one', isAvailableForWindow(claims, 'u2', 'aw1', '2026-09-08'), false);
check('claimed keys are window|day', [...claimedKeysFor(claims, 'u2')].sort(), ['aw1|2026-09-01', 'aw2|2026-09-05', 'aw3|2024-06-03']);
check('somebody with no claims has no keys', claimedKeysFor(claims, 'u7').size, 0);

console.log('\n--- a month, derived once for both screens ---');
const month = windowDaysForMonth({ year: 2026, month: 8, windows, availability: claims, users: directory });
check('only days with a window appear', month.map((d) => d.dateKey), ['2026-09-01', '2026-09-05', '2026-09-08', '2026-09-12', '2026-09-15', '2026-09-19', '2026-09-22', '2026-09-26', '2026-09-29']);
check('each Tuesday carries the Tuesday window', month[0].windows.map((w) => w.id), ['aw1']);
check('with the members who claimed it', month[0].windows[0].claimed.map((m) => m.name), ['Abe', 'Unnamed member', 'Zoe']);
check('a Tuesday nobody claimed still lists the window', month[2].windows[0].claimed, []);
check('the retired configuration is absent from the month', month.some((d) => d.windows.some((w) => w.id === 'aw3')), false);
check('and the one not yet in force is too', month.some((d) => d.windows.some((w) => w.id === 'aw4')), false);
check('a month with no windows at all is empty', windowDaysForMonth({ year: 2026, month: 8, windows: [] }), []);

// ---------------------------------------------------------------------------------------------------------------
// the month documents: the flattening, and the claims map a save writes back.
//
// A claim is stored as one document per member per month, so a "row" is now DERIVED - which is why its id is `window|day`
// and not a database id. The two directions tested here are the ones the screens depend on: months -> rows at sign-in and
// for the roster, and the grid's keys -> the map that gets written on Save.

console.log('\n--- a month document flattens to the rows the screens work in ---');
const monthDocs = [
  { user_id: 'u2', month: '2026-09', claims: { aw1: ['2026-09-01', '2026-09-08'], aw2: ['2026-09-05'] } },
  { user_id: 'u1', month: '2024-06', claims: { aw3: ['2024-06-03'] } },
];
const flatRows = claimRowsFromMonths(monthDocs);
check('a row id is window|day, derived rather than stored', availabilityKey('aw1', '2026-09-01'), 'aw1|2026-09-01');
check('one row per claimed day', flatRows.map((row) => row.id).sort(), [
  'aw1|2026-09-01',
  'aw1|2026-09-08',
  'aw2|2026-09-05',
  'aw3|2024-06-03',
]);
check('each row carries the member who claimed it', flatRows.filter((row) => row.user_id === 'u2').length, 3);
check('a document with no claims contributes nothing', claimRowsFromMonths([{ user_id: 'u9', month: '2026-09' }]), []);
check('and no documents at all is safe', claimRowsFromMonths(undefined), []);
check('the id carries the owner, which is what a rule reads', availabilityMonthId('u2', '2026-09'), 'u2_2026-09');

console.log('\n--- and the map a save writes back ---');
// The round trip the calendar depends on: the keys its grid holds become the month document that replaces the old one.
check('the grid keys round-trip into the claims map', claimsMapFromKeys(new Set(flatRows.map((row) => row.id))), {
  aw1: ['2026-09-01', '2026-09-08'],
  aw2: ['2026-09-05'],
  aw3: ['2024-06-03'],
});
check('days within a window are sorted, so a save is deterministic', claimsMapFromKeys(['aw2|2026-09-09', 'aw2|2026-09-02']), {
  aw2: ['2026-09-02', '2026-09-09'],
});
check('an empty grid writes an empty map - which is how un-marking works', claimsMapFromKeys(new Set()), {});
check('a malformed key is skipped rather than written', claimsMapFromKeys(['aw1', '|2026-09-01', 'aw1|']), {});
check('a date key maps to its month', monthKeyOf('2026-09-01'), '2026-09');
check('and an unusable one to no month at all', monthKeyOf(''), '');
check('a range spans every month it touches', monthKeysBetween('2026-11-15', '2027-02-02'), [
  '2026-11',
  '2026-12',
  '2027-01',
  '2027-02',
]);
check('a range inside one month is that month', monthKeysBetween('2026-09-02', '2026-09-28'), ['2026-09']);
check('a backwards range is empty rather than invented', monthKeysBetween('2026-09-01', '2026-08-01'), []);

console.log('\n--- the day keys the schedule board warns on ---');
check('the warning reads user|day, because a window does not name a shift', [...memberDayKeys(flatRows)].sort(), [
  'u1|2024-06-03',
  'u2|2026-09-01',
  'u2|2026-09-05',
  'u2|2026-09-08',
]);
check('a day with two claims is one key', memberDayKeys([{ user_id: 'u2', date_from: '2026-09-01' }, { user_id: 'u2', date_from: '2026-09-01' }]).size, 1);
check('nothing claimed is no keys', memberDayKeys([]).size, 0);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
