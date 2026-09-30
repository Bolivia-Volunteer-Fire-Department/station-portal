// Verifies the availability derivation (utils/availability).
//
// Availability used to be a weekly whitelist of time windows. It is now a set of rows
// that mirror the schedule itself (member + template + date), and both availability
// screens are derived entirely from these functions - so a mistake here either shows the
// wrong shifts or shows nobody as available for a shift somebody did mark.
//
// The interesting cases are the ones that make the two screens disagree with reality:
// matching on the template but forgetting the date, counting a member twice for the same
// slot, and letting a rank-ineligible shift through.
//
// Run with: npm run verify:availability-slots
import {
  availabilityKey,
  availabilityRosterForMonth,
  availabilityRowsFor,
  availableMembersForSlot,
  availableMembersForWindow,
  availableSlotsForMonth,
  claimedKeysFor,
  isAvailableForSlot,
  isAvailableForWindow,
  slotsByDay,
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

console.log('--- fixtures ---');
// September 2026: the 1st is a TUESDAY, so the month holds 4 Mondays (7, 14, 21, 28)
// and 5 Tuesdays (1, 8, 15, 22, 29). The counts below depend on that, which is the point.
const ranks = [
  { id: 'k1', description: 'Firefighter', rank_order: 1 },
  { id: 'k3', description: 'Officer', rank_order: 3 },
];
const assignments = [
  { id: 'a-ff', description: 'Firefighter 3', rank_order_required: 1 },
  { id: 'a-off', description: 'Officer', rank_order_required: 3 },
  { id: 'a-any', description: 'Any rank' },
];
const templates = [
  { id: 't-mon-ff', day_of_week: 'monday', start_time: '08:00', end_time: '18:00', assignment_id: 'a-ff' },
  { id: 't-mon-off', day_of_week: 'monday', start_time: '18:00', end_time: '08:00', assignment_id: 'a-off' },
  { id: 't-tue-any', day_of_week: 'tuesday', start_time: '09:00', end_time: '17:00', assignment_id: 'a-any' },
];
const firefighter = { id: 'u1', name: 'Member 1', rank_id: 'k1', status: 'active' };
const officer = { id: 'u2', name: 'Member 3', rank_id: 'k3', status: 'active' };
const SEPT = { year: 2026, month: 8 };

console.log('\n--- which slots a member could fill ---');
const ffSlots = availableSlotsForMonth({ ...SEPT, templates, assignments, ranks, member: firefighter });
const offSlots = availableSlotsForMonth({ ...SEPT, templates, assignments, ranks, member: officer });
check('firefighter: the 4 eligible Monday shifts', ffSlots.filter((s) => s.templateId === 't-mon-ff').length, 4);
check('firefighter: the Officer shift is not offered', ffSlots.some((s) => s.templateId === 't-mon-off'), false);
check('firefighter: 4 Mondays + 5 Tuesdays', ffSlots.length, 9);
check('officer: gets both Monday shifts too', offSlots.length, 13);
check('slots run in date order, earliest first', ffSlots[0].dateKey, '2026-09-01');
check('a shift with no minimum rank is open to everyone', ffSlots.some((s) => s.templateId === 't-tue-any'), true);
check('every slot carries its assignment', ffSlots.every((s) => s.assignmentId), true);
check('slots without usable times still appear', availableSlotsForMonth({
  ...SEPT,
  templates: [{ id: 't-no-time', day_of_week: 'monday', assignment_id: 'a-any' }],
  assignments,
  ranks,
  member: firefighter,
}).length, 4);

console.log('\n--- who is excluded from "could fill" ---');
check('excluded from scheduling', availableSlotsForMonth({
  ...SEPT, templates, assignments, ranks,
  member: { ...firefighter, exclude_from_scheduling: 'TRUE' },
}).length, 0);
check('inactive member', availableSlotsForMonth({
  ...SEPT, templates, assignments, ranks,
  member: { ...firefighter, status: 'inactive' },
}).length, 0);
check('no member at all', availableSlotsForMonth({ ...SEPT, templates, assignments, ranks }).length, 0);
// A member whose rank cannot be placed still qualifies for shifts with no minimum
// rank - the same rule the schedule calendar applies, so the two stay in step.
check('unknown rank still qualifies for no-minimum shifts', availableSlotsForMonth({
  ...SEPT, templates, assignments, ranks, member: { ...firefighter, rank_id: 'missing' },
}).length, 5);
check('but not for the rank-gated ones', availableSlotsForMonth({
  ...SEPT, templates, assignments, ranks, member: { ...firefighter, rank_id: 'missing' },
}).every((s) => s.templateId === 't-tue-any'), true);

console.log('\n--- reading what has been marked ---');
const availability = [
  // u1 on the first Monday, stored the way the sheet stores it (text).
  { id: 1, schedule_template_id: 't-mon-ff', date_from: '2026-09-07', date_to: '2026-09-07', user_id: 'u1' },
  // u2 on the second Monday, stored as a real Date - the sheet returns either.
  { id: 2, schedule_template_id: 't-mon-ff', date_from: new Date(2026, 8, 14), date_to: new Date(2026, 8, 14), user_id: 'u2' },
  // The SAME member twice for the same slot (a hand edit could leave this).
  { id: 3, schedule_template_id: 't-mon-ff', date_from: '2026-09-07', user_id: 'u1' },
  // A member the users list does not know about.
  { id: 4, schedule_template_id: 't-mon-ff', date_from: '2026-09-07', user_id: 'u9' },
  // Right template, wrong date - must never count.
  { id: 5, schedule_template_id: 't-mon-ff', date_from: '2026-09-08', user_id: 'u2' },
  // Right date, wrong template.
  { id: 6, schedule_template_id: 't-mon-off', date_from: '2026-09-07', user_id: 'u2' },
  // No template id at all.
  { id: 7, date_from: '2026-09-07', user_id: 'u2' },
];
const users = [firefighter, officer];

check(
  'the date is part of the key, not just the template',
  isAvailableForSlot(availability, 'u1', 't-mon-ff', '2026-09-21'),
  false
);
check('a text date matches', isAvailableForSlot(availability, 'u1', 't-mon-ff', '2026-09-07'), true);
check('a Date value matches too', isAvailableForSlot(availability, 'u2', 't-mon-ff', '2026-09-14'), true);
check('a marker on another date does not leak', isAvailableForSlot(availability, 'u2', 't-mon-ff', '2026-09-07'), false);
check('a marker on another template does not leak', isAvailableForSlot(availability, 'u1', 't-mon-off', '2026-09-07'), false);
check('rows for one member only', availabilityRowsFor(availability, 'u1').length, 2);
check('a missing member id yields nothing', availabilityRowsFor(availability, '').length, 0);

console.log('\n--- who is available for one slot ---');
const mondaySlot = { templateId: 't-mon-ff', dateKey: '2026-09-07' };
const mondayMembers = availableMembersForSlot(availability, mondaySlot, users);
// The slot carries two members: a named one and one whose roster entry has no name, which renders as
// "Unnamed member". The sort is by name, so "Member 1" leads - the placeholder is not special-cased, and the point
// of the assertion is that the list is sorted by name and that a duplicate row collapses to one entry, which the
// single "Unnamed member" proves.
check('named in name order, duplicates collapsed', mondayMembers.map((m) => m.name), ['Member 1', 'Unnamed member']);
check('one entry per member', mondayMembers.length, 2);
check('a member who said nothing is absent', mondayMembers.some((m) => m.id === 'u2'), false);
check('the same slot on another date', availableMembersForSlot(availability, { ...mondaySlot, dateKey: '2026-09-14' }, users).map((m) => m.name), ['Member 3']);
check('an id missing from users still appears', availableMembersForSlot(availability, mondaySlot, []).length, 2);
check('a slot with no fields', availableMembersForSlot(availability, { templateId: '', dateKey: '' }, users), []);
check('an empty sheet is safe', availableMembersForSlot(undefined, mondaySlot, users), []);

console.log('\n--- the roster the administrator sees ---');
const roster = availabilityRosterForMonth({ ...SEPT, templates, availability, users });
const sept7 = roster.find((d) => d.dateKey === '2026-09-07');
const sept8 = roster.find((d) => d.dateKey === '2026-09-08');
const sept21 = roster.find((d) => d.dateKey === '2026-09-21');
check('every day with a template occurrence is listed', roster.length, 9);
check('both Monday shifts appear on the 7th', sept7.slots.map((s) => s.templateId), ['t-mon-ff', 't-mon-off']);
check('the marked shift carries its members', sept7.slots[0].members.map((m) => m.name), ['Member 1', 'Unnamed member']);
// The fixture marks the OTHER Monday shift for Member 3, which proves the roster keys on the
// template and not just the date.
check('so does the other shift that was marked', sept7.slots[1].members.map((m) => m.name), ['Member 3']);
check('a shift nobody marked says so rather than hiding', sept21.slots.map((s) => s.members.length), [0, 0]);
check('a Tuesday with nobody marked is still listed', sept8.slots[0].members, []);
check('the roster is in date order', roster.every((d, i) => i === 0 || roster[i - 1].dateKey < d.dateKey), true);

console.log('\n--- grid grouping ---');
const grouped = slotsByDay(ffSlots);
check('one entry per day that has slots', grouped.size, 9);
check('the first day holds one slot', grouped.get('2026-09-01').length, 1);
check('keys are template|date', availabilityKey('t1', '2026-09-07'), 't1|2026-09-07');
check('an empty list groups to nothing', slotsByDay(undefined).size, 0);

// ---------------------------------------------------------------------------------------------------------------
// availability windows: the model the two screens are moving onto.
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

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
