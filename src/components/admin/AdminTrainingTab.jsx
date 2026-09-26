import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronRight, Loader2, Lock, Trash2, UserMinus } from 'lucide-react';
import { adminBulkSaveTraining, adminRemoveTrainingSignature } from '../../services/api';
import TrainingBadges from '../training/TrainingBadges';
import ConfirmModal from '../ConfirmModal';
import TrainingFilters from '../training/TrainingFilters';
import TrainingForm from '../training/TrainingForm';
import TrainingTotals from '../training/TrainingTotals';
import { displayDate } from '../../utils/scheduleDate';
import {
  DEFAULT_TRAINING_SORT,
  emptyTrainingFilters,
  filterTrainings,
  normalizeTrainingList,
  signatureCounts,
  signaturesForTraining,
  sortTrainingRows,
  trainingLocked,
  trainingTotals,
} from '../../utils/training';

// The Training report.
//
// Requires can_administer_trainings, which is the only permission that can do all three of:
// see who signed each training (the rest of the app filters signatures to the signed-in
// member), change any training, and remove a signature. A training is a record rather than a
// preference, so removal is deliberately a separate, deliberate action here.
//
// The edit form is the same component the member module uses, so the two cannot disagree about
// what a training is.
export default function AdminTrainingTab({ token, trainings = [], signatures = [], users = [], onDataChanged }) {
  const [editing, setEditing] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [message, setMessage] = useState(null);
  const [filters, setFilters] = useState(emptyTrainingFilters);
  const [sort, setSort] = useState(DEFAULT_TRAINING_SORT);
  // The action awaiting confirmation in the modal below, or null. One piece of state for all three
  // confirmations this tab needs - locking, deleting, and removing a signature - so there is exactly one dialog
  // and no chance of two stacking.
  const [pending, setPending] = useState(null);

  const allRows = useMemo(() => normalizeTrainingList(trainings), [trainings]);

  // The Member filter asks "which trainings has this member signed", so it needs a set of the
  // selected member's signature ids. All Members (the empty value) matches everything, which is
  // what makes the "signed" filter below behave differently: it is only meaningful for one member.
  const filterSignedIds = useMemo(() => {
    const memberId = String(filters.member || '').trim();
    if (!memberId) return new Set();
    return new Set(
      signatures
        .filter((signature) => signature && String(signature.user_id || '').trim() === memberId)
        .map((signature) => String(signature.training_id || '').trim())
        .filter(Boolean)
    );
  }, [signatures, filters.member]);

  const rows = useMemo(
    () => sortTrainingRows(filterTrainings(allRows, filters, { signedIds: filterSignedIds }), sort),
    [allRows, filters, filterSignedIds, sort]
  );

  // Hours are summed over what is on screen; the signed/unsigned tile is only meaningful once a
  // single member is selected, so it is passed only then.
  const totals = useMemo(
    () => trainingTotals(rows, filterSignedIds),
    [rows, filterSignedIds]
  );

  // All Members first, then everyone with a name - so the select reads the way the label suggests.
  const memberOptions = useMemo(
    () => [
      { value: '', label: 'All Members' },
      ...users
        .slice()
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
        .map((user) => ({ value: String(user.id), label: user.name || `Member #${user.id}` })),
    ],
    [users]
  );

  const counts = useMemo(() => signatureCounts(signatures), [signatures]);
  const memberName = (userId) =>
    users.find((user) => String(user.id) === String(userId))?.name || `Member #${userId}`;

  useEffect(() => {
    if (message?.type === 'success') {
      const timer = setTimeout(() => setMessage(null), 4000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [message]);

  const toggleExpanded = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async (values) => {
    // Ticking the external-system marker locks the training permanently, so it is confirmed
    // before the write rather than reported after it - there is no way back through the app.
    if (!trainingLocked(editing) && Boolean(values.is_entered_into_external)) {
      setPending({ kind: 'lock', values });
      return;
    }

    await saveTraining(values);
  };

  // The write itself, run once the lock is confirmed (or straight through when it is not needed). It is separate
  // from handleSave only because the confirmation is answered later, on a click.
  const saveTraining = async (values) => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await adminBulkSaveTraining({ trainings: [values] }, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to save the training.');
      setEditing(null);
      void onDataChanged?.(token);
      setMessage({ type: 'success', text: 'Training saved.' });
    } catch (err) {
      setMessage({ type: 'error', text: err?.message || 'Failed to save the training.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTraining = (training) => {
    const signedCount = counts.get(String(training.id)) || 0;
    // Deleting a training throws away its signatures, so the confirmation says so rather than
    // asking a generic "are you sure?".
    setPending({ kind: 'train', training, signedCount });
  };

  const deleteTraining = async (training) => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await adminBulkSaveTraining({ trainings: [], deleteIds: [training.id] }, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to delete the training.');
      if (String(editing?.id || '') === String(training.id)) setEditing(null);
      void onDataChanged?.(token);
      setMessage({ type: 'success', text: 'Training deleted.' });
    } catch (err) {
      setMessage({ type: 'error', text: err?.message || 'Failed to delete the training.' });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveSignature = (signature) => setPending({ kind: 'signature', signature });

  const removeSignature = async (signature) => {
    setRemovingId(signature.id);
    setMessage(null);
    try {
      const result = await adminRemoveTrainingSignature(signature.id, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to remove the signature.');
      void onDataChanged?.(token);
      setMessage({ type: 'success', text: `Signature removed for ${memberName(result.user_id || signature.user_id)}.` });
    } catch (err) {
      setMessage({ type: 'error', text: err?.message || 'Failed to remove the signature.' });
    } finally {
      setRemovingId(null);
    }
  };

  // Runs whichever action was confirmed. The pending value is cleared first so a slow write cannot be confirmed
  // twice; from here the row's own spinner takes over, exactly as it did when the native dialog returned.
  const confirmPending = () => {
    const action = pending;
    setPending(null);
    if (!action) return;
    if (action.kind === 'lock') void saveTraining(action.values);
    else if (action.kind === 'train') void deleteTraining(action.training);
    else void removeSignature(action.signature);
  };

  const signatureName = pending?.kind === 'signature' ? memberName(pending.signature.user_id) : '';

  return (
    <div className="space-y-4">
      <TrainingForm
        // Remounts when the edited row changes, so the form's state is seeded exactly once per
        // row instead of being re-seeded by an effect.
        key={editing?.id || 'new'}
        editing={editing}
        saving={saving}
        // The Administration report is the only place the external-system marker can be set.
        allowAdminFlags
        onSubmit={handleSave}
        onCancel={() => setEditing(null)}
      />

      {message && (
        <div
          className={`p-3 rounded-xl flex items-start gap-2 text-sm font-medium border ${
            message.type === 'error'
              ? 'bg-red-50 text-red-600 border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80'
              : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800/80'
          }`}
        >
          {message.type === 'error' ? (
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <Check className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span>{message.text}</span>
        </div>
      )}
      <TrainingFilters
        filters={filters}
        onChange={setFilters}
        sort={sort}
        onSortChange={setSort}
        // Location options come from the trainings on the sheet, and Members from the roster with
        // All Members first - the form an administrator expects for a report.
        rows={allRows}
        memberOptions={memberOptions}
        signedLabel="Signatures"
      />

      {/* The signature tile only means something for one member, so All Members gets the two
          totals that always apply rather than a misleading "0 of N". */}
      <TrainingTotals
        totals={filters.member ? totals : { count: totals.count, hours: totals.hours }}
        signedLabel="Signed by this member"
      />

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Training report</h3>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {rows.length} training{rows.length === 1 ? '' : 's'} · {signatures.length} signature
            {signatures.length === 1 ? '' : 's'}
            {rows.length !== allRows.length ? ` (of ${allRows.length} trainings)` : ''}
          </span>
          <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
            Expand a training to see who signed it.
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-100 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 uppercase text-xs">
              <tr>
                <th className="px-4 py-3" />
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Training</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Instructors</th>
                <th className="px-4 py-3">Signed</th>
                <th className="px-4 py-3 text-center" title="Entered into an external system">Ext.</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/70">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                    {/* An empty filtered result is not an empty sheet, and only one of them is
                        something to act on. */}
                    {allRows.length === 0
                      ? 'No trainings have been recorded yet. Use the form above to add the first one.'
                      : 'No trainings match these filters.'}
                  </td>
                </tr>
              )}
              {rows.map((training) => {
                const id = String(training.id);
                const isOpen = expanded.has(id);
                const trainingSignatures = signaturesForTraining(signatures, id);
                return (
                  <React.Fragment key={id}>
                    <tr className="align-top">
                      <td className="px-2 py-3">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(id)}
                          title={isOpen ? 'Hide signatures' : 'Show signatures'}
                          className="p-1 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-slate-700"
                        >
                          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600 dark:text-slate-300">
                        {displayDate(training.date_key || '') || training.date}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900 dark:text-white">{training.title}</div>
                        <TrainingBadges training={training} />
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{training.location || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{training.instructors || '—'}</td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(id)}
                          className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                        >
                          {trainingSignatures.length}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {training.locked ? (
                          <span
                            className="inline-flex text-emerald-600 dark:text-emerald-400"
                            title="Entered into an external system — this training is locked for everyone"
                          >
                            <Lock className="w-4 h-4" />
                          </span>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setEditing(editing?.id === id ? null : training)}
                          disabled={training.locked}
                          title={training.locked ? 'Locked — entered into an external system' : 'Edit this training'}
                          className="text-xs font-medium text-slate-500 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed dark:text-slate-400 dark:hover:text-white mr-3"
                        >
                          {editing?.id === id ? 'Editing…' : 'Edit'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTraining(training)}
                          disabled={saving || training.locked}
                          title={training.locked ? 'Locked — entered into an external system' : 'Delete this training'}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-500 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50 dark:bg-slate-900/40">
                        <td colSpan={8} className="px-4 py-3">
                          {training.locked && (
                            <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                              <Lock className="w-3.5 h-3.5" />
                              Locked: entered into an external system, so its signatures cannot be changed.
                            </p>
                          )}
                          {trainingSignatures.length === 0 ? (
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              Nobody has signed this training yet.
                            </p>
                          ) : (
                            <ul className="flex flex-wrap gap-2">
                              {trainingSignatures.map((signature) => (
                                <li
                                  key={signature.id || `${signature.training_id}-${signature.user_id}`}
                                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200"
                                >
                                  {memberName(signature.user_id)}
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveSignature(signature)}
                                    disabled={removingId === signature.id || training.locked}
                                    title={
                                      training.locked
                                        ? 'Locked — this training was entered into an external system'
                                        : 'Remove this signature'
                                    }
                                    className="text-red-500 hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed"
                                  >
                                    {removingId === signature.id ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <UserMinus className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                          {training.narrative && (
                            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400 whitespace-pre-line">
                              {training.narrative}
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Every confirmation this tab needs. The wording is the same warning the native dialog carried, but it can
          now name what is lost in bold rather than fitting it into a sentence. */}
      {pending && (
        <ConfirmModal
          title={
            pending.kind === 'lock'
              ? 'Lock this training'
              : pending.kind === 'train'
                ? 'Delete training'
                : 'Remove signature'
          }
          message={
            pending.kind === 'lock' ? (
              <>
                Mark <strong className="text-slate-900 dark:text-white">{pending.values.title}</strong> as entered
                into an external system? This locks the training and its signatures for everyone, including
                administrators, and cannot be undone in the app. Only the training sheet can clear it.
              </>
            ) : pending.kind === 'train' ? (
              pending.signedCount > 0 ? (
                <>
                  Delete <strong className="text-slate-900 dark:text-white">{pending.training.title}</strong>? This
                  also removes {pending.signedCount} signature{pending.signedCount === 1 ? '' : 's'} recorded against
                  it, and cannot be undone.
                </>
              ) : (
                <>
                  Delete <strong className="text-slate-900 dark:text-white">{pending.training.title}</strong>? This
                  cannot be undone.
                </>
              )
            ) : (
              <>
                Remove <strong className="text-slate-900 dark:text-white">{signatureName}</strong>&apos;s signature?
                They will be able to sign it again.
              </>
            )
          }
          confirmLabel={pending.kind === 'lock' ? 'Lock training' : pending.kind === 'train' ? 'Delete' : 'Remove'}
          onConfirm={confirmPending}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
