// COMMONJS, unlike the rest of the repo, because the Functions emulator analyses this codebase with require() - an
// ESM entry point fails with "Unexpected token 'export'" before a single function loads. The deployed runtime would
// accept ESM; the emulator is what we develop and test against, so CJS it is.
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { HttpsError, onCall } = require('firebase-functions/v2/https');
// The audit trail's filter, sorts and row mapping: pure, no dependencies, and tested without an emulator.
const {
  buildAuditFilter,
  orderByFor,
  pageSizeFor,
  logReplyFrom,
  FACET_SAMPLE_SIZE,
} = require('./auditLog');
// The audit lines go to Cloud Logging now rather than to a Firestore collection: structured, free to write, and
// searchable in the Firebase console. See the note on `audit` below.
const { logger } = require('firebase-functions/logger');
const { onDocumentCreated, onDocumentDeleted, onDocumentUpdated } = require('firebase-functions/v2/firestore');
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
// back, every single time, until an officer unticked the box by hand. `completePasswordChange` did exactly half the job
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


exports.readRosterModule = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(request.auth.uid, 'can_view_roster', 'view the roster');

  const [usersSnapshot, privateSnapshot, setupSnapshot] = await Promise.all([
    db.collection('users').get(),
    db.collection('users_private').get(),
    db.collection('certification_setup').get(),
  ]);
  const privateById = new Map(privateSnapshot.docs.map((row) => [row.id, row.data()]));
  const members = usersSnapshot.docs
    .filter((row) => String(privateById.get(row.id)?.status || '').trim().toLowerCase() === 'active')
    .map((row) => ({
      id: row.id,
      name: String(row.get('name') || ''),
      rank_id: String(row.get('rank_id') || ''),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const memberIds = new Set(members.map((member) => member.id));
  const certificationTypes = setupSnapshot.docs
    .filter((row) => row.get('show_on_roster') === true)
    .map((row) => ({
      id: row.id,
      name: String(row.get('name') || ''),
      icon: String(row.get('icon') || ''),
      sort_order: Number(row.get('sort_order') || 999),
    }))
    .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name));
  const visibleTypeIds = new Set(certificationTypes.map((type) => type.id));
  const memberCertificationIds = Object.fromEntries(members.map((member) => [member.id, []]));
  const today = stationTimestamp().slice(0, 10);

  // ONLY THE ACTIVE MEMBERS' RECORDS, in batches of thirty - never the whole collection.
  //
  // `certifications` is append-only: one row per member per certificate period, accumulated for the station's whole life.
  // Reading it whole made every open of the Roster module pay for every record ever recorded, including the ones belonging
  // to members who have left. The active ids are already in hand, so the query names them - the same batched `in` read
  // readAdminCertificationRecords makes, and the same thirty-per-request ceiling Firestore puts on `in`.
  const certificationRows = [];
  const memberIdList = [...memberIds];
  for (let start = 0; start < memberIdList.length; start += 30) {
    const batch = memberIdList.slice(start, start + 30);
    const snapshot = await db.collection('certifications').where('user_id', 'in', batch).get();
    certificationRows.push(...snapshot.docs);
  }

  certificationRows.forEach((row) => {
    const record = row.data();
    const memberId = String(record.user_id || '');
    const typeId = String(record.certification_id || '');
    const effectiveDate = String(record.effective_date || '').trim();
    const endDate = String(record.end_date || '').trim();
    if (
      memberIds.has(memberId) &&
      visibleTypeIds.has(typeId) &&
      (!effectiveDate || effectiveDate <= today) &&
      (!endDate || endDate >= today)
    ) {
      memberCertificationIds[memberId].push(typeId);
    }
  });

  Object.values(memberCertificationIds).forEach((typeIds) => {
    typeIds.splice(0, typeIds.length, ...new Set(typeIds));
  });

  return { members, certificationTypes, memberCertificationIds };
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
      // than leaving an officer to remember which boxes they ticked.
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
  const stamp = stationTimestamp();
  await db.runTransaction(async (transaction) => {
    const duty = await transaction.get(dutyRef);
    if (duty.exists) throw new HttpsError('failed-precondition', 'already-clocked-in');
    transaction.create(entryRef, {
      user_id: caller.uid,
      time_in: stamp,
      time_out: '',
      is_manual: false,
      gps_lat: latitude,
      gps_lon: longitude,
    });
    transaction.create(dutyRef, { user_id: caller.uid, time_in: stamp });
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
    // THROUGH THE ONE WRITER, so the officer's checkbox clears the claim as well as their own column. Unticking it is
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

  const station = await db.doc('settings/public').get();
  const stationDefault = (station.data() || {})[preference];

  const settings = await Promise.all(unique.map((id) => db.doc(`user_settings/${id}`).get()));
  const allowed = [];
  settings.forEach((snapshot, index) => {
    const row = snapshot.data() || {};
    // An administrator's switch outranks the member's own, and it is checked here as well as at the door: a device
    // registered before the switch was set would otherwise keep receiving.
    if (row.is_push_disabled === true) return;
    if (!notificationEnabled(row[preference], stationDefault)) return;
    allowed.push(unique[index]);
  });
  if (!allowed.length) return { recipients: unique.length, delivered: 0 };

  // `in` takes up to thirty values, so the recipient list is chunked rather than assumed small.
  const devices = [];
  for (let index = 0; index < allowed.length; index += 30) {
    const rows = await db.collection('push_devices').where('user_id', 'in', allowed.slice(index, index + 30)).get();
    rows.forEach((row) => {
      const token = text((row.data() || {}).token);
      if (token) devices.push({ token, ref: row.ref });
    });
  }
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

// An announcement: whoever the audience names, by the same keys the rules check with hasAny - so an audience cannot mean
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

// -------------------------------------------------------------------------------------------------------------
// The audit trail, read from CLOUD LOGGING on demand.
// -------------------------------------------------------------------------------------------------------------
//
// WHY THIS IS AN API CALL AND NOT A COLLECTION. The audit trail used to be a `system_log` collection: one document per
// action, plus a whole-collection scan every time the tab was opened, on the one collection in the app that grows
// without limit. Both are gone - `audit` above writes a Cloud Logging line for nothing - and this reads those lines
// back when an officer asks for them, and nowhere else. THE READ IS ON DEMAND, which is the property the collection
// could never offer: a Firestore query bills per document, and a Logging read bills nothing.
//
// The filter, the sorts and the row mapping live in ./auditLog.js, which is pure and tested by
// scripts/verify-audit-log.mjs - a filter string built by concatenation is the part that most needs a test.
//
// THE CLIENT LIBRARY IS REQUIRED LAZILY, and that is not a micro-optimisation: the Functions emulator loads this file to
// run every OTHER function and implements no Logging API at all, so a top-level require would make every harness depend
// on a package none of them use.
exports.readSystemLog = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(request.auth.uid, 'can_view_system_log', 'read the audit log');

  const data = request.data || {};
  const { filter, problem } = buildAuditFilter({
    action: data.action_filter,
    member: data.member,
    from: data.from,
    to: data.to,
  });
  if (problem) throw new HttpsError('invalid-argument', problem);

  let Logging;
  try {
    ({ Logging } = require('@google-cloud/logging'));
  } catch {
    throw new HttpsError(
      'failed-precondition',
      'Reading the audit log needs the Cloud Logging client, which is not installed in this deployment.'
    );
  }

  const pageSize = pageSizeFor(data.page_size);
  const orderBy = orderByFor(data.sort);
  const pageToken = String(data.page_token || '') || undefined;
  const logging = new Logging();

  let page;
  let sample;
  try {
    // TWO read-only calls, in parallel: the page the officer asked for, and a recent sample the filter dropdowns are
    // built from. The sample is what makes the dropdowns possible without scanning the log, and it is deliberately the
    // recent end - see the note on FACET_SAMPLE_SIZE.
    [page, sample] = await Promise.all([
      logging.getEntries({ filter, orderBy, pageSize, pageToken }),
      logging.getEntries({ filter, orderBy, pageSize: FACET_SAMPLE_SIZE }),
    ]);
  } catch (error) {
    // Log reading is IAM-controlled on the FUNCTION'S service account, and a missing grant surfaces here. Saying so beats
    // a generic failure: the fix is one role, and it is not something an officer can work out from "internal".
    throw new HttpsError(
      'permission-denied',
      `The audit log could not be read (${(error && error.code) || (error && error.message) || 'unknown'}). ` +
        'The function’s service account needs permission to read Cloud Logging - see the note in the README.'
    );
  }

  const [entries, nextQuery] = page;
  // The reply is assembled in ./auditLog.js rather than inline here, because its SHAPE is a contract with the tab and the
  // two halves are deployed separately - so the shape belongs in the pure module the harness already holds. See
  // logReplyFrom, and the note there on what a missing `api` costs.
  return logReplyFrom({ entries, nextQuery, sampleEntries: sample[0], data, pageSize, stationTimestamp });
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
