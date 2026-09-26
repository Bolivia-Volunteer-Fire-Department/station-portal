import React, { useState } from 'react';
import { Save, Loader2, Pencil, Trash2, Plus, AlertCircle, X } from 'lucide-react';
import { adminSaveAssignment, adminDeleteAssignment } from '../../services/api';
import { eligibilityFor, rankOrderLabel, minRankChoices } from '../../utils/rankEligibility';
import { assignmentColor, parseHexColor } from '../../utils/assignmentColor';
import {
  assignmentDateError,
  assignmentDateKey,
  assignmentDateLabel,
  assignmentDateText,
  assignmentLifecycle,
  templatesAffectedByEndDate,
} from '../../utils/assignmentDates';
import { toDateKey } from '../../utils/scheduleDate';
import RankIcon, { RANK_ICON_MAP } from '../RankIcon';

const EMPTY_FORM = {
  id: '',
  description: '',
  rank_order_required: '',
  color: '',
  icon: '',
  effective_date: '',
  end_date: '',
};

// Read once per render so every row is judged against the same day.
const todayKeyValue = toDateKey(new Date());

export default function AdminAssignmentsTab({
  token,
  assignments = [],
  ranks = [],
  users = [],
  // Used only for the warning that a new end date will stop these templates drawing shifts.
  scheduleTemplates = [],
  onDataChanged,
  onRowSaved,
}) {
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState(null);

  const isEditing = !!formData.id;
  const resetForm = () => setFormData(EMPTY_FORM);

  // Minimum-rank choices derived from the ranks sheet (highest order first).
  const rankChoices = minRankChoices(ranks);
  const ranksMissingOrder = ranks.filter(
    (r) => !Number.isFinite(parseInt(r.rank_order, 10))
  );

  // The color this assignment currently renders with: the stored one when set,
  // otherwise the automatic color derived from its id. Seeds the color picker
  // (which only accepts a hex value) and shows admins what "blank" resolves to.
  const autoColor = assignmentColor(formData.id, assignments);

  const handleEdit = (assignment) => {
    setError(null);
    setFormData({
      id: assignment.id,
      // Carried through the form so the backend can refuse a save built on a stale copy.
      row_version: assignment.row_version,
      description: assignment.description || '',
      rank_order_required:
        assignment.rank_order_required === undefined || assignment.rank_order_required === null
          ? ''
          : String(assignment.rank_order_required),
      // Blank means "keep the automatic color", which is the state every
      // assignment starts in - the picker still shows the derived color.
      color: parseHexColor(assignment.color) || '',
      icon: String(assignment.icon ?? '').trim(),
      // An <input type="date"> takes yyyy-MM-dd, so the sheet's date cell is normalized here just as
      // the comparison does - an assignment edited and re-saved must not shift by a day.
      effective_date: assignmentDateKey(assignment.effective_date),
      end_date: assignmentDateKey(assignment.end_date),
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // The same rule the backend enforces, checked here so a bad pair is caught before a round trip.
      const dateError = assignmentDateError(formData.effective_date, formData.end_date);
      if (dateError) throw new Error(dateError);
      const result = await adminSaveAssignment(formData, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to save assignment.');
      // Straight onto the table; the refresh wave lands on its own time.
      onRowSaved?.('assignments', formData);
      void onDataChanged();
      resetForm();
    } catch (err) {
      setError(err.message || 'Failed to save assignment.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (assignment) => {
    if (!window.confirm(`Delete assignment "${assignment.description}"? Schedule templates using it will need to be updated.`)) return;
    setDeletingId(assignment.id);
    setError(null);
    try {
      const result = await adminDeleteAssignment(assignment.id, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to delete assignment.');
      void onDataChanged();
      if (String(formData.id) === String(assignment.id)) resetForm();
    } catch (err) {
      setError(err.message || 'Failed to delete assignment.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{isEditing ? `Edit Assignment #${formData.id}` : 'Add New Assignment'}</h3>
            {isEditing && (
              <button type="button" onClick={resetForm} className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1 text-sm">
                <X className="w-4 h-4" /> Cancel
              </button>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-1">
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Description</label>
              <input
                type="text"
                required
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="e.g. Engine 1 - Day Shift"
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                Assignments label the roles/shifts you schedule members into (e.g. "Dispatcher", "Engine 1").
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Minimum Rank</label>
              <select
                value={formData.rank_order_required}
                onChange={(e) => setFormData({ ...formData, rank_order_required: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="">-- Any rank --</option>
                {rankChoices.map((choice) => (
                  <option key={choice.order} value={String(choice.order)}>{choice.label}</option>
                ))}
              </select>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                Stored as the rank's order number. Members with this rank <span className="font-medium">or higher</span> can be scheduled.
              </p>
              {ranksMissingOrder.length > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
                  {ranksMissingOrder.map((r) => r.description).join(', ')} {ranksMissingOrder.length === 1 ? 'has' : 'have'} no rank order set, so {ranksMissingOrder.length === 1 ? 'it' : 'they'} can't be used as a minimum.
                </p>
              )}
            </div>

            {/* Color used for this assignment everywhere it is drawn. Left blank,
                the automatic color derived from the id is kept - so existing
                assignments look unchanged until an admin picks something. */}
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Assignment color"
                  value={formData.color || autoColor}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  className="h-11 w-12 shrink-0 cursor-pointer rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-1"
                />
                <input
                  type="text"
                  value={formData.color}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  placeholder={autoColor}
                  className="w-full font-mono text-sm bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <span
                  className="w-3 h-3 rounded-full border border-black/10 dark:border-white/20 shrink-0"
                  style={{ backgroundColor: assignmentColor(formData.id, assignments) }}
                />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {formData.color
                    ? 'Shown on the calendar, pending approvals and schedule management.'
                    : 'Blank keeps the automatic color for this assignment.'}
                </p>
                {formData.color && (
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, color: '' })}
                    className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline shrink-0"
                  >
                    Use automatic
                  </button>
                )}
              </div>
            </div>

            {/* Icon drawn with this assignment wherever it appears, chosen from the
                same curated lucide set the ranks sheet uses. Optional: blank means no
                icon, which is how every existing assignment already renders. */}
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Icon</label>
              <div className="flex items-center gap-2">
                <select
                  value={formData.icon}
                  onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="">-- No Icon --</option>
                  {Object.keys(RANK_ICON_MAP).map((iconName) => (
                    <option key={iconName} value={iconName}>{iconName}</option>
                  ))}
                </select>
                <span
                  className="p-2 shrink-0 rounded-xl bg-slate-100 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700"
                  style={{ color: assignmentColor(formData.id, assignments) }}
                >
                  {formData.icon ? (
                    <RankIcon name={formData.icon} className="w-5 h-5" />
                  ) : (
                    <span className="block w-5 h-5 leading-5 text-center text-slate-400 dark:text-slate-500">—</span>
                  )}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                Shown alongside this assignment on the schedules. Leave it as “No Icon” for none.
              </p>
            </div>

            {/* Optional window. Both blank keeps the assignment in force indefinitely, which is how
                every assignment behaved before these columns existed. */}
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                Effective Date <span className="font-normal text-slate-400">(required)</span>
              </label>
              <input
                type="date"
                required
                value={formData.effective_date}
                onChange={(e) => setFormData({ ...formData, effective_date: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                The first date this assignment may be used.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                End Date <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <input
                type="date"
                value={formData.end_date}
                onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                Blank means it is still available.
              </p>
            </div>

            <div className="md:col-span-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
              An assignment outside its dates can no longer be chosen for new shifts or templates, and its
              templates stop producing shifts. Shifts already on the schedule are never removed. Both dates
              are inclusive, and the effective date is required so every assignment says when it came into use.
            </div>

            {/* The one consequence an administrator could otherwise miss: retiring an assignment
                silently stops every template that uses it from drawing shifts. */}
            {formData.end_date && templatesAffectedByEndDate(formData.id, scheduleTemplates) > 0 && (
              <div className="md:col-span-3">
                <div className="p-3 rounded-xl flex items-start gap-2 text-sm bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800/60">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    {templatesAffectedByEndDate(formData.id, scheduleTemplates)} schedule template
                    {templatesAffectedByEndDate(formData.id, scheduleTemplates) === 1 ? '' : 's'} use
                    {templatesAffectedByEndDate(formData.id, scheduleTemplates) === 1 ? 's' : ''} this
                    assignment and will stop producing shifts after {assignmentDateText(formData.end_date)}.
                    Give those templates their own end date instead if the pattern should outlive the assignment.
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : isEditing ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {isEditing ? 'Save Changes' : 'Add Assignment'}
            </button>
          </div>
        </form>
      </div>
<div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-100 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 uppercase text-xs">
            <tr>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3">Minimum Rank</th>
              <th className="px-4 py-3">Available</th>
              <th className="px-4 py-3">Eligible Members</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700/70">
            {assignments.map((assignment) => {
              const elig = eligibilityFor({ users, ranks, assignment });
              return (
                <tr key={assignment.id} className="text-slate-700 dark:text-slate-200">
                  <td className="px-4 py-3 font-mono text-slate-500 dark:text-slate-400">{assignment.id}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3.5 h-3.5 rounded-full border border-black/10 dark:border-white/20 shrink-0"
                        style={{ backgroundColor: assignmentColor(assignment.id, assignments) }}
                        title={parseHexColor(assignment.color) ? 'Custom color' : 'Automatic color'}
                      />
                      {assignment.icon && (
                        <span
                          className="shrink-0"
                          style={{ color: assignmentColor(assignment.id, assignments) }}
                          title={assignment.icon}
                        >
                          <RankIcon name={assignment.icon} className="w-4 h-4" />
                        </span>
                      )}
                      <span className="font-medium">{assignment.description}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {elig.requiredOrder !== null ? (
                      <span>{rankOrderLabel(ranks, elig.requiredOrder)}</span>
                    ) : (
                      <span className="text-slate-500 dark:text-slate-400">Any rank</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      const lifecycle = assignmentLifecycle(assignment, todayKeyValue);
                      const label = assignmentDateLabel(assignment);
                      if (!label) {
                        // Created before the effective date was required. It still works (a blank cell
                        // means no restriction), so this nudges rather than blocks.
                        return (
                          <span className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800/60">
                            ⚠ No start date
                          </span>
                        );
                      }
                      const style =
                        lifecycle === 'retired'
                          ? 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-900/60 dark:text-slate-400 dark:border-slate-700'
                          : lifecycle === 'scheduled'
                            ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800/60'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60';
                      return (
                        <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs font-medium ${style}`}>
                          {label}
                          {lifecycle === 'retired' && <span className="font-semibold">· Retired</span>}
                          {lifecycle === 'scheduled' && <span className="font-semibold">· Not yet</span>}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="font-medium"
                      title={`${elig.eligible.length} eligible · ${elig.rankBlocked.length} lower rank · ${elig.unverifiable.length} unverified · ${elig.excluded.length} excluded · ${elig.inactive.length} inactive`}
                    >
                      {elig.eligible.length}
                    </span>
                    {elig.rankBlocked.length > 0 && (
                      <span className="text-slate-500 dark:text-slate-400"> ({elig.rankBlocked.length} lower rank)</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => handleEdit(assignment)} className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(assignment)}
                        disabled={deletingId === assignment.id}
                        className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
                      >
                        {deletingId === assignment.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {assignments.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">No assignments found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}