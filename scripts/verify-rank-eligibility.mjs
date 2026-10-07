/**
 * Verifies who may be scheduled into an assignment, and the order they are listed in (utils/rankEligibility).
 *
 * The BUCKETS are the answer to "who can actually work this shift", and three screens render them directly:
 * the member picker on the schedule board, the quick-add dropdown, and the Eligible Members column on the
 * assignments table. Bucketing is therefore load-bearing, and this pins it:
 *
 *   - active, not excluded, rank_order >= the assignment's minimum -> eligible
 *   - a rank that is too low -> rankBlocked; a rank with no usable order -> unverifiable (NOT eligible -
 *     an unknown rank cannot satisfy a known minimum)
 *   - exclude_from_scheduling -> excluded, whatever their rank
 *   - any status other than "active" -> inactive
 *
 * THE ORDER IS THE OTHER HALF, and it is what this was added for. An officer reads these lists to find a
 * NAME, and the roster travels by id - so a list built in arrival order is sorted by a key nobody can see.
 * Each bucket is alphabetical, and the buckets stay in the order above, which is how every consumer puts
 * the non-schedulable members at the bottom just by listing them in that sequence.
 *
 * A sort of the INPUT instead of the buckets would have been the easy way to get the same visible result
 * and the wrong one: it would also reorder anything else that classifies the same roster. So the sort is
 * held to the buckets, and the input is checked to be untouched.
 *
 *   npm run verify:rank-eligibility
 */
import { eligibilityFor, memberCanFillAssignment, rankOrderOf } from '../src/utils/rankEligibility.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`
  );
};
const checkIs = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` -> ${detail}`}`);
};

const RANKS = [
  { id: 'k1', description: 'Firefighter', rank_order: 1 },
  { id: 'k2', description: 'Driver', rank_order: 2 },
  { id: 'k3', description: 'Officer', rank_order: 3 },
];

// Deliberately out of alphabetical order, so an unsorted bucket cannot pass by accident. The `id` values
// are in a different order again - a list sorted by id is a different list from one sorted by name, which
// is the whole point of the check.
//
// The ranks are spread on purpose: one per order among the members who are in the pool, so a required
// order of 2 splits them two-and-three rather than putting everybody on one side of it.
const USERS = [
  { id: '50', name: 'Zoe Anders', rank_id: 'k1' },
  { id: '12', name: 'Ralph Fike Jr', rank_id: 'k3' },
  { id: '31', name: 'amy brooks', rank_id: 'k1' },
  { id: '24', name: 'Cameron Rave', rank_id: 'k2' },
  { id: '43', name: 'Roo Lowrey', rank_id: 'k2' },
];

const names = (list) => list.map((u) => u.name);
const eligibleFor = (assignment) => eligibilityFor({ users: USERS, ranks: RANKS, assignment }).eligible;

console.log('\n--- who may fill an assignment ---');
// Order 2 required: the Officer (3) and both Drivers (2) qualify; the Firefighters (1) do not.
check(
  'a rank at or above the minimum qualifies, below it does not',
  names(eligibleFor({ rank_order_required: 2 })),
  ['Cameron Rave', 'Ralph Fike Jr', 'Roo Lowrey']
);
check(
  'no minimum on the assignment means everyone in the pool qualifies',
  names(eligibleFor({})),
  ['amy brooks', 'Cameron Rave', 'Ralph Fike Jr', 'Roo Lowrey', 'Zoe Anders']
);
check('the highest requirement admits only the top rank', names(eligibleFor({ rank_order_required: 3 })), ['Ralph Fike Jr']);

console.log('\n--- the buckets keep their own order, so non-schedulable can go below ---');
const mixed = eligibilityFor({
  users: [
    ...USERS,
    { id: '60', name: 'Bo Jones', rank_id: 'k1', exclude_from_scheduling: true },
    { id: '61', name: 'Cooper Kim', rank_id: 'k1', status: 'inactive' },
    { id: '62', name: 'No Rank Here', rank_id: 'k9' },
    { id: '63', name: 'Mia Novak', rank_id: 'k1' },
  ],
  ranks: RANKS,
  assignment: { rank_order_required: 2 },
});
check('eligible', names(mixed.eligible), ['Cameron Rave', 'Ralph Fike Jr', 'Roo Lowrey']);
check('rank too low', names(mixed.rankBlocked), ['amy brooks', 'Mia Novak', 'Zoe Anders']);
// A rank with no usable order CANNOT satisfy a known minimum, so it is unverifiable rather than eligible -
// and it is listed rather than hidden: an officer deciding by eye needs to see the member is there at all.
check('rank cannot be verified', names(mixed.unverifiable), ['No Rank Here']);
check('excluded from scheduling', names(mixed.excluded), ['Bo Jones']);
check('inactive', names(mixed.inactive), ['Cooper Kim']);
// This is the property the ordering exists for: listing the buckets in their declared order puts every
// member who cannot take the shift BELOW every member who can, with no caller-side work to do.
check(
  'and listing the buckets in order puts every non-schedulable member last',
  [
    ...mixed.eligible,
    ...mixed.rankBlocked,
    ...mixed.unverifiable,
    ...mixed.excluded,
    ...mixed.inactive,
  ].map((u) => u.name),
  [
    'Cameron Rave', 'Ralph Fike Jr', 'Roo Lowrey',
    'amy brooks', 'Mia Novak', 'Zoe Anders',
    'No Rank Here', 'Bo Jones', 'Cooper Kim',
  ]
);

console.log('\n--- the sort is on the buckets, and the input is untouched ---');
const input = [
  { id: '9', name: 'Zed', rank_id: 'k1' },
  { id: '1', name: 'Amy', rank_id: 'k1' },
];
const out = eligibilityFor({ users: input, ranks: RANKS, assignment: { rank_order_required: 1 } });
check('the roster handed in is not reordered', input.map((u) => u.name), ['Zed', 'Amy']);
check('while the eligible bucket is', names(out.eligible), ['Amy', 'Zed']);

// Two members sharing a display name must not swap between renders. Roster order is stable within one
// read, so without the id tie-break the list would look fine and then jump when the roster arrived
// differently - a flicker nobody can explain.
check(
  'two members sharing a name land in a fixed order',
  names(
    eligibilityFor({
      users: [
        { id: 'b', name: 'Same Name', rank_id: 'k1' },
        { id: 'a', name: 'Same Name', rank_id: 'k1' },
      ],
      ranks: RANKS,
      assignment: { rank_order_required: 1 },
    }).eligible
  ),
  ['Same Name', 'Same Name']
);

console.log('\n--- edges ---');
check('no users', eligibilityFor({ users: [], ranks: RANKS, assignment: {} }).eligible, []);
check('a null roster is safe', eligibilityFor({ users: null, ranks: RANKS, assignment: {} }).eligible, []);
check(
  'no ranks at all',
  eligibilityFor({ users: USERS, ranks: [], assignment: { rank_order_required: 1 } }).eligible,
  []
);
checkIs(
  'a member with no name does not break the list',
  eligibilityFor({
    users: [{ id: 'x', name: '', rank_id: 'k1' }],
    ranks: RANKS,
    assignment: { rank_order_required: 1 },
  }).eligible.length === 1
);

console.log('\n--- the single-member rule the member screens share ---');
const officer = { name: 'Ralph Fike Jr', rank_id: 'k3' };
const driver = { name: 'Cameron Rave', rank_id: 'k2' };
const chief = { name: 'Bo Jones', rank_id: 'k1', exclude_from_scheduling: true };
const absent = { name: 'Cooper Kim', rank_id: 'k1', status: 'inactive' };
const officerShift = { rank_order_required: 3 };
const firefighterShift = { rank_order_required: 1 };
checkIs('an officer may fill an officer shift', memberCanFillAssignment({ member: officer, assignment: officerShift, ranks: RANKS }));
checkIs('and a firefighter shift', memberCanFillAssignment({ member: officer, assignment: firefighterShift, ranks: RANKS }));
checkIs('a firefighter may NOT fill an officer shift', !memberCanFillAssignment({ member: driver, assignment: officerShift, ranks: RANKS }));
checkIs('excluded from scheduling beats rank', !memberCanFillAssignment({ member: chief, assignment: firefighterShift, ranks: RANKS }));
checkIs('inactive is not schedulable', !memberCanFillAssignment({ member: absent, assignment: firefighterShift, ranks: RANKS }));
check('a rank with no order cannot satisfy a minimum', rankOrderOf(RANKS, 'k9'), null);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);