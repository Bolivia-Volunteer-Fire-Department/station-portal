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
import { audienceKeysFor, audienceRows, readUsersOnce, rowsFor, rowsInRange, rowsOf, settingRows } from './firestorePayload.js';
import { firebaseFunctions, firestore } from './firebase.js';

// The roster the calendar used to ask for separately (`GET_ROSTER`, now retired) is a projection of `users` that the sign-in
// payload already carries - see the note where the route used to be listed, in firestoreRouting.js. Nothing in the app asks
// for it as its own read, so there is no reader here for it.

// Who is on duty, joined to names and ranks - the same join the payload does, because the dashboard draws a name and a rank
// icon. The reader used to leave `rank_id` out, so the same member appeared with a rank after a sign-in and with a generic
// icon after a refresh; the payload's row has always carried it (see services/liveReads.js, which builds the same three
// fields).
const onDutyRows = async (uid) => {
  const [duty, users] = await Promise.all([rowsOf(collection(firestore(), 'on_duty')), readUsersOnce()]);
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

// A read that is allowed to come back empty. Used only by the pre-login payload, where the rules decide what a caller
// with no identity may see and a refusal is an answer rather than a failure.
const quietly = (read) => read().catch(() => null);

// The station's date, in the same 'YYYY-MM-DD' shape the app stores date keys in. A document's date window is compared
// against this rather than against UTC, so a document that expires "today" expires on the station's today.
const stationDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const at = (type) => parts.find((part) => part.type === type).value;
  return `${at('year')}-${at('month')}-${at('day')}`;
};

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
// Mirrors documentItemRows in Code.gs, including its two refusals: a row with no id or no label is not an item, and the
// order is the checklist's own - sort_order, then the label - rather than whatever the database hands back. THE ITEMS
// TRAVEL WITH THE DOCUMENT because the member's screen draws them from there (checklistSections(openDocument.items)), so
// a document opened without them reads as a checklist with nothing in it - which is exactly what it did, while the items
// sat in the collection the whole time.
const checklistItemRows = async (documentId) => {
  const wanted = String(documentId || '').trim();
  if (!wanted) return [];

  const items = await rowsFor('document_checklist_items', 'document_id', wanted);
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

// How many items each checklist holds, and how many of them one member has signed - the two numbers a checklist's
// progress needs, because a checklist is signed item by item and a document-level signature says nothing about it.
//
// One pass over each collection rather than a lookup per row, which is what the sheet did and why a library of a hundred
// documents stays cheap. `userId` of '' (the officer's list) leaves `items_signed` at 0: "signed by whom" is not a
// question the editor asks, and the sheet answered it the same way.
const documentItemSummaries = async (userId) => {
  const wantedUser = String(userId || '').trim();
  const items = await rowsOf(collection(firestore(), 'document_checklist_items'));
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
// The body is ON THE ROW (`content`), which is worth stating because docs/FIRESTORE_MODEL.md describes a
// `document_bodies` split that was never built: no writer, no rules, no migration entry. A reader that looked for the
// body there got a permission-denied from the deny-by-default catch-all and no content at all - so this reads the row,
// and the doc is the thing to fix when the split is wanted for real.
const documentFullRow = async (row) => {
  const source = row || {};
  const content = String(source.content ?? '');
  return {
    ...source,
    content,
    // The list never carries a length (it has no body to measure where the body is split out); the sheet sent one with
    // every row, and the screens that show a document's size read it from here.
    content_length: content.length,
    items: String(source.doc_type || '').trim().toLowerCase() === 'checklist' ? await checklistItemRows(source.id) : [],
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
    if (snapshot.exists()) document = { id: snapshot.id, ...snapshot.data() };
  } catch {
    return null;
  }
  if (!document) return null;

  const mine = await keysFor(uid);
  const audience = Array.isArray(document.audience_keys) ? document.audience_keys : [];
  if (!audience.some((key) => mine.includes(String(key)))) return null;
  if (!documentIsLive(document, stationDateKey())) return null;
  return document;
};

// The rows the game draws. The board is capped at this and `total` is not, which is the difference that matters: 25 rows
// and "of 40" tells a member who has not played yet that there is a board to join.
const RUNNER_LEADERBOARD_LIMIT = 25;

export const READERS = {
  GET_ON_DUTY: (uid) => onDutyRows(uid).then((onDuty) => ({ onDuty })),
  GET_TIMECLOCK_LOGS: (uid) => rowsFor('timeclock', 'user_id', uid).then((logs) => ({ logs })),
  // The station's schedule, optionally WINDOWED - and a window is what the app always asks for, because `schedule` is the
  // one collection that grows without limit. A caller that names no window is asking for every shift the station has ever
  // scheduled: that is what the harnesses do, and what a screen that has not been scoped yet would do. Slow rather than
  // wrong, which is the right way round for the default.
  GET_SCHEDULE: async (uid, body) => {
    const from = String((body && body.from) || '').trim();
    const to = String((body && body.to) || '').trim();
    const schedule =
      from || to
        ? await rowsInRange('schedule', 'date_from', from, to)
        : await rowsOf(collection(firestore(), 'schedule'));
    // The window comes back with the rows, so a caller can tell what it holds rather than assuming it holds everything.
    return { schedule, schedule_window: { from, to } };
  },
  GET_AVAILABILITY: (uid) => rowsFor('availability', 'user_id', uid).then((availability) => ({ availability })),
  GET_SHIFT_OFFERS: (uid) => rowsFor('schedule_offers', 'user_id', uid).then((offers) => ({ offers })),
  GET_TRAINING: () => rowsOf(collection(firestore(), 'trainings')).then((trainings) => ({ trainings })),
  GET_CERTIFICATIONS: (uid) =>
    rowsFor('certifications', 'user_id', uid).then((certifications) => ({ certifications })),
  MY_ANNOUNCEMENTS: async (uid) => ({ announcements: await audienceRows('announcements', await keysFor(uid)) }),
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
  ADMIN_GET_ANNOUNCEMENTS: () => rowsOf(collection(firestore(), 'announcements')).then((announcements) => ({ announcements })),
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
    const [visible, signatures, summaries] = await Promise.all([
      audienceRows('documents', await keysFor(uid)),
      rowsFor('document_signatures', 'user_id', uid),
      documentItemSummaries(uid),
    ]);
    const today = stationDateKey();
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
      document: await documentFullRow(document),
      signature,
      signature_stale: signatureIsStale(signature, document),
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
    return { success: true, document: await documentFullRow({ id: snapshot.id, ...snapshot.data() }) };
  },

  // A verifier's view of ONE member's paperwork: the documents that MEMBER can see, and their signatures. The same
  // shape as GET_DOCUMENTS, aimed at somebody else - which is what the can_verify_documents permission is for: reading
  // people's paperwork in order to confirm it.
  //
  // The documents are filtered by the MEMBER's audience rather than the verifier's, deliberately: the verifier is looking
  // at what this member was shown, so a document aimed at a rank they do not hold has no business appearing in their
  // records. What stops a member reading anybody else's is the RULES: the read rule allows can_verify_documents, so this
  // query is provable for a verifier and refused for everyone else.
  GET_MEMBER_DOCUMENT_RECORDS: async (uid, body) => {
    const memberId = String((body && body.user_id) || '').trim();
    if (!memberId) return { success: false, message: 'Which member?' };

    const member = await getDoc(doc(firestore(), 'users', memberId));
    if (!member.exists()) return { success: false, message: 'That member no longer exists.' };

    const row = member.data() || {};
    const keys = audienceKeysFor({
      userId: memberId,
      roleId: String(row.role_id || ''),
      rankId: String(row.rank_id || ''),
    });

    const [visible, signatures, summaries] = await Promise.all([
      audienceRows('documents', keys),
      rowsFor('document_signatures', 'user_id', memberId),
      documentItemSummaries(memberId),
    ]);
    const today = stationDateKey();
    // The counts are THAT MEMBER's progress, not the verifier's: the verifier is looking at what this person has done,
    // which is the whole point of the screen.
    const live = visible.filter((document) => documentIsLive(document, today));
    return { documents: withItemSummaries(live, summaries).sort(documentSort), signatures };
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
  ADMIN_GET_SCHEDULE_OFFERS: () => rowsOf(collection(firestore(), 'schedule_offers')).then((offers) => ({ offers })),

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

  // The audit log, read ON DEMAND from Cloud Logging. Nothing in the app reads it otherwise, and that is the point: the
  // lines are written for nothing by the functions, and this asks the Logging API for one page when an officer opens the
  // tab. The response is FORWARD-PAGED (a token, and no total) because that is what the API offers - the sheet's
  // "page 3 of 12" needed the whole log in hand, which is the cost this design exists to avoid.
  ADMIN_GET_SYSTEM_LOG: async (uid, body) => {
    const answer = await httpsCallable(firebaseFunctions(), 'readSystemLog')({
      page_size: (body && body.page_size) || '',
      sort: (body && body.sort) || '',
      from: (body && body.from) || '',
      to: (body && body.to) || '',
      action_filter: (body && body.action_filter) || '',
      member: (body && body.member) || '',
      page_token: (body && body.page_token) || '',
    });
    return answer.data || {};
  },

// The pre-login payload: what the loading screen needs before anybody has signed in.
//
// It reads what it can and OMITS what it cannot, rather than failing: the rules let anybody read `settings/public`,
// and deliberately refuse roles, ranks and shifts to a caller with no identity - they are station data, not public
// data. So those three are best-effort, and the sign-in payload fills them in a moment later. That asymmetry is the
// point: this action is the ONE read the app makes before it knows who is asking.
  GET_INITIAL_DATA: async () => {
    const [settings, roles, ranks, shifts, announcements] = await Promise.all([
      getDoc(doc(firestore(), 'settings', 'public')),
      quietly(() => rowsOf(collection(firestore(), 'roles'))),
      quietly(() => rowsOf(collection(firestore(), 'ranks'))),
      quietly(() => rowsOf(collection(firestore(), 'shifts'))),
      quietly(() => audienceRows('announcements', ['*'])),
    ]);
    return {
      systemSettings: settingRows(settings),
      ...(roles ? { roles } : {}),
      ...(ranks ? { ranks } : {}),
      ...(shifts ? { shifts } : {}),
      ...(announcements ? { announcements } : {}),
    };
  },
};
