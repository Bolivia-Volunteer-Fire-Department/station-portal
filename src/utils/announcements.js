// Announcements: who sees one, where, and whether it is in force.
//
// Pure functions, so the whole audience and date rule can be tested without a backend, a browser or a
// clock. The backend mirrors this logic for the push audience; the shapes it reads are the sheet's
// columns, normalized to text the same way everywhere else in the app.

import { parseSheetDateKey, toDateKey } from './scheduleDate';

// The three places an announcement can appear, in the order the form lists them.
export const ANNOUNCEMENT_LOCATIONS = [
  { key: 'is_visible_on_login', label: 'Login screen', hint: 'Below "Please login to continue".' },
  { key: 'is_visible_on_dashboard', label: 'Timeclock dashboard', hint: 'Above the clock, below the welcome.' },
  { key: 'is_visible_on_sidebar', label: 'Sidebar', hint: 'Below the name card, above the menu.' },
];

// An announcement with no icon shows an exclamation triangle rather than nothing: the box is a warning
// until it says otherwise, and a bare callout reads as a layout bug.
export const ANNOUNCEMENT_ICON_FALLBACK = 'triangle-alert';

// Color variants, matching the help guides' callouts (components/Markdown.jsx) so a Caution announcement
// looks like a Caution alert in a guide. `info` is the default because it promises nothing.
export const ANNOUNCEMENT_VARIANTS = {
  info: {
    label: 'Info',
    box: 'border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-900/50',
    head: 'text-slate-600 dark:text-slate-300',
  },
  tip: {
    label: 'Tip',
    box: 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/40',
    head: 'text-emerald-700 dark:text-emerald-400',
  },
  important: {
    label: 'Important',
    box: 'border-violet-300 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/40',
    head: 'text-violet-700 dark:text-violet-400',
  },
  warning: {
    label: 'Warning',
    box: 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40',
    head: 'text-amber-700 dark:text-amber-400',
  },
  caution: {
    label: 'Caution',
    box: 'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-950/40',
    head: 'text-red-700 dark:text-red-400',
  },
};

export const ANNOUNCEMENT_VARIANT_KEYS = Object.keys(ANNOUNCEMENT_VARIANTS);

// Unknown or blank variants fall back to Info rather than rendering an unstyled box.
export const announcementVariant = (value) => {
  const key = String(value ?? '').trim().toLowerCase();
  return ANNOUNCEMENT_VARIANTS[key] || ANNOUNCEMENT_VARIANTS.info;
};

// Sheet booleans, in every form the sheet can hold them.
export const announcementFlag = (value) =>
  value === true || String(value ?? '').trim().toUpperCase() === 'TRUE';

const text = (value) => String(value ?? '').trim();

// The locations an announcement is flagged for.
export const announcementLocations = (announcement) =>
  ANNOUNCEMENT_LOCATIONS.filter((place) => announcementFlag(announcement?.[place.key])).map((place) => place.key);

export const announcementShowsIn = (announcement, locationKey) =>
  announcementLocations(announcement).indexOf(locationKey) !== -1;

// The window, with a blank end meaning "indefinitely".
export const announcementDateWindow = (announcement) => ({
  from: parseSheetDateKey(announcement?.effective_date) || '',
  to: parseSheetDateKey(announcement?.end_date) || '',
});

// Whether an announcement is in force on a date. Both ends inclusive.
//
// A blank effective date reads as in force rather than as "never": the form requires one, so a blank only
// appears on a row edited by hand, and dropping it silently would hide the announcement with no clue why.
// (Same rule as template and assignment dates - required on save, tolerant on read.)
export const announcementIsLiveOn = (announcement, dateKey) => {
  const key = text(dateKey);
  if (!key) return true;
  const { from, to } = announcementDateWindow(announcement);
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
};

// Who an announcement is aimed at.
export const announcementAudience = (announcement) => ({
  roleId: text(announcement?.role_id),
  rankId: text(announcement?.rank_id),
  userId: text(announcement?.user_id),
});

// No targeting at all means everyone, which is also the only audience the login screen can resolve.
export const announcementTargetsEveryone = (announcement) => {
  const { roleId, rankId, userId } = announcementAudience(announcement);
  return !roleId && !rankId && !userId;
};

// Whether an announcement is aimed at this reader. Each column is optional and they are ANDed, so an
// announcement for "Firefighters on A shift" is one row with both columns filled. A blank column does not
// restrict, and a reader with no role/rank of their own simply cannot match a filled one.
export const announcementMatchesAudience = (announcement, { roleId = '', rankId = '', userId = '' } = {}) => {
  const target = announcementAudience(announcement);
  if (target.roleId && target.roleId !== text(roleId)) return false;
  if (target.rankId && target.rankId !== text(rankId)) return false;
  if (target.userId && target.userId !== text(userId)) return false;
  return true;
};

// The announcements to show in one place, newest first.
//
// `dismissedIds` is the set of ids the reader has dismissed; only announcements flagged dismissable can be
// in it, so a non-dismissable one reappears however it got there.
export const visibleAnnouncementsFor = ({
  announcements = [],
  location,
  audience = {},
  dateKey = toDateKey(new Date()),
  dismissedIds = [],
  includeEveryoneOnly = false,
} = {}) => {
  const dismissed = new Set((Array.isArray(dismissedIds) ? dismissedIds : []).map((id) => text(id)));

  return (Array.isArray(announcements) ? announcements : [])
    .filter((announcement) => announcement)
    .filter((announcement) => announcementShowsIn(announcement, location))
    .filter((announcement) => announcementIsLiveOn(announcement, dateKey))
    .filter((announcement) => announcementMatchesAudience(announcement, audience))
    // The login screen has no reader, so it may only show announcements aimed at everyone: a message
    // targeted at a role or a person must not be readable by whoever is standing at the keyboard.
    .filter((announcement) => !includeEveryoneOnly || announcementTargetsEveryone(announcement))
    .filter((announcement) => !(announcementFlag(announcement.is_dismissable) && dismissed.has(text(announcement.id))))
    .sort((a, b) => {
      const aFrom = announcementDateWindow(a).from;
      const bFrom = announcementDateWindow(b).from;
      if (aFrom !== bFrom) return aFrom < bFrom ? 1 : -1; // newest effective date first
      return text(b?.id).localeCompare(text(a?.id)); // then newest id, so a fresh one leads
    });
};

// A short description of who an announcement is for, for the administrator's list.
export const announcementAudienceLabel = (announcement, { roles = [], ranks = [], users = [] } = {}) => {
  const { roleId, rankId, userId } = announcementAudience(announcement);
  const parts = [];
  const nameOf = (list, id, key) => {
    const found = (Array.isArray(list) ? list : []).find((row) => String(row?.id) === String(id));
    return found ? text(found[key]) || `#${id}` : `#${id}`;
  };
  if (userId) parts.push(`Only ${nameOf(users, userId, 'name')}`);
  if (roleId) parts.push(`${parts.length ? 'and only ' : ''}${nameOf(roles, roleId, 'description')} role`);
  if (rankId) parts.push(`${parts.length ? 'and only ' : ''}${nameOf(ranks, rankId, 'description')} rank`);
  return parts.length ? parts.join(', ') : 'Everyone';
};

// Whether a set of targeting choices reaches anybody at all, and the message to explain it if not.
//
// The backend refuses a save that reaches nobody; this is the same rule so the form can say so before a
// round trip. It is given the directory rather than reading one, so it is testable.
// Who created the announcement, for the administrator's list only.
//
// author_user_id is stamped from the session on create and never sent by the client afterwards, so it
// cannot be forged or changed - which is what makes it worth showing. A blank value means the row
// predates the column, or was added by hand in the sheet: it yields '' rather than a dangling "#".
//
// Deliberately NOT rendered anywhere a member can see: the member-facing callouts show the message and
// nothing about who wrote it.
export const announcementAuthorLabel = (announcement, users = []) => {
  const authorId = text(announcement && announcement.author_user_id);
  if (!authorId) return '';
  const found = (Array.isArray(users) ? users : []).find((row) => String(row?.id) === authorId);
  const name = found ? text(found.name) : '';
  return `Created by ${name || `Member #${authorId}`}`;
};

export const announcementReachesSomeone = ({ roleId = '', rankId = '', userId = '' } = {}, users = []) => {
  const role = text(roleId);
  const rank = text(rankId);
  const user = text(userId);
  // No targeting at all reaches everybody, so there is nothing to check.
  if (!role && !rank && !user) return true;

  return (Array.isArray(users) ? users : []).some((member) => {
    if (user && String(member?.id) !== user) return false;
    if (role && text(member?.role_id) !== role) return false;
    if (rank && text(member?.rank_id) !== rank) return false;
    return true;
  });
};

// Whether a set of form values may be saved. Returns '' when valid, otherwise the reason - the same
// wording the backend uses, so the two cannot disagree about what is required.
export const announcementValidation = (values = {}) => {
  if (!text(values.title)) return 'A title is required.';
  if (!text(values.message)) return 'A message is required.';
  if (!text(values.effective_date)) return 'An effective date is required.';
  if (!parseSheetDateKey(values.effective_date)) return 'The effective date is not a readable date.';

  const end = text(values.end_date);
  if (end && !parseSheetDateKey(end)) return 'The end date is not a readable date.';
  if (end && parseSheetDateKey(end) < parseSheetDateKey(values.effective_date)) {
    return 'The end date must not be before the effective date.';
  }

  const locations = ANNOUNCEMENT_LOCATIONS.filter((place) => announcementFlag(values[place.key]));
  if (!locations.length) return 'Choose at least one place to show the announcement.';

  return '';
};

// The dismissal key for one reader and one announcement.
//
// Dismissals are stored per device in localStorage, so a member who dismisses on their phone still sees it
// on the station terminal. Cross-device dismissal would need a column of its own; this is the honest
// trade-off and it is documented in the guide.
export const announcementDismissalKey = (userId, announcementId) =>
  `sp_announcement_dismissed_${text(userId) || 'anon'}_${text(announcementId)}`;
