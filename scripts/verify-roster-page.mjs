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
 *
 * AND THE ONE THAT CAME BACK AS A BUG REPORT: a page has to be able to FILL ITSELF before it calls itself the end of the
 * roster. The read used to look at one chunk - a page plus one candidate - and take "no more" from it, so a candidate who
 * had left ate the spare and the screen drew a short page with the "load more" button gone. The second half of this file
 * is that scan, and the walk at the end of it reads a whole roster page by page to prove everyone is reachable.
 */
import {
  ROSTER_MAX_PAGE_SIZE,
  ROSTER_PAGE_SIZE,
  ROSTER_SCAN_LIMIT,
  certificationIdsForMembers,
  isActiveMember,
  namePrefixRange,
  pageFromCandidates,
  rosterCertificationTypes,
  rosterChunkSize,
  rosterPageSize,
  rosterScanStep,
  scanRosterPage,
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

// ---------------------------------------------------------------------------------------------------------------------
// THE SCAN: HOW MANY CANDIDATES A PAGE LOOKS AT BEFORE IT CALLS ITSELF THE END.
//
// THIS SECTION IS A BUG REPORT. The read used to take ONE chunk - a page plus one candidate - and decide `hasMore` from
// it. A candidate who has LEFT eats that spare, so the page came out short AND the button to reach the rest of the roster
// went away with it: "Load more members" loaded a few and then vanished. One chunk cannot tell "that is everyone" from
// "there is more behind this", which is what ROSTER_SCAN_LIMIT was for in the first place.
console.log('\n--- a chunk is one more candidate than the page, and the scan may need several ---');
check('a chunk is one past the page it has to fill', rosterChunkSize(ROSTER_PAGE_SIZE), ROSTER_PAGE_SIZE + 1);
check('the cap holds for a hand-made request', rosterChunkSize(10000), ROSTER_MAX_PAGE_SIZE + 1);
check('and a nonsense size falls back to the default page', rosterChunkSize('lots'), ROSTER_PAGE_SIZE + 1);

const ten = Array.from({ length: 10 }, (_, index) => ({ id: `u${index}`, name: `Member ${String(index).padStart(2, '0')}` }));
const eleven = [...ten, { id: 'u10', name: 'Member 10' }];
const allActive = Object.fromEntries(eleven.map((member) => [member.id, { status: 'active' }]));
const spareHasLeft = { ...allActive, u10: { status: 'inactive' } };

// THE BUG, one line each. A full page whose SPARE candidate is still a member may stop; a full page whose spare has left
// may not, because the roster can carry on behind them.
check(
  'a full page with an active spare says there is more',
  rosterScanStep({ candidates: eleven, privateById: allActive, pageSize: 10, lastChunkFull: true }).hasMore,
  true
);
check(
  'and it is finished reading',
  rosterScanStep({ candidates: eleven, privateById: allActive, pageSize: 10, lastChunkFull: true }).done,
  true
);
check(
  'a full page whose spare has left reads on rather than ending the roster',
  rosterScanStep({ candidates: eleven, privateById: spareHasLeft, pageSize: 10, lastChunkFull: true }).done,
  false
);
check(
  'and until it reads on it claims no more - which is what the old read announced as the end',
  rosterScanStep({ candidates: eleven, privateById: spareHasLeft, pageSize: 10, lastChunkFull: true }).hasMore,
  false
);
check(
  'a short page that ran out of candidates is the end',
  rosterScanStep({ candidates: ten.slice(0, 4), privateById: allActive, pageSize: 10, lastChunkFull: false }).hasMore,
  false
);
check(
  'and the cursor is the last name ON THE PAGE, whoever was seen past it',
  rosterScanStep({ candidates: eleven, privateById: spareHasLeft, pageSize: 10, lastChunkFull: true }).nextCursor,
  'Member 09'
);
// THE SCAN LIMIT IS NOT THE END OF THE ROSTER. A page that stops short because two hundred candidates were mostly people
// who have left keeps its way onward: `has_more` stays true (and `exhausted` says why), so the officer is not left with a
// short page and no button.
const twoHundredGone = Array.from({ length: 200 }, (_, index) => ({ id: `x${index}`, name: `Gone ${String(index).padStart(3, '0')}` }));
const gonePrivate = Object.fromEntries(twoHundredGone.map((row) => [row.id, { status: 'inactive' }]));
const stoppedAtLimit = rosterScanStep({
  candidates: twoHundredGone,
  privateById: gonePrivate,
  pageSize: 10,
  scanLimit: 200,
  lastChunkFull: true,
});
check('a page that hit the scan limit offers the way on', stoppedAtLimit.hasMore, true);
check('and says it stopped at the limit rather than at the end', stoppedAtLimit.exhausted, true);
check(
  'a page with nobody on it still hands the next attempt a cursor, or it would never move',
  stoppedAtLimit.nextCursor,
  'Gone 199'
);
check(
  'while a page that ends the roster points its cursor at the last name shown',
  rosterScanStep({
    candidates: [{ id: 'u1', name: 'Alice' }],
    privateById: { u1: { status: 'active' } },
    pageSize: 10,
    scanLimit: 200,
    lastChunkFull: false,
  }).nextCursor,
  'Alice'
);

// ---------------------------------------------------------------------------------------------------------------------
// THE WHOLE WALK: a roster of its own, read page by page exactly as the screen reads it, with the reading faked out.
//
// This is the assertion that matters, because it is the one that failed in the field: EVERY member still with the station
// must appear, on exactly one page, and the button must be offered until the last one. The fake reader answers the two
// things the callable's queries answer - a chunk of candidates in name order, and the private rows for them - so the pages
// and the cursors here are the pages and cursors an officer would get.
const fakeReader = (rows, privateById) => async ({ cursor, limit }) => {
  const after = String(cursor || '');
  const start = after ? rows.findIndex((row) => row.name === after) + 1 : 0;
  const chunk = rows.slice(start, start + limit);
  return {
    candidates: chunk,
    privateById: Object.fromEntries(chunk.map((row) => [row.id, privateById[row.id] || {}])),
  };
};
const walkRoster = async (rows, privateById, pageSize) => {
  const read = fakeReader(rows, privateById);
  const pages = [];
  const seen = [];
  let cursor = '';
  let hasMore = true;
  // A CEILING ON THE WALK, so a scan that failed to advance cannot hang the harness - and a page that offers more while
  // handing back nobody to move past is exactly the trap this is watching for.
  for (let pass = 0; pass < 12 && hasMore; pass += 1) {
    const walked = await scanRosterPage({ read, pageSize, cursor });
    pages.push({ names: walked.members.map((member) => member.name), hasMore: walked.hasMore, scanned: walked.scanned });
    seen.push(...walked.members.map((member) => member.id));
    hasMore = walked.hasMore;
    cursor = walked.nextCursor;
  }
  return { pages, seen };
};

// Twenty-five members in name order, four of whom have left - scattered, INCLUDING one immediately past a page's end,
// which is the position that used to silence the button.
const everyone = Array.from({ length: 25 }, (_, index) => ({
  id: `m${String(index + 1).padStart(2, '0')}`,
  name: `Member ${String(index + 1).padStart(2, '0')}`,
  rank_id: 'r1',
}));
const goneIds = ['m03', 'm07', 'm11', 'm20'];
const everyStatus = Object.fromEntries(
  everyone.map((row) => [row.id, { status: goneIds.includes(row.id) ? 'inactive' : 'active' }])
);

const walked = await walkRoster(everyone, everyStatus, 10);
check('every member still with the station is reached', walked.seen.length, everyone.length - goneIds.length);
check('nobody appears twice across the pages', walked.seen.length, new Set(walked.seen).size);
check('and the four who have left appear nowhere', walked.seen.filter((id) => goneIds.includes(id)), []);
check(
  'nobody is skipped',
  [...walked.seen].sort(),
  everyone
    .filter((row) => !goneIds.includes(row.id))
    .map((row) => row.id)
    .sort()
);
check('the pages are drawn full while there is more', walked.pages.map((page) => page.names.length), [10, 10, 1]);
check('the button is offered until the last page is in hand', walked.pages.map((page) => page.hasMore), [true, true, false]);
check(
  'and each page ends where the next one starts',
  walked.pages.map((page) => page.names[page.names.length - 1]),
  ['Member 13', 'Member 24', 'Member 25']
);
check(
  'no page reads past the limit the module allows',
  walked.pages.every((page) => page.scanned <= ROSTER_SCAN_LIMIT),
  true
);
// THE READ COST, as numbers, so a change to the chunking has to face them.
//
// PAGE ONE COSTS TWO CHUNKS AND THIS IS THE BUG IN NUMBERS: its first chunk is Member 01..11, which holds only eight members
// still with the station (three of the four who have left fall in it), and the candidate past the eight - Member 11 - has
// left. The OLD read stopped exactly there: eight names, no button, and the rest of the roster unreachable. This one reads
// on, fills the page, and the names it ends on are the assertion above.
check('a page whose spare candidate has left costs a second chunk', walked.pages[0].scanned, 22);
check('the page after it reads the tail of the roster', walked.pages[1].scanned, 12);
check('and the last one is just what is left', walked.pages[2].scanned, 1);

// THE SAME WALK WITH NOBODY HAVING LEFT is the cheap case, and it must stay cheap: one chunk per page.
const allHere = Object.fromEntries(everyone.map((row) => [row.id, { status: 'active' }]));
const walkedAll = await walkRoster(everyone, allHere, 10);
check('a full roster of active members costs one chunk a page', walkedAll.pages.map((page) => page.scanned), [11, 11, 5]);
check('and it still reaches the end', walkedAll.pages.map((page) => page.hasMore), [true, true, false]);
check('drawing every one of them once', walkedAll.seen.length, everyone.length);

// A ROSTER WHERE EVERYBODY HAS LEFT: the page is empty, but it is not the end while the limit is still finding candidates -
// and each attempt hands back a cursor, so a station that has emptied out still ends instead of offering a button that does
// nothing. This is why an empty page's cursor is the last name READ rather than nothing.
const longGone = Array.from({ length: 250 }, (_, index) => ({ id: `g${index}`, name: `Gone ${String(index).padStart(3, '0')}` }));
const goneRead = fakeReader(longGone, Object.fromEntries(longGone.map((row) => [row.id, { status: 'inactive' }])));
const goneFirst = await scanRosterPage({ read: goneRead, pageSize: 10, cursor: '' });
const goneSecond = await scanRosterPage({ read: goneRead, pageSize: 10, cursor: goneFirst.nextCursor });
check('a roster of former members yields an empty page', goneFirst.members, []);
check('but does not pretend that is the end', goneFirst.hasMore, true);
check('and says it was the limit that stopped it', goneFirst.exhausted, true);
check('the next attempt resumes where the last one stopped reading', goneFirst.nextCursor, 'Gone 199');
check('reads the rest of the roster rather than the same 200 again', goneSecond.scanned, 50);
check('and finally ends, so the button goes away', goneSecond.hasMore, false);

// A FULL PAGE AT THE SCAN LIMIT. A roster whose eleventh candidate, and twenty-second, and so on have all left keeps a
// full page while the scan walks to its ceiling - and if that page reported "no more", the button would go away with the
// rest of the roster still behind it. The same bug as above, one disguise down; `exhausted` is what says which end this is.
const everyEleventhGone = Array.from({ length: 220 }, (_, index) => ({
  id: `e${index}`,
  name: `Member ${String(index + 1).padStart(3, '0')}`,
}));
// The tenth candidate and every one after it has left: the page is full (Member 001..010) and stays full however far the
// scan reads, which is what makes this the limit's case rather than the roster's.
const everyEleventhStatus = Object.fromEntries(
  everyEleventhGone.map((row, index) => [row.id, { status: index >= 10 ? 'inactive' : 'active' }])
);
const fullAtLimit = rosterScanStep({
  candidates: everyEleventhGone.slice(0, 200),
  privateById: everyEleventhStatus,
  pageSize: 10,
  scanLimit: 200,
  lastChunkFull: true,
});
check('a full page that ran out of allowance still offers the way on', fullAtLimit.hasMore, true);
check('and names the limit as the reason', fullAtLimit.exhausted, true);
check('drawing the ten it found', fullAtLimit.members.length, 10);
check('and reading on past them next time', fullAtLimit.nextCursor, 'Member 010');

// A FULL PAGE THAT ENDED THE ROSTER is the other side of that coin, and it must NOT claim there is more: the last chunk
// came back short, so there is nothing behind the page.
const endedRoster = rosterScanStep({
  candidates: everyEleventhGone.slice(0, 12),
  privateById: everyEleventhStatus,
  pageSize: 10,
  scanLimit: 200,
  lastChunkFull: false,
});
check('a full page that ran out of candidates claims no more', endedRoster.hasMore, false);
check('and does not say it was cut off', endedRoster.exhausted, false);

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
