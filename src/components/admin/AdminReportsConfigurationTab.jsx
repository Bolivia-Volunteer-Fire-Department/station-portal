import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import ConfirmModal from '../ConfirmModal';
import ViewportModal from '../ViewportModal';
import { REPORT_RANGE_PRESETS } from '../../utils/reportParameters';
import {
  deleteReportConfiguration,
  fetchReportConfigurations,
  saveReportConfiguration,
} from '../../services/api';

const EMPTY_REPORT = {
  id: '',
  name: '',
  description: '',
  dataset: 'schedule',
  visualization: 'table',
  group_by: 'assignment',
  scope: 'station',
  default_range: 'this_month',
  allow_range: true,
  allow_group_by: false,
  allow_visualization: false,
  allow_category: false,
  allow_members: false,
  allow_assignments: false,
  audience_all: false,
  audience_role_ids: [],
  audience_rank_ids: [],
  enabled: true,
};

const REPORT_FORM_ID = 'report-editor-form';

const DATASETS = {
  schedule: {
    label: 'Schedule',
    groupings: [['assignment', 'Assignment'], ['member', 'Member'], ['day', 'Day'], ['month', 'Month']],
    mine: 'My schedule (requires View their schedule)',
    station: 'Station schedule (requires See whole crew or Manage schedule)',
    summary: 'Station schedule',
  },
  training: {
    label: 'Training (hours)',
    groupings: [['category', 'Category'], ['member', 'Member'], ['training', 'Training'], ['day', 'Day'], ['month', 'Month']],
    mine: 'My training (requires Sign trainings)',
    station: 'Everyone\'s training (requires Administer trainings)',
    summary: 'Station training',
  },
  // WHAT WAS SCHEDULED AGAINST WHAT WAS ACTUALLY WORKED. The one dataset whose numbers an officer reconciles rather than
  // reads: hours scheduled, hours clocked in, and the difference. It reads BOTH the schedule and the timeclock, which is
  // why the station scope asks for the clock permission as well - see reportScopeIsAllowed in functions/index.js.
  reconciliation: {
    label: 'Clocked vs scheduled (hours)',
    groupings: [['member', 'Member'], ['day', 'Day'], ['month', 'Month']],
    mine: 'My hours (requires View their schedule)',
    station: 'Everyone\'s hours (requires Manage the timeclock and a schedule permission)',
    summary: 'Clocked vs scheduled',
  },
};

const FIELD_CLASS =
  'mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white';

const toggleId = (values, id) =>
  values.includes(id) ? values.filter((value) => value !== id) : [...values, id];

export default function AdminReportsConfigurationTab({ roles = [], ranks = [] }) {
  const [reports, setReports] = useState([]);
  const [form, setForm] = useState(EMPTY_REPORT);
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchReportConfigurations();
      setReports(result.slice().sort((left, right) => left.name.localeCompare(right.name)));
    } catch (failure) {
      setError(failure.message || 'Could not load report configurations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const beginNew = () => {
    setError('');
    setForm(EMPTY_REPORT);
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setForm(EMPTY_REPORT);
  };

  const beginEdit = (report) => {
    setError('');
    setEditorOpen(true);
    setForm({
      ...EMPTY_REPORT,
      ...report,
      audience_role_ids: Array.isArray(report.audience_role_ids) ? report.audience_role_ids : [],
      audience_rank_ids: Array.isArray(report.audience_rank_ids) ? report.audience_rank_ids : [],
    });
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const result = await saveReportConfiguration(form);
      if (!result?.success) throw new Error(result?.message || 'Could not save this report.');
      closeEditor();
      await refresh();
    } catch (failure) {
      setError(failure.message || 'Could not save this report.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const report = pendingDelete;
    setPendingDelete(null);
    if (!report) return;
    setError('');
    try {
      const result = await deleteReportConfiguration(report.id);
      if (!result?.success) throw new Error(result?.message || 'Could not delete this report.');
      if (form.id === report.id) closeEditor();
      await refresh();
    } catch (failure) {
      setError(failure.message || 'Could not delete this report.');
    }
  };

  return (
    <div className="space-y-5">
      {error && !editorOpen && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Report definitions</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Schedule summaries, scoped by date when a report is run.</p>
          </div>
          <button type="button" onClick={beginNew} className="inline-flex h-9 items-center gap-2 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-500">
            <Plus className="h-4 w-4" /> New report
          </button>
        </header>

        {loading ? (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading reports…</div>
        ) : reports.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">No reports configured.</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700/70">
            {reports.map((report) => (
              <div key={report.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-900 dark:text-white">{report.name}</span>
                    {!report.enabled && <span className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">Disabled</span>}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{report.scope === 'station' ? (DATASETS[report.dataset] || DATASETS.schedule).summary : 'My ' + (report.dataset === 'training' ? 'training' : 'schedule')} · {report.visualization} · by {report.group_by}</p>
                </div>
                <button type="button" onClick={() => beginEdit(report)} title={`Edit ${report.name}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
                <button type="button" onClick={() => setPendingDelete(report)} title={`Delete ${report.name}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-200 px-3 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/50">
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {editorOpen && (
        <ViewportModal
          title={form.id ? 'Edit report' : 'New report'}
          subtitle={form.id ? form.name : 'Not saved yet'}
          formId={REPORT_FORM_ID}
          saveLabel={form.id ? 'Save changes' : 'Save report'}
          saving={saving}
          onClose={closeEditor}
        >
        <form id={REPORT_FORM_ID} onSubmit={handleSave} className="space-y-4">
          {error && (
            <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Name
              <input required maxLength={80} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={FIELD_CLASS} />
            </label>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Data source
              <select value={form.dataset} onChange={(event) => setForm({ ...form, dataset: event.target.value, group_by: DATASETS[event.target.value].groupings[0][0] })} className={FIELD_CLASS}>
                {Object.entries(DATASETS).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Visualization
              <select value={form.visualization} onChange={(event) => setForm({ ...form, visualization: event.target.value })} className={FIELD_CLASS}>
                <option value="table">Table</option>
                <option value="bar">Bar graph</option>
                <option value="pie">Pie graph</option>
                <option value="line">Line graph</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Group by
              <select value={form.group_by} onChange={(event) => setForm({ ...form, group_by: event.target.value })} className={FIELD_CLASS}>
                {(DATASETS[form.dataset] || DATASETS.schedule).groupings.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 sm:col-span-2">
              Description (optional)
              <textarea maxLength={300} rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
            </label>
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="radio" name="report-scope" checked={form.scope === 'mine'} onChange={() => setForm({ ...form, scope: 'mine' })} />
              {(DATASETS[form.dataset] || DATASETS.schedule).mine}
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="radio" name="report-scope" checked={form.scope === 'station'} onChange={() => setForm({ ...form, scope: 'station' })} />
              {(DATASETS[form.dataset] || DATASETS.schedule).station}
            </label>
          </div>

          <fieldset className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">
            <legend className="text-xs font-semibold text-slate-700 dark:text-slate-200">Parameters when the report is launched</legend>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 sm:max-w-xs">
              Default date range
              <select value={form.default_range} onChange={(event) => setForm({ ...form, default_range: event.target.value })} className={FIELD_CLASS}>
                {REPORT_RANGE_PRESETS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            {[
              ['allow_range', 'Viewer can change the date range'],
              ['allow_group_by', 'Viewer can change what the report is grouped by'],
              ['allow_visualization', 'Viewer can change the visualization'],
              ...(form.dataset === 'training' ? [['allow_category', 'Viewer can filter by training category']] : []),
              ...(form.scope === 'station' ? [['allow_members', 'Viewer can choose which members to include']] : []),
              // WHICH ASSIGNMENTS COUNT AS PAID, ticked by whoever runs it. No column on the assignment says paid, because
              // "is this paid?" is a question about THIS comparison rather than a fact about the shift.
              ...(form.dataset === 'reconciliation'
                ? [['allow_assignments', 'Viewer can tick which assignments count as paid time']]
                : []),
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input type="checkbox" checked={form[key] === true} onChange={(event) => setForm({ ...form, [key]: event.target.checked })} className="accent-red-600" />
                {label}
              </label>
            ))}
            <p className="text-xs text-slate-500 dark:text-slate-400">Anything left off uses the values set above. The date range is always part of the launch window; when it is locked the default range is used.</p>
          </fieldset>

          <fieldset className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">
            <legend className="text-xs font-semibold text-slate-700 dark:text-slate-200">Who can use this report?</legend>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="checkbox" checked={form.audience_all} onChange={(event) => setForm({ ...form, audience_all: event.target.checked })} className="accent-red-600" />
              Everyone with View reports
            </label>
            {!form.audience_all && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase text-slate-500">Roles</p>
                  {roles.map((role) => {
                    const id = String(role.id);
                    return (
                      <label key={id} className="flex items-center gap-2 py-1 text-sm text-slate-700 dark:text-slate-200">
                        <input type="checkbox" checked={form.audience_role_ids.includes(id)} onChange={() => setForm({ ...form, audience_role_ids: toggleId(form.audience_role_ids, id) })} className="accent-red-600" />
                        {role.description || role.name || id}
                      </label>
                    );
                  })}
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase text-slate-500">Ranks</p>
                  {ranks.map((rank) => {
                    const id = String(rank.id);
                    return (
                      <label key={id} className="flex items-center gap-2 py-1 text-sm text-slate-700 dark:text-slate-200">
                        <input type="checkbox" checked={form.audience_rank_ids.includes(id)} onChange={() => setForm({ ...form, audience_rank_ids: toggleId(form.audience_rank_ids, id) })} className="accent-red-600" />
                        {rank.description || rank.name || id}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400">A matching role or rank grants access, in addition to the View reports permission. Schedule data permissions are checked separately when the report runs.</p>
          </fieldset>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-700">
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} className="accent-red-600" />
              Enabled
            </label>
          </div>
        </form>
        </ViewportModal>
      )}

      {pendingDelete && (
        <ConfirmModal
          title={`Delete ${pendingDelete.name}?`}
          message="People who have access to this report will no longer be able to run it."
          confirmLabel="Delete report"
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}