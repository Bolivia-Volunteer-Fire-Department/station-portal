// The audit log's pure half: the Cloud Logging FILTER, the sorts, the page size, the row mapping and the facets.
//
// WHY THIS IS WORTH A HARNESS OF ITS OWN. The filter is a query string built from values an officer supplies, and
// Logging's query language takes quoted strings - so a value carrying a `"` could add conditions of its own and widen a
// permissioned read. That is the kind of thing a test has to hold, not a comment.
//
// Everything under test is in functions/auditLog.js, which imports nothing at all: no Firebase, no client library, no
// emulator. The callable that USES it (readSystemLog) is deliberately not tested here, because the Logging API is not
// something the Functions emulator implements.
//
// Run with: npm run verify:audit-log
import { readFileSync } from 'node:fs';
import audit from '../functions/auditLog.js';

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

const { buildAuditFilter, orderByFor, pageSizeFor, auditRowFrom, facetsFrom, logReplyFrom } = audit;

console.log('--- the filter anchors on this app’s own lines ---');
const bare = buildAuditFilter({});
check('an unfiltered read asks only for audit payloads', bare.filter, 'jsonPayload.audit.action:*');
check('and reports no problem', bare.problem, '');
checkIs('so the project’s other logs are out of reach', !/severity|resource\./.test(bare.filter), bare.filter);

console.log('\n--- each filter narrows it ---');
check(
  'an action',
  buildAuditFilter({ action: 'ADMIN_RESET_PASSWORD' }).filter,
  'jsonPayload.audit.action:* AND jsonPayload.audit.action="ADMIN_RESET_PASSWORD"'
);
checkIs(
  'a member',
  buildAuditFilter({ member: 'u2' }).filter.includes('jsonPayload.audit.user_id="u2"')
);
check(
  'a date range covers whole days at both ends',
  buildAuditFilter({ from: '2026-03-01', to: '2026-03-31' }).filter,
  'jsonPayload.audit.action:* AND timestamp>="2026-03-01T00:00:00Z" AND timestamp<="2026-03-31T23:59:59Z"'
);
check(
  'and blanks add nothing',
  buildAuditFilter({ action: '', member: '  ', from: '', to: '' }).filter,
  'jsonPayload.audit.action:*'
);

console.log('\n--- and a value that is not the shape it claims REFUSES rather than escaping ---');
// The case this file exists for: a quote in the value would otherwise close the string and append conditions.
const injected = buildAuditFilter({ action: 'USER_LOGIN" OR timestamp>"1970-01-01' });
check('an injected action is refused', injected.filter, '');
checkIs('with a reason the officer can read', /not in a shape/.test(injected.problem), injected.problem);
check('a lowercase action is refused too, because actions are uppercased', buildAuditFilter({ action: 'user_login' }).filter, '');
check('a member id with a space is refused', buildAuditFilter({ member: 'u2 OR u1' }).filter, '');
check('a date that is not a date is refused', buildAuditFilter({ from: '2026-3-1' }).filter, '');
check('as is one carrying a condition', buildAuditFilter({ to: '2026-03-31Z" OR true' }).filter, '');
checkIs('and the refusals name which field was wrong', /member/.test(buildAuditFilter({ member: 'a"b' }).problem));

console.log('\n--- the sorts the API can do server-side, and nothing else ---');
check('newest first', orderByFor('timestamp_desc'), 'timestamp desc');
check('oldest first', orderByFor('timestamp_asc'), 'timestamp');
check('an unknown sort falls back rather than being passed through', orderByFor('action_asc'), 'timestamp desc');
check('as does nothing at all', orderByFor(''), 'timestamp desc');

console.log('\n--- the page size is clamped, because a client’s number is a request ---');
check('a sensible size is kept', pageSizeFor(50), 50);
check('too big is clamped to the ceiling', pageSizeFor(5000), audit.AUDIT_PAGE_SIZE_MAX);
check('too small is lifted to one', pageSizeFor(0), 1);
check('a nonsense size falls back to the default', pageSizeFor('many'), audit.AUDIT_PAGE_SIZE_DEFAULT);
check('as does nothing at all', pageSizeFor(undefined), audit.AUDIT_PAGE_SIZE_DEFAULT);

console.log('\n--- a Cloud Logging entry becomes the row the tab draws ---');
// The station-time formatter the callable injects, stood in for here: what is under test is which value goes where, not
// how a station time is spelled.
const station = (date) => `STATION(${date.toISOString()})`;
const row = auditRowFrom(
  {
    insertId: 'abc123',
    timestamp: '2026-03-04T14:05:00.000Z',
    payload: { audit: { user_id: 'u1', action: 'ADMIN_SAVE_ROLE', details: 'roles/r2', timestamp: '2026-03-04 09:05:00' } },
  },
  station
);
check('the id comes from the entry', row.id, 'abc123');
check('the member, action and details come from the payload', [row.user_id, row.action, row.details], [
  'u1',
  'ADMIN_SAVE_ROLE',
  'roles/r2',
]);
checkIs('the timestamp is the STATION time, which is what the table prints', /^STATION\(/.test(row.timestamp), row.timestamp);
check('and the exact instant survives alongside it', row.created_at, '2026-03-04T14:05:00.000Z');

check(
  'an entry with no payload reads as an empty row rather than throwing',
  auditRowFrom({ timestamp: '2026-03-04T14:05:00.000Z' }, station),
  { id: '', user_id: '', action: '', details: '', timestamp: 'STATION(2026-03-04T14:05:00.000Z)', created_at: '2026-03-04T14:05:00.000Z' }
);
check(
  'and one whose timestamp cannot be parsed keeps the ISO instead of inventing a time',
  auditRowFrom({ timestamp: 'not-a-time', payload: { audit: { action: 'X' } } }, station).timestamp,
  'not-a-time'
);
check('a missing entry is an empty row, not a crash', auditRowFrom(null, station).action, '');

console.log('\n--- the dropdowns describe the sample they were built from ---');
check(
  'actions and members are de-duplicated and sorted',
  facetsFrom([
    { action: 'USER_LOGIN', user_id: 'u1' },
    { action: 'CLOCK_IN', user_id: 'u2' },
    { action: 'CLOCK_IN', user_id: 'u1' },
    { action: '', user_id: '' },
  ]),
  { actions: ['CLOCK_IN', 'USER_LOGIN'], members: ['u1', 'u2'] }
);
check('an empty sample gives empty dropdowns', facetsFrom([]), { actions: [], members: [] });
check('and so does no sample at all', facetsFrom(undefined), { actions: [], members: [] });
checkIs('the sample is bounded, so the dropdowns cannot become a scan', audit.FACET_SAMPLE_SIZE <= 500, String(audit.FACET_SAMPLE_SIZE));

// THE REPLY THE TAB READS, FIELD FOR FIELD - the seam this harness did not hold, and the seam that broke.
//
// The tab and the function are deployed SEPARATELY, so the reply's shape is a contract between two artifacts that can
// each look correct on their own and be wrong together. The first Cloud Logging deployment answered with every field the
// tab reads EXCEPT `api`, and the tab's staleness check is `Number(result.api) !== SYSTEM_LOG_API_VERSION`: a missing
// field is NaN, NaN is not equal to anything, and the "your deployment is stale" banner fired on EVERY load - sending an
// officer to redeploy a backend nothing calls any more. Nothing threw anywhere: the function was right, the tab was
// right, and the two together were wrong. That is exactly what a contract check exists for.
console.log('\n--- the reply the tab reads, field for field ---');
const entry = {
  insertId: 'abc123',
  timestamp: '2026-03-04T14:05:00.000Z',
  payload: { audit: { user_id: 'u1', action: 'ADMIN_SAVE_ROLE', details: 'roles/r2' } },
};
const replyOf = (over = {}) =>
  logReplyFrom({
    entries: [entry],
    nextQuery: { pageToken: 'next-1' },
    sampleEntries: [entry],
    data: { sort: 'timestamp_asc' },
    pageSize: 20,
    stationTimestamp: station,
    ...over,
  });
const reply = replyOf();

// The client's own copy of the number. It cannot be IMPORTED here: this harness runs in plain node, and
// src/utils/systemLog.js imports its neighbours WITHOUT extensions, which node's ESM resolver refuses (vite resolves
// them, which is why the harnesses that import src are built by vite first). So the one literal is read off the line
// that declares it - and the alternative is no check on this seam at all.
const clientVersion = Number(
  /export const SYSTEM_LOG_API_VERSION = (\d+);/.exec(
    readFileSync(new URL('../src/utils/systemLog.js', import.meta.url), 'utf8')
  )?.[1]
);
checkIs(
  'the client and the function agree on the contract version',
  clientVersion === audit.SYSTEM_LOG_API_VERSION,
  `client ${clientVersion}, function ${audit.SYSTEM_LOG_API_VERSION}`
);
checkIs(
  'and the reply CARRIES it, so the staleness check can be satisfied at all',
  Number(reply.api) === clientVersion,
  String(reply.api)
);
// The tab's own expression, and the failure it cannot see: with no version in the reply the comparison is NaN !== 3,
// which is true, so "stale" is the answer for a perfectly current deployment. Wrong, but at least it errs loud.
checkIs('a reply carrying no version reads as STALE rather than as current', Number(undefined) !== clientVersion);

check('every field the tab reads is present, and nothing else is', Object.keys(reply).sort(), [
  'actions',
  'api',
  'has_more',
  'members',
  'next_page_token',
  'page_size',
  'rows',
  'sort',
]);
check('the rows are the mapped entries', reply.rows.map((one) => one.action), ['ADMIN_SAVE_ROLE']);
check('the sort the officer asked for is echoed back', reply.sort, 'timestamp_asc');
check('and an absent one is the default rather than empty', replyOf({ data: {} }).sort, audit.AUDIT_SORT_DEFAULT);
check('the next-page token is the field the tab reads', reply.next_page_token, 'next-1');
checkIs('and has_more says there is a next page', reply.has_more === true);
check('the last page says there is not', replyOf({ nextQuery: null }).has_more, false);
check('and offers an empty token rather than an undefined one', replyOf({ nextQuery: null }).next_page_token, '');
check('the page size is the clamped one the callable chose', reply.page_size, 20);
check('the dropdowns describe the sample, not the page', replyOf({ sampleEntries: [] }).actions, []);
checkIs('a reply with no entries is an empty table rather than a crash', replyOf({ entries: undefined }).rows.length === 0);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
