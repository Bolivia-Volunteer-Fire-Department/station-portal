// HOW OLD WHAT YOU ARE LOOKING AT IS, and when it is worth going back for more.
//
// WHY THIS IS A MODULE RATHER THAN A LINE IN A COMPONENT. Two judgements are in here, and both are the kind that get made
// wrongly in a screen and then argued about: how long the app is willing to call data current, and how long a member has to be
// away before coming back is worth a read. Neither needs React, a clock or a network to answer - `nowMs` is passed in - so
// scripts/verify-freshness.mjs asks them directly.
//
// THE PROBLEM THIS EXISTS FOR: a member had the schedule open, somebody else changed it, and nothing told them. They found out
// by refreshing the whole app. The fix is two-sided, and this is the client's half: a tiny document the server bumps whenever
// the schedule changes (see functions/index.js#onShiftWritten) tells a screen that its window is stale, and coming back to the
// tab after a while is treated as a reason to look again.
//
// WHAT IT DELIBERATELY IS NOT: a poll. Nothing here runs on a timer. A bump costs one read; a return to the tab costs one read;
// a member who is reading and not touching anything costs nothing at all.
export const FRESHNESS_STALE_MS = 5 * 60 * 1000;

// HOW LONG A MEMBER HAS TO BE AWAY before coming back is worth a re-read. Two minutes, because a glance at another tab and back
// is the common case and reading the schedule again for it would be a read per flick - while a phone call, a job, or a
// lunch break is exactly when somebody else has moved a shift.
export const RETURN_REFRESH_MIN_HIDDEN_MS = 2 * 60 * 1000;

// THE SENTINEL'S PATH, which is also written down in functions/index.js (a function cannot require this module, and this module
// must not import the Admin SDK). scripts/verify-freshness.mjs asserts the two agree, because a server bumping one document
// while clients watch another is a sentinel that never fires - a failure with no symptom whatsoever.
export const SCHEDULE_SENTINEL_PATH = 'live/schedule';

// WHAT A SCREEN SAYS ABOUT ITS OWN DATA. `atMs` is when the last successful read landed; 0 means nothing has been read yet,
// which says nothing rather than claiming to be current.
//
// ONE MINUTE IS "JUST NOW", and that is a judgement rather than a rounding: a label that counts seconds draws attention to
// itself and changes every time the member looks, while "Updated just now" is true for as long as it takes to read a shift.
export const freshnessLabelFor = ({ atMs = 0, nowMs = Date.now() } = {}) => {
  const at = Number(atMs) || 0;
  if (!at) return '';
  const age = Math.max(0, Number(nowMs) - at);
  if (age < 60 * 1000) return 'Updated just now';
  const minutes = Math.floor(age / (60 * 1000));
  if (minutes < 60) return `Updated ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `Updated ${days} day${days === 1 ? '' : 's'} ago`;
};

// WHETHER WHAT IS ON SCREEN IS OLD ENOUGH TO SAY SO. The label is offered either way - a member is entitled to know how old
// something is - but this is what turns it from a note into a prompt.
export const isStale = ({ atMs = 0, nowMs = Date.now(), stale = FRESHNESS_STALE_MS } = {}) => {
  const at = Number(atMs) || 0;
  if (!at) return true;
  return Number(nowMs) - at >= stale;
};

// WHETHER COMING BACK TO THE TAB IS WORTH A READ. Both halves are needed, and each rules out a pointless read on its own:
//
//   * A QUICK FLICK of tabs does not refresh, however old the data is - the member did not stop looking at it.
//   * A LONG ABSENCE with data that is still fresh does not either - nothing has had time to change.
//
// Together they cover the case that actually happened: away long enough for somebody else to have edited the schedule, and
// looking at data old enough to be worth re-reading.
export const shouldRefreshOnReturn = ({
  hiddenMs = 0,
  atMs = 0,
  nowMs = Date.now(),
  minHidden = RETURN_REFRESH_MIN_HIDDEN_MS,
  stale = FRESHNESS_STALE_MS,
} = {}) => Number(hiddenMs) >= minHidden && isStale({ atMs, nowMs, stale });

// WHETHER A SENTINEL SAYS SOMETHING HAS CHANGED SINCE THIS SCREEN LAST READ. The version is a count, so "different" is the whole
// question.
//
// `seen` IS WHAT THE SCREEN LAST ACTED ON, and it starts as null rather than 0 - because the sentinel does not exist until the
// first schedule write, so its version begins at 0. Treating 0 as "a version I have seen" would swallow the first real bump:
// the document would go 0 -> 1 and the screen, believing it had already read version 0, would see a change it had no reason to
// act on and ignore it. Null says what is true - this screen has never looked - and the first look is its own read, not a bump.
export const sentinelChanged = ({ version = 0, seen = null } = {}) => seen !== null && Number(version) !== Number(seen);