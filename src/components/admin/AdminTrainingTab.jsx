import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronRight, Loader2, Lock, Pencil, Plus, Printer, ShieldCheck, Trash2, Upload, UserMinus } from 'lucide-react';
import { adminBulkSaveTraining, adminRemoveTrainingSignature } from '../../services/api';
import TrainingBadges from '../training/TrainingBadges';
import ConfirmModal from '../ConfirmModal';
import PrintableTraining from '../PrintableTraining';
import TrainingFilters from '../training/TrainingFilters';
import TrainingForm from '../training/TrainingForm';
import TrainingTotals from '../training/TrainingTotals';
import AdminTrainingImportModal from './AdminTrainingImportModal';
import { displayDate } from '../../utils/scheduleDate';
import { unnamedLabel, userLabel } from '../../utils/displayLabel';
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
  getTrainingCategories,
  trainingCategoryOptions,
} from '../../utils/training';

// Displays training records and allows administrators to manage sessions and signatures.
export default function AdminTrainingTab({
  token,
  trainings = [],
  signatures = [],
  users = [],
  ranks = [],
  currentUserId = '',
  // Station name and logo for printed reports.
  departmentName = '',
  departmentLogoUrl = '',
  systemSettings = [],
  onDataChanged,
}) {
  const [editing, setEditing] = useState(null);
  // Controls whether the training edit modal is open.
  const [editorOpen, setEditorOpen] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [message, setMessage] = useState(null);
  const [filters, setFilters] = useState(emptyTrainingFilters);
  const [sort, setSort] = useState(DEFAULT_TRAINING_SORT);
  // Stores details for any action that needs user confirmation.
  const [pending, setPending] = useState(null);
  // Holds state for the printable view.
  const [printing, setPrinting] = useState(null);
  // Controls whether the training CSV import modal is open.
  const [importModalOpen, setImportModalOpen] = useState(false);

  const categories = useMemo(() => getTrainingCategories(systemSettings), [systemSettings]);
  const categoryOptions = useMemo(() => trainingCategoryOptions(systemSettings), [systemSettings]);

  const allRows = useMemo(() => normalizeTrainingList(trainings, categories), [trainings, categories]);

  // Get IDs of trainings signed by the selected member.
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

  // Calculate total hours and completed training counts.
  const totals = useMemo(
    () => trainingTotals(rows, filterSignedIds),
    [rows, filterSignedIds]
  );

  // List of members for the filter dropdown.
  const memberOptions = useMemo(
    () => [
      { value: '', label: 'All Members' },
      ...users
        .slice()
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
        .map((user) => ({ value: String(user.id), label: userLabel(user) })),
    ],
    [users]
  );

  const counts = useMemo(() => signatureCounts(signatures), [signatures]);
  const memberName = (userId) =>
    users.find((user) => String(user.id) === String(userId))?.name || unnamedLabel('member');

  // Name of user printing the report.
  const printedByName =
    users.find((user) => String(user.id) === String(currentUserId))?.name || '';

  const currentUserName =
    users.find((user) => String(user.id || user.user_id) === String(currentUserId))?.name || '';

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
    await saveTraining(values);
  };

  const handleQuickLock = (training) => {
    setPending({ kind: 'lock_training', training });
  };

  // Save training changes to the database.
  const saveTraining = async (values) => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await adminBulkSaveTraining({ trainings: [values] }, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to save the training.');
      setEditing(null);
      setEditorOpen(false);
      void onDataChanged?.('trainings');
      setMessage({ type: 'success', text: 'Training saved.' });
    } catch (err) {
      setMessage({ type: 'error', text: err?.message || 'Failed to save the training.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTraining = (training) => {
    const signedCount = counts.get(String(training.id)) || 0;
    // Ask for confirmation before deleting a training and its signatures.
    setPending({ kind: 'train', training, signedCount });
  };

  const deleteTraining = async (training) => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await adminBulkSaveTraining({ trainings: [], deleteIds: [training.id] }, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to delete the training.');
      if (String(editing?.id || '') === String(training.id)) setEditing(null);
      void onDataChanged?.('trainings');
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
      void onDataChanged?.('trainings');
      setMessage({ type: 'success', text: `Signature removed for ${memberName(result.user_id || signature.user_id)}.` });
    } catch (err) {
      setMessage({ type: 'error', text: err?.message || 'Failed to remove the signature.' });
    } finally {
      setRemovingId(null);
    }
  };

  // Run whichever action was confirmed.
  const confirmPending = () => {
    const action = pending;
    setPending(null);
    if (!action) return;
    if (action.kind === 'lock') void saveTraining(action.values);
    else if (action.kind === 'lock_training') {
      void saveTraining({
        ...action.training,
        is_locked: true,
        is_entered_into_external: true,
        locked_at: new Date().toISOString(),
        locked_by_id: currentUserId,
        locked_by_name: currentUserName,
      });
    } else if (action.kind === 'train') void deleteTraining(action.training);
    else void removeSignature(action.signature);
  };

  const signatureName = pending?.kind === 'signature' ? memberName(pending.signature.user_id) : '';

  return (
    <div className="space-y-4">
      {/* Training editor modal */}
      {editorOpen && (
        <TrainingForm
          key={editing?.id || 'new'}
          editing={editing}
          saving={saving}
          allowAdminFlags
          onSubmit={handleSave}
          onCancel={() => {
            setEditing(null);
            setEditorOpen(false);
          }}
          users={users}
          ranks={ranks}
          systemSettings={systemSettings}
          existingSignatures={editing ? signaturesForTraining(signatures, editing.id) : []}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
        />
      )}

      {/* Training CSV import modal */}
      {importModalOpen && (
        <AdminTrainingImportModal
          isOpen={importModalOpen}
          onClose={() => setImportModalOpen(false)}
          users={users}
          token={token}
          onImportSuccess={({ trainingsCreated, signaturesCreated }) => {
            void onDataChanged?.('trainings');
            void onDataChanged?.('training_signatures');
            setMessage({
              type: 'success',
              text: `Successfully imported ${trainingsCreated} training session${
                trainingsCreated === 1 ? '' : 's'
              } and ${signaturesCreated} attendance signature${
                signaturesCreated === 1 ? '' : 's'
              }.`,
            });
          }}
        />
      )}

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
        rows={allRows}
        memberOptions={memberOptions}
        signedLabel="Signatures"
        categoryOptions={categoryOptions}
      />

      {/* Summary statistics for visible trainings */}
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
          {/* Button to add a new training */}
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
            className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-500"
          >
            <Plus className="h-3.5 w-3.5" />
            Add training
          </button>
          {/* Button to import historical training from CSV */}
          <button
            type="button"
            onClick={() => setImportModalOpen(true)}
            title="Import historical training sessions and attendee records from CSV"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700 transition"
          >
            <Upload className="w-3.5 h-3.5" />
            Import CSV
          </button>
          {/* Button to print the filtered training list */}
          <button
            type="button"
            onClick={() => setPrinting({ mode: 'list' })}
            disabled={rows.length === 0}
            title={
              rows.length === 0
                ? 'Nothing to print - no trainings match these filters'
                : 'Print this list, with who signed each training'
            }
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <Printer className="w-3.5 h-3.5" />
            Print list
          </button>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Expand a training to see who signed it.
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="sticky top-0 z-10 bg-slate-100/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700/60 text-slate-500 dark:text-slate-400 uppercase text-xs">
              <tr>
                <th className="px-4 py-3" />
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Training</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Instructors</th>
                <th className="px-4 py-3">Signed</th>
                <th className="px-4 py-3 text-center" title="Locked">Locked</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/70">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
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
                            title={
                              training.locked_by_name
                                ? `Locked & approved by ${training.locked_by_name}${training.locked_at ? ` on ${training.locked_at.slice(0, 10)}` : ''}`
                                : 'Locked for everyone.'
                            }
                          >
                            <Lock className="w-4 h-4" />
                          </span>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {/* Quick Approve / Lock button */}
                        {!training.locked && (
                          <button
                            type="button"
                            onClick={() => handleQuickLock(training)}
                            title="Lock & approve this training"
                            className="mr-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-emerald-600 dark:text-slate-400 dark:hover:text-emerald-400"
                          >
                            <ShieldCheck className="w-3.5 h-3.5" />
                            Approve
                          </button>
                        )}
                        {/* Print button for individual training record */}
                        <button
                          type="button"
                          onClick={() => setPrinting({ mode: 'training', training })}
                          title="Print this training's record, with everyone who signed it"
                          className="mr-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          Print
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(training);
                            setEditorOpen(true);
                          }}
                          disabled={training.locked}
                          title={training.locked ? 'Locked' : 'Edit this training'}
                          className="inline-flex items-center text-xs gap-1.5 font-medium text-slate-500 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed dark:text-slate-400 dark:hover:text-white mr-3"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTraining(training)}
                          disabled={saving || training.locked}
                          title={training.locked ? 'Locked' : 'Delete this training'}
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
                              Locked, so its signatures cannot be changed.
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
                                        ? 'Locked'
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

      {/* Printable report component */}
      {printing && (
        <PrintableTraining
          mode={printing.mode}
          departmentName={departmentName}
          logoUrl={departmentLogoUrl}
          memberName={printedByName}
          rows={rows}
          filters={filters}
          sort={sort}
          training={printing.training || null}
          signatures={signatures}
          users={users}
          onDone={() => setPrinting(null)}
        />
      )}

      {/* Confirmation dialog for locking, deleting, or removing signatures */}
      {pending && (
        <ConfirmModal
          title={
            pending.kind === 'lock' || pending.kind === 'lock_training'
              ? 'Lock & Approve Training'
              : pending.kind === 'train'
                ? 'Delete training'
                : 'Remove signature'
          }
          message={
            pending.kind === 'lock' || pending.kind === 'lock_training' ? (
              <>
                Lock and approve <strong className="text-slate-900 dark:text-white">{pending.training?.title || pending.values?.title}</strong>? This permanently finalizes the training report and its attendance signatures for everyone.
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
          confirmLabel={
            pending.kind === 'lock' || pending.kind === 'lock_training'
              ? 'Lock & Approve'
              : pending.kind === 'train'
                ? 'Delete'
                : 'Remove'
          }
          onConfirm={confirmPending}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
