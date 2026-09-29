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
    const devices = await rowsFor('push_devices', 'user_id', uid);

    // The second half of this read, and the reason it needed a callable: "whose device is this browser?" is a
    // question the browser cannot answer, because a member may read their own rows and nobody else's - so another
    // member's token reads as nothing at all, and a shared computer would look like the signed-in member's own. The
    // sheet answered it server-side for exactly the same reason, and so does `pushDeviceOwner`.
    //
    // The token is the one this browser's own service worker holds, passed in by the card that asks the question.
    const deviceToken = String((body && body.device_token) || '').trim();
    if (!deviceToken) return { devices, device_owner: null };

    const answer = await httpsCallable(firebaseFunctions(), 'pushDeviceOwner')({ token: deviceToken });
    return { devices, device_owner: (answer.data && answer.data.device_owner) || null };
  },

  // The officer-only reads, in the same reply shape their callers already read: `result.announcements`,
  // `result.documents`, `result.events`. They return the WHOLE collection rather than an audience-filtered slice,
  // which is what makes them officer reads and why the rules carry an officer branch first - a whole-collection read
  // against an audience rule is a query Firestore refuses to prove.
  ADMIN_GET_ANNOUNCEMENTS: () => rowsOf(collection(firestore(), 'announcements')).then((announcements) => ({ announcements })),
  ADMIN_GET_EVENTS: () => rowsOf(collection(firestore(), 'events')).then((events) => ({ events })),
  ADMIN_GET_DOCUMENTS: () => rowsOf(collection(firestore(), 'documents')).then((documents) => ({ documents })),

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
