/**
 * Verifies the Training feature.
 *
 * Two halves, both of which have bitten this project before:
 *
 *   1. The pure logic in src/utils/training.js - parsing a training row, the flags, the sort, and
 *      the signature lookups. Sorting and "is this signed" are what the whole screen depends on.
 *   2. The RULES the backend enforces, extracted from Code.gs and run against stubs: a member can
 *      only ADD a signature, only an administrator can remove one, and a signature cannot be
 *      duplicated. These are the promises the feature rests on, and a UI-only version of them
 *      would be a security hole rather than a bug.
 *
 * Run with: npm run verify:training
 */
import { readFileSync } from 'node:fs';
import {
  ENTERED_EXTERNALLY_KEY,
  MEMBER_EDITABLE_FLAGS,
  TRAINING_BADGES,
  TRAINING_FLAGS,
  TRAINING_FLAG_KEYS,
  formatDuration,
  formatTotalHours,
  normalizeTraining,
  normalizeTrainingList,
  parseDuration,
  signatureCounts,
  signaturesForTraining,
  signedTrainingIds,
  sortTrainingRows,
  trainingEditable,
  trainingEditBlockedReason,
  trainingLocationOptions,
  trainingLocked,
  trainingTimeLabel,
  trainingTotals,
  emptyTrainingFilters,
  filterTrainings,
  DEFAULT_TRAINING_SORT,
} from '../src/utils/training.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` -> ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`}`
  );
};

const ROW = {
  id: 't1',
  date: '2026-03-14',
  title: 'SCBA Refresher',
  start_time: '08:00',
  duration: '2',
  location: 'Station 1',
  instructors: 'Capt. Alvarez',
  is_certification: 'TRUE',
  is_drill: 'TRUE',
  is_multipanycompany: 'FALSE',
  narrative: 'Masks and bottles.',
};

console.log('--- one flag column per classification ---');
check('every flag column is covered', TRAINING_FLAGS.length, 8);
check('and they are the sheet columns', TRAINING_FLAG_KEYS, [
  'is_certification',
  'is_drill',
  'is_fire_prevention',
  'is_multicompany',
  'is_training_facility',
  'is_officer_training',
  'is_driver_training',
  'is_entered_into_external',
]);
check('each has a label and a short badge', TRAINING_FLAGS.every((f) => f.label && f.short), true);
check('flags are unique', new Set(TRAINING_FLAG_KEYS).size, 8);

console.log('\n--- parsing a training row ---');
const training = normalizeTraining(ROW);
check('id is a string', training.id, 't1');
check('the date key is parsed', training.date_key, '2026-03-14');
check('the start time is normalized', training.start_time, '08:00');
check('the duration is a number', training.duration, 2);
check('the title survives', training.title, 'SCBA Refresher');
check('a missing flag reads false', training.is_multicompany, false);
check('a TRUE flag reads true', training.is_certification, true);
check('derived flags only include the set ones', training.flags.map((f) => f.key), ['is_certification', 'is_drill']);
check('and the when label is derived', training.when_label, '8:00 AM · 2 hrs');

// The sheet is hand-editable, so every one of these reaches the app in practice.
check('an ISO date parses', normalizeTraining({ ...ROW, date: '2026-03-14T04:00:00.000Z' }).date_key, '2026-03-14');
check('a US-format date parses', normalizeTraining({ ...ROW, date: '3/14/2026' }).date_key, '2026-03-14');
check('an unreadable date parses to null', normalizeTraining({ ...ROW, date: 'sometime' }).date_key, null);
check('a leading-zero duration is a number', normalizeTraining({ ...ROW, duration: '2.5' }).duration, 2.5);
check('a blank duration is null', normalizeTraining({ ...ROW, duration: '' }).duration, null);
check('text in the duration is null', normalizeTraining({ ...ROW, duration: 'two hours' }).duration, null);
check('a zero duration is null, not "0 hrs"', normalizeTraining({ ...ROW, duration: '0' }).duration, null);
check('the bool parser accepts true', normalizeTraining({ ...ROW, is_drill: true }).is_drill, true);
// The client's shared TRUE parser accepts the text TRUE (and a real boolean) and nothing else.
// The backend's isTruthyValue also accepts "1" and "YES" - a pre-existing difference, so the
// two contracts are asserted separately rather than assumed to match.
check('the text TRUE', normalizeTraining({ ...ROW, is_drill: 'TRUE' }).is_drill, true);
check('and any casing or padding', normalizeTraining({ ...ROW, is_drill: ' true ' }).is_drill, true);
check('but not an unrelated word', normalizeTraining({ ...ROW, is_drill: 'yes' }).is_drill, false);
check('and not a random number', normalizeTraining({ ...ROW, is_drill: '1' }).is_drill, false);
check('and rejects garbage', normalizeTraining({ ...ROW, is_drill: 'maybe' }).is_drill, false);
check('an empty row does not throw', normalizeTraining(null).id, '');

console.log('\n--- duration text ---');
check('whole hours', formatDuration('2'), '2 hrs');
check('one hour is singular', formatDuration('1'), '1 hr');
check('fractions survive', formatDuration('0.5'), '0.5 hrs');
check('so do quarter hours', formatDuration('2.25'), '2.25 hrs');
check('an unreadable value shows nothing', formatDuration('nope'), '');
check('a negative duration is rejected', parseDuration('-2'), null);

console.log('\n--- the time label ---');
check('start and duration together', trainingTimeLabel({ start_time: '08:00', duration: '2' }), '8:00 AM · 2 hrs');
check('24-hour mode', trainingTimeLabel({ start_time: '20:00', duration: '10' }, '24'), '20:00 · 10 hrs');
check('a missing duration leaves the time', trainingTimeLabel({ start_time: '08:00' }), '8:00 AM');
check('a missing time leaves the duration', trainingTimeLabel({ duration: '3' }), '3 hrs');
check('neither leaves an empty label', trainingTimeLabel({}), '');

console.log('\n--- the list and its order ---');
const LIST = [
  { id: 'a', date: '2026-03-01', start_time: '08:00', title: 'Older' },
  { id: 'b', date: '2026-03-14', start_time: '08:00', title: 'Newer (early)' },
  { id: 'c', date: '2026-03-14', start_time: '18:00', title: 'Newer (late)' },
  { id: 'd', date: 'nonsense', start_time: '08:00', title: 'No date' },
];
check(
  'most recent first, same-day later last',
  sortTrainingRows(LIST.map(normalizeTraining)).map((t) => t.id),
  ['c', 'b', 'a', 'd']
);
check('an unreadable date sorts to the end, not the top', sortTrainingRows(LIST.map(normalizeTraining))[3].id, 'd');
check('sorting does not mutate its input', LIST.map((t) => t.id), ['a', 'b', 'c', 'd']);
check('an empty list is fine', sortTrainingRows([]), []);
check('a non-array is fine', sortTrainingRows(undefined), []);
check('same date and time falls back to the title', sortTrainingRows([
  normalizeTraining({ id: 'x', date: '2026-03-14', start_time: '08:00', title: 'B' }),
  normalizeTraining({ id: 'y', date: '2026-03-14', start_time: '08:00', title: 'A' }),
]).map((t) => t.id), ['y', 'x']);
check(
  'oldest first',
  sortTrainingRows(LIST.map(normalizeTraining), 'date_asc').map((t) => t.id),
  ['a', 'b', 'c', 'd']
);
check(
  'undated rows stay LAST when reversed, not first',
  sortTrainingRows(LIST.map(normalizeTraining), 'date_asc')[3].id,
  'd'
);
check(
  'title order',
  sortTrainingRows(LIST.map(normalizeTraining), 'title_asc').map((t) => t.id),
  ['b', 'c', 'd', 'a']
);
check(
  'a day runs later-first in the newest-first view',
  sortTrainingRows(LIST.map(normalizeTraining)).map((t) => t.id).slice(0, 2),
  ['c', 'b']
);
check(
  'and earlier-first in the oldest-first view, mirroring its dates',
  sortTrainingRows(LIST.map(normalizeTraining), 'date_asc').map((t) => t.id).slice(1, 3),
  ['b', 'c']
);
check(
  'longest duration first, and a missing duration last',
  sortTrainingRows(
    [
      normalizeTraining({ id: 'short', date: '2026-03-01', duration: '1' }),
      normalizeTraining({ id: 'none', date: '2026-03-02' }),
      normalizeTraining({ id: 'long', date: '2026-03-03', duration: '8' }),
    ],
    'hours_desc'
  ).map((t) => t.id),
  ['long', 'short', 'none']
);
check('an unknown sort falls back to the default', sortTrainingRows(LIST.map(normalizeTraining), 'banana').map((t) => t.id), ['c', 'b', 'a', 'd']);


// Rows with no id or nothing to sign are dropped rather than rendered as blank lines.
check('a row with no id is dropped', normalizeTrainingList([{ ...ROW, id: '' }]).length, 0);
check('a missing id column is dropped', normalizeTrainingList([{ date: '2026-03-14', title: 'x' }]).length, 0);
check('a good row survives', normalizeTrainingList([ROW]).length, 1);
check('a non-array is an empty list', normalizeTrainingList(null), []);

console.log('\n--- signatures ---');
const SIGNATURES = [
  { id: 's1', training_id: 't1', user_id: 'u1' },
  { id: 's2', training_id: 't2', user_id: 'u1' },
  { id: 's3', training_id: 't1', user_id: 'u2' },
  // A duplicate row for the same member and training: the sheet is supposed to hold one, but a
  // hand edit can produce two, and the button state must still read as "signed".
  { id: 's4', training_id: 't1', user_id: 'u1' },
  { id: 's5', training_id: '', user_id: 'u1' },
  null,
];
const u1Signed = signedTrainingIds(SIGNATURES, 'u1');
check('a member\'s signed ids', [...u1Signed].sort(), ['t1', 't2']);
check('a duplicate still reads as one signature', u1Signed.size, 2);
check('another member sees only theirs', [...signedTrainingIds(SIGNATURES, 'u2')], ['t1']);
check('a member with none gets an empty set', signedTrainingIds(SIGNATURES, 'u9').size, 0);
check('ids are compared as strings', [...signedTrainingIds([{ training_id: 7, user_id: 7 }], '7')], ['7']);
check('a blank training id is ignored', signedTrainingIds([{ training_id: '', user_id: 'u1' }], 'u1').size, 0);
check('nulls in the list do not throw', signedTrainingIds([null, undefined], 'u1').size, 0);
check('a non-array is an empty set', signedTrainingIds(null, 'u1').size, 0);

check('signatures for one training', signaturesForTraining(SIGNATURES, 't1').map((s) => s.id), ['s1', 's3', 's4']);
check('counts per training', [...signatureCounts(SIGNATURES)], [['t1', 3], ['t2', 1]]);
check('the count includes the duplicate', signatureCounts(SIGNATURES).get('t1'), 3);
check('a training with no signatures has no count', signatureCounts(SIGNATURES).get('t9'), undefined);

console.log('\n--- filtering ---');
const FILTER_ROWS = [
  normalizeTraining({ id: 'f1', date: '2026-01-10', title: 'Jan drill', location: 'Station 1', duration: '2' }),
  normalizeTraining({ id: 'f2', date: '2026-02-14', title: 'Feb drill', location: 'Station 1', duration: '1.5' }),
  normalizeTraining({ id: 'f3', date: '2026-03-20', title: 'March class', location: 'Academy', duration: '4' }),
  normalizeTraining({ id: 'f4', date: 'nonsense', title: 'Undated', location: 'Academy', duration: '3' }),
];
const ids = (list) => list.map((t) => t.id);

check('no filters matches everything', ids(filterTrainings(FILTER_ROWS, {})), ['f1', 'f2', 'f3', 'f4']);
check('an empty filter object is fine', filterTrainings(FILTER_ROWS).length, 4);
check('a from date', ids(filterTrainings(FILTER_ROWS, { from: '2026-02-01' })), ['f2', 'f3']);
check('a to date', ids(filterTrainings(FILTER_ROWS, { to: '2026-02-28' })), ['f1', 'f2']);
check('a closed range', ids(filterTrainings(FILTER_ROWS, { from: '2026-02-01', to: '2026-03-01' })), ['f2']);
check('a range with no matches', filterTrainings(FILTER_ROWS, { from: '2027-01-01' }), []);
check(
  'an undated row cannot satisfy a range',
  ids(filterTrainings(FILTER_ROWS, { from: '2020-01-01' })).includes('f4'),
  false
);
check('location', ids(filterTrainings(FILTER_ROWS, { location: 'Academy' })), ['f3', 'f4']);
check('a location nothing was held at', filterTrainings(FILTER_ROWS, { location: 'Nowhere' }), []);
check('filters combine', ids(filterTrainings(FILTER_ROWS, { from: '2026-01-01', location: 'Station 1' })), ['f1', 'f2']);
check('a blank filter value is ignored', ids(filterTrainings(FILTER_ROWS, { location: '   ' })), ['f1', 'f2', 'f3', 'f4']);
check('nulls in the list are dropped', filterTrainings([null, undefined], {}).length, 0);
check('a non-array is an empty list', filterTrainings(null, {}), []);

// The member-side filters, driven by the ids the active member signed.
const signedF1F3 = new Set(['f1', 'f3']);
check(
  'signed only',
  ids(filterTrainings(FILTER_ROWS, { signed: 'yes' }, { signedIds: signedF1F3 })),
  ['f1', 'f3']
);
check(
  'not signed only',
  ids(filterTrainings(FILTER_ROWS, { signed: 'no' }, { signedIds: signedF1F3 })),
  ['f2', 'f4']
);
check(
  'the member filter and the signed filter agree',
  ids(filterTrainings(FILTER_ROWS, { member: 'u1' }, { signedIds: signedF1F3 })),
  ids(filterTrainings(FILTER_ROWS, { signed: 'yes' }, { signedIds: signedF1F3 }))
);
check('a member with no signatures sees nothing signed', filterTrainings(FILTER_ROWS, { signed: 'yes' }), []);

check('location options come from the rows', trainingLocationOptions(FILTER_ROWS), [
  { value: 'Academy', label: 'Academy' },
  { value: 'Station 1', label: 'Station 1' },
]);
check('duplicate locations collapse', trainingLocationOptions(FILTER_ROWS).length, 2);
check('no locations is an empty list', trainingLocationOptions([{ id: 'x' }]), []);
check('an empty filter set is blank', emptyTrainingFilters(), {
  from: '', to: '', location: '', member: '', signed: '',
});

console.log('\n--- training hours totals ---');
const totalsAll = trainingTotals(FILTER_ROWS, signedF1F3);
check('how many are shown', totalsAll.count, 4);
check('the hours sum', totalsAll.hours, 10.5);
check('how many are signed', totalsAll.signedCount, 2);
check('how many are outstanding', totalsAll.unsignedCount, 2);
check(
  'a row with no duration adds nothing but is still counted',
  trainingTotals([normalizeTraining({ id: 'x', duration: '' }), normalizeTraining({ id: 'y', duration: '2' })]),
  { count: 2, hours: 2, signedCount: 0, unsignedCount: 2 }
);
check(
  'the sum is rounded, not left as float noise',
  trainingTotals([
    normalizeTraining({ id: 'x', duration: '0.1' }),
    normalizeTraining({ id: 'y', duration: '0.2' }),
  ]).hours,
  0.3
);
check('an empty list totals zero', trainingTotals([]), { count: 0, hours: 0, signedCount: 0, unsignedCount: 0 });
check('a non-array totals zero', trainingTotals(null).hours, 0);
check('nulls in the list do not break the sum', trainingTotals([null, undefined]).count, 0);

// The totals must describe the FILTERED rows: that is the whole point of showing them.
check(
  'totals over a filtered set, not the whole list',
  trainingTotals(filterTrainings(FILTER_ROWS, { location: 'Academy' })).hours,
  7
);
check('formatting zero', formatTotalHours(0), '0 hrs');
check('formatting a singular hour', formatTotalHours(1), '1 hr');
check('formatting a fraction', formatTotalHours(1.5), '1.5 hrs');
check('formatting a negative is zero', formatTotalHours(-3), '0 hrs');
check('formatting a non-number is zero', formatTotalHours('abc'), '0 hrs');

console.log('\n--- the backend parses and guards a training the same way ---');
// The real functions, lifted out of Code.gs and run against stubs of the Apps Script globals
// they touch. The rules they carry - a date and title are required, signatures are filtered by
// member - are the promises the feature rests on, and they are enforced there, not only here.
const codeSource = readFileSync('src/services/Code.gs', 'utf8');
const extract = (name) => {
  const start = codeSource.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`Code.gs is missing ${name}()`);
  const end = codeSource.indexOf('\n}\n', start);
  return codeSource.slice(start, end + 3);
};

const sheetData = {};
globalThis.getSheetData = (_ss, name) => sheetData[name] || [];
globalThis.isTruthyValue = (value) => {
  if (value === true) return true;
  if (value === false || value === undefined || value === null) return false;
  const s = String(value).trim().toUpperCase();
  return s === 'TRUE' || s === '1' || s === 'YES';
};

const backend = new Function(
  `const TRAINING_BOOL_COLUMNS = ${JSON.stringify(TRAINING_FLAG_KEYS)};
   const TRAINING_TEXT_COLUMNS = ["date","title","start_time","duration","location","instructors","narrative"];
   ${extract('normalizeTrainingRow')}
   ${extract('trainingRowIsUsable')}
   ${extract('normalizeTrainingList')}
   ${extract('normalizeSignatureRowsFor')}
   ${extract('trainingSignaturesForUser')}
   return { normalizeTrainingRow, trainingRowIsUsable, normalizeTrainingList, normalizeSignatureRowsFor, trainingSignaturesForUser };`
)();

const backendRow = backend.normalizeTrainingRow(ROW);
check('the backend keeps the id', backendRow.id, 't1');
check('and the date as the sheet had it', backendRow.date, '2026-03-14');
check('and the duration as given', backendRow.duration, '2');
check('flags are written as TRUE/FALSE text', backendRow.is_certification, 'TRUE');
check('a false flag is written explicitly', backendRow.is_multicompany, 'FALSE');
check(
  'every flag column is present',
  TRAINING_FLAG_KEYS.every((k) => backendRow[k] === 'TRUE' || backendRow[k] === 'FALSE'),
  true
);
check(
  'and every text column too',
  ['date', 'title', 'start_time', 'duration', 'location', 'instructors', 'narrative'].every((k) => k in backendRow),
  true
);
check('a missing column becomes blank, not undefined', backend.normalizeTrainingRow({ id: 'x' }).location, '');
// The backend is the more permissive of the two parsers: it also accepts 1 and YES, and always
// writes back TRUE/FALSE, so a hand-edited sheet converges on the canonical value.
check('the backend accepts YES', backend.normalizeTrainingRow({ id: 'x', is_drill: 'yes' }).is_drill, 'TRUE');
check('and 1', backend.normalizeTrainingRow({ id: 'x', is_drill: 1 }).is_drill, 'TRUE');
check('but writes FALSE for anything else', backend.normalizeTrainingRow({ id: 'x', is_drill: 'maybe' }).is_drill, 'FALSE');

// The rule that stops a half-filled form writing an unusable row.
check('a row with a date and title is usable', backend.trainingRowIsUsable({ date: '2026-03-14', title: 'x' }), true);
check('a row with no date is not', backend.trainingRowIsUsable({ date: '', title: 'x' }), false);
check('a row with no title is not', backend.trainingRowIsUsable({ date: '2026-03-14', title: '  ' }), false);
check('and such rows are dropped from a save', backend.normalizeTrainingList([ROW, { id: 'bad' }]).length, 1);
check('the usable one is kept', backend.normalizeTrainingList([ROW, { id: 'bad' }])[0].id, 't1');

console.log('\n--- the backend filters signatures by member ---');
sheetData.training_signatures = [
  { id: 's1', training_id: 't1', user_id: 'u1' },
  { id: 's2', training_id: 't1', user_id: 'u2' },
  { id: 's3', training_id: '', user_id: 'u1' },
  { id: 's4', training_id: 't2', user_id: '' },
];
check('a member gets only their own', backend.trainingSignaturesForUser({}, 'u1').map((s) => s.id), ['s1']);
check('and not another member\'s', backend.trainingSignaturesForUser({}, 'u2').map((s) => s.id), ['s2']);
check('an incomplete row is dropped', backend.trainingSignaturesForUser({}, 'u1').length, 1);
check('the admin form of the filter returns everyone', backend.normalizeSignatureRowsFor({}, '', '').map((s) => s.id), ['s1', 's2']);
check('filtered to one training', backend.normalizeSignatureRowsFor({}, 't1', '').map((s) => s.id), ['s1', 's2']);
check('and to one member and one training', backend.normalizeSignatureRowsFor({}, 't1', 'u2').map((s) => s.id), ['s2']);

console.log('\n--- the rule: once signed, only Administration may change it ---');
// The Training module must not offer Edit on a training anybody has signed, and must never offer
// it on a locked one. The count comes from the server precisely because a member cannot see other
// members' signatures.
check('a fresh training is editable', trainingEditable({ signature_count: 0 }), true);
check('one with a signature is not', trainingEditable({ signature_count: 1 }), false);
check('and a missing count means none', trainingEditable({}), true);
check('the reason names signatures', /already signed/.test(trainingEditBlockedReason({ signature_count: 2 })), true);
check('and is empty when editable', trainingEditBlockedReason({ signature_count: 0 }), '');

const withCount = normalizeTraining({ ...ROW, signature_count: '3' });
check('the count is normalized to a number', withCount.signature_count, 3);
check('and defaults to zero', normalizeTraining({ ...ROW }).signature_count, 0);
check('a garbage count reads as zero', normalizeTraining({ ...ROW, signature_count: 'lots' }).signature_count, 0);

console.log('\n--- the lock: entered into an external system ---');
check('the flag marks a training locked', normalizeTraining({ ...ROW, is_entered_into_external: 'TRUE' }).locked, true);
check('and is false otherwise', normalizeTraining(ROW).locked, false);
check('a locked training is not editable', trainingEditable({ is_entered_into_external: true, signature_count: 0 }), false);
check('even with no signatures', trainingEditable({ is_entered_into_external: true }), false);
check('the reason names the lock', /external system/.test(trainingEditBlockedReason({ is_entered_into_external: true })), true);
// Order matters: a training that is both signed AND locked must report the lock, since that is
// the reason nobody at all can change it.
check(
  'the lock reason wins over the signature reason',
  /external system/.test(trainingEditBlockedReason({ is_entered_into_external: true, signature_count: 5 })),
  true
);
check('the locked flag is exposed on the row', normalizeTraining({ ...ROW, is_entered_into_external: 'TRUE' }).locked, true);

console.log('\n--- the external flag is administrative ---');
check('it is a flag column like the others', TRAINING_FLAG_KEYS.includes(ENTERED_EXTERNALLY_KEY), true);
check('but marked admin-only', TRAINING_FLAGS.find((f) => f.key === ENTERED_EXTERNALLY_KEY).adminOnly, true);
check('so a member-facing form does not offer it', MEMBER_EDITABLE_FLAGS.some((f) => f.key === ENTERED_EXTERNALLY_KEY), false);
check('while the admin form does', TRAINING_FLAGS.some((f) => f.key === ENTERED_EXTERNALLY_KEY), true);
check('and it is not a badge either', TRAINING_BADGES.some((f) => f.key === ENTERED_EXTERNALLY_KEY), false);
check('the other seven flags stay member-editable', MEMBER_EDITABLE_FLAGS.length, 7);
check('and are all badges', TRAINING_BADGES.length, 7);
// A row with only the external flag set must therefore show no badges at all.
check('a row with only the external flag has no badges', normalizeTraining({ ...ROW, is_entered_into_external: 'TRUE', is_certification: 'FALSE', is_drill: 'FALSE' }).flags.length, 0);
check('and a normal flag still badges', normalizeTraining({ ...ROW, is_certification: 'TRUE', is_drill: 'FALSE' }).flags.map((f) => f.key), ['is_certification']);

console.log('\n--- the backend enforces both rules ---');
// The counts helper and the refusal helper, run against a stubbed sheet. getSheetData is passed
// IN rather than referenced: a `new Function` body is compiled in global scope, so it cannot see
// this module's `sheetData`.
sheetData.training = [
  { id: 'open', date: '2026-03-14', title: 'Open training' },
  { id: 'locked', date: '2026-03-14', title: 'Filed training', is_entered_into_external: 'TRUE' },
];
const backendRules = new Function(
  'getSheetData',
  `${extract('normalizeSignatureRowsFor')}
   ${extract('trainingRowsById')}
   ${extract('trainingIsClosed')}
   ${extract('trainingSignatureCounts')}
   ${extract('trainingWriteRefusal')}
   return { trainingRowsById, trainingIsClosed, trainingSignatureCounts, trainingWriteRefusal };`
)((ss, name) => sheetData[name] || []);

check('rows are keyed by id', Object.keys(backendRules.trainingRowsById({})).sort(), ['locked', 'open']);
check('the marker is read as a boolean', backendRules.trainingIsClosed({ is_entered_into_external: 'TRUE' }), true);
check('and a blank one is not', backendRules.trainingIsClosed({}), false);
check('counts are per training', backendRules.trainingSignatureCounts({}), { t1: 2 });
// (the two incomplete stub rows - one with no training_id, one with no user_id - are excluded)
check('an open training can be written', backendRules.trainingWriteRefusal({}, ['open']), '');
check('a locked one cannot', /locked/.test(backendRules.trainingWriteRefusal({}, ['locked'])), true);
check('the refusal names it', /locked/.test(backendRules.trainingWriteRefusal({}, ['locked'])) && backendRules.trainingWriteRefusal({}, ['locked']).includes('locked'), true);
check('a new row (no id) is always allowed', backendRules.trainingWriteRefusal({}, ['']), '');
check('and a mixed batch is refused for the locked one', /locked/.test(backendRules.trainingWriteRefusal({}, ['open', 'locked'])), true);
check('an unknown id is not treated as locked', backendRules.trainingWriteRefusal({}, ['nope']), '');

// A UI-only guard is not a guard: these assertions read the dispatcher itself, so moving a
// permission check out of the backend fails here rather than shipping.
const slice = (from, to) => codeSource.slice(codeSource.indexOf(from), codeSource.indexOf(to));
const getCase = slice('case "GET_TRAINING"', 'case "SIGN_TRAINING"');
const signCase = slice('case "SIGN_TRAINING"', 'case "SAVE_TRAINING"');
const saveCase = slice('case "SAVE_TRAINING"', 'case "ADMIN_BULK_SAVE_TRAINING"');
const adminSaveCase = slice('case "ADMIN_BULK_SAVE_TRAINING"', 'case "ADMIN_REMOVE_TRAINING_SIGNATURE"');
const removeCase = slice('case "ADMIN_REMOVE_TRAINING_SIGNATURE"', 'case "ADMIN_SAVE_TIMECLOCK_ENTRY"');

check('every training action was found', [getCase, signCase, saveCase, adminSaveCase, removeCase].every((c) => c.length > 100), true);

check('reading requires a session', /getAuthContext\(ss, data\)/.test(getCase), true);
check('a member is handed only their own signatures', /trainingSignaturesForUser\(ss, authTraining\.userId\)/.test(getCase), true);
check('and the full set only to an administrator', /canAdministerTrainings\(ss, authTraining\.userId\)/.test(getCase), true);

check('signing requires can_sign_trainings', /canSignTrainings\(ss, authSign\.userId\)/.test(signCase), true);
check('signing refuses a removal', /Signatures cannot be removed/.test(signCase), true);
check(
  'and refuses it BEFORE writing anything',
  signCase.indexOf('Signatures cannot be removed') < signCase.indexOf('upsertSheetRowById'),
  true
);
check('signing cannot duplicate a signature', /alreadySigned/.test(signCase), true);
check('and requires the training to exist', /knownTrainingIds\.indexOf\(trainingId\) === -1/.test(signCase), true);
check('a duplicate is not counted as newly signed', /if \(alreadySigned\) return;/.test(signCase), true);

check('editing requires can_edit_trainings', /hasRolePermission\(ss, authTrainingEdit\.userId, "can_edit_trainings"\)/.test(saveCase), true);
check('and cannot delete', /Deleting a training requires the Training report permission/.test(saveCase), true);
check('the admin save requires can_administer_trainings', /canAdministerTrainings\(ss, authTrainingSave\.userId\)/.test(adminSaveCase), true);
check('and is the one that can delete', /bulkDeleteSheetRowsById/.test(adminSaveCase), true);

check('removing a signature requires can_administer_trainings', /canAdministerTrainings\(ss, authSignature\.userId\)/.test(removeCase), true);
check('and needs a specific row', /signature_id/.test(removeCase), true);
check(
  'and deletes only that row',
  /bulkDeleteSheetRowsById\(\s*ss\.getSheetByName\("training_signatures"\),\s*\[signatureId\]/.test(removeCase),
  true
);
check('and reports the row it removed', /targetSignature\.training_id/.test(removeCase), true);

console.log('\n--- and so do the two new rules ---');
// Rule: the Training module stops editing a training once anyone has signed it.
check('the module save refuses a SIGNED training', /has already been signed, so it can only be changed from the Administration/.test(saveCase), true);
check('by looking the signatures up server-side', /trainingSignatureCounts\(ss\)/.test(saveCase), true);
check('and reports it before writing', saveCase.indexOf('has already been signed') < saveCase.indexOf('saveTrainingRows'), true);

// Rule: a training entered into an external system is closed to everyone.
check('the module save refuses a LOCKED training', /trainingWriteRefusal\(ss, editedTrainingIds\)/.test(saveCase), true);
check('the admin save refuses a LOCKED training', /trainingWriteRefusal\(ss, writtenTrainingIds\.concat\(deleteTrainingIds\)\)/.test(adminSaveCase), true);
check('including one it is deleting', /writtenTrainingIds\.concat\(deleteTrainingIds\)/.test(adminSaveCase), true);
check('signing refuses a LOCKED training', /trainingWriteRefusal\(ss, requestedSignIds\)/.test(signCase), true);
check('and removing a signature refuses one too', /trainingWriteRefusal\(ss, \[targetSignature\.training_id\]\)/.test(removeCase), true);
// Every writing action is covered: the lock is not a UI convention.
check(
  'all four writing actions check the lock',
  [saveCase, adminSaveCase, signCase, removeCase].every((c) => /trainingWriteRefusal/.test(c)),
  true
);

// The signature counts have to reach the client for the module to grey out Edit.
check('the read hands back signature counts', /trainingRowsForApp\(ss\)/.test(getCase), true);


console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);


