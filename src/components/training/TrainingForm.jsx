import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Lock, Save, Loader2, X } from 'lucide-react';
import { MEMBER_EDITABLE_FLAGS, TRAINING_FLAGS, TRAINING_FLAG_KEYS, normalizeTraining, trainingLocked } from '../../utils/training';

// The add/edit form for a training activity.
//
// One component for both audiences: a role with can_edit_trainings sees it in the Training
// module, and the admin Training tab reuses it, so the two can never disagree about which
// fields a training has. The flag checkboxes come from TRAINING_FLAGS rather than being spelled
// out here, which is what keeps the form, the table badges and the backend column list in step.
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
}) {
  // Seeded once per mount. Callers give the form a `key` derived from the row being edited, so
  // switching between "add" and a specific row remounts it rather than needing an effect to
  // re-seed state - which would render twice and briefly show the previous row's values.
  const [form, setForm] = useState(() => formFromTraining(editing));
  // Collapsed by default to save screen space, but opened automatically when the caller is
  // editing a specific row - otherwise clicking Edit would appear to do nothing.
  const [open, setOpen] = useState(() => Boolean(editing));
  const isEditing = Boolean(form.id);
  const locked = trainingLocked(form);
  const flags = allowAdminFlags ? TRAINING_FLAGS : MEMBER_EDITABLE_FLAGS;

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  // A training with no date or no title is not a training - the backend drops such a row, so
  // the form refuses it here rather than appearing to save and then quietly vanishing.
  const canSave = form.date.trim() !== '' && form.title.trim() !== '' && !saving && !locked;

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
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      {/* The header is the collapse control. It stays visible when collapsed so "Add New
          Training" is always one click away rather than hidden behind a disclosure nobody sees. */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="w-full flex items-start gap-3 p-6 text-left hover:bg-slate-50 dark:hover:bg-slate-900/40 transition"
      >
        <span className="mt-0.5 text-slate-400 shrink-0">
          {open ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
        </span>
        <span className="min-w-0">
          <span className="block text-lg font-semibold text-slate-900 dark:text-white">
            {isEditing ? `Edit Training #${form.id}` : 'Add New Training'}
          </span>
          <span className="block text-sm text-slate-500 dark:text-slate-400">
            {isEditing
              ? 'Change the details of this training.'
              : 'Record a training activity. Members can then sign it in their Training module.'}
          </span>
        </span>
        {locked && (
          <span className="ml-auto shrink-0 inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-slate-900 px-3 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
            <Lock className="w-3.5 h-3.5" />
            Locked
          </span>
        )}
      </button>

      {open && (
      <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-4">
        {isEditing && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onCancel}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
              Cancel edit
            </button>
          </div>
        )}

        {locked && (
          <div className="p-3 rounded-xl flex items-start gap-2 text-sm font-medium bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:border-slate-700">
            <Lock className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              This training has been entered into an external system, so it is locked. Nothing about it
              or its signatures can be changed — the marker can only be cleared in the training sheet.
            </span>
          </div>
        )}

        <fieldset disabled={locked} className="space-y-4">
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
              placeholder="e.g. Capt. Alvarez"
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
              <strong>Entered into an external system</strong> is permanent: ticking it locks this training
              and its signatures for everyone, including administrators. Only the training sheet can undo it.
            </p>
          )}
        </div>

        <div className="flex flex-wrap justify-end items-center gap-3 pt-2 border-t border-slate-200 dark:border-slate-700/80 mt-2">
          {!canSave && !saving && (
            <span className="text-xs text-slate-500 dark:text-slate-400 mr-auto">
              {locked ? 'This training is locked.' : 'A date and a title are required.'}
            </span>
          )}
          <button
            type="submit"
            disabled={!canSave}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEditing ? 'Save Training' : 'Add Training'}
          </button>
        </div>
        </fieldset>
      </form>
      )}
    </div>
  );
}
