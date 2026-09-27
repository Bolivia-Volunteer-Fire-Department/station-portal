// The words and tones for a certification's state, in one place.
//
// Both the member's own module and the administration table show the same four states, and the sign-in notice
// talks about two of them - so the phrasing lives here rather than being written three times and drifting.
//
// The states come from the server (certificationState in Code.gs), never from the client's clock: whether a
// license has expired is not a thing the browser gets an opinion on.
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
