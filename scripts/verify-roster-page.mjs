/**
 * Verifies the paged roster read: what one screenful of the roster is, and what belongs on it.
 *
 *   npm run verify:roster-page
 *
 * WHY THIS HARNESS HAS TO EXIST, and it is the reason functions/rosterPage.js is a file of its own. The roster is served by
 * a Cloud Function, because being "active" is a private fact - it lives in `users_private`, which the rules refuse to most
 * officers, so the screen cannot page for itself without listing members who have left. THIS REPO RUNS NO FUNCTIONS
 * EMULATOR, so the function cannot be exercised here at all: every decision about what it reads and keeps is in that
 * module, and this is where those decisions are asked. What is left in the function is a list of calls.
 *
 * The three things it holds, in the order they matter:
 *
 *   1. THE PAGE IS BOUNDED, and a caller cannot talk it into being unbounded. This is the whole point: the module used to
 *      read every member's rows - `users` and `users_private` one document per member, `certifications` append-only - to
 *      draw ten names, and that grew with the roster and with the station's age.
 *   2. THE SEARCH IS A PREFIX, expressed as the two ends of a name range, and an empty term is NOT a range (a range that
 *      matches everything is the same answer as no filter, at the cost of one).
 *   3. THE COLUMNS ARE THE PAGE'S, and a member who has left does not appear on it.
 */
import {
  ROSTER_MAX_PAGE_SIZE,
  ROSTER_PAGE_SIZE,
  certificationIdsForMembers,
  isActiveMember,
  namePrefixRange,
  pageFromCandidates,
  rosterCertificationTypes,
  rosterPageSize,
} from '../functions/rosterPage.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` -> ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`}`
  );
};

console.log('--- the page size is bounded, and a caller cannot unbound it ---');
check('nothing asked for means the default page', rosterPageSize(undefined), ROSTER_PAGE_SIZE);
check('as does nonsense', rosterPageSize('lots'), ROSTER_PAGE_SIZE);
check('and zero - the whole-roster read is not the fallback any more', rosterPageSize(0), ROSTER_PAGE_SIZE);
check('a negative size is refused rather than read', rosterPageSize(-10), ROSTER_PAGE_SIZE);
check('a size that was asked for is honoured', rosterPageSize(25), 25);
check('a string arrival is a number', rosterPageSize('25'), 25);
check('a fraction is floored', rosterPageSize(25.9), 25);
check('and a hand-made request for everything is capped', rosterPageSize(10000), ROSTER_MAX_PAGE_SIZE);

console.log('\n--- the search is a prefix, and an empty one is no filter at all ---');
check('a term becomes a name range', namePrefixRange('mar'), { from: 'mar', to: 'mar\uf8ff' });
check('padding is trimmed first', namePrefixRange('  mar  '), { from: 'mar', to: 'mar\uf8ff' });
check('an empty term is not a range', namePrefixRange(''), { from: '', to: '' });
check('nor is a missing one', namePrefixRange(undefined), { from: '', to: '' });

console.log('\n--- a page holds active members, and says whether there are more ---');
const roster = [
  { id: 'u1', name: 'Charlie', rank_id: 'r1' },
  { id: 'u2', name: 'Alice', rank_id: 'r2' },
  { id: 'u3', name: 'Bob', rank_id: '' },
];
const statuses = { u1: { status: 'active' }, u2: { status: 'Active' }, u3: { status: 'retired' } };
const firstPage = pageFromCandidates({ candidates: roster, privateById: statuses, pageSize: 2 });
check('the page is the size that was asked for', firstPage.members.length, 2);
check('and it is sorted by name, not by arrival', firstPage.members.map((member) => member.name), ['Alice', 'Charlie']);
check('the rank travels with the member', firstPage.members.map((member) => member.rank_id), ['r2', 'r1']);
check('the member who has left is not on it', firstPage.members.some((member) => member.id === 'u3'), false);
check('and with nothing behind it, it does not offer more', firstPage.hasMore, false);
check('the cursor is the last name on the page', firstPage.nextCursor, 'Charlie');

// A MISSING PRIVATE ROW IS NOT AN ACTIVE MEMBER. The direction matters: a member who has left showing on the roster is a
// wrong record, while an active member missing from a page is a name the search box still finds.
check('no private row means not active', isActiveMember(undefined), false);
check('a blank status means not active', isActiveMember({ status: '   ' }), false);
check('and an invented one does', isActiveMember({ status: 'retired' }), false);
check('while active is active, whatever its casing', isActiveMember({ status: ' ACTIVE ' }), true);

const more = pageFromCandidates({
  candidates: [...roster, { id: 'u4', name: 'Dana', rank_id: 'r1' }],
  privateById: { ...statuses, u4: { status: 'active' } },
  pageSize: 2,
});
check('a fuller roster fills the page and keeps the rest for later', more.members.map((m) => m.name), ['Alice', 'Charlie']);
check('and says there is more', more.hasMore, true);
check('with the cursor at the page edge', more.nextCursor, 'Charlie');
check('an empty batch is an empty page, not an error', pageFromCandidates({}).members, []);
check(
  'and a full page that ends the roster offers nothing more',
  pageFromCandidates({
    candidates: roster,
    privateById: { u1: { status: 'active' }, u2: { status: 'active' } },
    pageSize: 2,
  }).hasMore,
  false
);
// THE CANDIDATE BATCH IS ALLOWED TO BE BIGGER THAN THE PAGE: the caller over-reads, because the status filter happens after
// the read, and that over-read must not become a bigger page.
check(
  'an over-read batch still yields exactly one page',
  pageFromCandidates({
    candidates: Array.from({ length: 30 }, (_, index) => ({ id: `u${index}`, name: `Member ${String(index).padStart(2, '0')}` })),
    privateById: Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`u${index}`, { status: 'active' }])),
    pageSize: 10,
  }).members.length,
  10
);
// A PAGE OF CANDIDATES THAT ARE ALL INACTIVE IS SHORT RATHER THAN PADDED with people from further down the roster: the
// caller's scan bound is what decides that, and a page that reaches it says so.
check(
  'a batch of former members yields nobody rather than reaching further',
  pageFromCandidates({ candidates: roster, privateById: { u1: { status: 'inactive' }, u2: {}, u3: { status: 'retired' } } }).members,
  []
);

console.log('\n--- the columns are the ones the station marked for the roster ---');
const setup = [
  { id: 'c1', name: 'Hazmat', icon: 'flame', show_on_roster: true, sort_order: 2 },
  { id: 'c2', name: 'EMT', icon: 'heart', show_on_roster: true, sort_order: 1 },
  { id: 'c3', name: 'Hidden', icon: 'eye', show_on_roster: false, sort_order: 0 },
  { id: 'c4', name: 'Named later', icon: '', show_on_roster: true, sort_order: 1 },
];
check('only the columns marked for the roster', rosterCertificationTypes(setup).map((type) => type.id), ['c2', 'c4', 'c1']);
check('and the icons travel with them', rosterCertificationTypes(setup).map((type) => type.icon), ['heart', '', 'flame']);
check('nothing set up means no columns', rosterCertificationTypes([]), []);

console.log('\n--- a member holds a column only while the certification is current ---');
const page = [{ id: 'u1' }, { id: 'u2' }];
const records = [
  { user_id: 'u1', certification_id: 'c1', effective_date: '2026-01-01', end_date: '' },
  { user_id: 'u1', certification_id: 'c2', effective_date: '', end_date: '' },
  // Not in force yet, and expired: neither belongs in a column.
  { user_id: 'u1', certification_id: 'c4', effective_date: '2026-12-01', end_date: '' },
  { user_id: 'u2', certification_id: 'c1', effective_date: '2025-01-01', end_date: '2026-01-01' },
  // SOMEBODY WHO IS NOT ON THIS PAGE: the read only asked for the page's ids, and this is the assertion that the answer
  // does not depend on a row the page never showed.
  { user_id: 'u9', certification_id: 'c1', effective_date: '2026-01-01', end_date: '' },
  // A COLUMN THE ROSTER DOES NOT DRAW is ignored even when the row is current.
  { user_id: 'u1', certification_id: 'c3', effective_date: '2026-01-01', end_date: '' },
];
const held = certificationIdsForMembers({ members: page, certificationRows: records, typeIds: ['c1', 'c2'], today: '2026-06-01' });
check('the current ones are held', held.u1, ['c1', 'c2']);
check('the expired one is not', held.u2, []);
check('and a member off the page holds nothing', held.u9, undefined);
check('every member on the page has an entry, even when empty', Object.keys(held), ['u1', 'u2']);
// THE EDGE IS INCLUSIVE on both sides: a certification that started today is current, and one that ends today has not ended.
check(
  'a certification starting today is current',
  certificationIdsForMembers({
    members: [{ id: 'u1' }],
    certificationRows: [{ user_id: 'u1', certification_id: 'c1', effective_date: '2026-06-01', end_date: '' }],
    typeIds: ['c1'],
    today: '2026-06-01',
  }).u1,
  ['c1']
);
check(
  'and one ending today has not ended yet',
  certificationIdsForMembers({
    members: [{ id: 'u1' }],
    certificationRows: [{ user_id: 'u1', certification_id: 'c1', effective_date: '', end_date: '2026-06-01' }],
    typeIds: ['c1'],
    today: '2026-06-01',
  }).u1,
  ['c1']
);
check(
  'and a page with nobody on it asks for nothing',
  certificationIdsForMembers({ members: [], certificationRows: records, typeIds: ['c1'], today: '2026-06-01' }),
  {}
);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
