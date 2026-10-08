// Availability: the station's windows, and the days each member claimed one.
//
// TWO COLLECTIONS, and the split is what makes this cheap:
//
//   availability_windows/{windowId}          the station's weekly patterns, maintained by an officer
//   availability_months/{userId}_{YYYY-MM}   one member's claims for ONE month
//
// A window is a recurring weekly block of time with a nickname:
//
//   (id, nickname, start_time, end_time, is_sunday..is_saturday, effective_date, end_date)
//
// THE WEEKDAY FLAG IS THE DAY THE WINDOW STARTS. `is_tuesday` with 18:00-08:00 describes a Tuesday night: the shift
// begins on Tuesday and runs into Wednesday morning, so its pill belongs to Tuesday - and the flags are the only thing
// that decides which days a window appears on.
//
// EFFECTIVE AND END DATES ARE THE CONFIGURATION'S LIFE, NOT AN OCCURRENCE. A department that changes its shift
// structure ends the old windows on the last day they applied - keeping them, because claims reference them and the
// history should still read - and adds new ones with an effective date. Both ends are inclusive; a blank end means
// "still current".
//
// WHY ONE DOCUMENT PER MEMBER PER MONTH. A claim is a tiny fact ("this member could work this window on this day"), and
// one row per claim means a month view for a station of 30 reads ~240 documents. Every question either screen asks is
// scoped to a month - "who can cover this window in March", "what did I claim in March" - so a document per member per
// month is the coarsest unit that answers all of them: the same view costs ~30 reads, a member's own sign-in carries a
// couple of documents instead of a range of rows, and a SAVE is one write with no add/remove/delete bookkeeping at all.
// Firestore bills per document, so the coarser shape is the cheaper one.
//
// The document id carries the owner (`u2_2026-09`), which is what lets a rule prove who may read it - the same
// convention as `on_duty/{memberId}` - and a `month` field lets an officer query one month for the whole crew.
//
// Everything here is pure, so the derivation can be verified without React or Firestore - see
// scripts/verify-availability-slots.mjs.

import { toDateKey, parseSheetDateKey } from './scheduleDate.js';
import { DAY_ORDER } from './calendarConstants.js';
import { unnamedLabel } from './displayLabel.js';
import { timeToMinutes } from './shiftTime.js';
// The one definition of "may set their own availability", shared with the module's own gate in App (and with the
// rules, which read the same role flag). Nothing here may invent a second reading of that permission.
import { permissionGranted } from './permissions.js';

// The key one claim is identified by: the window AND the day. Two members can claim the same window on the same day, and
// one member can claim the same window on two days.
export const availabilityKey = (windowId, dateKey) =>
  `${String(windowId ?? '').trim()}|${String(dateKey ?? '').trim()}`;

const windowIdOf = (row) => String(row?.availability_window_id ?? '').trim();

const rowDayOf = (row) => parseSheetDateKey(row?.date_from);

// One member's claims, as rows. THE SCREENS STILL WORK IN ROWS even though the store is month documents: the month
// shape is flattened once, at the edge, so every derivation below has one shape to reason about.
export const availabilityRowsFor = (availability, userId) => {
  const wanted = String(userId ?? '').trim();
  if (!wanted) return [];
  return (Array.isArray(availability) ? availability : []).filter(
    (row) => String(row?.user_id ?? '').trim() === wanted
  );
};

// ---------------------------------------------------------------------------------------------------------------
// the month documents: the id, the month key, and the two directions between documents and rows.

const pad = (value) => String(value).padStart(2, '0');

// '2026-09-01' -> '2026-09'. A blank or unreadable key gives '', which every caller treats as "no month".
export const monthKeyOf = (dateKey) => {
  const day = parseSheetDateKey(dateKey);
  if (!day) return '';
  return day.slice(0, 7);
};

// Every month key from one date to another, inclusive: what a range of screens can hold.
export const monthKeysBetween = (fromDateKey, toDateKey_) => {
  const from = monthKeyOf(fromDateKey);
  const to = monthKeyOf(toDateKey_);
  if (!from || !to || from > to) return [];
  const keys = [];
  let [year, month] = from.split('-').map(Number);
  const [endYear, endMonth] = to.split('-').map(Number);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    keys.push(`${year}-${pad(month)}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return keys;
};

// The document id for one member's month. The owner is in the id so a rule can prove who may read it.
export const availabilityMonthId = (userId, monthKey) =>
  `${String(userId ?? '').trim()}_${String(monthKey ?? '').trim()}`;

// Month documents -> the rows every screen derives from. The row id is `window|day`: stable, readable, and the same key
// the grid describes a cell with - so nothing has to carry a database id around to know what it is looking at.
export const claimRowsFromMonths = (months) => {
  const rows = [];
  for (const doc of Array.isArray(months) ? months : []) {
    if (!doc) continue;
    const userId = String(doc.user_id ?? '').trim();
    const claims = doc.claims && typeof doc.claims === 'object' ? doc.claims : {};
    for (const [windowId, days] of Object.entries(claims)) {
      for (const day of Array.isArray(days) ? days : []) {
        const dateKey = parseSheetDateKey(day);
        if (!userId || !windowId || !dateKey) continue;
        rows.push({
          id: availabilityKey(windowId, dateKey),
          user_id: userId,
          availability_window_id: String(windowId).trim(),
          date_from: dateKey,
        });
      }
    }
  }
  return rows;
};

// The `window|day` keys a grid holds -> one month's claims map, which is what gets written. Sorted, so the same marks
// always produce the same document and a diff of two saves stays readable.
export const claimsMapFromKeys = (keys) => {
  const claims = {};
  for (const key of keys instanceof Set ? keys : new Set(Array.isArray(keys) ? keys : [])) {
    const [windowId, dateKey] = String(key).split('|');
    if (!windowId || !dateKey) continue;
    if (!claims[windowId]) claims[windowId] = [];
    if (!claims[windowId].includes(dateKey)) claims[windowId].push(dateKey);
  }
  for (const key of Object.keys(claims)) claims[key].sort();
  return claims;
};

// "Which member claimed SOMETHING on this day", as `user|day` keys. That is the question the schedule board asks when
// it warns an officer about filling a shift with somebody who said nothing (see AdminScheduleManagementTab).
export const memberDayKeys = (rows) => {
  const keys = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const userId = String(row?.user_id ?? '').trim();
    const dateKey = rowDayOf(row);
    if (userId && dateKey) keys.add(`${userId}|${dateKey}`);
  }
  return keys;
};

// ---------------------------------------------------------------------------------------------------------------
// windows: when a pattern applies, and which days it falls on.

const windowDay = (value) => parseSheetDateKey(value);

const flagOn = (value) => value === true || String(value ?? '').trim().toUpperCase() === 'TRUE';

const weekdayOf = (dateKey) => DAY_ORDER[new Date(`${dateKey}T12:00:00`).getDay()];

// Whether a window's configuration is in force on a date: effective <= day <= end, either end optional.
export const windowIsLiveOn = (window, dateKey) => {
  const day = String(dateKey ?? '').trim();
  if (!day) return false;
  const from = windowDay(window?.effective_date);
  const to = windowDay(window?.end_date);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
};

// Whether a window falls on a date: in force, and flagged for that date's weekday. This IS the pill rule - a Tuesday
// night shows on Tuesdays, and the Wednesday morning it ends on is not its day.
export const windowCoversDate = (window, dateKey) => {
  const day = windowDay(dateKey);
  if (!day) return false;
  if (!windowIsLiveOn(window, day)) return false;
  return flagOn(window?.[`is_${weekdayOf(day)}`]);
};

// The windows that fall on one date, in start-time order: what a day's cell lists.
export const windowsOnDate = (windows, dateKey) =>
  (Array.isArray(windows) ? windows : [])
    .filter((window) => windowCoversDate(window, dateKey))
    .sort((a, b) => {
      const aMin = timeToMinutes(a?.start_time);
      const bMin = timeToMinutes(b?.start_time);
      const aKey = aMin === null ? Number.MAX_SAFE_INTEGER : aMin;
      const bKey = bMin === null ? Number.MAX_SAFE_INTEGER : bMin;
      if (aKey !== bKey) return aKey - bKey;
      return String(a?.nickname ?? '').localeCompare(String(b?.nickname ?? ''));
    });

// One member's claims, as the set of `window|day` keys a grid diffs against.
export const claimedKeysFor = (availability, userId) =>
  new Set(
    availabilityRowsFor(availability, userId)
      .map((row) => availabilityKey(windowIdOf(row), rowDayOf(row)))
      .filter((key) => key !== '|')
  );

// Whether one member has claimed one window on one date.
export const isAvailableForWindow = (availability, userId, windowId, dateKey) => {
  const key = availabilityKey(windowId, dateKey);
  return key !== '|' && claimedKeysFor(availability, userId).has(key);
};

// The members who claimed one window on one date, in name order. A row pointing at a member missing from `users` still
// appears, labeled by id: silently dropping someone the data says is available would be worse than showing an id.
export const availableMembersForWindow = (availability, windowId, dateKey, users = []) => {
  const wanted = availabilityKey(windowId, dateKey);
  if (wanted === '|') return [];
  const seen = new Set();
  const members = [];
  for (const row of Array.isArray(availability) ? availability : []) {
    if (availabilityKey(windowIdOf(row), rowDayOf(row)) !== wanted) continue;
    const userId = String(row?.user_id ?? '').trim();
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    const user = (Array.isArray(users) ? users : []).find((u) => String(u?.id ?? '').trim() === userId);
    members.push({
      id: userId,
      name: String(user?.name ?? '').trim() || unnamedLabel('member'),
      rank_id: String(user?.rank_id ?? '').trim(),
    });
  }
  return members.sort((a, b) => a.name.localeCompare(b.name));
};

// ---------------------------------------------------------------------------------------------------------------
// the month's SHAPE, for the two things that ask about the whole month rather than one day: whether its claims
// have been read at all, and who claimed nothing in it.

// Whether the claims for a month have actually been read. The read is a RANGE (the roster holds whatever months
// have been asked for), so a month is covered when it sits inside that range. Either end may be blank - a blank
// end means "not known", which reads as covered and the roster says so itself when it is not.
export const monthAvailabilityLoaded = (loadedFrom, loadedTo, year, month) => {
  if (!Number.isInteger(year) || !Number.isInteger(month)) return false;
  const monthStart = toDateKey(new Date(year, month, 1));
  const monthEnd = toDateKey(new Date(year, month + 1, 0));
  return (!loadedFrom || monthStart >= loadedFrom) && (!loadedTo || monthEnd <= loadedTo);
};

// Whether a member's own Availability module is open to them: their role, found by id, granting the permission the
// module is gated on. A role that cannot be found comes back false - which is what permissionGranted(undefined, ...)
// says, and what the member's own screen says too, because the module would not be there for them either.
const memberCanSetAvailability = (user, roles) => {
  const roleId = String(user?.role_id ?? '').trim();
  const role = (Array.isArray(roles) ? roles : []).find(
    (candidate) => String(candidate?.id ?? '').trim() === roleId
  );
  return permissionGranted(role, 'can_edit_own_availability');
};

// The members who claimed NOTHING in a month - the list an officer works from when they are chasing people before
// the month closes. The rows are scoped to the month HERE rather than by the caller, because the roster holds
// whatever range has been read and a claim in another month must not count as a claim in this one.
//
// An unread month makes every member look unclaimed, which is why the caller pairs this with monthAvailabilityLoaded
// and says so rather than printing the whole crew.
//
// ONLY THE MEMBERS WHO COULD FILL IT IN. A role without "Set their own availability" cannot open the module, so that
// member has no way to claim anything - and listing them is not a chase, it is a permanent entry on a list of people to
// chase, sitting there every month. So the list is the members whose role GRANTS the permission, and the check is the
// SAME one the module itself is gated on (App's canEditOwnAvailability, from permissionGranted) rather than a second
// reading of the role: whoever is missing here is somebody whose own screen offers them nothing to do.
export const membersWithNoAvailability = ({ users = [], availability = [], roles = [], year, month } = {}) => {
  if (!Number.isInteger(year) || !Number.isInteger(month)) return [];
  const monthStart = toDateKey(new Date(year, month, 1));
  const monthEnd = toDateKey(new Date(year, month + 1, 0));

  const claimed = new Set();
  for (const row of Array.isArray(availability) ? availability : []) {
    const dateKey = rowDayOf(row);
    if (!dateKey || dateKey < monthStart || dateKey > monthEnd) continue;
    const userId = String(row?.user_id ?? '').trim();
    if (userId) claimed.add(userId);
  }

  return (Array.isArray(users) ? users : [])
    .filter((user) => {
      const id = String(user?.id ?? '').trim();
      return id && !claimed.has(id) && memberCanSetAvailability(user, roles);
    })
    .map((user) => ({
      id: String(user.id).trim(),
      name: String(user?.name ?? '').trim() || unnamedLabel('member'),
      rank_id: String(user?.rank_id ?? '').trim(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

// Every day of a month with at least one window, and - when `availability` is given - who claimed each one. ONE
// derivation for the member's grid and the administration's roster, so the two cannot disagree about which windows fall
// on a day.
export const windowDaysForMonth = ({ year, month, windows = [], availability = [], users = [] } = {}) => {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = toDateKey(new Date(year, month, day));
    const found = windowsOnDate(windows, dateKey);
    if (!found.length) continue;
    days.push({
      dateKey,
      windows: found.map((window) => ({
        ...window,
        id: String(window?.id ?? '').trim(),
        key: availabilityKey(window?.id, dateKey),
        claimed: availableMembersForWindow(availability, window?.id, dateKey, users),
      })),
    });
  }
  return days;
};
