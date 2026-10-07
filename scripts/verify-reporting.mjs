import reporting from '../functions/reporting.js';
// The member's own clock history rule, so the report's copy can be run against it rather than trusted.
import { clockLogHours } from '../src/utils/clockLogs.js';

const { aggregateScheduleRows, canUseReport, normalizeReportDefinition, reportAudienceKeys, resolveReportOptions } = reporting;
let failures = 0;
const check = (label, actual, expected) => {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  if (!passed) failures++;
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${passed ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};

const config = normalizeReportDefinition({
  name: 'Monthly coverage',
  dataset: 'schedule',
  visualization: 'line',
  group_by: 'month',
  scope: 'station',
  audience_role_ids: ['r2', 'r2'],
  audience_rank_ids: ['k1'],
});
check('report config generates deduplicated role/rank audience keys', config.audience_keys, ['role:r2', 'rank:k1']);
check('role match grants report access', canUseReport(config, 'r2', 'k9'), true);
check('rank match also grants report access', canUseReport(config, 'r9', 'k1'), true);
check('an unrelated role/rank pair is denied', canUseReport(config, 'r9', 'k9'), false);
check('all-viewers is an explicit wildcard', reportAudienceKeys({ everyone: true }), ['*']);
check(
  'schedule rows aggregate into chronological monthly buckets',
  aggregateScheduleRows(
    [
      { date_from: '2026-02-01', assignment_id: 'a1' },
      { date_from: '2026-01-15', assignment_id: 'a1' },
      { date_from: '2026-01-20', assignment_id: 'a2' },
    ],
    { groupBy: 'month' }
  ),
  [
    { key: '2026-01', label: '2026-01', value: 2 },
    { key: '2026-02', label: '2026-02', value: 1 },
  ]
);
check(
  'arbitrary datasets and fields cannot enter a report definition',
  [
    (() => { try { normalizeReportDefinition({ name: 'Bad', dataset: 'users' }); return false; } catch { return true; } })(),
    (() => { try { normalizeReportDefinition({ name: 'Bad', dataset: 'schedule', visualization: 'raw-query' }); return false; } catch { return true; } })(),
  ],
  [true, true]
);

console.log('\n--- the clock rule, which exists twice ---');
// The report sums clock hours on the server; the member's own Clock History sums them in the browser (and cannot ask the
// report, because that would ship a year of entries to the phone). Two copies, so they are run over the SAME rows here
// and any drift fails this - the arrangement the training summary's two reducers already have, for the same reason.
const CLOCK_ROWS = [
  { id: 'c1', time_in: '2026-01-05 08:00:00', time_out: '2026-01-05 12:00:00' }, // measured: 4
  { id: 'c2', time_in: '2026-01-05 13:00:00', time_out: '2026-01-05 19:30:00', calc_hours: '6.25' }, // the stored figure wins
  { id: 'c3', time_in: '2026-01-06 09:00:00', time_out: '' }, // still on station: no usable end
  { id: 'c4', time_in: '', time_out: '' }, // nothing to measure at all
  { id: 'c5', calc_hours: '0' }, // a stored zero is an answer, not a missing value
];
check(
  'the report and the clock history agree on every entry',
  CLOCK_ROWS.map((row) => reporting.clockEntryHours(row)),
  CLOCK_ROWS.map((row) => clockLogHours(row))
);
check('a shift with no end time is worth no HOURS rather than ending at midnight', reporting.minutesOfDay(''), null);
check('an overnight shift is worth the hours it actually spans', reporting.shiftRowHours({ schedule_template_id: 't2' }, new Map([['t2', { start_time: '22:00', end_time: '06:00' }]])), 8);

console.log('\n--- a reconciliation ---');
const TEMPLATES = [
  { id: 't1', start_time: '18:00', end_time: '22:00' }, // 4h
  { id: 't2', start_time: '22:00', end_time: '06:00' }, // 8h, overnight
];
const SHIFTS = [
  { user_id: 'u1', assignment_id: 'a1', schedule_template_id: 't1', date_from: '2026-01-05' },
  { user_id: 'u1', assignment_id: 'a2', schedule_template_id: 't2', date_from: '2026-01-06' },
  { user_id: 'u2', assignment_id: 'a1', schedule_template_id: '', date_from: '2026-01-05', start_time: '09:00', end_time: '12:00' },
];
const CLOCKS = [
  { user_id: 'u1', time_in: '2026-01-05 18:00:00', time_out: '2026-01-05 23:00:00' },
  { user_id: 'u2', time_in: '2026-01-05 09:00:00', time_out: '2026-01-05 12:00:00' },
  // Somebody who turned up with no shift of their own. This is the row the report exists for, and the one a matched-pairs
  // report would have thrown away.
  { user_id: 'u3', time_in: '2026-01-07 10:00:00', time_out: '2026-01-07 11:00:00' },
];
const USERS = [{ id: 'u1', name: 'Ana' }, { id: 'u2', name: 'Bo' }, { id: 'u3', name: 'Cy' }];
const reconcile = (extra = {}) =>
  reporting.aggregateReconciliation({ scheduleRows: SHIFTS, clockRows: CLOCKS, groupBy: 'member', users: USERS, templates: TEMPLATES, ...extra });

const all = reconcile();
check('scheduled hours come from the shift\u2019s own template, overnight included', all.find((r) => r.key === 'u1').values.scheduled_hours, 12);
check('and clocked hours from the entries', all.find((r) => r.key === 'u1').values.clocked_hours, 5);
check('the variance is the difference an officer is looking for', all.find((r) => r.key === 'u1').values.variance, -7);
check(
  'somebody who worked with no shift appears, not dropped',
  all.some((r) => r.key === 'u3' && r.values.scheduled_hours === 0 && r.values.clocked_hours === 1),
  true
);
check('worst difference first, either direction', all.map((r) => r.key), ['u1', 'u3', 'u2']);

// THE ASSIGNMENT FILTER NARROWS THE SCHEDULE ONLY, because a clock entry carries no assignment. u1 keeps every clocked
// hour and loses the unpaid shift, which is exactly what "tick the paid assignments" has to mean.
const paidOnly = reconcile({ assignmentIds: ['a1'] });
check('ticking an assignment narrows what counts as scheduled', paidOnly.find((r) => r.key === 'u1').values.scheduled_hours, 4);
check('and leaves the clocked side alone', paidOnly.find((r) => r.key === 'u1').values.clocked_hours, 5);
check('so the variance is against the paid schedule only', paidOnly.find((r) => r.key === 'u1').values.variance, 1);
check('a one-off shift is filtered by its own assignment too', paidOnly.find((r) => r.key === 'u2').values.scheduled_hours, 3);

// AN OPEN ENTRY IS NOT SILENTLY WORTH NOTHING: it is counted, so the report can say the figures exclude it.
const open = reconcile({ clockRows: [...CLOCKS, { user_id: 'u1', time_in: '2026-01-08 08:00:00', time_out: '' }] });
check('an entry still open is counted rather than added', open.find((r) => r.key === 'u1').values.open_clock_entries, 1);
check('and adds nothing to the hours', open.find((r) => r.key === 'u1').values.clocked_hours, 5);
// Grouped by month the members MERGE into one row, which is the point of the grouping: a station asking "how did January
// go?" wants one line, not one per member.
const byMonth = reconcile({ groupBy: 'month' });
check('grouping by month merges the members into one row', byMonth.map((r) => r.key), ['2026-01']);
check('with both sides totalled across them', [byMonth[0].values.scheduled_hours, byMonth[0].values.clocked_hours], [15, 9]);
check('and the variance of the totals, not the sum of the variances', byMonth[0].values.variance, -6);

console.log('\n--- the datasets a report may be written against ---');
check('the reconciliation is one of them', Object.keys(reporting.REPORT_DATASET_GROUPINGS), ['schedule', 'training', 'reconciliation']);
check('and it declares the measures a report can show', reporting.REPORT_DATASET_MEASURES.reconciliation, ['variance', 'scheduled_hours', 'clocked_hours', 'open_clock_entries']);
check(
  'a definition cannot open the assignment filter on a dataset that has no use for it',
  normalizeReportDefinition({ name: 'Coverage', dataset: 'schedule', allow_assignments: true, audience_all: true }).allow_assignments,
  false
);
check(
  'but can on the reconciliation',
  normalizeReportDefinition({ name: 'Paid vs clocked', dataset: 'reconciliation', group_by: 'member', allow_assignments: true, audience_all: true }).allow_assignments,
  true
);
check(
  'and the ticked assignments are read back out of a request',
  resolveReportOptions(
    normalizeReportDefinition({ name: 'Paid vs clocked', dataset: 'reconciliation', group_by: 'member', allow_assignments: true, audience_all: true }),
    { assignment_ids: ['a1', 'a1', 'a2'] }
  ).assignmentIds,
  ['a1', 'a2']
);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);