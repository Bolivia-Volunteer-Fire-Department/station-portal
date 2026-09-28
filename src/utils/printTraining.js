// Printable training: the data behind the two printed sheets.
//
// Two shapes, because the tab offers two:
//
//   'list'      what the filters currently show, as a list - the same columns the report draws, plus
//               who signed each training. Nothing the report does not show: no narrative, no
//               administrative detail. A filtered list is a subset of the record, so the sheet says
//               which filters produced it.
//   'training'  ONE training's own record: every field it has, its categories in full, the narrative,
//               and the signatures.
//
// Kept as pure functions so both sheets can be tested without a printer, a browser or a click - the
// same reason utils/printSchedule.js is built this way.

import { displayDate, toDateKey } from './scheduleDate';
import { unnamedLabel } from './displayLabel';
import {
  TRAINING_CATEGORY_OPTIONS,
  TRAINING_SORT_OPTIONS,
  formatDuration,
  formatTotalHours,
  signaturesForTraining,
  trainingTimeLabel,
  trainingTotals,
} from './training';

const text = (value) => String(value ?? '').trim();

// A date for paper: the app's own format ("Sat, Mar 14") with the YEAR added.
//
// A printed sheet is kept for years, and one that says "Sat, Mar 14" for both a 2024 training and a 2026 one
// is not a record - the screen can get away with it because the reader has the rest of the app around it.
// displayDate validates the key, so a hand-typed cell with nothing readable in it still prints nothing.
const printDate = (dateKey) => {
  const short = displayDate(dateKey);
  if (!short) return '';
  return `${short}, ${String(dateKey).split('-')[0]}`;
};

// The list columns, in the order the report's own header uses. "External" is the report's Ext. column -
// spelled out, because a printed sheet has no tooltip to explain an abbreviation.
//
// The categories are NOT a column: the screen draws them under the title, and the printed line under
// the title is the same line, the same words, in the same order.
export const PRINT_TRAINING_COLUMNS = ['Date', 'Training', 'Location', 'Instructors', 'Signed', 'External'];

// A member's name for print, falling back the way the report's own signature list does - so a
// half-filled row reads identically on paper and on screen.
const nameFor = (users, userId) => {
  const user = (Array.isArray(users) ? users : []).find(
    (candidate) => candidate && String(candidate.id) === String(userId)
  );
  return text(user?.name) || unnamedLabel('member');
};

// Who signed one training, as names, A-Z.
//
// Sorted rather than left in signature order because the printed sheet is read by scanning - and
// de-duplicated, so the number in the heading always equals the number of names under it. A duplicate
// signature row (the sheet is hand-editable) would otherwise print "3 signed" above two names.
export const printSignerNames = (signatures, users, trainingId) => {
  const seen = new Map();
  signaturesForTraining(signatures, trainingId).forEach((signature) => {
    const userId = text(signature.user_id);
    if (!userId || seen.has(userId)) return;
    seen.set(userId, nameFor(users, userId));
  });
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
};

// The total line under the list: how many trainings, and how many training hours - the two figures the
// report's tiles show, computed by the same helper so paper and screen cannot disagree.
export const printTrainingTotals = (rows) => {
  const totals = trainingTotals(rows);
  return { count: totals.count, hours: totals.hours, hoursLabel: formatTotalHours(totals.hours) };
};


// One training → one printed row.
//
// `when` and `badges` are what the report draws under the title: the time label ("8:00 AM · 2 hrs") and
// the category chips. They are kept as separate pieces rather than one string so the sheet can space them
// the way the screen does.
export const printTrainingRow = ({ training, signatures = [], users = [] } = {}) => {
  const signers = printSignerNames(signatures, users, training?.id);
  return {
    id: text(training?.id),
    date: printDate(training?.date_key || '') || text(training?.date),
    title: text(training?.title),
    when: text(training?.when_label) || trainingTimeLabel(training),
    badges: (training?.flags || []).map((flag) => flag.short),
    location: text(training?.location),
    instructors: text(training?.instructors),
    // The number of names below the row, not the number of signature rows: see printSignerNames.
    signedCount: signers.length,
    external: Boolean(training?.is_entered_into_external),
    signers,
  };
};

// The whole list, in the order the report is showing it. The caller passes the rows the table has already
// filtered and sorted, so "what the filters currently show" is literally that.
export const printTrainingList = ({ rows = [], signatures = [], users = [] } = {}) =>
  (Array.isArray(rows) ? rows : [])
    .filter(Boolean)
    .map((training) => printTrainingRow({ training, signatures, users }));

// What the filters currently are, in words, so a filtered printout says what it is a subset of. A printed
// list that does not mention its filter is a record that misleads.
//
// The labels come from the same option lists the selects are built from, so the sheet says "Hazmat"
// because the control said "Hazmat".
export const printTrainingFilterSummary = (filters = {}, { users = [], sort = '' } = {}) => {
  const parts = [];
  const from = text(filters.from);
  const to = text(filters.to);
  const location = text(filters.location);
  const category = text(filters.category);
  const member = text(filters.member);
  const signed = text(filters.signed);

  if (from || to) {
    parts.push({
      label: 'Dates',
      value:
        from && to
          ? `${printDate(from)} to ${printDate(to)}`
          : from
            ? `from ${printDate(from)}`
            : `to ${printDate(to)}`,
    });
  }
  if (location) parts.push({ label: 'Location', value: location });
  if (category) {
    const option = TRAINING_CATEGORY_OPTIONS.find((entry) => entry.value === category);
    // An unrecognised category filters nothing (see filterTrainings), so it is left off the sheet rather
    // than printed as a filter that had no effect.
    if (option) parts.push({ label: 'Category', value: option.label });
  }
  if (member) parts.push({ label: 'Member', value: nameFor(users, member) });
  if (signed) parts.push({ label: 'Signatures', value: signed === 'yes' ? 'Signed only' : 'Not signed only' });

  const sortOption = TRAINING_SORT_OPTIONS.find((entry) => entry.value === sort);
  if (sortOption) parts.push({ label: 'Sorted by', value: sortOption.label });

  return parts;
};

// The header block: the station's own patch, then what this sheet is and what it covers.
export const printTrainingHeader = ({
  mode = 'list',
  departmentName = '',
  memberName = '',
  subtitle = '',
  generatedAt = new Date(),
} = {}) => ({
  departmentName: text(departmentName) || 'Fire Department',
  title: mode === 'training' ? 'Training Record' : 'Training Report',
  subtitle: text(subtitle) || (mode === 'training' ? 'One training' : 'All trainings'),
  generated: `Printed ${toDateKey(generatedAt)}`,
  // A training record outlives the person who printed it, so it says who that was.
  printedBy: text(memberName),
});

// ONE training, in full: every field, its categories by their full names, the narrative, and who signed.
export const printTrainingDetail = ({ training, signatures = [], users = [] } = {}) => {
  const signers = printSignerNames(signatures, users, training?.id);

  const fields = [
    { label: 'Date', value: printDate(training?.date_key || '') || text(training?.date) },
    { label: 'Start time', value: text(training?.start_time) ? trainingTimeLabel(training).split(' · ')[0] : '' },
    { label: 'Duration', value: formatDuration(training?.duration) },
    { label: 'Location', value: text(training?.location) },
    { label: 'Instructors', value: text(training?.instructors) },
  ];

  // The categories by their full labels - "Company Training", not the badge's "Company" - because this
  // sheet has room to be unambiguous. A training with none says so rather than leaving a blank.
  const categories = (training?.flags || []).map((flag) => flag.label);

  return {
    id: text(training?.id),
    title: text(training?.title),
    fields,
    categories,
    narrative: text(training?.narrative),
    signers,
    signedCount: signers.length,
    // The external-system marker is administrative bookkeeping rather than a description, so it appears
    // only when it is set: "No" on every other record is noise.
    locked: Boolean(training?.is_entered_into_external),
  };
};
