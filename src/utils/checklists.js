// Checklists: who has signed each item, and who has verified it.
//
// The server owns the rules - who may sign, who may verify, that a verification needs the member's signature
// first, and that nobody verifies their own checklist. What lives here is the arithmetic the two screens share:
// one item's state, one member's progress, and what a verifier can still act on. Pure and dependency-free, so
// scripts/verify-documents.mjs can drive all of it without a browser.
//
// The vocabulary matters here. A SIGNATURE is the member saying they did the item; a VERIFICATION is somebody
// else confirming it. They are separate rows in the same sheet, told apart by `signature_role`, and almost every
// bug this module could have is those two being confused - so nothing below is called "signed" when it means
// "verified".

import { normalizeChecklistItemList, normalizeSignatureList } from './documents';
import { formatLogTimestamp } from './systemLog';

// One item's state for one member: what they did, and what was confirmed about it.
//
// `verified` counts every verifier's row rather than the current reader's, because "has this been verified" is a
// fact about the checklist, not about who is looking at it. The server's per-item action refuses a repeat from
// the SAME verifier, so two officers can both confirm one item; what the screens show is that it is covered.
export const checklistItemState = (item, signatures, userId) => {
  const wantedItem = String(item && item.id !== undefined ? item.id : item || '').trim();
  const wantedUser = String(userId || '').trim();
  const mine = normalizeSignatureList(signatures).filter(
    (signature) => signature.checklist_item_id === wantedItem && signature.user_id === wantedUser
  );

  const member = mine.find((signature) => signature.signature_role === 'member') || null;
  const verifications = mine.filter((signature) => signature.signature_role === 'verifier');

  return {
    itemId: wantedItem,
    signed: member !== null,
    signedAt: member ? member.signed_at : '',
    // A signature taken before the checklist was edited: the member signed different words.
    stale: member ? member.stale : false,
    verified: verifications.length > 0,
    verifiedAt: verifications.length > 0 ? verifications[0].signed_at : '',
    verifiedByUserId: verifications.length > 0 ? verifications[0].signed_by_user_id : '',
    verificationCount: verifications.length,
  };
};

// Every item's state, in order, for one member.
export const checklistItemStates = (items, signatures, userId) =>
  normalizeChecklistItemList(items).map((item) => ({
    item,
    ...checklistItemState(item, signatures, userId),
  }));

// One member's progress through a checklist. `outstanding` is what they still have to sign - the number the
// module puts on the row - and `awaitingVerification` is what has been signed and not yet confirmed.
export const checklistProgress = (items, signatures, userId) => {
  const states = checklistItemStates(items, signatures, userId);
  const signed = states.filter((state) => state.signed).length;
  const verified = states.filter((state) => state.signed && state.verified).length;

  return {
    total: states.length,
    signed,
    verified,
    outstanding: states.length - signed,
    awaitingVerification: signed - verified,
  };
};

// "3 of 12 items" for a list row or a reader header, or '' when there are no items to count.
export const checklistProgressLabel = (items, signatures, userId) => {
  const progress = checklistProgress(items, signatures, userId);
  if (progress.total === 0) return '';
  return `${progress.signed} of ${progress.total} items`;
};


// Items grouped by their section, in item order, with an unnamed section last.
//
// The unsectioned group is a real group rather than a dropped one: an author who writes 30 items and only
// sections the last three gets their first 27 shown under "Items", not hidden.
export const UNNAMED_SECTION = 'Items';

export const checklistSections = (items) => {
  const groups = [];
  const byName = new Map();

  normalizeChecklistItemList(items).forEach((item) => {
    const name = item.section || UNNAMED_SECTION;
    if (!byName.has(name)) {
      const group = { section: name, items: [] };
      byName.set(name, group);
      groups.push(group);
    }
    byName.get(name).items.push(item);
  });

  return groups
    .filter((group) => group.section !== UNNAMED_SECTION)
    .concat(groups.filter((group) => group.section === UNNAMED_SECTION));
};

// ---------------------------------------------------------------------------
// Saying WHO verified an item
// ---------------------------------------------------------------------------

// "Verified by Jane Doe on Jul 1, 2026 · 14:04" - and simply "Verified" when the row records neither, which is what
// a verification written before the verifier's identity was kept looks like.
//
// The wording lives here rather than in a component because two screens say it - the member's own list of items and
// a verifier looking at somebody else's - and they must not drift into saying it differently. The NAME is supplied
// by the caller: turning a user id into a person's name is one rule (utils/displayLabel) and belongs in one place.
export const checklistVerifiedLabel = (state, verifierName, timeFormat = '12') => {
  const count = Number(state && state.verificationCount) || 0;
  const who = String(verifierName || '').trim();
  const when = state && state.verifiedAt ? formatLogTimestamp(state.verifiedAt, timeFormat) : '';

  // Two officers confirming the same line is two confirmations, not a conflict, so the row says so instead of
  // showing only the first of them.
  const subject = count > 1 ? `Verified by ${count} people` : who ? `Verified by ${who}` : 'Verified';
  return when ? `${subject} on ${when}` : subject;
};


// What one verifier still has to do about one member: the items that member has signed and nobody has confirmed
// yet. An item the member has NOT signed is not in here - there is nothing to confirm about it yet - which is
// the same rule the server applies to a single verification.
export const verificationQueue = (items, signatures, userId) => {
  const states = checklistItemStates(items, signatures, userId);
  const remaining = states.filter((state) => state.signed && !state.verified);

  return {
    total: states.length,
    signed: states.filter((state) => state.signed).length,
    verified: states.filter((state) => state.signed && state.verified).length,
    // The verified states themselves, for the record an administrator opens when somebody asks who checked what
    // and when. Same list as the count above, so the two cannot disagree.
    verifiedItems: states.filter((state) => state.signed && state.verified),
    remaining,
    remainingIds: remaining.map((state) => state.itemId),
  };
};

// The members a verifier has something to do about, busiest first. Members whose checklist is fully verified are
// left out: this is a to-do list, and a name with nothing to confirm is not a task.
//
// The verifier's OWN id is excluded on purpose - the server refuses self-verification, so offering it here would
// be offering a button that always fails.
export const membersAwaitingVerification = (items, signatures, verifierUserId) => {
  const wantedVerifier = String(verifierUserId || '').trim();
  const memberIds = new Set();

  normalizeSignatureList(signatures).forEach((signature) => {
    if (signature.signature_role !== 'member') return;
    if (signature.checklist_item_id === '') return;
    if (signature.user_id === wantedVerifier) return;
    memberIds.add(signature.user_id);
  });

  return [...memberIds]
    .map((userId) => ({ userId, ...verificationQueue(items, signatures, userId) }))
    .filter((entry) => entry.remaining.length > 0)
    .sort((a, b) => b.remaining.length - a.remaining.length || a.userId.localeCompare(b.userId));
};

// Whether a checklist is complete: every item signed, and every signed item verified.
export const checklistIsComplete = (items, signatures, userId) => {
  const progress = checklistProgress(items, signatures, userId);
  return progress.total > 0 && progress.signed === progress.total && progress.verified === progress.total;
};
