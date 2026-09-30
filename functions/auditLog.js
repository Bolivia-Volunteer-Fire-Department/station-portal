// Reading the app's audit trail OUT OF CLOUD LOGGING, on demand.
//
// WHY THIS FILE EXISTS AT ALL. The audit trail used to be a `system_log` collection: a document per action, plus a
// whole-collection scan every time the tab was opened. Both costs are gone - the lines are Cloud Logging entries now,
// written for nothing by `audit` in index.js - and this is how an officer still READS them, which is the one thing
// dropping the collection took away. The read happens only when the tab is opened, which is the property the collection
// could not offer: a Firestore query pays per document, and the API call below pays nothing.
//
// THE FILTER IS BUILT HERE RATHER THAN AT THE CALL SITE, and everything below is pure: no client library, no Firebase,
// nothing to mock. That is deliberate - a filter string assembled by concatenation is exactly the thing that needs a
// test, and scripts/verify-audit-log.mjs is that test.
//
// THE VALUES ARE VALIDATED, NOT ESCAPED, and it matters which. Logging's filter language takes quoted strings, so a
// value carrying a `"` could add conditions of its own - `action = 'X" OR timestamp>"1970-01-01"'` would quietly widen a
// permissioned read. Escaping would be a judgement call about a grammar maintained elsewhere; refusing anything that is
// not the shape we expect is not. So: an action is uppercase tokens, a member id is an id, a date is a date, and
// anything else is a REFUSAL the caller is told about.

// Every line this app writes carries this payload - see `audit` in index.js. It is also the filter's anchor: without it,
// every request to the project's log (Cloud Run's, Firestore's, the deploys') would be a candidate row.
const AUDIT_PATH = 'jsonPayload.audit.action';

// What the caller may ask for, and how it is checked before it goes near a query.
const ACTION_SHAPE = /^[A-Z0-9_]{1,64}$/;
const MEMBER_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

// The sorts the Logging API can do SERVER-side. The sheet-era log also offered action and member ordering, which need
// the whole result in hand; a paged API read cannot do that honestly, so those two are gone rather than approximated per
// page - sorting one page of a log is not sorting a log.
const AUDIT_SORTS = { timestamp_desc: 'timestamp desc', timestamp_asc: 'timestamp' };
const AUDIT_SORT_DEFAULT = 'timestamp_desc';

const AUDIT_PAGE_SIZE_DEFAULT = 20;
const AUDIT_PAGE_SIZE_MAX = 100;

// How many lines the filter dropdowns are built from. They come from the RECENT end of the log rather than from the whole
// of it, which is a real limitation and an honest one: a dropdown offering every action the station has ever performed
// would need a scan, and a scan is the thing this design exists to avoid.
const FACET_SAMPLE_SIZE = 200;

// A refusal, or null when the caller's value is acceptable. `field` names what was wrong, in the words the tab shows.
const refusalFor = (value, shape, field) => {
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (!text) return null;
  return shape.test(text) ? null : `${field} is not in a shape this log can be filtered by.`;
};

// The complete filter, plus the reason it was refused when it was. Returning `{ filter, problem }` rather than throwing
// keeps the caller in charge of how a refusal reads - the tab shows `problem`, and index.js turns it into an error.
//
// THE VALUES ARE NORMALIZED ONCE, at the top, and everything below uses the normalized copy. That is not tidiness: a
// value of '  ' used to pass validation as blank and then reach the filter as `user_id=""`, because the check trimmed it
// and the builder did not - a condition matching nothing, silently narrowing an audit read.
const buildAuditFilter = ({ action = '', member = '', from = '', to = '' } = {}) => {
  const wanted = {
    action: String(action === undefined || action === null ? '' : action).trim(),
    member: String(member === undefined || member === null ? '' : member).trim(),
    from: String(from === undefined || from === null ? '' : from).trim(),
    to: String(to === undefined || to === null ? '' : to).trim(),
  };

  const problem =
    refusalFor(wanted.action, ACTION_SHAPE, 'That action') ||
    refusalFor(wanted.member, MEMBER_SHAPE, 'That member') ||
    refusalFor(wanted.from, DATE_SHAPE, 'That date') ||
    refusalFor(wanted.to, DATE_SHAPE, 'That date');
  if (problem) return { filter: '', problem };

  const parts = [`${AUDIT_PATH}:*`];
  if (wanted.action) parts.push(`${AUDIT_PATH}="${wanted.action}"`);
  if (wanted.member) parts.push(`jsonPayload.audit.user_id="${wanted.member}"`);
  // The dates are station dates and the log's own timestamps are UTC, so a whole day is asked for at both ends: the
  // boundary is generous by hours rather than precise by minutes, which is the right side to err on for an audit read.
  if (wanted.from) parts.push(`timestamp>="${wanted.from}T00:00:00Z"`);
  if (wanted.to) parts.push(`timestamp<="${wanted.to}T23:59:59Z"`);

  return { filter: parts.join(' AND '), problem: '' };
};

const orderByFor = (sort) => AUDIT_SORTS[String(sort || '')] || AUDIT_SORTS[AUDIT_SORT_DEFAULT];

const pageSizeFor = (size) => {
  const parsed = parseInt(size, 10);
  if (!Number.isFinite(parsed)) return AUDIT_PAGE_SIZE_DEFAULT;
  return Math.min(AUDIT_PAGE_SIZE_MAX, Math.max(1, parsed));
};

// One Cloud Logging entry as the row the tab draws. The tab's contract is `timestamp` in STATION TIME - the format the
// whole app reads - while `created_at` carries the exact instant, so nothing is lost by not storing either of them.
const auditRowFrom = (entry, stationTimestamp) => {
  const payload = (entry && entry.payload && entry.payload.audit) || {};
  const when = entry && entry.timestamp ? new Date(entry.timestamp) : null;
  const valid = when && !Number.isNaN(when.getTime());
  return {
    id: String(
      (entry && entry.insertId) || (entry && entry.metadata && entry.metadata.insertId) || ''
    ),
    user_id: String(payload.user_id || ''),
    action: String(payload.action || ''),
    details: String(payload.details || ''),
    // A row whose timestamp could not be parsed keeps the ISO it came with rather than an invented one.
    timestamp: valid ? stationTimestamp(when) : String((entry && entry.timestamp) || ''),
    created_at: String((entry && entry.timestamp) || ''),
  };
};

// The values each filter dropdown offers, from the sample read alongside the page. Sorted and de-duplicated; empty when
// the sample was, which the tab renders as a dropdown with nothing in it rather than as a failure.
const facetsFrom = (rows) => {
  const actions = new Set();
  const members = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (row && row.action) actions.add(row.action);
    if (row && row.user_id) members.add(row.user_id);
  });
  return { actions: [...actions].sort(), members: [...members].sort() };
};

module.exports = {
  AUDIT_PATH,
  AUDIT_SORTS,
  AUDIT_SORT_DEFAULT,
  AUDIT_PAGE_SIZE_DEFAULT,
  AUDIT_PAGE_SIZE_MAX,
  FACET_SAMPLE_SIZE,
  buildAuditFilter,
  orderByFor,
  pageSizeFor,
  auditRowFrom,
  facetsFrom,
};
