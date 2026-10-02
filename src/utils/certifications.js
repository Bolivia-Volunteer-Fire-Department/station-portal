// The words and tones for a certification's state, in one place.
//
// Both the member's own module and the administration table show the same four states, and the sign-in notice
// talks about two of them - so the phrasing lives here rather than being written three times and drifting.
//
// The state itself is derived at READ time, by `certificationStateFor` below: whether a licence has expired is a
// function of the record's two dates, the type's warning window, and today, and it would go stale with nobody
// writing anything if it were stored. "Today" is the STATION's today (America/New_York), computed by
// `stationTodayKey` in utils/scheduleDate.js, so every member's screen agrees regardless of where they are.
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
// them would be twenty edits that each have to be remembered for the next screen; one map, filled once from the
// bootstrap, means a name rendered anywhere can ask for its icons. The cost is that this is set-once global
// state - so it is written in exactly one place (App, from the bootstrap payload) and read through the accessor.
let badgeIndex = {};

export const setCertificationBadges = (index) => {
  badgeIndex = index && typeof index === 'object' ? index : {};
};

export const certificationBadgesFor = (userId) => {
  const key = String(userId === undefined || userId === null ? '' : userId).trim();
  if (!key) return [];
  return badgeIndex[key] || [];
};

// The badge tooltip: which certifications the icons stand for, since two small glyphs beside a name do not say
// much on their own.
export const certificationBadgeTitle = (badges) =>
  badges.map((badge) => badge.name).filter(Boolean).join(' · ');
