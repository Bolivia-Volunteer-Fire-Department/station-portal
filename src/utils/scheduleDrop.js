// What a drag hovering a slot should do next: hold for the swap, leave the hold it already has, or cancel it.
//
// This exists because deciding it from what the board DRAWS rather than from the rows caused a swap to cancel
// itself the instant it appeared. With the two pills drawn exchanged, the slot under the pointer looks like the
// row being dragged - the hover handler read that as "back over my own shift", cancelled, and the next hover
// re-armed the countdown, so the board swapped and reverted about every second and a half, indefinitely.
//
// So the caller passes the REAL occupant (slotOccupant), never the preview's.
export const planSwapHover = ({
  draggedKey = null,
  entry = null,
  occupant = null,
  slotKey = '',
  dwellSlotKey = '',
  previewSlotKey = '',
} = {}) => {
  if (!draggedKey || !entry) return { action: 'cancel' };
  // Already counted down and already shown for this slot: keep it. Nothing to re-arm - and above all nothing to
  // cancel, which is what the loop above was.
  if (previewSlotKey && previewSlotKey === slotKey) return { action: 'keep' };
  // A free slot, or the row being dragged (its own pill): there is nothing to swap with.
  if (!occupant || occupant._key === entry._key) return { action: 'cancel' };
  // Already counting down for this slot: let the timer be. Restarting it on every dragover - they fire
  // continuously while the pointer sits still - would mean the swap never arrived.
  if (dwellSlotKey && dwellSlotKey === slotKey) return { action: 'keep' };
  return { action: 'hold' };
};

//
// Two members whose shifts are both filled can change places: hold the dragged pill over the other one, and after
// SWAP_DWELL_MS the board shows them exchanged. Letting go there confirms it; moving out before that, or dropping
// anywhere else, puts them back.
//
// The dwell exists because a plain drop onto a filled slot is ambiguous - it might mean "put this member here"
// (leaving the other shift vacant), "swap them", or a slip - and none of those should happen on a gesture nobody
// has been taught. Holding is a second, deliberate signal, and the blinking pill is what makes it discoverable.
// ── Hold-to-swap ─────────────────────────────────────────────────────────────
export const SWAP_DWELL_MS = 1500;

// How long the exchange (and its reversal) is animated for. The stylesheet's swapPop keyframe is the same length;
// the verifier checks the two agree, because a JS timer that outlives its animation leaves a class stuck on.
export const SWAP_POP_MS = 220;

// The fields that say WHERE a row sits. A swap exchanges these and nothing else, so each row keeps its own id, its
// own member, and anything else stored on it: only the two shifts change places.
export const SWAP_SLOT_FIELDS = [
  'schedule_template_id',
  'assignment_id',
  'apparatus_id',
  'date_from',
  'date_to',
  '_from',
  '_to',
];

// [updatedA, updatedB]: each row keeps its own id, its own member and everything else stored on it, and takes the
// OTHER row's position. Written this way round so the first result really is `a` moved - the caller maps them back
// by key, and an inverted return here would silently swap the two rows' identities instead.
export const swapSlotFields = (a, b) => {
  const adopt = (from, to) => {
    const next = { ...to };
    SWAP_SLOT_FIELDS.forEach((field) => {
      next[field] = from[field];
    });
    return next;
  };
  return [adopt(b, a), adopt(a, b)];
};

// Whether these two rows can change places at all. Shared by the dwell (which arms on this) and by the drop
// refusal (whose wording depends on it: offering a swap that cannot happen would be worse than saying nothing).
export const canSwapRows = ({ entry, targetOccupant, targetKind = 'slot', targetDate = '', todayKey = '' } = {}) => {
  if (!entry || !targetOccupant) return false;
  if (entry._key === targetOccupant._key) return false;
  // Only board slots exchange places. A custom shift has no slot for the other row to adopt.
  if (targetKind !== 'slot') return false;
  // An open shift has nobody to change places with: it is filled by a move, and that is what a drop on it does.
  if (String(entry.user_id ?? '').trim() === '') return false;
  if (String(targetOccupant.user_id ?? '').trim() === '') return false;
  // Neither shift can be in the past.
  if (todayKey && entry._to && entry._to < todayKey) return false;
  if (todayKey && targetOccupant._to && targetOccupant._to < todayKey) return false;
  // The target row has to START on the slot it would be swapped out of. A row that merely covers the day (an
  // overnight or multi-day shift) would take its whole span with it, so what was previewed would not be what
  // happened.
  if (!targetOccupant._from || (targetDate && targetOccupant._from !== targetDate)) return false;
  return true;
};

// The verdict for a hold-to-swap: whether the dwell should arm, and why not when it should not.
export const planShiftSwap = ({
  draggedKey = null,
  entry = null,
  targetOccupant = null,
  targetKind = 'slot',
  targetDate = '',
  todayKey = '',
} = {}) => {
  if (!draggedKey || !entry) return refuse('no-source');
  if (canSwapRows({ entry, targetOccupant, targetKind, targetDate, todayKey })) {
    return { action: 'swap', reason: '', displace: null, message: '' };
  }
  if (targetOccupant && targetOccupant._key === entry._key) return refuse('unchanged');
  return refuse('not-swappable');
};


// What happens when an administrator drops a dragged shift pill somewhere — and, when it is refused, what to say
// about it.
//
// This exists because a refused drop used to be SILENT, in several different ways, and they were indistinguishable
// from a broken app:
//
//   1. A slot occupied by an OPEN shift (a row with no member on it) rendered the occupant pill, which carried no
//      drop handler at all. Dropping onto it did nothing, with the cursor implying it should work. This is the one
//      that was reported: an open shift on one particular day refusing pills while every other day accepted them,
//      because every other day had no row at all.
//   2. A day in the past was not a drop target, so nothing happened and nothing was said.
//   3. A shift dragged onto itself re-saved the same dates and marked the board dirty.
//   4. A pill dropped on the empty space of a day, or on a custom shift's pill, did nothing at all.
//
// The verdict is a pure function so that every one of those has a test, and so the wording lives beside the rule
// rather than inside an event handler. See scripts/verify-schedule-drop.mjs.

// The wording. `{name}` is filled in by dropMessage.
export const DROP_MESSAGES = {
  'no-source': 'That drag didn’t register — try dragging the shift again.',
  unchanged: 'That shift is already on that spot.',
  'past-day': 'Past days are locked, so a shift can’t be moved there.',
  'past-shift': 'That shift has already happened, so it can’t be moved.',
  // The one that teaches the newer gesture: a filled slot is where a hold-to-swap happens, not a plain drop.
  occupied: 'That spot already has {name} on it. Hold the shift there for a moment to swap the two shifts.',
  'occupied-no-swap': 'That spot already has {name} on it. Drag their shift elsewhere, or take them off it first.',
  'not-swappable': 'Those two shifts can’t change places.',
  vacancy: 'That spot is an open shift — click it to assign a member.',
  'open-shift-elsewhere':
    'That spot is covered by an open shift that starts on an earlier day — move that shift, or click it to assign a member.',
  'not-a-slot': 'Drop the shift onto one of that day’s shift slots.',
  unknown: 'That spot can’t take this shift.',
};

// Said after a move that changed more than the pill's position. A notice rather than a refusal: the drop was
// accepted, and the member needs to know what went with it before they Save.
export const DROP_NOTICES = {
  vacancyReplaced: 'Shift moved onto the open slot, replacing it. Remember to Save.',
  swapped: 'The two shifts have changed places. Remember to Save.',
};

// Fills a message in. An occupied slot whose occupant cannot be named still reads as a sentence.
export const dropMessage = (reason, { name = '' } = {}) => {
  const template = DROP_MESSAGES[reason] || DROP_MESSAGES.unknown;
  return template.replace('{name}', String(name).trim() || 'a member');
};

const refuse = (reason, context) => ({ action: 'refuse', reason, displace: null, message: dropMessage(reason, context) });
const move = (reason = '', displace = null, message = '') => ({ action: 'move', reason, displace, message });

// The verdict for one drop.
//
//   draggedKey     the entry key the drag registered, or null
//   sourceDate     the date the drag started from, or null
//   entry          the working row the key refers to
//   targetDate     the date key of the day it was dropped on
//   targetKind     'slot' (a template slot on the board), 'pill' (a shift that is not a board slot, i.e. a
//                  custom/manual shift), or 'day' (the empty space of a day cell)
//   targetOccupant the row covering that target, or null for a genuinely free slot
//   targetName     what to call that occupant in the message
//   todayKey       the station's today, for the past-day and past-shift tests
//
// `action: 'move'` means the caller should move the row (it still owns the date arithmetic) and, when `displace`
// names a row, drop that row in the same write. Everything else means say `message` and change nothing.
export const planShiftDrop = ({
  draggedKey = null,
  sourceDate = null,
  entry = null,
  targetDate = '',
  targetKind = 'slot',
  targetOccupant = null,
  targetName = '',
  todayKey = '',
} = {}) => {
  // The drag state did not survive the journey (a dropped drag, a drop from outside the board).
  if (!draggedKey || !entry || !sourceDate) return refuse('no-source');
  if (!targetDate) return refuse('unknown');

  // A pill dropped back onto itself. Checked before anything else about the target, because the answer is about
  // the gesture rather than the destination.
  if (targetOccupant && targetOccupant._key === entry._key) return refuse('unchanged');

  if (todayKey && targetDate < todayKey) return refuse('past-day');
  if (todayKey && entry._to && entry._to < todayKey) return refuse('past-shift');

  // A day's own space is not a shift slot: nothing says which slot the shift would land in.
  if (targetKind === 'day' && !targetOccupant) return refuse('not-a-slot');

  if (targetOccupant) {
    const vacant = String(targetOccupant.user_id ?? '').trim() === '';

    // A shift that is not a board slot (a custom shift, or one whose template has gone) is never replaced: a move
    // onto it has no meaning, because there is no slot for the moved row to adopt - and no swap either, for the
    // same reason.
    if (targetKind !== 'slot') return refuse(vacant ? 'vacancy' : 'occupied-no-swap', { name: targetName });

    if (!vacant) {
      // A filled slot is where a hold-to-swap happens, so the refusal says so - but only when the swap is really
      // possible. Promising a gesture that would do nothing is worse than not mentioning it.
      const swappable = canSwapRows({ entry, targetOccupant, targetKind, targetDate, todayKey });
      return refuse(swappable ? 'occupied' : 'occupied-no-swap', { name: targetName });
    }

    // The open row is only THIS slot's to give away if it starts here. A row that merely covers this day - an
    // overnight shift, or a multi-day one - is somebody else's shift as well, and replacing it would delete the
    // days it starts on. The board draws those later slots as occupied for exactly that reason.
    if (!targetOccupant._from || targetOccupant._from !== targetDate) return refuse('open-shift-elsewhere');

    // An OPEN shift that starts on this slot: the moved entry takes it, and the open row is removed with it. That
    // is lossless, because a template-backed row IS its template, assignment, apparatus, member and dates - and
    // the moved row adopts the target's template, assignment and apparatus, keeping its own member. Leaving the
    // open row behind would put two rows on one slot, and the board would draw whichever it found first.
    return move('vacancy', targetOccupant._key, DROP_NOTICES.vacancyReplaced);
  }

  return move();
};

