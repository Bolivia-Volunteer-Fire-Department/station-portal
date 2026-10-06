import React, { useEffect, useState } from 'react';
import { AlertCircle, BarChart3, Download, Loader2, PieChart as PieIcon, Printer, Rocket, Table2, TrendingUp } from 'lucide-react';
import { fetchAdminSections, fetchReports, runConfiguredReport } from '../services/api';
import { toDateKey } from '../utils/scheduleDate';
import { downloadCsv, reportCsvFileName, reportResultCsv } from '../utils/reportExport';
import {
  REPORT_GROUPINGS,
  REPORT_RANGE_PRESETS,
  TRAINING_CATEGORY_FILTERS,
  resolveReportRange,
} from '../utils/reportParameters';
import ViewportModal from './ViewportModal';
import PrintableReport from './PrintableReport';
import ReportChart from './ReportChart';

const VISUALS = {
  table: { label: 'Table', icon: Table2 },
  bar: { label: 'Bar chart', icon: BarChart3 },
  pie: { label: 'Pie chart', icon: PieIcon },
  line: { label: 'Line chart', icon: TrendingUp },
};

const REPORT_LAUNCH_FORM_ID = 'report-launch-form';
const INPUT_CLASS =
  'mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white';
const ACTION_BUTTON_CLASS =
  'inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700';

const rangeLabel = (preset) => REPORT_RANGE_PRESETS.find(([value]) => value === preset)?.[1] || 'This month';
const datasetLabel = (report) => (report.dataset === 'training' ? 'Training hours' : 'Schedule');

function ReportLauncher({ report, departmentName, knownMembers, onClose }) {
  const today = toDateKey(new Date());
  const initialRange = resolveReportRange(report.default_range, today);
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [groupBy, setGroupBy] = useState(report.group_by);
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
    report.allow_range !== false || report.allow_group_by || report.allow_visualization || report.allow_category || wantsMembers;

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
      });
      // What was chosen is kept with the result, because the printed copy has to say what it is a copy of.
      const names = members.filter((member) => memberIds.includes(String(member.id))).map((member) => member.name || member.id);
      setResult({
        ...answer,
        parameters: [
          ['Data source', datasetLabel(report)],
          ['Date range', `${answer.range.from} to ${answer.range.to}`],
          ['Group by', groupings.find(([value]) => value === answer.report.group_by)?.[1] || answer.report.group_by],
          ['Shown as', VISUALS[answer.report.visualization]?.label || 'Table'],
          ...(report.allow_category ? [['Category', TRAINING_CATEGORY_FILTERS.find(([value]) => value === category)?.[1] || 'All categories']] : []),
          ...(wantsMembers ? [['Members', names.length ? names.join(', ') : 'Everyone']] : []),
        ],
      });
    } catch (failure) {
      setResult(null);
      setError(failure.message || 'Could not run this report.');
    } finally {
      setRunning(false);
    }
  };

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
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Group by
                  <select value={groupBy} onChange={(event) => setGroupBy(event.target.value)} className={INPUT_CLASS}>
                    {groupings.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
              )}
              {report.allow_visualization && (
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Show as
                  <select value={visualization} onChange={(event) => setVisualization(event.target.value)} className={INPUT_CLASS}>
                    {Object.entries(VISUALS).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}
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
                        {member.name || member.id}
                      </label>
                    ))}
                    {visibleMembers.length === 0 && <p className="py-2 text-xs text-slate-500">No members match.</p>}
                  </div>
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
                    <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      <tr><th className="px-3 py-2">{result.report.group_by}</th><th className="px-3 py-2 text-right">{result.report.unit || 'Shifts'}</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700/70">
                      {result.rows.map((row) => <tr key={row.key}><td className="px-3 py-2 text-slate-800 dark:text-slate-200">{row.label}</td><td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{row.value}</td></tr>)}
                      {result.rows.length === 0 && <tr><td colSpan={2} className="px-3 py-10 text-center text-slate-500">No results for this date range.</td></tr>}
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
