// Shared rank-eligibility rules for scheduling.
//
// RANK RULE: a higher numeric `rank_order` means a HIGHER rank, and a member
// can fill shifts for their OWN rank and every LOWER rank. An assignment's
// `rank_order_required` column holds the minimum `rank_order` that may be
// scheduled into it, so a member is eligible iff their own rank's rank_order
// is >= that number. Concretely an Officer (order 3) can fill Firefighter (1),
// Driver (2) and Officer (3) assignments, while a Firefighter (1) cannot fill
// an assignment that requires order 3.
//
// Eligibility is decided purely on rank ORDER - rank ids are never compared.

import { unnamedLabel } from './displayLabel';

export const isTruthyFlag = (value) =>
  value === true || String(value ?? '').trim().toUpperCase() === 'TRUE';

export const parseRankOrder = (value) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
};

// Numeric rank_order for a rank id, or null when it can't be determined.
export const rankOrderOf = (ranks, rankId) => {
  const rank = (Array.isArray(ranks) ? ranks : []).find(
    (r) => String(r.id) === String(rankId)
  );
  return rank ? parseRankOrder(rank.rank_order) : null;
};

// Whether ONE member may be scheduled into ONE assignment: active, not excluded from
// scheduling, and holding a rank at or above the assignment's minimum.
//
// This is the single answer to "shifts this member could fill", shared by the member
// schedule calendar (which lists the open shifts they may offer for) and the
// availability editor (which preloads the slots they may mark). Two copies of the rule
// would let those views disagree about what is offerable.
export const memberCanFillAssignment = ({ member, assignment, ranks } = {}) => {
  if (!member) return false;
  if (isTruthyFlag(member.exclude_from_scheduling)) return false;

  const status = String(member.status ?? '').trim().toLowerCase();
  if (status && status !== 'active') return false;

  const required = parseRankOrder(assignment?.rank_order_required);
  if (required === null) return true; // no minimum -> everyone in the pool qualifies

  const own = rankOrderOf(ranks, member.rank_id);
  return own !== null && own >= required;
};

// Human-readable label for a rank row: "Officer (order 3)".
export const rankLabel = (rank) => {
  if (!rank) return '';
  const order = parseRankOrder(rank.rank_order);
  const description = String(rank.description ?? '').trim() || unnamedLabel('rank');
  return order === null ? description : `${description} (order ${order})`;
};

// Human-readable label for a raw rank_order number, e.g. "Officer (order 3)".
// Falls back to "Order 3" when no rank currently carries that order.
export const rankOrderLabel = (ranks, orderValue) => {
  const order = parseRankOrder(orderValue);
  if (order === null) return '';
  const match = (Array.isArray(ranks) ? ranks : []).find(
    (r) => parseRankOrder(r.rank_order) === order
  );
  return match ? rankLabel(match) : `Order ${order}`;
};

// Distinct minimum-rank choices derived from the `ranks` sheet, highest order
// first. Ranks without a numeric `rank_order` can't define a minimum and are
// excluded from the list.
export const minRankChoices = (ranks) => {
  const byOrder = new Map();
  for (const rank of Array.isArray(ranks) ? ranks : []) {
    const order = parseRankOrder(rank.rank_order);
    if (order === null) continue;
    if (!byOrder.has(order)) byOrder.set(order, { order, label: rankLabel(rank) });
  }
  return [...byOrder.values()].sort((a, b) => b.order - a.order);
};

// Classifies every member for a given assignment using `rank_order_required`.
//
// Buckets:
//   eligible     - active, not excluded, and their rank_order >= required
//   rankBlocked  - active + not excluded but their rank_order is too low
//   unverifiable - active + not excluded but their rank has no usable
//                  rank_order, so it can't be compared against the requirement
//   excluded     - exclude_from_scheduling is TRUE
//   inactive     - status is set to anything other than "active"
export const eligibilityFor = ({ users = [], ranks = [], assignment } = {}) => {
  const list = Array.isArray(users) ? users : [];
  const requiredOrder = parseRankOrder(assignment?.rank_order_required);

  const result = {
    requiredOrder,
    eligible: [],
    rankBlocked: [],
    unverifiable: [],
    excluded: [],
    inactive: [],
  };

  for (const user of list) {
    if (isTruthyFlag(user.exclude_from_scheduling)) {
      result.excluded.push(user);
      continue;
    }

    const status = String(user.status ?? '').trim().toLowerCase();
    if (status && status !== 'active') {
      result.inactive.push(user);
      continue;
    }

    // No minimum rank on the assignment - everyone still in the pool qualifies.
    if (requiredOrder === null) {
      result.eligible.push(user);
      continue;
    }

    const userOrder = rankOrderOf(ranks, user.rank_id);

    // Can't place the member on the ladder at all (no rank assigned, or the
    // rank they hold has no rank_order).
    if (userOrder === null) {
      result.unverifiable.push(user);
      continue;
    }

    // Higher order fills this rank and every lower rank.
    if (userOrder >= requiredOrder) result.eligible.push(user);
    else result.rankBlocked.push(user);
  }

  return result;
};
