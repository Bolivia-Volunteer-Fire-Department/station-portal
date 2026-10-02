/**
 * Verifies the Training feature.
 *
 * Two halves, both of which have bitten this project before:
 *
 *   1. The pure logic in src/utils/training.js - parsing a training row, the flags, the sort, and
 *      the signature lookups. Sorting and "is this signed" are what the whole screen depends on.
 *      only ADD a signature, only an administrator can remove one, and a signature cannot be
 *      duplicated. These are the promises the feature rests on, and a UI-only version of them
 *      would be a security hole rather than a bug.
 *
 * Run with: npm run verify:training
 */
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
  trainingTimeLabel,
  trainingTotals,
  emptyTrainingFilters,
  filterTrainings,
  TRAINING_CATEGORY_OPTIONS,
  TRAINING_NO_CATEGORY,
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
  is_hazmat: 'TRUE',
  is_company_training: 'TRUE',
  is_multipanycompany: 'FALSE',
  narrative: 'Masks and bottles.',
};

console.log('--- one flag column per classification ---');
check('every flag column is covered', TRAINING_FLAGS.length, 9);
check('and they are the sheet columns', TRAINING_FLAG_KEYS, [
  'is_company_training',
  'is_hazmat',
  'is_ems',
  'is_fire_prevention',
  'is_multicompany',
  'is_training_facility',
  'is_officer_training',
  'is_driver_training',
  'is_entered_into_external',
]);
check('each has a label and a short badge', TRAINING_FLAGS.every((f) => f.label && f.short), true);
check('flags are unique', new Set(TRAINING_FLAG_KEYS).size, 9);

console.log('\n--- parsing a training row ---');
const training = normalizeTraining(ROW);
check('id is a string', training.id, 't1');
check('the date key is parsed', training.date_key, '2026-03-14');
check('the start time is normalized', training.start_time, '08:00');
check('the duration is a number', training.duration, 2);
check('the title survives', training.title, 'SCBA Refresher');
check('a missing flag reads false', training.is_multicompany, false);
check('a TRUE flag reads true', training.is_hazmat, true);
check('derived flags only include the set ones', training.flags.map((f) => f.key), ['is_company_training', 'is_hazmat']);
check('and the when label is derived', training.when_label, '8:00 AM · 2 hrs');

// The sheet is hand-editable, so every one of these reaches the app in practice.
check('an ISO date parses', normalizeTraining({ ...ROW, date: '2026-03-14T04:00:00.000Z' }).date_key, '2026-03-14');
check('a US-format date parses', normalizeTraining({ ...ROW, date: '3/14/2026' }).date_key, '2026-03-14');
check('an unreadable date parses to null', normalizeTraining({ ...ROW, date: 'sometime' }).date_key, null);
check('a leading-zero duration is a number', normalizeTraining({ ...ROW, duration: '2.5' }).duration, 2.5);
check('a blank duration is null', normalizeTraining({ ...ROW, duration: '' }).duration, null);
check('text in the duration is null', normalizeTraining({ ...ROW, duration: 'two hours' }).duration, null);
check('a zero duration is null, not "0 hrs"', normalizeTraining({ ...ROW, duration: '0' }).duration, null);
check('the bool parser accepts true', normalizeTraining({ ...ROW, is_company_training: true }).is_company_training, true);
// The client's shared TRUE parser accepts the text TRUE (and a real boolean) and nothing else.
// The backend's isTruthyValue also accepts "1" and "YES" - a pre-existing difference, so the
// two contracts are asserted separately rather than assumed to match.
check('the text TRUE', normalizeTraining({ ...ROW, is_company_training: 'TRUE' }).is_company_training, true);
check('and any casing or padding', normalizeTraining({ ...ROW, is_company_training: ' true ' }).is_company_training, true);
check('but not an unrelated word', normalizeTraining({ ...ROW, is_company_training: 'yes' }).is_company_training, false);
check('and not a random number', normalizeTraining({ ...ROW, is_company_training: '1' }).is_company_training, false);
check('and rejects garbage', normalizeTraining({ ...ROW, is_company_training: 'maybe' }).is_company_training, false);
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
  normalizeTraining({ id: 'f1', date: '2026-01-10', title: 'Jan drill', location: 'Station 1', duration: '2', is_company_training: 'TRUE' }),
  normalizeTraining({ id: 'f2', date: '2026-02-14', title: 'Feb drill', location: 'Station 1', duration: '1.5', is_hazmat: 'TRUE' }),
  normalizeTraining({ id: 'f3', date: '2026-03-20', title: 'March class', location: 'Academy', duration: '4', is_ems: 'TRUE', is_officer_training: 'TRUE' }),
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

// The Category filter added for the Training module and the report.
console.log('\n--- the category filter ---');
check('a category matches the rows tagged with it', ids(filterTrainings(FILTER_ROWS, { category: 'is_company_training' })), ['f1']);
check('the hazmat category', ids(filterTrainings(FILTER_ROWS, { category: 'is_hazmat' })), ['f2']);
check('the new EMS category', ids(filterTrainings(FILTER_ROWS, { category: 'is_ems' })), ['f3']);
// f3 is both EMS and officer training, so either filter finds it - a category filter is "has this
// tag", not "is only this tag".
check(
  'a row can be in more than one category',
  ids(filterTrainings(FILTER_ROWS, { category: 'is_officer_training' })),
  ['f3']
);
check(
  'a category nothing is tagged with',
  filterTrainings(FILTER_ROWS, { category: 'is_hazmat', from: '2027-01-01' }),
  []
);
check('it combines with the other filters', ids(filterTrainings(FILTER_ROWS, { category: 'is_ems', location: 'Station 1' })), []);
check('"No category" finds the untagged rows', ids(filterTrainings(FILTER_ROWS, { category: TRAINING_NO_CATEGORY })), ['f4']);
check(
  'and only those',
  ids(filterTrainings(FILTER_ROWS, { category: TRAINING_NO_CATEGORY })).includes('f3'),
  false
);
// is_drill and is_certification are the names these two had before the rename. An unrecognised value
// must not empty the table, so a stale filter is ignored rather than matching nothing.
check(
  'an unknown category is ignored rather than emptying the table',
  ids(filterTrainings(FILTER_ROWS, { category: 'is_drill' })),
  ['f1', 'f2', 'f3', 'f4']
);
check('a blank category is ignored', ids(filterTrainings(FILTER_ROWS, { category: '   ' })), ['f1', 'f2', 'f3', 'f4']);

// The options are derived from the flags, so the categories cannot drift from the badges, and the
// administrative flag - which is not a kind of training - is not offered as one.
check(
  'the filter offers every category a member can set',
  TRAINING_CATEGORY_OPTIONS.map((option) => option.value),
  ['', ...MEMBER_EDITABLE_FLAGS.map((flag) => flag.key), TRAINING_NO_CATEGORY]
);
check(
  'labelled the same as the badges',
  TRAINING_CATEGORY_OPTIONS.map((option) => option.label),
  ['All categories', 'Company Training', 'Hazmat', 'EMS', 'Fire prevention', 'Multi-company', 'Training Facility', 'Officer training', 'Driver training', 'No category']
);
check(
  'the external flag is not a category',
  TRAINING_CATEGORY_OPTIONS.some((option) => option.value === ENTERED_EXTERNALLY_KEY),
  false
);
check('clearing the filters clears the category too', emptyTrainingFilters().category, '');

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
  from: '', to: '', location: '', category: '', member: '', signed: '',
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
check('the other eight flags stay member-editable', MEMBER_EDITABLE_FLAGS.length, 8);
check('and are all badges', TRAINING_BADGES.length, 8);
// A row with only the external flag set must therefore show no badges at all.
check('a row with only the external flag has no badges', normalizeTraining({ ...ROW, is_entered_into_external: 'TRUE', is_hazmat: 'FALSE', is_company_training: 'FALSE' }).flags.length, 0);
check('and a normal flag still badges', normalizeTraining({ ...ROW, is_hazmat: 'TRUE', is_company_training: 'FALSE' }).flags.map((f) => f.key), ['is_hazmat']);

// --- the category columns ---

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);


