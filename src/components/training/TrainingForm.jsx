import React, { useState } from 'react';
import { ClipboardCheck, Lock } from 'lucide-react';
import { MEMBER_EDITABLE_FLAGS, TRAINING_FLAGS, TRAINING_FLAG_KEYS, normalizeTraining, trainingLocked } from '../../utils/training';
import { recordHeading } from '../../utils/displayLabel';
import ViewportModal from '../ViewportModal';

// The add/edit form for a training activity, in the editor modal both audiences use.
//
// One component for both: a role with can_edit_trainings opens it from the Training module, and the
// Administration report opens the same one, so the two can never disagree about which fields a training has. The
// flag checkboxes come from TRAINING_FLAGS rather than being spelled out here, which is what keeps the form, the
// table badges and the backend column list in step.
//
// It was a collapsing card until now - a header that opened on a click and a body that pushed the table down the
// page. It is mounted only while it is open, which its state seeding already assumed: the callers give it a `key`
// derived from the row being edited, so switching rows remounts it rather than re-seeding state in an effect.
const TRAINING_FORM_ID = 'training-editor-form';
const EMPTY_FORM = {
  id: '',
  date: '',
  title: '',
  start_time: '',
  duration: '',
  location: '',
  instructors: '',
  narrative: '',
  ...TRAINING_FLAG_KEYS.reduce((flags, key) => ({ ...flags, [key]: false }), {}),
};

const formFromTraining = (training) => {
  if (!training) return EMPTY_FORM;
  const normalized = normalizeTraining(training);
  return {
    id: normalized.id,
    // The date input needs the station key, not whatever text the sheet held.
    date: normalized.date_key || '',
    title: normalized.title,
    start_time: normalized.start_time,
    duration: normalized.duration === null ? '' : String(normalized.duration),
    location: normalized.location,
    instructors: normalized.instructors,
    narrative: normalized.narrative,
    ...TRAINING_FLAG_KEYS.reduce(
      (flags, key) => ({ ...flags, [key]: Boolean(normalized[key]) }),
      {}
    ),
  };
};

export default function TrainingForm({
  editing = null,
  saving = false,
  onSubmit,
  onCancel,
  // Which flags this caller may set. The member module passes the member-facing set; the
  // Administration report passes all of them, including the external-system marker.
  allowAdminFlags = false,
  // Shows the training without any way to change it - for one somebody has signed.
  readOnly = false,
  readOnlyReason = '',
}) {
  // Seeded once per mount. Callers give the form a `key` derived from the row being edited, so
  // switching between "add" and a specific row remounts it rather than needing an effect to
  // re-seed state - which would render twice and briefly show the previous row's values.
  const [form, setForm] = useState(() => formFromTraining(editing));
  const isEditing = Boolean(form.id);
  const locked = trainingLocked(form);
  const frozen = locked || readOnly;
  const flags = allowAdminFlags ? TRAINING_FLAGS : MEMBER_EDITABLE_FLAGS;

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  // A training with no date or no title is not a training - the backend drops such a row, so
  // the form refuses it here rather than appearing to save and then quietly vanishing.
  const canSave = form.date.trim() !== '' && form.title.trim() !== '' && !saving && !frozen;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSave) return;
    onSubmit({
      ...form,
      id: form.id || '',
      duration: form.duration === '' ? '' : String(form.duration),
    });
  };

  return (
    // The reason the Save button is off, shown beside it in the toolbar - the reader should not have to hunt for it.
    <ViewportModal
      title={isEditing ? recordHeading('Training', form.title) : 'New training'}
      subtitle={
        readOnly
          ? 'Details'
          : isEditing
          ? 'Editing an existing training'
          : 'Record a training activity. Members can then sign it in their Training module.'
      }
      icon={<ClipboardCheck className="h-4 w-4" />}
      formId={TRAINING_FORM_ID}
      saveLabel={isEditing ? 'Save training' : 'Add training'}
      saving={saving}
      readOnly={readOnly}
      onClose={onCancel}
      actions={
        canSave || readOnly ? null : (
          <span className="mr-1 hidden text-xs text-slate-500 dark:text-slate-400 sm:inline">
            {locked ? 'This training is locked.' : 'A date and a title are required.'}
          </span>
        )
      }
    >
      <form id={TRAINING_FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        {locked && (
          <div className="p-3 rounded-xl flex items-start gap-2 text-sm font-medium bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:border-slate-700">
            <Lock className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              This training has been entered into an external system, so it is locked. Nothing about it
              or its signatures can be changed — the marker can only be cleared in the training sheet.
            </span>
          </div>
        )}

        {readOnly && !locked && readOnlyReason && (
          <div className="p-3 rounded-xl flex items-start gap-2 text-sm font-medium bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:border-slate-700">
            <Lock className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{readOnlyReason}</span>
          </div>
        )}

        <fieldset disabled={frozen} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Date</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => set('date', e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Title</label>
            <input
              type="text"
              placeholder="e.g. SCBA Refresher"
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Start time</label>
            <input
              type="time"
              value={form.start_time}
              onChange={(e) => set('start_time', e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Duration (hours)</label>
            <input
              type="number"
              step="0.25"
              min="0"
              placeholder="e.g. 2"
              value={form.duration}
              onChange={(e) => set('duration', e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Location</label>
            <input
              type="text"
              placeholder="e.g. Station 1 classroom"
              value={form.location}
              onChange={(e) => set('location', e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Instructors</label>
            <input
              type="text"
              placeholder="e.g. Capt. Cooper"
              value={form.instructors}
              onChange={(e) => set('instructors', e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Narrative</label>
          <textarea
            rows={3}
            placeholder="What was covered, and anything worth recording."
            value={form.narrative}
            onChange={(e) => set('narrative', e.target.value)}
            className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>

        <div>
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300 mb-2">Classification</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {flags.map((flag) => (
              <label
                key={flag.key}
                className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/60"
              >
                <input
                  type="checkbox"
                  checked={Boolean(form[flag.key])}
                  onChange={(e) => set(flag.key, e.target.checked)}
                  className="h-4 w-4 accent-red-600"
                />
                <span>{flag.label}</span>
              </label>
            ))}
          </div>
          {/* The external-system marker is set only here, and setting it locks the training for
              good - so it warns before the fact rather than after. */}
          {allowAdminFlags && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              <strong>Entered into an external system</strong> is permanent: checking it locks this training
              and its signatures for everyone, including administrators. Only the training sheet can undo it.
            </p>
          )}
        </div>

        </fieldset>
      </form>
    </ViewportModal>
  );
}
