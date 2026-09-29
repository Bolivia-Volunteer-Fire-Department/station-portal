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
import { collection, doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { audienceKeysFor, audienceRows, rowsFor, rowsOf, settingRows } from './firestorePayload.js';
import { firebaseFunctions, firestore } from './firebase.js';

// The roster as the schedule stores it: an id, a name and a rank. Read while the calendar labels other people's
// shifts, so it is deliberately the narrow projection.
const rosterRows = async () => {
  const users = await rowsOf(collection(firestore(), 'users'));
  return users.map((user) => ({ id: user.id, name: user.name, rank_id: user.rank_id }));
};

// Who is on duty, joined to names - the same join the payload does, because the dashboard draws names.
const onDutyRows = async (uid) => {
  const [duty, users] = await Promise.all([rowsOf(collection(firestore(), 'on_duty')), rowsOf(collection(firestore(), 'users'))]);
  const nameById = Object.fromEntries(users.map((user) => [user.id, user.name]));
  return duty.map((row) => ({ ...row, name: nameById[row.id] || '' , user_id: row.id }));
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
  const from = String(row.date_from || '').trim();
  const to = String(row.date_to || '').trim();
  if (from && today < from) return false;
  if (to && today > to) return false;
  return true;
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
  GET_ROSTER: () => rosterRows().then((roster) => ({ roster })),
  GET_TIMECLOCK_LOGS: (uid) => rowsFor('timeclock', 'user_id', uid).then((logs) => ({ logs })),
  GET_SCHEDULE: () => rowsOf(collection(firestore(), 'schedule')).then((schedule) => ({ schedule })),
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
  ADMIN_GET_DOCUMENTS: () => rowsOf(collection(firestore(), 'documents')).then((documents) => ({ documents })),

  // The member's own library: the documents they may see, and their own signatures so the screen can show what is
  // outstanding without asking once per document. Deliberately WITHOUT the document bodies - those are fetched one at a
  // time by GET_DOCUMENT, which is what keeps opening the module cheap however large the library gets.
  GET_DOCUMENTS: async (uid) => {
    const [visible, signatures] = await Promise.all([
      audienceRows('documents', await keysFor(uid)),
      rowsFor('document_signatures', 'user_id', uid),
    ]);
    const today = stationDateKey();
    return { documents: visible.filter((document) => documentIsLive(document, today)), signatures };
  },

  // One document's body, for a viewer who may see it. A refusal is a REPLY rather than a thrown error, because the
  // screens show `result.message` and the message is the useful part.
  GET_DOCUMENT: async (uid, body) => {
    const document = await visibleDocumentFor(uid, body && body.id);
    if (!document) return { success: false, message: 'That document is not available.' };
    return { success: true, document };
  },

  // The officer's view of the same document: no visibility question, because managing documents is the job - and the
  // WHOLE row, because the editor round-trips every field it shows and a projection would quietly blank the ones it
  // did not return.
  ADMIN_GET_DOCUMENT: async (uid, body) => {
    const wanted = String((body && body.id) || '').trim();
    if (!wanted) return { success: false, message: 'Which document?' };
    const snapshot = await getDoc(doc(firestore(), 'documents', wanted));
    if (!snapshot.exists()) return { success: false, message: 'That document is not available.' };
    return { success: true, document: { id: snapshot.id, ...snapshot.data() } };
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

    const [visible, signatures] = await Promise.all([
      audienceRows('documents', keys),
      rowsFor('document_signatures', 'user_id', memberId),
    ]);
    const today = stationDateKey();
    return { documents: visible.filter((document) => documentIsLive(document, today)), signatures };
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
      rowsOf(collection(firestore(), 'users')),
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
  GET_RUNNER_LEADERBOARD: async () => {
    const users = await rowsOf(collection(firestore(), 'users'));
    const scored = users
      .map((user) => ({
        id: String(user.id || ''),
        name: String(user.name || '').trim(),
        score: Number(user.runner_score) || 0,
      }))
      .filter((entry) => entry.id && entry.score > 0)
      .sort((a, b) => b.score - a.score);

    return { leaderboard: scored.slice(0, RUNNER_LEADERBOARD_LIMIT), total: scored.length };
  },

  // Whether this deployment can send pushes at all, answered by the runtime rather than inferred by the browser: the
  // credential is the Cloud Functions service account, which is why there is nothing for an administrator to fill in on
  // Firebase and why the sheet's four script-property fields have no counterpart here.
  ADMIN_GET_FCM_STATUS: async () => {
    const answer = await httpsCallable(firebaseFunctions(), 'fcmStatus')({});
    return answer.data || {};
  },

  // The system log, one page at a time - and the one officer read that is a callable rather than a query, for reasons
  // that come from the shape of the contract rather than from convenience: the response carries the counts and the
  // filter dropdown's facets for the WHOLE log, which no page can supply, and the log names members and records failed
  // sign-ins. See readSystemLog in functions/index.js, where the permission is checked server-side and the sheet's
  // filtering, sorting and paging are reproduced exactly - including the two things a Firestore query would do
  // differently (case-sensitive matching, and missing values sorting first).
  ADMIN_GET_SYSTEM_LOG: async (uid, body) => {
    const query = {
      page: (body && body.page) || 1,
      page_size: (body && body.page_size) || '',
      sort: (body && body.sort) || '',
      from: (body && body.from) || '',
      to: (body && body.to) || '',
      action_filter: (body && body.action_filter) || '',
      member: (body && body.member) || '',
    };
    const answer = await httpsCallable(firebaseFunctions(), 'readSystemLog')(query);
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
