// Ordering for the people (and open shifts) drawn on one day of a schedule.
//
// The day's pills used to break ties on the member's NAME, which put a crew in
// alphabetical order. They now break ties on the RANK ORDER OF THE ASSIGNMENT the
// shift belongs to (its `rank_order_required`), highest first. So a day at 08:00
// reads in the order the shifts are configured - Officer above Driver above
// Firefighter - regardless of who happens to be filling them, and a senior member
// covering a junior slot keeps that slot where the shift sits in the list.
//
// This is deliberately the SHIFT's rank and not the MEMBER's: the row describes a
// shift, and its position stays put when the member filling it changes.
//
// Order applied:
//   1. start time               (shifts with no time sort last)
//   2. filled before open       (an open shift has no member to show)
//   3. highest required rank    (shifts with no requirement sort last)
//   4. name                     (alphabetical, so the order is always deterministic)
//
// Callers attach `requiredRankOrder` to each pill; `null` means "no requirement
// known", which is not the same as rank order 0 - a real 0 outranks an unknown.
//
// Kept dependency-free so it can be exercised without React - see
// scripts/verify-crew-order.mjs.

const MISSING = Number.MAX_SAFE_INTEGER;

// A pill's start minute, or MISSING when it has no usable time. Note that
// Number(null) is 0, so null/'' have to be rejected explicitly or a shift with
// no time would silently sort as midnight.
const startMinuteOf = (pill) => {
  const raw = pill?.startMin;
  if (raw === null || raw === undefined || raw === '') return MISSING;
  const value = Number(raw);
  return Number.isFinite(value) ? value : MISSING;
};

// The shift's required rank order, or null when the assignment doesn't set one.
// 0 is a valid order (the lowest).
const requiredRankOf = (pill) => {
  const raw = pill?.requiredRankOrder;
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

export const compareCrewOrder = (a, b) => {
  const byStart = startMinuteOf(a) - startMinuteOf(b);
  if (byStart !== 0) return byStart;

  const aOpen = Boolean(a?.isOpen);
  const bOpen = Boolean(b?.isOpen);
  if (aOpen !== bOpen) return aOpen ? 1 : -1;

  const aRank = requiredRankOf(a);
  const bRank = requiredRankOf(b);
  if (aRank !== bRank) {
    if (aRank === null) return 1; // no requirement known -> after the ranked ones
    if (bRank === null) return -1;
    return bRank - aRank; // highest required rank first
  }

  return String(a?.name ?? '').localeCompare(String(b?.name ?? ''));
};

// Non-mutating convenience wrapper, so callers never sort a shared array.
export const sortCrewOrder = (pills) => (Array.isArray(pills) ? pills.slice().sort(compareCrewOrder) : []);
