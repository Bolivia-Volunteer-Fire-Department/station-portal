// The member's sign-in payload, read from Firestore.
//
// It keeps the shape the sheet backend's sign-in payload returned, field for field, because the app was built against that
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
import { collection, doc, documentId, getDoc, getDocs, query, where } from 'firebase/firestore';
import { firestore } from './firebase.js';
// The app's time parser, shared rather than re-implemented (see templateMinutes below). It has no imports of its own,
// which is what lets this module - loaded by plain Node in the harnesses - use it.
import { toTimeInputValue } from '../utils/timeInputValue.js';
// Date keys, for the "what is in force" bound on announcements (activeAudienceRows below), and the availability helpers
// the month documents are read and flattened with.
import { toDateKey, stationTodayKey } from '../utils/scheduleDate.js';
// The certification decoration - state, days, and the type join - shared with the refresh reader, so a sign-in
// and a refresh cannot hand the modules rows that disagree about what "expiring" means.
import { certificationAlertsFor, decorateCertifications } from '../utils/certifications.js';
import { availabilityMonthId, claimRowsFromMonths } from '../utils/availability.js';
// The window a load carries for `schedule`. Pure and dependency-free, so this module stays loadable by the Node
// harnesses - see the note in that file.
import { scheduleWindowFor } from '../utils/scheduleWindow.js';

// Shared with firestoreReads.js, which serves the refresh reads: one implementation of each query, so a read moved
// to Firestore cannot answer differently depending on which action asked for it.
// Documents, as the app's rows. THE DOCUMENT ID WINS OVER ANY FIELD CALLED `id`, which is why the spread comes first: a
// save body carries the form's `id` - empty when the form is creating - so a stored copy of that field would shadow the
// real key. That is not hypothetical: a freshly created row came back with an EMPTY id, so pressing Edit saved a second
// copy of it and Delete did nothing at all. Nothing else about the row is special-cased.
export const rowsOf = async (target, options = {}) =>
  (await getDocs(target, options)).docs.map((entry) => ({ ...entry.data(), id: entry.id }));

export const rowsFor = (name, field, value) => rowsOf(query(collection(firestore(), name), where(field, '==', value)));

// Rows whose date field falls inside a window, inclusive at both ends. `date_from` is stored as a 'YYYY-MM-DD' key, which
// sorts chronologically as text - so two range filters on the SAME field are all this needs: no composite index, and no
// parsing on either side. An end that is not given is left open rather than narrowed to an epoch.
//
// `options` carries through to getDocs, so a caller can ask for the SERVER truth rather than the cache - which matters
// for the schedule's re-read after a save, because an offline cache would otherwise hand back the pre-save rows and a
// freshly written shift would be drawn where it came from.
export const rowsInRange = (name, field, from, to, options = {}) =>
  rowsOf(
    query(
      collection(firestore(), name),
      where(field, '>=', String(from || '0000-01-01')),
      where(field, '<=', String(to || '9999-12-31'))
    ),
    options
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

// A MEMBER'S AVAILABILITY FOR A SET OF MONTHS, flattened to rows.
//
// One document per month rather than one per claimed day (utils/availability.js) - and because the month keys are the
// document ids, this is a get-by-id list rather than a query, so it costs one read per month and no index. The screens
// keep working in rows: the month shape is flattened HERE, at the edge, so nothing downstream has two shapes to reason
// about.
export const memberAvailabilityFor = async (uid, months) => {
  const ids = (Array.isArray(months) ? months : []).map((month) => availabilityMonthId(uid, month));
  if (!ids.length) return [];
  const docs = await rowsOf(
    query(collection(firestore(), 'availability_months'), where(documentId(), 'in', ids))
  );
  return claimRowsFromMonths(docs);
};

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

// NAMES FOR A HANDFUL OF MEMBERS, BY ID - the dashboard's on-duty card, and nothing else.
//
// The whole-directory read (readUsersOnce) is what a screen that LISTS people needs: the Users tab, the crew names on a
// month of the calendar, the availability roster. The dashboard needs none of that - it needs to know whether the person
// clocking in is already on duty, and the names of whoever else is on shift RIGHT NOW - so it reads one document per person
// on duty and stops. At station scale that is the difference between a sign-in that scans thirty members and one that reads
// two, and it is why this exists rather than reusing the shared read: the shared read is right for the screens it serves and
// wrong for the only member-facing screen that never lists anybody.
//
// A missing document falls back to an empty object rather than dropping the row: somebody on duty whose `users` document
// cannot be read should still appear, unnamed, rather than vanish from the list of who is at the station.
export const usersByIds = async (ids) => {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!wanted.length) return [];
  const snapshots = await Promise.all(wanted.map((id) => getDoc(doc(firestore(), 'users', id))));
  return snapshots.map((snapshot, index) => ({
    ...((snapshot.exists() && snapshot.data()) || {}),
    id: wanted[index],
  }));
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
// THE SCHEDULE'S REFERENCE DATA, in one read: the templates a shift is drawn from, the assignments that colour and order them,
// and the shift definitions the clock history labels an entry with.
//
// It is read when a screen that has a schedule - or a clock entry - is opened (GET_SCHEDULE_SETUP, through
// App#loadScheduleSetup) rather than at sign-in, which is the last of the station-wide data to leave the payload. The officer's
// copies are the same rows plus the private notes: those arrive with the administration wave, which merges them from their own
// collections, and this read deliberately does not carry them.
export const scheduleSetupFor = async () => {
  const [assignments, templates, shifts] = await Promise.all([
    rowsOf(collection(firestore(), 'assignments')),
    rowsOf(collection(firestore(), 'schedule_templates')),
    rowsOf(collection(firestore(), 'shifts')),
  ]);
  // Sorted, not as it arrived: the sheet's own row order is the order the week reads in, and a collection has none. The
  // assignments come along because the tiebreak between two shifts that start together is the assignment's rank.
  return { assignments, scheduleTemplates: sortScheduleTemplates(templates, assignments), shifts };
};

// THE SHARED WAVE: the station-wide rows both payloads project from, read ONCE per sign-in.
//
// NEITHER THE SCHEDULE NOR THE USER DIRECTORY IS IN IT, and that is the shape of this pass. `schedule` is the one collection
// that grows without limit - every shift the station has ever scheduled - and a member who signs in to clock in and leave
// never draws one, so a calendar or the board fetches the month in front of it (GET_SCHEDULE, through
// App#loadScheduleWindow). `users` is one document per member, which a dashboard does not need either: the only member-facing
// screen that names anybody is the on-duty card, and that reads the people ON DUTY (usersByIds) - two documents rather than
// thirty at station scale. The directory is read by the screens that LIST people, when they are opened (GET_ROSTER, and the
// Users tab's own section).
const readStationRows = async (db) => {
  const [roles, ranks] = await Promise.all([
    rowsOf(collection(db, 'roles')),
    rowsOf(collection(db, 'ranks')),
  ]);
  return { roles, ranks };
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
  // THE CREW DIRECTORY: the full public `users` rows, and nothing else. The tabs that NAME a member (the board, the
  // clock table, availability, certifications) read this instead of the `users` section, because that one joins
  // `users_private` - a whole-collection read the rules refuse to anybody without can_edit_users, which would take
  // the names AND the rows down together for a tab whose officer lacks that permission. Every field here is public
  // by the rules (the users collection is readable signed-in), so this section is safe for every officer.
  //
  // It is a superset of what the name joins need and the same rows the crew-directory read hands the member
  // calendar, minus the projection: `exclude_from_scheduling` and the runner sound profile travel, because the
  // board's quick-add filters on the flag and the eligibility picker reads both.
  directory: async () => ({ directory: await readUsersOnce() }),

  users: async (db, station) => {
    const [users, privateRows] = await Promise.all([
      // The station wave no longer carries the directory (a sign-in does not read it), so this falls back to the shared read
      // - which is what the Users tab wants anyway: the WHOLE list, with the private half joined on.
      station && station.users ? station.users : readUsersOnce(),
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
        // The password-change flag: the edit form has a checkbox AND a "Password change due" badge for it, so it
        // is read here with the other two private fields rather than at sign-in. A member with no private row yet
        // is treated as not waiting for a change, the same default the username join uses for a missing row.
        is_change_password_on_login: (privateById[user.id] || {}).is_change_password_on_login === true,
      })),
    };
  },

  assignments: async (db, station) => {
    // `(station && station.assignments)` RATHER THAN `station ? ...`: the station wave no longer carries the reference data - a
    // sign-in reads none of it - so the station object is TRUTHY with the field ABSENT. A ternary reads that as "the caller brought
    // them" and hands back undefined, which is a crash on the next line. (The directory had the same shape.)
    const [assignments, notes] = await Promise.all([
      (station && station.assignments) || rowsOf(collection(db, 'assignments')),
      rowsOf(collection(db, 'assignment_private')),
    ]);
    const noteById = Object.fromEntries(notes.map((row) => [row.id, row.admin_note || '']));
    return { assignments: assignments.map((row) => ({ ...row, admin_note: noteById[row.id] || '' })) };
  },

  scheduleTemplates: async (db, station) => {
    // The assignments come along even when the caller did not bring them: the order this payload is famous for (time,
    // then the assignment's rank) needs their rank orders, and a scoped refresh must produce the same order as a sign-in.
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

  // The administration table draws `state` and `days_until_end` beside every record, and filters and sorts on
  // them - so this section decorates exactly as the member's read does. The setup rows are the join; the badge
  // index writer refreshes separately after a save (see firestoreWrites).
  certificationRecords: async (db) => {
    const [records, setup] = await Promise.all([
      rowsOf(collection(db, 'certifications')),
      rowsOf(collection(db, 'certification_setup')),
    ]);
    return { certificationRecords: decorateCertifications(records, setup, stationTodayKey()) };
  },

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
  // migration and by nobody in the app - see the README's data-model section.
  roles: async (db) => ({ roles: await rowsOf(collection(db, 'roles')) }),
  ranks: async (db) => ({ ranks: await rowsOf(collection(db, 'ranks')) }),
  shifts: async (db) => ({ shifts: await rowsOf(collection(db, 'shifts')) }),
  // `schedule` is the one section read as a WINDOW, exactly as the payload's own read is: a scoped refresh must not read
  // what the payload deliberately stopped reading. It comes back with its window, so a screen that replaced its rows from
  // this still knows what it holds.
  schedule: async (_db) => {
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

export const fetchMemberPayload = async (account, stationRows = null) => {
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
  const station = stationRows || (await readStationRows(db));
  const { roles, ranks } = station;

  // THE MEMBER'S CLAIMS AND THE WINDOWS ARE NOT READ HERE. Both belong to the availability module, and this payload lands in
  // front of somebody who is most likely clocking in: the grid asks for the months it draws (GET_AVAILABILITY, a quarter at a
  // time, through App#refreshAvailability) and for the options list they are claimed against (GET_AVAILABILITY_WINDOWS) when
  // that screen is opened. A member who never opens it reads neither.
  //
  // The member's own rows, plus the two audience-filtered collections.
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
    // NO CLOCK HISTORY HERE, deliberately. It is the one per-member table that grows without limit (a five-year member has
    // thousands of entries), and it used to be read at every sign-in so that the DASHBOARD could answer "am I clocked in" -
    // a question the `on_duty` row below answers for free, because the clock transaction writes the entry and that row
    // together. The history is read when the History screen is opened, over a range: see GET_TIMECLOCK_LOGS.
    rowsOf(collection(db, 'on_duty')),
    // THE MEMBER'S OWN OFFERS, TRAINING SIGNATURES AND THE TRAINING LIST ARE NOT READ HERE either. Offers belong to the
    // calendar that draws their pills (GET_SHIFT_OFFERS, through App#refreshOffers), and trainings and signatures belong to the
    // Training module (GET_TRAINING, through App#refreshTraining) - which is also where an officer's training tab gets them. A
    // member who signs in to clock in opens neither.
    // The member's certifications, though, stay: the dashboard's certification notice is drawn from them, and it is the one
    // thing on that screen which is personal and time-critical. They are DECORATED below (state, days_until_end, the
    // type's name and icon) - the setup read is in this same wave, so the join costs nothing extra.
    rowsFor('certifications', 'user_id', account.userId),
    rowsOf(collection(db, 'certification_setup')),
    // ANNOUNCEMENTS ARE NARROWED TO THE ONES IN FORCE, not merely to the ones aimed at this member: see activeAudienceRows.
    //
    // EVENTS ARE NOT READ HERE AT ALL, and the reason is the same one that shapes this whole pass: they are drawn by the three
    // screens that have a calendar on them - the member's own, the availability grid and the officer's board - and by nothing on
    // the dashboard. They arrive with the screen (GET_EVENTS), followed by their listener; the note on AUDIENCE_SAVES
    // (firestoreRouting) still says why no date bound could narrow them, which is a separate point and still true.
    activeAudienceRows('announcements', keys, { liveUntilField: 'live_until' }),
  ]);

  // WHO IS ON DUTY, WITH NAMES - and this is the ONLY directory read a sign-in costs: one document per person currently on
  // shift, rather than the whole crew. The rows come from `on_duty` (the same transaction that opens and closes a clock entry
  // writes them), so the ids are not known until that read lands - hence a second, tiny wave rather than a field in the first.
  const onDutyMembers = await usersByIds(onDutyRows.map((row) => row.user_id));
  const memberById = (userId) => onDutyMembers.find((user) => user.id === String(userId)) || {};

  // The certifications' state and days are derived at read time (they would go stale if stored), with the type
  // join the modules draw from. See utils/certifications.js - the same decoration the refresh reader applies.
  const decoratedCertifications = decorateCertifications(certifications, setup, stationTodayKey());

  return {
    success: true,
    roles,
    ranks,
    // THE SCHEDULE'S REFERENCE DATA IS NOT HERE EITHER - the templates, the assignments and the shift definitions. They exist to
    // draw a schedule (and, for `shifts`, to label a clock entry with the shift it belonged to), so they arrive with those
    // screens: GET_SCHEDULE_SETUP, fetched once per session by App#loadScheduleSetup. This is the last of the station-wide data
    // to leave the sign-in, and with it the payload carries nothing but what the dashboard and the menu draw.
    // THE ROSTER IS NOT HERE ANY MORE. It is a directory - one document per member - and this payload is landing in front of
    // somebody who is most likely here to clock in and leave. The screens that LIST people ask for it when they are opened
    // (GET_ROSTER: the crew names on a month of the calendar, the availability roster, the Users tab), and App fetches it once
    // for whichever of them is on screen. See readStationRows.
    // Who is on duty, in the same three columns - which is what the dashboard draws, and the only names a sign-in needs.
    onDuty: onDutyRows.map((row) => {
      const member = memberById(row.user_id);
      return { id: String(row.user_id), name: member.name, rank_id: member.rank_id };
    }),
    // THE SCHEDULE IS NOT HERE, deliberately: it is the collection that grows without limit, and no screen in front of a
    // member at sign-in draws one. `App#loadScheduleWindow` fetches the month a calendar or the board is looking at, and
    // `GET_SCHEDULE` answers with the window it read - so a screen that navigates outside it knows to ask rather than
    // showing an empty month and calling it a schedule. See utils/scheduleWindow and firestorePayload#readStationRows.
    // `assignments` and `scheduleTemplates` are NOT here either: they are the reference data the two comments above describe,
    // and GET_SCHEDULE_SETUP is what a screen with a schedule reads. What is left in this payload is the dashboard's own data and
    // the menu's - which is the whole point of the pass.
    // THE MEMBER'S CLAIMS AND WINDOWS ARE NOT HERE ANY MORE: they belong to the Availability screen, which reads the months it
    // draws and the options list when it is opened (GET_AVAILABILITY, GET_AVAILABILITY_WINDOWS). See memberAvailabilityFor.
    // THE MEMBER'S OFFERS, TRAININGS AND SIGNATURES ARE NOT HERE ANY MORE. Offers draw pills on the calendar that asks for
    // them (GET_SHIFT_OFFERS), and trainings and signatures belong to the Training module (GET_TRAINING) - read when either is
    // opened, by the member or by an officer. `logs` is NOT here any more either - the History screen reads its own, over a
    // range. A payload field that no screen needs at sign-in is the same trap as a read that no screen needs: it looks free
    // because it is spelled elsewhere.
    // Decorated ONCE: the module's list and the sign-in notice draw the same rows, so both come from one
    // decoration rather than two - see utils/certifications.js for what the decoration adds.
    certifications: decoratedCertifications,
    certificationAlerts: certificationAlertsFor(decoratedCertifications),
    certificationSetup: setup,
    // The badge index is NOT here: it is one document per member (the icons to draw beside their name), and it is read with the
    // roster - the screens that draw a NAME are exactly the screens that draw the badges. See GET_ROSTER.
    announcements,
    // `events` is NOT here either: they belong to the calendars, which read them (and watch them) when one is opened. See the
    // read block above and App.jsx's events effect.
    // THE WINDOWS AND THE CLAIMS ARE NOT HERE EITHER, for the same reason and with the same caller: the grid reads the options
    // list and the months it draws when it is opened. `availability_window` used to say what range the claims covered, which is
    // now the answer the read itself returns (GET_AVAILABILITY's `availability_window`).
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

// The administrator's payload: the member payload PLUS the sections an officer's tabs read, each gated on the
// permission its tab needs.
//
// The gating is not decoration. Where the sheet server could omit a section a role may not have and leave the rest
// of the payload working, a read the rules refuse THROWS - so an ungated section would take the whole payload down
// for the role that cannot see it. The viewer's role document is read first, and every extra section sits behind the
// same flag the action it replaces was gated on.
export const fetchAdminPayload = async (account) => {
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
    readStationRows(db),
    account.roleId && account.rankId ? null : getDoc(doc(db, 'users', account.userId)),
  ]);
  const me = meSnapshot && meSnapshot.exists() ? meSnapshot.data() || {} : {};
  const roleId = String(account.roleId || me.role_id || '');
  const rankId = String(account.rankId || me.rank_id || '');
  const payload = await fetchMemberPayload({ ...account, roleId, rankId }, station);

  // THE OFFICER-ONLY SECTIONS USED TO BE ASSEMBLED HERE, each behind a `may(permission)` gate. They are not read here at all any
  // more: every one of them belongs to a TAB, and each tab is itself gated by the permission that opens it - so the gate did not
  // disappear, it moved to where the data is asked for (App.jsx's admin section effect). Nothing in the app repeats a rule the
  // RULES already enforce on the wire, which is the same reason the write dispatchers do not re-check what they write to.

  // AND NEITHER ARE THE FOUR THAT USED TO BE ASSEMBLED HERE: the assignment and template FULL rows (with their private notes
  // merged back), the offers still waiting, and the shift definitions. Each belongs to one or two sub-tabs - the board draws a
  // schedule and flags its waiting slots, the clock table labels entries with a shift, and two tabs exist for one section each -
  // so each is read when that tab is opened (App.jsx's admin section effect, over the same section readers a save's refresh uses).
  //
  // The notes still matter: an officer's pickers and notes read the whole record, so the section merges them - and the member
  // calendar's own copies are the public rows, which GET_SCHEDULE_SETUP serves without them.

  // ...and the certification RECORDS are not read here either, for the reason above: the one tab that shows what is expiring next
  // reads them when it is opened. (The STATE is not stored and not added by that read either - it is a function of the two dates
  // and today, so it would go stale with nobody writing anything.)

  // ...and the shift DEFINITIONS are not read here either: the clock-management table is the one place that labels an entry with
  // the shift it belonged to, and it reads them when it is opened. (The member's own history reads the same rows through
  // GET_SCHEDULE_SETUP.)

  return payload;
};
