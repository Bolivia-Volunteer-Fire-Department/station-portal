import React, { useMemo, useState } from 'react';
import { Check, Info, Loader2, Pencil, PenLine, Save } from 'lucide-react';
import { saveTraining, signTraining } from '../services/api';
import TrainingBadges from './training/TrainingBadges';
import TrainingFilters from './training/TrainingFilters';
import TrainingForm from './training/TrainingForm';
import TrainingTotals from './training/TrainingTotals';
import { displayDate } from '../utils/scheduleDate';
import {
  DEFAULT_TRAINING_SORT,
  emptyTrainingFilters,
  filterTrainings,
  normalizeTrainingList,
  signedTrainingIds,
  sortTrainingRows,
  trainingEditable,
  trainingEditBlockedReason,
  trainingTotals,
} from '../utils/training';

// The Training module.
//
// A member signs the trainings they attended. Two permissions shape the screen:
//
//   can_sign_trainings  the module exists at all (without it this component is not reachable)
//   can_edit_trainings  the add/edit form appears above the table
//
// Signing is collected locally and written in ONE request, because the natural way to use this
// page is to work down the list - a request per row would be a request per click.
//
// A signature is an acknowledgement of attendance, so it is add-only: a signed row's button is
// disabled rather than toggling back, and the backend refuses a removal by any other route than
// an administrator's.
export default function TrainingModule({
  token,
  currentUser,
  trainings = [],
  signatures = [],
  canEdit = false,
  onChanged,
}) {
  const [pendingSignIds, setPendingSignIds] = useState(() => new Set());
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savingSignatures, setSavingSignatures] = useState(false);
  const [message, setMessage] = useState(null);
  const [filters, setFilters] = useState(emptyTrainingFilters);
  const [sort, setSort] = useState(DEFAULT_TRAINING_SORT);

  // Server state is the source of truth for what is already signed, so fresh data (or a different
  // member) must clear any staged ticks - otherwise the screen could offer to sign something that
  // is already signed, or carry one member's draft into another's.
  //
  // Adjusted during render rather than in an effect: React's documented pattern for resetting
  // state when a prop changes. An effect would render once with the stale ticks still showing.
  const [seen, setSeen] = useState(() => ({ signatures, userId: currentUser?.id }));
  if (seen.signatures !== signatures || seen.userId !== currentUser?.id) {
    setSeen({ signatures, userId: currentUser?.id });
    setPendingSignIds(new Set());
  }

  const signedIds = useMemo(
    () => signedTrainingIds(signatures, currentUser?.id),
    [signatures, currentUser?.id]
  );
  // Normalized, then filtered and sorted. A row with no id cannot be signed or edited, so it is
  // dropped here rather than rendered as a blank line (the backend's normalizeTrainingList does the
  // same).
  const allRows = useMemo(() => normalizeTrainingList(trainings), [trainings]);

  // The filters run on the same rows the table shows, so the totals below always add up to exactly
  // what is on screen - the whole point of the filter is to answer "how many hours is this?".
  const rows = useMemo(
    () => sortTrainingRows(filterTrainings(allRows, filters, { signedIds }), sort),
    [allRows, filters, signedIds, sort]
  );
  const totals = useMemo(() => trainingTotals(rows, signedIds), [rows, signedIds]);
  const pendingCount = pendingSignIds.size;

  const toggleSign = (training) => {
    const id = String(training.id);
    if (signedIds.has(id)) {
      // Not a toggle: signatures cannot be withdrawn. Say so rather than doing nothing, so a
      // disabled button is understood rather than assumed broken.
      setMessage({
        type: 'info',
        text: 'Signatures cannot be removed. If this is wrong, ask an administrator to correct it in the Training report.',
      });
      return;
    }
    setPendingSignIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setMessage(null);
  };

  const handleSaveSignatures = async () => {
    if (pendingCount === 0) return;
    setSavingSignatures(true);
    setMessage(null);
    try {
      const result = await signTraining([...pendingSignIds], token);
      if (!result?.success) throw new Error(result?.message || 'Failed to save your signatures.');
      setPendingSignIds(new Set());
      await onChanged?.(token);
      // `skipped` means an id no longer matched a training - worth reporting rather than
      // silently claiming a clean save.
      setMessage(
        result.skipped
          ? {
              type: 'info',
              text: `Signed ${result.signed}. ${result.skipped} could not be signed because the training no longer exists.`,
            }
          : { type: 'success', text: `Signed ${result.signed} training${result.signed === 1 ? '' : 's'}.` }
      );
    } catch (err) {
      setMessage({ type: 'error', text: err?.message || 'Failed to save your signatures.' });
    } finally {
      setSavingSignatures(false);
    }
  };
  const handleSaveTraining = async (values) => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await saveTraining({ trainings: [values] }, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to save the training.');
      setEditing(null);
      await onChanged?.(token);
      setMessage({ type: 'success', text: 'Training saved.' });
    } catch (err) {
      setMessage({ type: 'error', text: err?.message || 'Failed to save the training.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {canEdit && (
        <TrainingForm
          // Remounts when the edited row changes, so the form's state is seeded exactly once
          // per row instead of being re-seeded by an effect.
          key={editing?.id || 'new'}
          editing={editing}
          saving={saving}
          onSubmit={handleSaveTraining}
          onCancel={() => setEditing(null)}
        />
      )}

      <TrainingFilters
        filters={filters}
        onChange={setFilters}
        sort={sort}
        onSortChange={setSort}
        // The location options come from the trainings the member can see, so the list stays short
        // and relevant. No Member select here: a member only ever sees their own record.
        rows={allRows}
        signedLabel="My signature"
      />

      <TrainingTotals totals={totals} signedLabel="Signed by me" />

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <PenLine className="w-4 h-4 text-red-500 shrink-0" />
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Training record</h3>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {totals.signedCount} of {totals.count} signed
            {totals.count !== allRows.length ? ` (of ${allRows.length})` : ''}
          </span>
          <div className="ml-auto flex items-center gap-3">
            {pendingCount > 0 && (
              <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                {pendingCount} unsaved {pendingCount === 1 ? 'signature' : 'signatures'}
              </span>
            )}
            <button
              type="button"
              onClick={handleSaveSignatures}
              disabled={pendingCount === 0 || savingSignatures}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-4 py-2 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
            >
              {savingSignatures ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save signatures
            </button>
          </div>
        </div>

        {message && (
          <div
            className={`mx-4 mt-3 p-3 rounded-xl flex items-start gap-2 text-sm font-medium border ${
              message.type === 'error'
                ? 'bg-red-50 text-red-600 border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80'
                : message.type === 'success'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800/80'
                  : 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:border-slate-700'
            }`}
          >
            {message.type === 'info' ? (
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <Check className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span>{message.text}</span>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-100 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 uppercase text-xs">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Training</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Instructors</th>
                <th className="px-4 py-3 text-center" title="Entered into an external system">Ext.</th>
                {canEdit && <th className="px-4 py-3" />}
                <th className="px-4 py-3 text-right">Signature</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/70">
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={canEdit ? 7 : 6}
                    className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
                  >
                    {/* Distinguished on purpose: an empty result from a filter is not the same as
                        there being no trainings at all, and only one of them is worth acting on. */}
                    {allRows.length === 0
                      ? 'No trainings have been recorded yet.'
                      : 'No trainings match these filters.'}
                  </td>
                </tr>
              )}
              {rows.map((training) => {
                const id = String(training.id);
                const isSigned = signedIds.has(id);
                const isPending = pendingSignIds.has(id);
                // Rule: a training the module may not edit - because somebody has signed it, or
                // because it is locked - greys out its Edit button rather than failing on save.
                const editable = trainingEditable(training);
                const editBlockedReason = trainingEditBlockedReason(training);
                return (
                  <tr key={id} className="align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600 dark:text-slate-300">
                      {displayDate(training.date_key || '') || training.date}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-white">{training.title}</div>
                      <TrainingBadges training={training} />
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {training.location || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {training.instructors || '—'}
                    </td>
                    {/* A tick means the training has been filed in an external system - and, as a
                        consequence, that it is locked. */}
                    <td className="px-4 py-3 text-center">
                      {training.locked ? (
                        <span
                          className="inline-flex text-emerald-600 dark:text-emerald-400"
                          title="Entered into an external system — this training is locked"
                        >
                          <Check className="w-4 h-4" />
                        </span>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-600">—</span>
                      )}
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setEditing(training)}
                          disabled={!editable}
                          title={editable ? 'Edit this training' : editBlockedReason}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed dark:text-slate-400 dark:hover:text-white"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Edit
                        </button>
                      </td>
                    )}
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => toggleSign(training)}
                        disabled={isSigned}
                        title={
                          isSigned
                            ? 'You signed this training. Signatures cannot be removed.'
                            : isPending
                              ? 'Click to take this back out of the batch'
                              : 'Click to add your signature, then save'
                        }
                        className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                          isSigned
                            ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20 cursor-default'
                            : isPending
                              ? 'border-2 border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                              : 'border-2 border-dashed border-slate-300 text-slate-500 hover:border-slate-400 hover:text-slate-700 dark:border-slate-600 dark:text-slate-400 dark:hover:text-white'
                        }`}
                      >
                        {isSigned && <Check className="w-3.5 h-3.5" />}
                        {isSigned ? 'Signed' : isPending ? 'Ready to sign' : 'Sign'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
