// COMMONJS, unlike the rest of the repo, because the Functions emulator analyses this codebase with require() - an
// ESM entry point fails with "Unexpected token 'export'" before a single function loads. The deployed runtime would
// accept ESM; the emulator is what we develop and test against, so CJS it is.
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { HttpsError, onCall } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');

// What an event MEANS: recipients, preferences and copy. Pure and separate so it can be asserted without FCM.
const {
  text,
  notificationEnabled,
  offerEventFromStatus,
  offerRecipients,
  offerCopy,
  announcementRecipients,
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

// The two reads every offer push needs: the roles (who can approve) and the users (who holds them).
const offerAudience = async () => {
  const [roles, users] = await Promise.all([db.collection('roles').get(), db.collection('users').get()]);
  const rows = (snapshot) => snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  return { roles: rows(roles), users: rows(users) };
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

// An announcement: whoever the audience names, by the same keys the rules check with hasAny - so an audience cannot mean
// one thing to the rules and another thing to the push.
exports.onAnnouncementCreated = onDocumentCreated('announcements/{announcementId}', async (event) => {
  try {
    const announcement = (event.data && event.data.data()) || {};
    const users = await db.collection('users').get();
    const accounts = users.docs.map((entry) => ({
      userId: entry.id,
      roleId: (entry.data() || {}).role_id,
      rankId: (entry.data() || {}).rank_id,
    }));

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
