import reporting from '../functions/reporting.js';

const { aggregateScheduleRows, canUseReport, normalizeReportDefinition, reportAudienceKeys } = reporting;
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

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);