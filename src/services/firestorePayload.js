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
// The app's time parser, shared rather than re-implemented (see templateMinutes below). It has no imports of its own,
// which is what lets this module - loaded by plain Node in the harnesses - use it.
import { toTimeInputValue } from '../utils/timeInputValue.js';
// Date keys, for the "what is in force" bound on announcements (activeAudienceRows below).
import { toDateKey } from '../utils/scheduleDate.js';
// The window a load carries for `schedule`. Pure and dependency-free, so this module stays loadable by the Node
// harnesses - see the note in that file.
import { scheduleWindowFor } from '../utils/scheduleWindow.js';

// Shared with firestoreReads.js, which serves the refresh reads: one implementation of each query, so a read moved
// to Firestore cannot answer differently depending on which action asked for it.
export const rowsOf = async (target) => (await getDocs(target)).docs.map((entry) => ({ id: entry.id, ...entry.data() }));

export const rowsFor = (name, field, value) => rowsOf(query(collection(firestore(), name), where(field, '==', value)));

// Rows whose date field falls inside a window, inclusive at both ends. `date_from` is stored as a 'YYYY-MM-DD' key, which
// sorts chronologically as text - so two range filters on the SAME field are all this needs: no composite index, and no
// parsing on either side. An end that is not given is left open rather than narrowed to an epoch.
export const rowsInRange = (name, field, from, to) =>
  rowsOf(
    query(
      collection(firestore(), name),
      where(field, '>=', String(from || '0000-01-01')),
      where(field, '<=', String(to || '9999-12-31'))
    )
  );

// The four keys an audience query carries: everyone, this member, their role, their rank. The rules answer the same
// list with hasAny - see firestore.rules - which is what makes the query provable rather than merely convenient.
export const audienceKeysFor = ({ userId, roleId, rankId }) => [
  '*',
  `user:${userId}`,
  `role:${roleId}`,
  `rank:${rankId}`,
];

export const audienceRows = (name, keys) =>
  rowsOf(query(collection(firestore(), name), where('audience_keys', 'array-contains-any', keys)));

// A member's availability claims, over a window of dates. A claim is one row per window per day, so a year of claiming
// every Tuesday is ~52 rows for that window alone - the shape the clock history had, and the same answer: the screens
// ask for the months they can show, and loading another range grows what is held rather than replacing it (App.jsx).
export const availabilityForMember = (uid, window) =>
  rowsOf(
    query(
      collection(firestore(), 'availability'),
      where('user_id', '==', uid),
      where('date_from', '>=', String(window?.from || '0000-01-01')),
      where('date_from', '<=', String(window?.to || '9999-12-31'))
    )
  );

// SHIFT OFFERS: THE TWO STATUSES A CALENDAR CAN DRAW FROM, and only those.
//
// A member's offers were read in full on every sign-in - every offer they have ever raised, kept long after it resolved,
// which is the shape of a request log rather than of something a screen draws. What the My Schedule pills need is two of
// those states: `pending` (waiting on an officer) and `declined` (the officer said no, and the shift is closed to that
// member - the pill says "Declined" so they know where they stand, and a second attempt is refused on the write as well as
// hidden on the screen; see ScheduleCalendar#offerStateFor and firestoreWrites#makeOffer). An `approved` offer is not needed
// at all: approving FILLS the shift, so the slot is no longer open and there is no pill to colour.
//
// `status` is written by every offer the app creates (firestoreWrites#makeOffer), so unlike the announcements' dates there is
// no row where the field is absent and nothing to fall back to: a filter on it cannot hide an offer that would otherwise be
// actionable. `scripts/verify-read-budget.mjs` asserts that write, because this filter depends on it.
export const OFFER_STATUSES_ON_A_CALENDAR = ['pending', 'declined'];

export const offersForMember = (uid) =>
  rowsOf(
    query(
      collection(firestore(), 'schedule_offers'),
      where('user_id', '==', uid),
      where('status', 'in', OFFER_STATUSES_ON_A_CALENDAR)
    )
  );

// The officer's view: the offers still waiting, which is what the slot flags on the schedule board are built from. This is
// the station-wide read, and it is the one that matters - "every offer ever raised by anybody" reduced to the pending ones.
// The handle is passed in because the scoped refresh reads through the caller's `db`, exactly as the other station-wide
// sections do.
export const pendingOffers = (db) =>
  rowsOf(query(collection(db, 'schedule_offers'), where('status', '==', 'pending')));

// ANNOUNCEMENTS ARE READ AS "WHAT IS IN FORCE", not as "everything aimed at me".
//
// The audience narrows the rows a member MAY read (the rule proves the same thing); the date bound narrows them again to
// the ones that can be SHOWN, and that second half is what stops a collection every sign-in pays for from growing forever.
// The bound is `live_until >= today`, a field the save path materializes - because neither `end_date` (blank means
// indefinitely) nor `effective_date` (blank means in force) can be asked for directly. See firestoreWrites.
//
// IT FALLS BACK, LOUDLY, WHEN THE NARROW READ CANNOT BE TRUSTED. Two things can break it, and the dangerous one is quiet:
// the composite index it needs may not be deployed yet, which ERRORS, or rows written before `live_until` existed have no
// field to compare, which matches NOTHING and looks exactly like a station with nothing to say. For announcements that is
// a safety failure rather than a cosmetic one, so an active read that errors or comes back empty is asked again WITHOUT
// the date bound, and the console is told why. The fallback is close to free when it fires: a query matching no documents
// bills no document reads.
// There is no longer an allow-a-refusal read here. The pre-login payload used one because the rules refuse three of the
// four things it asked for; it now asks for the one thing they allow (settings/public), so a refusal is a genuine fault
// and should be seen rather than swallowed.
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

    // Nothing at all: either a genuinely quiet station, or rows that carry no `live_until` yet.
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

// ONE `users` READ PER WAVE, NOT ONE PER READER.
//
// FOUR PLACES READ THIS WHOLE COLLECTION - the payload's station wave (which the roster is projected from), the on-duty
// join, the notifications tab's per-member picture and the users admin section - and Firestore bills per
// DOCUMENT read. A station with 40 members was paying 40 reads for each of them to learn the same thing, and at a sign-in
// several fire at once.
//
// The rule is narrow, and it is the same discipline the old request coalescer used (utils/readCoalescing): share an
// IN-FLIGHT read, and drop it the moment it settles. Nothing is cached across time, so a read issued after a write still
// sees the write - which is what keeps this from ever showing a save that has not landed. Two callers a minute apart get
// two reads; two callers in the same moment get one.
//
// What this does NOT do is make a sequential repeat cheap; the leaderboard still reads the collection on every play, and
// narrowing THAT is a data question (a numeric runner_score) rather than a coalescing one. See the note in
// firestoreReads.js#GET_RUNNER_LEADERBOARD.
//
// THE ARRAY IS SHARED, so treat it as read-only: map, filter and spread it, but never sort or splice it in place, or the
// next reader inherits the change.
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

// A settings document turned back into the key/value rows the app reads today. The shape stays a list until the
// settings screen itself is migrated: keeping it is what lets this module drop in behind api.js unchanged.
export const settingRows = (snapshot) => Object.entries(snapshot.data() || {}).map(([key, value]) => ({ key, value }));

// The station's week, in the order the calendars draw it: Monday first, then each day's shifts in the order they happen,
// then by nickname so the order is total rather than merely sorted.
//
// MONDAY FIRST, deliberately, and worth saying because the app holds both conventions: the month grid's weekday header
// (`calendarConstants.WEEKDAYS`) is Sunday first, while every WEEK view - the printed sheet (`PRINT_WEEKDAYS`) and the
// Templates tab's own grid - starts on Monday. Templates are a week, so they follow the week.
//
// WHY THIS EXISTS AT ALL: the sheet sent `schedule_templates` in its own ROW order, which is an order a person
// maintains - and a collection has none. It comes back by document id, so after a migration every list that shows
// templates in the order they arrived shows them shuffled. The Templates tab still reads correctly because it sorts its
// own grid, but every picker, dropdown and legend fed by this payload does not.
const TEMPLATE_DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// Minutes since midnight, or null when the value is not a readable time.
//
// THE APP'S OWN PARSER, and not a second one: `toTimeInputValue` handles every shape a spreadsheet time cell arrives in -
// 'HH:MM', '8:30 AM', a Date, and the '1899-12-30T13:30:00.000Z' a Sheets API read produces - and utils/shiftTime's
// timeToMinutes is a thin wrapper around it. The hand-rolled regex that was here instead matched '8:00 PM' as 08:00, so
// every evening shift sorted as a morning one: an ordering bug that looks like the data being wrong.
//
// Imported WITH its extension because this module is loaded by plain Node in the harnesses as well as by Vite, and Node
// does not resolve extension-less specifiers. `timeInputValue.js` has no imports of its own, which is what makes it safe
// to share; see the note in firestoreWrites.js about the app util that could not be shared for the opposite reason.
const templateMinutes = (value) => {
  const parsed = toTimeInputValue(value);
  if (!parsed) return null;
  const [hours, minutes] = parsed.split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
};

// An assignment's required rank: the SHIFT's own minimum rather than the member's, which is the key utils/crewOrder
// orders a day's crew by - "Officer above Driver above Firefighter" - whatever order the rows arrive in and whoever is
// filling them.
const requiredRankFor = (assignments, assignmentId) => {
  const wanted = String(assignmentId || '').trim();
  if (!wanted) return null;
  const found = (Array.isArray(assignments) ? assignments : []).find((row) => String(row && row.id) === wanted);
  const order = Number(found && found.rank_order_required);
  return Number.isFinite(order) ? order : null;
};

// A day the app does not recognise sorts last, and so does a time it cannot read - the convention the calendars already
// use for a shift with no readable start, rather than pretending either is midnight.
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

    // The SAME TIME, so the assignment decides: highest required rank first, and an assignment with no requirement after
    // the ranked ones. This is utils/crewOrder's rule for a day's pills, applied to the slots the board draws from these
    // rows - so a board and a picker fed by this payload cannot disagree about which shift comes first.
    const aRank = requiredRankFor(assignments, a && a.assignment_id);
    const bRank = requiredRankFor(assignments, b && b.assignment_id);
    if (aRank !== bRank) {
      if (aRank === null) return 1;
      if (bRank === null) return -1;
      return bRank - aRank;
    }

    // Total rather than merely sorted: two templates at one time on one day with the same rank still need an order.
    const aName = String((a && a.nickname) || '').localeCompare(String((b && b.nickname) || ''));
    return aName !== 0 ? aName : String((a && a.id) || '').localeCompare(String((b && b.id) || ''));
  };
};

// Non-mutating, and it needs the assignments because the tiebreak is about them.
const sortScheduleTemplates = (rows, assignments) =>
  Array.isArray(rows) ? rows.slice().sort(scheduleTemplateSort(assignments)) : [];

// The station-wide rows BOTH payloads need: reference data and the crew's shifts. Extracted so an administrator's load
// reads each of these once rather than twice - fetchAdminPayload needs the same collections for its own sections, and it
// used to read them again (see the parameter on fetchMemberPayload).
//
// `schedule` IS READ AS A WINDOW - last month, this month, next month - and it is the only one here that is: it grows
// without limit, while every other collection is bounded by the station's size. The window travels back with the rows so
// the client can tell what it holds and ask for the month it is missing.
const readStationRows = async (db, scheduleWindow = scheduleWindowFor()) => {
  const [roles, ranks, shifts, users, assignments, templates, schedule] = await Promise.all([
    rowsOf(collection(db, 'roles')),
    rowsOf(collection(db, 'ranks')),
    rowsOf(collection(db, 'shifts')),
    // The SHARED `users` read: the roster projection, the on-duty join and the users directory all project off this same
    // array rather than reading the collection again - see readUsersOnce.
    readUsersOnce(),
    rowsOf(collection(db, 'assignments')),
    rowsOf(collection(db, 'schedule_templates')),
    rowsInRange('schedule', 'date_from', scheduleWindow.from, scheduleWindow.to),
  ]);
  return { roles, ranks, shifts, users, assignments, templates, schedule, window: scheduleWindow };
};

// ONE ADMIN SECTION AT A TIME, by the name the payload uses for it.
//
// WHY THIS EXISTS: the payload is the right shape for a SIGN-IN - everything an officer's screens need, in one wave - and
// the wrong shape for what happens AFTER a save. Every admin save called the whole payload again (36 call sites), so
// changing one rank's description re-read the schedule, the roster, every private half, and the documents tab's save -
// whose data is not in the payload at all - read the lot for nothing.
//
// A section reader reads what one screen's save could have changed. `station` is the shared wave when the caller has
// already read it (fetchAdminPayload does, so nothing is read twice); a scoped refresh passes nothing and reads only its
// own collections.
const ADMIN_SECTIONS = {
  users: async (db, station) => {
    const [users, privateRows] = await Promise.all([
      station ? station.users : readUsersOnce(),
      rowsOf(collection(db, 'users_private')),
    ]);
    const privateById = Object.fromEntries(privateRows.map((row) => [row.id, row]));
    // The sheet's own field name for the username, and the row SPREAD rather than projected: the form edits attributes
    // that live on the roster row (`exclude_from_scheduling`, the runner sound profile, the change-password flag), and a
    // projection silently blanks whichever ones it forgets.
    return {
      users: users.map((user) => ({
        ...user,
        user_name: (privateById[user.id] || {}).username || '',
        status: (privateById[user.id] || {}).status || '',
      })),
    };
  },

  assignments: async (db, station) => {
    const [assignments, notes] = await Promise.all([
      station ? station.assignments : rowsOf(collection(db, 'assignments')),
      rowsOf(collection(db, 'assignment_private')),
    ]);
    const noteById = Object.fromEntries(notes.map((row) => [row.id, row.admin_note || '']));
    return { assignments: assignments.map((row) => ({ ...row, admin_note: noteById[row.id] || '' })) };
  },

  scheduleTemplates: async (db, station) => {
    // The assignments come along even when the caller did not bring them: the order this payload is famous for (time,
    // then the assignment's rank) needs their rank orders, and a scoped refresh must produce the same order as a sign-in.
    const [templates, notes, assignments] = await Promise.all([
      station ? station.templates : rowsOf(collection(db, 'schedule_templates')),
      rowsOf(collection(db, 'schedule_template_private')),
      station ? station.assignments : rowsOf(collection(db, 'assignments')),
    ]);
    const noteById = Object.fromEntries(notes.map((row) => [row.id, row.admin_note || '']));
    return {
      scheduleTemplates: sortScheduleTemplates(
        templates.map((row) => ({ ...row, admin_note: noteById[row.id] || '' })),
        assignments
      ),
    };
  },

  certificationRecords: async (db) => ({ certificationRecords: await rowsOf(collection(db, 'certifications')) }),

  certificationSetup: async (db) => ({ certificationSetup: await rowsOf(collection(db, 'certification_setup')) }),

  trainings: async (db) => ({ trainings: await rowsOf(collection(db, 'trainings')) }),

  // Pending only, for the same reason the member's is narrowed: the board flags slots from the offers still waiting, and
  // "every offer ever raised by anybody" is the largest thing this half of the payload used to read. See pendingOffers.
  scheduleOffers: async (db) => ({ scheduleOffers: await pendingOffers(db) }),

  // The station-wide ones, which are single collections read whole - the same reads the payload's member half makes, and
  // the reason a scoped refresh is worth having: one collection instead of eighteen.
  //
  // `apparatus` is deliberately NOT among them, and no longer read at all: the client carries `apparatus_id` on rows and
  // never renders an apparatus name, so the collection was read on every load for no reader. It is still written by the
  // migration and by nobody in the app - see docs/MIGRATION_MAP.md when the data phase comes.
  roles: async (db) => ({ roles: await rowsOf(collection(db, 'roles')) }),
  ranks: async (db) => ({ ranks: await rowsOf(collection(db, 'ranks')) }),
  shifts: async (db) => ({ shifts: await rowsOf(collection(db, 'shifts')) }),
  // `schedule` is the one section read as a WINDOW, exactly as the payload's own read is: a scoped refresh must not read
  // what the payload deliberately stopped reading. It comes back with its window, so a screen that replaced its rows from
  // this still knows what it holds.
  schedule: async (db) => {
    const window = scheduleWindowFor();
    return {
      schedule: await rowsInRange('schedule', 'date_from', window.from, window.to),
      schedule_window: window,
    };
  },
};

// The names a caller may ask for, so a typo is visible rather than silent: a scoped refresh that quietly refreshed
// nothing would look exactly like a screen that failed to update.
export const ADMIN_SECTION_NAMES = Object.keys(ADMIN_SECTIONS);

export const readAdminSection = async (name, station = null) => {
  const wanted = String(name || '');
  if (!ADMIN_SECTIONS[wanted]) throw new Error(`There is no admin section called "${wanted}".`);
  return ADMIN_SECTIONS[wanted](firestore(), station);
};

// Read several sections at once, merged into the shape the payload returns.
export const readAdminSections = async (names) => {
  const wanted = (Array.isArray(names) ? names : [names]).filter(Boolean);
  const parts = await Promise.all(wanted.map((name) => readAdminSection(name)));
  return Object.assign({}, ...parts);
};

export const fetchMemberPayload = async (account, stationRows = null, scheduleWindow = scheduleWindowFor()) => {
  const db = firestore();

  // Where the caller's own keys come from MATTERS. The role and rank are read from the member's own document, not
  // from the Auth claims: a claim can be up to an hour stale after an officer changes somebody's role or rank, and
  // these two decide which announcements and events are visible - so a stale one quietly shows the wrong station.
  // The document is what the officer's save writes, which makes this one read the freshest answer available.
  const supplied = account.roleId && account.rankId;
  const roster = supplied
    ? { role_id: account.roleId, rank_id: account.rankId }
    : (await getDoc(doc(db, 'users', account.userId))).data() || {};
  const keys = audienceKeysFor({
    userId: account.userId,
    roleId: String(roster.role_id || ''),
    rankId: String(roster.rank_id || ''),
  });

  // Reference data and the crew's shifts: everything a member may read for the whole station.
  //
  // `stationRows` is that same wave, already read by a caller that needed it anyway - fetchAdminPayload does. Passing it
  // in is what stops an administrator's load reading `users`, `assignments` and `schedule_templates` a second time; the
  // parameter is internal and defaults to reading them, so every other caller is unaffected. The window is only used when
  // this call is the one doing the reading.
  const station = stationRows || (await readStationRows(db, scheduleWindow));
  const { roles, ranks, shifts, users, assignments, templates, schedule } = station;

  // CLAIMS RIDE A WIDER WINDOW THAN THE SCHEDULE. A member browsing back through last year should still see what they
  // had marked, and the grid's job is to show them the month in front of them - so the payload carries two years around
  // today. One claim per window per day is still a small read at that width, and the scope is REPORTED back
  // (`availability_window`) so a grid outside it can ask for the month rather than assume nobody marked anything.
  const availabilityScope = {
    from: toDateKey(new Date(new Date().getFullYear(), new Date().getMonth() - 12, new Date().getDate())),
    to: toDateKey(new Date(new Date().getFullYear(), new Date().getMonth() + 12, new Date().getDate())),
  };

  // The member's own rows, plus the two audience-filtered collections.
  const [
    settings,
    mySettings,
    availability,
    availabilityWindows,
    onDutyRows,
    offers,
    signatures,
    certifications,
    setup,
    trainings,
    badges,
    announcements,
    events,
  ] = await Promise.all([
    getDoc(doc(db, 'settings', 'public')),
    getDoc(doc(db, 'user_settings', account.userId)),
    // The member's own availability claims, over the schedule window, and the WINDOWS they are made against. The
    // windows are the options list - short, officer-maintained, and read whole (retired ones included, because a claim
    // points at one and the history should read) - which is what replaced templates, assignments and ranks here.
    availabilityForMember(account.userId, availabilityScope),
    rowsOf(collection(firestore(), 'availability_windows')),
    // NO CLOCK HISTORY HERE, deliberately. It is the one per-member table that grows without limit (a five-year member has
    // thousands of entries), and it used to be read at every sign-in so that the DASHBOARD could answer "am I clocked in" -
    // a question the `on_duty` row below answers for free, because the clock transaction writes the entry and that row
    // together. The history is read when the History screen is opened, over a range: see GET_TIMECLOCK_LOGS.
    rowsOf(collection(db, 'on_duty')),
    // The member's own offers, narrowed to the two statuses a calendar draws from - not the request log. See offersForMember.
    offersForMember(account.userId),
    rowsFor('training_signatures', 'user_id', account.userId),
    rowsFor('certifications', 'user_id', account.userId),
    rowsOf(collection(db, 'certification_setup')),
    rowsOf(collection(db, 'trainings')),
    rowsOf(collection(db, 'certification_badges')),
    // ANNOUNCEMENTS ARE NARROWED TO THE ONES IN FORCE, not merely to the ones aimed at this member: see
    // activeAudienceRows. Events carry no such bound, and the note on AUDIENCE_SAVES (firestoreRouting) says why - a
    // recurring event is anchored on the date of its FIRST occurrence, so any range over `date_from` would drop the weekly
    // meeting that is happening this week.
    activeAudienceRows('announcements', keys, { liveUntilField: 'live_until' }),
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
    // WHAT THE WINDOW IS, alongside the rows it produced: a screen that navigates outside it needs to know that it must
    // ask, rather than showing an empty month and calling it a schedule. See utils/scheduleWindow and GET_SCHEDULE.
    schedule_window: station.window,
    assignments,
    // Sorted, not as it arrived: the sheet's own row order is the order the week reads in, and a collection has none. The
    // assignments come along because the tiebreak between two shifts that start together is the assignment's rank.
    scheduleTemplates: sortScheduleTemplates(templates, assignments),
    availability,
    // `logs` is NOT here any more - the History screen reads its own, over a range. A payload field that no screen needs at
    // sign-in is the same trap as a read that no screen needs: it looks free because it is spelled elsewhere.
    offers,
    trainings,
    signatures,
    certifications,
    certificationSetup: setup,
    // The badge index, as the app's setCertificationBadges expects it: member id -> the icons to draw beside their
    // name. Materialized because it is derived from every member's records, which a member may not read.
    certificationBadges: Object.fromEntries(badges.map((row) => [String(row.user_id), row.badges || []])),
    announcements,
    events,
    // The availability windows, and what this member has claimed against them. `availability` is the claims; the
    // windows are the options list every member's grid draws from. `availability_window` is the scope the claims were
    // read over, so a grid showing a month outside it can ask rather than guess.
    availabilityWindows,
    availability_window: availabilityScope,
    systemSettings: settingRows(settings),
    // A LIST of one, because that is the shape the app reads today: the sheet payload carried every member's
    // settings and the client picked its own out of them.
    userSettings: [{ user_id: account.userId, ...(mySettings.data() || {}) }],
  };
};

// WHICH read was refused, for the case the generic error cannot describe.
//
// The payload runs fourteen reads in parallel, so a `permission-denied` from any one of them arrives without saying
// which - and "the member payload cannot be read" is not a diagnosis. This re-runs them ONE AT A TIME and names every
// collection the caller may not read, which costs a handful of extra reads and only ever happens after a failure.
export const diagnoseMemberPayload = async (uid) => {
  const db = firestore();
  const probes = [
    ['users', () => readUsersOnce()],
    ['roles', () => rowsOf(collection(db, 'roles'))],
    ['ranks', () => rowsOf(collection(db, 'ranks'))],
    ['shifts', () => rowsOf(collection(db, 'shifts'))],
    ['assignments', () => rowsOf(collection(db, 'assignments'))],
    ['schedule_templates', () => rowsOf(collection(db, 'schedule_templates'))],
    // The schedule probe reads the SAME window the payload does: this list exists to name which read was refused, and a
    // probe that asked a different question would misname it.
    ['schedule', () => rowsInRange('schedule', 'date_from', scheduleWindowFor().from, scheduleWindowFor().to)],
    ['settings/public', () => getDoc(doc(db, 'settings', 'public'))],
    ['user_settings', () => getDoc(doc(db, 'user_settings', uid))],
    ['availability', () => rowsFor('availability', 'user_id', uid)],
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

// The administrator's payload: the member payload PLUS the sections an officer's tabs read, each gated on the
// permission its tab needs.
//
// The gating is not decoration. Where the sheet server could omit a section a role may not have and leave the rest
// of the payload working, a read the rules refuse THROWS - so an ungated section would take the whole payload down
// for the role that cannot see it. The viewer's role document is read first, and every extra section sits behind the
// same flag the action it replaces was gated on.
export const fetchAdminPayload = async (account, scheduleWindow = scheduleWindowFor()) => {
  const db = firestore();

  // EVERYTHING SHARED IS READ ONCE: one wave for the station-wide rows (handed to the member payload rather than read
  // again by it), one read of the caller's own document when they did not say who they are, and NO read for the role -
  // it is in `roles`, which is already in hand. Reading each of those separately is what this did, so a single
  // administrator's load paid twice for three whole collections, a document and a role.
  //
  // The role comes from the member's own DOCUMENT rather than the Auth claim, for the same reason the member payload
  // does: a claim can be an hour stale after somebody's role changes, and these flags decide which sections an officer
  // gets. It also means either payload can be called with nothing but a uid, which is what a router has.
  const [station, meSnapshot] = await Promise.all([
    readStationRows(db, scheduleWindow),
    account.roleId && account.rankId ? null : getDoc(doc(db, 'users', account.userId)),
  ]);
  const me = meSnapshot && meSnapshot.exists() ? meSnapshot.data() || {} : {};
  const roleId = String(account.roleId || me.role_id || '');
  const rankId = String(account.rankId || me.rank_id || '');
  const payload = await fetchMemberPayload({ ...account, roleId, rankId }, station);

  const role = station.roles.find((row) => String(row.id) === roleId) || {};
  const may = (flag) => role.is_admin === true || role[flag] === true;

  if (may('can_edit_users')) {
    // The directory the Users tab shows: the roster row joined to the private half, because a username and an account
    // status are the officer's business and deliberately absent from the roster document. The projection itself lives in
    // the section reader, so a sign-in and a save's own refresh cannot drift apart on it.
    Object.assign(payload, await readAdminSection('users', station));
  }

  if (may('can_edit_schedule_templates') || may('can_edit_assignments') || may('can_edit_schedule')) {
    // The FULL rows, with their private halves merged back: an officer's pickers and notes read the whole record, and
    // the member projection must never replace it. The public halves come from `station`, so only the private notes and
    // the apparatus list are new reads here.
    const [assignments, templates] = await Promise.all([
      readAdminSection('assignments', station),
      readAdminSection('scheduleTemplates', station),
    ]);
    Object.assign(payload, assignments, templates);
  }

  if (may('can_approve_shifts') || may('can_edit_schedule')) {
    // The whole offers table, so Schedule Management can flag the slots waiting on approval.
    Object.assign(payload, await readAdminSection('scheduleOffers'));
  }

  if (may('can_manage_certifications')) {
    // Every record, for the table that shows what is expiring next. The STATE is not stored and not added here: it
    // is a function of the two dates and today, so it would go stale with nobody writing anything.
    Object.assign(payload, await readAdminSection('certificationRecords'));
  }

  return payload;
};
