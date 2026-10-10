import React, { useEffect, useState } from 'react';
import { AlertCircle, BarChart3, Download, Loader2, PieChart as PieIcon, Printer, Rocket, Table2, TrendingUp } from 'lucide-react';
import { fetchAdminSections, fetchReports, fetchScheduleSetup, runConfiguredReport } from '../services/api';
import { toDateKey } from '../utils/scheduleDate';
import { userLabel } from '../utils/displayLabel';
import { downloadCsv, reportCsvFileName, reportResultCsv, reportMeasureColumns } from '../utils/reportExport';
import {
  REPORT_GROUPINGS,
  REPORT_RANGE_PRESETS,
  TRAINING_CATEGORY_FILTERS,
  resolveReportRange,
} from '../utils/reportParameters';
import ViewportModal from './ViewportModal';
import ReportGroupingPicker from './ReportGroupingPicker';
import PrintableReport from './PrintableReport';
import ReportChart from './ReportChart';

const VISUALS = {
  table: { label: 'Table', icon: Table2 },
  bar: { label: 'Bar chart', icon: BarChart3 },
  pie: { label: 'Pie chart', icon: PieIcon },
  line: { label: 'Line chart', icon: TrendingUp },
};

// The extra numbers a reconciliation carries, labelled the way an officer says them rather than the way the server names
// them. The keys are functions/reporting's own measure names, so the table and the engine cannot disagree about what a
// column is - and `datasetLabel` below is the same idea for the datasets themselves.
const MEASURE_LABELS = {
  scheduled_hours: 'Scheduled',
  clocked_hours: 'Clocked in',
  variance: 'Difference',
  open_clock_entries: 'Still open',
};

const REPORT_LAUNCH_FORM_ID = 'report-launch-form';
const INPUT_CLASS =
  'mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white';
const ACTION_BUTTON_CLASS =
  'inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700';

const rangeLabel = (preset) => REPORT_RANGE_PRESETS.find(([value]) => value === preset)?.[1] || 'This month';
const datasetLabel = (report) =>
  report.dataset === 'training'
    ? 'Training hours'
    : report.dataset === 'reconciliation'
      ? 'Clocked vs scheduled'
      : 'Schedule';

function ReportLauncher({ report, departmentName, knownMembers, onClose }) {
  const today = toDateKey(new Date());
  const initialRange = resolveReportRange(report.default_range, today);
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  // THE LEVELS THIS RUN GROUPS BY, in order. A definition saved before groupings were a list holds a bare string, so
  // both shapes read the same here.
  const [groupBy, setGroupBy] = useState(() => {
    const own = [].concat(report.group_by || [])
      .map((level) => String(level || '').trim())
      .filter(Boolean);
    return own.length ? own : [(REPORT_GROUPINGS[report.dataset] || [])[0]?.[0] || 'month'];
  });
  const [visualization, setVisualization] = useState(report.visualization);
  const [category, setCategory] = useState('');
  const [memberIds, setMemberIds] = useState([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [fetchedMembers, setFetchedMembers] = useState(null);
  const [membersError, setMembersError] = useState('');
  const wantsMembers = report.allow_members === true;
  // The crew list is read only for a report that asks for it, and not at all when the app already holds one.
  const needsFetch = wantsMembers && !knownMembers.length;
  const members = knownMembers.length ? knownMembers : fetchedMembers || [];

  // WHICH ASSIGNMENTS COUNT AS PAID, for a reconciliation. There is deliberately no column on the assignment saying so:
  // "is this paid?" is a question about THIS comparison, and a station whose one paid assignment changed would otherwise
  // have to edit the assignment and live with the answer everywhere else. So the officer ticks them, and the report
  // compares the schedule built from those against every hour anybody clocked.
  //
  // The list is the station's own assignments, read from the same schedule setup the calendars use - so a member running
  // their own reconciliation needs no permission they do not already have to see the shift names on their own calendar.
  const wantsAssignments = report.allow_assignments === true;
  const [assignmentIds, setAssignmentIds] = useState([]);
  const [assignmentSearch, setAssignmentSearch] = useState('');
  const [fetchedAssignments, setFetchedAssignments] = useState(null);
  const [fetchedTemplates, setFetchedTemplates] = useState(null);
  const [assignmentsError, setAssignmentsError] = useState('');
  const assignmentOptions = Array.isArray(fetchedAssignments) ? fetchedAssignments : [];
  const visibleAssignments = assignmentOptions.filter((row) =>
    String(row?.description || '').toLowerCase().includes(assignmentSearch.trim().toLowerCase())
  );
  const toggleAssignment = (id) =>
    setAssignmentIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );

  // THE FINER AXIS: which SHIFT TEMPLATES count. An assignment can carry several patterns at different pay rates -
  // `Officer` is one assignment, but "Officer - Day" and "Officer - Night" are two templates - so reconciling pay means
  // ticking the pattern rather than the whole assignment. Both lists come from the one schedule-setup read above.
  const [templateIds, setTemplateIds] = useState([]);
  const [templateSearch, setTemplateSearch] = useState('');
  const templateOptions = Array.isArray(fetchedTemplates) ? fetchedTemplates : [];
  const assignmentName = (id) =>
    String(assignmentOptions.find((row) => String(row.id) === String(id))?.description || '').trim();
  // Labelled the way the board draws a shift: the assignment, then the pattern that tells two of them apart.
  const templateLabel = (row) => {
    const nickname = String(row?.nickname || '').trim();
    const assignment = assignmentName(row?.assignment_id);
    if (assignment && nickname) return `${assignment} — ${nickname}`;
    return assignment || nickname || 'Unnamed shift';
  };
  const visibleTemplates = templateOptions.filter((row) =>
    templateLabel(row).toLowerCase().includes(templateSearch.trim().toLowerCase())
  );
  const toggleTemplate = (id) =>
    setTemplateIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));

  useEffect(() => {
    if (!wantsAssignments || fetchedAssignments !== null) return undefined;
    let cancelled = false;
    fetchScheduleSetup()
      .then((data) => {
        if (cancelled) return;
        setFetchedAssignments(Array.isArray(data?.assignments) ? data.assignments : []);
        // The templates come from the SAME read - they are the station's schedule setup, which is what the calendars
        // already load - so the second list costs no extra request.
        setFetchedTemplates(Array.isArray(data?.scheduleTemplates) ? data.scheduleTemplates : []);
      })
      .catch((failure) => {
        if (!cancelled) setAssignmentsError(failure.message || 'Could not load the assignments.');
      });
    return () => {
      cancelled = true;
    };
  }, [wantsAssignments, fetchedAssignments]);

  useEffect(() => {
    if (!needsFetch) return undefined;
    let cancelled = false;
    fetchAdminSections(['directory'])
      .then((data) => {
        if (!cancelled) setFetchedMembers(Array.isArray(data?.directory) ? data.directory : []);
      })
      .catch((failure) => {
        if (!cancelled) setMembersError(failure.message || 'Could not load the crew list.');
      });
    return () => {
      cancelled = true;
    };
  }, [needsFetch]);

  const visibleMembers = members
    .filter((member) => String(member.name || '').toLowerCase().includes(memberSearch.trim().toLowerCase()))
    .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));
  const toggleMember = (id) =>
    setMemberIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [error, setError] = useState('');

  const groupings = REPORT_GROUPINGS[report.dataset] || REPORT_GROUPINGS.schedule;
  const hasEditableParameters =
    report.allow_range !== false || report.allow_group_by || report.allow_visualization || report.allow_category || wantsMembers || wantsAssignments;

  const run = async (event) => {
    event.preventDefault();
    setRunning(true);
    setError('');
    try {
      const answer = await runConfiguredReport({
        reportId: report.id,
        from,
        to,
        group_by: groupBy,
        visualization,
        category,
        member_ids: memberIds,
        // Only sent when the definition opened it up; the server ignores it otherwise (resolveReportOptions).
        assignment_ids: wantsAssignments ? assignmentIds : [],
        template_ids: wantsAssignments ? templateIds : [],
      });
      // What was chosen is kept with the result, because the printed copy has to say what it is a copy of.
      const names = members.filter((member) => memberIds.includes(String(member.id))).map((member) => userLabel(member));
      setResult({
        ...answer,
        parameters: [
          ['Data source', datasetLabel(report)],
          ['Date range', `${answer.range.from} to ${answer.range.to}`],
          ['Group by', groupings.find(([value]) => value === answer.report.group_by)?.[1] || answer.report.group_by],
          ['Shown as', VISUALS[answer.report.visualization]?.label || 'Table'],
          ...(report.allow_category ? [['Category', TRAINING_CATEGORY_FILTERS.find(([value]) => value === category)?.[1] || 'All categories']] : []),
          ...(wantsMembers ? [['Members', names.length ? names.join(', ') : 'Everyone']] : []),
          ...(wantsAssignments
            ? [
                [
                  'Paid assignments',
                  assignmentIds.length
                    ? assignmentOptions
                        .filter((row) => assignmentIds.includes(String(row.id)))
                        .map((row) => String(row.description || '').trim() || 'Unnamed assignment')
                        .join(', ')
                    : 'Every assignment',
                ],
                [
                  'Paid shift templates',
                  templateIds.length
                    ? templateOptions
                        .filter((row) => templateIds.includes(String(row.id)))
                        .map((row) => templateLabel(row))
                        .join(', ')
                    : 'Every template',
                ],
              ]
            : []),
        ],
      });
    } catch (failure) {
      setResult(null);
      setError(failure.message || 'Could not run this report.');
    } finally {
      setRunning(false);
    }
  };

  // A RECONCILIATION CARRIES MORE THAN ONE NUMBER PER ROW, so the table grows a column per measure rather than pretending
  // the single `value` is the whole answer. `value` is the variance - the finding - and the two totals sit beside it.
  // "Still open" appears only when there IS one, because a column of zeroes is furniture until it is not.
  // The extra numbers a reconciliation carries, in the one place all three renderers (screen, print, CSV) read them from.
  const measureColumns = reportMeasureColumns(result);
  const hasMeasures = measureColumns.length > 0;

  // ONE COLUMN PER GROUPING LEVEL, which is what makes "month, then member" readable as a table: a month's members sit
  // together under a repeated month, and no nested rows are needed. A single-level report draws the same single column it
  // always did.
  const groupingLevels = result
    ? [].concat(result.report.group_by || []).filter(Boolean)
    : [];
  const availableGroupings = result ? REPORT_GROUPINGS[result.report.dataset] || [] : [];
  const groupColumns = groupingLevels.length
    ? groupingLevels.map((level) => availableGroupings.find(([value]) => value === level)?.[1] || level)
    : ['Group'];
  // What a heading row spans: every column, so a month's name reads across the whole width rather than under one heading.
  const totalColumns = groupColumns.length + Math.max(measureColumns.length, 1);

  const actions = result ? (
    <>
      <button type="button" onClick={() => setPrintOpen(true)} disabled={!result.rows.length || running} className={ACTION_BUTTON_CLASS}>
        <Printer className="h-4 w-4" /> Print
      </button>
      <button
        type="button"
        onClick={() => downloadCsv(reportResultCsv(result), reportCsvFileName(result))}
        disabled={!result.rows.length || running}
        className={ACTION_BUTTON_CLASS}
      >
        <Download className="h-4 w-4" /> Export CSV
      </button>
    </>
  ) : null;

  return (
    <>
      <ViewportModal
        title={report.name}
        subtitle={report.description || datasetLabel(report)}
        icon={<Rocket className="h-4 w-4" />}
        formId={REPORT_LAUNCH_FORM_ID}
        saveLabel={result ? 'Run again' : 'Run report'}
        saving={running}
        busy={running}
        busyLabel="Running…"
        actions={actions}
        onClose={onClose}
      >
        <form id={REPORT_LAUNCH_FORM_ID} onSubmit={run} className="space-y-5 p-4 sm:p-6">
          {error && (
            <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Parameters</h3>
            <div className="grid gap-4 @lg:grid-cols-2">
              {report.allow_range !== false ? (
                <>
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    From
                    <input type="date" required value={from} max={to} onChange={(event) => setFrom(event.target.value)} className={INPUT_CLASS} />
                  </label>
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Through
                    <input type="date" required value={to} min={from} onChange={(event) => setTo(event.target.value)} className={INPUT_CLASS} />
                  </label>
                </>
              ) : (
                <p className="text-sm text-slate-600 dark:text-slate-300 @lg:col-span-2">
                  Date range: <span className="font-semibold">{rangeLabel(report.default_range)}</span> ({from} to {to})
                </p>
              )}
              {report.allow_group_by && (
                <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 @lg:col-span-2">
                  Group by
                  <div className="mt-1">
                    <ReportGroupingPicker
                      value={groupBy}
                      options={groupings}
                      onChange={(levels) => {
                        setGroupBy(levels);
                        // A CHART HAS ONE AXIS, so adding a second grouping switches this run to a table rather than
                        // leaving a bar graph that cannot be drawn. The choice is disabled below as well; this is what
                        // makes it true the moment the level is added.
                        if (levels.length > 1) setVisualization('table');
                      }}
                      fieldClass={INPUT_CLASS}
                    />
                  </div>
                </div>
              )}
              {report.allow_visualization && (
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Show as
                  <select value={visualization} onChange={(event) => setVisualization(event.target.value)} className={INPUT_CLASS}>
                    {Object.entries(VISUALS).map(([value, option]) => (
                      <option key={value} value={value} disabled={groupBy.length > 1 && value !== 'table'}>
                        {option.label}{groupBy.length > 1 && value !== 'table' ? ' (one grouping only)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {report.allow_category && (
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Category
                  <select value={category} onChange={(event) => setCategory(event.target.value)} className={INPUT_CLASS}>
                    {TRAINING_CATEGORY_FILTERS.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}
                  </select>
                </label>
              )}
            </div>
            {wantsMembers && (
              <div className="mt-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Members {memberIds.length ? `(${memberIds.length} selected)` : '(everyone)'}
                  </p>
                  {memberIds.length > 0 && (
                    <button type="button" onClick={() => setMemberIds([])} className="text-xs font-medium text-red-600 hover:underline">Clear</button>
                  )}
                </div>
                <input
                  type="search"
                  value={memberSearch}
                  onChange={(event) => setMemberSearch(event.target.value)}
                  placeholder="Search members"
                  className={INPUT_CLASS}
                />
                {membersError ? (
                  <p className="mt-2 text-xs text-red-600">{membersError}</p>
                ) : needsFetch && fetchedMembers === null ? (
                  <p className="mt-2 flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading members…</p>
                ) : (
                  <div className="mt-2 grid max-h-48 gap-x-4 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-700 @lg:grid-cols-2">
                    {visibleMembers.map((member) => (
                      <label key={member.id} className="flex items-center gap-2 py-1 text-sm text-slate-700 dark:text-slate-200">
                        <input type="checkbox" checked={memberIds.includes(String(member.id))} onChange={() => toggleMember(String(member.id))} className="accent-red-600" />
                        {userLabel(member)}
                      </label>
                    ))}
                    {visibleMembers.length === 0 && <p className="py-2 text-xs text-slate-500">No members match.</p>}
                  </div>
                )}
              </div>
            )}
            {wantsAssignments && (
              <div className="mt-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Assignments counted as paid{' '}
                    {assignmentIds.length ? `(${assignmentIds.length} selected)` : '(every assignment)'}
                  </p>
                  {assignmentIds.length > 0 && (
                    <button type="button" onClick={() => setAssignmentIds([])} className="text-xs font-medium text-red-600 hover:underline">Clear</button>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Only the ticked assignments count as <span className="font-medium">scheduled</span> time. Every clocked
                  hour still counts &mdash; a clock entry does not say which shift somebody was on, and the hours nobody
                  scheduled are the ones worth seeing. Tick nothing to count them all.
                </p>
                <input
                  type="search"
                  value={assignmentSearch}
                  onChange={(event) => setAssignmentSearch(event.target.value)}
                  placeholder="Search assignments"
                  className={INPUT_CLASS}
                />
                {assignmentsError ? (
                  <p className="mt-2 text-xs text-red-600">{assignmentsError}</p>
                ) : fetchedAssignments === null ? (
                  <p className="mt-2 flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading assignments…</p>
                ) : (
                  <>
                    <div className="mt-2 grid max-h-40 gap-x-4 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-700 @lg:grid-cols-2">
                      {visibleAssignments.map((row) => (
                        <label key={row.id} className="flex items-center gap-2 py-1 text-sm text-slate-700 dark:text-slate-200">
                          <input type="checkbox" checked={assignmentIds.includes(String(row.id))} onChange={() => toggleAssignment(String(row.id))} className="accent-red-600" />
                          {String(row.description || '').trim() || 'Unnamed assignment'}
                        </label>
                      ))}
                      {visibleAssignments.length === 0 && <p className="py-2 text-xs text-slate-500">No assignments match.</p>}
                    </div>

                    {/* THE PATTERNS UNDER THOSE ASSIGNMENTS. An assignment's shifts can be several templates at different
                        pay rates, so this is the list that separates them - see templateLabel. */}
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                        Shift templates{' '}
                        {templateIds.length ? `(${templateIds.length} selected)` : '(every template)'}
                      </p>
                      {templateIds.length > 0 && (
                        <button type="button" onClick={() => setTemplateIds([])} className="text-xs font-medium text-red-600 hover:underline">Clear</button>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Narrow it further to a pattern &mdash; an assignment with a day shift and a night shift at different
                      rates is two templates. A one-off shift has no template, so ticking any template leaves those out.
                    </p>
                    <input
                      type="search"
                      value={templateSearch}
                      onChange={(event) => setTemplateSearch(event.target.value)}
                      placeholder="Search shift templates"
                      className={INPUT_CLASS}
                    />
                    <div className="mt-2 grid max-h-40 gap-x-4 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-700 @lg:grid-cols-2">
                      {visibleTemplates.map((row) => (
                        <label key={row.id} className="flex items-center gap-2 py-1 text-sm text-slate-700 dark:text-slate-200">
                          <input type="checkbox" checked={templateIds.includes(String(row.id))} onChange={() => toggleTemplate(String(row.id))} className="accent-red-600" />
                          {templateLabel(row)}
                        </label>
                      ))}
                      {visibleTemplates.length === 0 && <p className="py-2 text-xs text-slate-500">No shift templates match.</p>}
                    </div>
                  </>
                )}
              </div>
            )}
            {!hasEditableParameters && <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">This report has no adjustable parameters.</p>}
          </section>

          {result && (
            <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-500 dark:text-slate-400">{result.range.from} to {result.range.to} · {result.rows.length} groups</p>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                  {React.createElement(VISUALS[result.report.visualization]?.icon || Table2, { className: 'h-3.5 w-3.5' })}
                  {VISUALS[result.report.visualization]?.label || 'Table'}
                </span>
              </div>

              {result.truncated && <p className="mb-3 text-xs text-amber-700 dark:text-amber-300">Showing the first 5,000 matching shifts. Narrow the date range for a complete report.</p>}

              {result.report.visualization === 'table' ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-white/95 dark:bg-slate-800/95 backdrop-blur-sm border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      <tr>
                        {groupColumns.map((label, index) => (
                          <th key={`${label}-${index}`} className="px-3 py-2">{label}</th>
                        ))}
                        {measureColumns.map((measure) => <th key={measure} className="px-3 py-2 text-right">{MEASURE_LABELS[measure]}</th>)}
                        {!hasMeasures && <th className="px-3 py-2 text-right">{result.report.unit || 'Shifts'}</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700/70">
                      {result.rows.map((row, rowIndex) => {
                        const parts = row.levels && row.levels.length ? row.levels : [row.label];
                        const above = rowIndex > 0 ? result.rows[rowIndex - 1] : null;
                        const previous = above
                          ? (above.levels && above.levels.length ? above.levels : [above.label])
                          : [];
                        // A HEADING IS DRAWN WHEN THE VALUE AT THAT LEVEL CHANGES, so a month is named once and its
                        // members read underneath it - which is the whole point of grouping by two things. The deepest
                        // level is not a heading: it is the row that carries the numbers.
                        const headings = parts
                          .slice(0, -1)
                          .map((value, depth) => (previous[depth] === value ? null : { value, depth }))
                          .filter(Boolean);
                        return (
                          <React.Fragment key={row.key}>
                            {headings.map((heading) => (
                              <tr key={`${row.key}-heading-${heading.depth}`} className="bg-slate-50 dark:bg-slate-900/60">
                                <td
                                  colSpan={totalColumns}
                                  className="px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-200"
                                  style={{ paddingLeft: `${heading.depth * 1.25 + 0.75}rem` }}
                                >
                                  {heading.value}
                                </td>
                              </tr>
                            ))}
                            <tr>
                              <td
                                colSpan={groupColumns.length}
                                className="px-3 py-2 text-slate-800 dark:text-slate-200"
                                style={{ paddingLeft: `${(parts.length - 1) * 1.25 + 0.75}rem` }}
                              >
                                {parts[parts.length - 1]}
                              </td>
                              {measureColumns.map((measure) => (
                                <td key={measure} className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">
                                  {row.values?.[measure] ?? ''}
                                </td>
                              ))}
                              {!hasMeasures && <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{row.value}</td>}
                            </tr>
                          </React.Fragment>
                        );
                      })}
                      {result.rows.length === 0 && <tr><td colSpan={measureColumns.length + (hasMeasures ? 1 : 2)} className="px-3 py-10 text-center text-slate-500">No results for this date range.</td></tr>}
                    </tbody>
                  </table>
                </div>
              ) : <ReportChart result={result} />}
            </section>
          )}
        </form>
      </ViewportModal>
      {printOpen && result && (
        <PrintableReport result={result} departmentName={departmentName} onDone={() => setPrintOpen(false)} />
      )}
    </>
  );
}

export default function ReportsModule({ departmentName = '', members = [] }) {
  const [reports, setReports] = useState([]);
  const [launched, setLaunched] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchReports()
      .then((rows) => {
        if (!cancelled) setReports(rows.slice().sort((left, right) => String(left.name).localeCompare(String(right.name))));
      })
      .catch((failure) => {
        if (!cancelled) setError(failure.message || 'Could not load reports.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-5">
      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <header className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Available reports</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">Launch a report, set its parameters and run it.</p>
        </header>

        {loading ? (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading reports…</div>
        ) : reports.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">No reports shared with you.</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700/70">
            {reports.map((report) => (
              <div key={report.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900 dark:text-white">{report.name}</span>
                  {report.description && <p className="truncate text-xs text-slate-500 dark:text-slate-400">{report.description}</p>}
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    {datasetLabel(report)} · {VISUALS[report.visualization]?.label || 'Table'} · {rangeLabel(report.default_range)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setLaunched(report)}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-500"
                >
                  <Rocket className="h-4 w-4" /> Launch Report
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {launched && <ReportLauncher report={launched} departmentName={departmentName} knownMembers={members} onClose={() => setLaunched(null)} />}
    </div>
  );
}
