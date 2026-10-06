// WHO HEARS ABOUT WHAT, and whether they asked to.
//
// Pure, and in its own file rather than inline in the functions that use it, for one reason: FCM cannot be exercised in
// the emulator, so the parts that decide whether a notification is CORRECT - who the recipients are, whether each of them
// has the switch on, and what the message says - have to be assertable without sending anything.
// scripts/verify-push-audience.mjs asserts exactly that.
//
// The rules encoded here are the SHEET'S, kept deliberately. They were arrived at by using them, and a member who has
// turned "my shift request approved" off should not start receiving it again because the backend changed.

const text = (value) => String(value === undefined || value === null ? '' : value).trim();

const isTruthy = (value) => {
  if (value === true) return true;
  if (value === false) return false;
  const raw = text(value).toUpperCase();
  return raw === 'TRUE' || raw === 'YES' || raw === '1';
};

// The keys a viewer's audience is matched by. Mirrors audienceKeysFor in src/services/firestorePayload.js - the same
// list, character for character, because an announcement is WRITTEN with one side and READ with the other.
const viewerKeys = (account = {}) => [
  '*',
  `user:${text(account.userId)}`,
  `role:${text(account.roleId)}`,
  `rank:${text(account.rankId)}`,
];

// Member override, else the station default, else ON.
//
// The last of those is the sheet's rule and it is deliberate: a station that has expressed no opinion has notifications
// ON, so a new member hears about shifts without anybody configuring anything. Blank means "whatever the station says",
// which is NOT the same as off - and reading a blank as off is how a member ends up silently unsubscribed.
const notificationEnabled = (override, stationDefault) => {
  if (text(override) !== '') return isTruthy(override);
  if (text(stationDefault) !== '') return isTruthy(stationDefault);
  return true;
};

// Everyone whose role can approve shifts. `is_admin` implies the permission, so administrators are included without the
// column being set: the sheet pushed to `is_admin` alone for a while while the app gated approvals on
// `can_approve_shifts`, which meant the people being told were not the people who could act on it.
const approverIds = (roles = [], users = []) => {
  const approverRoles = new Set(
    roles.filter((role) => isTruthy(role.is_admin) || isTruthy(role.can_approve_shifts)).map((role) => text(role.id))
  );
  return users
    .filter((user) => approverRoles.has(text(user.role_id)))
    .map((user) => text(user.id))
    .filter(Boolean);
};

// An offer's status turned into an event, and only when it MOVES. An offer saved twice while still pending - or any
// other field edited after it was decided - must not tell anybody anything.
const offerEventFromStatus = (status) => {
  const raw = text(status).toLowerCase();
  if (raw === 'approved') return 'APPROVED';
  if (raw === 'declined') return 'DECLINED';
  return '';
};

// A new offer goes to the APPROVERS, who have something to do; a decided one goes back to the member who made it.
const offerRecipients = ({ event, offer, roles, users }) =>
  text(event).toUpperCase() === 'SUBMITTED'
    ? approverIds(roles, users)
    : [text(offer && offer.user_id)].filter(Boolean);

// The copy a member reads: word for word what the sheet sent, `span` included, because "the shift you offered to take was
// approved" without the dates is a message nobody can act on.
const offerCopy = (event, { dateFrom, dateTo } = {}) => {
  const from = text(dateFrom);
  const to = text(dateTo) || from;
  const when = to && to !== from ? `${from} to ${to}` : from;
  const span = when ? ` (${when})` : '';
  const name = text(event).toUpperCase();

  if (name === 'SUBMITTED') {
    return { preference: 'notify_new_offer', title: 'New shift request', body: `A member offered to take an open shift${span}.` };
  }
  if (name === 'APPROVED') {
    return { preference: 'notify_offer_approved', title: 'Shift request approved', body: `The shift you offered to take${span} was approved.` };
  }
  if (name === 'DECLINED') {
    return { preference: 'notify_offer_declined', title: 'Shift request declined', body: `The shift you offered to take${span} was declined.` };
  }
  return null;
};

// Everyone an announcement is aimed at, by KEYS rather than by a query - which is what makes this a function and not a
// read: the recipients have to become USER IDS to find their devices, and these are the same keys the rules check with
// hasAny, so an audience cannot mean one thing to the rules and another to the push.
const announcementRecipients = ({ audienceKeys, accounts }) =>
  accounts
    .filter((account) => {
      const keys = viewerKeys(account);
      return (audienceKeys || []).some((key) => keys.includes(text(key)));
    })
    .map((account) => text(account.userId))
    .filter(Boolean);

// An audience's keys split into the things a QUERY can be narrowed by, plus the wildcard.
//
// The caller uses this to fetch only the members an audience can reach, instead of reading the whole directory: a push is
// rare enough that the scan was never the headline cost, but "resolve by query, not by scan" is the same rule the reads
// follow, and it is what keeps a push flat as a station grows. `everyone` is the one case that still reads the collection,
// because `*` genuinely means everybody.
const audienceTargetsFrom = (audienceKeys = []) => {
  const targets = { everyone: false, roleIds: [], rankIds: [], userIds: [] };
  (Array.isArray(audienceKeys) ? audienceKeys : []).forEach((rawKey) => {
    const key = text(rawKey);
    if (key === '*') {
      targets.everyone = true;
      return;
    }
    const [kind, id] = key.split(':');
    if (!id) return;
    if (kind === 'role') targets.roleIds.push(id);
    else if (kind === 'rank') targets.rankIds.push(id);
    else if (kind === 'user') targets.userIds.push(id);
  });
  targets.roleIds = [...new Set(targets.roleIds)];
  targets.rankIds = [...new Set(targets.rankIds)];
  targets.userIds = [...new Set(targets.userIds)];
  return targets;
};

module.exports = {
  text,
  isTruthy,
  viewerKeys,
  notificationEnabled,
  approverIds,
  offerEventFromStatus,
  offerRecipients,
  offerCopy,
  announcementRecipients,
  audienceTargetsFrom,
};
