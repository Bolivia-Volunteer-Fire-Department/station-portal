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
  availableSlotsForMonth,
  isAvailableForSlot,
  slotsByDay,
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
// "Member #<id>". The sort is by name, and "#" sorts before digits, so the unnamed member leads - an artifact of
// the placeholder, not a rule worth encoding. What the assertion is for is that the list is sorted by name and
// that a duplicate row collapses to one entry, which the single "Member #u9" proves.
check('named in name order, duplicates collapsed', mondayMembers.map((m) => m.name), ['Member #u9', 'Member 1']);
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
check('the marked shift carries its members', sept7.slots[0].members.map((m) => m.name), ['Member #u9', 'Member 1']);
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

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
