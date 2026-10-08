// The refresh reads, one per action the app asks for outside the sign-in payload.
//
// WHY A SEPARATE MODULE FROM firestorePayload.js: the payload answers the whole member sign-in in one wave, and this
// answers the small reads the app makes afterwards - who is on duty, the clock history, the roster, the schedule,
// the member's own availability and offers, training, certifications, announcements, events, devices. They share the
// queries (see the exports in firestorePayload.js) so the two cannot disagree.
//
// THE SHAPES ARE THE PAYLOAD'S SHAPES. Each reader returns exactly the slice the payload returns for the same data,
// because the app hands both to the same setters - a different key here would be a screen that empties on refresh,
// which is the failure this whole module exists to avoid. scripts/verify-firestore-reads.mjs signs in and asks
// through these, so the shapes are checked rather than hoped for.
import { collection, doc, getCountFromServer, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { activeAudienceRows, audienceKeysFor, audienceRows, memberAvailabilityFor, offersForMember, pendingOffers, readUsersOnce, rowsFor, rowsInRange, rowsOf, scheduleSetupFor, settingRows } from './firestorePayload.js';
import { firebaseFunctions, firestore } from './firebase.js';
// A window's date key, and the id-merge that makes two bounded queries answer as one list. Both are the app's own helpers
// rather than service-local copies: the admin list merges the same way a screen does when it loads an older window.
import { nextDateKey, toDateKey, stationTodayKey } from '../utils/scheduleDate.js';
// The certification decoration, shared with the payload so a sign-in and a refresh agree.
import { certificationAlertsFor, decorateCertifications } from '../utils/certifications.js';
import { mergeRowsById } from '../utils/savedRow.js';
import { claimRowsFromMonths, monthKeysBetween } from '../utils/availability.js';
// The score row's id, which is `{documentId}_{userId}` - the read asks for one document by that id rather than
// querying by document_id and filtering, which the rules would refuse for a member. See assessmentScoreRow.
import { assessmentScoreId, isAssessment as isAssessmentDocument } from '../utils/documents.js';
// The tab gate for `can_edit_timeclock`, so the reader can tell an officer's read from a member's. The RULES are what
// actually decide - see managesWholeTimeclock below - but the client has to know which query to send.
import { roleAllowsTab } from '../utils/permissions.js';

// The roster the calendar used to ask for separately (`GET_ROSTER`, now retired) is a projection of `users` that the sign-in
// payload already carries - see the note where the route used to be listed, in firestoreRouting.js. Nothing in the app asks
// for it as its own read, so there is no reader here for it.

// Who is on duty, joined to names and ranks - the same join the payload does, because the dashboard draws a name and a rank
// icon. The reader used to leave `rank_id` out, so the same member appeared with a rank after a sign-in and with a generic
// icon after a refresh; the payload's row has always carried it (see services/liveReads.js, which builds the same three
// fields).
//
// FROM THE SERVER, and that is the fix rather than a preference.
//
// This collection is read IMMEDIATELY AFTER a write, and the write is what makes the read interesting: the clock
// transaction creates this row on the way in and DELETES it on the way out. A cache-first read after a delete is the trap
// this app has already paid for twice - see `signaturesForDocument` in firestoreWrites.js, which reads its rows with
// `source: 'server'` for exactly this reason and says so at length.
//
// The visible failure is the one that looks like a broken button rather than a broken write: the member presses Clock Out,
// the transaction commits, the row is gone from the server and the audit shows it - and the dashboard re-reads the list
// from cache, still contains them, and keeps drawing "On Duty". Pressing Clock Out a second time is then answered by the
// SERVER, which is looking for an open entry, finds none, and says "You are not clocked in." Two halves of the app
// disagreeing about one fact, with the member left certain the first press did nothing.
//
// `on_duty` is a handful of rows and this is the only read of it, so the cost of asking the server is one small query.
const onDutyRows = async (_uid) => {
  const [duty, users] = await Promise.all([
    rowsOf(collection(firestore(), 'on_duty'), { source: 'server' }),
    readUsersOnce(),
  ]);
  const byId = Object.fromEntries(users.map((user) => [user.id, user]));
  const rankFor = (id) => {
    const member = byId[id] || {};
    return member.rank_id ?? '';
  };
  return duty.map((row) => ({
    ...row,
    name: (byId[row.id] || {}).name || '',
    rank_id: rankFor(row.id),
    user_id: row.id,
  }));
};

// The caller's own keys, from their own document: the role and rank decide which announcements they may see, and a
// claim can be an hour stale.
const keysFor = async (uid) => {
  const me = (await getDoc(doc(firestore(), 'users', uid))).data() || {};
  return audienceKeysFor({ userId: uid, roleId: String(me.role_id || ''), rankId: String(me.rank_id || '') });
};

// Whether this caller may manage OTHER MEMBERS' clock entries - the `can_edit_timeclock` permission, which is what the
// Administration > Clock Management tab is gated on and what the rules already honour on the timeclock collection
// (`resource.data.user_id == uid() || permission('can_edit_timeclock')`).
//
// WHY THIS IS ASKED OF THE CLIENT AT ALL, when the rules are the thing that actually decides: the rules REFUSE a query
// that would return a row the caller may not read, so asking for the whole collection as a member fails the whole read -
// and the admin screen would get an error rather than its own history. So the permission is resolved first and only then
// is the narrower query chosen. This is belt-and-braces against our own rules rather than a substitute for them: the rules
// still refuse anything this gets wrong, which is the property that matters.
//
// `is_admin` is honoured the same way the rules honour it (see `permission()` in firestore.rules): a master permission
// passes everything, so it has to pass this too or a station owner would see an empty Clock Management tab.
const managesWholeTimeclock = async (uid) => {
  if (!uid) return false;
  const me = (await getDoc(doc(firestore(), 'users', uid))).data() || {};
  const roleId = String(me.role_id || '');
  if (!roleId) return false;
  let role = null;
  try {
    role = (await getDoc(doc(firestore(), 'roles', roleId))).data() || null;
  } catch {
    // A role that cannot be read is treated as granting nothing. Failing open here would mean a read error widened
    // the query; the rules would refuse it anyway, but the honest answer is "this caller manages their own entries".
    return false;
  }
  return roleAllowsTab(role, 'clock');
};

// MAY THIS CALLER READ THE WHOLE DOCUMENTS COLLECTION?
//
// The "View as" picker asks for another member's paperwork, and there are two honest answers to "which documents": the
// ones THAT MEMBER may see, or all of them. The second is the right one, because the person looking is an officer doing a
// job - checking a new member's truck checklist, or working out what is still outstanding - and the documents missing from
// the first answer are not the member's paperwork at all. They are paperwork the officer is entitled to read and the query
// refused to ask for.
//
// This was ALREADY TRUE OF THE RULES, which put the permission branch first on `documents` (see firestore.rules) so a
// manager or a verifier may read the collection whole - `ADMIN_GET_DOCUMENTS` depends on precisely that. The reader was
// throwing that access away and filtering by the member's rank and role instead. The visible consequence was that an
// officer standing next to a probationary firefighter was shown LESS than an officer standing next to a Chief, and every
// document whose minimum rank sat above the viewed member's simply vanished from the report.
//
// The member's own rank still decides what THEY owe - which documents they must sign, which items are outstanding, which
// are verified. It no longer decides what the officer standing in front of them is allowed to look at.
//
// `roleAllowsTab(role, 'documents')` is the tab gate, and the documents tab is the one two permissions open -
// `can_manage_documents` and `can_verify_documents` - which are exactly the two the rules check on this collection.
//
// Fails CLOSED on a role that cannot be read, for the reason `managesWholeTimeclock` does: a read error must not widen
// the query. The rules would refuse the wider one anyway; this keeps the answer honest rather than leaning on that.
const mayReadWholeDocuments = async (uid) => {
  if (!uid) return false;
  const me = (await getDoc(doc(firestore(), 'users', uid))).data() || {};
  const roleId = String(me.role_id || '');
  if (!roleId) return false;
  let role = null;
  try {
    role = (await getDoc(doc(firestore(), 'roles', roleId))).data() || null;
  } catch {
    return false;
  }
  return roleAllowsTab(role, 'documents');
};

;

// Whether a document is on the list at all: published, and inside its own date window. Both are separate from the
// AUDIENCE, which is materialized on the document and answered by `audienceRows` - a document can be aimed at exactly
// the right people and still not be available yet, which is the difference between a library and a list of intentions.
const documentIsLive = (document, today) => {
  const row = document || {};
  if (row.is_published !== true && String(row.is_published || '').trim().toUpperCase() !== 'TRUE') return false;
  // `effective_date` and `end_date` - the columns the app's own editor writes and the ones utils/effectiveDates reads.
  // The first version of this function asked for `date_from`/`date_to`, which are NOT document columns at all: nothing
  // wrote them, so every window read as open and a retired document stayed on everybody's list. A field name that exists
  // nowhere fails silently and in the PERMISSIVE direction, which is the worst way for it to fail.
  const from = String(row.effective_date || '').trim();
  const to = String(row.end_date || '').trim();
  if (from && today < from) return false;
  if (to && today > to) return false;
  return true;
};

// One document's checklist items, in the order a reader works through them.
//
// Same shape as the sheet's documentItemRows, including its two refusals: a row with no id or no label is not an item, and the
// order is the checklist's own - sort_order, then the label - rather than whatever the database hands back. THE ITEMS
// TRAVEL WITH THE DOCUMENT because the member's screen draws them from there (checklistSections(openDocument.items)), so
// a document opened without them reads as a checklist with nothing in it - which is exactly what it did, while the items
// sat in the collection the whole time.
const checklistItemRows = async (documentId, audienceKeys = null) => {
  const wanted = String(documentId || '').trim();
  if (!wanted) return [];

  const items = Array.isArray(audienceKeys) && audienceKeys.length
    ? await rowsOf(query(
        collection(firestore(), 'document_checklist_items'),
        where('document_id', '==', wanted),
        where('audience_keys', 'array-contains-any', audienceKeys)
      ))
    : await rowsFor('document_checklist_items', 'document_id', wanted);
  return items
    .map((item) => ({
      id: String(item.id || '').trim(),
      document_id: String(item.document_id || '').trim(),
      sort_order: parseInt(item.sort_order, 10) || 0,
      section: String(item.section || '').trim(),
      label: String(item.label || '').trim(),
    }))
    .filter((item) => item.id !== '' && item.label !== '')
    .sort((a, b) => a.sort_order - b.sort_order || (a.label.toLowerCase() < b.label.toLowerCase() ? -1 : 1));
};

// One member's score on one assessment, as a row.
//
// ONE MEMBER AT A TIME, and that is the whole of the read's design. A station's assessment scores are exactly the sort
// of thing nobody should be able to page through, so there is no "read them all" query anywhere in this app - the
// reader is always handed a member and asks for that member's row on that document.
//
// IT READS BY DOCUMENT ID, and that is not a shortcut - it is the only shape that works. The score's id is
// `{documentId}_{userId}`, so asking for that one document asks for exactly one row, and the rules can prove it
// belongs to the member who asked: a single-document get is evaluated against that document alone. The obvious
// alternative - `where('document_id', '==', ...)` and filter in JS - returns EVERY member's score on that assessment,
// which a member is not allowed to read, and Firestore does not hand back the readable subset of a query it cannot
// prove: the whole query fails. That is the same trap as the timeclock read, where widening the query to "everything"
// gives a member an error rather than their own history. It would also have needed a composite index.
//
// Naming NO member means the caller, which is how the Documents screen gets "my score" without the client having to
// name itself - a client that named its own id could ask for somebody else's, and the rules would allow that for a
// scorer, so the default is the safe reading of an unnamed request rather than a convenience.
const assessmentScoreRow = async (documentId, userId) => {
  const wantedDocument = String(documentId || '').trim();
  const wantedMember = String(userId || '').trim();
  if (!wantedDocument || !wantedMember) return null;

  // NO SCORE IS A REFUSAL, NOT A MISS - and that is why this read is caught rather than merely checked.
  //
  // The read rule is `resource.data.user_id == uid() || permission('can_add_assessment_scores')` - see
  // document_assessment_scores in firestore.rules. A member who has never been assessed owns NO row, so there is
  // nothing for that condition to be true of: `resource` is null, `.data` off null is an EVALUATION ERROR, and
  // Firestore answers permission-denied. A member who HOLDS the scorer permission gets an ordinary "not there"
  // instead, which is why the same read behaves differently for the officer who records the score.
  //
  // UNCAUGHT, that refusal failed the WHOLE document. A member opening an assessment their role was perfectly entitled
  // to read got "GET_DOCUMENT failed: permission-denied: Missing or insufficient permissions", because the answer to
  // "what is my score" had nowhere to come from - the body, the signature and the date window were all fine.
  //
  // `visibleDocumentFor` catches for the same reason, and says so: a permission-denied and a missing document are ONE
  // answer to a caller who is only asking whether they have a score. The null returned here is that answer.
  let snapshot = null;
  try {
    snapshot = await getDoc(
      doc(firestore(), 'document_assessment_scores', assessmentScoreId(wantedDocument, wantedMember))
    );
  } catch {
    return null;
  }
  // `.exists()` is a METHOD in the client SDK - the Admin SDK is where it is a property, and the two are easy to
  // confuse. Read as a property it yields a function, which is truthy, so a missing score would report as present.
  if (!snapshot.exists()) return null;
  return { ...snapshot.data(), id: snapshot.id };
};

// How many items each checklist holds, and how many of them one member has signed - the two numbers a checklist's
// progress needs, because a checklist is signed item by item and a document-level signature says nothing about it.
//
// One pass over each collection rather than a lookup per row, which is what the sheet did and why a library of a hundred
// documents stays cheap. `userId` of '' (the officer's list) leaves `items_signed` at 0: "signed by whom" is not a
// question the editor asks, and the sheet answered it the same way.
const documentItemSummaries = async (userId, audienceKeys = null) => {
  const wantedUser = String(userId || '').trim();
  const items = Array.isArray(audienceKeys) && audienceKeys.length
    ? await rowsOf(query(
        collection(firestore(), 'document_checklist_items'),
        where('audience_keys', 'array-contains-any', audienceKeys)
      ))
    : await rowsOf(collection(firestore(), 'document_checklist_items'));
  const summaries = {};

  items.forEach((item) => {
    const documentId = String(item.document_id || '').trim();
    if (!documentId || !String(item.id || '').trim()) return;
    if (!summaries[documentId]) summaries[documentId] = { item_count: 0, items_signed: 0 };
    summaries[documentId].item_count += 1;
  });

  if (wantedUser) {
    const signatures = await rowsFor('document_signatures', 'user_id', wantedUser);
    signatures.forEach((signature) => {
      if (String(signature.signature_role || '') !== 'member') return;
      // An ITEM signature: a whole-document signature carries no item, and counting those would report progress nobody
      // made.
      if (String(signature.checklist_item_id || '') === '') return;
      const documentId = String(signature.document_id || '').trim();
      if (!summaries[documentId]) return;
      summaries[documentId].items_signed += 1;
    });
  }

  return summaries;
};

// The two counts attached to a list row, for checklists only: a plain document has no items to count, and the screen
// reads `item_count === 0` as "nothing is being asked of anybody here".
const withItemSummaries = (rows, summaries) =>
  rows.map((row) => {
    const summary = String(row.doc_type || '').trim().toLowerCase() === 'checklist' ? summaries[row.id] : null;
    return { ...row, item_count: summary ? summary.item_count : 0, items_signed: summary ? summary.items_signed : 0 };
  });

// The library's order, which is a decision rather than a detail: folders A-Z with the unfiled ones last, then the
// document's own order, then its title. The sheet's list came back in this order and the client draws it as it arrives -
// so a backend that returns whatever order the database prefers silently reorders somebody's library, and a drag that
// moved a document to the top appears to have done nothing. The same reasoning as the schedule templates' order in
// firestorePayload.js, and the same failure: a row order nobody maintained is not a row order nobody needs.
const documentSort = (a, b) => {
  const aFolder = String(a.folder || '');
  const bFolder = String(b.folder || '');
  if (aFolder !== bFolder) {
    if (!aFolder) return 1;
    if (!bFolder) return -1;
    return aFolder.toLowerCase() < bFolder.toLowerCase() ? -1 : 1;
  }
  const aOrder = parseInt(a.sort_order, 10) || 0;
  const bOrder = parseInt(b.sort_order, 10) || 0;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return String(a.title || '').toLowerCase() < String(b.title || '').toLowerCase() ? -1 : 1;
};

// One document as the DETAIL view needs it: the row, its length, and - for a checklist - its items.
//
// The body is ON THE ROW (`content`), which is worth stating because the design notes in the README describe a
// `document_bodies` split that was never built: no writer, no rules, no migration entry. A reader that looked for the
// body there got a permission-denied from the deny-by-default catch-all and no content at all - so this reads the row,
// and the doc is the thing to fix when the split is wanted for real.
const documentFullRow = async (row, audienceKeys = null) => {
  const source = row || {};
  const content = String(source.content ?? '');
  return {
    ...source,
    content,
    // The list never carries a length (it has no body to measure where the body is split out); the sheet sent one with
    // every row, and the screens that show a document's size read it from here.
    content_length: content.length,
    items: String(source.doc_type || '').trim().toLowerCase() === 'checklist'
      ? await checklistItemRows(source.id, audienceKeys)
      : [],
  };
};

// This member's own whole-document signature for one document, and whether it predates the wording it is attached to.
//
// The caller reads the member's OWN signatures and finds the document here rather than querying by document, because a
// member may read their own rows and nobody else's: a query filtered by document alone would be refused for a plain
// member, and this read is theirs. The two rules are the sheet's, unchanged - only a `member` row with no checklist item
// is a document signature, and an unreadable revision on either side reads as NOT stale.
const documentSignatureFor = (signatures, documentId, userId) => {
  const wantedDocument = String(documentId || '').trim();
  const wantedUser = String(userId || '').trim();
  return (
    signatures.find(
      (signature) =>
        String(signature.document_id || '').trim() === wantedDocument &&
        String(signature.user_id || '').trim() === wantedUser &&
        String(signature.checklist_item_id || '') === '' &&
        String(signature.signature_role || '') === 'member'
    ) || null
  );
};

const signatureIsStale = (signature, document) => {
  const signedAt = parseInt(signature && signature.content_revision, 10);
  const current = parseInt(document && document.content_revision, 10);
  if (!Number.isFinite(signedAt) || !Number.isFinite(current)) return false;
  return signedAt < current;
};

// One document, if THIS viewer may see it. Null covers both "no such document" and "not for you", deliberately: what a
// member may not see is answered as though it were not there, so a crafted request learns nothing about what exists
// above their rank. That is the sheet's rule and it is worth keeping.
//
// The RULES refuse an out-of-audience document before this function sees it, so the read has to be caught rather than
// checked: a permission-denied and a missing document are the same answer to the caller, which is exactly the point.
// The audience comparison below is therefore belt-and-braces - it keeps the intent legible and it is what would still
// be right if the rules ever loosened - and not the thing doing the work.
// EXPORTED for one caller: the writers, which must apply the SAME visibility test before letting somebody sign. Two
// copies of it would drift, and this is the function that decides whether a document exists as far as a member is
// concerned - the security-shaped half of the documents feature.
export const visibleDocumentFor = async (uid, id) => {
  const wanted = String(id || '').trim();
  if (!wanted) return null;

  let document = null;
  try {
    const snapshot = await getDoc(doc(firestore(), 'documents', wanted));
    // The document id goes LAST, for the reason rowsOf gives: a migrated row still carries the sheet's own `id` column, and
    // spreading it over the real key hands every caller a dead id - which for a document means verifying or saving against
    // something that is not the document.
    if (snapshot.exists()) document = { ...snapshot.data(), id: snapshot.id };
  } catch {
    return null;
  }
  if (!document) return null;

  const mine = await keysFor(uid);
  const audience = Array.isArray(document.audience_keys) ? document.audience_keys : [];
  if (!audience.some((key) => mine.includes(String(key)))) return null;
  if (!documentIsLive(document, stationTodayKey())) return null;
  return document;
};

// The rows the game draws. The board is capped at this and `total` is not, which is the difference that matters: 25 rows
// and "of 40" tells a member who has not played yet that there is a board to join.
const RUNNER_LEADERBOARD_LIMIT = 25;

export const READERS = {
  GET_ON_DUTY: (uid) => onDutyRows(uid).then((onDuty) => ({ onDuty })),
  // The member's own clock history, optionally WINDOWED — and windowed is how the APP asks for it, because this is the one
  // per-member table that grows without limit: a five-year member has thousands of entries, and reading all of them at every
  // sign-in was the largest single read in the app.
  //
  // It was read at sign-in so that the DASHBOARD could answer "am I clocked in" — and `on_duty` answers that for free, since
  // the clock transaction writes both: a member's on-duty row exists exactly while one of their entries is open. So the
  // dashboard asks the on-duty list (which is live), and the history is read when the History screen is opened.
  //
  // The `timeclock (user_id, time_in)` index this needs already existed. A caller that names no window still gets the whole
  // history, which is what the harnesses ask for.
  GET_TIMECLOCK_LOGS: async (uid, body) => {
    const from = String((body && body.from) || '').trim();
    const to = String((body && body.to) || '').trim();

    // DOES THIS CALLER MANAGE THE WHOLE TIMECLOCK? It is asked once, here, because the answer decides the shape of the
    // query rather than filtering what it returned: a member's read is scoped by `user_id` in the QUERY, so the rules can
    // prove every row it hands back is theirs, and an officer's read has no such filter.
    //
    // This was the reported fault, and it was not a permission problem at all - the rules have always allowed an officer
    // to read anybody's entry (`resource.data.user_id == uid() || permission('can_edit_timeclock')`), and Clock Management
    // has always had a member picker that offered other people's names. What the reader did was hard-code
    // `where('user_id', '==', uid)`, so the picker chose a member and the list underneath it never changed: the rows for
    // anybody else were never requested. The dropdown was honest and the data was not.
    //
    // A MEMBER'S READ IS UNCHANGED, and that is the point worth holding: they still get their own entries and nothing
    // else, because the filter is in the query. Widening this to "fetch everything and filter in the app" would have been
    // the one-line version, and it would have been refused by the rules outright - a query returning a row the caller may
    // not read fails as a whole, so a member asking for everything gets NOTHING rather than their own history.
    const managesAll = await managesWholeTimeclock(uid);

    if (!from && !to) {
      // The unbounded form. An officer's is the whole collection - which is what the Clock Management tab asks for, and
      // the read it has always meant. It is bounded there in practice by the window below whenever a range is named.
      return managesAll
        ? { logs: await rowsOf(collection(firestore(), 'timeclock')) }
        : { logs: await rowsFor('timeclock', 'user_id', uid) };
    }

    // THE ORDER BY IS LOAD-BEARING, and that is not obvious. Equality on `user_id` plus a range on `time_in` needs a
    // composite index, and the one declared in firestore.indexes.json is (user_id ASC, time_in DESC). Without an
    // explicit orderBy, Firestore implies an ASCENDING range scan - which no declared index serves - and PRODUCTION
    // refuses the query with failed-precondition while THE EMULATOR, which ignores index requirements, answers it
    // happily. That is how Clock History came to load nothing in the field while every harness stayed green. Ordering
    // by time_in desc makes the query servable by the declared index (and hands back newest first, which the screen
    // re-sorts anyway - the direction costs nothing and buys the index).
    //
    // THE UPPER BOUND IS THE DAY AFTER `to`, EXCLUSIVE - and this is the bug that hid a member's own shift from
    // them. `time_in` is a DATETIME ("yyyy-MM-dd HH:mm:ss") while `to` is a bare "yyyy-MM-dd" key, and Firestore
    // compares these as TEXT: the space after the date sorts BEFORE the end of the string, so
    //
    //     '2026-10-02 14:33:12' <= '2026-10-02'   ->  false
    //
    // An inclusive bound therefore excluded EVERY entry clocked in on the last day of the window - and since the
    // History screen asks for `[12 months back, TODAY]`, that was precisely the entry a member had just made. The
    // older ones were there, the new one was not, and the write had plainly succeeded: the read was asking a
    // different question of a correct answer.
    //
    // It failed silently in every harness because the seeded entry sits mid-window, and because a passing assertion
    // over rows that all came back cannot notice a row that did not. `<` the start of the next day admits the whole
    // of `to`, and also admits a migrated ISO value ('2026-10-02T04:00:00.000Z', where 'T' > ' ') that a
    // `<= '2026-10-02 23:59:59'` bound would still drop. The LOWER bound is already correct for the same reason -
    // anything stamped on `from` sorts at or after the bare key - and is left as the inclusive `>=` it should be.
    const logs = await rowsOf(
      query(
        collection(firestore(), 'timeclock'),
        // THE `user_id` FILTER IS THE MEMBER'S, AND ONLY THE MEMBER'S. An officer's read has none, which leaves the same
        // query shape - a range on `time_in`, ordered by it - with one filter fewer, so the declared
        // `timeclock (user_id ASC, time_in DESC)` index still serves the member's and the officer's falls back to the
        // single-field index on `time_in` that Firestore keeps for every collection.
        ...(managesAll ? [] : [where('user_id', '==', uid)]),
        where('time_in', '>=', from || '0000-01-01'),
        where('time_in', '<', to ? nextDateKey(to) : '9999-12-31'),
        orderBy('time_in', 'desc')
      )
    );
    // The window comes back with the rows, so a caller can tell what it holds - the same arrangement GET_SCHEDULE uses.
    return { logs, logs_window: { from, to } };
  },
  // THE CREW DIRECTORY, for the screens that LIST people: the names on a month of calendar pills, the availability roster, and
  // the Users tab (which joins the private half on in its own section). A SIGN-IN DOES NOT READ IT ANY MORE - the dashboard
  // names nobody except whoever is on duty, and that is read by id (firestorePayload#usersByIds) - so this is what a screen
  // asks for when it opens. See App#loadRoster.
  //
  // The projection is the sheet's own: a name and a rank, and deliberately NOT the role, which is nobody else's business and
  // which the client does not need in order to label a shift.
  GET_ROSTER: async () => {
    // THE BADGE INDEX RIDES WITH THE ROSTER, because they answer one question - "who is this on screen" - so a screen that draws
    // names needs both and a screen that draws none needs neither. It is one document per member (the icons to draw beside their
    // name), derived on the way in from records a member may not read, which is why it cannot be queried per person instead.
    //
    // Both used to arrive with every sign-in: the directory for a dashboard that names only whoever is on duty, and the badges for
    // a dashboard that draws none. See firestorePayload#readStationRows.
    const [rosterRows, badgeRows] = await Promise.all([
      readUsersOnce(),
      rowsOf(collection(firestore(), 'certification_badges')),
    ]);
    return {
      roster: rosterRows.map((user) => ({ id: user.id, name: user.name, rank_id: user.rank_id })),
      certificationBadges: Object.fromEntries(badgeRows.map((row) => [String(row.user_id), row.badges || []])),
    };
  },
  // THE SCHEDULE'S REFERENCE DATA - the templates a shift is drawn from, the assignments that colour and order them, and the shift
  GET_ROSTER_MODULE: async () => {
    const answer = await httpsCallable(firebaseFunctions(), 'readRosterModule')({});
    return answer.data || {};
  },
  // definitions a clock entry is labeled with. Read when a screen that has a schedule (or a clock table) is opened, rather than at
  // sign-in: see firestorePayload#scheduleSetupFor and App#loadScheduleSetup.
  //
  // The OFFICER'S copies of the same rows arrive with the administration wave, which merges the private notes this read
  // deliberately does not carry - so an officer's pickers and notes are unaffected by this being public.
  GET_SCHEDULE_SETUP: async () => scheduleSetupFor(),
  // The station's schedule, optionally WINDOWED - and a window is what the app always asks for, because `schedule` is the
  // one collection that grows without limit. A caller that names no window is asking for every shift the station has ever
  // scheduled: that is what the harnesses do, and what a screen that has not been scoped yet would do. Slow rather than
  // wrong, which is the right way round for the default.
  GET_SCHEDULE: async (uid, body) => {
    const from = String((body && body.from) || '').trim();
    const to = String((body && body.to) || '').trim();
    // THE SERVER, NOT THE CACHE. This read follows a save more often than not (the board re-reads the month it just
    // wrote, and a calendar re-reads the month it is on), and a cache-first read can hand back the PRE-SAVE rows -
    // which is how a freshly dragged shift was drawn back on the day it came from, without a single error anywhere.
    // `source: 'server'` costs the same one read, and is never allowed to answer with a stale day for a screen that
    // just changed it.
    const schedule =
      from || to
        ? await rowsInRange('schedule', 'date_from', from, to, { source: 'server' })
        : await rowsOf(collection(firestore(), 'schedule'), { source: 'server' });
    // The window comes back with the rows, so a caller can tell what it holds rather than assuming it holds everything.
    return { schedule, schedule_window: { from, to } };
  },
  // THE OPTIONS LIST, for the member's own grid. It is the same collection ADMIN_GET_AVAILABILITY_WINDOWS serves the officer's
  // windows tab from, and it is a separate action because that one is routed with the administration feature: a member's session
  // cannot reach it, and the grid cannot draw a thing without this list.
  //
  // One whole-collection read of short, officer-maintained reference data, made when the screen is opened - retired windows
  // included, deliberately, because a claim points at one and the history has to keep reading.
  GET_AVAILABILITY_WINDOWS: async () => ({
    availabilityWindows: await rowsOf(collection(firestore(), 'availability_windows')),
  }),
  // The member's own claims, over a range of dates: turned into the MONTHS that range covers (utils/availability.js) and
  // read as one document per month. A caller that names no range reads every month the member has touched, which is what
  // the harnesses ask for.
  GET_AVAILABILITY: async (uid, body) => {
    const from = String((body && body.from) || '').trim();
    const to = String((body && body.to) || '').trim();
    if (!from && !to) {
      return { availability: claimRowsFromMonths(await rowsFor('availability_months', 'user_id', uid)) };
    }
    return {
      availability: await memberAvailabilityFor(uid, monthKeysBetween(from, to)),
      availability_window: { from, to },
    };
  },
  // EVERY member's claims for the months a range covers, for the two officer screens: the All Members roster and the
  // board's "you are scheduling somebody who did not mark it" warning. ONE query on `month` - the whole reason that field
  // exists - allowed by the rules through the permission branch, and ~30 documents where a row-per-claim shape cost ~240.
  ADMIN_GET_AVAILABILITY: async (uid, body) => {
    const from = String((body && body.from) || '').trim();
    const to = String((body && body.to) || '').trim();
    if (!from && !to) {
      return { availability: claimRowsFromMonths(await rowsOf(collection(firestore(), 'availability_months'))) };
    }
    const months = monthKeysBetween(from, to);
    const docs = months.length
      ? await rowsOf(query(collection(firestore(), 'availability_months'), where('month', 'in', months)))
      : [];
    return { availability: claimRowsFromMonths(docs), availability_window: { from, to } };
  },
  // The member's own offers, over the two statuses a calendar draws from. See OFFER_STATUSES_ON_A_CALENDAR.
  GET_SHIFT_OFFERS: (uid) => offersForMember(uid).then((offers) => ({ offers })),
  // THE TRAINING CATALOGUE AND THE CALLER'S OWN SIGNATURES - what the Training module draws from: the list of what can be
  // signed, and what this member has already signed. Both used to ride with every sign-in, for a dashboard that shows neither;
  // they are read when that module is opened, by a member who can sign or by an officer whose tab lists who has signed what.
  //
  // The signatures are part of THIS read rather than a second action because the module always wants both together, and the
  // client's refresher already expects them in one answer (App#refreshTraining sets them side by side).
  GET_TRAINING: async (uid) => {
    const [trainings, signatures] = await Promise.all([
      rowsOf(collection(firestore(), 'trainings')),
      rowsFor('training_signatures', 'user_id', uid),
    ]);
    // THE COUNT RIDES ON THE TRAINING, and no callable is needed for it any more: `signature_count` is materialized on
    // each training document by functions/index.js (the trigger keeps it in step with every signature added or removed),
    // so it arrives with the row. Without it every training would read as unsigned and so as editable - which is why
    // normalizeTraining (utils/training.js) treats a missing field as 0, covering any training written before the
    // counter existed.
    return { trainings, signatures };
  },
  // DECORATED, exactly as the sign-in payload decorates them: the state and the day count are derived at read
  // time (they would go stale if stored), and the modules filter and sort on them. The setup read is the join.
  GET_CERTIFICATIONS: async (uid) => {
    const [certifications, setup] = await Promise.all([
      rowsFor('certifications', 'user_id', uid),
      rowsOf(collection(firestore(), 'certification_setup')),
    ]);
    const decorated = decorateCertifications(certifications, setup, stationTodayKey());
    return { certifications: decorated, certificationAlerts: certificationAlertsFor(decorated) };
  },
  // The member's own announcements, narrowed to the ones in force - the same read the sign-in payload makes, so a refresh
  // cannot put back what the payload left out (an expired notice).
  MY_ANNOUNCEMENTS: async (uid) => ({
    announcements: await activeAudienceRows('announcements', await keysFor(uid), { liveUntilField: 'live_until' }),
  }),
  GET_EVENTS: async (uid) => ({ events: await audienceRows('events', await keysFor(uid)) }),
  MY_PUSH_DEVICES: async (uid, body) => {
    const [devices, settings] = await Promise.all([
      rowsFor('push_devices', 'user_id', uid),
      getDoc(doc(firestore(), 'user_settings', uid)),
    ]);

    // An administrator's switch outranks everything else on the card, so it travels WITH the devices rather than being
    // asked for separately: the card makes one call and needs one answer. The sheet kept this flag in
    // `user_settings.is_push_disabled` and never sent it to the member, so the block could be set and never shown -
    // the card's "an administrator turned this off" branch had nothing to fire on.
    const pushDisabled = settings.exists() && (settings.data() || {}).is_push_disabled === true;

    // The second half of this read, and the reason it needed a callable: "whose device is this browser?" is a
    // question the browser cannot answer, because a member may read their own rows and nobody else's - so another
    // member's token reads as nothing at all, and a shared computer would look like the signed-in member's own. The
    // sheet answered it server-side for exactly the same reason, and so does `pushDeviceOwner`.
    //
    // The token is the one this browser's own service worker holds, passed in by the card that asks the question.
    const deviceToken = String((body && body.device_token) || '').trim();
    if (!deviceToken) return { devices, push_disabled: pushDisabled, device_owner: null };

    const answer = await httpsCallable(firebaseFunctions(), 'pushDeviceOwner')({ token: deviceToken });
    return {
      devices,
      push_disabled: pushDisabled,
      device_owner: (answer.data && answer.data.device_owner) || null,
    };
  },

  // The officer-only reads, in the same reply shape their callers already read: `result.announcements`,
  // `result.documents`, `result.events`. They return the WHOLE collection rather than an audience-filtered slice,
  // which is what makes them officer reads and why the rules carry an officer branch first - a whole-collection read
  // against an audience rule is a query Firestore refuses to prove.
  // The availability windows, whole. A short officer-maintained list (see utils/availability.js): the recurring weekly
  // patterns a member's own module draws its options from. Small enough to read whole, and it is why the Member
  // Availability tab needs no per-member reference data at all - one list, loaded once, instead of templates,
  // assignments and ranks being assembled per member to work out what somebody was allowed to claim.
  ADMIN_GET_AVAILABILITY_WINDOWS: async () => ({
    availabilityWindows: await rowsOf(collection(firestore(), 'availability_windows')),
  }),

  ADMIN_GET_ANNOUNCEMENTS: async (uid, body) => {
    // The administrator's list is RECENT rows UNION EVERYTHING STILL IN FORCE, which is the union the person managing them
    // needs. A window on `effective_date` alone would hide the notice that has been running since 2021 with no end date -
    // precisely the one worth looking at - and "everything" is the read that grows without limit as a station accumulates
    // notices. The live half is bounded by definition; the recent half is what the window caps. Naming no window still means
    // the whole collection, which is what a harness asks for and what GET_SCHEDULE does with none.
    const from = String((body && body.from) || '').trim();
    if (!from) return { announcements: await rowsOf(collection(firestore(), 'announcements')) };

    const [recent, live] = await Promise.all([
      rowsInRange('announcements', 'effective_date', from, ''),
      rowsInRange('announcements', 'live_until', toDateKey(new Date()), ''),
    ]);
    return { announcements: mergeRowsById(recent, live), announcements_window: { from } };
  },
  ADMIN_GET_EVENTS: () => rowsOf(collection(firestore(), 'events')).then((events) => ({ events })),
  // The officer's list: drafts included, because an author has to see what they are working on, and no rank filter,
  // because managing documents means seeing all of them. The item counts come along - the verification picker shows how
  // many items each checklist has, and it costs one pass rather than one per row - and the order is the library's.
  ADMIN_GET_DOCUMENTS: async () => {
    const documents = await rowsOf(collection(firestore(), 'documents'));
    return { documents: withItemSummaries(documents, await documentItemSummaries('')).sort(documentSort) };
  },

  // The member's own library: the documents they may see, and their own signatures so the screen can show what is
  // outstanding without asking once per document. Deliberately WITHOUT the document bodies - those are fetched one at a
  // time by GET_DOCUMENT, which is what keeps opening the module cheap however large the library gets.
  GET_DOCUMENTS: async (uid) => {
    const audienceKeys = await keysFor(uid);
    const [visible, signatures, summaries] = await Promise.all([
      audienceRows('documents', audienceKeys),
      rowsFor('document_signatures', 'user_id', uid),
      documentItemSummaries(uid, audienceKeys),
    ]);
    const today = stationTodayKey();
    const live = visible.filter((document) => documentIsLive(document, today));
    // Counts attached and the order decided here, because the client draws the list as it arrives: a checklist's row
    // needs `item_count`/`items_signed` to say "3 of 12" at all, and without the sort the library comes back in whatever
    // order the database prefers.
    return { documents: withItemSummaries(live, summaries).sort(documentSort), signatures };
  },

  // One document's body, for a viewer who may see it. A refusal is a REPLY rather than a thrown error, because the
  // screens show `result.message` and the message is the useful part.
  GET_DOCUMENT: async (uid, body) => {
    const wanted = String((body && body.id) || '').trim();
    const document = await visibleDocumentFor(uid, wanted);
    if (!document) return { success: false, message: 'That document is not available.' };

    // The reader's OWN signatures - the rows they are allowed to read - and the document's signature is found among
    // them. The screen shows `signature` as "Signed 12 Mar 2026" and warns with `signature_stale`; without both, a
    // signed document reads as unsigned on its own page while the list, which is handed the signatures, shows the tick.
    const signature = documentSignatureFor(await rowsFor('document_signatures', 'user_id', uid), wanted, uid);
    return {
      success: true,
      document: await documentFullRow(document, document.audience_keys),
      signature,
      signature_stale: signatureIsStale(signature, document),
      // The CALLER'S OWN assessment score, and only that. It travels with the document for the same reason the signature
      // does: the reader opens an assessment and needs "what is my result" in the same request, rather than a second
      // round trip that a document with no score would still have to make to learn it is null.
      //
      // `null` for every other document type, so the screen can read one field without first asking what kind of
      // document it is holding. `assessmentScoreRow` returns null for a member who has never been scored, which is a
      // real answer and not a failure.
      assessment_score: isAssessmentDocument(document) ? await assessmentScoreRow(wanted, uid) : null,
    };
  },

  // The officer's view of the same document: no visibility question, because managing documents is the job - and the
  // WHOLE row, because the editor round-trips every field it shows and a projection would quietly blank the ones it
  // did not return. The body and the checklist items join it here for the same reason.
  ADMIN_GET_DOCUMENT: async (uid, body) => {
    const wanted = String((body && body.id) || '').trim();
    if (!wanted) return { success: false, message: 'Which document?' };
    const snapshot = await getDoc(doc(firestore(), 'documents', wanted));
    if (!snapshot.exists()) return { success: false, message: 'That document is not available.' };
    return { success: true, document: await documentFullRow({ ...snapshot.data(), id: snapshot.id }) };
  },

  // A verifier's view of ONE member's paperwork: the documents that MEMBER can see, and their signatures. The same
  // shape as GET_DOCUMENTS, aimed at somebody else - which is what the can_verify_documents permission is for: reading
  // people's paperwork in order to confirm it.
  //
  // What stops a member reading anybody else's is the RULES: the read rule allows can_verify_documents, so this query is
  // provable for a verifier and refused for everyone else. That is what gates the ACTION; what shapes the ANSWER is
  // `mayReadWholeDocuments` below, and the two are deliberately different questions - a permission decides WHO may ask,
  // and never WHAT they are shown.
  GET_MEMBER_DOCUMENT_RECORDS: async (uid, body) => {
    const memberId = String((body && body.user_id) || '').trim();
    if (!memberId) return { success: false, message: 'Which member?' };

    const member = await getDoc(doc(firestore(), 'users', memberId));
    if (!member.exists()) return { success: false, message: 'That member no longer exists.' };

    // THE WHOLE COLLECTION FOR AN OFFICER, the member's own audience for anybody else - see `mayReadWholeDocuments`.
    // The member's rank and role still decide what that member OWES; they no longer decide what the officer looking at
    // their records is shown, which was the bug: a document whose minimum rank sat above the viewed member's was
    // missing from the report, so an officer could conclude a member owed nothing when the station simply had not asked.
    const wholeCollection = await mayReadWholeDocuments(uid);
    const [visible, signatures, summaries] = await Promise.all([
      wholeCollection ? rowsOf(collection(firestore(), 'documents')) : audienceRows('documents', audienceKeysFor({
        userId: memberId,
        roleId: String((member.data() || {}).role_id || ''),
        rankId: String((member.data() || {}).rank_id || ''),
      })),
      rowsFor('document_signatures', 'user_id', memberId),
      documentItemSummaries(memberId),
    ]);
    const today = stationTodayKey();
    // The counts are THAT MEMBER's progress, not the verifier's: the verifier is looking at what this person has done,
    // which is the whole point of the screen.
    const live = visible.filter((document) => documentIsLive(document, today));
    return { documents: withItemSummaries(live, summaries).sort(documentSort), signatures };
  },

  // ONE MEMBER'S score on ONE assessment, for somebody who may add scores. The lookup behind the panel's member picker:
  // pick a member, and this answers "what is already on file for them" so the officer edits the existing score rather
  // than replacing it with a blank.
  //
  // IT IS A SEPARATE ACTION FROM GET_DOCUMENT, and that is the whole point of the asymmetry the requirement asks for.
  // GET_DOCUMENT hands the CALLER their own score and nobody can ask it for anybody else's, because the member is not
  // named anywhere in it - it is taken from the session. This one names the member in the request, which is what an
  // officer needs and what the RULES then have to agree to. There is deliberately no branch here for a plain member:
  // a member asking this is refused by the rules (the row is not theirs), and the client is not offered the control.
  //
  // It checks the DOCUMENT is an assessment as well as checking it exists, so a stale panel pointed at a document that
  // has since been retyped reports the truth instead of hunting for a score that can never exist on it.
  GET_MEMBER_ASSESSMENT_SCORE: async (uid, body) => {
    const documentId = String((body && body.document_id) || body && body.id || '').trim();
    const memberId = String((body && body.user_id) || '').trim();
    if (!documentId) return { success: false, message: 'Which assessment?' };
    if (!memberId) return { success: false, message: 'Which member?' };

    const snapshot = await getDoc(doc(firestore(), 'documents', documentId));
    if (!snapshot.exists()) return { success: false, message: 'That document is not available.' };
    if (!isAssessmentDocument({ ...snapshot.data(), id: snapshot.id })) {
      return { success: false, message: 'That document is not an assessment.' };
    }

    return { success: true, score: await assessmentScoreRow(documentId, memberId) };
  },

  // ONE MEMBER'S BADGES, for the screens that draw a few names.
  //
  // WHY NOT THE ROSTER'S WHOLE INDEX. `GET_ROSTER` reads every member's badge document, which is right for Schedule and
  // Administration - they draw names all over the place and a station of thirty is thirty documents. But the dashboard
  // draws the handful of people currently on duty, and the sidebar draws the signed-in member on EVERY screen. Reading
  // thirty documents to put two icons beside two names is the cost the sign-in payload change was made to avoid, and
  // spreading it back would undo that for the screens that draw least.
  //
  // SO THIS ASKS FOR THE IDS AND ONLY THOSE. A `getDoc` per id, not a query: the rule on this collection is
  // `allow read: if signedIn()` with no audience, so a query would need nothing special - but a query on a collection of
  // one document per member is the thing that costs a full collection read the moment a second member is named, and the
  // whole point of asking for ids is to keep the bill proportional to what is on screen.
  //
  // A member with NO badges has no document at all, so they are simply absent from the answer. That is not "unknown" -
  // `mergeCertificationBadges` is told which ids were asked about by the keys the caller passed, so the app can tell the
  // two apart and not ask again.
  // ONE MEMBER'S BADGES, for the screens that draw a few names - the dashboard's on-duty card and the sidebar's own
  // badges. Sits beside GET_ROSTER rather than replacing it: the roster read is the WHOLE index for the screens that draw
  // many names, and this is the same data for the screens that draw two.
  GET_CERTIFICATION_BADGES: async (uid, body) => {
    const wanted = Array.isArray(body && body.user_ids) ? body.user_ids : [];
    const ids = [...new Set(wanted.map((id) => String(id || '').trim()).filter(Boolean))];
    if (!ids.length) return { badges: {}, asked: [] };

    const snapshots = await Promise.all(
      ids.map((id) => getDoc(doc(firestore(), 'certification_badges', id)).then((snap) => [id, snap]))
    );
    // `.exists()` is a METHOD in the client SDK - the Admin SDK is where it is a property, and a function reference is
    // truthy, so this would otherwise report every member as holding a (blank) badge.
    const badges = Object.fromEntries(
      snapshots
        .filter(([, snap]) => snap.exists())
        .map(([id, snap]) => [id, (snap.data() || {}).badges || []])
    );
    return { badges, asked: ids };
  },

  // A document's checklist items and the signatures taken on it: the one read the Documents tab makes per document.
  //
  // It was NOT ROUTED until an officer opened the tab and got "GET_DOCUMENT_SIGNATURES was not routed". The collections,
  // the rules and the client all existed - only this reader and the table entry were missing, and nothing complained
  // while the sheet was still answering. That is the whole shape of the gap the routing table's two-direction check
  // now closes.
  //
  // `items` travel with the signatures because the panel shows the checklist's rows: reading the labels separately would
  // mean a verifier could hold the signatures but not the words they signed. The document's TEXT is never included.
  //
  // `stale` is decided HERE, against the document as it stands now - the same judgment the sheet made in the same
  // place, and for the same reason: a document whose wording changed under a signature must read the same way on every
  // screen, rather than each screen deciding for itself.
  GET_DOCUMENT_SIGNATURES: async (uid, body) => {
    const documentId = String((body && body.id) || '').trim();
    if (!documentId) return { items: [], signatures: [] };

    const [items, signatures, document] = await Promise.all([
      rowsFor('document_checklist_items', 'document_id', documentId),
      rowsFor('document_signatures', 'document_id', documentId),
      getDoc(doc(firestore(), 'documents', documentId)),
    ]);

    const revision = (row) => {
      const value = parseInt(row && row.content_revision, 10);
      return Number.isFinite(value) ? value : null;
    };
    // `.exists()` is a METHOD in the client SDK - the Admin SDK is where it is a property, and the two are easy to
    // confuse. This read worked by accident with the property form (a function reference is truthy), which is exactly
    // the sort of thing that works until the day the document is missing.
    const currentRevision = revision(document.exists() ? document.data() : null);

    return {
      items: items
        .map((item) => ({
          id: String(item.id || ''),
          document_id: String(item.document_id || ''),
          sort_order: parseInt(item.sort_order, 10) || 0,
          section: String(item.section || ''),
          label: String(item.label || ''),
        }))
        .sort((a, b) => a.sort_order - b.sort_order || (a.id < b.id ? -1 : 1)),
      // Newest first, which is the order the sheet sent them in. The id breaks a tie so the order is total.
      signatures: signatures
        .map((signature) => ({
          ...signature,
          stale:
            currentRevision !== null &&
            revision(signature) !== null &&
            revision(signature) < currentRevision,
        }))
        .sort((a, b) => {
          const aAt = String(a.signed_at || '');
          const bAt = String(b.signed_at || '');
          if (aAt !== bAt) return aAt < bAt ? 1 : -1;
          return String(a.id || '') < String(b.id || '') ? -1 : 1;
        }),
    };
  },

  // The officer's pending-approvals list: every offer, whole, which is why the rules give the permission its own branch.
  // One line, and it was missing - the tab was refreshing from the sheet after each approval, which is exactly the sort
  // of "it works today" that the two-direction check now makes visible.
  ADMIN_GET_SCHEDULE_OFFERS: async () => ({ offers: await pendingOffers(firestore()) }),

  // The notifications tab's per-member picture, which the sheet built from three sheets and this builds from three
  // collections: the member's row (for the name), their settings (for the preferences the table shows) and the device
  // rows (for the counts). One read rather than three round trips, and the device count is the honest answer to "why is
  // nothing arriving" - one silent device is a device problem, none is a member who never set one up.
  ADMIN_GET_PUSH_STATUS: async () => {
    const [users, settings, devices] = await Promise.all([
      readUsersOnce(),
      rowsOf(collection(firestore(), 'user_settings')),
      rowsOf(collection(firestore(), 'push_devices')),
    ]);

    const settingsById = new Map(settings.map((row) => [String(row.id || ''), row]));
    const counts = new Map();
    devices.forEach((device) => {
      const id = String(device.user_id || '');
      if (id) counts.set(id, (counts.get(id) || 0) + 1);
    });

    return {
      users: users.map((user) => {
        const id = String(user.id || '');
        const prefs = settingsById.get(id) || {};
        const count = counts.get(id) || 0;
        return {
          ...user,
          ...prefs,
          id,
          device_count: count,
          device_registered: count > 0,
          push_disabled: prefs.is_push_disabled === true,
        };
      }),
    };
  },

  // The station leaderboard: personal bests above zero, highest first, capped at the rows the game draws.
  //
  // NO PERMISSION, deliberately - "anyone who can play can see the board" - and that is also why it is a reader rather
  // than a callable: `users` is readable by any signed-in member, and the projection is the board's own three fields, an
  // id (to highlight your own row), a name and a score. Nobody needs an officer's read of anybody's personnel record to
  // see a number in a side-scroller.
  //
  // `total` counts everybody with a score; the board itself is capped. The two differing is not a bug, it is how the game
  // says "you are 30th of 40" without shipping 40 rows to a phone.
  //
  // THERE IS NO ORDER BY IN A QUERY HERE, and that is not a shortcut. A Firestore `orderBy('runner_score')` DROPS every
  // member who has never played, because a document without the field is not in the index at all - so "everybody who has
  // played, highest first" would come back as "everybody who has played, with the newly joined missing". Filtering here
  // costs one read of a collection this file already reads whole in three other readers.
  // THE STATION LEADERBOARD, as a QUERY rather than a scan. This used to read the whole `users` collection and pick the top
  // rows out of it in the browser: N reads on every play, on the most repeated screen in the app. It is now bounded by the
  // limit it actually needs, plus one count for the total ("you are 30th of 40" needs a number, not 40 rows).
  //
  // IT IS SAFE BECAUSE `runner_score` IS NUMERIC IN THE DATABASE, and that claim has two keepers rather than a hope: the only
  // thing that writes it in the app is the `saveRunnerScore` callable, which parses to an integer and clamps it, and the
  // sheet migration carries the column as a number (`runner_score` is in NUMERIC_COLUMNS, scripts/migration-map.mjs - it was
  // not, until this read needed it to be). A score stored as TEXT is not greater than zero, so a text score makes its owner
  // disappear from the board rather than appear with a wrong figure - which is why scripts/normalize-runner-scores.mjs
  // exists, and why scripts/verify-firestore-reads.mjs shows what a text score does here before normalizing one away.
  //
  // THE ORDER IS BY THE FIELD THAT IS FILTERED, so no composite index is involved. One difference from the sheet this
  // replaces: a TIE comes back in the database's order, where the sheet's own row order broke it. That is the one guarantee
  // the sheet could make and this cannot, so the pure harness that pins tie-breaking pins the SHEET's implementation, which
  // is still live until the sheet is retired.
  GET_RUNNER_LEADERBOARD: async () => {
    // The filter is the whole condition; the board adds an order and a cap TO IT, and the count does not. Building the count
    // from the capped query instead is how a station with more than 25 scorers reports "of 25" - a wrong number nothing else
    // would notice, which is why the harness seeds more than a board's worth and asserts both numbers.
    const scored = () => query(collection(firestore(), 'users'), where('runner_score', '>', 0));
    const [rows, counted] = await Promise.all([
      getDocs(query(scored(), orderBy('runner_score', 'desc'), limit(RUNNER_LEADERBOARD_LIMIT))),
      getCountFromServer(scored()),
    ]);

    return {
      leaderboard: rows.docs.map((entry) => {
        const data = entry.data() || {};
        return { id: String(entry.id), name: String(data.name || '').trim(), score: Number(data.runner_score) || 0 };
      }),
      // Everyone with a score, which is what the board needs to say where a member stands; the rows themselves are capped.
      total: counted.data().count,
    };
  },

  // Whether this deployment can send pushes at all, answered by the runtime rather than inferred by the browser: the
  // credential is the Cloud Functions service account, which is why there is nothing for an administrator to fill in on
  // Firebase and why the sheet's four script-property fields have no counterpart here.
  ADMIN_GET_FCM_STATUS: async () => {
    const answer = await httpsCallable(firebaseFunctions(), 'fcmStatus')({});
    return answer.data || {};
  },

  // THE FORM DEFINITIONS this caller may generate, from the audience they carry. One question, asked the way
  // announcements are asked: the rules prove the SAME array-contains-any over the viewer's own keys, so the read works
  // exactly because the rule does. `enabled` is filtered HERE rather than in the rule, because a rule condition the
  // query does not filter on would make the query unprovable and the read would fail as a whole.
  GET_FORM_TEMPLATES: async (uid) => ({
    forms: (await audienceRows('form_templates', await keysFor(uid))).filter((form) => form.enabled !== false),
  }),
  // The officer's list: every definition, disabled ones included, because whoever configures them has to see what they
  // are working on. Gated by `can_configure_forms` - the same flag the tab and the rule use.
  ADMIN_GET_FORM_TEMPLATES: async () => ({
    forms: (await rowsOf(collection(firestore(), 'form_templates'))).sort((left, right) =>
      String(left.name || '').localeCompare(String(right.name || ''))
    ),
  }),
  // One member's training, for a form's `training_summary` source: the catalogue every signed-in member may read, and
  // THAT member's signatures. The subject is scoped IN THE QUERY (`user_id ==`), so the rules can prove it - a member
  // reads their own, and an officer with `can_administer_trainings` reads anybody's, which is the branch the rule
  // already carried. Asking for somebody else without that permission is refused by the rules, as it should be.
  GET_MEMBER_TRAINING: async (uid, body) => {
    const subject = String((body && body.userId) || '').trim() || uid;
    const [trainings, signatures] = await Promise.all([
      rowsOf(collection(firestore(), 'trainings')),
      rowsFor('training_signatures', 'user_id', subject),
    ]);
    return { trainings, signatures };
  },

// The pre-login payload: what the loading and login screens need before anybody has signed in.
//
// IT IS ONE DOCUMENT, and that is the whole point. The rules let anybody read `settings/public` and deliberately refuse
// everything else to a caller with no identity - roles, ranks and shifts are station data, not public data. This action
// used to ask for those three anyway and omit them when refused, which is a round trip spent being told no, and it asked
// for the login-screen announcements, which was the only reason a stranger needed to read a collection at all. That
// location is gone (utils/announcements#ANNOUNCEMENT_LOCATIONS): the sign-in payload fills the rest in a moment later, and
// anything that must be read before signing in is code in LoginScreen rather than a row in a form.
  GET_INITIAL_DATA: async () => {
    const settings = await getDoc(doc(firestore(), 'settings', 'public'));
    return { systemSettings: settingRows(settings) };
  },
};
