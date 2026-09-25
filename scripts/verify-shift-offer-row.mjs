// Verifies the pending-approvals row derivation (utils/shiftOfferRow).
//
// The shared date/time helpers are easy to get subtly wrong - this is what
// caught displayDate() interpolating its weekday ARRAY instead of indexing it
// (which blanked the date column), and it pins the "Working With" rule that
// co-workers are decided by OVERLAPPING HOURS, not by a shared assignment.
//
// Run with: npm run verify:offer-row
import { describeShiftOffer, isPendingOffer, pendingOffersOnly } from '../src/utils/shiftOfferRow.js';
import {
  DEFAULT_OFFER_SORT,
  OFFER_SORT_OPTIONS,
  filterAndSortOffers,
  offerFilterOptions,
} from '../src/utils/shiftOfferRow.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};

const assignments = [
  // a-ff3 carries an optional icon (Administration → Assignments), which the approvals
  // table draws beside the assignment name.
  { id: 'a-ff3', description: 'Firefighter 3', icon: 'flame' },
  { id: 'a-drv', description: 'Driver/Operator', icon: '   ' },
  { id: 'a-off', description: 'Officer' },
  { id: 'a-eng', description: 'Engine 1' },
];

// Templates are the shift definitions; a shift's hours normally live here.
const templates = [
  { id: 't-ff3', day_of_week: 'wednesday', start_time: '08:00', end_time: '18:00', assignment_id: 'a-ff3' },
  { id: 't-drv', day_of_week: 'wednesday', start_time: '08:00', end_time: '18:00', assignment_id: 'a-drv' },
  { id: 't-off', day_of_week: 'wednesday', start_time: '08:00', end_time: '18:00', assignment_id: 'a-off' },
  { id: 't-early', day_of_week: 'wednesday', start_time: '04:00', end_time: '07:00', assignment_id: 'a-eng' },
  { id: 't-night', day_of_week: 'wednesday', start_time: '20:00', end_time: '04:00', assignment_id: 'a-eng' },
  { id: 't-overlap', day_of_week: 'wednesday', start_time: '14:00', end_time: '22:00', assignment_id: 'a-eng' },
  { id: 't-notimes', day_of_week: 'wednesday', start_time: '', end_time: '', assignment_id: 'a-eng' },
];

const users = {
  'u-matt': 'Matt Wills',
  'u-member1': 'Member 1',
  'u-member2': 'Member 2',
  'u-early': 'Early Riser',
  'u-night': 'Night Owl',
  'u-late': 'Late Shift',
};
const userName = (id) => users[id] || id;

const DATE = '2026-09-16';

// The offer under test: a template occurrence (no schedule_id), with the date
// arriving as a raw sheet value so the parsing fallback is exercised too.
const offer = {
  id: 'o-1',
  user_id: 'u-matt',
  schedule_id: '',
  schedule_template_id: 't-ff3',
  assignment_id: 'a-ff3',
  date_from: '2026-09-16T04:00:00.000Z',
  date_to: '2026-09-16T04:00:00.000Z',
  date_key: DATE,
  date_to_key: DATE,
  approved_by: '',
  declined_by: '',
};

const schedule = [
  { id: 's-member1', schedule_template_id: 't-drv', date_from: DATE, date_to: DATE, user_id: 'u-member1' },
  { id: 's-member2', schedule_template_id: 't-off', date_from: DATE, date_to: DATE, user_id: 'u-member2' },
  // Different hours - not working with.
  { id: 's-early', schedule_template_id: 't-early', date_from: DATE, date_to: DATE, user_id: 'u-early' },
  // Overnight window that does not reach the 08:00-18:00 shift.
  { id: 's-night', schedule_template_id: 't-night', date_from: DATE, date_to: DATE, user_id: 'u-night' },
  // Partially overlapping (14:00-22:00) - IS working with.
  { id: 's-late', schedule_template_id: 't-overlap', date_from: DATE, date_to: DATE, user_id: 'u-late' },
  // Same shift, different day - not working with.
  { id: 's-otherday', schedule_template_id: 't-drv', date_from: '2026-09-17', date_to: '2026-09-17', user_id: 'u-member1' },
  // Unfilled row - nobody to name.
  { id: 's-open', schedule_template_id: 't-drv', date_from: DATE, date_to: DATE, user_id: '' },
  // The offerer themselves - excluded.
  { id: 's-me', schedule_template_id: 't-ff3', date_from: DATE, date_to: DATE, user_id: 'u-matt' },
];

const ctx = { schedule, scheduleTemplates: templates, assignments, userName };
const line = (c) => `${c.name} (${c.assignmentName}) ${c.timeLabel}`;

console.log('--- the reported case: different assignments, same hours ---');
const row = describeShiftOffer(offer, ctx);
row.coworkers.forEach((c) => console.log('  - ' + line(c)));
console.log();

check('coworker count', row.coworkers.length, 3);
check('listed in start-time order with assignment and hours',
  row.coworkers.map(line),
  [
    'Member 1 (Driver/Operator) 8:00 AM – 6:00 PM',
    'Member 2 (Officer) 8:00 AM – 6:00 PM',
    'Late Shift (Engine 1) 2:00 PM – 10:00 PM',
  ]);
check('non-overlapping shifts excluded',
  row.coworkers.some((c) => c.userId === 'u-early' || c.userId === 'u-night'), false);
check('the offerer is not their own coworker',
  row.coworkers.some((c) => c.userId === 'u-matt'), false);

console.log('\n--- 24-hour preference (time_format = 24) ---');
const row24 = describeShiftOffer(offer, { ...ctx, timeFormat: '24' });
check('own shift window in 24h', row24.timeLabel, '08:00 – 18:00');
check('coworker hours in 24h', row24.coworkers.map(line), [
  'Member 1 (Driver/Operator) 08:00 – 18:00',
  'Member 2 (Officer) 08:00 – 18:00',
  'Late Shift (Engine 1) 14:00 – 22:00',
]);

console.log('\n--- date handling ---');
check('dateLabel is "Wed, Sep 16"', row.dateLabel, 'Wed, Sep 16');
const noKeys = describeShiftOffer({ ...offer, date_key: '', date_to_key: '' }, ctx);
check('date parsed from the raw ISO sheet value', noKeys.dateLabel, 'Wed, Sep 16');

console.log('\n--- offer against an existing (unfilled) row: schedule_id set, no template on offer ---');
// resolveOpenShift only ever returns a row that is still unfilled, so the row an
// offer points at has a blank user_id. Anyone else listed on that shift at that
// time is a genuine co-worker.
const rowOffer = describeShiftOffer(
  { ...offer, schedule_template_id: '', schedule_id: 's-open', date_key: '', date_to_key: '' },
  ctx
);
check('template resolved from the linked row', rowOffer.templateId, 't-drv');
check('time resolved from the linked row’s template', rowOffer.timeLabel, '8:00 AM – 6:00 PM');
check('date still resolved without the date keys', rowOffer.dateLabel, 'Wed, Sep 16');
check('the offerer is still excluded',
  rowOffer.coworkers.some((c) => c.userId === 'u-matt'), false);
check('others on the shift are listed', rowOffer.coworkers.length, 3);

console.log('\n--- fallback when hours are missing on both sides ---');
const noTimes = describeShiftOffer(
  { ...offer, schedule_template_id: 't-notimes' },
  {
    ...ctx,
    schedule: [{ id: 's-nt', schedule_template_id: 't-notimes', date_from: DATE, date_to: DATE, user_id: 'u-late' }],
  }
);
check('same shift definition still counts as working together', noTimes.coworkers.length, 1);
check('with no hours to display', noTimes.coworkers[0]?.timeLabel, '');

console.log('\n--- nobody else on shift ---');
check('coworkers empty', describeShiftOffer(offer, { ...ctx, schedule: [] }).coworkers, []);

// Regression: the approvals table showed decided offers after any refresh,
// because the refresh paths assigned the raw fetch result (every offer) into
// the state the table renders. The backend derives status from the same two
// columns, so both sides must agree.
console.log('\n--- only undecided offers belong in the queue ---');
const mixed = [
  { id: 'p1', approved_by: '', declined_by: '' },
  { id: 'p2', approved_by: '1', declined_by: '' },
  { id: 'p3', approved_by: '', declined_by: '2' },
  { id: 'p4', approved_by: '1', declined_by: '2' },
  // Whitespace is not a decision (the backend trims).
  { id: 'p5', approved_by: '   ', declined_by: '' },
  // Derived status wins when present.
  { id: 'p6', status: 'approved', approved_by: '1', declined_by: '' },
  { id: 'p7', status: 'declined', approved_by: '', declined_by: '2' },
  { id: 'p8', status: 'pending', approved_by: '', declined_by: '' },
  { id: 'p9', status: 'pending', approved_by: 'stale', declined_by: '' },
];

check('pending offers only',
  pendingOffersOnly(mixed).map((o) => o.id),
  ['p1', 'p5', 'p8', 'p9']);
check('approved is not pending', isPendingOffer({ approved_by: '1', declined_by: '' }), false);
check('declined is not pending', isPendingOffer({ approved_by: '', declined_by: '2' }), false);
check('untouched offer is pending', isPendingOffer({ approved_by: '', declined_by: '' }), true);
check('whitespace-only approver is not a decision',
  isPendingOffer({ approved_by: '   ', declined_by: '' }), true);
check('non-array input is safe', pendingOffersOnly(undefined), []);
check('null entries are dropped', pendingOffersOnly([null, { approved_by: '', declined_by: '' }]).length, 1);

console.log('--- the assignment icon rides along, and reads as none when blank ---');
check('the offer icon is the assignment icon', row.assignmentIcon, 'flame');
// A whitespace-only column must behave like no column at all.
check(
  'a whitespace-only icon reads as none',
  describeShiftOffer({ ...offer, assignment_id: 'a-drv' }, ctx).assignmentIcon,
  ''
);
check(
  'a missing icon column reads as none',
  describeShiftOffer({ ...offer, assignment_id: 'a-off' }, ctx).assignmentIcon,
  ''
);

// --- filtering and sorting the queue ---------------------------------------
//
// The rows are { offer, shift, memberId, memberName }, which is what the tab builds. Sorts work off
// the described shift (real date keys and start minutes), not the display strings - comparing
// "10:00 AM" to "8:00 AM" as text would put ten o'clock first.

const rowsFor = (specs) =>
  specs.map(({ id, userId, name, dateKey, startMin, assignmentId, assignmentName }) => ({
    offer: { id, user_id: userId },
    shift: { dateKey, startMin, assignmentId, assignmentName },
    memberId: String(userId),
    memberName: name,
  }));

const QUEUE = rowsFor([
  { id: 'o1', userId: 'u2', name: 'Member 2', dateKey: '2026-03-20', startMin: 480, assignmentId: 'a1', assignmentName: 'Engine 1' },
  { id: 'o2', userId: 'u1', name: 'Member 1', dateKey: '2026-03-10', startMin: 1080, assignmentId: 'a2', assignmentName: 'Ladder 2' },
  { id: 'o3', userId: 'u1', name: 'Member 1', dateKey: '2026-03-10', startMin: 480, assignmentId: 'a1', assignmentName: 'Engine 1' },
  { id: 'o4', userId: 'u3', name: 'Member 6', dateKey: '', startMin: null, assignmentId: '', assignmentName: '' },
]);

console.log('\n--- sorting ---');
check('ascending by date is the default', DEFAULT_OFFER_SORT, 'date_asc');
check('and it is one of the offered sorts', OFFER_SORT_OPTIONS.some((o) => o.value === 'date_asc'), true);
check('every sort has a label', OFFER_SORT_OPTIONS.every((o) => o.value && o.label), true);

const byDateAsc = filterAndSortOffers(QUEUE, { sort: 'date_asc' }).map((r) => r.offer.id);
check('soonest shift first', byDateAsc, ['o3', 'o2', 'o1', 'o4']);
check('the same day is ordered by start time', byDateAsc.slice(0, 2), ['o3', 'o2']);
// A shift with no readable date is not the earliest one; it goes last rather than to the top.
check('an undated offer sorts last', byDateAsc[3], 'o4');
check('the default sort is applied when none is given', filterAndSortOffers(QUEUE).map((r) => r.offer.id), byDateAsc);

const byDateDesc = filterAndSortOffers(QUEUE, { sort: 'date_desc' }).map((r) => r.offer.id);
check('latest first', byDateDesc.slice(0, 3), ['o1', 'o3', 'o2']);
check('and the undated one is still last, not first', byDateDesc[3], 'o4');
check('within a day it is still time order', byDateDesc.slice(1, 3), ['o3', 'o2']);

check(
  'by member',
  filterAndSortOffers(QUEUE, { sort: 'member_asc' }).map((r) => r.offer.id),
  ['o3', 'o2', 'o1', 'o4']
);
check(
  'by assignment, with a blank one last',
  filterAndSortOffers(QUEUE, { sort: 'assignment_asc' }).map((r) => r.offer.id),
  ['o3', 'o1', 'o2', 'o4']
);
// The sort must not reorder the caller's array - the tab derives rows with useMemo.
const original = QUEUE.map((r) => r.offer.id);
filterAndSortOffers(QUEUE, { sort: 'date_desc' });
check('the input array is not mutated', QUEUE.map((r) => r.offer.id), original);

console.log('\n--- filtering ---');
check('no filter keeps everything', filterAndSortOffers(QUEUE, {}).length, 4);
check('by member', filterAndSortOffers(QUEUE, { member: 'u1' }).map((r) => r.offer.id), ['o3', 'o2']);
check('by assignment', filterAndSortOffers(QUEUE, { assignment: 'a1' }).map((r) => r.offer.id), ['o3', 'o1']);
check('both together', filterAndSortOffers(QUEUE, { member: 'u2', assignment: 'a1' }).map((r) => r.offer.id), ['o1']);
check('a member with no offers yields nothing', filterAndSortOffers(QUEUE, { member: 'u9' }), []);
check('the two filters must both match', filterAndSortOffers(QUEUE, { member: 'u2', assignment: 'a2' }), []);
check('filtering keeps the sort order', filterAndSortOffers(QUEUE, { member: 'u1', sort: 'date_desc' }).map((r) => r.offer.id), ['o3', 'o2']);
// The tab compares string ids, so a numeric id in the data must still match.
check('ids are compared as text', filterAndSortOffers(rowsFor([{ id: 'o5', userId: 7, name: 'X', dateKey: '2026-01-01' }]), { member: '7' }).length, 1);

console.log('\n--- the filter options come from the queue ---');
const options = offerFilterOptions(QUEUE);
check('members with offers only, by name', options.members, [
  { value: 'u1', label: 'Member 1' },
  { value: 'u2', label: 'Member 2' },
  { value: 'u3', label: 'Member 6' },
]);
check('assignments seen, by name', options.assignments, [
  { value: 'a1', label: 'Engine 1' },
  { value: 'a2', label: 'Ladder 2' },
]);
// A row with no assignment would otherwise offer a blank option that filters everything out.
check('a blank assignment is not an option', options.assignments.some((o) => !o.value), false);
check('nor is a blank member', options.members.some((o) => !o.value), false);
check('an empty queue has no options', offerFilterOptions([]), { members: [], assignments: [] });
check('a non-array is safe', offerFilterOptions(undefined), { members: [], assignments: [] });
check('null rows are skipped', offerFilterOptions([null, ...QUEUE]).members.length, 3);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);