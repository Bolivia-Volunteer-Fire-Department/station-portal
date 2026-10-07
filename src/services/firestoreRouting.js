// Which actions `api.js` sends to Firestore instead of Apps Script, and the conditions under which it may.
//
// THE SWITCH IS PER FEATURE, NOT PER ACTION, and that is the point of this module. The two backends run side by side
// during the move, so a write that lands on one side of a read is invisible to the reader - a member saves
// availability into Firestore while their own sign-in payload still comes from the sheet, and the save disappears on
// reload. That reads as data loss, not as half a finished migration. So a feature is named here together with the
// reads it depends on, and it routes ONLY when those are routed too.
//
// Four conditions, all of which must hold before a route is taken:
//
//   1. `VITE_FIRESTORE_FEATURES` does not name `off`/`none`, and names this feature if it names anything at all. UNSET
//      means every feature whose prerequisites are met - enabledFeatures below writes the three states out.
//   2. Firebase is configured at all (`firebaseConfigured()`) - so a build without the VITE_FIREBASE_* values cannot
//      route anything, whatever the features list says.
//   3. The feature's `requires` list is enabled as well. This is the guard against half a feature.
//   4. Somebody is signed in to Firebase, because a write with no Firebase user has no uid to write as and no rule to
//      satisfy. The single exception is GET_INITIAL_DATA, which runs before anybody has signed in and whose reader
//      omits whatever the rules refuse to a stranger.
//
// A route that is not taken returns null. Nothing falls back AFTER a Firestore attempt - a write that failed may still
// have landed, so routing is decided before the request, never after it.
//
// AND SINCE THE SHEET WENT, null means the caller FAILS. That turns this file's feature list from a convenience into a
// trap: a list of names switches off everything not in it, and there is nothing behind those routes to catch the fall.
// So every blocked route is now said out loud, feature-off included, and the message names the route and says what to
// do about it - silence here is what let "the admin wave is missing" arrive with no line explaining why.
import { firebaseConfigured } from './firebase.js';
// The offline sentences, and the device's own answer to "is there a network". A write that fails while offline is not the
// same event as a write that fails while online, and it is the one the member can actually do something about.
import { OFFLINE_CLOCK_MESSAGE, OFFLINE_WRITE_MESSAGE, isOffline } from '../utils/connectivity.js';

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
// checked in the browser (src/utils/clockLocation.js) and NOWHERE ELSE. The sheet backend checked it a second time,
// it is retired and nothing runs it, so the owner has chosen to keep the check in the browser only. Rules cannot do
// the arithmetic and a callable would be the robust answer - but the risk here is
// a member lying about their own location on their own timesheet, and that is not a risk this station judges worth a
// server round trip on every clock press. What is NOT lost: the entry and the on_duty row are still written in one
// transaction, so nobody can be on duty without an entry or have two open at once.
export const ROUTED_FEATURES = {
  // Clocking in and out. The fence stays in the browser by decision (above); the transaction is what matters here.
  clock: {
    requires: ['memberPayload'],
    writes: ['CLOCK_IN', 'CLOCK_OUT', 'ADMIN_SAVE_TIMECLOCK_ENTRY', 'ADMIN_DELETE_TIMECLOCK_ENTRY'],
    switchReads: ['GET_ON_DUTY', 'GET_TIMECLOCK_LOGS'],
  },
  // A member's own availability, and the officer's edit of somebody else's - one batch write each, through the SAME
  // writer, because the rules already distinguish the two: `can_edit_member_availability` lets an officer write another
  // member's rows, and the writer builds exactly the rows either path needs.
  //
  // The WINDOWS those claims are made against are edited here too: they are officer-maintained reference data for this
  // module, saved and deleted like any other plain document (`availability_windows`, below).
  availability: {
    requires: ['memberPayload'],
    writes: [
      'SET_MY_AVAILABILITY',
      'ADMIN_SET_AVAILABILITY',
      'ADMIN_SAVE_AVAILABILITY_WINDOW',
      'ADMIN_DELETE_AVAILABILITY_WINDOW',
    ],
    reads: ['ADMIN_GET_AVAILABILITY_WINDOWS', 'ADMIN_GET_AVAILABILITY'],
    switchReads: ['GET_AVAILABILITY'],
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
  // The officer tabs whose save is ONE DOCUMENT, with the collection each writes.
  //
  // The audience-bearing collections are deliberately absent from the SAVES: announcements, events and documents each
  // carry a materialized `audience_keys` list that has to be computed when they are written, and a save that left it
  // out would produce a row nobody can see. Their DELETES are here, because removing a row cannot hide anything.
  adminSaves: {
    requires: ['adminPayload'],
    writes: [
      'ADMIN_SAVE_ROLE',
      'ADMIN_SAVE_RANK',
      'ADMIN_SAVE_SHIFT',
      'ADMIN_SAVE_CERTIFICATION_SETUP',
      'ADMIN_SAVE_CHECKLIST_ITEM',
      'ADMIN_SAVE_ANNOUNCEMENT',
      'ADMIN_SAVE_DOCUMENT',
      'ADMIN_SAVE_EVENT',
      'ADMIN_SAVE_ASSIGNMENT',
      'ADMIN_SAVE_SCHEDULE_TEMPLATE',
      'ADMIN_SAVE_CERTIFICATION',
      'SAVE_TRAINING',
      'ADMIN_DELETE_ASSIGNMENT',
      'ADMIN_DELETE_SCHEDULE_TEMPLATE',
      'ADMIN_DELETE_CERTIFICATION',
      'ADMIN_BULK_SAVE_TRAINING',
      'ADMIN_SAVE_SYSTEM_SETTING',
      'ADMIN_SAVE_SYSTEM_SETTINGS',
      'ADMIN_DELETE_SYSTEM_SETTING',
      'ADMIN_DELETE_ROLE',
      'ADMIN_DELETE_RANK',
      'ADMIN_DELETE_SHIFT',
      'ADMIN_DELETE_CERTIFICATION_SETUP',
      'ADMIN_DELETE_CHECKLIST_ITEM',
      'ADMIN_DELETE_ANNOUNCEMENT',
      'ADMIN_DELETE_DOCUMENT',
      'ADMIN_DELETE_EVENT',
    ],
    reads: [],
    switchReads: [],
  },
  // The reads the app makes AFTER the sign-in payload: who is on duty, the roster, the schedule, the member's own
  // availability and offers, training, certifications, announcements and events. They answer from the same data the
  // payload does, which is why they depend on it and why their shapes are its shapes.
  //
  // ONE OF THEM IS A SCREEN'S OWN LOAD RATHER THAN A REFRESH: the clock history. It is the one per-member table with no
  // ceiling (a five-year member has thousands of entries), it is NOT in the payload any more, and its screen asks for a
  // RANGE - which is also why it is the one reader here whose answer can be deliberately empty. See GET_TIMECLOCK_LOGS.
  //
  // TWO READS NEEDED SOMETHING THE OTHERS DID NOT, and both are here now. `GET_INITIAL_DATA` runs BEFORE anyone has
  // signed in - it draws the loading screen - which is why the router has one pre-auth exception. And `MY_PUSH_DEVICES`
  // also answers "whose device is this browser", which a member cannot work out for themselves: it reads its own rows
  // and asks the `pushDeviceOwner` callable for the other half, because another member's token reads as nothing at all
  // against a rules-constrained query and a shared computer would look like the signed-in member's own.
  memberReads: {
    requires: ['memberPayload'],
    writes: [],
    reads: [
      'GET_ON_DUTY',
      // GET_ROSTER IS BACK, and the reason it was ever gone is the reason it is worth having: while the roster rode along in
      // the sign-in payload, nothing asked for it - reachable code with no caller. This pass takes it out of the payload, so
      // the screens that list people ask for it when they open (App#loadRoster), and a caller is the only thing that makes a
      // route worth keeping.
      'GET_ROSTER',
      // The badge index for the handful of names a screen actually draws. GET_ROSTER carries the WHOLE index, which is
      'GET_ROSTER_MODULE',
      // right for the screens that draw many names and wrong for the ones that draw two - see the reader.
      'GET_CERTIFICATION_BADGES',
      'GET_TIMECLOCK_LOGS',
      'GET_SCHEDULE',
      'GET_SCHEDULE_SETUP',
      'GET_AVAILABILITY',
      'GET_AVAILABILITY_WINDOWS',
      'GET_SHIFT_OFFERS',
      'GET_TRAINING',
      'GET_CERTIFICATIONS',
      'MY_ANNOUNCEMENTS',
      'GET_EVENTS',
      // The ONE read nobody has signed in for yet. It is here rather than in its own feature because it answers from
      // the same data - and because a feature is a unit of the move, not of the menu.
      'GET_INITIAL_DATA',
      'MY_PUSH_DEVICES',
    ],
    switchReads: [],
  },
  // The two read payloads, named so `requires` can point at them. They write nothing themselves: this is where the
  // bootstrap actions become Firestore-backed, and it is the hop that unlocks every feature above.
  //
  // `reads` is what the router DISPATCHES today; `switchReads` is the fuller list of reads that have to move with the
  // feature before it can be switched on - a read named there and not here is a step still to take, which is the
  // difference between a plan and a claim.
  // The Documents tab's per-document read: a document's checklist items and the signatures taken on it.
  //
  // It is here rather than in adminReads because the member's own DocumentsModule asks for it as well - the SHEET
  // refused that call for anyone without can_manage_documents or can_verify_documents, and Firestore refuses it in the
  // same place, through the rules. So a member still gets a refusal; it arrives as a thrown error rather than as the
  // sheet's `{success: false, message: 'Unauthorized.'}`, which is the one behavioural difference and is covered by the
  // callers' own error handling.
  //
  // A feature of its own because that is what it is: the collections, the rules and the client all existed before this,
  // and only the reader and this line were missing. Nothing complained while the sheet answered - which is exactly the
  // gap the two-direction check below the table now closes.
  documents: {
    requires: ['memberPayload'],
    writes: [
      'SIGN_DOCUMENT',
      'SIGN_CHECKLIST_ITEM',
      'VERIFY_CHECKLIST_ITEM',
      'VERIFY_CHECKLIST_REMAINING',
      // The document-level twin of the two above: confirming the signature a document carries as a whole, rather than
      // an item of a checklist. Same permission, same two identities, one row instead of many.
      'VERIFY_DOCUMENT_SIGNATURE',
      'ADMIN_REMOVE_DOCUMENT_SIGNATURE',
      // Recording what a paper file says for a member who did the work before this app existed. A member-module action
      // rather than an Administration one, like SET_DOCUMENT_ASSESSMENT_SCORE below and for the same reason: it is
      // writing a signature, which lives in the Documents feature.
      'BACKFILL_DOCUMENT_SIGNATURES',
      'ADMIN_RENAME_DOCUMENT_FOLDER',
      'ADMIN_REORDER_DOCUMENTS',
      // An assessment score is written by the officer who administers the test, and by nobody else - not by the member
      // it is about. It is a member-module action rather than an Administration one, so it belongs to this feature and
      // not to the `admin` one, even though only an officer ever calls it.
      'SET_DOCUMENT_ASSESSMENT_SCORE',
    ],
    reads: [
      'GET_DOCUMENTS',
      'GET_DOCUMENT',
      'ADMIN_GET_DOCUMENT',
      'GET_MEMBER_DOCUMENT_RECORDS',
      'GET_DOCUMENT_SIGNATURES',
      // The scorer's lookup of ONE member's score on ONE assessment. The reader's own score is not here because it
      // travels with GET_DOCUMENT - see that reader - which is what keeps "my score" impossible to ask for somebody
      // else's by accident.
      'GET_MEMBER_ASSESSMENT_SCORE',
    ],
    switchReads: [],
  },

  // Push devices and the notifications tab: the member's own device card, and the officer's view of it.
  //
  // The two doors are deliberately different. REGISTER is a callable because a TRANSFER is a member writing a row that
  // belongs to somebody else - which the rules must refuse, and whose refusal has to name the owner so the card can
  // offer to move it. UNREGISTER is an ordinary client delete of the member's own row, which the rules already allow.
  // ADMIN_SET_PUSH_DISABLED is a client write too: forgetting a member's device rows and setting the flag on their
  // settings is exactly what `can_edit_notification_settings` is for. The FCM pair are callables because sending a
  // push needs the credentials the runtime has and a browser never will.
  push: {
    requires: ['memberPayload'],
    writes: ['REGISTER_PUSH_DEVICE', 'UNREGISTER_PUSH_DEVICE', 'ADMIN_SET_PUSH_DISABLED', 'ADMIN_SEND_TEST_PUSH'],
    reads: ['ADMIN_GET_PUSH_STATUS', 'ADMIN_GET_FCM_STATUS'],
    switchReads: [],
  },

  // The member's own settings row: time format, theme, which notifications they want. A client write, because the rules
  // already allow a member to write their own document and an officer with the notification permission to write
  // another's.
  //
  // Their PASSWORD is deliberately not a route here. It goes to the `changeOwnPassword` callable, which is the only
  // thing that can set a Firebase password and the only thing that may clear the change-on-next-login claim - see
  // updateUserPassword in api.js, which no longer has a second path at all.
  memberSettings: {
    requires: ['memberPayload'],
    // A FEMA student id lives on the member's PRIVATE row rather than with the preferences, but it belongs to this
    // feature: the same screen edits it, the rules allow exactly that one key (the member's own, or an officer's), and
    // the read it depends on is the same member payload.
    writes: ['UPDATE_USER_SETTINGS', 'SAVE_MEMBER_PRIVATE'],
    switchReads: [],
  },

  // Training signatures: the same add-only shape as everything else, and the removal behind its own permission.
  trainingSignatures: {
    requires: ['memberPayload'],
    writes: ['SIGN_TRAINING', 'ADMIN_REMOVE_TRAINING_SIGNATURE'],
    switchReads: [],
  },

  // The runner's score and its board. The score is a CALLABLE, because the clamp is the point - the board is shared, so
  // a doctored request must not be able to put an impossible number at the top of everybody's screen. The board itself is
  // a READER: `users` is readable by any signed-in member and the projection is the three fields the game draws, so no
  // callable is warranted for a number in a side-scroller.
  runner: {
    requires: ['memberPayload'],
    writes: ['SAVE_RUNNER_SCORE'],
    reads: ['GET_RUNNER_LEADERBOARD'],
    switchReads: [],
  },

  // Deleting a member: the one action that cannot be anything but a callable, because it closes a Firebase Auth account
  // and no client can do that. It also removes the documents that made somebody a member, and deliberately KEEPS their
  // records - clock entries, signatures, availability - which are the station's history rather than their profile.
  memberAccounts: {
    requires: ['adminPayload'],
    writes: ['ADMIN_DELETE_USER'],
    switchReads: [],
  },

  // Reports are read only when the module is opened. The callables validate the global report permission, per-report
  // role/rank audience, and the source data permission before returning aggregated rows.
  reports: {
    requires: ['memberPayload'],
    writes: ['SAVE_REPORT_CONFIG', 'DELETE_REPORT_CONFIG'],
    reads: ['GET_REPORTS', 'GET_REPORT_CONFIGS', 'RUN_REPORT'],
    switchReads: [],
  },

  // Form definitions and the printable PDFs they describe. NO CALLABLE ANYWHERE: a definition is validated and its
  // audience expanded by PURE client code (utils/formDefinition), the rules gate who may write one, and the blank PDFs
  // are bundled files the browser fills - so the whole feature is the client and the database, and it works with no
  // server and no signal.
  forms: {
    requires: ['memberPayload'],
    writes: ['SAVE_FORM_TEMPLATE', 'DELETE_FORM_TEMPLATE'],
    reads: ['GET_FORM_TEMPLATES', 'ADMIN_GET_FORM_TEMPLATES', 'GET_MEMBER_TRAINING'],
    switchReads: [],
  },

  memberPayload: { requires: [], writes: [], reads: ['GET_BOOTSTRAP'], switchReads: ['GET_BOOTSTRAP'] },
  // The officer-only reads the tabs make for themselves. The admin payload already carries most of what these tabs
  // show, and these are the three that are still fetched separately - all of them reading a WHOLE collection, which
  // is why the rules had to grow an officer branch before any of this could work.
  //
  // Certification records are the exception to direct section reads: the callable checks the certification permission,
  // resolves active member IDs server-side, and queries only those records unless the user opts into inactive members.
  adminReads: {
    requires: ['adminPayload'],
    writes: [],
    reads: ['ADMIN_GET_ANNOUNCEMENTS', 'ADMIN_GET_EVENTS', 'ADMIN_GET_DOCUMENTS', 'ADMIN_GET_SYSTEM_LOG', 'ADMIN_GET_SCHEDULE_OFFERS', 'ADMIN_GET_CERTIFICATIONS', 'ADMIN_GET_DOCUMENT_VERIFICATION_COUNT'],
    switchReads: [],
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
    'on-duty-mismatch': 'Your clock record and on-duty status do not match. Ask an officer to review it.',
  // Thrown by the clock writers when the device has no connection (see utils/connectivity.js): clocking in and out is the
  // one pair of writes that must NOT queue, because the record itself asserts when somebody was at the station.
  offline: OFFLINE_CLOCK_MESSAGE,
};

// The one entry point api.js uses for a read. null means "not routed", which is the signal to fetch it the way the
// code always did. A read that FAILS answers null too, deliberately: the sheet still has the same data, so falling
// back is both safe and better than an error - and unlike a write there is nothing to duplicate by trying.
//
// `body` travels with it because a read can have parameters: the device card asks "whose is THIS token", and a
// reader that cannot see the request cannot answer it.
export const routeRead = async (action, body = {}) => {
  const blocker = await routingBlocker(action);
  if (blocker) {
    // SAID OUT LOUD, INCLUDING feature-off. While the sheet was still a fallback, a route that was switched off was a
    // normal state and saying so on every refresh would have been noise. There is no fallback now: a route that is off
    // is a screen that cannot load, so silence here is the worst possible answer - it was silence that made an
    // afternoon of "the admin wave is missing" arrive without a line saying why.
    console.warn(
      `[firestore] ${action} is NOT routed (${blocker}), and there is no sheet to ask any more - so this read fails.` +
        (blocker === 'feature-off'
          ? ' VITE_FIRESTORE_FEATURES is pinning a list of routes; unset it, or add this route, or set it to `off` deliberately.'
          : '')
    );
    return null;
  }

  const { firebaseAuth } = await import('./firebase.js');
  // May be empty for the pre-login read, which is answered before there is a user at all.
  const uid = firebaseAuth().currentUser?.uid || '';
  try {
    // The two payloads have their own dispatchers, because each is a whole shape to assemble. Everything else that
    // is routed as a read answers from firestoreReads.js, one slice at a time - which is how ten refresh reads are
    // moved by one entry in the table rather than ten wrappers in api.js.
    if (READ_DISPATCH[action]) return await READ_DISPATCH[action](uid, body);
    const { READERS } = await import('./firestoreReads.js');
    if (READERS[action]) return ok(await READERS[action](uid, body));
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
  const refusal = Object.keys(FAILURE_MESSAGES).find((message) => name === message || name.startsWith(`${message} `));
  if (refusal) return fail(FAILURE_MESSAGES[refusal], 'REFUSED');
  if (code === 'functions/permission-denied' || code === 'permission-denied') {
    return fail('You do not have permission to do that.', 'UNAUTHORIZED');
  }
  if (code === 'functions/unauthenticated' || code === 'unauthenticated') {
    return fail('Your session has expired. Please sign in again.', 'UNAUTHORIZED');
  }
  // THE OFFLINE CASE, translated where EVERY routed write passes - including the callables (an approved offer, the
  // schedule board), which cannot run at all without a connection and whose failure would otherwise arrive as a
  // `functions/unavailable` with a message about a transport. The DEVICE's answer is used rather than the error's, because
  // an unreachable backend while the device HAS a connection is a different problem with a different thing to try, and
  // saying "you are offline" to somebody who is not would send them to fix the wrong thing.
  if (isOffline()) return fail(OFFLINE_WRITE_MESSAGE, 'OFFLINE');
  return fail(name || 'The change could not be saved.', 'FIRESTORE_ERROR');
};

// Whether this action should go to Firestore, and if not, why not. Exported so the harness can assert each
// condition on its own rather than only the aggregate.
// The reads that are answered BEFORE anybody has signed in. There is exactly one, and it is the loading screen's:
// it draws the station's name and its own messages, which is why `settings/public` is readable by anybody at all.
const PRE_AUTH_READS = ['GET_INITIAL_DATA'];

export const routingBlocker = async (action) => {
  const feature = ROUTED_WRITES[action] || ROUTED_READS[action];
  if (!feature) return 'not-a-routed-action';
  if (!featureIsOn(feature)) return 'feature-off';
  if (!firebaseConfigured()) return 'firebase-unconfigured';

  const missing = ROUTED_FEATURES[feature].requires.filter((name) => !featureIsOn(name));
  if (missing.length) return `prerequisite-off:${missing.join(',')}`;

  // A caller with no Firebase user has no uid to write as and no rule to satisfy - EXCEPT for the pre-login read,
  // whose rules say what a stranger may see and whose reader omits whatever they may not.
  if (PRE_AUTH_READS.includes(action)) return null;

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

// The callables this file needs to reach directly, for the routes where the work IS a function rather than a write:
// registering a device (a transfer has to be refused with the owner's name, which the rules cannot say), and the FCM
// pair, which need the runtime's credentials. Imported lazily for the same reason the writers are - a screen that never
// opens the notifications tab never loads the Functions SDK.
const callable = async (name, data) => {
  const [{ httpsCallable }, { firebaseFunctions }] = await Promise.all([
    import('firebase/functions'),
    import('./firebase.js'),
  ]);
  const answer = await httpsCallable(firebaseFunctions(), name)(data);
  return answer.data || {};
};

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
  ADMIN_GET_CERTIFICATIONS: async (uid, body) => {
    void uid;
    return ok(await callable('readAdminCertificationRecords', { includeInactive: body?.includeInactive === true }));
  },
  ADMIN_GET_DOCUMENT_VERIFICATION_COUNT: async (uid) => {
    void uid;
    return ok(await callable('readDocumentVerificationCount', {}));
  },
  GET_REPORTS: async () => ok(await callable('getReports', {})),
  GET_REPORT_CONFIGS: async () => ok(await callable('getReportConfigurations', {})),
  RUN_REPORT: async (_uid, body) => ok(await callable('runReport', body || {})),
};

const refuseClockOffline = () => {
  if (isOffline()) throw new Error('offline');
};

const DISPATCH = {
  SAVE_REPORT_CONFIG: async (body) => ok(await callable('saveReportConfiguration', body || {})),
  DELETE_REPORT_CONFIG: async (body) => ok(await callable('deleteReportConfiguration', { reportId: body.reportId || body.id })),

  // A form definition, written straight to Firestore. No callable: there is nothing here a browser must not be trusted
  // with that `can_configure_forms` and the rule do not already enforce, and the writer normalises through the same pure
  // function the admin screen uses.
  SAVE_FORM_TEMPLATE: async (body, uid) => {
    const { saveFormTemplate } = await writes();
    return ok(await saveFormTemplate({ id: body?.id, definition: body?.definition, authorId: uid }));
  },
  DELETE_FORM_TEMPLATE: async (body) => {
    const { deleteFormTemplate } = await writes();
    return ok(await deleteFormTemplate({ id: body?.id || body?.formId }));
  },

  // CLOCK OUT needs the open entry's id, which the sheet backend found for itself. The Firestore side reads the
  // member's own open entry for it (`time_out == ''`), and the transaction in clockOut re-checks everything that
  // matters - it is the same document the clock-in guard watches.
  CLOCK_IN: async (body, uid) => {
    refuseClockOffline();
    return ok(await callable('clockIn', {
      gps_lat: body.gps_lat || '',
      gps_lon: body.gps_lon || '',
    }));
  },

  CLOCK_OUT: async (body, uid) => {
    refuseClockOffline();
    const { openClockEntryFor } = await writes();
    const open = await openClockEntryFor(uid);
    if (!open) return fail('You are not clocked in.', 'REFUSED');
    return ok(await callable('clockOut', { entryId: open.id }));
  },

  // ONE MONTH, ONE WRITE: the month the screen was editing, and the marks it now holds (utils/availability.js). There is
  // no add/remove vocabulary any more - the document IS the month - and no ids travel, because nothing is deleted
  // individually: a day that has been un-marked is simply not in the map that gets written.
  SET_MY_AVAILABILITY: async (body, uid) => {
    const { saveAvailabilityMonth } = await writes();
    const month = String(body.month || '').trim();
    if (!month) return fail('A month is needed to save availability.', 'REFUSED');
    return ok(await saveAvailabilityMonth({ userId: uid, month, claims: body.claims || {} }));
  },

  // The officer's half of the same write: one member's month, named by the form. The rules decide whether this caller
  // may - `can_edit_member_availability` - so the permission is not repeated here where it could drift.
  ADMIN_SET_AVAILABILITY: async (body) => {
    const target = String(body.user_id || '').trim();
    // Refused rather than written with an empty owner: a month document with no user_id is invisible to every member AND
    // to the officer who just saved it, which is the worst kind of "saved successfully".
    if (!target) throw new Error('Which member is this availability for?');
    const month = String(body.month || '').trim();
    if (!month) return fail('A month is needed to save availability.', 'REFUSED');
    const { saveAvailabilityMonth } = await writes();
    return ok(await saveAvailabilityMonth({ userId: target, month, claims: body.claims || {} }));
  },

  // A device registering itself. The callable is the door - see registerPushDevice in functions/index.js - and `ok()`
  // puts success:true in front of its answer, where the answer's own success:false WINS. That matters: a refusal keeps
  // its code ('PUSH_DISABLED_BY_ADMIN'), its message and the owner's name, which is what the settings card branches on.
  REGISTER_PUSH_DEVICE: async (body) =>
    ok(
      await callable('registerPushDevice', {
        device_token: body.device_token,
        device_label: body.device_label,
        transfer: body.transfer === true,
      })
    ),

  UNREGISTER_PUSH_DEVICE: async (body) => {
    const { removePushDevice } = await writes();
    return ok(await removePushDevice({ token: body.device_token }));
  },

  // The administrator's switch, both ways. Turning it off forgets the member's devices as well as setting the flag,
  // which is the asymmetry documented on the writer.
  ADMIN_SET_PUSH_DISABLED: async (body) => {
    const { setPushDisabled } = await writes();
    return ok(await setPushDisabled({ userId: body.user_id, disabled: body.disabled === true }));
  },

  // The runner's personal best. `best` comes back even when nothing was written, so the game can say "your best is 120"
  // after a worse run without a second read - and `improved` is what tells it whether to celebrate or to keep the score
  // it already had. Both names come from the sheet handler the component was written against.
  SAVE_RUNNER_SCORE: async (body) => ok(await callable('saveRunnerScore', { score: body.score })),

  // Deleting a member. The callable does all of it - the documents, the devices and the Auth account - and answers with
  // the { success, message } shape the members tab already branches on. `id` is the sheet's field name, kept here
  // because that is what api.js sends.
  //
  // DELIBERATELY NOT WRAPPED IN ok(). That helper is `(data) => ({ success: true, ...data })`, which is right for a reply
  // that only ever succeeds - and this one has a refusal that is an ANSWER rather than an error: "User not found." is
  // shown to the officer by the members tab. Wrapped, that false would be overwritten by a true and the tab would report
  // that somebody who does not exist had been deleted. The callable's own shape IS the contract here.
  ADMIN_DELETE_USER: async (body) => callable('deleteMember', { userId: body.id }),

  ADMIN_SEND_TEST_PUSH: async (body) => ok(await callable('sendTestPush', { user_id: body.user_id })),

  // The member's own settings: one merged document, with the two transformations the writer documents (undefined fields
  // dropped, the flags turned into real booleans).
  UPDATE_USER_SETTINGS: async (body, uid) => {
    const { saveMemberSettings } = await writes();
    const payload = body.payload || {};
    // The session's own row unless the form named another - which is how an officer edits a member through the same
    // call. A member sending somebody else's id is refused by the RULES rather than here, which is where that belongs.
    return ok(await saveMemberSettings({ userId: payload.id || uid, fields: payload }));
  },

  // A member's own details, which live on the member's PRIVATE row rather than with the preferences - so this is its own
  // call. The session's own row unless the form named another, and a member naming somebody else is refused by the RULES,
  // which allow only these keys on that document and none of the rest of it.
  SAVE_MEMBER_PRIVATE: async (body, uid) => {
    const { saveMemberPrivateFields } = await writes();
    return ok(await saveMemberPrivateFields({ userId: body?.userId || uid, fields: body?.fields || {} }));
  },

  // Signing and verifying. EVERY IDENTITY COMES FROM THE SESSION, and the request only ever names the SUBJECT: `uid`
  // is who signed, and `body.user_id` is the member a row is about - which is how "a member cannot sign as somebody
  // else" and "a verifier cannot claim somebody else verified" are properties of the shape rather than of a check.
  SIGN_DOCUMENT: async (body, uid) => {
    const { signDocument } = await writes();
    return ok(await signDocument({ userId: uid, documentId: body.id }));
  },

  // THE SCORE WRITE. `body.user_id` is the member the score is ABOUT and `uid` is the officer recording it - two
  // different people by construction, which is the property the whole feature rests on and the reason the member is
  // named in the request rather than taken from the session the way a signature is.
  SET_DOCUMENT_ASSESSMENT_SCORE: async (body, uid) => {
    const { setDocumentAssessmentScore } = await writes();
    return ok(
      await setDocumentAssessmentScore({
        scorerId: uid,
        documentId: body.document_id,
        memberId: body.user_id,
        score: body.score,
        scoredOn: body.scored_on,
      })
    );
  },

  SIGN_CHECKLIST_ITEM: async (body, uid) => {
    const { signChecklistItems } = await writes();
    return ok(await signChecklistItems({ userId: uid, documentId: body.document_id, itemIds: body.item_ids }));
  },

  VERIFY_CHECKLIST_ITEM: async (body, uid) => {
    const { verifyChecklistItem } = await writes();
    return ok(
      await verifyChecklistItem({
        verifierId: uid,
        documentId: body.document_id,
        itemId: body.item_id,
        memberId: body.user_id,
      })
    );
  },

  VERIFY_CHECKLIST_REMAINING: async (body, uid) => {
    const { verifyChecklistRemaining } = await writes();
    return ok(await verifyChecklistRemaining({ verifierId: uid, documentId: body.document_id, memberId: body.user_id }));
  },

  // The document-level twin of VERIFY_CHECKLIST_ITEM: the same two identities and the same permission, and no item,
  // because the row being confirmed is the document's own signature. `body.user_id` is the MEMBER whose signature it
  // is; `uid` is the verifier, always, which is what makes "somebody else checked it" a property of the shape.
  VERIFY_DOCUMENT_SIGNATURE: async (body, uid) => {
    const { verifyDocumentSignature } = await writes();
    return ok(
      await verifyDocumentSignature({
        verifierId: uid,
        documentId: body.document_id,
        memberId: body.user_id,
      })
    );
  },

  // The administrator's half of documents: removing a signature, and the two pieces of housekeeping. All three are
  // ordinary writes - the rules are the permission (`can_manage_documents`) - and each writes as little as it can: one
  // row deleted, a `folder` field, a `sort_order`, so none of them can be a way to save a document.
  ADMIN_REMOVE_DOCUMENT_SIGNATURE: async (body) => {
    const { removeDocumentSignature } = await writes();
    return ok(await removeDocumentSignature({ id: body.id }));
  },

  ADMIN_RENAME_DOCUMENT_FOLDER: async (body) => {
    const { renameDocumentFolder } = await writes();
    return ok(await renameDocumentFolder({ from: body.from, to: body.to }));
  },

  ADMIN_REORDER_DOCUMENTS: async (body) => {
    const { reorderDocuments } = await writes();
    return ok(await reorderDocuments({ order: body.order }));
  },

  // THE RECORDER COMES FROM THE SESSION, never from the request - the same rule as signing and verifying, and it is what
  // makes `signed_by_user_id` worth reading: a caller cannot claim somebody else entered the row. The member it is FOR
  // does come from the request, which is the whole point of the feature, and the rules independently require the
  // `backfilled` flag on any member row that is not the caller's own.
  BACKFILL_DOCUMENT_SIGNATURES: async (body, uid) => {
    const { backfillDocumentSignatures } = await writes();
    return ok(
      await backfillDocumentSignatures({
        recorderId: uid,
        documentId: body.document_id,
        memberId: body.user_id,
        itemIds: body.item_ids,
        recordedOn: body.recorded_on,
        note: body.note,
        confirmVerified: body.confirm_verified === true,
      })
    );
  },

  // Training: a batch of signatures from the session, and the administrator's single removal.
  SIGN_TRAINING: async (body, uid) => {
    const { signTrainings } = await writes();
    const payload = body.payload || {};
    return ok(await signTrainings({ userId: uid, trainingIds: payload.training_ids }));
  },

  ADMIN_REMOVE_TRAINING_SIGNATURE: async (body) => {
    const { removeTrainingSignature } = await writes();
    return ok(await removeTrainingSignature({ id: body.signature_id || body.id }));
  },

  // The officer's clock management. Both keep `on_duty` in step with the entry, which is the pairing the member's own
  // clock-in and clock-out already maintain - see the writers for why that is worth a transaction in both directions.
  ADMIN_SAVE_TIMECLOCK_ENTRY: async (body) => {
    const { saveTimeclockEntry } = await writes();
    return ok(await saveTimeclockEntry({ id: body.id, userId: body.user_id, timeIn: body.time_in, timeOut: body.time_out }));
  },

  ADMIN_DELETE_TIMECLOCK_ENTRY: async (body) => {
    const { deleteTimeclockEntry } = await writes();
    return ok(await deleteTimeclockEntry({ id: body.id }));
  },

  ADMIN_BULK_SAVE_SCHEDULE: async (body) => {
    const { saveScheduleBoard } = await writes();
    return ok(await saveScheduleBoard({ entries: body.entries || [], deleteIds: body.deleteIds || [] }));
  },

  ADMIN_RESOLVE_SHIFT_OFFER: async (body) => {
    // BOTH DECISIONS ARE ROUTED, and the vocabulary is worth spelling out because getting it wrong is how this route
    // spent its whole life doing nothing. The client sends the SHEET'S words - 'APPROVE' or 'DECLINE', built from the
    // button the officer pressed (api.js), uppercased like every stored status - while this entry compared against the lowercase
    // 'approved'. So neither decision matched, every resolution fell through as "not routed", and the fallback it was
    // meant to reach was Apps Script, which no longer exists: an officer could not approve or decline anything, and the
    // failure looked like a transport error rather than a wiring mistake. Both spellings are accepted now.
    const decision = String(body.decision || '').trim().toLowerCase();
    if (decision === 'approve' || decision === 'approved') {
      const { approveOffer } = await writes();
      return ok(await approveOffer({ offerId: body.id }));
    }
    if (decision === 'decline' || decision === 'declined') {
      const { declineOffer } = await writes();
      return ok(await declineOffer({ offerId: body.id }));
    }
    // Anything else is refused out loud rather than guessed at: a null here means "ask the sheet", and there is no sheet.
    console.error(
      `[firestore] ADMIN_RESOLVE_SHIFT_OFFER was given "${body.decision}", which is neither an APPROVE nor a DECLINE.`
    );
    return null;
  },

  SUBMIT_SHIFT_OFFER: async (body, uid) => {
    const { makeOffer } = await writes();
    // `slot_key` is derived by slotKeyOfOffer when the offer is written ('row-<schedule id>', or
    // 'slot-<date>-<template id>'), and the calendar matches its open pills against it - so a routed offer has to
    // carry the same value or it will not find its slot. This belongs in makeOffer, as a field materialized by the
    // writer that owns it (see the README's data-model section); it is written here for now because the
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
      // THE OFFER KEEPS THE SHIFT IT IS FOR. `schedule_template_id` was used here to build the slot key and then thrown
      // away, which is how the approvals queue ended up unable to show a time for any offer raised against a template
      // occurrence - see the note on `offerTemplateId`, and on `makeOffer` itself.
      templateId: String(body.schedule_template_id || ''),
      dateFrom: body.date_from,
      dateTo: body.date_to,
      assignmentId: body.assignment_id,
      slotKey,
    });
    return ok({ id });
  },

  // The bulk training save is its own dispatcher rather than a row in the table above, because it is a BATCH: rows
  // and removals in one commit.
  ADMIN_BULK_SAVE_TRAINING: async (body) => {
    const { saveTrainingRows } = await writes();
    const request = body.payload || body;
    return ok(await saveTrainingRows({ rows: request.trainings || [], deleteIds: request.deleteIds || [] }));
  },

  // The member module's save: rows only. It is NOT a document save - the request carries the rows under `payload`, and
  // saving the request itself as a document is what put a malformed extra row in the list on every edit.
  SAVE_TRAINING: async (body) => {
    const { saveTrainingRows } = await writes();
    const request = body.payload || body;
    return ok(await saveTrainingRows({ rows: request.trainings || [] }));
  },

  // System settings: one document per SIDE, so a save and a delete both go through the same rule about which side a
  // key belongs to - the rule the migration reads too, in src/utils/systemSettings.js.
  ADMIN_SAVE_SYSTEM_SETTING: async (body) => {
    const { saveSystemSettings } = await writes();
    return ok(await saveSystemSettings({ settings: [{ key: body.key, value: body.value }] }));
  },

  // The Loading Messages card saves all ten at once, all-or-nothing. It sends a list; an object works too.
  ADMIN_SAVE_SYSTEM_SETTINGS: async (body) => {
    const { saveSystemSettings } = await writes();
    const pairs = Array.isArray(body.settings)
      ? body.settings
      : Object.entries(body.settings || {}).map(([key, value]) => ({ key, value }));
    return ok(await saveSystemSettings({ settings: pairs }));
  },

  ADMIN_DELETE_SYSTEM_SETTING: async (body) => {
    const { deleteSystemSetting } = await writes();
    return ok(await deleteSystemSetting(body.key));
  },
};

// The officer tabs whose save is one document, and the collection each one writes. Declared here rather than in
// firestoreWrites.js because it is routing: which action goes where, next to the list of actions that are routed.
const DOCUMENT_SAVES = {
  ADMIN_SAVE_ROLE: 'roles',
  ADMIN_SAVE_RANK: 'ranks',
  ADMIN_SAVE_SHIFT: 'shifts',
  ADMIN_SAVE_AVAILABILITY_WINDOW: 'availability_windows',
  ADMIN_SAVE_CHECKLIST_ITEM: 'document_checklist_items',
  // Assignments and schedule templates are plain documents, which is worth stating because it was not obvious: their
  // model has a private half holding an officer's `admin_note`, but NO form in the app collects one - the sheet had no
  // column for it either, which is why the migration wrote them empty. So the public document is the whole save, and
  // the private halves keep the empty note the migration left. A note field would change this.
  ADMIN_SAVE_ASSIGNMENT: 'assignments',
  ADMIN_SAVE_SCHEDULE_TEMPLATE: 'schedule_templates',
};

// Saves whose field is only HALF the story, because they change what a badge index should say - so each of them
// rebuilds it afterwards. A certification record is what the index is derived from; a certification TYPE carries the
// icon and the show-next-to-name flag that decide whether a badge exists at all. Neither belongs in the plain table
// above, because saving the document alone would leave the roster showing yesterday's claim.
const BADGE_REFRESHING_SAVES = {
  ADMIN_SAVE_CERTIFICATION: { collection: 'certifications', kind: 'save' },
  ADMIN_DELETE_CERTIFICATION: { collection: 'certifications', kind: 'delete' },
  ADMIN_SAVE_CERTIFICATION_SETUP: { collection: 'certification_setup', kind: 'save' },
};

const DOCUMENT_DELETES = {
  ADMIN_DELETE_ROLE: 'roles',
  ADMIN_DELETE_RANK: 'ranks',
  ADMIN_DELETE_SHIFT: 'shifts',
  ADMIN_DELETE_AVAILABILITY_WINDOW: 'availability_windows',
  ADMIN_DELETE_CERTIFICATION_SETUP: 'certification_setup',
  ADMIN_DELETE_CHECKLIST_ITEM: 'document_checklist_items',
  // A delete needs no audience - removing a row cannot hide anything from anybody - so these three are safe here
  // where their SAVES are not.
  ADMIN_DELETE_ANNOUNCEMENT: 'announcements',
  ADMIN_DELETE_DOCUMENT: 'documents',
  ADMIN_DELETE_EVENT: 'events',
  ADMIN_DELETE_ASSIGNMENT: 'assignments',
  ADMIN_DELETE_SCHEDULE_TEMPLATE: 'schedule_templates',
};

// The three collections a member sees by AUDIENCE, whose saves carry a materialized `audience_keys` list computed as
// they are written - which is why they are not in the plain table above.
//
// TWO OF THEM EXPAND TO "THIS RANK AND ABOVE": events, and DOCUMENTS. An event aimed at a Captain's meeting is aimed at
// everybody more junior as well, and that has always been how events behaved.
//
// A document did not, and that was a BUG rather than a decision. The editor has always labelled this field **"Minimum
// rank"**, both help pages have always described it as "a rank and above", and the reader on the other side has always
// answered it as one - but `rankAndAbove: false` stored the single rank id, so `array-contains-any` matched that one rank
// and nothing else. A document with a minimum rank of Firefighter was therefore invisible to a Captain: not "not aimed at
// you", simply absent, with nothing on screen to say why. The library a senior member sees was missing every document
// whose minimum sat below them.
//
// ANNOUNCEMENTS STAY EXACT, and that difference is deliberate rather than an oversight left behind: an announcement names
// the people it is for ("the probationary class reads this"), where a document names the rank from which it applies.
// Changing announcements is a separate decision about a broadcast channel and is not taken here.
//
// `liveUntilFrom` is the second materialized field, and only announcements have it: a row's END date, written as a
// `live_until` key so the read can ask for "what is in force" with one range filter. See firestoreWrites#saveAudienceDocument
// for why the column itself cannot be queried. Events are dated too, but a recurring event anchors on the date of its
// FIRST occurrence, so a range over `date_from` would drop a weekly meeting that started two years ago - which is why
// they are not on this list.
const AUDIENCE_SAVES = {
  ADMIN_SAVE_ANNOUNCEMENT: { collection: 'announcements', rankAndAbove: false, liveUntilFrom: 'end_date' },
  ADMIN_SAVE_DOCUMENT: { collection: 'documents', rankAndAbove: true },
  ADMIN_SAVE_EVENT: { collection: 'events', rankAndAbove: true },
};

// The document saves and deletes share one implementation, so they share one loop rather than a hand-written entry
// each - which also keeps the table and the dispatchers in step by construction. An action named in a feature with
// nothing here would be a route that throws, and the harness asserts the table in both directions.
Object.entries(DOCUMENT_SAVES).forEach(([action, collection]) => {
  DISPATCH[action] = async (body) => {
    const { saveDocument } = await writes();
    return ok(await saveDocument({ collection, id: body.id, body }));
  };
});

Object.entries(DOCUMENT_DELETES).forEach(([action, collection]) => {
  DISPATCH[action] = async (body) => {
    const { deleteDocument } = await writes();
    return ok(await deleteDocument({ collection, id: body.id }));
  };
});

Object.entries(AUDIENCE_SAVES).forEach(([action, { collection, rankAndAbove, liveUntilFrom }]) => {
  DISPATCH[action] = async (body, uid) => {
    const { saveAudienceDocument } = await writes();
    return ok(
      await saveAudienceDocument({ collection, id: body.id, body, rankAndAbove, authorId: uid, liveUntilFrom })
    );
  };
});

// Save the document, then rebuild the badge index - in that order, because the index is derived from what was just
// written.
//
// THE REPLY CARRIES THE REBUILT INDEX, and it is worth saying which shape that is, because `badges` used to hold a
// SUMMARY of the rebuild (`{ members, cleared }`) instead. App hands this straight to `setCertificationBadges`, which
// REPLACES the registry rather than merging, so one certification save blanked every member's icons on every screen
// until the next sign-in - and the naming made it look correct at every layer: the field really was called `badges`,
// and the value really was about badges. `refreshCertificationBadges` now returns the index and returns nothing else,
// so there is no second shape to reach for.
Object.entries(BADGE_REFRESHING_SAVES).forEach(([action, { collection, kind }]) => {
  DISPATCH[action] = async (body) => {
    const { saveDocument, deleteDocument, refreshCertificationBadges } = await writes();
    if (kind === 'delete') await deleteDocument({ collection, id: body.id });
    else await saveDocument({ collection, id: body.id, body });
    return ok({ id: String(body.id || ''), badges: await refreshCertificationBadges() });
  };
});

// The one entry point api.js uses. null means "not routed", which is the signal to do what the code always did.
// Anything else is the reply, failures included - a routed write that failed is never retried on the other backend.
export const routeWrite = async (action, body = {}) => {
  const blocker = await routingBlocker(action);
  if (blocker) {
    // Loud, and for the same reason as routeRead: with no sheet behind it, a route that is not taken is a save that
    // silently does nothing. `feature-off` used to be the quiet case on purpose, because the sheet would have answered.
    console.warn(
      `[firestore] ${action} was NOT routed (${blocker}), and there is no sheet behind it any more - so this write fails.` +
        (blocker === 'feature-off'
          ? ' VITE_FIRESTORE_FEATURES pins a list of routes when it is set; this one is not in it.'
          : '')
    );
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
