import React, { useState } from 'react';
import { Loader2, Pencil, Clock, Trash2, Plus, AlertCircle } from 'lucide-react';
import { adminSaveShift, adminDeleteShift } from '../../services/api';
import { toTimeInputValue } from '../../utils/timeInputValue';
import ConfirmModal from '../ConfirmModal';
import ViewportModal from '../ViewportModal';
import { recordHeading } from '../../utils/displayLabel';

// The editor form's id. The modal's Save button lives in the toolbar, outside the <form>, and submits it through
// the HTML `form` attribute - so Enter in a text input still submits the shift.
const SHIFT_FORM_ID = 'shift-editor-form';

const EMPTY_FORM = {
  id: '',
  description: '',
  start_time: '',
  end_time: '',
  is_monday: false,
  is_tuesday: false,
  is_wednesday: false,
  is_thursday: false,
  is_friday: false,
  is_saturday: false,
  is_sunday: false,
};

const DAYS = [
  { key: 'is_monday', label: 'Mon' },
  { key: 'is_tuesday', label: 'Tue' },
  { key: 'is_wednesday', label: 'Wed' },
  { key: 'is_thursday', label: 'Thu' },
  { key: 'is_friday', label: 'Fri' },
  { key: 'is_saturday', label: 'Sat' },
  { key: 'is_sunday', label: 'Sun' },
];

function isTruthy(value) {
  return value === true || String(value).trim().toUpperCase() === 'TRUE';
}

export default function AdminShiftsTab({ token, shifts = [], onDataChanged }) {
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  // The row whose delete is being confirmed in the modal below.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [error, setError] = useState(null);
  // The editor is a modal now, opened by New shift or by choosing a row, so the page behind it is the list.
  const [editorOpen, setEditorOpen] = useState(false);

  const isEditing = !!formData.id;
  // Closing the editor and clearing the form are the same act, so every existing call site - saved, cancelled and
  // deleted-while-open - carries on working unchanged.
  const resetForm = () => {
    setFormData(EMPTY_FORM);
    setEditorOpen(false);
  };

  const buildFormFromShift = (shift) => ({
    id: shift.id,
      // Carried through the form so the backend can refuse a save built on a stale copy.
      row_version: shift.row_version,
    description: shift.description || '',
    start_time: toTimeInputValue(shift.start_time),
    end_time: toTimeInputValue(shift.end_time),
    is_monday: isTruthy(shift.is_monday),
    is_tuesday: isTruthy(shift.is_tuesday),
    is_wednesday: isTruthy(shift.is_wednesday),
    is_thursday: isTruthy(shift.is_thursday),
    is_friday: isTruthy(shift.is_friday),
    is_saturday: isTruthy(shift.is_saturday),
    is_sunday: isTruthy(shift.is_sunday),
  });

  const handleEdit = (shift) => {
    setError(null);
    setFormData(buildFormFromShift(shift));
    setEditorOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await adminSaveShift(formData, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to save shift.');
      void onDataChanged('shifts');
      resetForm();
    } catch (err) {
      setError(err.message || 'Failed to save shift.');
    } finally {
      setSaving(false);
    }
  };

  // The row awaiting confirmation. Nothing is written until the modal below is answered; the work
  // itself is unchanged, it just runs from the modal's callback instead of inline.
  const handleDelete = (shift) => setPendingDelete(shift);

  const confirmDelete = async () => {
    const shift = pendingDelete;
    setPendingDelete(null);
    if (!shift) return;
    setDeletingId(shift.id);
    setError(null);
    try {
      const result = await adminDeleteShift(shift.id, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to delete shift.');
      void onDataChanged('shifts');
      if (String(formData.id) === String(shift.id)) resetForm();
    } catch (err) {
      setError(err.message || 'Failed to delete shift.');
    } finally {
      setDeletingId(null);
    }
  };

  const activeDayCount = (shift) => DAYS.filter((d) => isTruthy(shift[d.key])).length;

  return (
    <div className="space-y-6">
      {/* The editor, in a modal that takes most of the viewport - the format every New card in the Administration
          module uses. A shift has nine fields and a day grid, and the table behind it no longer has to sit under a
          form that was usually empty. Mounted only while it is open. */}
      {editorOpen && (
        <ViewportModal
          title={isEditing ? recordHeading('Shift', formData.description) : 'New shift'}
          subtitle={isEditing ? 'Editing an existing shift' : 'Not saved yet'}
          icon={<Clock className="h-4 w-4" />}
          formId={SHIFT_FORM_ID}
          saveLabel={isEditing ? 'Save changes' : 'Add shift'}
          saving={saving}
          onClose={resetForm}
        >
          <form id={SHIFT_FORM_ID} onSubmit={handleSubmit} className="space-y-4">

              {error && (
                <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-3">
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Description</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Day Shift, Night Shift"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Start Time</label>
                  <input
                    type="time"
                    required
                    value={formData.start_time}
                    onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">End Time</label>
                  <input
                    type="time"
                    required
                    value={formData.end_time}
                    onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>

                <div className="md:col-span-3">
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                    Days of Week <span className="text-slate-500">(the day the shift starts)</span>
                  </label>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                    {DAYS.map(({ key, label }) => (
                      <label
                        key={key}
                        className={`flex items-center justify-center cursor-pointer px-2 py-2 rounded-xl text-sm font-medium border transition select-none ${
                          formData[key]
                            ? 'bg-red-600 text-white border-red-600 shadow-sm'
                            : 'bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-300 dark:border-slate-600 hover:border-red-400 dark:hover:border-red-500'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={formData[key]}
                          onChange={(e) => setFormData({ ...formData, [key]: e.target.checked })}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

          </form>
        </ViewportModal>
      )}

      {/* Shifts Table, with New shift where somebody looks when they want another one. */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-x-auto">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <Clock className="h-4 w-4 shrink-0 text-red-500" />
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Shifts</h3>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setFormData(EMPTY_FORM);
              setEditorOpen(true);
            }}
            className="ml-auto flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500"
          >
            <Plus className="h-4 w-4" />
            New shift
          </button>
        </div>

        <table className="w-full text-sm text-left">
          <thead className="sticky top-0 z-10 bg-slate-100/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700/60 text-slate-500 dark:text-slate-400 uppercase text-xs">
            <tr>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3">Start</th>
              <th className="px-4 py-3">End</th>
              <th className="px-4 py-3">Days</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700/70">
            {shifts.map((shift) => (
              <tr key={shift.id} className="text-slate-700 dark:text-slate-200">
                <td className="px-4 py-3 font-medium">{shift.description}</td>
                <td className="px-4 py-3 font-mono">{toTimeInputValue(shift.start_time) || '—'}</td>
                <td className="px-4 py-3 font-mono">{toTimeInputValue(shift.end_time) || '—'}</td>
                <td className="px-4 py-3">
                  {activeDayCount(shift) > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {DAYS.filter((d) => isTruthy(shift[d.key])).map((d) => (
                        <span
                          key={d.key}
                          className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-600 border border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800"
                        >
                          {d.label}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button onClick={() => handleEdit(shift)} className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(shift)}
                      disabled={deletingId === shift.id}
                      className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
                    >
                      {deletingId === shift.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {shifts.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">No shifts found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Confirmed in the app rather than by a native dialog: it can be styled, it is heard
          (ConfirmModal plays the tone), and it names what is about to be deleted. */}
      {pendingDelete && (
        <ConfirmModal
          title="Delete shift"
          message={<>Delete <strong className="text-slate-900 dark:text-white">{pendingDelete.description}</strong>? This cannot be undone.</>}
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}