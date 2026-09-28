// The member's sign-in payload, read from Firestore.
//
// It returns the SAME shape as memberBootstrapPayload in Code.gs, field for field, because the app consumes that
// today and api.js is the seam between them. That is the whole point: when the data moves, the components do not.
// Where the shape could not stay identical, the difference is named in a comment rather than hidden.
//
// Two things about the reads worth knowing:
//
//   - They run in two parallel waves. The Apps Script equivalent was one sheet read per collection, each with its
//     own round trip before a cell could be read; here the whole payload is one wave against the database.
//   - The per-member tables are narrowed by the rule as well as by the query. A member cannot read another member's
//     availability or clock history even if this module asked for it - which is the guarantee the sheet version
//     enforced on the server, now enforced by the database.
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { firestore } from './firebase.js';

const rowsOf = async (target) => (await getDocs(target)).docs.map((entry) => ({ id: entry.id, ...entry.data() }));

const rowsFor = (name, field, value) => rowsOf(query(collection(firestore(), name), where(field, '==', value)));

// The four keys an audience query carries: everyone, this member, their role, their rank. The rules answer the same
// list with hasAny - see firestore.rules - which is what makes the query provable rather than merely convenient.
export const audienceKeysFor = ({ userId, roleId, rankId }) => [
  '*',
  `user:${userId}`,
  `role:${roleId}`,
  `rank:${rankId}`,
];

const audienceRows = (name, keys) =>
  rowsOf(query(collection(firestore(), name), where('audience_keys', 'array-contains-any', keys)));

// A settings document turned back into the key/value rows the app reads today. The shape stays a list until the
// settings screen itself is migrated: keeping it is what lets this module drop in behind api.js unchanged.
const settingRows = (snapshot) => Object.entries(snapshot.data() || {}).map(([key, value]) => ({ key, value }));

export const fetchMemberPayload = async (account) => {
  const db = firestore();
  const keys = audienceKeysFor(account);

  // Reference data and the crew's shifts: everything a member may read for the whole station.
  const [roles, ranks, shifts, users, assignments, templates, schedule] = await Promise.all([
    rowsOf(collection(db, 'roles')),
    rowsOf(collection(db, 'ranks')),
    rowsOf(collection(db, 'shifts')),
    rowsOf(collection(db, 'users')),
    rowsOf(collection(db, 'assignments')),
    rowsOf(collection(db, 'schedule_templates')),
    rowsOf(collection(db, 'schedule')),
  ]);

  // The member's own rows, plus the two audience-filtered collections.
  const [
    settings,
    mySettings,
    availability,
    logs,
    onDutyRows,
    offers,
    signatures,
    certifications,
    setup,
    trainings,
    announcements,
    events,
  ] = await Promise.all([
    getDoc(doc(db, 'settings', 'public')),
    getDoc(doc(db, 'user_settings', account.userId)),
    rowsFor('availability', 'user_id', account.userId),
    rowsFor('timeclock', 'user_id', account.userId),
    rowsOf(collection(db, 'on_duty')),
    rowsFor('schedule_offers', 'user_id', account.userId),
    rowsFor('training_signatures', 'user_id', account.userId),
    rowsFor('certifications', 'user_id', account.userId),
    rowsOf(collection(db, 'certification_setup')),
    rowsOf(collection(db, 'trainings')),
    audienceRows('announcements', keys),
    audienceRows('events', keys),
  ]);

  const memberById = (userId) => users.find((user) => user.id === String(userId)) || {};

  return {
    success: true,
    roles,
    ranks,
    shifts,
    // The roster is the projection the sheet server computed: a name and a rank, and deliberately NOT the role,
    // which is nobody else's business and which the client does not need to label a shift.
    roster: users.map((user) => ({ id: user.id, name: user.name, rank_id: user.rank_id })),
    // Who is on duty, in the same three columns - which is what the dashboard draws.
    onDuty: onDutyRows.map((row) => {
      const member = memberById(row.user_id);
      return { id: String(row.user_id), name: member.name, rank_id: member.rank_id };
    }),
    schedule,
    assignments,
    scheduleTemplates: templates,
    availability,
    logs,
    offers,
    trainings,
    signatures,
    certifications,
    certificationSetup: setup,
    announcements,
    events,
    systemSettings: settingRows(settings),
    // A LIST of one, because that is the shape the app reads today: the sheet payload carried every member's
    // settings and the client picked its own out of them.
    userSettings: [{ user_id: account.userId, ...(mySettings.data() || {}) }],
  };
};
