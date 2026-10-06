// A member's training totalled up by category - the "view" a state training form is filled from.
//
// WHY THIS EXISTS ON THE CLIENT. The Reports module aggregates training the same way, but it does it on the SERVER
// (functions/reporting.js `aggregateTrainingRows`), inside a callable, over a date range and a scope. A printable form
// wants the same arithmetic for ONE member, and it wants it offline: a station's coverage is patchy, and generating a
// sheet is exactly the sort of thing an officer does at the kitchen table with no signal. So the arithmetic lives here,
// purely, and the form engine (utils/formFill) is handed its result.
//
// THE PARITY IS PINNED, NOT HOPED FOR. Two implementations of one sum WILL drift, so scripts/verify-forms.mjs runs this
// and the server's reducer over the same rows and asserts they agree. That test is the only reason two copies are
// acceptable; if it ever fails, one of them is wrong and the harness says which.
//
// IT IS DEPENDENCY-FREE ON PURPOSE. No imports at all: the category list and the flag parser are passed in or mirrored
// here, so plain Node can load this module directly (the parity harness does exactly that, and Node cannot resolve the
// app's extensionless relative imports). Anything this file needs from `utils/training` is handed to it by the caller.
//
// The shape it returns is the shape the form's field map reads: `totals.is_hazmat` is the Hazmat hours, `totals.total` is
// every hour counted once, and `rows` is the same numbers as an ordered list for a form that draws a table.

// The TRUE/FALSE parser, mirrored from functions/reporting.js character for character. It has to be a mirror rather than
// an import because the two live on opposite sides of the deploy boundary - and the parity harness is what keeps them
// honest if a third reading is ever invented.
const isTruthyFlag = (value) => value === true || /^(true|yes|1)$/i.test(String(value ?? '').trim());

const round = (value) => Math.round(value * 100) / 100;

// `categories` is `[[flagKey, label], ...]`, the same list `utils/training.TRAINING_FLAGS` describes and the server's
// `TRAINING_CATEGORIES` names. A training carries SEVERAL flags and is counted in EACH one it holds, so the per-category
// rows can add up to more than `total` - which is the server's documented behaviour and would be a bug to "fix" here.
//
// A signature whose training is missing (a row deleted out from under it) is skipped rather than counted at zero hours:
// it is not a training anybody attended, it is a broken reference, and counting it would inflate `count`.
export const summarizeTrainingByCategory = ({ signatures = [], trainings = [], categories = [] } = {}) => {
  const trainingById = new Map(
    (Array.isArray(trainings) ? trainings : []).map((training) => [String(training.id), training])
  );
  const groups = new Map();
  const add = (key, label, hours) => {
    const current = groups.get(key) || { key, label, value: 0 };
    current.value = round(current.value + hours);
    groups.set(key, current);
  };

  let total = 0;
  let count = 0;
  (Array.isArray(signatures) ? signatures : []).forEach((signature) => {
    const training = trainingById.get(String(signature && signature.training_id));
    if (!training) return;
    const duration = Number(training.duration);
    const hours = Number.isFinite(duration) && duration > 0 ? duration : 0;
    count += 1;
    total = round(total + hours);

    const matched = (Array.isArray(categories) ? categories : []).filter(([flag]) => isTruthyFlag(training[flag]));
    if (!matched.length) add('none', 'No category', hours);
    matched.forEach(([flag, label]) => add(flag, label, hours));
  });

  // The same order the server's report draws: heaviest first, then by label so equal totals are stable.
  const rows = [...groups.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  return {
    rows,
    totals: Object.fromEntries(rows.map((row) => [row.key, row.value])),
    // Every hour counted ONCE, whatever categories it fell into - the number that goes next to "Total".
    total,
    count,
  };
};

// The category list in the shape this reducer wants, from the app's own flag table. Kept here rather than in the reducer
// so the reducer stays dependency-free; the caller (the form UI) passes its `TRAINING_FLAGS` through this.
export const categoryPairsFrom = (flags = []) =>
  (Array.isArray(flags) ? flags : [])
    .filter((flag) => flag && flag.adminOnly !== true && flag.key)
    .map((flag) => [flag.key, flag.label || flag.key]);
