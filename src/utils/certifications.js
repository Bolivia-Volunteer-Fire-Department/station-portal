// The words and tones for a certification's state, in one place.
//

// Both the member's own module and the administration table show the same four states, and the sign-in notice
// talks about two of them - so the phrasing lives here rather than being written three times and drifting.
//
// The state itself is derived at READ time, by `certificationStateFor` below: whether a licence has expired is a
// function of the record's two dates, the type's warning window, and today, and it would go stale with nobody
// writing anything if it were stored. "Today" is the STATION's today (America/New_York), computed by
// `stationTodayKey` in utils/scheduleDate.js, so every member's screen agrees regardless of where they are.
import { DEFAULT_PAGE_SIZE } from './pagination.js';

// HOW MANY ROWS THE CERTIFICATION REPORT SHOWS AT ONCE.
//
// It IS the shared default, and it is named here anyway so that "20 at a time" is a fact about THIS table - one a test
// can assert - rather than a number it happens to inherit. The arithmetic that turns it into pages is utils/pagination,
// the same module the events list and the system log use, so three tables cannot disagree about what "page 3 of 7" is.
export const CERTIFICATIONS_PAGE_SIZE = DEFAULT_PAGE_SIZE;

export const CERTIFICATION_STATES = {
  expiring: {
    label: 'Expires soon',
    badge: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/80',
  },
  active: {
    label: 'Current',
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/80',
  },
  upcoming: {
    label: 'Not yet effective',
    badge: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-900/80 dark:text-slate-300 dark:border-slate-700',
  },
  expired: {
    label: 'Expired',
    badge: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800/80',
  },
};

export const certificationStateLabel = (state) =>
  (CERTIFICATION_STATES[state] || {}).label || 'Unknown';
export const certificationStateBadge = (state) =>
  (CERTIFICATION_STATES[state] || {}).badge || CERTIFICATION_STATES.upcoming.badge;

// ---------------------------------------------------------------------------
// THE TWO SEARCHES an officer does on the certification table: WHO, and WHAT.
//
// Kept out of the component because they are decisions rather than markup: which rows survive a name typed in and a
// set of certifications chosen. `nameOf` is passed in rather than looked up here, because a member's name comes from
// the screen's own roster index - this module knows about records, not about the crew.
// ---------------------------------------------------------------------------

// Whether one row survives both searches. An empty box is NOT a constraint, which is what keeps the default view the
// whole table.
//
// The name match is a CONTAINS, case-insensitive: "bo" finds Bo Jones and "jones" finds him too. That is the search
// somebody does from memory, and an exact match would make the box useless for the common case of half a name.
//
// SEVERAL CERTIFICATIONS CHOSEN IS AN OR - an officer narrowing to "Air Brake or First Aid" wants either one. The two
// boxes themselves are ANDed, so a member and a certification together mean that member's rows of that certification,
// which is the question the pair is actually asking.
export const certificationRowMatches = (row, { memberName = '', certificationIds = [] } = {}, nameOf = () => '') => {
  const wanted = String(memberName || '').trim().toLowerCase();
  // The label is asked for only of a row that is there: the screen's lookup indexes the roster by the row's member,
  // and a row without one would throw where a search is meant to answer "no".
  if (wanted && !String((row ? nameOf(row) : '') || '').toLowerCase().includes(wanted)) return false;

  // Blank entries are dropped rather than compared: a chip list can hold an empty id for a moment, and `['']` would
  // otherwise hide every row instead of none.
  const chosen = (Array.isArray(certificationIds) ? certificationIds : []).filter(Boolean).map(String);
  if (chosen.length && !chosen.includes(String((row || {}).certification_id || ''))) return false;

  return true;
};

// Whether either search is doing anything - what the Clear control hangs off, and what the empty state says.
export const certificationFiltersActive = ({ memberName = '', certificationIds = [] } = {}) =>
  String(memberName || '').trim() !== '' || (Array.isArray(certificationIds) ? certificationIds.length : 0) > 0;

// THE WORDS ON THE CERTIFICATION FILTER'S OWN BUTTON - "All certifications", the one chosen, or the first with a
// count. Written here rather than in the markup because it has an edge the button cannot see: a selected id that is no
// longer in the catalogue (a type deleted while a filter still names it) has no name to show, and a label that
// claimed "All" while rows were quietly hidden would be the worst possible answer.
export const certificationFilterLabel = (setup = [], ids = []) => {
  const chosen = (Array.isArray(ids) ? ids : []).filter(Boolean).map(String);
  if (chosen.length === 0) return 'All certifications';

  const names = (Array.isArray(setup) ? setup : [])
    .filter((type) => chosen.includes(String(type.id)))
    .map((type) => String(type.name || ''))
    .filter(Boolean);

  if (names.length === 0) return `${chosen.length} chosen`;
  if (names.length === 1) return names[0];
  return `${names[0]} +${names.length - 1}`;
};


// ---------------------------------------------------------------------------
// WHERE A RECORD STANDS - derived at read time, never stored.
//
// These mirror the sheet backend's certificationState / certificationDaysUntil / certificationsForUser
// field for field, so a row the modules receive is the row they have always received.
// ---------------------------------------------------------------------------

// Calendar days between two date keys, or null when either is unusable.
//
// Counted from midnight rather than by subtracting timestamps: a certification ending "in 3 days" at 23:59
// has to answer 3, not 2, or the warning fires a day early at some times of day and not others.
export const certificationDaysUntil = (dateKey, todayKey) => {
  const target = String(dateKey || '').trim();
  const today = String(todayKey || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;

  const targetMs = Date.parse(`${target}T00:00:00Z`);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(targetMs) || !Number.isFinite(todayMs)) return null;
  return Math.round((targetMs - todayMs) / 86400000);
};

// 'active' | 'expiring' | 'expired' | 'upcoming'.
//
// `expiring` is not a separate thing from active - it is active AND inside the type's warning window - which
// is why the badge and the sign-in notice cannot disagree about whether somebody is currently certified.
// Both ask this.
export const certificationStateFor = (record, type, todayKey) => {
  const today = String(todayKey || '').trim();
  const start = String((record || {}).effective_date || '').trim();
  if (start && start > today) return 'upcoming';

  const end = String((record || {}).end_date || '').trim();
  if (!end) return 'active';
  if (end < today) return 'expired';

  // A blank warning window is the station saying "do not warn about this one", which is not the same as zero
  // days - so it is checked before the comparison rather than defaulting to 0.
  const warnDays = type ? type.warn_days_before : null;
  if (warnDays === null || warnDays === undefined) return 'active';

  const days = certificationDaysUntil(end, today);
  return days !== null && days <= warnDays ? 'expiring' : 'active';
};

// A type index keyed by id, from the certification_setup rows the readers already have in hand.
export const certificationTypeIndex = (setupRows) => {
  const index = {};
  (Array.isArray(setupRows) ? setupRows : []).forEach((row) => {
    if (row && row.id) index[String(row.id)] = row;
  });
  return index;
};

// One record, decorated with the type it belongs to and where it stands - the shape every screen draws.
// `today` is the station's date key; the readers compute it once per read and hand it in, so this stays pure.
export const decorateCertification = (row, type, today) => ({
  ...row,
  name: type ? type.name : '',
  icon: type ? type.icon : '',
  is_renewable: type ? type.is_renewable : false,
  warn_days_before: type ? type.warn_days_before : null,
  state: certificationStateFor(row, type, today),
  days_until_end: certificationDaysUntil(row.end_date, today),
});

// Every record decorated, most urgent first - the member module's order and the sheet's order.
export const decorateCertifications = (rows, setupRows, today) => {
  const types = certificationTypeIndex(setupRows);
  const rank = { expiring: 0, active: 1, upcoming: 2, expired: 3 };

  return (Array.isArray(rows) ? rows : [])
    .map((row) => decorateCertification(row, types[String(row.certification_id)] || null, today))
    .sort((a, b) => {
      const byState = (rank[a.state] === undefined ? 9 : rank[a.state]) - (rank[b.state] === undefined ? 9 : rank[b.state]);
      if (byState !== 0) return byState;
      return String(a.end_date || '9999').localeCompare(String(b.end_date || '9999'));
    });
};

// What a member is told about when they sign in: the ones inside their type's window, plus any that have
// already lapsed - a licence that quietly expired should be mentioned at least once, or the station finds out
// a year later. Types with a blank window are never mentioned here; see certificationStateFor.
export const certificationAlertsFor = (decoratedRows) =>
  (Array.isArray(decoratedRows) ? decoratedRows : []).filter((row) => {
    if (row.warn_days_before === null || row.warn_days_before === undefined) return false;
    return row.state === 'expiring' || row.state === 'expired';
  });

// "Expires in 12 days", "Expires today", "Expired 3 days ago" - from the server's day count, so the notice, the
// module and the table all say the same thing.
export const certificationCountdown = (days) => {
  if (days === null || days === undefined || Number.isNaN(Number(days))) return '';
  const value = Number(days);
  if (value === 0) return 'expires today';
  if (value === 1) return 'expires tomorrow';
  if (value > 1) return `expires in ${value} days`;
  if (value === -1) return 'expired yesterday';
  return `expired ${Math.abs(value)} days ago`;
};

// Who to show an icon beside. A module-level registry rather than a prop, and a deliberate exception to how
// everything else in this app is passed around.
//
// The reason is that names are rendered as plain strings in about twenty components (`userLabel(user)`), and the
// request was for the icon to appear "wherever the user's name appears". Threading a map through every one of
// them would be twenty edits that each have to be remembered for the next screen; one map means a name rendered
// anywhere can ask for its icons. The cost is module-level global state, written by App through the setters below
// and read by member id - and it has to be SUBSCRIBED to, because those answers arrive after the first paint. See
// the listeners below: without them this map is correct and changes nothing on screen.
//
// THAT "WRITTEN IN EXACTLY ONE PLACE" IS NO LONGER TRUE, and the comment was left saying so after the shape changed
// underneath it. The index now arrives by two roads, because the screens that draw a FEW names must not pay to read
// one document per member for them:
//
//   - the WHOLE index, on the roster read, for Schedule and Administration, which draw names all over the place;
//   - a TARGETED read for the handful of ids a screen actually draws - see GET_CERTIFICATION_BADGES - for the dashboard
//     (whoever is on duty) and the sidebar (the signed-in member, on every screen).
//
// So there is a MERGE as well as a set. Replacing would be wrong in the one order that matters: the dashboard's two
// badges arriving after the roster's thirty would leave every other member blank.
let badgeIndex = {};

// WHICH MEMBERS THE INDEX HAS AN ANSWER FOR. Needed because `certificationBadgesFor` returns [] for two quite
// different states - "this member holds no badges" and "nobody has asked about this member yet" - and only the
// second is worth another read. Without this the dashboard would re-read on every render of every person on duty.
let badgeKnown = new Set();

// WHO IS LISTENING. Without this the icons cannot appear at all, however correct the read is.
//
// A module-level variable read during render is INVISIBLE to React: nothing tells it the value changed, so the
// name that was drawn with an empty index is never drawn again. That was survivable while the index rode on the
// bootstrap, because it was in hand before the first render. Moving it to its own read is what turned the
// non-issue into the bug: the answer lands after the first paint, and a name already on screen keeps the empty
// index it was rendered with. Every screen is affected, which is why this looked like "the badges are gone
// everywhere" rather than a missing read.
//
// `CertificationBadges` subscribes through React's useSyncExternalStore, so a member's name redraws the moment
// their icons are merged in - including the dashboard and the sidebar, which are the screens whose names were
// already painted when the targeted read resolved.
const listeners = new Set();

// The one array returned for "no badges to draw", shared by both a member who holds none and a member nobody
// has asked about. useSyncExternalStore compares snapshots by identity, so a fresh [] per render would make it
// re-render forever.
const NO_BADGES = Object.freeze([]);

export const subscribeCertificationBadges = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const notifyBadgeListeners = () => {
  listeners.forEach((listener) => listener());
};

export const setCertificationBadges = (index) => {
  badgeIndex = index && typeof index === 'object' ? index : {};
  badgeKnown = new Set(Object.keys(badgeIndex));
  notifyBadgeListeners();
};

// Add to the index rather than replace it. The keys are member ids and the values are whole badge arrays, so a member
// present in `index` is authoritative for that member and a member absent from it keeps what was already known.
export const mergeCertificationBadges = (index) => {
  if (!index || typeof index !== 'object') return;
  let changed = false;
  Object.keys(index).forEach((userId) => {
    // Only a member whose answer actually MOVED counts as a change. A merge that re-delivers the same array must
    // not wake the listeners, or a screen that re-reads on every render would re-render on every read.
    if (badgeIndex[userId] !== index[userId]) changed = true;
    badgeIndex[userId] = index[userId];
    if (!badgeKnown.has(userId)) changed = true;
    badgeKnown.add(userId);
  });
  if (changed) notifyBadgeListeners();
};

export const certificationBadgesFor = (userId) => {
  const key = String(userId === undefined || userId === null ? '' : userId).trim();
  if (!key) return NO_BADGES;
  return badgeIndex[key] || NO_BADGES;
};

// Whether the index has been FILLED for this member - which is not the same as whether they hold anything. This is what
// stops a second read for a member who legitimately has none.
export const certificationBadgesLoaded = (userId) =>
  badgeKnown.has(String(userId === undefined || userId === null ? '' : userId).trim());

// The badge tooltip: which certifications the icons stand for, since two small glyphs beside a name do not say
// much on their own.
export const certificationBadgeTitle = (badges) =>
  badges.map((badge) => badge.name).filter(Boolean).join(' · ');
