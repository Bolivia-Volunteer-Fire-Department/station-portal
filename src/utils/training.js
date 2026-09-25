// Training records and signatures.
//
// Two sheets behind one feature:
//
//   training             one row per training activity (the definition)
//   training_signatures  one row per (training, member) - the member's acknowledgement
//
// A signature is a *signature*, so members can only ever add one: it acknowledges attendance,
// and letting someone quietly withdraw it would defeat the point. Removal exists only for
// administrators, through the Training report.
//
// Everything here is a pure function over the rows the API returns, so the parsing and the
// sorting can be exercised directly - see scripts/verify-training.mjs.

import { isTruthyFlag } from './rankEligibility';
import { parseSheetDateKey } from './scheduleDate';
import { formatClock, timeToMinutes } from './shiftTime';
import { toTimeInputValue } from './timeInputValue';

// The TRUE/FALSE columns on the training sheet, in the order the form and the table show them.
// `short` is the badge text, which has to stay compact enough for a table row.
//
// `adminOnly` marks a column that is administrative bookkeeping rather than a description of the
// training: it is edited only in the Administration module and shown as its own table column
// rather than as a badge. See ENTERED_EXTERNALLY_KEY below for what that column does.
export const TRAINING_FLAGS = [
  { key: 'is_certification', label: 'Certification', short: 'Cert' },
  { key: 'is_drill', label: 'Drill', short: 'Drill' },
  { key: 'is_fire_prevention', label: 'Fire prevention', short: 'Fire prev' },
  { key: 'is_multicompany', label: 'Multi-company', short: 'Multi-co' },
  { key: 'is_training_facility', label: 'Training Facility', short: 'Facility' },
  { key: 'is_officer_training', label: 'Officer training', short: 'Officer' },
  { key: 'is_driver_training', label: 'Driver training', short: 'Driver' },
  {
    key: 'is_entered_into_external',
    label: 'Entered into an external system',
    short: 'External',
    adminOnly: true,
  },
];

export const TRAINING_FLAG_KEYS = TRAINING_FLAGS.map((flag) => flag.key);

// The flags a member-facing form may edit, and the flags a table shows as badges. The external
// flag is excluded from both on purpose: it is an administrative record that, once set, locks
// the training completely, so it is edited (and shown) only in the Administration module.
export const MEMBER_EDITABLE_FLAGS = TRAINING_FLAGS.filter((flag) => !flag.adminOnly);
export const TRAINING_BADGES = TRAINING_FLAGS.filter((flag) => !flag.adminOnly);

// The "entered into an external system" column. Set once and never unset through the app: a
// training that has been filed elsewhere is a closed record, so nothing about it or its
// signatures may change afterwards.
export const ENTERED_EXTERNALLY_KEY = 'is_entered_into_external';

// A training that has been recorded in an external system. Completely locked: not editable, not
// deletable, and its signatures cannot be added or removed - in the app. Clearing the column in
// the spreadsheet is the only way back, which is what the Administration warning says.
export const trainingLocked = (training) => Boolean(training?.[ENTERED_EXTERNALLY_KEY]);

// Whether the Training module may edit a training: not once anyone has signed it (the record is
// evidence at that point, so changes belong in the Administration module), and never once it is
// locked.
//
// `signature_count` is supplied by the server for every training precisely because the client
// cannot work this out for itself - a member only receives their OWN signatures, so "has anyone
// signed this?" is not answerable from the payload without it. It is a count, not a list, so it
// does not leak who signed.
export const trainingEditable = (training) =>
  !trainingLocked(training) && Number(training?.signature_count ?? 0) === 0;

// Why a training cannot be edited in the Training module, for a tooltip. Empty when it can.
export const trainingEditBlockedReason = (training) => {
  if (trainingLocked(training)) {
    return 'This training has been entered into an external system, so it is locked and cannot be changed.';
  }
  if (Number(training?.signature_count ?? 0) > 0) {
    return 'Somebody has already signed this training, so it can only be changed in the Administration module.';
  }
  return '';
};

const text = (value) => String(value ?? '').trim();

// The sheet stores a number, but a hand-edited cell can hold text, so a bad value reads as
// "no duration" rather than rendering NaN hours.
export const parseDuration = (value) => {
  if (value === undefined || value === null || text(value) === '') return null;
  const parsed = Number(text(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

// "2 hrs", "1 hr", "0.5 hrs". Kept dumb on purpose: the sheet holds hours as a float and
// nothing here needs to convert to minutes.
export const formatDuration = (value) => {
  const hours = parseDuration(value);
  if (hours === null) return '';
  const rounded = Math.round(hours * 100) / 100;
  return `${rounded} ${rounded === 1 ? 'hr' : 'hrs'}`;
};

// Start time and duration on one line: "8:00 AM · 2 hrs". Either half can be missing.
export function trainingTimeLabel(training, timeFormat = '12') {
  const start = formatClock(training?.start_time, timeFormat);
  const duration = formatDuration(training?.duration);
  return [start, duration].filter(Boolean).join(' · ');
}

// One training, with its flags as booleans and its duration as a number. Every view normalizes
// what it receives, so a component cannot be handed raw sheet text and silently drop the badges
// or lose the date the sort depends on.
export const normalizeTraining = (row) => {
  const source = row || {};
  const training = {
    id: text(source.id),
    date: text(source.date),
    date_key: parseSheetDateKey(source.date),
    title: text(source.title),
    start_time: toTimeInputValue(source.start_time) || text(source.start_time),
    duration: parseDuration(source.duration),
    location: text(source.location),
    instructors: text(source.instructors),
    narrative: text(source.narrative),
    // How many members have signed. Supplied by the server (a plain sheet row has no such
    // column), and treated as 0 when absent, which is what the "no signatures yet" state means.
    signature_count: Number.isFinite(Number(source.signature_count))
      ? Number(source.signature_count)
      : 0,
  };
  TRAINING_FLAG_KEYS.forEach((key) => {
    training[key] = isTruthyFlag(source[key]);
  });
  // Display helpers, derived once so every view agrees on what a row says.
  training.when_label = trainingTimeLabel(training);
  training.flags = TRAINING_BADGES.filter((flag) => training[flag.key]);
  training.locked = trainingLocked(training);
  return training;
};

// Rows with no id cannot be signed or edited, so they are dropped rather than rendered blank.
export const normalizeTrainingList = (rows) =>
  (Array.isArray(rows) ? rows : []).map(normalizeTraining).filter((training) => training.id !== '');

// --- sorting, filtering and totals ------------------------------------------
//
// Both Training screens let the reader narrow the list and then tell them what the narrowed list
// adds up to: how many trainings, and how many training HOURS. The hours figure is the point of the
// exercise - "how much training has this member done this year?" is a filter plus a sum - so the
// totals are computed from exactly the rows the table is showing.

export const TRAINING_SORT_OPTIONS = [
  { value: 'date_desc', label: 'Date (newest first)' },
  { value: 'date_asc', label: 'Date (oldest first)' },
  { value: 'title_asc', label: 'Title (A–Z)' },
  { value: 'hours_desc', label: 'Duration (longest first)' },
];

// Newest first, which is what both screens have always shown, and the order a member wants: the
// trainings still to sign are almost always the recent ones.
export const DEFAULT_TRAINING_SORT = 'date_desc';

// Missing values sort last in EVERY direction: an unreadable date is not the newest training, and a
// missing duration is not the longest. Negating a whole comparison instead would reverse that too
// and float the blanks to the top, so the direction is a parameter here rather than a sign flip.
const compareText = (aValue, bValue, direction = 1) => {
  const a = text(aValue);
  const b = text(bValue);
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return (a < b ? -1 : 1) * direction;
};

// Start-time comparison, with the direction as a parameter.
//
// The ORIGINAL training sort ordered a day by start time DESCENDING (later first), matching its
// "newest first" date order. That contract is preserved here rather than quietly flipped: this
// change added sort options, it did not set out to reorder the existing view. The ascending date
// option mirrors it, so a day always reads in the same direction as its dates.
const compareStarts = (aValue, bValue, direction) => {
  const a = timeToMinutes(aValue);
  const b = timeToMinutes(bValue);
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * direction;
};

const compareHours = (aValue, bValue) => {
  const aOk = Number.isFinite(aValue);
  const bOk = Number.isFinite(bValue);
  if (!aOk && !bOk) return 0;
  if (!aOk) return 1;
  if (!bOk) return -1;
  return bValue - aValue;
};

// Within the same day, order by start time - later first when the dates run newest-first, earlier
// first when they run oldest-first, so the day reads in the same direction as the dates around it.
const COMPARATORS = {
  date_desc: (a, b) =>
    compareText(a?.date_key, b?.date_key, -1) ||
    compareStarts(a?.start_time, b?.start_time, -1) ||
    compareText(a?.title, b?.title),
  date_asc: (a, b) =>
    compareText(a?.date_key, b?.date_key, 1) ||
    compareStarts(a?.start_time, b?.start_time, 1) ||
    compareText(a?.title, b?.title),
  title_asc: (a, b) =>
    compareText(a?.title, b?.title) || compareText(a?.date_key, b?.date_key, -1),
  hours_desc: (a, b) =>
    compareHours(a?.duration, b?.duration) || compareText(a?.date_key, b?.date_key, -1),
};

// The trainings in the chosen order. An unknown sort value falls back to the default rather than
// leaving the list in whatever order the sheet happened to return.
export const sortTrainingRows = (rows, sort = DEFAULT_TRAINING_SORT) => {
  const comparator = COMPARATORS[sort] || COMPARATORS[DEFAULT_TRAINING_SORT];
  return [...(Array.isArray(rows) ? rows : [])].sort(comparator);
};


// An empty filter set, for a component's initial state.
export const emptyTrainingFilters = () => ({ from: '', to: '', location: '', member: '', signed: '' });

// The distinct locations present in the rows, as {value,label} options.
//
// Built from the data rather than from the sheet's whole location vocabulary, so a filter never
// offers a location that nothing in this list was actually held at.
export const trainingLocationOptions = (rows) => {
  const seen = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const location = text(row?.location);
    if (location) seen.add(location);
  });
  return [...seen].sort((a, b) => compareText(a, b)).map((value) => ({ value, label: value }));
};

// The rows matching a filter set.
//
// `signedIds` is the set of trainings relevant to the ACTIVE member - the ones they signed. It
// answers two questions with one option:
//
//   * the administrator's "which trainings did this member attend" (signed = yes)
//   * the member's own "what have I still to sign" (signed = no)
//
// which is why one select covers both screens.
export const filterTrainings = (rows, filters = {}, { signedIds = new Set() } = {}) => {
  const from = text(filters.from);
  const to = text(filters.to);
  const location = text(filters.location);
  const member = text(filters.member);
  const signed = text(filters.signed);

  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!row) return false;

    // Date keys are yyyy-mm-dd, so comparing them as text compares them as dates - and either end
    // of the range can be left open. A row with no readable date cannot satisfy a range.
    const dateKey = text(row.date_key);
    if (from || to) {
      if (!dateKey) return false;
      if (from && dateKey < from) return false;
      if (to && dateKey > to) return false;
    }

    if (location && text(row.location) !== location) return false;
    if (member && !signedIds.has(text(row.id))) return false;
    if (signed === 'yes' && !signedIds.has(text(row.id))) return false;
    if (signed === 'no' && signedIds.has(text(row.id))) return false;

    return true;
  });
};

// What the filtered list adds up to: how many trainings, how many HOURS, and how many of them the
// active member has signed. A training with no readable duration contributes nothing to the hours
// rather than breaking the total, and the sum is rounded to two decimals so 0.1 + 0.2 reads as 0.3.
export const trainingTotals = (rows, signedIds = new Set()) => {
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean);
  let hours = 0;
  let signedCount = 0;

  list.forEach((row) => {
    const duration = parseDuration(row.duration);
    if (duration !== null) hours += duration;
    if (signedIds.has(text(row.id))) signedCount++;
  });

  return {
    count: list.length,
    hours: Math.round(hours * 100) / 100,
    signedCount,
    unsignedCount: list.length - signedCount,
  };
};

// "0 hrs", "1 hr", "12.5 hrs".
//
// Separate from formatDuration because it accepts zero: a filtered view with nothing in it
// legitimately totals nothing, whereas an individual training with no duration should show nothing.
export const formatTotalHours = (hours) => {
  const value = Number(hours);
  if (!Number.isFinite(value) || value <= 0) return '0 hrs';
  const rounded = Math.round(value * 100) / 100;
  return `${rounded} ${rounded === 1 ? 'hr' : 'hrs'}`;
};

// --- Signatures -------------------------------------------------------------

// Training ids a given member has signed, as a Set of strings.
//
// A Set rather than an array because the button state is a membership test per row, and because
// it collapses duplicate rows: the sheet is meant to hold one row per member per training, and a
// duplicate should read as "signed" rather than as two entries.
export const signedTrainingIds = (signatures, userId) => {
  const ids = new Set();
  (Array.isArray(signatures) ? signatures : []).forEach((signature) => {
    if (!signature) return;
    if (text(signature.user_id) !== text(userId)) return;
    const trainingId = text(signature.training_id);
    if (trainingId) ids.add(trainingId);
  });
  return ids;
};

// The signature rows for one training - what the Training report lists, with the row id needed
// to remove one.
export const signaturesForTraining = (signatures, trainingId) =>
  (Array.isArray(signatures) ? signatures : []).filter(
    (signature) => signature && text(signature.training_id) === text(trainingId)
  );

// How many members signed each training, as a Map of training id -> count.
export const signatureCounts = (signatures) => {
  const counts = new Map();
  (Array.isArray(signatures) ? signatures : []).forEach((signature) => {
    if (!signature) return;
    const trainingId = text(signature.training_id);
    if (!trainingId) return;
    counts.set(trainingId, (counts.get(trainingId) || 0) + 1);
  });
  return counts;
};

