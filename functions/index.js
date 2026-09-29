// COMMONJS, unlike the rest of the repo, because the Functions emulator analyses this codebase with require() - an
// ESM entry point fails with "Unexpected token 'export'" before a single function loads. The deployed runtime would
// accept ESM; the emulator is what we develop and test against, so CJS it is.
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { HttpsError, onCall } = require('firebase-functions/v2/https');

// WHAT BELONGS IN A FUNCTION, and why these four do:
//
// Everything a client may do directly lives in firestore.rules. What is here is the work that needs the Admin SDK:
// creating an Auth account, setting a password, suspending one, and writing the audit row that names the officer
// who did it. A browser cannot do any of those things, and `users_private` is write-denied in the rules so that it
// cannot try.
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

const callerMay = async (uid, flag) => {
  const role = await callerRole(uid);
  return !!role && (role.is_admin === true || role[flag] === true);
};

const requirePermission = async (uid, flag, what) => {
  if (!(await callerMay(uid, flag))) {
    throw new HttpsError('permission-denied', `You do not have permission to ${what}.`);
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

// The audit trail: every one of these functions leaves a row naming who did it and to whom. An officer-driven
// password reset is only accountable if the officer's name is written down with it.
//
// TWO timestamps, deliberately. `created_at` is the exact instant, which is what an investigation wants; `timestamp`
// is the station-time text the System Log tab reads and sorts by, which is the format the whole app uses. Writing only
// the ISO instant left the tab's own contract unsatisfied by the app writing it - and an ISO instant rendered as
// station time is four or five hours wrong in a way that looks like a real time rather than like a bug.
const audit = (userId, action, details) =>
  db.collection('system_log').add({
    user_id: userId,
    action,
    details,
    created_at: new Date().toISOString(),
    timestamp: stationTimestamp(),
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
  await setRoleClaims(userId, (await db.doc(`users/${userId}`).get()).get('role_id'), {
    must_change_password: true,
  });
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
exports.completePasswordChange = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in first.');
  const roleId = (await db.doc(`users/${caller.uid}`).get()).get('role_id');
  await setRoleClaims(caller.uid, roleId, { must_change_password: false });
  await audit(caller.uid, 'COMPLETE_PASSWORD_CHANGE', 'Changed their own password');
  return { ok: true };
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
    const conflicts = [];
    for (const entry of prepared) {
      if (!entry.fields.user_id) continue;
      const sameSlot = await transaction.get(
        db
          .collection('schedule')
          .where('date_from', '==', entry.fields.date_from)
          .where('assignment_id', '==', entry.fields.assignment_id)
      );
      const taken = sameSlot.docs.find(
        (row) => row.id !== entry.id && String(row.data().user_id || '') !== '' && String(row.data().user_id) !== entry.fields.user_id
      );
      if (taken) conflicts.push(`${entry.fields.date_from} ${entry.fields.assignment_id}`);
    }
    if (conflicts.length) {
      throw new HttpsError('failed-precondition', `Already filled by somebody else: ${conflicts.join(', ')}.`);
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

// Suspending somebody has to disable the Auth account too, or the suspension is only as good as the app's own
// checks - and whatever reads the database next would not check.
exports.setMemberStatus = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(caller.uid, 'can_edit_users', 'change an account status');

  const data = request.data || {};
  const userId = String(data.userId || '');
  const status = String(data.status || '');
  if (!['active', 'suspended'].includes(status)) {
    throw new HttpsError('invalid-argument', 'A status is either active or suspended.');
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
    changes.is_change_password_on_login = data.isChangePasswordOnLogin === true;
    described.push(`change-password-on-next-login ${data.isChangePasswordOnLogin === true ? 'on' : 'off'}`);
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
//     free at this scale. See docs/FIREBASE_SETUP.md.
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
// The system log: one page at a time, and the last read in the app.
// -------------------------------------------------------------------------------------------------------------
//
// WHY A CALLABLE rather than a client query, since this is the one place that is a genuine choice:
//
//   1. The response is not a page. It carries `total`/`total_pages` for the footer and `actions`/`members` for the
//      filter dropdowns, and the facets come from the WHOLE log - a dropdown offering only the values on the current
//      page could never select the value somebody is looking for. No single page can supply that.
//   2. The log names members and records failed sign-ins, so the permission is checked here, on the server, where the
//      rules cannot be talked around.
//
// And WHY IT SCANS rather than paging with a Firestore query, which it could:
//
//   The tab asks for any combination of four sorts and four filters. Native paging would need a composite index for
//   every filtered sort - around eight of them - and it would still behave differently from the sheet in two ways a
//   reader would notice: Firestore matches strings case-sensitively, where the sheet's action filter is
//   case-insensitive, and it treats a missing value as lowest rather than last in both directions.
//
//   The facets already require reading the whole log, so the page and the counts ride along on that same read for
//   nothing. At a station's scale that is a few hundred documents per request. If this log ever grows past that, the
//   facets are the piece to denormalize at write time - they can be, because ONLY this file writes the log - and then
//   the page can move to a query with the indexes it needs.
const LOG_SORTS = ['timestamp_desc', 'timestamp_asc', 'action_asc', 'member_asc'];
const LOG_SORT_DEFAULT = 'timestamp_desc';
const LOG_PAGE_SIZE_DEFAULT = 20;
const LOG_PAGE_SIZE_MAX = 100;
// The contract version, matching SYSTEM_LOG_API_VERSION in src/utils/systemLog.js and Code.gs. The tab compares the two
// and says so when they differ, because the failure is otherwise invisible: a backend reading the action filter under
// an older name answers an empty page, which looks exactly like an empty log.
const SYSTEM_LOG_API_VERSION = 2;

const logCellText = (value) => String(value === undefined || value === null ? '' : value).trim();

// The timestamp as the app stores it: 'YYYY-MM-DD HH:mm:ss' in station time.
//
// An ISO instant is CONVERTED rather than trimmed, and that is the whole reason this cannot be left to the client: the
// tab parses this text and displays it, so an ISO string would render its UTC hour as if it were station time - four or
// five hours wrong, and looking like a real time rather than a bug.
const logTimestampText = (value) => {
  const raw = logCellText(value);
  if (raw === '') return '';
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw)) return raw.slice(0, 19);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
    const parsed = new Date(raw);
    return isNaN(parsed.getTime()) ? raw.replace('T', ' ').slice(0, 19) : stationTimestamp(parsed);
  }
  return raw;
};

// One row in the shape the tab reads - the same fields the sheet's reader returned, derived the same way. Rows written
// before the audit writer wrote both timestamps carry only `created_at`, which is why the conversion above exists.
const normalizeLogEntry = (id, row) => {
  const source = row || {};
  const timestamp = logTimestampText(source.timestamp || source.created_at);
  return {
    id: String(id || ''),
    timestamp,
    date_key: /^\d{4}-\d{2}-\d{2}/.test(timestamp) ? timestamp.slice(0, 10) : '',
    user_id: logCellText(source.user_id),
    action: logCellText(source.action),
    details: logCellText(source.details),
  };
};

// Missing values sort last in EITHER direction, so an unreadable timestamp is never presented as the newest entry.
const compareLogText = (aValue, bValue, direction) => {
  const a = String(aValue || '');
  const b = String(bValue || '');
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return (a < b ? -1 : 1) * direction;
};

// The id breaks a tie last, so the order is total: paging over an order two rows can share is how a boundary repeats
// one row and drops another.
const compareLogTimestamp = (a, b, direction) => {
  const aKey = a.timestamp || '';
  const bKey = b.timestamp || '';
  if (!aKey && !bKey) return compareLogText(a.id, b.id, direction);
  if (!aKey) return 1;
  if (!bKey) return -1;
  if (aKey !== bKey) return (aKey < bKey ? -1 : 1) * direction;
  return compareLogText(a.id, b.id, direction);
};

const sortLogEntries = (entries, sort) => {
  const mode = LOG_SORTS.includes(String(sort || '')) ? String(sort) : LOG_SORT_DEFAULT;
  return entries.slice().sort((a, b) => {
    if (mode === 'timestamp_asc') return compareLogTimestamp(a, b, 1);
    if (mode === 'action_asc') return compareLogText(a.action, b.action, 1) || compareLogTimestamp(a, b, -1);
    if (mode === 'member_asc') return compareLogText(a.user_id, b.user_id, 1) || compareLogTimestamp(a, b, -1);
    return compareLogTimestamp(a, b, -1);
  });
};

// A row against the filter set. A blank filter is ignored rather than matching nothing - the one mistake that would make
// an empty table look exactly like an empty log.
const logEntryMatches = (entry, filters) => {
  if (!entry) return false;

  if (filters.from || filters.to) {
    // A row with no readable date cannot be inside a date range, whichever end is open.
    if (!entry.date_key) return false;
    if (filters.from && entry.date_key < filters.from) return false;
    if (filters.to && entry.date_key > filters.to) return false;
  }

  // Whole value and case-insensitive, as the sheet matched it: 'user_login' and 'USER_LOGIN' are one group rather than
  // two. The dropdown offers the stored values, so in practice this is an exact match.
  if (filters.action && entry.action.toUpperCase() !== filters.action.toUpperCase()) return false;
  if (filters.member && entry.user_id !== filters.member) return false;

  return true;
};

// One page of rows plus the numbers the footer and the pager need. The page is CLAMPED, so asking for page 99 of a
// 3-page result returns the last page rather than an empty table - which is what would otherwise happen after narrowing
// a filter.
const paginateLogEntries = (entries, page, pageSize) => {
  const size = Math.min(LOG_PAGE_SIZE_MAX, Math.max(1, parseInt(pageSize, 10) || LOG_PAGE_SIZE_DEFAULT));
  const total = entries.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, parseInt(page, 10) || 1), totalPages);

  return {
    rows: entries.slice((current - 1) * size, (current - 1) * size + size),
    page: current,
    page_size: size,
    total,
    total_pages: totalPages,
  };
};

// Every distinct action and member id in the log, for the filter dropdowns. From the WHOLE log rather than the page, and
// as ids - the client already has the roster to put names to them, and the log holds ids that are not members too, since
// a failed sign-in is recorded against the username that was typed.
const logFacets = (entries) => {
  const actions = new Set();
  const members = new Set();
  entries.forEach((entry) => {
    if (entry.action) actions.add(entry.action);
    if (entry.user_id) members.add(entry.user_id);
  });
  return { actions: [...actions].sort(), members: [...members].sort() };
};

exports.readSystemLog = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requirePermission(request.auth.uid, 'can_view_system_log', 'read the system log');

  const data = request.data || {};
  const filters = {
    from: logCellText(data.from),
    to: logCellText(data.to),
    // `action_filter`, not `action`: `action` is the RPC envelope's own key, so the log's action FILTER has to travel
    // under a different name. Reading data.action here would filter every page on 'ADMIN_GET_SYSTEM_LOG' and answer
    // nothing - which is what broke this tab once already, on the client side of the same collision.
    action: logCellText(data.action_filter),
    member: logCellText(data.member),
  };
  const sort = LOG_SORTS.includes(logCellText(data.sort)) ? logCellText(data.sort) : LOG_SORT_DEFAULT;

  const snapshot = await db.collection('system_log').get();
  const all = snapshot.docs.map((entry) => normalizeLogEntry(entry.id, entry.data()));
  const matched = all.filter((entry) => logEntryMatches(entry, filters));
  const paged = paginateLogEntries(sortLogEntries(matched, sort), data.page, data.page_size);
  const facets = logFacets(all);

  return {
    api: SYSTEM_LOG_API_VERSION,
    ...paged,
    // Echoed back, so the client can trust what was APPLIED rather than what it asked for.
    sort,
    actions: facets.actions,
    members: facets.members,
    log_total: all.length,
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
