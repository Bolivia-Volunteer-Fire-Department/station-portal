// Loads initial data payloads from Firestore for members and administrators.
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { firestore } from './firebase.js';
import { toTimeInputValue } from '../utils/timeInputValue.js';
import { toDateKey, stationTodayKey } from '../utils/scheduleDate.js';
import { certificationAlertsFor, decorateCertifications } from '../utils/certifications.js';
import { availabilityMonthId, claimRowsFromMonths } from '../utils/availability.js';
import { scheduleWindowFor } from '../utils/scheduleWindow.js';

// Converts a Firestore query or collection into an array of plain JavaScript objects with IDs.
export const rowsOf = async (target, options = {}) =>
  (await getDocs(target, options)).docs.map((entry) => ({ ...entry.data(), id: entry.id }));

// Queries rows from a collection matching a specific field value.
export const rowsFor = (name, field, value) => rowsOf(query(collection(firestore(), name), where(field, '==', value)));

// Queries rows whose date field falls within a specified start and end date range.
export const rowsInRange = (name, field, from, to, options = {}) =>
  rowsOf(
    query(
      collection(firestore(), name),
      where(field, '>=', String(from || '0000-01-01')),
      where(field, '<=', String(to || '9999-12-31'))
    ),
    options
  );

// Derives audience tags for visibility checks: public (*), member ID, role, and rank.
export const audienceKeysFor = ({ userId, roleId, rankId }) => [
  '*',
  `user:${userId}`,
  `role:${roleId}`,
  `rank:${rankId}`,
];

// Queries documents that match any of the provided audience keys.
export const audienceRows = (name, keys) =>
  rowsOf(query(collection(firestore(), name), where('audience_keys', 'array-contains-any', keys)));

// Fetches a member's submitted monthly availability records.
export const memberAvailabilityFor = async (uid, months) => {
  const ids = (Array.isArray(months) ? months : []).map((month) => availabilityMonthId(uid, month));
  if (!ids.length) return [];
  const snapshots = await Promise.all(
    ids.map((id) => getDoc(doc(firestore(), 'availability_months', id)))
  );
  const docs = snapshots
    .filter((snap) => snap.exists())
    .map((snap) => ({ ...snap.data(), id: snap.id }));
  return claimRowsFromMonths(docs);
};

// Shift offer statuses shown as pills on member calendars.
export const OFFER_STATUSES_ON_A_CALENDAR = ['pending', 'declined'];

// Fetches shift offers submitted by a specific member.
export const offersForMember = (uid) =>
  rowsOf(
    query(
      collection(firestore(), 'schedule_offers'),
      where('user_id', '==', uid),
      where('status', 'in', OFFER_STATUSES_ON_A_CALENDAR)
    )
  );

// Fetches pending shift offers awaiting officer approval.
export const pendingOffers = (db) =>
  rowsOf(query(collection(db, 'schedule_offers'), where('status', '==', 'pending')));

// Queries announcements and events that are currently active and not expired.
export const activeAudienceRows = async (name, keys, { liveUntilField = '' } = {}) => {
  if (!liveUntilField) return audienceRows(name, keys);

  const today = toDateKey(new Date());
  try {
    const rows = await rowsOf(
      query(
        collection(firestore(), name),
        where('audience_keys', 'array-contains-any', keys),
        where(liveUntilField, '>=', today)
      )
    );
    if (rows.length) return rows;

    const unfiltered = await audienceRows(name, keys);
    if (unfiltered.length) {
      console.warn(
        `[firestore] ${name}: nothing matched the active filter, but ${unfiltered.length} row(s) are aimed at this ` +
          `member and carry no \`${liveUntilField}\` - so that column is stale, and this read is unfiltered. Re-saving ` +
          'each one from its own tab stamps it (see firestoreWrites#saveAudienceDocument); until then nothing is hidden, ' +
          'but nothing is narrowed either.'
      );
      return unfiltered;
    }
    return rows;
  } catch (error) {
    console.warn(
      `[firestore] ${name}: the active (${liveUntilField}) filter could not run, so this read is unfiltered.` +
        (error && error.code ? ` (${error.code})` : ''),
      error
    );
    return audienceRows(name, keys);
  }
};

// Fetches specific member profiles by their user IDs.
export const usersByIds = async (ids) => {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!wanted.length) return [];
  const snapshots = await Promise.all(wanted.map((id) => getDoc(doc(firestore(), 'users', id))));
  return snapshots.map((snapshot, index) => ({
    ...((snapshot.exists() && snapshot.data()) || {}),
    id: wanted[index],
  }));
};

// Shares an in-flight read of all users so concurrent components don't make duplicate requests.
let usersInFlight = null;
export const readUsersOnce = () => {
  if (!usersInFlight) {
    usersInFlight = rowsOf(collection(firestore(), 'users'));
    const release = () => {
      usersInFlight = null;
    };
    usersInFlight.then(release, release);
  }
  return usersInFlight;
};

// Converts key-value map documents into an array of { key, value } pairs.
export const settingRows = (snapshot) => Object.entries(snapshot.data() || {}).map(([key, value]) => ({ key, value }));

// Days of the week in standard display order (starting Monday).
const TEMPLATE_DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// Converts time strings into minutes from midnight for sorting.
const templateMinutes = (value) => {
  const parsed = toTimeInputValue(value);
  if (!parsed) return null;
  const [hours, minutes] = parsed.split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
};

// Finds the minimum required rank for an assignment position.
const requiredRankFor = (assignments, assignmentId) => {
  const wanted = String(assignmentId || '').trim();
  if (!wanted) return null;
  const found = (Array.isArray(assignments) ? assignments : []).find((row) => String(row && row.id) === wanted);
  const order = Number(found && found.rank_order_required);
  return Number.isFinite(order) ? order : null;
};

// Sort comparator for schedule templates by day, start time, rank, and name.
const scheduleTemplateSort = (assignments) => {
  const dayOf = (row) => {
    const day = TEMPLATE_DAY_ORDER.indexOf(String((row && row.day_of_week) || '').trim().toLowerCase());
    return day === -1 ? TEMPLATE_DAY_ORDER.length : day;
  };

  return (a, b) => {
    if (dayOf(a) !== dayOf(b)) return dayOf(a) - dayOf(b);

    const aMinutes = templateMinutes(a && a.start_time);
    const bMinutes = templateMinutes(b && b.start_time);
    if (aMinutes === null && bMinutes !== null) return 1;
    if (bMinutes === null && aMinutes !== null) return -1;
    if (aMinutes !== bMinutes) return aMinutes - bMinutes;

    const aRank = requiredRankFor(assignments, a && a.assignment_id);
    const bRank = requiredRankFor(assignments, b && b.assignment_id);
    if (aRank !== bRank) {
      if (aRank === null) return 1;
      if (bRank === null) return -1;
      return bRank - aRank;
    }

    const aName = String((a && a.nickname) || '').localeCompare(String((b && b.nickname) || ''));
    return aName !== 0 ? aName : String((a && a.id) || '').localeCompare(String((b && b.id) || ''));
  };
};

// Sorts schedule templates in calendar order.
const sortScheduleTemplates = (rows, assignments) =>
  Array.isArray(rows) ? rows.slice().sort(scheduleTemplateSort(assignments)) : [];

// Loads recurring shift templates, assignment positions, and shift names.
export const scheduleSetupFor = async () => {
  const [assignments, templates, shifts] = await Promise.all([
    rowsOf(collection(firestore(), 'assignments')),
    rowsOf(collection(firestore(), 'schedule_templates')),
    rowsOf(collection(firestore(), 'shifts')),
  ]);
  return { assignments, scheduleTemplates: sortScheduleTemplates(templates, assignments), shifts };
};

// Reads station roles and ranks.
const readStationRows = async (db) => {
  const [roles, ranks] = await Promise.all([
    rowsOf(collection(db, 'roles')),
    rowsOf(collection(db, 'ranks')),
  ]);
  return { roles, ranks };
};

// Readers for specific administrative data tabs.
const ADMIN_SECTIONS = {
  // Public directory of members.
  directory: async () => ({ directory: await readUsersOnce() }),

  // Full user management list including private contact info and login credentials.
  users: async (db, station) => {
    const [users, privateRows] = await Promise.all([
      station && station.users ? station.users : readUsersOnce(),
      rowsOf(collection(db, 'users_private')),
    ]);
    const privateById = Object.fromEntries(privateRows.map((row) => [row.id, row]));
    return {
      users: users.map((user) => ({
        ...user,
        user_name: (privateById[user.id] || {}).username || '',
        status: (privateById[user.id] || {}).status || '',
        fema_student_id: (privateById[user.id] || {}).fema_student_id || '',
        member_id: (privateById[user.id] || {}).member_id || '',
        email: (privateById[user.id] || {}).email || '',
        phone: (privateById[user.id] || {}).phone || '',
        is_change_password_on_login: (privateById[user.id] || {}).is_change_password_on_login === true,
      })),
    };
  },

  // Assignment position definitions and officer notes.
  assignments: async (db, station) => {
    const [assignments, notes] = await Promise.all([
      (station && station.assignments) || rowsOf(collection(db, 'assignments')),
      rowsOf(collection(db, 'assignment_private')),
    ]);
    const noteById = Object.fromEntries(notes.map((row) => [row.id, row.admin_note || '']));
    return { assignments: assignments.map((row) => ({ ...row, admin_note: noteById[row.id] || '' })) };
  },

  // Recurring shift templates and officer notes.
  scheduleTemplates: async (db, station) => {
    const [templates, notes, assignments] = await Promise.all([
      (station && station.templates) || rowsOf(collection(db, 'schedule_templates')),
      rowsOf(collection(db, 'schedule_template_private')),
      (station && station.assignments) || rowsOf(collection(db, 'assignments')),
    ]);
    const noteById = Object.fromEntries(notes.map((row) => [row.id, row.admin_note || '']));
    return {
      scheduleTemplates: sortScheduleTemplates(
        templates.map((row) => ({ ...row, admin_note: noteById[row.id] || '' })),
        assignments
      ),
    };
  },

  certificationSetup: async (db) => ({ certificationSetup: await rowsOf(collection(db, 'certification_setup')) }),

  trainings: async (db) => {
    const [trainings, signatures] = await Promise.all([
      rowsOf(collection(db, 'trainings')),
      rowsOf(collection(db, 'training_signatures')),
    ]);
    return {
      trainings: { trainings, signatures },
      signatures,
      trainingSignatures: signatures,
    };
  },

  scheduleOffers: async (db) => ({ scheduleOffers: await pendingOffers(db) }),

  roles: async (db) => ({ roles: await rowsOf(collection(db, 'roles')) }),
  ranks: async (db) => ({ ranks: await rowsOf(collection(db, 'ranks')) }),
  shifts: async (db) => ({ shifts: await rowsOf(collection(db, 'shifts')) }),
  schedule: async (_db) => {
    const window = scheduleWindowFor();
    return {
      schedule: await rowsInRange('schedule', 'date_from', window.from, window.to),
      schedule_window: window,
    };
  },
};

// Available administrative section names.
export const ADMIN_SECTION_NAMES = Object.keys(ADMIN_SECTIONS);

// Reads a single administrative section.
export const readAdminSection = async (name, station = null) => {
  const wanted = String(name || '');
  if (!ADMIN_SECTIONS[wanted]) throw new Error(`There is no admin section called "${wanted}".`);
  return ADMIN_SECTIONS[wanted](firestore(), station);
};

// Reads multiple administrative sections at once.
export const readAdminSections = async (names) => {
  const wanted = (Array.isArray(names) ? names : [names]).filter(Boolean);
  const parts = await Promise.all(wanted.map((name) => readAdminSection(name)));
  return Object.assign({}, ...parts);
};

// Fetches the initial data bundle for a logged-in member.
export const fetchMemberPayload = async (account, stationRows = null) => {
  const db = firestore();

  const supplied = account.roleId && account.rankId;
  const roster = supplied
    ? { role_id: account.roleId, rank_id: account.rankId }
    : (await getDoc(doc(db, 'users', account.userId))).data() || {};
  const keys = audienceKeysFor({
    userId: account.userId,
    roleId: String(roster.role_id || ''),
    rankId: String(roster.rank_id || ''),
  });

  const station = stationRows || (await readStationRows(db));
  const { roles, ranks } = station;

  const [
    settings,
    mySettings,
    onDutyRows,
    certifications,
    setup,
    announcements,
  ] = await Promise.all([
    getDoc(doc(db, 'settings', 'public')),
    getDoc(doc(db, 'user_settings', account.userId)),
    rowsOf(collection(db, 'on_duty')),
    rowsFor('certifications', 'user_id', account.userId),
    rowsOf(collection(db, 'certification_setup')),
    activeAudienceRows('announcements', keys, { liveUntilField: 'live_until' }),
  ]);

  const onDutyMembers = await usersByIds(onDutyRows.map((row) => row.user_id || row.id));
  const memberById = (userId) => onDutyMembers.find((user) => user.id === String(userId)) || {};

  const decoratedCertifications = decorateCertifications(certifications, setup, stationTodayKey());

  return {
    success: true,
    roles,
    ranks,
    // onDuty projection: id: String(row.user_id), name: member.name, rank_id: member.rank_id
    onDuty: onDutyRows.map((row) => {
      const memberId = String(row.id || row.user_id || '').trim();
      const member = memberById(memberId);
      return {
        id: memberId,
        user_id: memberId,
        name: row.name || member.name || '',
        rank_id: row.rank_id !== undefined && row.rank_id !== '' ? row.rank_id : (member.rank_id ?? ''),
        time_in: row.time_in || '',
      };
    }),
    certifications: decoratedCertifications,
    certificationAlerts: certificationAlertsFor(decoratedCertifications),
    certificationSetup: setup,
    announcements,
    systemSettings: settingRows(settings),
    userSettings: [{ id: account.userId, user_id: account.userId, ...(mySettings.data() || {}) }],
  };
};

// Probes individual collections one by one to diagnose which permission failed.
export const diagnoseMemberPayload = async (uid) => {
  const db = firestore();
  const probes = [
    ['users', () => readUsersOnce()],
    ['roles', () => rowsOf(collection(db, 'roles'))],
    ['ranks', () => rowsOf(collection(db, 'ranks'))],
    ['shifts', () => rowsOf(collection(db, 'shifts'))],
    ['assignments', () => rowsOf(collection(db, 'assignments'))],
    ['schedule_templates', () => rowsOf(collection(db, 'schedule_templates'))],
    ['schedule', () => rowsInRange('schedule', 'date_from', scheduleWindowFor().from, scheduleWindowFor().to)],
    ['settings/public', () => getDoc(doc(db, 'settings', 'public'))],
    ['user_settings', () => getDoc(doc(db, 'user_settings', uid))],
    ['availability_months', () => rowsFor('availability_months', 'user_id', uid)],
    ['timeclock', () => rowsFor('timeclock', 'user_id', uid)],
    ['on_duty', () => rowsOf(collection(db, 'on_duty'))],
    ['schedule_offers', () => rowsOf(collection(db, 'schedule_offers'))],
    ['trainings', () => rowsOf(collection(db, 'trainings'))],
    ['training_signatures', () => rowsOf(collection(db, 'training_signatures'))],
    ['certifications', () => rowsOf(collection(db, 'certifications'))],
    ['certification_setup', () => rowsOf(collection(db, 'certification_setup'))],
    ['certification_badges', () => rowsOf(collection(db, 'certification_badges'))],
    ['announcements', () => audienceRows('announcements', ['*'])],
    ['events', () => audienceRows('events', ['*'])],
  ];

  const refused = [];
  const failed = [];
  for (const [name, probe] of probes) {
    try {
      await probe();
    } catch (error) {
      const code = String((error && error.code) || '');
      (code.includes('permission-denied') ? refused : failed).push(`${name} (${code || error.message})`);
    }
  }
  return { refused, failed };
};

// Loads initial administration payload for officers.
export const fetchAdminPayload = async (account) => {
  const db = firestore();

  const [station, meSnapshot] = await Promise.all([
    readStationRows(db),
    account.roleId && account.rankId ? null : getDoc(doc(db, 'users', account.userId)),
  ]);
  const me = meSnapshot && meSnapshot.exists() ? meSnapshot.data() || {} : {};
  const roleId = String(account.roleId || me.role_id || '');
  const rankId = String(account.rankId || me.rank_id || '');
  const payload = await fetchMemberPayload({ ...account, roleId, rankId }, station);

  return payload;
};
