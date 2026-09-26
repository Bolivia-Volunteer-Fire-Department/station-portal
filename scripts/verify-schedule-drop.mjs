/**
 * Verifies the schedule board's drag-and-drop verdicts.
 *
 * This exists because of a bug that was invisible by construction: a slot holding an OPEN shift (a row with no
 * member) rendered a pill that carried no drop handler, so dropping a shift onto it did nothing and said nothing,
 * while every genuinely empty slot beside it accepted drops normally. From the outside that reads as "drag and
 * drop is broken on this one day" - and there was no way to tell it apart from a broken app.
 *
 * So both halves are tested: the DECISION, as a pure function with a case per refusal, and the WIRING, which is
 * that both kinds of target route their drop through it and that a refusal is spoken out loud.
 *
 * Run with: npm run verify:schedule-drop
 */
import { readFileSync } from 'node:fs';
import { planShiftDrop, planShiftSwap, planSwapHover, swapSlotFields, dropMessage, DROP_MESSAGES, DROP_NOTICES, SWAP_DWELL_MS, SWAP_POP_MS, SWAP_SLOT_FIELDS } from '../src/utils/scheduleDrop.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`
  );
};
const checkIs = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` -> ${detail}`}`);
};

const board = readFileSync('src/components/admin/AdminScheduleManagementTab.jsx', 'utf8');

// A row on the board. `_from`/`_to` are the client's own date keys for the entry's window, and the sheet-facing
// `date_from`/`date_to` mirror them - as normalizeRows sets them, and as a real row always has them. Deriving
// one from the other here stops a fixture from describing a row the app could never produce.
const row = (over = {}) => {
  const merged = {
    _key: 'db-1',
    _from: '2026-03-10',
    _to: '2026-03-10',
    schedule_template_id: 't1',
    assignment_id: 'a1',
    user_id: 'u1',
    ...over,
  };
  return { ...merged, date_from: over.date_from ?? merged._from, date_to: over.date_to ?? merged._to };
};
const freeSlot = { dateKey: '2026-03-17', template: { id: 't1' } };
const TODAY = '2026-03-05';

const drop = (over = {}) =>
  planShiftDrop({
    draggedKey: 'db-1',
    sourceDate: '2026-03-10',
    entry: row(),
    targetDate: freeSlot.dateKey,
    targetOccupant: null,
    targetName: '',
    todayKey: TODAY,
    ...over,
  });

// ---------------------------------------------------------------------------
// 1. The ordinary drop still moves
// ---------------------------------------------------------------------------
console.log('\n--- a drop that works ---');
check('onto a free slot it moves', drop().action, 'move');
check('and carries no message, because nothing needs saying', drop().message, '');
// A drop onto a slot holding the SAME row is not a move: it used to re-save the same dates and mark the board
// dirty, which reads as "nothing happened, but I now have unsaved changes".
check('onto its own spot it refuses', drop({ targetOccupant: row() }).action, 'refuse');
check('and says the shift is already there', drop({ targetOccupant: row() }).reason, 'unchanged');

// ---------------------------------------------------------------------------
// 2. The bug: an OPEN shift in a template slot now takes the shift
// ---------------------------------------------------------------------------
console.log('\n--- an open shift (a vacancy row in a board slot) ---');
// A vacancy row on its own slot: it starts on the day it is drawn on, which is what makes it that slot's to give
// away. (A row that only COVERS the day is refused - see below.)
const vacancyOnSlot = { _key: 'db-9', user_id: '', _from: '2026-03-17', _to: '2026-03-17' };
const ontoVacancy = drop({ targetOccupant: row(vacancyOnSlot), targetName: 'Open', targetKind: 'slot' });
check('dropping onto an open shift is accepted, not ignored', ontoVacancy.action, 'move');
check('and is reported as the vacancy case', ontoVacancy.reason, 'vacancy');
check('the open row it replaces is named, so the caller can drop it', ontoVacancy.displace, 'db-9');
checkIs('and the notice says what happened to it', /replacing it/.test(ontoVacancy.message), ontoVacancy.message);
checkIs('including the reminder to save', /Remember to Save/.test(ontoVacancy.message), ontoVacancy.message);

// A vacancy is recognised however the row was typed: whitespace-only is still nobody.
check('a whitespace-only member is a vacancy too', drop({ targetOccupant: row({ ...vacancyOnSlot, user_id: '   ' }) }).reason, 'vacancy');
check('a null member likewise', drop({ targetOccupant: row({ ...vacancyOnSlot, user_id: null }) }).reason, 'vacancy');

// An overnight or multi-day open shift COVERS the later slots it spans, so the board draws it as their occupant.
// Replacing it would delete the days it starts on, so it is refused instead - this is the one case where the open
// shift is not this slot's to give away.
console.log('\n--- an open shift that only COVERS this slot ---');
const spanning = drop({
  targetOccupant: row({ _key: 'db-11', user_id: '', _from: '2026-03-16', _to: '2026-03-17' }),
  targetDate: '2026-03-17',
});
check('is refused rather than replaced', spanning.action, 'refuse');
check('for the reason that says so', spanning.reason, 'open-shift-elsewhere');
checkIs('pointing at the shift to move instead', /starts on an earlier day/.test(spanning.message), spanning.message);
check('and it displaces nothing, so the days it spans survive', spanning.displace, null);
// A row with no start date at all cannot be shown to belong here, so it is refused too rather than deleted.
check(
  'a row whose start date is missing is refused as well',
  drop({ targetOccupant: row({ _key: 'db-12', user_id: '', _from: '' }), targetDate: '2026-03-17' }).reason,
  'open-shift-elsewhere'
);

// A plain move displaces nothing and says nothing.
check('a free slot displaces nothing', drop().displace, null);
check('and a free slot says nothing', drop().message, '');

// ---------------------------------------------------------------------------
// 2b. An open shift that is NOT a board slot can only be explained
// ---------------------------------------------------------------------------
// A custom shift (no template) has no slot for a moved shift to adopt, so replacing it has no meaning. It gets the
// refusal that points at the way that does work.
console.log('\n--- an open CUSTOM shift ---');
const customVacancy = drop({ targetOccupant: row({ _key: 'db-9', user_id: '' }), targetKind: 'pill' });
check('is refused rather than replaced', customVacancy.action, 'refuse');
check('as an open shift', customVacancy.reason, 'vacancy');
checkIs('with the click-to-assign advice', /click it to assign a member/.test(customVacancy.message), customVacancy.message);
check('and it displaces nothing', customVacancy.displace, null);

// ---------------------------------------------------------------------------
// 3. An occupied spot names who is on it
// ---------------------------------------------------------------------------
console.log('\n--- a spot that is already staffed ---');
// The target row starts on the slot it is being swapped out of, which is what makes a swap possible - so this is
// the case whose refusal OFFERS the swap rather than only explaining it.
const filledOnSlot = { _key: 'db-7', user_id: 'u2', _from: '2026-03-17', _to: '2026-03-17' };
const ontoFilled = drop({ targetOccupant: row(filledOnSlot), targetName: 'Jane Smith' });
check('dropping onto another member is refused', ontoFilled.action, 'refuse');
check('as occupied', ontoFilled.reason, 'occupied');
checkIs('and the message names them', ontoFilled.message.includes('Jane Smith'), ontoFilled.message);
checkIs('never leaking the placeholder it was built from', !ontoFilled.message.includes('{name}'), ontoFilled.message);
check('and displaces nothing, because nothing was done', ontoFilled.displace, null);
checkIs('and it teaches the hold-to-swap', /Hold the shift there/.test(ontoFilled.message), ontoFilled.message);
// A staffed pill that is not a board slot (a custom shift) is refused the same way, but without offering a swap:
// there is no slot for the other row to adopt, so the gesture would do nothing.
const customFilled = drop({ targetOccupant: row(filledOnSlot), targetKind: 'pill' });
check('a custom shift with someone on it is refused', customFilled.reason, 'occupied-no-swap');
checkIs('without promising a swap that cannot happen', !/Hold the shift there/.test(customFilled.message), customFilled.message);
// An occupant the caller cannot name still reads as a sentence rather than "...has  on it".
const unnamed = drop({ targetOccupant: row(filledOnSlot) });
checkIs('an unnamed occupant becomes "a member"', /has a member on it/.test(unnamed.message), unnamed.message);


// ---------------------------------------------------------------------------
// 4. Past days and past shifts
// ---------------------------------------------------------------------------
console.log('\n--- anything in the past ---');
const past = drop({ targetDate: '2026-03-01' });
check('a day before today is refused', past.action, 'refuse');
check('as a past day', past.reason, 'past-day');
checkIs('with a message about the day', /Past days are locked/.test(past.message), past.message);
check('today itself is NOT the past', drop({ targetDate: TODAY }).action, 'move');
check('nor is tomorrow', drop({ targetDate: '2026-03-06' }).action, 'move');
// A multi-day shift that already finished cannot be dragged anywhere, whatever the target says.
const occurred = drop({
  entry: row({ _from: '2026-03-01', _to: '2026-03-02' }),
  sourceDate: '2026-03-01',
});
check('a shift that has already happened is refused', occurred.reason, 'past-shift');
checkIs('with a message about the shift', /already happened/.test(occurred.message), occurred.message);
// Order: the day is checked before the shift, because the day is what the member aimed at.
const both = drop({ targetDate: '2026-03-01', entry: row({ _from: '2026-03-01', _to: '2026-03-02' }) });
check('and a past day is reported first, as the thing aimed at', both.reason, 'past-day');

// ---------------------------------------------------------------------------
// 5. Drags whose state did not survive, and unknowns
// ---------------------------------------------------------------------------
console.log('\n--- a drag the board cannot account for ---');
check('a drop with no drag key is refused', drop({ draggedKey: null }).reason, 'no-source');
check('a drop with no source date is refused', drop({ sourceDate: null }).reason, 'no-source');
check('a drop whose row has gone is refused', drop({ entry: null }).reason, 'no-source');
check('a drop with no target date is refused', drop({ targetDate: '' }).reason, 'unknown');
// The day's own empty space: there is no slot under the pointer, so the shift has nowhere defined to land.
const onDaySpace = drop({ targetKind: 'day', targetOccupant: null });
check('a drop on the day\'s empty space is refused', onDaySpace.action, 'refuse');
check('for the reason that says so', onDaySpace.reason, 'not-a-slot');
checkIs('and tells the member where to aim', /shift slots/.test(onDaySpace.message), onDaySpace.message);
// The safety net: a reason nobody anticipated still produces a sentence rather than an empty toast.
checkIs('an unknown reason falls back to a real message', dropMessage('not-a-reason').length > 10);
checkIs('and that message is the documented fallback', dropMessage('not-a-reason') === DROP_MESSAGES.unknown);

// ---------------------------------------------------------------------------
// 6. Every message is a sentence, and none is a placeholder
// ---------------------------------------------------------------------------
console.log('\n--- the wording ---');
// The two messages that name the person in the way: both must fill {name} in, and nothing else may carry one.
const NAMES_THE_MEMBER = ['occupied', 'occupied-no-swap'];
Object.entries(DROP_MESSAGES).forEach(([reason, message]) => {
  checkIs(`${reason} reads as a full sentence`, message.length > 25 && /[.!]$/.test(message.trim()), message);
  checkIs(
    `${reason} has no unfilled placeholder left`,
    NAMES_THE_MEMBER.includes(reason) ? message.includes('{name}') : !message.includes('{name}')
  );
});
checkIs('no two refusals share wording', new Set(Object.values(DROP_MESSAGES)).size === Object.keys(DROP_MESSAGES).length);
checkIs(
  'and the one that explains an open custom shift tells the member what to do',
  /click it to assign/.test(DROP_MESSAGES.vacancy)
);
// The notices are a separate table because they are not refusals: they follow an accepted move that did more than
// move, and they have to sound like help rather than like an error.
console.log('\n--- the notices, which follow a move that did more than move ---');
check('there is one for the replaced open shift', typeof DROP_NOTICES.vacancyReplaced, 'string');
checkIs('it says what happened to the row', /replacing it/.test(DROP_NOTICES.vacancyReplaced), DROP_NOTICES.vacancyReplaced);
checkIs('and that the change is not saved yet', /Save/.test(DROP_NOTICES.vacancyReplaced), DROP_NOTICES.vacancyReplaced);
checkIs(
  'and no notice is worded like a failure',
  Object.values(DROP_NOTICES).every((notice) => !/can’t|cannot|didn’t|won’t/.test(notice)),
  Object.values(DROP_NOTICES).join(' | ')
);


// ---------------------------------------------------------------------------
// 6b. Hold-to-swap
// ---------------------------------------------------------------------------
console.log('\n--- holding on a filled slot, to swap ---');
// The dwell is the second, deliberate signal: long enough that a slip cannot do it, short enough that it is not a
// chore. See SWAP_DWELL_MS.
checkIs('the dwell is a deliberate hold, not a slip', SWAP_DWELL_MS >= 1000 && SWAP_DWELL_MS <= 2500, `${SWAP_DWELL_MS}ms`);

const mine = row({ _key: 'db-1', user_id: 'u1', _from: '2026-03-10', _to: '2026-03-10' });
const theirsOnSlot = row({ _key: 'db-7', user_id: 'u2', _from: '2026-03-17', _to: '2026-03-17' });
const swapArgs = { draggedKey: 'db-1', entry: mine, targetOccupant: theirsOnSlot, targetDate: '2026-03-17', targetKind: 'slot', todayKey: TODAY };

check('two staffed slots can swap', planShiftSwap(swapArgs).action, 'swap');
check('and a swap carries no message of its own', planShiftSwap(swapArgs).message, '');
// Everything that is NOT a swap, and why it is not.
check('a shift cannot swap with itself', planShiftSwap({ ...swapArgs, targetOccupant: mine }).reason, 'unchanged');
check(
  'an open shift is filled, not swapped with',
  planShiftSwap({ ...swapArgs, targetOccupant: row({ _key: 'db-9', user_id: '', _from: '2026-03-17', _to: '2026-03-17' }) }).reason,
  'not-swappable'
);
check('a shift with nobody on it cannot swap', planShiftSwap({ ...swapArgs, entry: row({ _key: 'db-1', user_id: '' }) }).reason, 'not-swappable');
check('a custom shift cannot swap (no slot to adopt)', planShiftSwap({ ...swapArgs, targetKind: 'pill' }).reason, 'not-swappable');
check('a past target cannot swap', planShiftSwap({ ...swapArgs, targetOccupant: row({ _key: 'db-7', user_id: 'u2', _from: '2026-03-01', _to: '2026-03-01' }), targetDate: '2026-03-01' }).reason, 'not-swappable');
check('a past dragged shift cannot swap', planShiftSwap({ ...swapArgs, entry: row({ _key: 'db-1', user_id: 'u1', _from: '2026-03-01', _to: '2026-03-01' }) }).reason, 'not-swappable');
// The same covering-row guard as the vacancy move: a row that merely spans the slot would take its whole span with
// it, so the preview would not be what happened.
check(
  'a target row that only covers the slot cannot swap',
  planShiftSwap({ ...swapArgs, targetOccupant: row({ _key: 'db-7', user_id: 'u2', _from: '2026-03-16', _to: '2026-03-17' }) }).reason,
  'not-swappable'
);
check('a drag with no source cannot swap', planShiftSwap({ ...swapArgs, draggedKey: null }).reason, 'no-source');

console.log('\n--- what a swap actually does to the two rows ---');
const [swappedA, swappedB] = swapSlotFields(mine, theirsOnSlot);
// THE point of the swap: each row keeps its own member and its own id, and only the shift's place changes.
check('the dragged member stays on their own row', swappedA.user_id, 'u1');
check('and the other member stays on theirs', swappedB.user_id, 'u2');
check('each row keeps its id', [swappedA.id, swappedB.id], [mine.id, theirsOnSlot.id]);
check('each row keeps its client key', [swappedA._key, swappedB._key], ['db-1', 'db-7']);
check('the dragged row takes the other slot', [swappedA._from, swappedA.schedule_template_id], ['2026-03-17', theirsOnSlot.schedule_template_id]);
check('and the other row takes the dragged slot', [swappedB._from, swappedB.schedule_template_id], ['2026-03-10', mine.schedule_template_id]);
check('both dates move together, so a range cannot be left half-swapped', [swappedA._to, swappedB._to], ['2026-03-17', '2026-03-10']);
check('the sheet-facing dates move with the internal ones', [swappedA.date_from, swappedB.date_to], ['2026-03-17', '2026-03-10']);
check('swapping twice returns both rows exactly', swapSlotFields(...swapSlotFields(mine, theirsOnSlot)), [mine, theirsOnSlot]);
checkIs('and a swap does not mutate the rows it was given', mine._from === '2026-03-10' && theirsOnSlot._from === '2026-03-17');
checkIs(
  'the fields that move are the ones that say WHERE a row sits',
  SWAP_SLOT_FIELDS.includes('_from') && SWAP_SLOT_FIELDS.includes('_to') && SWAP_SLOT_FIELDS.includes('schedule_template_id') && !SWAP_SLOT_FIELDS.includes('user_id')
);

// ---------------------------------------------------------------------------
// 6c. Hovering a slot, with and without a swap on screen
// ---------------------------------------------------------------------------
// The bug these cover: the verdict used to be read from what the board DRAWS. Once the two pills were shown
// exchanged, the slot under the pointer looked like the row being dragged, so the next hover cancelled the swap -
// and the one after that re-armed the countdown. The board swapped and reverted every second and a half, for as
// long as the pointer stayed over the slot.
console.log('\n--- hovering a slot, with and without a swap on screen ---');
const SLOT = 'slot-2026-03-17-t1';
const hoverArgs = { draggedKey: 'db-1', entry: mine, occupant: theirsOnSlot, slotKey: SLOT, dwellSlotKey: '', previewSlotKey: '' };
check('a filled slot starts the hold', planSwapHover(hoverArgs).action, 'hold');
check('holding on the same slot does not restart it', planSwapHover({ ...hoverArgs, dwellSlotKey: SLOT }).action, 'keep');
// THE regression: continuing to hover the slot whose swap is already shown must leave it alone. This is the case
// that cancelled, because by then the slot was drawing the dragged row.
check('and the slot already showing the swap keeps it', planSwapHover({ ...hoverArgs, previewSlotKey: SLOT }).action, 'keep');
check('a free slot has nothing to swap with', planSwapHover({ ...hoverArgs, occupant: null }).action, 'cancel');
check('nor does your own pill', planSwapHover({ ...hoverArgs, occupant: mine }).action, 'cancel');
check('a hover with no drag in flight cancels', planSwapHover({ ...hoverArgs, draggedKey: null }).action, 'cancel');
check('and one whose row has gone', planSwapHover({ ...hoverArgs, entry: null }).action, 'cancel');
// Moving to a different filled slot starts that slot's own hold...
check('another filled slot starts a new hold', planSwapHover({ ...hoverArgs, slotKey: 'other', dwellSlotKey: SLOT }).action, 'hold');
// ...and an offer belonging to a different slot does not protect this one.
check('and an offer on another slot does not keep this one', planSwapHover({ ...hoverArgs, slotKey: 'other', previewSlotKey: SLOT }).action, 'hold');

console.log('\n--- and the board hands it the rows, not the drawing ---');
checkIs('the hover handler takes no occupant from the render', board.includes('const handleSlotDragOver = (e, slot) =>'));
checkIs('it looks the real occupant up itself', board.includes('const occupant = slotOccupant(slot);'));
checkIs('and asks the verdict what to do', board.includes('const verdict = planSwapHover({'));
checkIs('the drop handler reads the rows the same way', board.includes('const handleSlotDrop = (e, slot) =>'));
checkIs(
  'so neither call site passes the drawn pill',
  !board.includes('handleSlotDragOver(e, slot, occupant)') && !board.includes('handleSlotDrop(e, slot, occupant)')
);
// Teeth: inject the old wiring and confirm that check notices. The shape is easy to reintroduce because passing a
// pill LOOKS like handing the handler more information rather than the bug it was.
const withDrawnOccupant = board.replace('onDragOver={(e) => handleSlotDragOver(e, slot)}', 'onDragOver={(e) => handleSlotDragOver(e, slot, occupant)}');
checkIs('the mutation restored the old wiring', withDrawnOccupant !== board);
checkIs('and the check would catch it', withDrawnOccupant.includes('handleSlotDragOver(e, slot, occupant)'));

// ---------------------------------------------------------------------------
// 7. The wiring, which is where the bug actually lived
// ---------------------------------------------------------------------------
// The decision above is only reached if a drop on an occupied slot is DELIVERED. That was the fix: the pill had no
// drop handler at all, so no verdict was ever asked for and nothing could be said.
console.log('\n--- the board asks for a verdict ---');
checkIs('the occupant pill arms the drop', /onDragOver=\{\(e\) => handleSlotDragOver\(e, slot\)\}/.test(board));
checkIs('and accepts it', /onDrop=\{\(e\) => handleSlotDrop\(e, slot\)\}/.test(board));
checkIs('and forgets the highlight when the pointer leaves', /onDragLeave=\{\(\) => handleSlotDragLeave\(slot\)\}/.test(board));
checkIs('the free slot arms and accepts it too', /onDrop=\{\(e\) => handleSlotDrop\(e, slot\)\}/.test(board));
// The old shape: both handlers were conditional, so a past day was not a drop target at all and said nothing.
checkIs(
  'and neither is conditional any more, so a refusal can be explained',
  !/onDrop=\{droppable \?/.test(board) && !/onDragOver=\{\s*droppable/.test(board)
);
checkIs('every drop asks the planner', (board.match(/planShiftDrop\(/g) || []).length >= 3);
checkIs(
  'a refusal is spoken out loud, not swallowed',
  /if \(verdict\.action !== 'move'\) \{\s*\n\s*toast\.error\(verdict\.message\)/.test(board)
);
checkIs('through the app-wide toast wrapper, so it sounds like the other errors', /from '\.\.\/\.\.\/utils\/toast'/.test(board));
checkIs('and the drop stops there, so the day cell cannot also act on it', /e\.stopPropagation\(\)/.test(board));
checkIs('an accepted drop still moves the row and marks the board dirty', /setDirty\(true\)/.test(board));

// The replaced open shift goes in the same write, and the notice says so. Both are about the row that vanishes.
console.log('\n--- the open shift a move replaces ---');
checkIs('the displaced row is removed from the board', /\.filter\(\(r\) => !verdict\.displace \|\| r\._key !== verdict\.displace\)/.test(board));
checkIs('in the same state update as the move', /\.filter\(\(r\) => !verdict\.displace/.test(board.split('const delta = daysBetween')[1] || ''));
checkIs('and the administrator is told, since a row went with it', /if \(verdict\.message\) setNotice\(verdict\.message\)/.test(board));

// The other two surfaces a pill can be dropped on, which used to accept nothing and say nothing.
console.log('\n--- the last two silent surfaces ---');
checkIs('the day cell answers a drop', /onDrop=\{\(e\) => handleDayDrop\(e, dateKey\)\}/.test(board));
checkIs('and arms it, or the browser would refuse to deliver it', /onDragOver=\{\(e\) => e\.preventDefault\(\)\}/.test(board));
checkIs('a custom shift answers a drop too', /onDrop=\{\(e2\) => handlePillDrop\(e2, e\)\}/.test(board));
checkIs('asking the planner for the pill and day kinds', /targetKind: 'pill'/.test(board) && /targetKind: 'day'/.test(board));
checkIs('and the board slot names its own kind', /targetKind: 'slot'/.test(board));

// Teeth: those are string matches, so remove what each describes and confirm the check fails. The pill's drop
// handler is the one that was missing, so it is the one worth proving.
console.log('\n--- and the wiring checks would notice ---');
const withoutPillDrop = board.split('onDrop={(e) => handleSlotDrop(e, slot)}').join('/* removed */');
checkIs('the mutation changed the source', withoutPillDrop !== board);
checkIs('the pill drop check fails without it', !/onDrop=\{\(e\) => handleSlotDrop\(e, slot\)\}/.test(withoutPillDrop));
const withConditionalDrop = board.replace(
  'onDrop={(e) => handleSlotDrop(e, slot)}',
  'onDrop={droppable ? (e) => handleSlotDrop(e, slot) : undefined}'
);
checkIs('the mutation restored the old conditional shape', /onDrop=\{droppable \?/.test(withConditionalDrop));
checkIs('and the not-conditional check catches it', /onDrop=\{droppable \?/.test(withConditionalDrop) !== false);

// ---------------------------------------------------------------------------
// 8. The hold-to-swap, wired
// ---------------------------------------------------------------------------
// The pure rules above are only reachable if the dwell is armed on a filled slot, cancelled when the pointer
// leaves, and committed on release - one wrong link and the gesture either never fires or fires on everything.
console.log('\n--- the hold-to-swap, wired to the board ---');
const styles = readFileSync('src/index.css', 'utf8');
checkIs('the dwell is armed as a slot is hovered', /beginSwapDwell\(slot, occupant, entry\)/.test(board));
checkIs('and only the dragged row can arm it', /dragKeyRef\.current \? working\.find\(\(r\) => r\._key === dragKeyRef\.current\) : null/.test(board));
checkIs('the dragged key is readable during the drag, not only on drop', /dragKeyRef\.current = entry\._key/.test(board) && /const dragKeyRef = useRef\(null\)/.test(board));
checkIs('the drag-over takes no occupant from the render, so the drawing cannot decide it',
  board.includes('const handleSlotDragOver = (e, slot) =>'));
// The timer must NOT restart on every dragover: those fire continuously while the pointer sits still, so the swap
// would never arrive. This guard is the difference between working and never firing.
checkIs('and the countdown is not restarted while the pointer stays put', /if \(swapDwell\?\.slotKey === slot\.slotKey\) return;/.test(board));
checkIs('the countdown uses the documented dwell', /SWAP_DWELL_MS/.test(board) && !/setTimeout\([^,]+, \d{3,4}\)/.test(board));
checkIs('leaving the slot cancels the countdown', /const handleSlotDragLeave[\s\S]{0,300}?cancelSwapDwell\(\)/.test(board));
checkIs('and takes the offered swap back with it', /const handleSlotDragLeave[\s\S]{0,300}?cancelSwapPreview\(\)/.test(board));
checkIs('letting go anywhere ends both', /const handleDragEndPill[\s\S]{0,400}?cancelSwapDwell\(\)[\s\S]{0,200}?cancelSwapPreview\(\)/.test(board));
checkIs('releasing on the slot commits the swap', /if \(armed\) \{\s*\n\s*commitSwap\(armed\);\s*\n\s*return;\s*\n\s*\}/.test(board));
checkIs('the commit exchanges the two rows through the shared rule', /const \[nextA, nextB\] = swapSlotFields\(a, b\)/.test(board));
checkIs('and the board is marked dirty, because two shifts moved', /const commitSwap[\s\S]{0,600}?setDirty\(true\)/.test(board));
checkIs('with a notice saying what happened', /setNotice\(DROP_NOTICES\.swapped\)/.test(board));
// The offer is shown, not made: the slots DRAW the two rows exchanged, and the data changes only on release.
checkIs('the slots are drawn through the swap preview', /const occupant = displayOccupant\(slot\)/.test(board));
checkIs('and the preview is what exchanges them on screen', /if \(occupant\._key === swapPreview\.aKey\)/.test(board) && /if \(occupant\._key === swapPreview\.bKey\)/.test(board));
console.log('\n--- and it is visible ---');
checkIs('the held-over slot blinks', /dwelling \? 'animate-swapDwell'/.test(board));
checkIs('and the exchanged pills pop', /exchanged \? 'animate-swapPop'/.test(board));
checkIs('and pop again on the way back, rather than jumping', /swapRevert && \(swapRevert\.aKey === occupant\._key/.test(board));
checkIs('the blinking animation exists', /@keyframes swapDwell/.test(styles) && /\.animate-swapDwell \{/.test(styles));
checkIs('and so does the pop', /@keyframes swapPop/.test(styles) && /\.animate-swapPop \{/.test(styles));
// The JS timer that removes the pop class has to match the animation it is timing, or the class outlives it.
const popSeconds = /\.animate-swapPop \{\s*animation: swapPop ([\d.]+)s/.exec(styles);
checkIs('the pop animation exists with a duration', !!popSeconds, styles.slice(styles.indexOf('swapPop'), styles.indexOf('swapPop') + 120));
check(
  'and the timer that removes it matches that duration',
  Math.round(Number(popSeconds && popSeconds[1]) * 1000),
  SWAP_POP_MS
);
// A blinking ring is exactly what a reduced-motion preference is about, so the meaning has to survive without it.
checkIs('reduced motion keeps the meaning of the blink', /@media \(prefers-reduced-motion: reduce\)/.test(styles));
const reducedBlock = styles.split('@media (prefers-reduced-motion: reduce)')[1] || '';
checkIs('by replacing the blink with a steady outline', /\.animate-swapDwell \{[\s\S]{0,120}?animation: none;[\s\S]{0,120}?box-shadow/.test(reducedBlock));
checkIs('and dropping the pop', /\.animate-swapPop \{[\s\S]{0,80}?animation: none;/.test(reducedBlock));
checkIs('the swap is offered in the tooltip as it is held', /hold to swap these two shifts/.test(board));
checkIs('and a plain drop on a filled slot teaches the gesture', /Hold the shift there for a moment/.test(DROP_MESSAGES.occupied));

// Teeth for the one link whose absence would be silent: if leaving the slot did not cancel, the pills would stay
// exchanged on screen while the data had not moved - a swap nobody confirmed.
const withoutCancel = board.replace(/\s+cancelSwapPreview\(\);\n  \};/, '\n  };');
checkIs('the mutation removed the cancel-on-leave', withoutCancel !== board);
checkIs(
  'and the cancel-on-leave check fails without it',
  !/const handleSlotDragLeave[\s\S]{0,300}?cancelSwapPreview\(\)/.test(withoutCancel)
);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
