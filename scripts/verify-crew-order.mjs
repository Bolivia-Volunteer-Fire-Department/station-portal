// Verifies the crew ordering used by the My Schedule day cells
// (utils/crewOrder).
//
// The rule replaced an alphabetical-by-name tie-break, and the edge cases are
// easy to get subtly wrong: a missing start time must not read as midnight
// (Number(null) is 0), and "no rank requirement" must be distinct from rank
// order 0. It also pins the decision that ordering follows the ASSIGNMENT's
// required rank, not the member's own rank.
//
// Run with: npm run verify:crew-order
import { compareCrewOrder, sortCrewOrder, sortSlotOrder } from '../src/utils/crewOrder.js';

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

// Rank orders as the app uses them: higher number = higher rank.
const OFFICER = 3;
const DRIVER = 2;
const FIREFIGHTER = 1;
const names = (list) => sortCrewOrder(list).map((p) => p.name);

console.log('--- same start time: highest SHIFT rank first ---');
const sameTime = [
  { name: 'Member 3', startMin: 480, requiredRankOrder: FIREFIGHTER, isOpen: false },
  { name: 'Member 1', startMin: 480, requiredRankOrder: OFFICER, isOpen: false },
  { name: 'Member 2', startMin: 480, requiredRankOrder: DRIVER, isOpen: false }
];
check('officer shift, driver shift, firefighter shift', names(sameTime), ['Member 1', 'Member 2', 'Member 3']);

console.log('\n--- the order follows the SHIFT rank, not the person ---');
// The same two people with the two shifts swapped: if the order tracked the
// member, it would not change. It tracks the assignment, so it flips.
const member1OnOfficer = [
  { name: 'Member 1', startMin: 480, requiredRankOrder: OFFICER, isOpen: false },
  { name: 'Member 3', startMin: 480, requiredRankOrder: FIREFIGHTER, isOpen: false }
];
const member1OnFirefighter = [
  { name: 'Member 1', startMin: 480, requiredRankOrder: FIREFIGHTER, isOpen: false },
  { name: 'Member 3', startMin: 480, requiredRankOrder: OFFICER, isOpen: false }
];
check('Member 1 on the officer shift reads first', names(member1OnOfficer), ['Member 1', 'Member 3']);
check('Member 1 covering the firefighter shift reads last', names(member1OnFirefighter), ['Member 3', 'Member 1']);

console.log('\n--- start time still dominates rank ---');
const mixedTimes = [
  { name: 'Late Officer', startMin: 1200, requiredRankOrder: OFFICER, isOpen: false },
  { name: 'Early Firefighter', startMin: 240, requiredRankOrder: FIREFIGHTER, isOpen: false }
];
check('the earlier shift wins despite the lower rank', names(mixedTimes), [
  'Early Firefighter',
  'Late Officer'
]);

console.log('\n--- equal rank falls back to name ---');
const equalRank = [
  { name: 'Member Z', startMin: 480, requiredRankOrder: DRIVER, isOpen: false },
  { name: 'Member A', startMin: 480, requiredRankOrder: DRIVER, isOpen: false }
];
check('alphabetical within the same rank', names(equalRank), ['Member A', 'Member Z']);

console.log('\n--- open shifts sort after filled ones at the same time ---');
const withOpen = [
  { name: 'Open', startMin: 480, requiredRankOrder: null, isOpen: true },
  { name: 'Member 3 Firefighter', startMin: 480, requiredRankOrder: FIREFIGHTER, isOpen: false }
];
check('filled first, open last', names(withOpen), ['Member 3 Firefighter', 'Open']);

console.log('\n--- filled/open precedence beats the rank requirement ---');
const openWithHighRank = [
  { name: 'Open officer shift', startMin: 480, requiredRankOrder: OFFICER, isOpen: true },
  { name: 'Filled firefighter shift', startMin: 480, requiredRankOrder: FIREFIGHTER, isOpen: false }
];
check('a high-requirement open shift still sorts last', names(openWithHighRank), [
  'Filled firefighter shift',
  'Open officer shift'
]);

console.log('\n--- unknown rank is not the same as rank order 0 ---');
const unknownRank = [
  { name: 'No Rank Member', startMin: 480, requiredRankOrder: null, isOpen: false },
  { name: 'Lowest Order', startMin: 480, requiredRankOrder: 0, isOpen: false }
];
check('a real order 0 outranks an unknown', names(unknownRank), ['Lowest Order', 'No Rank Member']);

const twoUnknown = [
  { name: 'Member Z Unranked', startMin: 480, requiredRankOrder: null, isOpen: false },
  { name: 'Member A Unranked', startMin: 480, requiredRankOrder: null, isOpen: false },
  { name: 'Ranked', startMin: 480, requiredRankOrder: FIREFIGHTER, isOpen: false }
];
check('ranked first, then unranked alphabetically', names(twoUnknown), [
  'Ranked',
  'Member A Unranked',
  'Member Z Unranked'
]);

console.log('\n--- shifts with no start time sort last ---');
const noTimes = [
  { name: 'No Time', startMin: null, requiredRankOrder: OFFICER, isOpen: false },
  { name: 'Midnight', startMin: 0, requiredRankOrder: FIREFIGHTER, isOpen: false }
];
check('null is not midnight', names(noTimes), ['Midnight', 'No Time']);

const undefinedTime = [
  { name: 'Undefined Time', requiredRankOrder: OFFICER, isOpen: false },
  { name: 'Timed', startMin: 600, requiredRankOrder: FIREFIGHTER, isOpen: false }
];
check('undefined start time sorts last too', names(undefinedTime), ['Timed', 'Undefined Time']);

const emptyStringTime = [
  { name: 'Empty Start', startMin: '', requiredRankOrder: OFFICER, isOpen: false },
  { name: 'Timed', startMin: 600, requiredRankOrder: FIREFIGHTER, isOpen: false }
];
check('empty-string start time sorts last', names(emptyStringTime), ['Timed', 'Empty Start']);

console.log('\n--- numeric strings from the sheet are handled ---');
const stringRanks = [
  { name: 'Firefighter', startMin: '480', requiredRankOrder: '1', isOpen: false },
  { name: 'Officer', startMin: '480', requiredRankOrder: '3', isOpen: false }
];
check('sheet-style strings sort by rank', names(stringRanks), ['Officer', 'Firefighter']);

console.log('\n--- ordering is a total order (deterministic) ---');
const shuffled = [
  { name: 'Member Z', startMin: 480, requiredRankOrder: FIREFIGHTER, isOpen: false },
  { name: 'Open', startMin: 480, requiredRankOrder: null, isOpen: true },
  { name: 'Member 1', startMin: 480, requiredRankOrder: OFFICER, isOpen: false },
  { name: 'Unknown', startMin: 480, requiredRankOrder: null, isOpen: false },
  { name: 'Member 2', startMin: 480, requiredRankOrder: DRIVER, isOpen: false }
];
check('same order from a shuffled start', names(shuffled), [
  'Member 1',
  'Member 2',
  'Member Z',
  'Unknown',
  'Open'
]);
check('reversing the input gives the same order', names(shuffled.slice().reverse()), [
  'Member 1',
  'Member 2',
  'Member Z',
  'Unknown',
  'Open'
]);
check(
  'comparator is antisymmetric for every pair',
  shuffled.every((a, b) => Math.sign(compareCrewOrder(a, b)) === -Math.sign(compareCrewOrder(b, a))),
  true
);

console.log('\n--- caller safety ---');
const original = shuffled.slice();
sortCrewOrder(shuffled);
check('sortCrewOrder does not mutate its input', shuffled, original);
check('non-array input is safe', sortCrewOrder(null), []);

// A SLOT is the board's version of the same question: a shift nobody holds yet, so there is no member and nothing is
// open or filled. Its order is the same rule with the middle key removed - time, then the assignment's required rank -
// which is what "the slots by time, then by assignment rank" means for the Schedule Management board and for the
// Templates tab's cards.
console.log('\n--- a SLOT: time first, then the shift rank ---');
const slots = [
  { name: 'Firefighter 08:00', startMin: 480, requiredRankOrder: FIREFIGHTER },
  { name: 'Officer 08:00', startMin: 480, requiredRankOrder: OFFICER },
  { name: 'Officer 06:00', startMin: 360, requiredRankOrder: OFFICER },
];
check('the earliest slot leads, whatever its rank', sortSlotOrder(slots).map((s) => s.name), [
  'Officer 06:00',
  'Officer 08:00',
  'Firefighter 08:00',
]);
check('and the same three reversed come out the same', sortSlotOrder(slots.slice().reverse()).map((s) => s.name), [
  'Officer 06:00',
  'Officer 08:00',
  'Firefighter 08:00',
]);

console.log('\n--- and an unknown rank is not rank 0 ---');
check(
  'a slot with no requirement sorts after the ranked ones at the same time',
  sortSlotOrder([
    { name: 'Unknown rank', startMin: 480, requiredRankOrder: null },
    { name: 'Rank 0', startMin: 480, requiredRankOrder: 0 },
    { name: 'Rank 1', startMin: 480, requiredRankOrder: FIREFIGHTER },
  ]).map((s) => s.name),
  ['Rank 1', 'Rank 0', 'Unknown rank']
);
check(
  'and a slot with no readable start time sorts after every timed one',
  sortSlotOrder([
    { name: 'No time', startMin: null, requiredRankOrder: OFFICER },
    { name: 'Late', startMin: 1380, requiredRankOrder: FIREFIGHTER },
  ]).map((s) => s.name),
  ['Late', 'No time']
);
check(
  'the name breaks a tie the rank could not, so the order is total',
  sortSlotOrder([
    { name: 'Bravo', startMin: 480, requiredRankOrder: OFFICER },
    { name: 'Alpha', startMin: 480, requiredRankOrder: OFFICER },
  ]).map((s) => s.name),
  ['Alpha', 'Bravo']
);
const slotOriginal = slots.slice();
sortSlotOrder(slots);
check('sortSlotOrder does not mutate its input either', slots, slotOriginal);
check('and non-array input is safe here too', sortSlotOrder(null), []);


console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
