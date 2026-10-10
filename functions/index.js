// COMMONJS, unlike the rest of the repo, because the Functions emulator analyses this codebase with require() - an
// ESM entry point fails with "Unexpected token 'export'" before a single function loads. The deployed runtime would
// accept ESM; the emulator is what we develop and test against, so CJS it is.
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { getStorage } = require('firebase-admin/storage');
const { HttpsError, onCall } = require('firebase-functions/v2/https');
// The audit lines go to Cloud Logging now rather than to a Firestore collection: structured, free to write, and
// searchable in the Firebase console. See the note on `audit` below.
const { logger } = require('firebase-functions/logger');
const { onDocumentCreated, onDocumentDeleted, onDocumentUpdated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { countPendingDocumentVerifications } = require('./documentVerification');
const {
  aggregateReconciliation,
  aggregateScheduleRows,
  aggregateTrainingRows,
  canUseReport,
  CLOCK_ROUNDING_KEY,
  clockRoundingStep,
  normalizeReportDefinition,
  reportAudienceKeys,
  resolveReportOptions,
  TRAINING_CATEGORY_FLAGS,
} = require('./reporting');

// What an event MEANS: recipients, preferences and copy. Pure and separate so it can be asserted without FCM.
const {
  text,
  isTruthy,
  notificationEnabled,
  offerEventFromStatus,
  offerRecipients,
  offerCopy,
  announcementRecipients,
  audienceTargetsFrom,
} = require('./pushAudience');
// THE ROSTER'S PAGE: what one screenful is, which candidates are still members, how far the read has to look to fill one,
// and which certification columns it draws.
// Pure, so scripts/verify-roster-page.mjs can ask it directly - and THIS REPO RUNS NO FUNCTIONS EMULATOR, so a callable is
// not exercised by the suite at all: anything this function could get wrong has to live where a harness can reach it.
const {
  ROSTER_SCAN_LIMIT,
  certificationIdsForMembers,
  namePrefixRange,
  rosterCertificationTypes,
  rosterPageSize,
  scanRosterPage,
} = require('./rosterPage');

// The attached scans, for the same reason and by the same rule: what may be attached, where it goes and what is
// written about it are pure decisions, asked directly by scripts/verify-certifications.mjs.
const {
  certificationFileError,
  certificationFilePath,
  certificationFileRow,
} = require('./certificationFiles');

// WHAT BELONGS IN A FUNCTION, and why:
//
// Everything a client may do directly lives in firestore.rules. What is here is work that needs the Admin SDK, and the
// list has grown past the four it started as: creating an Auth account, setting a password, suspending one, writing the
// audit row that names the officer who did it (users_private is write-denied in the rules so a browser cannot try);
// saving the schedule board and approving an offer, which both write several documents that must agree; the assignment
// audience keys; reading the system log, whose paging and facets no single page can supply; answering which member a
// device belongs to; moving a device between members, which the rules must refuse because the refusal cannot name the
// owner; and the FCM status and test send, which need the runtime's own credentials.
//
// These are also the reason the Blaze plan is required: callable functions do not exist on Spark.

initializeApp();
const db = getFirestore();
const auth = getAuth();

// THE BUCKET, RESOLVED EXPLICITLY, and this is a trap worth knowing about. A project created after September 2024
// has <project>.firebasestorage.app as its default bucket rather than <project>.appspot.com, and the Admin SDK's
// no-argument default is the older name - so "just ask for the default bucket" is how a correct-looking function
// writes to a bucket nobody ever uploaded to, and fails with a 404 that names a bucket you never created.
// FIREBASE_CONFIG is set by the runtime and carries the right one; the fallback is for a local run only.
const storageBucket = () => {
  const configured = (() => {
    try {
      return String(JSON.parse(process.env.FIREBASE_CONFIG || '{}').storageBucket || '').trim();
    } catch {
      return '';
    }
  })();
  return getStorage().bucket(configured || undefined);
};

// The synthetic email domain, decided for the department: RFC-reserved, so nothing can ever be delivered to it and
// an administrator reading the Auth console can see at a glance that an account is synthetic. THE CLIENT DERIVES
// THE SAME ADDRESS from the same rule - see EMAIL_DOMAIN in src/services/firebaseAuth.js.
const EMAIL_DOMAIN = 'boliviavfd.invalid';

// A local binding AND an export: `exports.syntheticEmail = ...` would not be a name the code below could call,
// which is a difference from ESM worth remembering in this file.
const syntheticEmail = (username) => `${String(username || '').trim().toLowerCase()}@${EMAIL_DOMAIN}`;
exports.syntheticEmail = syntheticEmail;

// The caller's role, read from the database rather than trusted from the token - the same choice the rules make,
// for the same reason: a claim can be up to an hour stale after an officer changes somebody's role.
const callerRole = async (uid) => {
  const user = await db.doc(`users/${uid}`).get();
  if (!user.exists) return null;
  const roleId = String(user.get('role_id') || '');
  if (!roleId) return null;
  const role = await db.doc(`roles/${roleId}`).get();
  return role.exists ? { roleId, ...role.data() } : null;
};

const isGranted = (value) => value === true || String(value ?? '').trim().toUpperCase() === 'TRUE';

const callerMay = async (uid, flag) => {
  const role = await callerRole(uid);
  return !!role && (isGranted(role.is_admin) || isGranted(role[flag]));
};

const requirePermission = async (uid, flag, what) => {
  if (!(await callerMay(uid, flag))) {
    throw new HttpsError('permission-denied', `You do not have permission to ${what}.`);
  }
};

const requireAssignableRole = async (callerUid, roleId) => {
  const [caller, target] = await Promise.all([
    callerRole(callerUid),
    roleId ? db.doc(`roles/${roleId}`).get() : null,
  ]);
  if (target?.exists && isGranted(target.get('is_admin')) && !isGranted(caller?.is_admin)) {
    throw new HttpsError('permission-denied', 'Only an administrator may assign the Administrator role.');
  }
};

// The station's own clock, in the format the whole app stores and sorts by: 'YYYY-MM-DD HH:mm:ss' in station time.
// Mirrors stationTimestamp in src/services/firestoreWrites.js - same shape, same timezone - because a function and a
// browser both write rows the other side has to read.
const stationTimestamp = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const at = (type) => parts.find((part) => part.type === type).value;
  return `${at('year')}-${at('month')}-${at('day')} ${at('hour')}:${at('minute')}:${at('second')}`;
};

// The audit trail: every one of these functions leaves a line naming who did it and to whom. An officer-driven password
// reset is only accountable if the officer's name is written down with it.
//
// IT GOES TO CLOUD LOGGING, NOT TO A COLLECTION. The app used to write a `system_log` document per action and show them
// in a tab of its own, which cost a Firestore write per action plus a WHOLE-COLLECTION SCAN every time that tab was
// opened - the one collection that grew without limit, read to render one screen. Cloud Logging takes the same line for
// nothing, keeps it searchable in the Firebase console, and is a tool an administrator already has.
//
// `logger.info` with an OBJECT is a structured entry, so it can be filtered on `jsonPayload.audit.action` rather than
// grepping text. The station-time text stays a field because that is the form a person reads; the entry's own timestamp
// is the exact instant, recorded by Cloud Logging itself, which is why no ISO copy is written.
const audit = (userId, action, details) =>
  logger.info({
    audit: {
      user_id: userId,
      action,
      details,
      timestamp: stationTimestamp(),
    },
  });

// Claims carry role_id and is_admin so the client can shape its own navigation without a read. The RULES never
// trust them - see firestore.rules - so a stale claim costs a member a slightly wrong menu, never access.
const claimsFor = async (roleId) => {
  const role = roleId ? await db.doc(`roles/${roleId}`).get() : null;
  return {
    role_id: String(roleId || ''),
    is_admin: !!role && role.exists && role.data().is_admin === true,
  };
};

const setRoleClaims = async (userId, roleId, extra = {}) => {
  const user = await auth.getUser(userId);
  await auth.setCustomUserClaims(userId, {
    ...(user.customClaims || {}),
    ...(await claimsFor(roleId)),
    ...extra,
  });
};

// WHETHER A MEMBER MUST CHOOSE A NEW PASSWORD: one fact, two places it is read, and therefore ONE WRITER.
//
// This is the whole of a bug that survived a green test suite, and the shape of it is worth keeping written down. The
// flag is stored twice, because the two readers have different needs:
//
//   - the CLAIM (`must_change_password`) travels in the member's ID token, which is what the app can gate on without a
//     read - and it is what `whoami` reports;
//   - `users_private.is_change_password_on_login` is the officer's copy, read by the Users tab (the checkbox and the
//     "Password change due" badge) and joined onto the roster row, which is the copy the sign-in payload hands the app
//     as `currentUser`.
//
// Clearing only the claim is what went wrong: the member changed their password, the modal closed because the app
// cleared its own local copy, and the NEXT sign-in read the private column - still TRUE - so the forced change came
// back, every single time, until an officer unchecked the box by hand. `completePasswordChange` did exactly half the job
// and `verify-firebase-auth.mjs` agreed with it, because that harness asserted `whoami` and never read the document the
// app actually gates on.
//
// So both halves are written here, together, and every writer of this fact goes through this one function: resetting a
// password, completing a change, and an officer toggling the box in the Users tab. Two files can no longer disagree
// about it, which is the property the README's "one writer per fact" is for - and it is why this is not a one-line
// patch at the call site.
const setPasswordChangeRequired = async (userId, required) => {
  const wanted = required === true;
  const roleId = (await db.doc(`users/${userId}`).get()).get('role_id');
  await setRoleClaims(userId, roleId, { must_change_password: wanted });
  await db.doc(`users_private/${userId}`).set({ is_change_password_on_login: wanted }, { merge: true });
  return wanted;
};

const cleanUsername = (value) => {
  const username = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new HttpsError('invalid-argument', 'A username is 3-32 characters: letters, numbers, dot, dash or underscore.');
  }
  return username;
};

const cleanPassword = (value) => {
  const password = String(value || '');
  if (password.length < 8) {
    throw new HttpsError('invalid-argument', 'A password is at least 8 characters.');
  }
  return password;
};

// ---------------------------------------------------------------------------------------------
// The callables
// ---------------------------------------------------------------------------------------------

// What the client asks after signing in: who am I, what role, and do I have to change my password. The claims are
// read from the Auth record rather than from the token, so this is the fresh answer even when the token is stale.
exports.whoami = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const user = await auth.getUser(request.auth.uid);
  const claims = user.customClaims || {};
  // The role is read from the DATABASE, not from the claim. A claim can be up to an hour stale after an officer
  // changes somebody's role, and this is the answer the app draws its menus from - so the fresh read is the one
  // that matters. The claims stay for the client's own fast path, and for the password flag, which only a
  // function can write.
  const role = await callerRole(request.auth.uid);
  return {
    userId: request.auth.uid,
    roleId: role ? role.roleId : '',
    isAdmin: !!role && role.is_admin === true,
    mustChangePassword: claims.must_change_password === true,
  };
});


// THE ROSTER MODULE, A PAGE AT A TIME, WITH A NAME SEARCH.
//
// IT USED TO READ EVERYTHING TO DRAW TEN NAMES. `users` and `users_private` are one document per member, so that half grew
// with the roster; `certifications` is append-only, so its half grew with the station's age. Both are now bounded by what
// the officer is looking at, which is the point: a roster only ever gets bigger, and so does every collection behind it.
//
// THE DECISIONS LIVE IN ./rosterPage - the page size and its cap, the prefix a search box becomes, which candidates are
// members, HOW MANY CHUNKS THE READ LOOKS AT BEFORE IT CALLS A PAGE THE END, and which columns the page holds. That split
// is not tidiness: this repo runs no Functions emulator, so nothing here is exercised by the suite, and every rule that
// could be got wrong is in a module scripts/verify-roster-page.mjs asks directly (the arrangement ./pushAudience
// established). What is left below is the reading.
exports.readRosterModule = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(request.auth.uid, 'can_view_roster', 'view the roster');

  const data = request.data || {};
  const pageSize = rosterPageSize(data.page_size);
  const search = String(data.search || '').trim();
  const cursor = String(data.cursor || '').trim();
  const today = stationTimestamp().slice(0, 10);

  // THE CANDIDATES: by name, narrowed to a prefix when the officer typed one, and resumed after the last name they hold.
  //
  // THE TWO BRANCHES ARE WRITTEN AS FULL CHAINS, and that is not style: scripts/verify-read-budget walks each
  // `collection(...)` call and the filters that follow it textually, so a query assembled onto a variable afterwards is a
  // query whose index requirement nothing checks. Both shapes need NO composite index - a range and the ordering on the
  // SAME field are served by that field's own index - and the harness is what says so. They are read in CHUNKS, because
  // the loop that fills the page lives in functions/rosterPage.js where a harness can drive it; all that is left here is
  // the reading, which is what a function is allowed to be in this repo.
  //
  // A CHUNK IS ONE MORE THAN THE PAGE, because the status is private: some candidates will turn out to have left, and the
  // page has to be able to fill itself anyway. One chunk on its own could not tell "that is everyone" from "there is more
  // behind this" - which is the bug this read was rewritten for (see rosterScanStep).
  const read = async ({ cursor: after, limit }) => {
    const range = namePrefixRange(search);
    const candidateQuery = range.from
      ? db.collection('users').where('name', '>=', range.from).where('name', '<=', range.to).orderBy('name').limit(limit)
      : db.collection('users').orderBy('name').limit(limit);
    const chunkRows = (await (after ? candidateQuery.startAfter(after) : candidateQuery).get()).docs.map((row) => ({
      id: row.id,
      name: row.get('name'),
      rank_id: row.get('rank_id'),
    }));

    // THEIR PRIVATE HALVES, BY DOCUMENT - only the chunk's candidates, never the collection. One `getAll` is a single round
    // trip for every ref, which is the cheapest shape this read can take; the rules are not in the way because this is the
    // admin SDK, which is exactly why the screen cannot do this for itself.
    const privateRows = chunkRows.length
      ? await db.getAll(...chunkRows.map((candidate) => db.collection('users_private').doc(candidate.id)))
      : [];
    return {
      candidates: chunkRows,
      privateById: Object.fromEntries(privateRows.map((row) => [row.id, row.exists ? row.data() : {}])),
    };
  };

  const page = await scanRosterPage({
    read,
    pageSize,
    cursor,
    scanLimit: ROSTER_SCAN_LIMIT,
  });
  const certificationTypes = rosterCertificationTypes((await db.collection('certification_setup').get()).docs);
  const typeIds = certificationTypes.map((type) => type.id);

  // THE PAGE'S RECORDS ONLY, in batches of thirty - never the whole collection, and never the whole roster.
  //
  // `certifications` is append-only: one row per member per certificate period, accumulated for the station's whole life.
  // Reading it whole made every open of the Roster module pay for every record ever recorded, including the ones belonging
  // to members who have left. The page's ids are already in hand, so the query names them - the same batched `in` read
  // readAdminCertificationRecords makes, and the same thirty-per-request ceiling Firestore puts on `in`.
  const certificationRows = [];
  const pageIds = page.members.map((member) => member.id);
  for (let start = 0; start < pageIds.length; start += 30) {
    const batch = pageIds.slice(start, start + 30);
    const snapshot = await db.collection('certifications').where('user_id', 'in', batch).get();
    certificationRows.push(...snapshot.docs.map((row) => ({ id: row.id, ...row.data() })));
  }

  return {
    members: page.members,
    certificationTypes,
    memberCertificationIds: certificationIdsForMembers({
      members: page.members,
      certificationRows,
      typeIds,
      today,
    }),
    // WHAT THE CALLER ACTUALLY HAS, rather than what it hoped for: the cursor to continue from, whether there is anything
    // to continue to, and the search these names answer - so a screen whose search changed mid-read cannot draw one page's
    // members under another page's heading.
    //
    // `scanned` is the candidates the WHOLE scan looked at, which is the read this page cost. `exhausted` says the scan
    // stopped at ROSTER_SCAN_LIMIT rather than at the end of the roster: the page is real and `has_more` is true, but it
    // ended short because so many candidates have left - worth being able to see when a roster gets slow.
    roster_page: {
      size: pageSize,
      search,
      has_more: page.hasMore,
      next_cursor: page.nextCursor,
      scanned: page.scanned,
      exhausted: page.exhausted === true,
    },
  };
});

exports.readAdminCertificationRecords = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(caller.uid, 'can_manage_certifications', 'view certification records');

  const includeInactive = request.data?.includeInactive === true;
  const memberSnapshot = includeInactive
    ? await db.collection('users_private').get()
    : await db.collection('users_private').where('status', '==', 'active').get();
  const activeUserIds = memberSnapshot.docs
    .filter((row) => String(row.get('status') || '').trim().toLowerCase() === 'active')
    .map((row) => row.id);
  const userIds = includeInactive
    ? memberSnapshot.docs
        .filter((row) => ['active', 'inactive'].includes(String(row.get('status') || '').trim().toLowerCase()))
        .map((row) => row.id)
    : activeUserIds;
  const recordSnapshots = [];

  for (let start = 0; start < userIds.length; start += 30) {
    const batch = userIds.slice(start, start + 30);
    const snapshot = await db.collection('certifications').where('user_id', 'in', batch).get();
    recordSnapshots.push(...snapshot.docs);
  }

  return {
    records: recordSnapshots.map((row) => ({ ...row.data(), id: row.id })),
    activeUserIds,
  };
});

// -------------------------------------------------------------------------------------------------------------
// The scans attached to those records: one optional file per certification, and the only two ways one is written or
// removed. THE BYTES NEVER PASS THROUGH HERE - the browser uploads straight to the bucket, and storage.rules decides
// whether it may - because a callable in the path of every upload pays for the transfer twice and caps the file at a
// callable's payload limit. What this does is the part a rule CANNOT do: read two documents and check them against
// each other, which is the difference between "an officer is attaching something" and "an officer is attaching THIS
// to THAT member's record".
// -------------------------------------------------------------------------------------------------------------

// Record the file an officer has just uploaded. The request names the RECORD and the FILE ID, never the path: the
// path is derived from the record's own member, so a file cannot be filed under one member and recorded against
// another. Everything the row says about the file is read off the OBJECT, not from the caller's description of it.
exports.saveCertificationFile = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(caller.uid, 'can_manage_certifications', 'attach a file to a certification');

  const data = request.data || {};
  const recordId = String(data.recordId || '').trim();
  const fileId = String(data.fileId || '').trim();
  const name = String(data.name || '').trim();
  if (!recordId || !fileId || !name) {
    throw new HttpsError('invalid-argument', 'A record, a file id and a file name are required.');
  }

  const record = await db.doc(`certifications/${recordId}`).get();
  if (!record.exists) throw new HttpsError('not-found', 'That certification record does not exist.');
  const userId = String(record.get('user_id') || '').trim();
  if (!userId) throw new HttpsError('failed-precondition', 'That certification record has no member on it.');

  const storagePath = certificationFilePath({ userId, recordId, fileId });
  const file = storageBucket().file(storagePath);
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError('failed-precondition', 'That upload did not arrive. Try attaching it again.');

  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size || 0);
  const contentType = String(metadata.contentType || '');
  const problem = certificationFileError({ size, contentType });
  if (problem) {
    // The bytes go too. They are already in the bucket - the client put them there - and a file that may not be
    // recorded is a file that should not be sitting there either.
    await file.delete({ ignoreNotFound: true });
    throw new HttpsError('invalid-argument', problem);
  }

  const row = certificationFileRow({
    id: fileId,
    recordId,
    userId,
    storagePath,
    name,
    contentType,
    size,
    uploadedBy: caller.uid,
    uploadedAt: stationTimestamp(),
  });

  // ONE FILE PER RECORD, so attaching a second one REPLACES the first: the old row is deleted in the same batch, and
  // the old OBJECT follows from that row's own trigger. A replace therefore cannot leave yesterday's scan in the
  // bucket with nothing pointing at it. (The batch applies in order, so a re-save of the same id sets the row it
  // just deleted rather than losing it.)
  const previous = await db.collection('certification_files').where('certification_id', '==', recordId).get();
  const batch = db.batch();
  previous.forEach((existing) => batch.delete(existing.ref));
  batch.set(db.doc(`certification_files/${fileId}`), row);
  // THE RECORD CARRIES THE ANSWER TOO, and this is the one deliberate DENORMALIZATION in the feature. The admin table
  // reads every certification on every open, and asking each row "is there a scan?" would add a read per FILE on top
  // of that - a collection that only grows. One boolean, written by the only two writers of a file, keeps that list
  // free. It is a summary of the row above, not a second source of truth: the attachment section reads the rows
  // themselves, so an officer looking at a record always sees the real thing.
  batch.set(db.doc(`certifications/${recordId}`), { has_upload: true }, { merge: true });
  await batch.commit();

  await audit(caller.uid, 'ADMIN_ATTACH_CERTIFICATION_FILE', `${name} to certifications/${recordId}`);
  return row;
});

// Remove the file, which is what the officer sees on screen: the row goes, and the bytes follow from its trigger.
exports.deleteCertificationFile = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(caller.uid, 'can_manage_certifications', 'remove a certification file');

  const fileId = String((request.data || {}).fileId || '').trim();
  if (!fileId) throw new HttpsError('invalid-argument', 'A file id is required.');

  const ref = db.doc(`certification_files/${fileId}`);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new HttpsError('not-found', 'There is no file recorded against that record.');

  await ref.delete();
  // The record's own flag goes with it, in the same act - see the note in saveCertificationFile for why the boolean
  // exists at all. `false` rather than a deleted field, so "no scan" is written down rather than implied: an absent
  // key and a false one have to mean the same thing to every reader, and only one of them is obvious.
  const recordId = String(snapshot.get('certification_id') || '').trim();
  if (recordId) {
    await db.doc(`certifications/${recordId}`).set({ has_upload: false }, { merge: true });
  }

  await audit(
    caller.uid,
    'ADMIN_REMOVE_CERTIFICATION_FILE',
    `${String(snapshot.get('name') || fileId)} on ${recordId}`
  );
  return { id: fileId };
});

// -------------------------------------------------------------------------------------------------------------
// THE BYTES FOLLOW THE ROW, in both directions - and it is a FUNCTION that does it rather than the browser that
// pressed Remove. Storage has no cascade and no undo, so an object is only ever deleted because something arranged
// it, and a tab closed halfway through a delete would otherwise leave somebody's ID card in the bucket with nothing
// in the app pointing at it. Firestore triggers each row's deletion, and the row is the only place the path is
// written down.
// -------------------------------------------------------------------------------------------------------------

exports.onCertificationFileDeleted = onDocumentDeleted('certification_files/{fileId}', async (event) => {
  const storagePath = String((event.data && event.data.get('storage_path')) || '').trim();
  if (!storagePath) return;

  await storageBucket().file(storagePath).delete({ ignoreNotFound: true });
  logger.info({
    audit: {
      // No actor, and that is not an omission: nobody pressed anything. This is the second half of a delete that was
      // already audited when it happened, and saying so is more honest than guessing at who it was.
      action: 'CERTIFICATION_FILE_BYTES_REMOVED',
      path: storagePath,
    },
  });
});

// DELETING A RECORD TAKES ITS EVIDENCE WITH IT. This deletes ROWS, and the bytes follow from each row's own trigger
// above. The order is worth stating, because the reverse - deleting the objects from here instead - would be a second
// implementation of the same idea, and one of the two would eventually drift.
exports.onCertificationRecordDeleted = onDocumentDeleted('certifications/{recordId}', async (event) => {
  const recordId = String(event.params.recordId || '').trim();
  if (!recordId) return;

  const rows = await db.collection('certification_files').where('certification_id', '==', recordId).get();
  if (rows.empty) return;

  const batch = db.batch();
  rows.forEach((row) => batch.delete(row.ref));
  await batch.commit();
});

const reportActorFor = async (uid) => {
  const userSnapshot = await db.doc(`users/${uid}`).get();
  if (!userSnapshot.exists) throw new HttpsError('permission-denied', 'Your account is not in the roster.');
  const roleId = String(userSnapshot.get('role_id') || '').trim();
  const roleSnapshot = roleId ? await db.doc(`roles/${roleId}`).get() : null;
  return {
    roleId,
    rankId: String(userSnapshot.get('rank_id') || '').trim(),
    role: roleSnapshot?.exists ? roleSnapshot.data() : {},
  };
};

const reportScopeIsAllowed = (report, role) => {
  const admin = isGranted(role?.is_admin);
  if (report.dataset === 'training') {
    if (report.scope === 'mine') return admin || isGranted(role?.can_sign_trainings);
    return admin || isGranted(role?.can_administer_trainings);
  }
  if (report.dataset === 'reconciliation') {
    // A reconciliation reads the member's SHIFT hours and their CLOCK entries, so the scope has to be allowed for BOTH
    // halves. The clock half is the stricter of the two and the one that is about PRYING rather than rostering: reading
    // somebody else's entries is `can_edit_timeclock`, which is exactly what Clock Management is gated on and what the
    // rules honour on that collection. Without this branch a station-scope reconciliation would have been allowed to a
    // role that may build the schedule but has no business reading anyone's clock history.
    if (report.scope === 'mine') return admin || isGranted(role?.can_view_my_schedule);
    return (
      admin ||
      ((isGranted(role?.can_view_full_schedule) || isGranted(role?.can_edit_schedule)) &&
        isGranted(role?.can_edit_timeclock))
    );
  }
  if (report.scope === 'mine') return admin || isGranted(role?.can_view_my_schedule);
  return admin || isGranted(role?.can_view_full_schedule) || isGranted(role?.can_edit_schedule);
};

const reportDateKey = (value) => {
  const key = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
  const date = new Date(`${key}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key ? key : '';
};

const reportAudienceForActor = (roleId, rankId) =>
  ['*', ...reportAudienceKeys({ roleIds: [roleId], rankIds: [rankId] })];

exports.getReports = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in first.');
  const actor = await reportActorFor(caller.uid);
  const isAdmin = isGranted(actor.role.is_admin);
  if (!isAdmin && !isGranted(actor.role.can_view_reports)) {
    throw new HttpsError('permission-denied', 'You do not have permission to view reports.');
  }

  const reportsSnapshot = await db.collection('report_configs')
    .where('audience_keys', 'array-contains-any', reportAudienceForActor(actor.roleId, actor.rankId))
    .get();
  const reports = reportsSnapshot.docs
    .map((row) => ({ ...row.data(), id: row.id }))
    .filter((report) => report.enabled === true)
    .filter((report) => canUseReport(report, actor.roleId, actor.rankId))
    .filter((report) => reportScopeIsAllowed(report, actor.role));
  return { reports };
});

exports.getReportConfigurations = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(caller.uid, 'can_configure_reports', 'configure reports');
  const snapshot = await db.collection('report_configs').get();
  return { reports: snapshot.docs.map((row) => ({ ...row.data(), id: row.id })) };
});

exports.saveReportConfiguration = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(caller.uid, 'can_configure_reports', 'configure reports');

  let report;
  try {
    report = normalizeReportDefinition(request.data || {});
  } catch (error) {
    throw new HttpsError('invalid-argument', error.message);
  }

  const [roleSnapshots, rankSnapshots] = await Promise.all([
    Promise.all(report.audience_role_ids.map((id) => db.doc(`roles/${id}`).get())),
    Promise.all(report.audience_rank_ids.map((id) => db.doc(`ranks/${id}`).get())),
  ]);
  if (roleSnapshots.some((row) => !row.exists) || rankSnapshots.some((row) => !row.exists)) {
    throw new HttpsError('invalid-argument', 'One or more selected roles or ranks no longer exist.');
  }

  const reportId = String(request.data?.id || '').trim() || db.collection('report_configs').doc().id;
  const reference = db.doc(`report_configs/${reportId}`);
  const previous = await reference.get();
  const saved = {
    ...report,
    created_at: previous.exists ? String(previous.get('created_at') || stationTimestamp()) : stationTimestamp(),
    created_by: previous.exists ? String(previous.get('created_by') || caller.uid) : caller.uid,
    updated_at: stationTimestamp(),
    updated_by: caller.uid,
  };
  await reference.set(saved);
  await audit(caller.uid, previous.exists ? 'ADMIN_UPDATE_REPORT' : 'ADMIN_CREATE_REPORT', `${saved.name} (${reportId})`);
  return { report: { ...saved, id: reportId } };
});

exports.deleteReportConfiguration = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(caller.uid, 'can_configure_reports', 'delete a report');
  const reportId = String(request.data?.reportId || '').trim();
  if (!reportId) throw new HttpsError('invalid-argument', 'A report id is required.');
  const reference = db.doc(`report_configs/${reportId}`);
  const snapshot = await reference.get();
  if (!snapshot.exists) throw new HttpsError('not-found', 'That report no longer exists.');
  await reference.delete();
  await audit(caller.uid, 'ADMIN_DELETE_REPORT', `${String(snapshot.get('name') || reportId)} (${reportId})`);
  return { reportId };
});

exports.runReport = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in first.');
  const actor = await reportActorFor(caller.uid);
  const isAdmin = isGranted(actor.role.is_admin);
  if (!isAdmin && !isGranted(actor.role.can_view_reports)) {
    throw new HttpsError('permission-denied', 'You do not have permission to view reports.');
  }

  const reportId = String(request.data?.reportId || '').trim();
  const reportSnapshot = reportId ? await db.doc(`report_configs/${reportId}`).get() : null;
  if (!reportSnapshot?.exists) throw new HttpsError('not-found', 'That report is unavailable.');
  const report = { ...reportSnapshot.data(), id: reportSnapshot.id };
  if (report.enabled !== true || !canUseReport(report, actor.roleId, actor.rankId)) {
    throw new HttpsError('permission-denied', 'That report is not shared with your role or rank.');
  }
  if (!reportScopeIsAllowed(report, actor.role)) {
    throw new HttpsError('permission-denied', 'Your role cannot read the data this report needs.');
  }

  const from = reportDateKey(request.data?.from);
  const to = reportDateKey(request.data?.to);
  if (!from || !to || from > to) throw new HttpsError('invalid-argument', 'Choose a valid date range.');
  const daySpan = (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86400000;
  if (daySpan > 366) throw new HttpsError('invalid-argument', 'Report ranges cannot exceed 367 days.');

  const options = resolveReportOptions(report, request.data);

  if (report.dataset === 'training') {
    const trainings = (await db.collection('trainings')
      .where('date_key', '>=', from).where('date_key', '<=', to).get()).docs
      .map((row) => ({ ...row.data(), id: row.id }))
      .filter((training) => {
        if (!options.category) return true;
        if (options.category !== 'none') return isGranted(training[options.category]);
        return !TRAINING_CATEGORY_FLAGS.some((flag) => isGranted(training[flag]));
      });
    const signatures = [];
    if (report.scope === 'mine') {
      const inRange = new Set(trainings.map((training) => training.id));
      const mine = await db.collection('training_signatures').where('user_id', '==', caller.uid).get();
      signatures.push(...mine.docs.map((row) => row.data()).filter((row) => inRange.has(String(row.training_id))));
    } else if (options.memberIds.length) {
      // Signatures are indexed by member, so a member filter reads only those members' signatures.
      const inRange = new Set(trainings.map((training) => training.id));
      for (let start = 0; start < options.memberIds.length; start += 30) {
        const chunk = await db.collection('training_signatures')
          .where('user_id', 'in', options.memberIds.slice(start, start + 30)).get();
        signatures.push(...chunk.docs.map((row) => row.data()).filter((row) => inRange.has(String(row.training_id))));
      }
    } else {
      for (let start = 0; start < trainings.length; start += 30) {
        const ids = trainings.slice(start, start + 30).map((training) => training.id);
        const chunk = await db.collection('training_signatures').where('training_id', 'in', ids).get();
        signatures.push(...chunk.docs.map((row) => row.data()));
      }
    }
    const trainingMemberIds = options.groupBy === 'member'
      ? [...new Set(signatures.map((row) => String(row.user_id || '').trim()).filter(Boolean))]
      : [];
    const trainingMembers = trainingMemberIds.length
      ? (await db.getAll(...trainingMemberIds.map((id) => db.doc(`users/${id}`))))
        .map((row) => ({ id: row.id, ...(row.exists ? row.data() : {}) }))
      : [];
    return {
      report: { id: report.id, name: report.name, visualization: options.visualization, group_by: options.groupBy, dataset: 'training', unit: 'Hours' },
      range: { from, to },
      rows: aggregateTrainingRows(signatures, { groupBy: options.groupBy, trainings, users: trainingMembers, orderBy: options.orderBy }),
      truncated: false,
    };
  }

  // A RECONCILIATION: what was scheduled against what was actually worked. It reads TWO collections, which is the whole
  // reason it is a dataset of its own rather than a grouping on the schedule report.
  if (report.dataset === 'reconciliation') {
    // WHO IS BEING RECONCILED. The runner's member picker was being ignored here, which is why a report narrowed to one
    // member still listed everybody - the SCHEDULE branch applies `options.memberIds` and this one did not, so the whole
    // station came back. `mine` is the same idea for a member's own report, and the two cannot both apply.
    const wantedMembers = report.scope === 'mine' ? [caller.uid] : options.memberIds;

    // One collection's rows for the members asked for. A NAMED LIST IS CHUNKED BY 30, which is Firestore's own limit on
    // an `in` filter - the schedule branch does the same, and a report asking about more than thirty members would
    // otherwise fail rather than cap.
    const readInRange = async (build) => {
      if (!wantedMembers.length) {
        const snapshot = await build(null).limit(5001).get();
        return { rows: snapshot.docs.slice(0, 5000).map((row) => ({ ...row.data(), id: row.id })), overLimit: snapshot.size > 5000 };
      }
      const rows = [];
      let overLimit = false;
      for (let start = 0; start < wantedMembers.length && !overLimit; start += 30) {
        const chunk = await build(wantedMembers.slice(start, start + 30)).limit(5001 - rows.length).get();
        rows.push(...chunk.docs.map((row) => ({ ...row.data(), id: row.id })));
        overLimit = rows.length > 5000;
      }
      return { rows: rows.slice(0, 5000), overLimit };
    };

    const scheduleRead = await readInRange((ids) => {
      const base = db.collection('schedule').where('date_from', '>=', from).where('date_from', '<=', to);
      return ids ? base.where('user_id', 'in', ids) : base;
    });
    const scheduleRows = scheduleRead.rows;

    // CLOCK ENTRIES, and the bound is the fiddly part. `time_in` is a DATETIME ("yyyy-MM-dd HH:mm:ss") while `to` is a
    // bare date key, so the upper bound is the day AFTER it, EXCLUSIVE - the same bound GET_TIMECLOCK_LOGS uses, and the
    // bug recorded there is exactly this: comparing "2026-01-31 14:00:00" against "2026-01-31" drops the whole last day.
    //
    // AND THE RANGE FIELD IS NAMED IN ITS OWN ORDER, which is the OTHER half of that note and the reason this report
    // arrived as "Firestore did not answer RUN_REPORT". The declared index is (user_id ASC, time_in DESC); a query that
    // leaves the order implied asks for an ASCENDING scan on `time_in`, which that index cannot serve. THE EMULATOR
    // ANSWERS ANYWAY and production refuses with failed-precondition - so the suite was green, the deploy was fine, and
    // the screen still failed. This is the same trap Clock History fell into (see scripts/verify-read-budget.mjs), and
    // the fix is the same one: say the order out loud.
    const dayAfter = new Date(Date.parse(`${to}T00:00:00.000Z`) + 86400000).toISOString().slice(0, 10);
    const clockRead = await readInRange((ids) => {
      const base = db
        .collection('timeclock')
        .where('time_in', '>=', from)
        .where('time_in', '<', dayAfter)
        .orderBy('time_in', 'DESC');
      return ids ? base.where('user_id', 'in', ids) : base;
    });
    const clockRows = clockRead.rows;

    // Names for whoever appears, whether they were scheduled or merely turned up - a row for somebody who clocked in with
    // no shift at all is the interesting one, so it must not be the one row that reads "Unnamed member".
    const memberIds = [
      ...new Set(
        [...scheduleRows, ...clockRows].map((row) => String(row.user_id || '').trim()).filter(Boolean)
      ),
    ];
    // The template each shift belongs to, because a shift's HOURS live on its template rather than on the row.
    const templateIds = [
      ...new Set(scheduleRows.map((row) => String(row.schedule_template_id || '').trim()).filter(Boolean)),
    ];
    const [memberSnapshots, templateSnapshots] = await Promise.all([
      memberIds.length ? db.getAll(...memberIds.map((id) => db.doc(`users/${id}`))) : [],
      templateIds.length ? db.getAll(...templateIds.map((id) => db.doc(`schedule_templates/${id}`))) : [],
    ]);
    const users = memberSnapshots.map((row) => ({ id: row.id, ...(row.exists ? row.data() : {}) }));
    const templates = templateSnapshots.map((row) => ({ id: row.id, ...(row.exists ? row.data() : {}) }));
    // HOW THE STATION ROUNDS THE HOURS IT REPORTS. One public document holds it, and it is the same setting the member's
    // own Clock History rounds by - so the hours a member reads are the hours this report pays for. Read per run rather
    // than cached, because an officer changing the pay structure expects the next run to use it.
    const stationSettings = await db.doc('settings/public').get();
    const roundingMinutes = clockRoundingStep((stationSettings.data() || {})[CLOCK_ROUNDING_KEY]);

    return {
      report: {
        id: report.id,
        name: report.name,
        visualization: options.visualization,
        group_by: options.groupBy,
        dataset: 'reconciliation',
        unit: 'Hours',
      },
      range: { from, to },
      rows: aggregateReconciliation({
        scheduleRows,
        clockRows,
        groupBy: options.groupBy,
        users,
        templates,
        assignmentIds: options.assignmentIds,
        templateIds: options.templateIds,
        orderBy: options.orderBy,
        roundingMinutes,
      }),
      // The axis that was actually compared, echoed back so the runner can say what these numbers are against rather
      // than leaving an officer to remember which boxes they checked.
      assignment_ids: options.assignmentIds,
      template_ids: options.templateIds,
      truncated: scheduleRead.overLimit || clockRead.overLimit,
    };
  }

  let scheduleRows;
  let overLimit = false;
  if (report.scope !== 'mine' && options.memberIds.length) {
    scheduleRows = [];
    for (let start = 0; start < options.memberIds.length && !overLimit; start += 30) {
      const chunk = await db.collection('schedule')
        .where('user_id', 'in', options.memberIds.slice(start, start + 30))
        .where('date_from', '>=', from).where('date_from', '<=', to)
        .limit(5001 - scheduleRows.length).get();
      scheduleRows.push(...chunk.docs.map((row) => ({ ...row.data(), id: row.id })));
      overLimit = scheduleRows.length > 5000;
    }
    scheduleRows = scheduleRows.slice(0, 5000);
  } else {
    let source = db.collection('schedule').where('date_from', '>=', from).where('date_from', '<=', to);
    if (report.scope === 'mine') source = source.where('user_id', '==', caller.uid);
    const snapshot = await source.limit(5001).get();
    overLimit = snapshot.size > 5000;
    scheduleRows = snapshot.docs.slice(0, 5000).map((row) => ({ ...row.data(), id: row.id }));
  }
  // Names are only read for the groupings that draw them - and `options.groupBy` is a LIST now, so each check is an
  // `includes` rather than an equality. Reading every assignment's name for a report grouped by month was already
  // wasteful; with two levels it would have happened more often.
  const draws = (level) => (Array.isArray(options.groupBy) ? options.groupBy : [options.groupBy]).includes(level);
  const assignmentIds = draws('assignment')
    ? [...new Set(scheduleRows.map((row) => String(row.assignment_id || '').trim()).filter(Boolean))]
    : [];
  const memberIds = draws('member')
    ? [...new Set(scheduleRows.map((row) => String(row.user_id || '').trim()).filter(Boolean))]
    : [];
  // The SHIFT PATTERN's nickname, which is what tells "Officer - Day" from "Officer - Night".
  const templateIds = draws('template')
    ? [...new Set(scheduleRows.map((row) => String(row.schedule_template_id || '').trim()).filter(Boolean))]
    : [];
  const [assignmentSnapshots, memberSnapshots, templateSnapshots] = await Promise.all([
    assignmentIds.length ? db.getAll(...assignmentIds.map((id) => db.doc(`assignments/${id}`))) : [],
    memberIds.length ? db.getAll(...memberIds.map((id) => db.doc(`users/${id}`))) : [],
    templateIds.length ? db.getAll(...templateIds.map((id) => db.doc(`schedule_templates/${id}`))) : [],
  ]);
  const assignments = assignmentSnapshots.map((row) => ({ id: row.id, ...(row.exists ? row.data() : {}) }));
  const users = memberSnapshots.map((row) => ({ id: row.id, ...(row.exists ? row.data() : {}) }));
  const templates = templateSnapshots.map((row) => ({ id: row.id, ...(row.exists ? row.data() : {}) }));
  const rows = aggregateScheduleRows(scheduleRows, { groupBy: options.groupBy, assignments, users, templates, orderBy: options.orderBy });

  return {
    report: { id: report.id, name: report.name, visualization: options.visualization, group_by: options.groupBy, dataset: 'schedule', unit: 'Shifts' },
    range: { from, to },
    rows,
    truncated: overLimit,
  };
});

// How many members have signed each training. A member can only read their own signatures, so the "has anybody signed
// this?" that decides whether a training is still editable has to be counted here - counts only, never who.
// How many members have signed each training.
//
// THE COUNT IS STORED ON THE TRAINING NOW - see onTrainingSignatureCreated / onTrainingSignatureDeleted below, which keep
// it there - so this reads the trainings and answers from that field. It used to SELECT EVERY training_signature to count
// them, on an append-only collection that grows for the station's whole life, every time a role that can edit trainings
// opened the Training module.
//
// IT IS KEPT AS A COMPATIBILITY SHIM, deliberately: an app bundle already open in a browser still asks this callable, and
// until that bundle is replaced it has to keep answering - dropping it here while the old bundle is live would make every
// training read as unsigned (and so editable). The app's own reader (GET_TRAINING) reads the stored field directly and no
// longer calls this at all; the callable can be deleted once no supported client calls it.
exports.readTrainingSignatureCounts = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  // Only a role that can edit trainings acts on the count, so everybody else skips the read.
  const actor = await reportActorFor(request.auth.uid);
  if (!['is_admin', 'can_edit_trainings', 'can_administer_trainings'].some((flag) => isGranted(actor.role[flag]))) {
    return { counts: {} };
  }
  const snapshot = await db.collection('trainings').get();
  const counts = {};
  snapshot.docs.forEach((row) => {
    counts[row.id] = Number(row.get('signature_count') || 0);
  });
  return { counts };
});

// -------------------------------------------------------------------------------------------------------------
// The training signature COUNT, materialized on the training it belongs to.
// -------------------------------------------------------------------------------------------------------------
//
// WHY IT LIVES ON THE TRAINING. The Training module needs "how many members have signed this" for every row it draws -
// the running "1 of 3 signed", and the rule that a training with ANY signature is no longer editable. A member may only
// read their OWN signatures (the rules say so), so that count cannot be computed in the browser; computing it on the
// server by scanning `training_signatures` read an append-only collection that grows forever, on every open of the module.
// A COUNTER on the training document turns that whole-collection scan into a field on a row the screen already reads.
//
// A TRIGGER, not a call from the write path, for the same reason the push notifications are triggers: signing is a DIRECT
// CLIENT WRITE (firestore.rules lets a member create their own row), and an administrator's removal is a direct delete -
// there is no single callable either path must remember to go through. A trigger sees both, and a future write path cannot
// forget it.
//
// IT NEVER THROWS. A trigger that throws is RETRIED by the platform, and a retried increment is a second increment - so
// the only thing this does is a single atomic write, and a failure that is not "the training is gone" is logged rather
// than raised.
const adjustTrainingSignatureCount = async (trainingId, delta) => {
  const id = String(trainingId || '').trim();
  if (!id) return;
  try {
    // `increment` treats a missing field as zero, so the first signature starts the count and a training written before
    // this counter existed is repaired rather than skipped. `update` rather than `set(merge)` ON PURPOSE: a signature whose
    // training has since been deleted must NOT conjure a phantom training document back into the collection.
    await db.doc(`trainings/${id}`).update({ signature_count: FieldValue.increment(delta) });
  } catch (error) {
    const detail = `${(error && error.code) || ''} ${(error && error.message) || ''}`;
    // not-found is the expected case when a training was deleted out from under its signatures. Anything else is a real
    // fault and is worth a line in the log.
    if (!/not-?found|no document to update/i.test(detail)) {
      console.error(`[training] could not adjust signature_count for ${id}: ${detail.trim()}`);
    }
  }
};

exports.onTrainingSignatureCreated = onDocumentCreated('training_signatures/{signatureId}', async (event) => {
  const row = (event.data && event.data.data()) || {};
  await adjustTrainingSignatureCount(row.training_id, 1);
});

exports.onTrainingSignatureDeleted = onDocumentDeleted('training_signatures/{signatureId}', async (event) => {
  const row = (event.data && event.data.data()) || {};
  await adjustTrainingSignatureCount(row.training_id, -1);
});

exports.readDocumentVerificationCount = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(caller.uid, 'can_verify_documents', 'view pending document verifications');

  const documentSnapshot = await db.collection('documents').get();
  const documents = documentSnapshot.docs
    .map((row) => ({ ...row.data(), id: row.id }))
    .filter((document) => {
      const type = String(document.doc_type || '').trim().toLowerCase();
      return type === 'checklist' || (isGranted(document.is_sign_required) && isGranted(document.requires_verification));
    });
  if (!documents.length) return { count: 0 };

  const items = [];
  const signatures = [];
  for (let start = 0; start < documents.length; start += 30) {
    const documentIds = documents.slice(start, start + 30).map((document) => document.id);
    const [itemSnapshot, signatureSnapshot] = await Promise.all([
      db.collection('document_checklist_items').where('document_id', 'in', documentIds).get(),
      db.collection('document_signatures').where('document_id', 'in', documentIds).get(),
    ]);
    items.push(...itemSnapshot.docs.map((row) => ({ ...row.data(), id: row.id })));
    signatures.push(...signatureSnapshot.docs.map((row) => ({ ...row.data(), id: row.id })));
  }

  return {
    count: countPendingDocumentVerifications({
      documents,
      items,
      signatures,
      verifierUserId: caller.uid,
    }),
  };
});

// Adding a member. The username IS the synthetic address, so a taken username is a taken email address - which is
// how uniqueness gets enforced for free, by Auth, rather than by a query that could race.
exports.createMember = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(caller.uid, 'can_edit_users', 'add a member');

  const data = request.data || {};
  const username = cleanUsername(data.username);
  const password = cleanPassword(data.password);
  const name = String(data.name || '').trim();
  if (!name) throw new HttpsError('invalid-argument', 'A name is required.');
  const rankId = String(data.rank_id || '');
  const roleId = String(data.role_id || '');
  await requireAssignableRole(caller.uid, roleId);

  const email = syntheticEmail(username);
  try {
    await auth.getUserByEmail(email);
    throw new HttpsError('already-exists', `The username ${username} is already taken.`);
  } catch (error) {
    // The good case: no such address, so the username is free. Anything else is a real failure.
    if (error instanceof HttpsError) throw error;
    if (error.code !== 'auth/user-not-found') throw error;
  }

  const created = await auth.createUser({ email, password, displayName: name });
  // One batch, so a half-created member is impossible: the roster row, the private row and the settings row either
  // all exist or none do. The Auth account is the one thing that cannot join the batch.
  await db
    .batch()
    .set(db.doc(`users/${created.uid}`), { name, rank_id: rankId, role_id: roleId })
    .set(db.doc(`users_private/${created.uid}`), {
      username,
      status: 'active',
      created_at: new Date().toISOString(),
      created_by: caller.uid,
    })
    .set(db.doc(`user_settings/${created.uid}`), { time_format: '24', is_dark_mode: false })
    .commit();

  await setRoleClaims(created.uid, roleId);
  await audit(caller.uid, 'ADMIN_CREATE_MEMBER', `Created ${username} (${name})`);
  return { userId: created.uid, username };
});

// An officer setting a temporary password - the ONLY way a password is reset, since the synthetic addresses have no
// inbox. The claim is what makes the app walk the member through changing it.
exports.resetMemberPassword = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(caller.uid, 'can_edit_users', 'reset a password');

  const data = request.data || {};
  const userId = String(data.userId || '');
  const target = await auth.getUser(userId);
  await auth.updateUser(userId, { password: cleanPassword(data.temporaryPassword) });
  // The claim AND the officer's column, through the one writer: the app gates on the claim, the Users tab reads the
  // column, and a reset has to turn them on in both - or the member is asked to change a password the officer's own
  // screen does not say is due.
  await setPasswordChangeRequired(userId, true);
  // Who reset whose password, on the member's own record as well as in the log: accountability is the reason resets
  // are officer-driven at all.
  await db.doc(`users_private/${userId}`).set(
    { password_reset_at: new Date().toISOString(), password_reset_by: caller.uid },
    { merge: true }
  );
  await audit(caller.uid, 'ADMIN_RESET_PASSWORD', `Reset the password for ${target.email}`);
  return { userId };
});

// The member's own half: they have changed it, so the flag comes off. Only a function can clear it.
//
// The function changes the Auth password itself before clearing either flag. An empty "done" call cannot clear the
// requirement while leaving the temporary password usable.
exports.completePasswordChange = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in first.');
  const privateAccount = await db.doc(`users_private/${caller.uid}`).get();
  if (caller.token.must_change_password !== true && privateAccount.get('is_change_password_on_login') !== true) {
    throw new HttpsError('failed-precondition', 'A password change has not been requested for this account.');
  }
  const data = request.data || {};
  await auth.updateUser(caller.uid, { password: cleanPassword(data.newPassword) });
  await setPasswordChangeRequired(caller.uid, false);
  await audit(caller.uid, 'COMPLETE_PASSWORD_CHANGE', 'Changed their own password');
  return { ok: true };
});

exports.clockIn = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(caller.uid, 'can_use_timeclock', 'use the timeclock');

  const data = request.data || {};
  const latitude = String(data.gps_lat ?? '').trim();
  const longitude = String(data.gps_lon ?? '').trim();
  if (Boolean(latitude) !== Boolean(longitude)) {
    throw new HttpsError('invalid-argument', 'Both location coordinates are required together.');
  }
  if (latitude && (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude)))) {
    throw new HttpsError('invalid-argument', 'Location coordinates must be numeric.');
  }
  if (latitude && (Number(latitude) < -90 || Number(latitude) > 90 || Number(longitude) < -180 || Number(longitude) > 180)) {
    throw new HttpsError('invalid-argument', 'Location coordinates are outside valid ranges.');
  }

  const entryRef = db.collection('timeclock').doc();
  const dutyRef = db.doc(`on_duty/${caller.uid}`);
  const userRef = db.doc(`users/${caller.uid}`);
  const stamp = stationTimestamp();
  await db.runTransaction(async (transaction) => {
    const [duty, user] = await Promise.all([transaction.get(dutyRef), transaction.get(userRef)]);
    if (duty.exists) throw new HttpsError('failed-precondition', 'already-clocked-in');
    const userData = user.exists ? user.data() : {};
    transaction.create(entryRef, {
      user_id: caller.uid,
      time_in: stamp,
      time_out: '',
      is_manual: false,
      gps_lat: latitude,
      gps_lon: longitude,
    });
    transaction.create(dutyRef, {
      user_id: caller.uid,
      time_in: stamp,
      name: String(userData.name || '').trim(),
      rank_id: String(userData.rank_id || '').trim(),
    });
  });

  return { id: entryRef.id };
});

exports.clockOut = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(caller.uid, 'can_use_timeclock', 'use the timeclock');

  const entryId = String((request.data || {}).entryId || '').trim();
  if (!entryId) throw new HttpsError('invalid-argument', 'An open timeclock entry is required.');
  const entryRef = db.doc(`timeclock/${entryId}`);
  const dutyRef = db.doc(`on_duty/${caller.uid}`);
  const stamp = stationTimestamp();
  await db.runTransaction(async (transaction) => {
    const entry = await transaction.get(entryRef);
    if (!entry.exists) throw new HttpsError('failed-precondition', 'no-entry');
    const data = entry.data() || {};
    if (String(data.user_id || '') !== caller.uid) {
      throw new HttpsError('permission-denied', 'not-your-entry');
    }
    if (String(data.time_out || '')) throw new HttpsError('failed-precondition', 'already-clocked-out');
    const duty = await transaction.get(dutyRef);
    if (duty.exists && String(duty.get('time_in') || '') !== String(data.time_in || '')) {
      throw new HttpsError('failed-precondition', 'on-duty-mismatch');
    }
    transaction.update(entryRef, { time_out: stamp });
    if (duty.exists) transaction.delete(dutyRef);
  });

  return { id: entryId };
});

// ---------------------------------------------------------------------------------------------
// The schedule board, written by functions only
// ---------------------------------------------------------------------------------------------
//
// These two are why `schedule` is write-denied in the rules. A board save has to do three things a client cannot:
// write the audit row naming the officer (clients may not write the log at all), refuse a slot conflict against
// the rows as they are AT THAT MOMENT, and do both in one transaction. The Admin SDK can also run a QUERY inside a
// transaction, which the browser SDK cannot - and a conflict check is a query.
//
// One writer per fact, as the design doc puts it: the board and an approved offer are the only things that write a
// schedule row, and both of them live here.

// THE SCHEDULE'S SENTINEL: one tiny document that changes whenever the schedule does, so a screen looking at a month can be
// told it is out of date WITHOUT holding a listener on the month itself. See src/services/liveReads.js for the client's half
// and src/utils/freshness.js for what it does about it.
//
// WHY EXPLICIT BUMPS RATHER THAN AN onDocumentWritten TRIGGER ON schedule/{scheduleId}:
// A board save writes or deletes 30 to 100 schedule entries in a single batch/transaction. An onDocumentWritten trigger on
// schedule/{scheduleId} would fire 30 to 100 times concurrently for a single save gesture, causing write contention on
// live/schedule and 100 unnecessary trigger executions. Bumping explicitly in saveScheduleBoard and approveOffer bumps
// the sentinel exactly once per save gesture.
const SCHEDULE_SENTINEL_PATH = 'live/schedule';

const bumpScheduleSentinel = async () => {
  try {
    await db
      .doc(SCHEDULE_SENTINEL_PATH)
      .set({ version: FieldValue.increment(1), at: FieldValue.serverTimestamp() }, { merge: true });
  } catch (error) {
    // A sentinel that fails must not take the schedule write with it: the shift is the record, the freshness note is a courtesy.
    console.error(`[live] the schedule sentinel could not be bumped: ${(error && error.message) || error}`);
  }
};

// The shape a schedule row is stored in, from an entry the board sent. A blank user_id is MEANINGFUL - it is what
// marks an open shift - so it is trimmed and kept rather than treated as missing.
const scheduleFieldsFrom = (raw, includeTimes = true) => {
  const entry = raw || {};
  const dateFrom = String(entry.date_from || '').trim();
  if (!dateFrom) return null;
  const memberId = String(entry.user_id || '').trim();
  const fields = {
    schedule_template_id: String(entry.schedule_template_id || ''),
    assignment_id: String(entry.assignment_id || ''),
    user_id: memberId,
    date_from: dateFrom,
    date_to: String(entry.date_to || dateFrom),
    is_open: memberId === '',
  };
  if (includeTimes) {
    fields.start_time = String(entry.start_time || '');
    fields.end_time = String(entry.end_time || '');
  }
  return fields;
};

exports.saveScheduleBoard = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(caller.uid, 'can_edit_schedule', 'change the schedule');

  const data = request.data || {};
  const rawEntries = Array.isArray(data.entries) ? data.entries : [];
  const deleteIds = (Array.isArray(data.deleteIds) ? data.deleteIds : []).map((id) => String(id));

  const prepared = rawEntries.map((entry) => ({
    id: String((entry && entry.id) || ''),
    fields: scheduleFieldsFrom(entry),
  }));
  const invalid = prepared.filter((entry) => !entry.fields).length;
  if (invalid) {
    throw new HttpsError('invalid-argument', `${invalid} entr${invalid === 1 ? 'y has' : 'ies have'} no date.`);
  }

  const saved = await db.runTransaction(async (transaction) => {
    // The conflict check, inside the transaction and after reading the rows: a slot already held by somebody else
    // cannot be handed to a second member. The sheet version made this check under its script lock.
    //
    // IT ASKS ABOUT THE SCHEDULE THIS SAVE WOULD LEAVE BEHIND, which is the part the first version got wrong. Two passes,
    // and together they are the whole question:
    //
    //   1. the request against ITSELF - does the final state put two members in one slot?
    //   2. the request against the STORED rows, ignoring every row this save rewrites or deletes - because a row the
    //      request is changing cannot hold a slot against it. Its slot and its member are exactly what the request
    //      decides.
    //
    // THE SWAP IS WHAT PROVED IT. A hold-to-swap exchanges two rows' positions while each keeps its own id and member
    // (utils/scheduleDrop), so at the moment of the check EACH ROW HOLDS THE SLOT THE OTHER IS BEING GIVEN - the old
    // check refused it, which turned a normal board operation into "Already filled by somebody else". The sheet's board
    // had no server check at all, so it never had to ask this question; the honest version has to ask it properly rather
    // than decline the answer.
    //
    // And the duplicate report, from the same field report as the swap: two entries for one slot each found the same
    // stored row, so one problem was named twice and read like two. A Set answers that.
    const conflicts = new Set();
    // THE SLOT A ROW OCCUPIES, AS THE BOARD DEFINES IT: `slot-${dateKey}-${template.id}` in
    // AdminScheduleManagementTab, and `schedule_template_id` leads swapSlotFields' list of "the fields that say WHERE a
    // row sits". Keying on the ASSIGNMENT instead - which is what this check did - merges shifts the board keeps apart:
    // two templates on one date that happen to share an assignment, and any two custom shifts on one day (a custom shift
    // has no assignment at all, so they all keyed identically). A swap between two same-day shifts was then reported as
    // two members claiming one place, which is the 400 the board got on a plain swap.
    //
    // A CUSTOM SHIFT has no template, and that is not a missing key: it is a row that cannot collide, because the sheet
    // let a day hold several of them and the board draws each as its own pill rather than in a slot.
    const slotKey = (entry) => {
      const templateId = String(entry.fields.schedule_template_id || '').trim();
      return templateId ? `${entry.fields.date_from} ${templateId}` : '';
    };
    const claimed = new Map();
    // A slot this save gives away twice: a second, DIFFERENT member is a CONTENTION, and the SAME member twice is a
    // DUPLICATE. Both put two rows in one slot, and the board draws one pill per slot, so neither is a schedule anybody
    // can read. The board sends only its diff and keeps one occupant per slot, so the duplicate is a guard against a
    // caller that does not - and it costs one comparison to keep "one row per slot" true for every write path.
    const duplicates = new Set();
    // Every row this save touches: rewritten by an entry, or deleted. A row being rewritten keeps its identity but not
    // its position, so it must not count as an occupant below.
    const rewritten = new Set([...prepared.map((entry) => entry.id).filter(Boolean), ...deleteIds]);

    prepared.forEach((entry) => {
      if (!entry.fields.user_id) return;
      const key = slotKey(entry);
      if (!key) return;
      if (claimed.has(key)) {
        if (claimed.get(key) === entry.fields.user_id) duplicates.add(key);
        else conflicts.add(key);
      }
      claimed.set(key, entry.fields.user_id);
    });

    for (const entry of prepared) {
      const key = slotKey(entry);
      if (!entry.fields.user_id || !key || conflicts.has(key) || duplicates.has(key)) continue;
      const sameSlot = await transaction.get(
        db
          .collection('schedule')
          .where('date_from', '==', entry.fields.date_from)
          // The template, not the assignment - the same key the pass above uses, because a check that asks one question
          // in one place and a different one in another is how a swap passes the first test and fails the second.
          .where('schedule_template_id', '==', String(entry.fields.schedule_template_id || '').trim())
      );
      const held = sameSlot.docs.find(
        (row) =>
          !rewritten.has(row.id) &&
          String(row.data().user_id || '') !== '' &&
          String(row.data().user_id) !== entry.fields.user_id
      );
      if (held) conflicts.add(key);
    }
    if (conflicts.size) {
      throw new HttpsError('failed-precondition', `Already filled by somebody else: ${[...conflicts].join(', ')}.`);
    }
    if (duplicates.size) {
      throw new HttpsError('failed-precondition', `The same member is on one slot twice: ${[...duplicates].join(', ')}.`);
    }

    const stamped = [];
    prepared.forEach((entry) => {
      const reference = entry.id ? db.doc(`schedule/${entry.id}`) : db.collection('schedule').doc();
      transaction.set(reference, { ...entry.fields, updated_by: caller.uid }, { merge: true });
      stamped.push(reference.id);
    });
    deleteIds.forEach((id) => transaction.delete(db.doc(`schedule/${id}`)));
    return { ids: stamped, deleted: deleteIds.length };
  });

  await bumpScheduleSentinel();

  await audit(
    caller.uid,
    'ADMIN_BULK_SAVE_SCHEDULE',
    `Saved ${saved.ids.length} schedule entries, deleted ${saved.deleted}`
  );
  return saved;
});

// Approving an offer FILLS the shift, so it writes the row - which is why it lives here rather than in the browser,
// where the first version had it. Same transaction, same audit trail as the board.
exports.approveOffer = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(caller.uid, 'can_approve_shifts', 'approve a shift offer');

  const offerId = String((request.data || {}).offerId || '');
  const result = await db.runTransaction(async (transaction) => {
    const offerRef = db.doc(`schedule_offers/${offerId}`);
    const offer = await transaction.get(offerRef);
    if (!offer.exists) throw new HttpsError('not-found', 'That offer no longer exists.');
    const data = offer.data();
    if (String(data.status) !== 'pending') throw new HttpsError('failed-precondition', 'already-resolved');

    transaction.update(offerRef, { status: 'approved', approved_by: caller.uid });
    if (data.schedule_id) {
      transaction.set(
        db.doc(`schedule/${String(data.schedule_id)}`),
        { user_id: String(data.user_id), is_open: false, updated_by: caller.uid },
        { merge: true }
      );
    }
    return { scheduleId: String(data.schedule_id || '') };
  });

  await bumpScheduleSentinel();

  await audit(caller.uid, 'ADMIN_APPROVE_OFFER', `Approved an offer for shift ${result.scheduleId}`);
  return result;
});

// Declining an offer is the light half of resolving one: it stamps the status and writes NOTHING else. The shift stays
// open, because "no" to one member is not a decision about the shift - and the member cannot offer for it again
// afterwards, which is enforced on their own write (makeOffer) rather than here.
//
// A transaction, for the same reason approveOffer is one: two officers looking at the same offer must not both decide
// it. The second one finds a status that is no longer pending and is refused.
//
// THE STATUS CHANGE IS THE NOTIFICATION. onShiftOfferDecided watches this document and sends the DECLINED push, so
// nothing here has to remember to tell anybody.
exports.declineOffer = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(caller.uid, 'can_approve_shifts', 'decline a shift offer');

  const offerId = String((request.data || {}).offerId || '');
  const result = await db.runTransaction(async (transaction) => {
    const offerRef = db.doc(`schedule_offers/${offerId}`);
    const offer = await transaction.get(offerRef);
    if (!offer.exists) throw new HttpsError('not-found', 'That offer no longer exists.');
    const data = offer.data();
    if (String(data.status) !== 'pending') throw new HttpsError('failed-precondition', 'already-resolved');

    transaction.update(offerRef, { status: 'declined', declined_by: caller.uid });
    return { scheduleId: String(data.schedule_id || '') };
  });

  await audit(caller.uid, 'ADMIN_DECLINE_OFFER', `Declined an offer for shift ${result.scheduleId}`);
  return result;
});

// Inactive and suspended accounts must be disabled in Auth too, or the status is only as good as the app's own checks.
exports.setMemberStatus = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(caller.uid, 'can_edit_users', 'change an account status');

  const data = request.data || {};
  const userId = String(data.userId || '');
  const status = String(data.status || '');
  if (!['active', 'inactive', 'suspended'].includes(status)) {
    throw new HttpsError('invalid-argument', 'A status is active, inactive or suspended.');
  }

  await auth.updateUser(userId, { disabled: status !== 'active' });
  await db.doc(`users_private/${userId}`).set({ status }, { merge: true });
  await audit(caller.uid, 'ADMIN_SET_MEMBER_STATUS', `${status} for ${userId}`);
  return { userId, status };
});

// The two things about a member that a browser must not write, in one callable because they are one kind of fact: the
// private half - the username, and the flag that forces a password change - and, for a rename, the Auth address.
//
// THE EMAIL IS THE REASON THIS CANNOT BE A CLIENT WRITE AT ALL. A member's sign-in address is their username plus the
// station domain, so a rename that did not move the address would leave them typing a username that no longer
// matches their account, and `users_private` is `allow write: if false` on purpose - a client that could rewrite its
// own username could rename itself to somebody else's.
exports.updateMemberAccount = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(caller.uid, 'can_edit_users', 'change a member account');

  const data = request.data || {};
  const userId = String(data.userId || '');
  if (!userId) throw new HttpsError('invalid-argument', 'A member id is required.');

  const changes = {};
  const described = [];

  if (data.username !== undefined) {
    const username = cleanUsername(data.username);
    const email = syntheticEmail(username);
    const taken = await auth.getUserByEmail(email).catch(() => null);
    if (taken && taken.uid !== userId) {
      throw new HttpsError('already-exists', `The username ${username} is already taken.`);
    }
    await auth.updateUser(userId, { email });
    changes.username = username;
    described.push(`username ${username}`);
  }

  if (data.isChangePasswordOnLogin !== undefined) {
    // THROUGH THE ONE WRITER, so the officer's checkbox clears the claim as well as their own column. Unchecking it is
    // how an officer says "stop asking", and with only the column written the member would be held at the modal by a
    // claim nobody had told about it - the same drift as the reported bug, from the other direction.
    const required = await setPasswordChangeRequired(userId, data.isChangePasswordOnLogin === true);
    changes.is_change_password_on_login = required;
    described.push(`change-password-on-next-login ${required ? 'on' : 'off'}`);
  }

  if (!described.length) throw new HttpsError('invalid-argument', 'Nothing was asked for.');

  await db.doc(`users_private/${userId}`).set(changes, { merge: true });
  await audit(caller.uid, 'ADMIN_UPDATE_ACCOUNT', `${described.join(', ')} for ${userId}`);
  return { userId, ...changes };
});

// ---------------------------------------------------------------------------------------------
// The only way an account may come into existence
// ---------------------------------------------------------------------------------------------
//
// The email/password provider cannot be closed to self-sign-up, and the Firebase web config is public by design - so
// without this, anybody could call createUserWithEmailAndPassword from a browser console and make an account. They
// would get no role and therefore see nothing (the rules deny everything to a user with no roster row), but the
// account would exist and count toward the project's users.
//
// An Auth BLOCKING function is what closes it. It runs for every account creation, and the discriminator is that a
// browser's request carries an IP address and a user agent while the Admin SDK's does not: createMember above is
// the only legitimate creator, and it is server-side.
//
// Two things to know before relying on it:
//
//   - Blocking functions FAIL CLOSED. If this function cannot run - a bad deploy, a quota problem - then account
//     creation fails rather than falling through. That is the right way round for a security control, and it is why
//     the logic here is deliberately trivial: the more it does, the more ways it has to break sign-ups.
//   - It needs the project upgraded to Identity Platform, which is a one-click action in the Firebase console and
//     free at this scale. See the Firebase setup section of the README.
const { beforeUserCreated } = require('firebase-functions/v2/identity');

// The audit toggle's other half: the same save, done by a function so an audit row can be written first.
//
// IT IS NOT AN ARBITRARY WRITER, and that is the whole design. The collection has to be in the table below, and the
// table names the permission each one needs - the caller's own role decides, read from the database exactly as the
// rules do. A client that routes its saves through here gains an audit row and nothing else: without the permission
// it is refused, and a collection not in the table cannot be reached at all.
//
// The table duplicates the client's routing table ON PURPOSE. This is a security boundary, so it does not trust the
// client to have named the right collection, and a permission that exists only on the other side of a network call is
// not a permission.
const AUDITED_COLLECTIONS = {
  roles: 'can_edit_roles',
  ranks: 'can_edit_ranks',
  shifts: 'can_edit_schedule',
  certification_setup: 'can_manage_certification_setup',
  certifications: 'can_manage_certifications',
  document_checklist_items: 'can_manage_documents',
  documents: 'can_manage_documents',
  assignments: 'can_edit_assignments',
  schedule_templates: 'can_edit_schedule_templates',
  trainings: 'can_administer_trainings',
  announcements: 'can_make_announcements',
  events: 'can_create_events',
};

exports.saveDocumentWithAudit = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in first.');

  const data = request.data || {};
  const collection = String(data.collection || '');
  const permission = AUDITED_COLLECTIONS[collection];
  if (!permission) throw new HttpsError('permission-denied', `There is no audited save for ${collection}.`);
  await requirePermission(caller.uid, permission, `change ${collection}`);

  const id = String(data.id || '');
  if (!id) throw new HttpsError('invalid-argument', 'An id is required.');

  if (data.remove === true) {
    await db.doc(`${collection}/${id}`).delete();
    await audit(caller.uid, 'ADMIN_DELETE_ROW', `${collection}/${id}`);
    return { id };
  }

  const document = data.document;
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new HttpsError('invalid-argument', 'A document is required.');
  }

  // set with merge, exactly as the client write would have done - the audit row is the ONLY difference.
  await db.doc(`${collection}/${id}`).set(document, { merge: true });
  await audit(caller.uid, 'ADMIN_SAVE_ROW', `${collection}/${id}`);
  return { id };
});

// -------------------------------------------------------------------------------------------------------------
// Deleting a member, which is no longer one row.
// -------------------------------------------------------------------------------------------------------------
//
// On the sheet this action deleted a spreadsheet row and nothing else: there was no separate account to delete, so the
// row WAS the account. That is not enough here, and the gap is a hole rather than a detail: an Auth user left behind can
// still sign in, and a signed-in user whose profile is gone still satisfies every `signedIn()` rule in the file.
//
// So this closes the account and removes the documents that make somebody a member: the roster row, the private half,
// their settings, their certification badges, their on-duty row, and their push devices.
//
// WHAT IT DELIBERATELY KEEPS: their RECORDS. Clock entries, signatures, availability and offers are the station's
// history - who was on duty that night does not stop being true because somebody has left - and the sheet kept them too.
// The roster is the list of people; the records are the record.
//
// TWO THINGS THE SHEET DID NOT GUARD, and this does. Deleting YOURSELF is the surest way to lock a station out of its
// own administration. And deleting the LAST ADMIN is the same hole by another route - suspending the last admin is not
// guarded either, but suspension is reversible and this is not.
exports.deleteMember = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(caller.uid, 'can_edit_users', 'delete a member');

  const userId = String((request.data || {}).userId || '');
  if (!userId) throw new HttpsError('invalid-argument', 'Which member?');
  if (userId === caller.uid) {
    throw new HttpsError('failed-precondition', 'You cannot delete your own account.');
  }

  const user = await db.doc(`users/${userId}`).get();
  if (!user.exists) return { success: false, message: 'User not found.' };

  // The last administrator: refusing here is the only way a station cannot end up with nobody who can administer it.
  const [roles, users] = await Promise.all([db.collection('roles').get(), db.collection('users').get()]);
  const adminRoles = new Set(roles.docs.filter((entry) => (entry.data() || {}).is_admin === true).map((entry) => entry.id));
  if (adminRoles.has(String((user.data() || {}).role_id || ''))) {
    const others = users.docs.filter(
      (entry) => entry.id !== userId && adminRoles.has(String((entry.data() || {}).role_id || ''))
    );
    if (!others.length) {
      return {
        success: false,
        message: 'That is the last administrator, so nobody would be left who can administer the station.',
      };
    }
  }

  // The documents, by id, so each removal is one write and a missing one is not an error.
  const owned = ['users', 'users_private', 'user_settings', 'certification_badges', 'on_duty'];
  await Promise.all(owned.map((name) => db.doc(`${name}/${userId}`).delete()));

  // Devices separately, because they are a QUERY rather than a known document: a row that outlives its member keeps
  // delivering a departed member's alerts to a phone the roster no longer knows about.
  const devices = await db.collection('push_devices').where('user_id', '==', userId).get();
  await Promise.all(devices.docs.map((entry) => entry.ref.delete()));

  // The Auth account LAST, so the documents go first and the door closes behind them. An account that is already gone is
  // not a failure - the point is that it is gone.
  await auth.deleteUser(userId).catch((error) => {
    console.info(`[members] the Auth account for ${userId} was not deleted: ${error.code || error.message}`);
  });

  await audit(caller.uid, 'ADMIN_DELETE_USER', `Deleted ${userId} (${(user.data() || {}).name || 'unnamed'})`);
  return { success: true, message: 'User deleted.' };
});

// The runner's score: a personal best, and only ever upwards.
//
// The game is an easter egg, but the leaderboard is SHARED, so the clamp is server-side for the same reason the sheet's
// was - "guard rail against a doctored request" - and the arithmetic lives here rather than in the writer that calls it,
// because a browser cannot be trusted with the one number everybody compares.
//
// A run that does not beat your best is not a personal best, so this answers with the score still on file and says
// whether anything changed: the game can call it after every run without the board ever going backwards.
const RUNNER_SCORE_MAX = 100000;

exports.saveRunnerScore = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');

  const parsed = parseInt((request.data || {}).score, 10);
  if (!Number.isFinite(parsed)) throw new HttpsError('invalid-argument', 'A score is a number.');
  const score = Math.max(0, Math.min(parsed, RUNNER_SCORE_MAX));

  const reference = db.doc(`users/${request.auth.uid}`);
  const saved = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    // A member who is gone is an ERROR rather than a reply: their browser is mid-session and there is no score to report.
    if (!snapshot.exists) throw new HttpsError('not-found', 'That member no longer exists.');

    const stored = (snapshot.data() || {}).runner_score;
    const previous = Number(stored) || 0;
    if (score > previous) {
      transaction.update(reference, { runner_score: score });
      return { best: score, improved: true };
    }

    // A STORED VALUE THAT IS NOT A NUMBER IS REPAIRED HERE, even though this run is not a personal best, and what is written
    // is the SAME number: a repair rather than a change. It matters because the leaderboard is a QUERY
    // (`where('runner_score', '>', 0)`), and Firestore compares types - so a score stored as text is invisible to it, and
    // its owner stays off the board until they beat a score they already hold. If they never do, they never appear. This is
    // the same repair scripts/normalize-runner-scores.mjs makes in bulk; doing it here means the data heals itself as people
    // play, and nobody has to run anything.
    if (typeof stored !== 'number' && previous > 0) {
      transaction.update(reference, { runner_score: previous });
    }
    return { best: previous, improved: false };
  });

  // `success` is not in here on purpose: the route wraps this in ok(), which is the single place it comes from. A second
  // copy of it in the payload is how a refusal ends up wearing a true.
  //
  // `improved` rather than `changed` because the game's own code reads it that way
  // (FirefighterRunner.jsx: `result.improved ? 'improved' : 'kept'`): this reply was designed by the sheet handler and the
  // component was written against it, so the name is the contract rather than a preference.
  // Logged only when it IS a personal best: a row per run would bury the log in an easter egg.
  if (saved.improved) await audit(request.auth.uid, 'SAVE_RUNNER_SCORE', `Runner personal best ${saved.best}`);
  return { best: saved.best, improved: saved.improved };
});
//
// -------------------------------------------------------------------------------------------------------------
// Push devices: the one door into the device list.
// -------------------------------------------------------------------------------------------------------------
//
// The rules already make the ordinary case safe - a member may only create a row for themselves - so why is this a
// callable at all? Two reasons, and both are the sheet's reasons as well:
//
//   1. A TRANSFER is a member writing a row that belongs to somebody else, which the rules must refuse. The refusal
//      also has to say WHOSE device it is, because the settings card offers a button that moves it - and Firestore's
//      permission-denied carries no such detail.
//   2. A device changing hands is security-relevant for BOTH members and neither can see it from their own side: one
//      has lost a notification target, the other has gained one. The audit log is the only place the two are recorded
//      together, and only a function may write there.
exports.registerPushDevice = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');

  const uid = request.auth.uid;
  const data = request.data || {};
  const token = String(data.device_token || '').trim();
  const label = String(data.device_label || '').trim().slice(0, 80);
  const transfer = data.transfer === true;
  if (!token) return { success: false, message: 'No device token was supplied.' };

  // An administrator's switch outranks the member's own browser: every path into this list - the Enable button, the
  // card's self-healing re-registration, a transfer - ends up here, so the block cannot be walked around by opening
  // the right screen. The member's card reads the same flag and says so before offering anything.
  const settings = await db.doc(`user_settings/${uid}`).get();
  if (settings.exists && (settings.data() || {}).is_push_disabled === true) {
    return {
      success: false,
      code: 'PUSH_DISABLED_BY_ADMIN',
      message: 'An administrator has turned notifications off for your account.',
    };
  }

  const found = await db.collection('push_devices').where('token', '==', token).limit(1).get();
  const stamp = stationTimestamp();

  if (found.empty) {
    await db.collection('push_devices').add({ user_id: uid, token, device_label: label, updated_at: stamp });
    return { success: true, owner_name: '' };
  }

  const row = found.docs[0];
  const ownerId = String((row.data() || {}).user_id || '').trim();

  // Somebody else's device, and no transfer asked for: REFUSED, and named. This is what stops signing in on a shared
  // station computer from quietly making it yours.
  if (ownerId && ownerId !== uid && !transfer) {
    const owner = await db.doc(`users/${ownerId}`).get();
    const ownerData = (owner.exists && owner.data()) || {};
    return {
      success: false,
      owner_id: ownerId,
      owner_name: String(ownerData.name || ownerData.user_name || '').trim() || 'another member',
    };
  }

  await row.ref.set({ user_id: uid, device_label: label, updated_at: stamp }, { merge: true });

  if (ownerId && ownerId !== uid) {
    await audit(uid, 'PUSH_DEVICE_TRANSFERRED', `${ownerId} -> ${uid} (${label || 'unnamed device'})`);
    return { success: true, owner_name: '', transferred_from: ownerId };
  }

  return { success: true, owner_name: '' };
});

// -------------------------------------------------------------------------------------------------------------
// Push delivery: who hears about what, and when.
// -------------------------------------------------------------------------------------------------------------
//
// WHY A TRIGGER RATHER THAN A CALL FROM THE WRITE PATH. The sheet sent these from the same server call that made the
// change, which meant every route into an offer or an announcement had to remember to send. A Firestore trigger fires
// for whoever wrote the document - a member's offer, the board save, a script, the console - so nobody has to remember
// and a new write path cannot forget.
//
// What an event MEANS is in pushAudience.js: pure, and asserted by scripts/verify-push-audience.mjs without sending
// anything, because FCM cannot be exercised in the emulator. This part does the reading and the sending.

// One push, to one set of members, respecting each of their switches.
//
// The shape is the sheet's: the member's own preference, else the station default, else on; every device they have; dead
// tokens dropped rather than retried forever; and ONE audit row naming the event and the counts rather than one row per
// device.
//
// It never throws. A push that cannot be sent is a line in the console; a trigger that throws is RETRIED by the
// platform, which for a notification means a member's phone buzzing twice for one shift.
const deliverPush = async ({ action, actor, recipients, preference, title, body, data }) => {
  const unique = [...new Set((recipients || []).map(text).filter(Boolean))];
  if (!unique.length) return { recipients: 0, delivered: 0 };

  // Query push_devices first: members without any registered device do not need their settings read,
  // and if nobody has a device we can exit before reading settings/public or any user_settings.
  // `in` takes up to thirty values, so the recipient list is chunked rather than assumed small.
  const devicesByUser = new Map();
  for (let index = 0; index < unique.length; index += 30) {
    const chunk = unique.slice(index, index + 30);
    const rows = await db.collection('push_devices').where('user_id', 'in', chunk).get();
    rows.forEach((row) => {
      const rowData = row.data() || {};
      const token = text(rowData.token);
      const userId = text(rowData.user_id);
      if (token && userId) {
        if (!devicesByUser.has(userId)) devicesByUser.set(userId, []);
        devicesByUser.get(userId).push({ token, ref: row.ref });
      }
    });
  }
  if (!devicesByUser.size) return { recipients: unique.length, delivered: 0 };

  const station = await db.doc('settings/public').get();
  const stationDefault = (station.data() || {})[preference];

  // Only read user_settings for members who actually hold registered devices
  const candidatesWithDevices = [...devicesByUser.keys()];
  const settings = await Promise.all(candidatesWithDevices.map((id) => db.doc(`user_settings/${id}`).get()));
  const allowed = [];
  const devices = [];
  settings.forEach((snapshot, index) => {
    const userId = candidatesWithDevices[index];
    const row = snapshot.data() || {};
    // An administrator's switch outranks the member's own, and it is checked here as well as at the door: a device
    // registered before the switch was set would otherwise keep receiving.
    if (row.is_push_disabled === true) return;
    if (!notificationEnabled(row[preference], stationDefault)) return;
    allowed.push(userId);
    devices.push(...(devicesByUser.get(userId) || []));
  });
  if (!devices.length) return { recipients: unique.length, delivered: 0 };

  // Every value in an FCM data block has to be a STRING, and the service worker reads these to tag a notification per
  // shift - so a repeat update to one shift collapses into one notification instead of stacking up.
  const payload = {};
  Object.entries(data || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') payload[key] = String(value);
  });

  const answer = await getMessaging().sendEachForMulticast({
    tokens: devices.map((device) => device.token),
    notification: { title, body },
    data: payload,
  });

  // FCM says when a registration is gone. Anything else - a bad key, a quota, a network - says nothing about the token,
  // so the row stays and the next attempt can succeed.
  const stale = [];
  answer.responses.forEach((result, index) => {
    const code = String((result.error && result.error.code) || '');
    if (!result.success && /not-registered|invalid-argument|invalid-registration/.test(code)) {
      stale.push(devices[index].ref);
    }
  });
  await Promise.all(stale.map((ref) => ref.delete()));

  await audit(actor, action, JSON.stringify({
    ...payload,
    recipients: unique.length,
    // Both numbers, which is the sheet's lesson: "delivered 0 for 3 recipients" and "delivered 0 for 0 recipients" are a
    // broken device, a switched-off member and an empty audience respectively, and one number cannot tell them apart.
    delivered: answer.successCount,
    skipped: unique.length - allowed.length,
    stale_removed: stale.length,
  }));

  return { recipients: unique.length, delivered: answer.successCount };
};

// The two reads every offer push needs: the roles (which of them can approve) and the members who hold those roles.
//
// IT USED TO READ THE WHOLE DIRECTORY. An offer's audience is the APPROVERS, so the members worth reading are the ones
// whose role can approve - not all thirty-odd people on the roster. `roles` stays a whole read because it is a handful of
// rows and every role has to be judged; `users` is narrowed to the approver roles, in batches of thirty (the ceiling on
// `in`). The answer is identical - approverIds() still filters by the same role set - but it reads the people who matter
// rather than everyone.
const offerAudience = async () => {
  const rolesSnapshot = await db.collection('roles').get();
  const roles = rolesSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  const approverRoleIds = roles
    // The SAME predicate approverIds() uses (isTruthy), so the roles named here are exactly the roles it will accept a
    // member of - a narrower test would drop an approver the push then never reaches.
    .filter((role) => isTruthy(role.is_admin) || isTruthy(role.can_approve_shifts))
    .map((role) => String(role.id).trim())
    .filter(Boolean);

  const users = [];
  for (let start = 0; start < approverRoleIds.length; start += 30) {
    const batch = approverRoleIds.slice(start, start + 30);
    const snapshot = await db.collection('users').where('role_id', 'in', batch).get();
    snapshot.docs.forEach((entry) => users.push({ id: entry.id, ...entry.data() }));
  }
  return { roles, users };
};

// A new offer: the approvers hear about it, because they are the ones with something to do.
exports.onShiftOfferSubmitted = onDocumentCreated('schedule_offers/{offerId}', async (event) => {
  try {
    const offer = (event.data && event.data.data()) || {};
    const { roles, users } = await offerAudience();
    const copy = offerCopy('SUBMITTED', { dateFrom: offer.date_from, dateTo: offer.date_to });
    await deliverPush({
      action: 'SHIFT_OFFER_SUBMITTED',
      actor: text(offer.user_id),
      recipients: offerRecipients({ event: 'SUBMITTED', offer, roles, users }),
      preference: copy.preference,
      title: copy.title,
      body: copy.body,
      data: {
        event: 'SHIFT_OFFER_SUBMITTED',
        offer_id: event.params.offerId,
        schedule_id: offer.schedule_id,
        date_from: offer.date_from,
        date_to: offer.date_to || offer.date_from,
      },
    });
  } catch (error) {
    console.error(`[push] the new-offer notification failed: ${(error && error.message) || error}`);
  }
});

// A decided offer: the member hears the outcome, and only when the STATUS actually moves. An offer saved twice while
// still pending - or any other field edited after it was decided - tells nobody anything.
exports.onShiftOfferDecided = onDocumentUpdated('schedule_offers/{offerId}', async (event) => {
  try {
    const before = (event.data && event.data.before && event.data.before.data()) || {};
    const after = (event.data && event.data.after && event.data.after.data()) || {};
    if (text(before.status) === text(after.status)) return;

    const decided = offerEventFromStatus(after.status);
    if (!decided) return;

    const copy = offerCopy(decided, { dateFrom: after.date_from, dateTo: after.date_to });
    await deliverPush({
      action: `SHIFT_OFFER_${decided}`,
      actor: text(after.user_id),
      recipients: offerRecipients({ event: decided, offer: after }),
      preference: copy.preference,
      title: copy.title,
      body: copy.body,
      data: {
        event: `SHIFT_OFFER_${decided}`,
        offer_id: event.params.offerId,
        schedule_id: after.schedule_id,
        date_from: after.date_from,
        date_to: after.date_to || after.date_from,
      },
    });
  } catch (error) {
    console.error(`[push] the decision notification failed: ${(error && error.message) || error}`);
  }
});

// The candidate accounts an audience could reach, gathered by QUERY rather than by reading the whole directory.
//
// The audience keys are the SAME ones the rules check with hasAny (`*`, `role:<id>`, `rank:<id>`, `user:<id>`), so the
// narrowing here cannot widen who is reachable: role and rank keys become an `in` query on that field, a user key is a
// direct read, and only the `*` case still reads the collection - which is exactly the case that MEANS everyone. The final
// filter is still announcementRecipients(), so a query that over-returns is narrowed back to the same answer.
const accountsForAudience = async (audienceKeys) => {
  const targets = audienceTargetsFrom(audienceKeys);
  const toAccount = (entry) => ({
    userId: entry.id,
    roleId: (entry.data() || {}).role_id,
    rankId: (entry.data() || {}).rank_id,
  });
  if (targets.everyone) {
    const all = await db.collection('users').get();
    return all.docs.map(toAccount);
  }

  const byId = new Map();
  const gather = (docs) => docs.forEach((entry) => byId.set(entry.id, toAccount(entry)));
  const chunks = (ids) => {
    const out = [];
    for (let start = 0; start < ids.length; start += 30) out.push(ids.slice(start, start + 30));
    return out;
  };

  await Promise.all([
    ...chunks(targets.roleIds).map((batch) =>
      db.collection('users').where('role_id', 'in', batch).get().then((snapshot) => gather(snapshot.docs))
    ),
    ...chunks(targets.rankIds).map((batch) =>
      db.collection('users').where('rank_id', 'in', batch).get().then((snapshot) => gather(snapshot.docs))
    ),
  ]);

  if (targets.userIds.length) {
    const named = await db.getAll(...targets.userIds.map((id) => db.doc(`users/${id}`)));
    named.forEach((entry) => {
      if (entry.exists) byId.set(entry.id, toAccount(entry));
    });
  }
  return [...byId.values()];
};

// THE SCHEDULE'S SENTINEL: one tiny document that changes whenever the schedule does, so a screen looking at a month can be
// told it is out of date WITHOUT holding a listener on the month itself. See src/services/liveReads.js for the client's half
// and src/utils/freshness.js for what it does about it.
//
// WHY A SENTINEL RATHER THAN A LISTENER ON THE SCHEDULE. A listener's first snapshot bills one read per document in the window,
// which is what a screen already pays to look at that month - and only CHANGES are billed after that, so it is not the cliff it
// looks like. What it does cost is a held socket per open screen, and a read on every listener for every write. A document the
// client watches for a penny - one read to attach, one per change - buys the same result: "something changed, read the window
// again". The big read stays one-shot and lazy, which is how the schedule was designed in the first place.
//
// A COUNT, NOT A TIMESTAMP. The client only ever asks "is this different from what I last read", which a number answers without
// either side having to trust the other's clock; a bump per write means the value changes even for two edits in the same
// second. `at` rides along for a human reading the console, and for the "updated X ago" line a screen shows.
//
// THE BUMP IS A SERVER WRITE, in a trigger rather than in the client, because a version a browser can set is a version a
// browser can leave out. It cannot loop either: this writes a different document from the one it watches.
//
// THE PATH IS ALSO IN src/utils/freshness.js, and scripts/verify-freshness.mjs asserts the two agree - a server bumping one
// document while clients watch another is a sentinel that never fires, which is a failure with no symptom at all.
exports.onShiftWritten = onDocumentWritten('shifts/{shiftId}', async () => bumpScheduleSentinel());

// AN ANNOUNCEMENT: whoever the audience names, by the same keys the rules check with hasAny - so an audience cannot mean
// one thing to the rules and another thing to the push.
exports.onAnnouncementCreated = onDocumentCreated('announcements/{announcementId}', async (event) => {
  try {
    const announcement = (event.data && event.data.data()) || {};
    const accounts = await accountsForAudience(announcement.audience_keys);

    const message = text(announcement.message);
    await deliverPush({
      action: 'ANNOUNCEMENT_PUSHED',
      actor: text(announcement.author_user_id || announcement.user_id),
      recipients: announcementRecipients({ audienceKeys: announcement.audience_keys, accounts }),
      preference: 'notify_announcements',
      title: text(announcement.title) || 'Announcement',
      // Trimmed: a notification body is a glance, and the announcement itself is in the app. The service worker falls
      // back to a sentence of its own when this is empty.
      body: message.length > 160 ? `${message.slice(0, 157)}...` : message,
      data: { event: 'ANNOUNCEMENT', announcement_id: event.params.announcementId },
    });
  } catch (error) {
    console.error(`[push] the announcement notification failed: ${(error && error.message) || error}`);
  }
});

// THE CHAT TRUSTED HALF: what a message may contain, who may change one, and what the fan-out writes. Pure, so
// scripts/verify-chat.mjs can ask it directly - a callable cannot be exercised by this suite at all (no Functions
// emulator), which is the arrangement functions/rosterPage.js and functions/certificationFiles.js already follow.
const {
  CHAT_BODY_MAX: CHAT_BODY_LIMIT,
  chatConversationFields,
  chatEditPatch,
  chatInboxFields,
  chatMemberProblem,
  chatGifProblem,
  chatMessageDoc,
  chatParticipantPatch,
  chatParticipantProblem,
  chatPermissionForAction,
  chatPreviewOf,
  chatPushPreferenceFor,
  chatPushRecipients,
  chatPushSummary,
  chatReceiptsDoc,
  chatReceiptsMembership,
  chatReactionProblem,
  chatReactionToggled,
  chatReachablePeople,
  chatRecipientsFor,
  chatRemovalPatch,
  chatThreadDoc,
  chatThreadIdFor,
  chatThreadMembersIn,
  chatThreadProblem,
  chatWriteProblem,
} = require('./chat');

// The caller's audience keys - the three shapes the rules check with hasAny, built from the caller's own roster row. The
// `*` key is deliberately NOT among them: chatMemberProblem asks about everyone separately, so a member cannot pass
// their way into a room by carrying a key they were never granted.
const chatKeysForCaller = (uid, roster) => [
  `user:${uid}`,
  `role:${String((roster || {}).role_id || '')}`,
  `rank:${String((roster || {}).rank_id || '')}`,
];

// One conversation and the caller's own document, read together because every message action needs both - and the
// membership check is the same question whichever action it is.
const chatContext = async (uid, conversationId) => {
  const id = String(conversationId || '').trim();
  if (!id) throw new HttpsError('invalid-argument', 'Which conversation?');
  const [conversation, roster] = await Promise.all([
    db.doc(`chat_conversations/${id}`).get(),
    db.doc(`users/${uid}`).get(),
  ]);
  const row = conversation.exists ? { id, ...conversation.data() } : null;
  // THREE things are read off this row beyond the caller's name, and all three were already in hand - which is the point:
  //
  //   * `role_id` and `rank_id`, because the reaction check asks whether a message's stamped audience reaches this member, and
  //     for a station room - whose audience is a role or a rank rather than a list of people - knowing WHO the caller is says
  //     nothing about it (functions/chat.js#chatReactionProblem).
  //   * `avatar_url`, which is stamped onto every message the caller writes (functions/chat.js#chatMessageDoc), so that a
  //     conversation's pictures cost no directory read at all.
  const me = {
    id: uid,
    name: String((roster.exists && roster.get('name')) || ''),
    role_id: String((roster.exists && roster.get('role_id')) || ''),
    rank_id: String((roster.exists && roster.get('rank_id')) || ''),
    avatar_url: String((roster.exists && roster.get('avatar_url')) || ''),
  };
  const problem = chatMemberProblem({
    conversation: row,
    member: me,
    keys: chatKeysForCaller(uid, roster.exists ? roster.data() : {}),
  });
  if (problem) throw new HttpsError('permission-denied', problem);
  return { conversation: row, me };
};

// SENDING. The row is written here rather than by the browser, for the reasons at the top of functions/chat.js: the
// audience proof on a message has to be unforgeable, and who wrote it and when are not the client's to say.
exports.sendChatMessage = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(request.auth.uid, 'can_use_chat', 'send a chat message');

  const data = request.data || {};
  // THE PICTURE IS CHECKED BEFORE ANYTHING ELSE IS WASTED ON IT, and the check is the server's own - the client's copy
  // exists so somebody sees why, this one is what decides. See functions/chat.js#chatGifProblem.
  const gifProblem = chatGifProblem(data.gif);
  if (gifProblem) throw new HttpsError('invalid-argument', gifProblem);

  // A MESSAGE MAY BE A PICTURE AND NOTHING ELSE, which is why the empty-body answer depends on whether one was attached:
  // requiring a caption for every GIF would mean inventing a sentence to send a joke.
  const problem = chatWriteProblem(data.body, { max: CHAT_BODY_LIMIT, allowEmpty: Boolean(String((data.gif || {}).url || '').trim()) });
  if (problem) throw new HttpsError('invalid-argument', problem);

  const { conversation, me } = await chatContext(request.auth.uid, data.conversationId);
  const at = stationTimestamp();
  const ref = db.collection(`chat_conversations/${conversation.id}/messages`).doc();
  const row = chatMessageDoc({
    conversation,
    author: me,
    body: data.body,
    gif: data.gif,
    at,
    serverTimestamp: FieldValue.serverTimestamp(),
  });

  await ref.set(row);
  // The conversation's own preview and activity, so a room list is drawn without reading a single message - and so a
  // removal has ONE document to clear rather than every member's copy of it.
  //
  // A PICTURE WITH NO CAPTION SAYS SO in the preview, because the alternative is a room list row with nothing beside the
  // name - which reads as a bug rather than as a message somebody chose not to caption.
  await db
    .doc(`chat_conversations/${conversation.id}`)
    .set(
      chatConversationFields({
        message: { ...row, id: ref.id },
        preview: chatPreviewOf(row.body || (row.gif_url ? 'Picture' : '')),
      }),
      { merge: true }
    );

  // The row comes back with its id, so the sender's own screen can draw it before the listener echoes it. The listener
  // WILL echo it too - the client's merge replaces by id, which is what stops one message being drawn twice.
  return { success: true, id: ref.id, message: { ...row, id: ref.id } };
});

// OPENING A PRIVATE CONVERSATION. See the section at the top of functions/chat.js: a thread IS a conversation whose audience
// is its members, so this mints one - or FINDS THE ONE THAT ALREADY EXISTS, because the id is derived from the members
// rather than generated. Two members pressing "message" on each other find the same conversation, from either end.
//
// WHO MAY BE MESSAGED, and why this is a callable at all: a member naming an audience is the one place in chat where they
// name other people rather than choosing from rooms somebody else built. The audience for a thread is "these members", and
// the only honest way to check that they may each be in a conversation is to read their roles - which is a lookup across
// other people's documents, exactly what a callable is for. A member whose role does not grant Chat cannot be pulled into a
// conversation they could not open themselves.
exports.openChatThread = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const uid = request.auth.uid;
  await requirePermission(uid, 'can_use_chat', 'start a private conversation');

  const data = request.data || {};
  const wanted = chatThreadMembersIn(data.memberIds);

  const [roster, userRows] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    wanted.length ? db.getAll(...wanted.map((id) => db.doc(`users/${id}`))) : Promise.resolve([]),
  ]);
  const people = userRows.filter((row) => row.exists).map((row) => ({ id: row.id, ...row.data() }));

  // One role read per DISTINCT role rather than per member: a station's members share a handful of roles between them, and
  // this is the same reason the roster read resolves roles in one pass.
  const roleIds = [...new Set(people.map((person) => String(person.role_id || '')).filter(Boolean))];
  const roleRows = roleIds.length ? await db.getAll(...roleIds.map((id) => db.doc(`roles/${id}`))) : [];
  const grantsChat = new Map(
    roleRows.filter((row) => row.exists).map((row) => [row.id, isGranted(row.get('can_use_chat'))])
  );

  const me = { id: uid, name: String((roster.exists && roster.get('name')) || '') };
  const members = people.map((person) => ({
    id: person.id,
    name: String(person.name || ''),
    can_use_chat: grantsChat.get(String(person.role_id || '')) === true,
  }));

  const problem = chatThreadProblem({ member: me, memberIds: wanted, members });
  if (problem) throw new HttpsError('invalid-argument', problem);

  const ids = chatThreadMembersIn([uid, ...members.map((person) => person.id)]);
  const id = chatThreadIdFor(ids);
  if (!id) throw new HttpsError('failed-precondition', 'That conversation cannot be created.');

  const ref = db.doc(`chat_conversations/${id}`);
  const existing = await ref.get();
  if (existing.exists) {
    // FOUND RATHER THAN CREATED - and A MEMBER ASKING FOR A CONVERSATION THEY ARE NOT IN IS PUT BACK INTO IT. That is what
    // makes LEAVING recoverable: the id is derived from the members (chatThreadIdFor), so "start a conversation with these
    // people" finds this one - and without this, the member who left would be handed a conversation they cannot read a word of,
    // which looks exactly like the app losing their messages.
    const row = { id, ...existing.data() };
    if (!chatThreadMembersIn(row.member_ids).includes(uid)) {
      const patch = chatParticipantPatch({ conversation: row, add: [uid], members: [me] });
      await ref.set(patch, { merge: true });
      return { success: true, created: false, rejoined: true, id, conversation: { ...row, ...patch } };
    }
    return { success: true, created: false, id, conversation: row };
  }

  const row = chatThreadDoc({
    memberIds: ids,
    memberNames: [me, ...members].map((person) => ({ id: person.id, name: person.name })),
    creator: me,
    now: stationTimestamp(),
  });
  await ref.set(row);
  // AND ITS RECEIPTS, so a thread exists with everything that belongs to it rather than growing a document the first time
  // somebody happens to read it. Written here rather than by a member: this is a callable, and firestore.rules refuses a client
  // create on that path (see chatReceiptsDoc for why the receipts have a document of their own at all).
  await db.doc(`chat_receipts/${id}`).set(chatReceiptsDoc({ conversationId: id, memberIds: ids }));
  return { success: true, created: true, id, conversation: { id, ...row } };
});

// REACTING TO A MESSAGE: one emoji, toggled, written onto the message's own row. See the note in functions/chat.js for why the
// map lives there (the window a member is already reading carries it, so a screen draws every reaction with no extra read) and
// why this is a callable at all: the messages collection refuses every client write, because the audience proof that makes a
// listener provable travels ON the message, and opening that document to browsers would open the proof with it.
//
// THE ROW COMES BACK, so the member's own screen draws the change at once rather than waiting for the listener - exactly as
// sending and editing do, and the listener's echo replaces it by id rather than doubling it.
exports.reactToChatMessage = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const uid = request.auth.uid;
  await requirePermission(uid, 'can_use_chat', 'react to a chat message');

  const data = request.data || {};
  // Membership is settled here, by the conversation's own audience - which is the one check that works for a room AND a thread.
  const { conversation, me } = await chatContext(uid, data.conversationId);
  const messageId = String(data.messageId || '').trim();
  const ref = db.doc(`chat_conversations/${conversation.id}/messages/${messageId}`);
  const existing = await ref.get();
  const row = existing.exists ? existing.data() || {} : null;

  const problem = chatReactionProblem({
    message: row,
    member: me,
    emoji: data.emoji,
    keys: chatKeysForCaller(uid, me),
  });
  if (problem) throw new HttpsError('failed-precondition', problem);

  const reactions = chatReactionToggled({ reactions: row.reactions, emoji: data.emoji, memberId: uid });
  await ref.set({ reactions }, { merge: true });
  return { success: true, id: messageId, message: { ...row, reactions, id: messageId } };
});

// ADDING AND REMOVING PEOPLE FROM A PRIVATE CONVERSATION - and LEAVING, which is a removal of yourself rather than a fourth
// thing. See the section in functions/chat.js for the two rules that govern it (only a member of a thread may change it, and
// only a thread can change at all) and for the three fields it writes together.
//
// THE PEOPLE ARE RESOLVED THE SAME WAY AS WHEN A THREAD IS OPENED: their roles are read to ask whether they may use chat at
// all, because a member cannot read other people's roles and this is the same question openChatThread asks. One role read per
// DISTINCT role, not per person.
exports.updateChatParticipants = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const uid = request.auth.uid;
  await requirePermission(uid, 'can_use_chat', 'change who is in a conversation');

  const data = request.data || {};
  // chatContext proves the caller is in the conversation, which is the first rule - a member cannot add themselves to somebody
  // else's thread by asking nicely.
  const { conversation } = await chatContext(uid, data.conversationId);

  const wanted = chatThreadMembersIn(data.add);
  const [roster, userRows] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    wanted.length ? db.getAll(...wanted.map((id) => db.doc(`users/${id}`))) : Promise.resolve([]),
  ]);
  const people = userRows.filter((row) => row.exists).map((row) => ({ id: row.id, ...row.data() }));
  const roleIds = [...new Set(people.map((person) => String(person.role_id || '')).filter(Boolean))];
  const roleRows = roleIds.length ? await db.getAll(...roleIds.map((id) => db.doc(`roles/${id}`))) : [];
  const grantsChat = new Map(
    roleRows.filter((row) => row.exists).map((row) => [row.id, isGranted(row.get('is_admin')) || isGranted(row.get('can_use_chat'))])
  );
  const members = people.map((person) => ({
    id: person.id,
    name: String(person.name || ''),
    can_use_chat: grantsChat.get(String(person.role_id || '')) === true,
  }));

  const member = { id: uid, name: String((roster.exists && roster.get('name')) || '') };
  const remove = chatThreadMembersIn(data.remove);
  const problem = chatParticipantProblem({ conversation, member, add: wanted, remove, members });
  if (problem) throw new HttpsError('failed-precondition', problem);

  const patch = chatParticipantPatch({ conversation, add: wanted, remove, members });
  const before = chatThreadMembersIn(conversation.member_ids);

  // A CHANGE THAT CHANGES NOTHING IS NOT WRITTEN. Two members pressing "add" on the same person at the same moment, or a screen
  // acting on a list that has already moved, must not rewrite the document - and more to the point must not play anybody an
  // entry sound for somebody who was already there (the panel's tones come from this list changing).
  if (JSON.stringify(patch.member_ids) === JSON.stringify(before)) {
    return { success: true, changed: false, added: [], removed: [], conversation: { ...conversation, ...patch } };
  }

  await db.doc(`chat_conversations/${conversation.id}`).set(patch, { merge: true });
  // THE RECEIPTS LEARN WHO IS IN IT, in the same call, so the rule that decides who may record their place keeps answering
  // correctly. Only the member list moves: whoever left keeps their own entry in `read_at` and cannot reach the document to
  // remove it, which is harmless - the receipts a screen draws come from the conversation's list, so a stale key is invisible.
  await db.doc(`chat_receipts/${conversation.id}`).set(chatReceiptsMembership({ memberIds: patch.member_ids }), { merge: true });

  // WHOEVER LEFT LOSES THEIR BADGE. The inbox row is the fan-out's and nothing else removes it, so without this a member who is
  // no longer in a conversation keeps a count they can never read down - the messages behind it are not theirs any more.
  const leaving = before.filter((id) => !patch.member_ids.includes(id));
  if (leaving.length) {
    const batch = db.batch();
    leaving.forEach((id) => batch.delete(db.doc(`chat_inbox/${id}/rooms/${conversation.id}`)));
    await batch.commit();
  }

  return {
    success: true,
    changed: true,
    added: patch.member_ids.filter((id) => !before.includes(id)),
    removed: leaving,
    conversation: { ...conversation, ...patch },
  };
});

// WHO A MEMBER MAY MESSAGE, for the picker that starts a private conversation.
//
// A CALLABLE RATHER THAN A READ, and that is not a preference: the answer is not in anything a member may read. A member
// sees a minimal roster projection with no roles on it, and the question here is which of their colleagues' ROLES grant
// Chat - a lookup across other people's documents, which is what a callable is for, exactly as it is for opening a thread.
//
// The list comes from chatReachablePeople, the same function openChatThread checks its members with, so the people offered
// and the people accepted cannot drift apart.
exports.getChatPeople = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(request.auth.uid, 'can_use_chat', 'see who you can message');

  // THE ROLES COME FIRST, BECAUSE THEY NARROW THE READ THAT FOLLOWS. This used to read the whole `users` collection and then
  // work out which of them might chat, which bills for every member of the station to answer a question about a few of them.
  // Which roles grant Chat is a handful of documents, and from it the member query below asks only for the people it can
  // possibly return - so the cost of opening the picker is the people who can be messaged, not the size of the station.
  //
  // (At station scale those are often the same number, and this saves nothing - a station where every role has Chat gets a
  // list as long as its roster either way. It matters in the shape stations actually differ in: a station where Chat is for
  // officers and the office, which is exactly the shape where a picker full of people you may not message would be wrong.)
  const roleRows = await db.collection('roles').get();
  // The master switch is applied HERE, once, for both this and the thread opener: a role with `is_admin` may chat whatever
  // its own column says, which is how the client's own chatPermissionsFrom reads it too.
  const roles = roleRows.docs.map((row) => ({
    id: row.id,
    can_use_chat: isGranted(row.get('is_admin')) || isGranted(row.get('can_use_chat')),
  }));
  const chatty = roles.filter((role) => role.can_use_chat).map((role) => role.id);

  // `in` takes at most thirty values, so the roles are walked in chunks rather than sliced - a slice would quietly stop
  // offering the members of whichever role fell off the end, which is the kind of missing person nobody reports.
  const users = [];
  for (let at = 0; at < chatty.length; at += 30) {
    const rows = await db
      .collection('users')
      .where('role_id', 'in', chatty.slice(at, at + 30))
      .get();
    rows.docs.forEach((row) => users.push({ id: row.id, ...row.data() }));
  }

  return { success: true, people: chatReachablePeople({ viewerId: request.auth.uid, users, roles }) };
});

// EDITING. Four permissions govern two acts, and which pair applies is decided by ONE question - is this the caller's
// own message - asked in one place (chatPermissionForAction) so a callable cannot ask about the wrong half of the pair.
exports.editChatMessage = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(request.auth.uid, 'can_use_chat', 'edit a chat message');

  const data = request.data || {};
  const problem = chatWriteProblem(data.body, { max: CHAT_BODY_LIMIT });
  if (problem) throw new HttpsError('invalid-argument', problem);

  const uid = request.auth.uid;
  const { conversation } = await chatContext(uid, data.conversationId);
  const messageId = String(data.messageId || '').trim();
  const ref = db.doc(`chat_conversations/${conversation.id}/messages/${messageId}`);
  const existing = await ref.get();
  if (!existing.exists) throw new HttpsError('not-found', 'That message is not there any more.');
  const row = existing.data() || {};
  if (row.deleted_at) throw new HttpsError('failed-precondition', 'A removed message cannot be edited.');

  const flag = chatPermissionForAction({ action: 'edit', mine: String(row.author_id || '') === uid });
  if (!(await callerMay(uid, flag))) {
    throw new HttpsError('permission-denied', 'You do not have permission to edit that message.');
  }

  const at = stationTimestamp();
  const patch = chatEditPatch({ body: data.body, at, serverTimestamp: FieldValue.serverTimestamp() });
  await ref.set(patch, { merge: true });

  // The room list's line is this message's text while it is the newest one, so an edit has to reach it too - and the
  // conversation is already in hand, which makes this a write rather than another read.
  if (String(conversation.last_message_id || '') === messageId) {
    await db.doc(`chat_conversations/${conversation.id}`).set({ last_preview: chatPreviewOf(patch.body) }, { merge: true });
  }

  return { success: true, id: messageId, message: { ...row, ...patch, id: messageId } };
});

// REMOVING. Nothing is deleted: the body is emptied and the row keeps the shape of having been there, which is what the
// station asked for - and WHO removed it is recorded, because the difference between "Deleted by author" and "Deleted by
// Jane Smith" is the whole reason an officer's removal is worth having.
exports.deleteChatMessage = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(request.auth.uid, 'can_use_chat', 'remove a chat message');

  const uid = request.auth.uid;
  const data = request.data || {};
  const { conversation, me } = await chatContext(uid, data.conversationId);
  const messageId = String(data.messageId || '').trim();
  const ref = db.doc(`chat_conversations/${conversation.id}/messages/${messageId}`);
  const existing = await ref.get();
  if (!existing.exists) throw new HttpsError('not-found', 'That message is not there any more.');
  const row = existing.data() || {};
  if (row.deleted_at) throw new HttpsError('failed-precondition', 'That message has already been removed.');

  const flag = chatPermissionForAction({ action: 'delete', mine: String(row.author_id || '') === uid });
  if (!(await callerMay(uid, flag))) {
    throw new HttpsError('permission-denied', 'You do not have permission to remove that message.');
  }

  const at = stationTimestamp();
  const patch = chatRemovalPatch({ actor: me, at, serverTimestamp: FieldValue.serverTimestamp() });
  await ref.set(patch, { merge: true });

  // A PREVIEW MUST NOT OUTLIVE THE MESSAGE. If the removed message is the newest one, the room list's line would go on
  // showing text the station has just removed - so it is cleared here, on the one document that holds it, rather than
  // left for somebody to notice.
  if (String(conversation.last_message_id || '') === messageId) {
    await db.doc(`chat_conversations/${conversation.id}`).set({ last_preview: '' }, { merge: true });
  }

  return { success: true, id: messageId, message: { ...row, ...patch, id: messageId } };
});

// THE FAN-OUT: one message becomes one small row per member who can see it, so a badge costs ONE listener over a handful
// of documents rather than a listener per room.
//
// THE MESSAGE CARRIES ITS OWN AUDIENCE, which is why this trigger reads no conversation at all: `audience_keys` was
// stamped on the row by the sender's callable, un-forgeably, and the recipients fall straight out of it. The only read
// here is the directory those keys resolve against, and that is CACHED - see DIRECTORY_TTL_MS below.
//
// `count` IS AN INCREMENT, never a read-modify-write: two messages arriving together would otherwise both read the same
// number and write the same number back, and one of them would vanish from every badge on the station. `merge: true`
// keeps the member's own `read_count` and `muted` exactly where they were - a fan-out that replaced the document would
// silently mark every room as read.
const DIRECTORY_TTL_MS = 5 * 60 * 1000;
let chatDirectoryCache = { at: 0, rows: [] };

// The station's directory, briefly. A member who joined a minute ago may miss ONE badge from this - their room list
// comes from a query rather than from the inbox, so they still see the room, and the next message reaches them. What the
// cache buys is the difference between reading the whole station once per message and once every five minutes.
const chatDirectory = async () => {
  if (Date.now() - chatDirectoryCache.at < DIRECTORY_TTL_MS) return chatDirectoryCache.rows;
  const snapshot = await db.collection('users').get();
  const rows = snapshot.docs.map((entry) => ({
    id: entry.id,
    role_id: (entry.data() || {}).role_id,
    rank_id: (entry.data() || {}).rank_id,
  }));
  chatDirectoryCache = { at: Date.now(), rows };
  return rows;
};

// The station's roles, as a lookup, cached on the same clock - and for a reason of its own: the fan-out must not write an
// inbox row for a member who cannot open Chat at all.
//
// "WITHOUT THIS PERMISSION, FCM PUSH IGNORES THIS USER" is the promise made on the permission, and the only place that
// promise can be kept for a badge is here: an inbox row is a notification in waiting, so a member whose role has no
// `can_use_chat` gets none - no badge, and (when chat pushes arrive) no push. The role document is the source of truth
// rather than the token, exactly as it is in the rules, so a role change takes effect within the cache's five minutes.
let chatRolesCache = { at: 0, byId: {} };

const chatRoles = async () => {
  if (Date.now() - chatRolesCache.at < DIRECTORY_TTL_MS) return chatRolesCache.byId;
  const snapshot = await db.collection('roles').get();
  const byId = Object.fromEntries(snapshot.docs.map((entry) => [entry.id, entry.data() || {}]));
  chatRolesCache = { at: Date.now(), byId };
  return byId;
};

// Cached conversation metadata for push notifications: avoids reading chat_conversations/{id} on every single message.
const CONVERSATION_TTL_MS = 5 * 60 * 1000;
const chatConversationCache = new Map();

const chatConversation = async (conversationId) => {
  const cached = chatConversationCache.get(conversationId);
  if (cached && Date.now() - cached.at < CONVERSATION_TTL_MS) return cached.data;
  const conversationRow = await db.doc(`chat_conversations/${conversationId}`).get();
  const data = conversationRow.exists ? { id: conversationId, ...conversationRow.data() } : { id: conversationId };
  chatConversationCache.set(conversationId, { at: Date.now(), data });
  return data;
};

const chatMayUseChat = (rolesById, row) => {
  const role = rolesById[String((row || {}).role_id || '')] || {};
  return isGranted(role.is_admin) || isGranted(role.can_use_chat);
};

exports.onChatMessageCreated = onDocumentCreated(
  'chat_conversations/{conversationId}/messages/{messageId}',
  async (event) => {
    try {
      const message = { ...((event.data && event.data.data()) || {}), id: event.params.messageId };
      const conversation = { id: event.params.conversationId };

      const explicitMembers = Array.isArray(message.member_ids) && message.member_ids.length > 0;
      const isDirectOnly = explicitMembers && (!Array.isArray(message.audience_keys) || !message.audience_keys.length);

      let directory;
      const roles = await chatRoles();
      if (isDirectOnly && Date.now() - chatDirectoryCache.at >= DIRECTORY_TTL_MS) {
        // Narrowed to the conversation's explicit members: avoid scanning the entire directory for a 1-on-1 direct message
        const explicitUids = message.member_ids.map(text).filter(Boolean);
        const docs = await Promise.all(explicitUids.map((uid) => db.doc(`users/${uid}`).get()));
        directory = docs.filter((snap) => snap.exists).map((snap) => ({
          id: snap.id,
          role_id: (snap.data() || {}).role_id,
          rank_id: (snap.data() || {}).rank_id,
        }));
      } else {
        directory = await chatDirectory();
      }

      const byId = Object.fromEntries(directory.map((row) => [row.id, row]));
      const recipients = chatRecipientsFor({
        audienceKeys: message.audience_keys,
        memberIds: message.member_ids,
        users: directory,
      }).filter((uid) => chatMayUseChat(roles, byId[uid]));

      // THE SENDER GETS A ROW TOO, and it is not a mistake: "unread" means "not read yet", and nobody has read their own
      // sentence back into the conversation. It is their own row, cleared by their own read mark, so opening the room
      // settles it like any other - one rule instead of a special case.
      const fields = chatInboxFields({ conversation, message });
      for (let i = 0; i < recipients.length; i += 450) {
        const chunk = recipients.slice(i, i + 450);
        const batch = db.batch();
        for (const uid of chunk) {
          batch.set(
            db.doc(`chat_inbox/${uid}/rooms/${conversation.id}`),
            { ...fields, count: FieldValue.increment(1) },
            { merge: true }
          );
        }
        await batch.commit();
      }

      // THE PUSH, which is where chat stops being purely in-app. Its audience is the inbox's list MINUS THE AUTHOR (who should
      // not have their phone buzz because they pressed Send - see chatPushRecipients), and its SWITCH is the member's own
      // preference, with the station's default behind it: deliverPush does that reading for every notification the app sends,
      // so chat does not re-implement it.
      //
      // WHICH SWITCH is the conversation's, not the message's: a private conversation and a station room are two different
      // interruptions, and a member can keep one and mute the other.
      //
      // The conversation is read for two facts the message does not carry - its kind and its name - because "a private
      // conversation has no name of its own, so the notification leads with the author" is a rule about conversations
      // (functions/chat.js#chatPushSummary).
      const row = await chatConversation(conversation.id);
      const summary = chatPushSummary({ conversation: row, message, preview: chatPreviewOf(message.body) });
      await deliverPush({
        action: 'CHAT_PUSHED',
        actor: text(message.author_id),
        recipients: chatPushRecipients({ recipients, authorId: message.author_id }),
        preference: chatPushPreferenceFor(row),
        title: summary.title,
        body: summary.body,
        data: { event: 'CHAT', conversation_id: conversation.id, message_id: message.id },
      });
    } catch (error) {
      // A fan-out that fails must not roll back the message: the conversation is the record, the badge is a courtesy.
      console.error(`[chat] the inbox fan-out failed: ${(error && error.message) || error}`);
    }
  }
);

// DELETING A ROOM takes its messages and every member's inbox row with it.
//
// A room is deleted by an administrator, and a Firestore document delete does not touch its subcollections - so without
// this the messages would outlive the room, invisible in the UI and billable forever, and every member would carry a
// badge counting messages in a room that no longer exists. The inbox rows are found by the field the fan-out wrote, from
// every member's own document, which is what `collectionGroup` is for.
exports.onChatConversationDeleted = onDocumentDeleted('chat_conversations/{conversationId}', async (event) => {
  const conversationId = event.params.conversationId;
  try {
    await db.recursiveDelete(db.collection(`chat_conversations/${conversationId}/messages`));
  } catch (error) {
    console.error(`[chat] removing the messages of room ${conversationId} failed: ${(error && error.message) || error}`);
  }
  try {
    const rows = await db.collectionGroup('rooms').where('conversation_id', '==', conversationId).get();
    for (let start = 0; start < rows.docs.length; start += 400) {
      const batch = db.batch();
      rows.docs.slice(start, start + 400).forEach((row) => batch.delete(row.ref));
      await batch.commit();
    }
  } catch (error) {
    console.error(`[chat] clearing the inboxes of room ${conversationId} failed: ${(error && error.message) || error}`);
  }
});

// -------------------------------------------------------------------------------------------------------------
// The FCM half: what the notifications tab needs from the SERVER.
// -------------------------------------------------------------------------------------------------------------
//
// Both of these existed on the sheet for one reason: sending a push needs credentials, and the Apps Script project
// had to be GIVEN them (the service-account key was a script property, write-only, and adminFetchFcmStatus reported
// which of them were present). A Cloud Function does not need giving: the runtime service account the function already
// runs as is the same credential FCM accepts, so "is it configured?" has one honest answer, and the tab is told where
// that credential comes from rather than being shown fields to fill in.
exports.fcmStatus = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(request.auth.uid, 'can_edit_notification_settings', 'read the notification setup');

  // The device count rides along because "ready" and "ready, and nobody has registered a device" are very different
  // answers to an administrator wondering why nothing arrives.
  const devices = await db.collection('push_devices').count().get();

  return {
    ready: true,
    transport: 'firebase-admin',
    credential: 'the Cloud Functions runtime service account - nothing is stored for this',
    devices: devices.data().count,
  };
});

// One push to one member, so an administrator can prove the setup end to end rather than infer it from a status page.
//
// Deliberately sent to EVERY device the member has: the question is whether their phone buzzes, and which device
// answered it is not the point. Also the one place dead tokens are cleaned up - FCM tells us when a token is no longer
// registered, and a row that will never deliver is worse than no row at all, because it makes a member look reachable.
exports.sendTestPush = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(request.auth.uid, 'can_edit_notification_settings', 'send a test notification');

  const userId = String((request.data || {}).user_id || '').trim();
  if (!userId) throw new HttpsError('invalid-argument', 'Which member?');

  const rows = await db.collection('push_devices').where('user_id', '==', userId).get();
  const devices = rows.docs
    .map((row) => ({ ref: row.ref, token: String((row.data() || {}).token || '').trim() }))
    .filter((device) => device.token);

  if (!devices.length) {
    return { success: false, message: 'That member has no registered device, so there is nothing to send to.' };
  }

  const answer = await getMessaging().sendEachForMulticast({
    tokens: devices.map((device) => device.token),
    notification: {
      title: 'Test notification',
      body: 'If you can read this, notifications are working on this device.',
    },
  });

  const dead = answer.responses
    .map((result, index) => ({ result, device: devices[index] }))
    .filter((entry) => !entry.result.success && /not-registered|invalid-argument|invalid-registration/.test(String((entry.result.error && entry.result.error.code) || '')));

  await Promise.all(dead.map((entry) => entry.device.ref.delete()));

  if (!answer.successCount) {
    const first = answer.responses.find((result) => !result.success);
    return {
      success: false,
      message: 'The notification could not be delivered.',
      // FCM's own words. A test send is exactly where somebody needs them rather than a reassurance.
      detail: String((first && first.error && first.error.message) || '').slice(0, 200),
    };
  }

  return {
    success: true,
    message:
      `Sent to ${answer.successCount} of ${devices.length} device${devices.length === 1 ? '' : 's'}.` +
      (dead.length ? ` ${dead.length} stale registration${dead.length === 1 ? '' : 's'} removed.` : ''),
  };
});

// Identity Platform's own guard on account creation. The app creates members with the Admin SDK from an officer's
// callable, and the console creates them by hand; anything else - a browser trying to sign up to our domain - is
// refused before it exists.
// Which member's alerts arrive on the browser holding this token - the one question a member cannot answer for
// themselves, and the reason this callable exists at all.
//
// A member may read their OWN push_devices rows and nobody else's, which is right, but it means a query "is this
// browser's token registered to somebody else?" cannot be asked from the browser: Firestore would have to prove
// ownership it has no way to prove, and it refuses. The sheet answered it server-side for the same reason.
//
// It is restricted to the two things the card draws - whose, and on which device - because a token is
// credential-shaped and the row it points at is nobody else's business. The token travels from the browser that
// already holds it, which is why asking is safe in the first place: a browser that does not hold it cannot ask.
//
// `null` is a real answer, not a failure: it means this browser's alerts are set up to go to nobody.
exports.pushDeviceOwner = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');

  const token = String((request.data || {}).token || '').trim();
  if (!token) return { device_owner: null };

  const found = await db.collection('push_devices').where('token', '==', token).limit(1).get();
  if (found.empty) return { device_owner: null };

  const row = found.docs[0].data() || {};
  const ownerId = String(row.user_id || '').trim();
  const owner = ownerId ? await db.doc(`users/${ownerId}`).get() : null;
  const ownerData = (owner && owner.exists && owner.data()) || {};

  return {
    device_owner: {
      user_id: ownerId,
      // The same phrase the sheet used when the member has vanished or has no name: this is shown to somebody who is
      // working out which account they are looking at, so it says something rather than being empty.
      name: String(ownerData.name || ownerData.user_name || '').trim() || 'another member',
      device_label: String(row.device_label || '').trim(),
    },
  };
});

exports.beforeUserCreated = beforeUserCreated((event) => {
  const fromBrowser = Boolean(event.ipAddress) || Boolean(event.userAgent);
  if (fromBrowser) {
    throw new HttpsError(
      'permission-denied',
      'Accounts are created by an officer in the app, not by signing up here.'
    );
  }

  // Belt and braces: even a server-side creation has to be a station address, so a stray Admin SDK call or a
  // console-side invite cannot introduce an account on a domain that would never be one of ours.
  const email = String((event.data && event.data.email) || '');
  if (!email.toLowerCase().endsWith(`@${EMAIL_DOMAIN}`)) {
    throw new HttpsError('permission-denied', `An account must be on the @${EMAIL_DOMAIN} domain.`);
  }
});
