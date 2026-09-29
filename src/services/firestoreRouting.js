// Which actions `api.js` sends to Firestore instead of Apps Script, and the conditions under which it may.
//
// THE SWITCH IS PER FEATURE, NOT PER ACTION, and that is the point of this module. The two backends run side by side
// during the move, so a write that lands on one side of a read is invisible to the reader - a member saves
// availability into Firestore while their own sign-in payload still comes from the sheet, and the save disappears on
// reload. That reads as data loss, not as half a finished migration. So a feature is named here together with the
// reads it depends on, and it routes ONLY when those are routed too.
//
// Four conditions, all of which must hold before anything goes anywhere but Apps Script:
//
//   1. `VITE_FIRESTORE_FEATURES` names the feature (or is `*`). Nothing is routed by default, which is what keeps
//      this file inert in every build that has not been switched on.
//   2. Firebase is configured at all (`firebaseConfigured()`) - so a build without the VITE_FIREBASE_* values
//      cannot route anything, whatever the features list says.
//   3. The feature's `requires` list is enabled as well. This is the guard against half a feature.
//   4. Somebody is signed in to FIREBASE, not just to Apps Script. Those are separate: the app still signs in
//      through Apps Script and gets a session token, and a Firestore write with no Firebase user has no uid to
//      write and no rule to satisfy. **Until the login is wired to Firebase Auth, every route here falls through to
//      Apps Script** - which is why this can land safely before the login does.
//
// When it does not route it says so once in the console and returns null, so the caller does what it always did.
// Nothing here falls back AFTER a Firestore attempt: a write that failed may still have landed (the same reasoning
// as the BUSY retry in api.js), so routing is decided before the request, never after it.
import { firebaseConfigured } from './firebase.js';

// `import.meta.env` is Vite's and `process.env` is Node's, so a harness can exercise this module as well as Vite
// building it. Same pattern as firebase.js, which needs it for the emulator host.
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const setting = (key) => env[key] ?? (typeof process !== 'undefined' ? process.env[key] : undefined);

// Which features are switched on. Firebase being configured is what makes a build a Firestore build, so an
// environment variable is the wrong place to require consent from - the OVERRIDE is what the variable is for:
//
//   unset            every feature whose prerequisites are met. A configured build routes; an unconfigured one
//                    cannot, so this is the default the dev loop wants and the deployed site inherits.
//   a list of names  only those (so `memberPayload` is a legitimate way to hold part of the move back).
//   `off` or `none`  nothing, which is the kill switch.
const enabledFeatures = () =>
  String(setting('VITE_FIRESTORE_FEATURES') || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

const featureIsOn = (name) => {
  const named = enabledFeatures();
  if (named.includes('off') || named.includes('none')) return false;
  return named.length === 0 || named.includes('*') || named.includes(name);
};

// The features, their prerequisites, and the actions each one dispatches.
//
// `requires` names the features that must be switched on first, and it is a statement about the DATA rather than
// about the code: a write is only safe once the read that shows it reads the same place. `switchReads` lists the
// read actions that have to move with it - recorded even while they are unwired, because an unlisted one is how
// this gets got wrong.
//
// `clock` is a feature like any other, and its fence is a DECISION rather than an oversight: the station boundary is
// checked in the browser (src/utils/clockLocation.js) and in Code.gs today, and the owner has chosen to keep it in
// the browser only. Rules cannot do the arithmetic and a callable would be the robust answer - but the risk here is
// a member lying about their own location on their own timesheet, and that is not a risk this station judges worth a
// server round trip on every clock press. What is NOT lost: the entry and the on_duty row are still written in one
// transaction, so nobody can be on duty without an entry or have two open at once.
export const ROUTED_FEATURES = {
  // Clocking in and out. The fence stays in the browser by decision (above); the transaction is what matters here.
  clock: {
    requires: ['memberPayload'],
    writes: ['CLOCK_IN', 'CLOCK_OUT'],
    switchReads: ['GET_ON_DUTY', 'GET_TIMECLOCK_LOGS'],
  },
  // A member's own availability: one batch write, one read, rules already proven by the harness.
  availability: {
    requires: ['memberPayload'],
    writes: ['SET_MY_AVAILABILITY'],
    switchReads: ['GET_AVAILABILITY', 'ADMIN_SET_AVAILABILITY'],
  },
  // Offers: raised, withdrawn, approved. The approval fills the shift, so it is the callable.
  offers: {
    requires: ['memberPayload', 'adminPayload'],
    writes: ['SUBMIT_SHIFT_OFFER', 'ADMIN_RESOLVE_SHIFT_OFFER'],
    switchReads: ['GET_SHIFT_OFFERS', 'ADMIN_GET_SCHEDULE_OFFERS'],
  },
  // The officer's board: a callable, because the audit row and the slot-conflict check belong on the server.
  scheduleBoard: {
    requires: ['adminPayload'],
    writes: ['ADMIN_BULK_SAVE_SCHEDULE'],
    switchReads: ['GET_SCHEDULE', 'ADMIN_GET_BOOTSTRAP'],
  },
  // The small reads the app makes AFTER the sign-in payload: who is on duty, the clock history, the roster, the
  // schedule, the member's own availability and offers, training, certifications, announcements and events. They
  // answer from the same data the payload does, which is why they depend on it and why their shapes are its shapes.
  //
  // TWO READS ARE DELIBERATELY NOT HERE. `MY_PUSH_DEVICES` also answers "whose device is this browser", which this
  // side cannot work out yet - routing it would show the member their devices and hide which one they are holding.
  // And `GET_INITIAL_DATA` runs BEFORE anyone signs in (it draws the loading screen), so a route that needs a signed
  // -in Firebase user could never fire; it stays on the sheet by arithmetic rather than by preference. Both are named
  // in `switchReads` so the record says what is left rather than looking finished.
  memberReads: {
    requires: ['memberPayload'],
    writes: [],
    reads: [
      'GET_ON_DUTY',
      'GET_ROSTER',
      'GET_TIMECLOCK_LOGS',
      'GET_SCHEDULE',
      'GET_AVAILABILITY',
      'GET_SHIFT_OFFERS',
      'GET_TRAINING',
      'GET_CERTIFICATIONS',
      'MY_ANNOUNCEMENTS',
      'GET_EVENTS',
    ],
    switchReads: ['MY_PUSH_DEVICES', 'GET_INITIAL_DATA'],
  },
  // The two read payloads, named so `requires` can point at them. They write nothing themselves: this is where the
  // bootstrap actions become Firestore-backed, and it is the hop that unlocks every feature above.
  //
  // `reads` is what the router DISPATCHES today; `switchReads` is the fuller list of reads that have to move with the
  // feature before it can be switched on - a read named there and not here is a step still to take, which is the
  // difference between a plan and a claim.
  memberPayload: { requires: [], writes: [], reads: ['GET_BOOTSTRAP'], switchReads: ['GET_BOOTSTRAP'] },
  // The officer-only reads the tabs make for themselves. The admin payload already carries most of what these tabs
  // show, and these are the three that are still fetched separately - all of them reading a WHOLE collection, which
  // is why the rules had to grow an officer branch before any of this could work.
  //
  // What is left is named rather than hidden: the system log is paged and sorted by the sheet server, so its reader
  // is a design step rather than a line; and the other three actions (users, certifications, templates) have no
  // caller anywhere in the app - they are api.js exports nothing invokes. They stay on the sheet until either a
  // caller appears or they are deleted.
  adminReads: {
    requires: ['adminPayload'],
    writes: [],
    reads: ['ADMIN_GET_ANNOUNCEMENTS', 'ADMIN_GET_EVENTS', 'ADMIN_GET_DOCUMENTS'],
    switchReads: ['ADMIN_GET_SYSTEM_LOG', 'ADMIN_GET_USERS', 'ADMIN_GET_CERTIFICATIONS', 'ADMIN_GET_SCHEDULE_TEMPLATES'],
  },

  adminPayload: {
    requires: ['memberPayload'],
    // The administrator's payload: the member one plus the sections an officer's tabs read, each gated in the reader
    // on the permission its tab needs.
    writes: [],
    reads: ['ADMIN_GET_BOOTSTRAP'],
    switchReads: ['ADMIN_GET_BOOTSTRAP'],
  },
};

// Every action any feature writes or reads, mapped to the feature that owns it. Built from the table so the two
// cannot drift - the counts in the harness are taken from these, and a duplicate would collapse in the object.
export const ROUTED_WRITES = Object.fromEntries(
  Object.entries(ROUTED_FEATURES).flatMap(([feature, spec]) =>
    (spec.writes || []).map((action) => [action, feature])
  )
);

export const ROUTED_READS = Object.fromEntries(
  Object.entries(ROUTED_FEATURES).flatMap(([feature, spec]) => (spec.reads || []).map((action) => [action, feature]))
);

// The reply shape `api.js` callers already read: `result.success`, and on failure `result.code` and
// `result.message`. Apps Script answers in this shape, so the Firestore paths have to as well or the screens that
// consume them would need changing - which is the one thing the whole move is arranged to avoid.
export const ok = (data = {}) => ({ success: true, ...data });

export const fail = (message, code = 'FIRESTORE_ERROR') => ({ success: false, code, message });

// Firestore throws where Apps Script answers, so this is the other half of that promise. The names below are the
// ones the write paths in firestoreWrites.js throw on purpose - a short list. Everything else is Firestore's own
// refusal (permission-denied, unavailable) and its message is the honest thing to show.
const FAILURE_MESSAGES = {
  'already-clocked-in': 'You are already clocked in.',
  'no-entry': 'That shift is no longer open.',
  'not-your-entry': 'That shift belongs to somebody else.',
  'already-clocked-out': 'That shift is already closed.',
};

// The one entry point api.js uses for a read. null means "not routed", which is the signal to fetch it the way the
// code always did. A read that FAILS answers null too, deliberately: the sheet still has the same data, so falling
// back is both safe and better than an error - and unlike a write there is nothing to duplicate by trying.
export const routeRead = async (action) => {
  const blocker = await routingBlocker(action);
  if (blocker) {
    if (blocker !== 'feature-off' && blocker !== 'not-a-routed-action') {
      console.info(`[firestore] ${action} is still read from the sheet (${blocker}).`);
    }
    return null;
  }

  const { firebaseAuth } = await import('./firebase.js');
  const uid = firebaseAuth().currentUser.uid;
  try {
    // The two payloads have their own dispatchers, because each is a whole shape to assemble. Everything else that
    // is routed as a read answers from firestoreReads.js, one slice at a time - which is how ten refresh reads are
    // moved by one entry in the table rather than ten wrappers in api.js.
    if (READ_DISPATCH[action]) return await READ_DISPATCH[action](uid);
    const { READERS } = await import('./firestoreReads.js');
    if (READERS[action]) return ok(await READERS[action](uid));
    // Named as routed with nothing to route it: a mistake in the table, and worth saying rather than failing quietly.
    console.error(`[firestore] ${action} is routed but has no reader, so it is being read from the sheet.`);
    return null;
  } catch (error) {
    // LOUD on purpose. A routed read that fails is a step of the migration not working, and the fallback that keeps
    // the app usable is exactly what hides it - a console.info nobody reads is how "still using Apps Script" becomes
    // a mystery. So this says what failed, and then asks the reader which collection refused.
    console.error(`[firestore] ${action} could not be read from Firestore (${(error && error.code) || error.message}). The sheet is being used instead, so the app still works - but this read has NOT moved.`);
    if (action === 'GET_BOOTSTRAP') {
      const { diagnoseMemberPayload } = await import('./firestorePayload.js');
      const { refused, failed } = await diagnoseMemberPayload(uid);
      if (refused.length) console.error(`[firestore] refused: ${refused.join(', ')}`);
      if (failed.length) console.error(`[firestore] failed for another reason: ${failed.join(', ')}`);
    }
    return null;
  }
};

export const failureFor = (error) => {
  const name = String((error && error.message) || '');
  const code = String((error && error.code) || '');
  if (FAILURE_MESSAGES[name]) return fail(FAILURE_MESSAGES[name], 'REFUSED');
  if (code === 'functions/permission-denied' || code === 'permission-denied') {
    return fail('You do not have permission to do that.', 'UNAUTHORIZED');
  }
  if (code === 'functions/unauthenticated' || code === 'unauthenticated') {
    return fail('Your session has expired. Please sign in again.', 'UNAUTHORIZED');
  }
  return fail(name || 'The change could not be saved.', 'FIRESTORE_ERROR');
};

// Whether this action should go to Firestore, and if not, why not. Exported so the harness can assert each
// condition on its own rather than only the aggregate.
export const routingBlocker = async (action) => {
  const feature = ROUTED_WRITES[action] || ROUTED_READS[action];
  if (!feature) return 'not-a-routed-action';
  if (!featureIsOn(feature)) return 'feature-off';
  if (!firebaseConfigured()) return 'firebase-unconfigured';

  const missing = ROUTED_FEATURES[feature].requires.filter((name) => !featureIsOn(name));
  if (missing.length) return `prerequisite-off:${missing.join(',')}`;

  // Imported here rather than at the top, so the auth SDK is not pulled into every build: api.js imports this
  // module, and every screen imports api.js.
  const { firebaseAuth } = await import('./firebase.js');
  if (!firebaseAuth().currentUser) return 'not-signed-in-to-firebase';
  return null;
};

// The dispatchers. Each takes the action's request body - already in the backend's field names, because api.js
// builds it once and hands the same object to either backend - and returns the reply shape above.
//
// `firestoreWrites` is imported lazily: with the switch off, none of the Firebase SDK is ever fetched.
const writes = () => import('./firestoreWrites.js');

// The read dispatchers. GET_BOOTSTRAP is the member's whole sign-in payload, and it needs nothing but the uid: the
// reader resolves the member's own role and rank from their document, because a claim can be an hour stale.
//
// IT ANSWERS IN THE REPLY SHAPE, not the bare payload, and that is not cosmetic: api.js callers decide whether a
// bootstrap loaded by reading `data.success`. A payload without it was dropped as a failed refresh - which is what
// happened the first time this route was tried, and looked exactly like the read never moving to Firestore at all.
const READ_DISPATCH = {
  GET_BOOTSTRAP: async (uid) => {
    const { fetchMemberPayload } = await import('./firestorePayload.js');
    return ok(await fetchMemberPayload({ userId: uid }));
  },
  ADMIN_GET_BOOTSTRAP: async (uid) => {
    const { fetchAdminPayload } = await import('./firestorePayload.js');
    return ok(await fetchAdminPayload({ userId: uid }));
  },
};

const DISPATCH = {
  // CLOCK OUT needs the open entry's id, which the sheet backend found for itself. The Firestore side reads the
  // member's own open entry for it (`time_out == ''`), and the transaction in clockOut re-checks everything that
  // matters - it is the same document the clock-in guard watches.
  CLOCK_IN: async (body, uid) => {
    const { clockIn } = await writes();
    const id = await clockIn({
      userId: uid,
      gps: body.gps_lat ? { latitude: body.gps_lat, longitude: body.gps_lon } : null,
      isManual: body.is_manual === true || body.is_manual === 'true',
    });
    return ok({ id });
  },

  CLOCK_OUT: async (body, uid) => {
    const { clockOut, openClockEntryFor } = await writes();
    const open = await openClockEntryFor(uid);
    if (!open) return fail('You are not clocked in.', 'REFUSED');
    await clockOut({ userId: uid, entryId: open.id });
    return ok({ id: open.id });
  },

  SET_MY_AVAILABILITY: async (body, uid) => {
    const { saveAvailability } = await writes();
    return ok(await saveAvailability({ userId: uid, adds: body.adds || [], removes: body.removes || [] }));
  },

  ADMIN_BULK_SAVE_SCHEDULE: async (body) => {
    const { saveScheduleBoard } = await writes();
    return ok(await saveScheduleBoard({ entries: body.entries || [], deleteIds: body.deleteIds || [] }));
  },

  ADMIN_RESOLVE_SHIFT_OFFER: async (body) => {
    // Approval fills the shift and is the callable. A DECLINE is not implemented on the Firestore side, so it
    // stays on Apps Script rather than being half-routed: null here means the caller sends it as it always did.
    if (String(body.decision || '') !== 'approved') return null;
    const { approveOffer } = await writes();
    return ok(await approveOffer({ offerId: body.id }));
  },

  SUBMIT_SHIFT_OFFER: async (body, uid) => {
    const { makeOffer } = await writes();
    // `slot_key` is derived server-side by slotKeyOfOffer in Code.gs ('row-<schedule id>', or
    // 'slot-<date>-<template id>'), and the calendar matches its open pills against it - so a routed offer has to
    // carry the same value or it will not find its slot. This belongs in makeOffer, as a field materialized by the
    // writer that owns it (see option D in docs/FIRESTORE_MODEL.md); it is written here for now because the
    // payload layer lands first and this whole feature sits behind it.
    const scheduleId = String(body.schedule_id || '');
    const dateKey = String(body.date_from || '').slice(0, 10);
    const slotKey = scheduleId
      ? `row-${scheduleId}`
      : dateKey && body.schedule_template_id
        ? `slot-${dateKey}-${body.schedule_template_id}`
        : '';
    const id = await makeOffer({
      userId: uid,
      scheduleId,
      dateFrom: body.date_from,
      assignmentId: body.assignment_id,
      slotKey,
    });
    return ok({ id });
  },
};

// The one entry point api.js uses. null means "not routed", which is the signal to do what the code always did.
// Anything else is the reply, failures included - a routed write that failed is never retried on the other backend.
export const routeWrite = async (action, body = {}) => {
  const blocker = await routingBlocker(action);
  if (blocker) {
    // The interesting case is switched on but unusable, which is exactly what happens before the login is wired to
    // Firebase. Naming it in the console is how somebody finds out why nothing changed.
    if (blocker !== 'feature-off' && blocker !== 'not-a-routed-action') {
      console.info(`[firestore] ${action} stays on Apps Script (${blocker}).`);
    }
    return null;
  }

  const { firebaseAuth } = await import('./firebase.js');
  const uid = firebaseAuth().currentUser.uid;
  try {
    return await DISPATCH[action](body, uid);
  } catch (error) {
    return failureFor(error);
  }
};
