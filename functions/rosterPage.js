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

// How many `users` documents ONE READ of the scan looks at: one more than the page needs, because the status is private
// and some of the candidates will turn out to have left. That extra one is what lets a page tell "that is everyone" from
// "there is more behind this" - and it is also, on its own, what the bug below was.
export const rosterChunkSize = (rawPageSize) => Math.min(rosterPageSize(rawPageSize) + 1, ROSTER_SCAN_LIMIT);

// ONE STEP OF THE SCAN: the page so far, and what to do next.
//
// THIS EXISTS BECAUSE ONE CHUNK IS NOT ENOUGH TO DECIDE ANYTHING. The read used to be a single chunk - one candidate more
// than the page - with `hasMore` taken from the page it produced. With just ONE member who has left in that chunk the page
// came out short (nine, or four) and `hasMore` came out false, so the screen drew the short page AND TOOK THE LOAD-MORE
// BUTTON AWAY: the officer could not reach the rest of the roster, and the roster claimed to have ended. The chunk was
// never meant to decide that - ROSTER_SCAN_LIMIT exists precisely so a page may look at several chunks to fill itself,
// which is what the note at the top of this file has always said it was for.
//
// `lastChunkFull` is how the caller says whether there is more to read (a short chunk is the end of the candidates), and
// `scanned` is how many have been read ALTOGETHER, which is what the limit is about.
export const rosterScanStep = ({
  candidates = [],
  privateById = {},
  pageSize = ROSTER_PAGE_SIZE,
  scanLimit = ROSTER_SCAN_LIMIT,
  lastChunkFull = false,
} = {}) => {
  const size = rosterPageSize(pageSize);
  const scanned = (Array.isArray(candidates) ? candidates : []).length;
  const { members, hasMore } = pageFromCandidates({ candidates, privateById, pageSize: size });
  // The last name ON THE PAGE is the cursor for the next page - not the last name read, which may belong to somebody the
  // officer has not been shown and may never be shown.
  const nextCursor = members.length ? members[members.length - 1].name : '';
  // THE SCAN RAN OUT OF ALLOWANCE, which is not the same thing as reaching the end of the roster and must never be drawn
  // as one. It matters for a FULL page too: a roster whose eleventh candidate, and twenty-second, and thirty-third have
  // all left keeps a full page while the scan walks to the ceiling, and a page that reported "no more" from there would
  // take the button away with the rest of the roster still behind it - the very bug this file was rewritten for, one
  // disguise down.
  const cutOff = lastChunkFull && scanned >= scanLimit;

  // A FULL PAGE. There is more behind it if the candidate past its end is active. If that candidate has left, the roster
  // may still continue - so the caller reads another chunk rather than stopping here.
  if (members.length === size) {
    return {
      members,
      hasMore: hasMore || cutOff,
      nextCursor,
      done: hasMore || cutOff || !lastChunkFull,
      exhausted: cutOff,
      scanned,
    };
  }

  // A SHORT PAGE: everyone read who is still with the station fits on it. Either that is the roster (the last chunk came
  // back short) or the scan stopped at its ceiling - and the ceiling is NOT the end of anything, so the screen is told
  // there is more rather than being left with a page and no way on. Each attempt resumes after the last name SHOWN, so a
  // roster that is mostly people who have left still advances, a couple of hundred candidates at a time.
  //
  // ONE THING THIS CANNOT SAY PERFECTLY: when the allowance runs out on a chunk that happens to be exactly the end of the
  // candidates, that chunk looks full and the page offers one more "Load more" that will come back empty. A click, against
  // a document ceiling that stays where it says it is.
  //
  // THE CURSOR FOR A PAGE WITH NOBODY ON IT. There is no name on the page to follow, so it is the last name READ - which,
  // when the page is empty, is the last of a run of people who have left, and is the only way the attempt can move on. A
  // cursor of nothing would hand the screen the same empty page for ever, button and all - worse than the bug this fixes.
  // It is safe because an empty page means EVERY candidate read had left (an active one would be on the page), so resuming
  // past them skips nobody.
  const lastRead = candidates.length ? text(candidates[candidates.length - 1].name) : '';
  return {
    members,
    hasMore: cutOff,
    nextCursor: members.length ? nextCursor : cutOff ? lastRead : '',
    done: !lastChunkFull || cutOff,
    exhausted: cutOff,
    scanned,
  };
};

// THE WHOLE SCAN, with the reading INJECTED. The loop is the part that had the bug, so it lives here where a harness can
// drive it with a whole roster of its own - and `functions/index.js` is left with a `read` that does the two queries and
// nothing else, which is the same split (and the same reason) as the rest of this file.
//
// `read({ cursor, limit })` answers `{ candidates, privateById }`: the chunk, and the private rows for exactly those
// candidates. A chunk shorter than `limit` means the candidates have run out.
//
// TERMINATION, since this is a loop: every pass either stops or adds at least one candidate, and `scanLimit` caps the
// total - so the passes are bounded by the limit however the chunks come back. A read that answered nothing at all ends
// the scan on its own pass.
export const scanRosterPage = async ({
  read,
  pageSize = ROSTER_PAGE_SIZE,
  cursor = '',
  scanLimit = ROSTER_SCAN_LIMIT,
} = {}) => {
  const size = rosterPageSize(pageSize);
  const chunkSize = rosterChunkSize(size);
  const candidates = [];
  const privateById = {};
  let after = text(cursor);
  // NOTHING HAS BEEN READ YET, so nothing has been decided yet - the first pass always happens, and only then does a step
  // get to say the scan is over. `lastChunkFull: true` is how that is said: it is as if a full chunk were still to come.
  let step = rosterScanStep({ pageSize: size, scanLimit, lastChunkFull: true });

  while (!step.done) {
    const limit = Math.min(chunkSize, scanLimit - candidates.length);
    // Out of allowance: the page stands as it is, and `rosterScanStep` has already said whether there is more behind it.
    if (limit <= 0) break;

    const chunk = (await read({ cursor: after, limit })) || {};
    const rows = (Array.isArray(chunk.candidates) ? chunk.candidates : []).filter((row) => row && row.id);
    candidates.push(...rows);
    Object.assign(privateById, chunk.privateById || {});

    step = rosterScanStep({
      candidates,
      privateById,
      pageSize: size,
      scanLimit,
      lastChunkFull: rows.length >= limit,
    });

    // The scan resumes after the last CANDIDATE read. The next PAGE resumes after the last member shown (see nextCursor),
    // so the candidates read past this page's end are read again by that request - a handful of reads, and it keeps the
    // cursor meaning the one thing the screen says it means.
    after = rows.length ? text(rows[rows.length - 1].name) : after;
  }

  return step;
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

// WHICH COLUMNS EACH MEMBER ON THIS PAGE HAS CHECKED OFF - and nobody else's, which is the half of the old read that grew
// with the station's age.
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
