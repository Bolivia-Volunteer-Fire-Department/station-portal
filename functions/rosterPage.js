// THE ROSTER MODULE'S PAGE: what one screenful of the roster is, and what belongs on it.
//
// WHY THIS IS A FILE OF ITS OWN, and it is the same reason functions/pushAudience.js is one. The roster is served by a
// CALLABLE (functions/index.js#readRosterModule), because being "active" is a private fact - it lives in `users_private`,
// which the rules refuse to most officers - so the screen cannot page for itself without listing members who have left.
// THIS REPO'S SUITE RUNS NO FUNCTIONS EMULATOR, so a Cloud Function cannot be exercised by it at all: anything a function
// could get wrong has to live somewhere a harness can ask it directly (scripts/verify-roster-page.mjs), and what is left
// in the function is a list of calls with nothing left to decide.
//
// THE POINT OF PAGING, stated because it is the whole reason this exists. The module used to read every member's rows to
// draw one screenful: `users` and `users_private` are one document per member, and `certifications` is append-only, so the
// read grew with the roster AND with the station's age. A page reads the members it draws; a search reads what the officer
// asked for by name.
export const ROSTER_PAGE_SIZE = 10;
// A ceiling, because the page size arrives from a browser: a hand-made request for ten thousand members must not become a
// ten-thousand-document read.
export const ROSTER_MAX_PAGE_SIZE = 50;
// How many user documents ONE page will look at before it stops filling itself. The status is private, so candidates have
// to be read before they can be filtered - a page of ten may need more than ten names, but it must not need a whole roster
// of people who have left. A page that ends short because of this says so (see `exhausted` in the callable), rather than
// pretending the roster ended.
export const ROSTER_SCAN_LIMIT = 200;

const text = (value) => String(value ?? '').trim();

// The page size a caller asked for, clamped to something a screen can draw and a read can afford. A missing, unreadable or
// zero size is the DEFAULT PAGE - not "everything": the whole-roster read is what this file exists to stop being the
// default.
export const rosterPageSize = (raw) => {
  const wanted = Number(raw);
  if (!Number.isFinite(wanted) || wanted < 1) return ROSTER_PAGE_SIZE;
  return Math.min(ROSTER_MAX_PAGE_SIZE, Math.floor(wanted));
};

// What a search box turns into: a name PREFIX, expressed as the two ends of a range.
//
// A prefix is the only search Firestore can serve without a second, indexed collection: `>=` the term, `<=` the term with
// the highest code point appended, ordered by name. The alternative - reading every name and filtering in the browser - is
// exactly the read this change exists to avoid.
//
// AN EMPTY TERM IS NOT A RANGE, and both ends come back empty so the caller can leave the filter OFF: a range from '' to
// '\uf8ff' matches everything, which is the same answer at a different cost, and it reads as a filter that is not there.
export const namePrefixRange = (search) => {
  const term = text(search);
  if (!term) return { from: '', to: '' };
  return { from: term, to: `${term}\uf8ff` };
};

// Whether a member's private row says they are still with the station.
//
// ANYTHING ELSE IS NOT ACTIVE - a missing row, a blank status, a status a hand-edited database invented. That is the safe
// direction: a member who has left appearing on the roster is a wrong record, while an active member missing from a page is
// a name the search box still finds.
export const isActiveMember = (privateRow) => text(privateRow?.status).toLowerCase() === 'active';

// ONE PAGE from a batch of candidates, and whether anything is behind it.
//
// The caller reads `pageSize + 1`-ish candidates because it cannot filter before it reads; this takes that batch, drops the
// people who have left, keeps the first `pageSize` and reports the rest. That leftover is what makes "More" honest: a page
// that ends exactly on the last member must not offer another one.
export const pageFromCandidates = ({ candidates = [], privateById = {}, pageSize = ROSTER_PAGE_SIZE } = {}) => {
  const size = rosterPageSize(pageSize);
  const active = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => candidate && candidate.id)
    .filter((candidate) => isActiveMember(privateById[candidate.id]))
    .map((candidate) => ({
      id: String(candidate.id),
      name: text(candidate.name),
      rank_id: text(candidate.rank_id),
    }))
    // SORTED HERE rather than trusted from the query: a page has to read as a roster whatever the caller passed, and a
    // second ordering rule is how a screen and its own search come to disagree about where somebody belongs.
    .sort((left, right) => left.name.localeCompare(right.name));
  const members = active.slice(0, size);
  return {
    members,
    hasMore: active.length > size,
    // The last name on the page is the cursor for the next one: `startAfter` on the same ordering. Returned rather than
    // kept here, because the caller owns the query.
    nextCursor: members.length ? members[members.length - 1].name : '',
  };
};

// The certification columns the roster draws: the setup rows the station marked `show_on_roster`, in the setup screen's
// own order. Both shapes are accepted - a Firestore snapshot and a plain row - because the callable hands this whatever it
// just read, and a copy of the shape here is how a column would silently disappear.
export const rosterCertificationTypes = (setupRows = []) =>
  (Array.isArray(setupRows) ? setupRows : [])
    .map((row) => (row && row.data ? { id: row.id, ...row.data() } : row))
    .filter((row) => row && row.show_on_roster === true)
    .map((row) => ({
      id: text(row.id),
      name: text(row.name),
      icon: text(row.icon),
      sort_order: Number(row.sort_order ?? 999),
    }))
    .filter((type) => type.id)
    .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name));

// WHICH COLUMNS EACH MEMBER ON THIS PAGE HAS TICKED - and nobody else's, which is the half of the old read that grew with
// the station's age.
//
// A CERTIFICATION IS CURRENT WHEN IT HAS STARTED AND HAS NOT ENDED: a future `effective_date` is not in force yet, and a
// past `end_date` has expired. A blank on either side means "no bound" rather than "no", which is what the sheet's empty
// cells mean. Both are compared as date keys against the station's today, so every reader agrees about the edge - and the
// comparisons are inclusive, because a certificate that started today is current today.
export const certificationIdsForMembers = ({ members = [], certificationRows = [], typeIds = [], today = '' } = {}) => {
  const wanted = new Set((Array.isArray(members) ? members : []).map((member) => text(member?.id)).filter(Boolean));
  const visible = new Set((Array.isArray(typeIds) ? typeIds : []).map((id) => text(id)).filter(Boolean));
  const byMember = Object.fromEntries([...wanted].map((id) => [id, []]));
  const day = text(today);

  for (const raw of Array.isArray(certificationRows) ? certificationRows : []) {
    const row = raw && raw.data ? { id: raw.id, ...raw.data() } : raw;
    if (!row) continue;
    const memberId = text(row.user_id);
    const typeId = text(row.certification_id);
    // A ROW FOR SOMEBODY WHO IS NOT ON THIS PAGE IS SKIPPED, not carried: that is the saving, and it is also what keeps
    // the answer from depending on rows the page never showed.
    if (!wanted.has(memberId) || !visible.has(typeId)) continue;
    const effectiveDate = text(row.effective_date);
    const endDate = text(row.end_date);
    if (effectiveDate && effectiveDate > day) continue;
    if (endDate && endDate < day) continue;
    byMember[memberId].push(typeId);
  }

  return byMember;
};
