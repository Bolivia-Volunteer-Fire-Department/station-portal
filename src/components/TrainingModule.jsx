import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Eye, Info, Loader2, Lock, Pencil, PenLine, Save, Users } from 'lucide-react';
import { saveTraining, signTraining } from '../services/api';
import TrainingBadges from './training/TrainingBadges';
import TrainingFilters from './training/TrainingFilters';
import TrainingForm from './training/TrainingForm';
import TrainingTotals from './training/TrainingTotals';
import { displayDate, stationTodayKey } from '../utils/scheduleDate';
import {
  DEFAULT_TRAINING_SORT,
  emptyTrainingFilters,
  filterTrainings,
  normalizeTrainingList,
  signatureWindowDays,
  signedTrainingIds,
  signaturesForTraining,
  sortTrainingRows,
  trainingEditable,
  trainingEditBlockedReason,
  trainingSignBlockedReason,
  trainingTotals,
  membersMustSignTrainings,
  getTrainingCategories,
  trainingCategoryOptions,
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
// A signature is an acknowledgment of attendance, so it is add-only: a signed row's button is
// disabled rather than toggling back, and the backend refuses a removal by any other route than
// an administrator's.
export default function TrainingModule({
  token,
  currentUser,
  trainings = [],
  signatures = [],
  // The public system settings, for the SIGNING WINDOW: a training can be signed for a configured number of days after
  // its date (see utils/training), and the module closes the button rather than letting the writer refuse a click the
  // member has already made.
  systemSettings = [],
  canEdit = false,
  users = [],
  ranks = [],
  onChanged,
}) {
  const [pendingSignIds, setPendingSignIds] = useState(() => new Set());
  const [editing, setEditing] = useState(null);
  // Whether the editor modal is open: "new training" and "no editor" are both `editing === null`.
  const [editorOpen, setEditorOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState(() => new Set());

  // Department signing requirement: default true (members must sign).
  const membersMustSign = membersMustSignTrainings(systemSettings);

  // The open training is shown, not edited, when somebody has signed it, it is locked, or the user cannot edit.
  const viewOnly = !canEdit || (Boolean(editing) && !trainingEditable(editing, membersMustSign));
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

  const toggleExpanded = (trainingId) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(trainingId)) next.delete(trainingId);
      else next.add(trainingId);
      return next;
    });
  };

  const memberName = (userId) => {
    const user = (Array.isArray(users) ? users : []).find(
      (u) => String(u?.id ?? u?.user_id ?? u?.uid ?? '') === String(userId)
    );
    return user?.name || user?.full_name || user?.user_name || 'Member';
  };

  const signedIds = useMemo(
    () => signedTrainingIds(signatures, currentUser?.id),
    [signatures, currentUser?.id]
  );
  const categories = useMemo(() => getTrainingCategories(systemSettings), [systemSettings]);
  const categoryOptions = useMemo(() => trainingCategoryOptions(systemSettings), [systemSettings]);

  // Normalized, then filtered and sorted. A row with no id cannot be signed or edited, so it is
  // dropped here rather than rendered as a blank line (the backend's normalizeTrainingList does the
  // same).
  const allRows = useMemo(() => normalizeTrainingList(trainings, categories), [trainings, categories]);

  // The filters run on the same rows the table shows, so the totals below always add up to exactly
  // what is on screen - the whole point of the filter is to answer "how many hours is this?".
  const rows = useMemo(
    () => sortTrainingRows(filterTrainings(allRows, filters, { signedIds }), sort),
    [allRows, filters, signedIds, sort]
  );
  const totals = useMemo(() => trainingTotals(rows, signedIds), [rows, signedIds]);
  const pendingCount = pendingSignIds.size;

  // THE SIGNING WINDOW, read from the public settings the app already holds. `todayKey` is the STATION's today rather
  // than the device's, because a deadline is a station fact - the same comparison every other "is this still live?"
  // question in the app makes (utils/scheduleDate#stationTodayKey).
  const windowDays = signatureWindowDays(systemSettings);
  const todayKey = stationTodayKey();

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
    // CLOSED FOR SIGNATURE - the window has passed, or the record has been marked as finished. Say which rather than
    // doing nothing, in the words the writer would refuse with, so a click and a save cannot read differently.
    const blocked = trainingSignBlockedReason(training, { todayKey, windowDays });
    if (blocked) {
      setMessage({ type: 'info', text: blocked });
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
    if (viewOnly) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await saveTraining({ trainings: [values] }, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to save the training.');
      setEditing(null);
      setEditorOpen(false);
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
      {editorOpen && (
        <TrainingForm
          // Remounts when the edited row changes, so the form's state is seeded exactly once
          // per row instead of being re-seeded by an effect.
          key={editing?.id || 'new'}
          editing={editing}
          saving={saving}
          readOnly={viewOnly}
          readOnlyReason={viewOnly ? trainingEditBlockedReason(editing, membersMustSign) : ''}
          onSubmit={handleSaveTraining}
          onCancel={() => {
            setEditing(null);
            setEditorOpen(false);
          }}
          users={users}
          ranks={ranks}
          systemSettings={systemSettings}
          existingSignatures={editing ? signatures.filter((s) => String(s.training_id) === String(editing.id)) : []}
          currentUserId={currentUser?.id || currentUser?.uid || ''}
          currentUserName={currentUser?.name || currentUser?.full_name || currentUser?.user_name || ''}
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
        signedLabel={membersMustSign ? 'My signature' : 'My attendance'}
        signedYesLabel={membersMustSign ? 'Signed only' : 'Attended only'}
        signedNoLabel={membersMustSign ? 'Not signed only' : 'Not attended only'}
        categoryOptions={categoryOptions}
      />

      <TrainingTotals
        totals={totals}
        signedLabel={membersMustSign ? 'Signed by me' : 'Attended by me'}
        signedHint={membersMustSign ? null : `${totals.signedCount} attended`}
      />

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <PenLine className="w-4 h-4 text-red-500 shrink-0" />
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Training record</h3>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {totals.signedCount} of {totals.count} {membersMustSign ? 'signed' : 'attended'}
            {totals.count !== allRows.length ? ` (of ${allRows.length})` : ''}
          </span>
          <div className="ml-auto flex items-center gap-3">
            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setEditorOpen(true);
                }}
                // THE SAME SIZE AS "Save signatures" BESIDE IT: px-4 py-2, text-sm, a w-4 h-4 icon and a gap-2. The two
                // sit in one toolbar at the right-hand end, so a smaller button beside a larger one read as a secondary
                // action - which it is not: adding a training is a peer of saving a signature, not a lesser version of it.
                // The CHROME is still deliberately different (outlined rather than filled red), because Save is the one
                // that commits pending work and Add is not - matching the size while keeping the two readable apart is
                // the point, and it is why only the box changed here.
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                <PenLine className="h-4 w-4" />
                Add training
              </button>
            )}
            {membersMustSign && pendingCount > 0 && (
              <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                {pendingCount} unsaved {pendingCount === 1 ? 'signature' : 'signatures'}
              </span>
            )}
            {membersMustSign && (
              <button
                type="button"
                onClick={handleSaveSignatures}
                disabled={pendingCount === 0 || savingSignatures}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-4 py-2 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
              >
                {savingSignatures ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save signatures
              </button>
            )}
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

        {/* THE RULE, SAID ONCE, rather than only as a tooltip on a button the member cannot use: a Closed button explains
            itself on hover, but a member who never hovers would read it as a broken screen. Shown only when a window is
            configured - with none, there is nothing to say. */}
        {membersMustSign && windowDays !== null && (
          <p className="px-4 pt-3 text-xs text-slate-500 dark:text-slate-400">
            Trainings can be signed for {windowDays} day{windowDays === 1 ? '' : 's'} after the date. For anything older,
            ask an administrator.
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-100 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 uppercase text-xs">
              <tr>
                <th className="w-8 px-2 py-3" />
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Training</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Instructors</th>
                <th className="px-4 py-3 text-center" title="Locked & Approved / External">Ext.</th>
                <th className="px-4 py-3 text-right">Action</th>
                <th className="px-4 py-3 text-right">{membersMustSign ? 'Signature' : 'Attendance'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/70">
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
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
                const isOpen = expandedIds.has(id);
                const trainingSignatures = signaturesForTraining(signatures, id);
                // Rule: a training the module may not edit - because somebody has signed it, or
                // because it is locked - offers Open (read-only) in place of Edit.
                const editable = canEdit && trainingEditable(training, membersMustSign);
                const editBlockedReason = trainingEditBlockedReason(training, membersMustSign);
                // Why the signature button is closed, if it is. Worked out per row rather than stored on the training,
                // because the window is a setting and the clock keeps moving.
                const signBlockedReason = trainingSignBlockedReason(training, { todayKey, windowDays });
                return (
                  <React.Fragment key={id}>
                    <tr className="align-top">
                      <td className="px-2 py-3">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(id)}
                          title={
                            isOpen
                              ? membersMustSign
                                ? 'Hide signatures'
                                : 'Hide attendees'
                              : membersMustSign
                                ? 'Show signatures'
                                : 'Show attendees'
                          }
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
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {training.location || '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {training.instructors || '—'}
                      </td>
                      {/* A lock means the training has been locked/approved by an officer */}
                      <td className="px-4 py-3 text-center">
                        {training.locked ? (
                          <span
                            className="inline-flex text-emerald-600 dark:text-emerald-400"
                            title={
                              training.locked_by_name || training.locked_at
                                ? `Locked & approved${training.locked_by_name ? ` by ${training.locked_by_name}` : ''}${
                                    training.locked_at
                                      ? ` on ${new Date(training.locked_at).toLocaleDateString(undefined, {
                                          month: 'short',
                                          day: 'numeric',
                                          year: 'numeric',
                                        })}`
                                      : ''
                                  }`
                                : 'Locked & approved'
                            }
                          >
                            <Lock className="w-4 h-4" />
                          </span>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(training);
                            setEditorOpen(true);
                          }}
                          title={
                            editable
                              ? 'Edit this training'
                              : `${editBlockedReason} Open it to read the details.`
                          }
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                        >
                          {editable ? <Pencil className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          {editable ? 'Edit' : canEdit ? 'Open' : 'View'}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {membersMustSign ? (
                          <button
                            type="button"
                            onClick={() => toggleSign(training)}
                            disabled={isSigned || Boolean(signBlockedReason)}
                            title={
                              isSigned
                                ? 'You signed this training. Signatures cannot be removed.'
                                : signBlockedReason ||
                                  (isPending
                                    ? 'Click to take this back out of the batch'
                                    : 'Click to add your signature, then save')
                            }
                            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                              isSigned
                                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20 cursor-default'
                                : signBlockedReason
                                  ? 'cursor-not-allowed border-2 border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-500'
                                  : isPending
                                    ? 'border-2 border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                                    : 'border-2 border-dashed border-slate-300 text-slate-500 hover:border-slate-400 hover:text-slate-700 dark:border-slate-600 dark:text-slate-400 dark:hover:text-white'
                            }`}
                          >
                            {isSigned && <Check className="w-3.5 h-3.5" />}
                            {isSigned ? 'Signed' : signBlockedReason ? 'Closed' : isPending ? 'Ready to sign' : 'Sign'}
                          </button>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold ${
                              isSigned
                                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20'
                                : 'border border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-900/40'
                            }`}
                          >
                            {isSigned ? (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                <span>Attended</span>
                              </>
                            ) : (
                              <span>Not Attended</span>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50/70 dark:bg-slate-900/40">
                        <td colSpan={8} className="px-4 py-3 border-t border-slate-200 dark:border-slate-700/60">
                          <div className="space-y-2">
                            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                              <Users className="w-3.5 h-3.5 text-slate-500" />
                              <span>{membersMustSign ? 'Signatures' : 'Attendees'} ({trainingSignatures.length})</span>
                            </div>
                            {trainingSignatures.length === 0 ? (
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                {membersMustSign ? 'Nobody has signed this training yet.' : 'No attendance recorded yet.'}
                              </p>
                            ) : (
                              <ul className="flex flex-wrap gap-2">
                                {trainingSignatures.map((signature) => (
                                  <li
                                    key={signature.id || `${signature.training_id}-${signature.user_id}`}
                                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200"
                                  >
                                    {memberName(signature.user_id)}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {training.narrative && (
                              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 whitespace-pre-line">
                                {training.narrative}
                              </p>
                            )}
                          </div>
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
    </div>
  );
}
