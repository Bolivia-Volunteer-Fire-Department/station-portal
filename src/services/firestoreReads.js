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
import { audienceKeysFor, audienceRows, rowsFor, rowsOf, settingRows } from './firestorePayload.js';
import { firestore } from './firebase.js';

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
  MY_PUSH_DEVICES: (uid) => rowsFor('push_devices', 'user_id', uid).then((devices) => ({ devices })),

  // The officer-only reads, in the same reply shape their callers already read: `result.announcements`,
  // `result.documents`, `result.events`. They return the WHOLE collection rather than an audience-filtered slice,
  // which is what makes them officer reads and why the rules carry an officer branch first - a whole-collection read
  // against an audience rule is a query Firestore refuses to prove.
  ADMIN_GET_ANNOUNCEMENTS: () => rowsOf(collection(firestore(), 'announcements')).then((announcements) => ({ announcements })),
  ADMIN_GET_EVENTS: () => rowsOf(collection(firestore(), 'events')).then((events) => ({ events })),
  ADMIN_GET_DOCUMENTS: () => rowsOf(collection(firestore(), 'documents')).then((documents) => ({ documents })),

  GET_INITIAL_DATA: async () => {
    const [settings, roles] = await Promise.all([
      getDoc(doc(firestore(), 'settings', 'public')),
      rowsOf(collection(firestore(), 'roles')),
    ]);
    return { systemSettings: settingRows(settings), roles };
  },
};
