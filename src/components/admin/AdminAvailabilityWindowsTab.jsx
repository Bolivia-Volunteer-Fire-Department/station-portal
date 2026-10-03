import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Clock, Trash2, Plus, AlertCircle } from 'lucide-react';
import {
  adminDeleteAvailabilityWindow,
  adminFetchAvailabilityWindows,
  adminSaveAvailabilityWindow,
} from '../../services/api';
import { toTimeInputValue } from '../../utils/timeInputValue';
import { toDateKey } from '../../utils/scheduleDate';
import { windowIsLiveOn } from '../../utils/availability';
import ConfirmModal from '../ConfirmModal';
import ViewportModal from '../ViewportModal';
import { recordHeading } from '../../utils/displayLabel';

// The editor form's id. The modal's Save button lives in the toolbar, outside the <form>, and submits it through the
// HTML `form` attribute - so Enter in a text input still saves the window.
const WINDOW_FORM_ID = 'availability-window-editor-form';

const EMPTY_FORM = {
  id: '',
  nickname: '',
  start_time: '',
  end_time: '',
  is_monday: false,
  is_tuesday: false,
  is_wednesday: false,
  is_thursday: false,
  is_friday: false,
  is_saturday: false,
  is_sunday: false,
  effective_date: '',
  end_date: '',
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

function FieldLabel({ htmlFor, children }) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1.5"
    >
      {children}
    </label>
  );
}

const INPUT_CLASS =
  'w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500';

// AVAILABILITY WINDOWS are the weekly patterns a member chooses from, and this is where an officer maintains them.
//
// It is deliberately the closest thing in the app to the Shifts tab: a window is a start time, an end time and the days
// it runs on - the same shape, and the same familiar editor. Two fields are the windows' own: the NICKNAME, which is
// what a member sees on the pill, and the EFFECTIVE/END pair, which is the life of the CONFIGURATION rather than of an
// occurrence. Retiring a window is ending it on its last day rather than deleting it: members' claims point at it, and
// the history should still read (utils/availability.js).
//
// THIS IS THE OPTIONS LIST, NOT THE CLAIMS. A member still marks themselves available day by day, exactly as before -
// what changed is where the options come from. Nothing else reads windows yet: the member module and the
// administration roster move onto them in the next step, which is why saving here reloads this list and nothing else.
function AdminAvailabilityWindowsTab({ token, onDataChanged }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  // The row whose delete is being confirmed in the modal below.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [error, setError] = useState(null);
  // The editor is a modal, opened by New window or by choosing a row, so the page behind it is the list.
  const [editorOpen, setEditorOpen] = useState(false);

  const reload = useCallback(async () => {
    const result = await adminFetchAvailabilityWindows(token);
    if (!result?.success) throw new Error(result?.message || 'Failed to load availability windows.');
    setRows(Array.isArray(result.availabilityWindows) ? result.availabilityWindows : []);
  }, [token]);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setLoadError(null);
    reload()
      .catch((err) => {
        if (!canceled) setLoadError(err.message || 'Failed to load availability windows.');
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [reload]);

  const isEditing = !!formData.id;

  // Closing the editor and clearing the form are the same act, so every existing call site - saved, cancelled and
  // deleted-while-open - carries on working unchanged.
  const resetForm = () => {
    setFormData(EMPTY_FORM);
    setEditorOpen(false);
  };

  const buildFormFromWindow = (row) => ({
    id: row.id,
    // Carried through the form so the backend can refuse a save built on a stale copy.
    row_version: row.row_version,
    nickname: row.nickname || '',
    start_time: toTimeInputValue(row.start_time),
    end_time: toTimeInputValue(row.end_time),
    is_monday: isTruthy(row.is_monday),
    is_tuesday: isTruthy(row.is_tuesday),
    is_wednesday: isTruthy(row.is_wednesday),
    is_thursday: isTruthy(row.is_thursday),
    is_friday: isTruthy(row.is_friday),
    is_saturday: isTruthy(row.is_saturday),
    is_sunday: isTruthy(row.is_sunday),
    effective_date: row.effective_date || '',
    end_date: row.end_date || '',
  });

  const handleEdit = (row) => {
    setError(null);
    setFormData(buildFormFromWindow(row));
    setEditorOpen(true);
  };

  const setField = (key, value) => setFormData((previous) => ({ ...previous, [key]: value }));

  const toggleDay = (key) => setFormData((previous) => ({ ...previous, [key]: !previous[key] }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await adminSaveAvailabilityWindow(formData, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to save the window.');
      await reload();
      // A save here is a change members will see, because their module draws its options from this list. Nothing reads
      // the list yet - the switchover comes next - so this reloads its own table and tells the app a save happened.
      void onDataChanged?.();
      resetForm();
    } catch (err) {
      setError(err.message || 'Failed to save the window.');
    } finally {
      setSaving(false);
    }
  };

  // The row awaiting confirmation. Nothing is written until the modal below is answered.
  const handleDelete = (row) => setPendingDelete(row);

  const confirmDelete = async () => {
    const row = pendingDelete;
    setPendingDelete(null);
    if (!row) return;
    setDeletingId(row.id);
    setError(null);
    try {
      const result = await adminDeleteAvailabilityWindow(row.id, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to delete the window.');
      await reload();
      void onDataChanged?.();
      if (String(formData.id) === String(row.id)) resetForm();
    } catch (err) {
      setError(err.message || 'Failed to delete the window.');
    } finally {
      setDeletingId(null);
    }
  };

  const activeDayCount = (row) => DAYS.filter((day) => isTruthy(row[day.key])).length;

  // What the list says about a window's life, in the spirit of the announcements list's Showing / Not showing. A retired
  // window is kept on purpose - claims point at it, and the history should read - so the screen has to say which ones are
  // retired rather than leaving an officer to work it out from two dates.
  const todayKey = toDateKey(new Date());
  const lifeLabel = (row) => (windowIsLiveOn(row, todayKey) ? 'Active' : 'Inactive');

  return (
    <div className="space-y-6">
      {/* The editor, in a modal that takes most of the viewport - the format every New card in the Administration
          module uses. Mounted only while it is open. */}
      {editorOpen && (
        <ViewportModal
          title={isEditing ? recordHeading('Availability window', formData.nickname) : 'New availability window'}
          subtitle={isEditing ? 'Editing an existing window' : 'Not saved yet'}
          icon={<Clock className="h-4 w-4" />}
          formId={WINDOW_FORM_ID}
          saveLabel={isEditing ? 'Save changes' : 'Add window'}
          saving={saving}
          onClose={resetForm}
        >
          <form id={WINDOW_FORM_ID} onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <FieldLabel htmlFor="availability-window-nickname">Nickname</FieldLabel>
              <input
                id="availability-window-nickname"
                className={INPUT_CLASS}
                value={formData.nickname}
                onChange={(event) => setField('nickname', event.target.value)}
                placeholder="Tuesday night"
                autoFocus
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                What members see on the pill. Keep it short — it has to fit in a calendar cell.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <FieldLabel htmlFor="availability-window-start">Starts</FieldLabel>
                <input
                  id="availability-window-start"
                  type="time"
                  className={INPUT_CLASS}
                  value={formData.start_time}
                  onChange={(event) => setField('start_time', event.target.value)}
                />
              </div>
              <div>
                <FieldLabel htmlFor="availability-window-end">Ends</FieldLabel>
                <input
                  id="availability-window-end"
                  type="time"
                  className={INPUT_CLASS}
                  value={formData.end_time}
                  onChange={(event) => setField('end_time', event.target.value)}
                />
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  An end before the start means it runs into the next morning — a Tuesday night ends on Wednesday, and
                  still belongs to Tuesday.
                </p>
              </div>
            </div>

            <div>
              <FieldLabel>Days</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {DAYS.map((day) => (
                  <button
                    key={day.key}
                    type="button"
                    onClick={() => toggleDay(day.key)}
                    aria-pressed={formData[day.key]}
                    className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition ${
                      formData[day.key]
                        ? 'bg-red-600 border-red-600 text-white'
                        : 'bg-slate-50 dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-red-400'
                    }`}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Tick every day this window runs on. Each ticked day is a day a member can claim it for.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <FieldLabel htmlFor="availability-window-effective">Effective date</FieldLabel>
                <input
                  id="availability-window-effective"
                  type="date"
                  className={INPUT_CLASS}
                  value={formData.effective_date}
                  onChange={(event) => setField('effective_date', event.target.value)}
                />
              </div>
              <div>
                <FieldLabel htmlFor="availability-window-end-date">End date</FieldLabel>
                <input
                  id="availability-window-end-date"
                  type="date"
                  className={INPUT_CLASS}
                  value={formData.end_date}
                  onChange={(event) => setField('end_date', event.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              These date the <strong>configuration</strong>, not one occurrence. Leave the end date blank while the window
              is current, and set it to the last day it applied when the station's shift structure changes — the window
              stays on the list, so the history that references it still reads, but it stops appearing for members.
            </p>
          </form>
        </ViewportModal>
      )}

      {loadError && (
        <div className="rounded-2xl border border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {/* THE CARD AND ITS "New window" BUTTON RENDER WHETHER OR NOT THERE ARE ANY WINDOWS YET. The list and the empty state
          used to be two separate panels behind `rows.length`, so a station with no windows - the state every station starts
          in, and the state this one is in - got a sentence saying so and NO WAY TO ADD THE FIRST ONE. That is the one
          moment the button is most needed, so the header is now unconditional and the empty state sits inside it. */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Availability windows ({rows.length})
          </h3>
          <button
            type="button"
            onClick={() => {
              resetForm();
              setEditorOpen(true);
            }}
            className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500"
          >
            <Plus className="h-4 w-4" />
            New window
          </button>
        </div>

        {rows.length === 0 ? (
          <p className="px-6 py-6 text-sm text-slate-500 dark:text-slate-400">
            {loading
              ? 'Loading availability windows…'
              : 'No availability windows yet. Members have nothing to choose from until at least one exists — press New window to add the first one.'}
          </p>
        ) : (
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-100 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 uppercase text-xs">
              <tr>
                <th className="px-4 py-3">Nickname</th>
                <th className="px-4 py-3">Starts</th>
                <th className="px-4 py-3">Ends</th>
                <th className="px-4 py-3">Days</th>
                <th className="px-4 py-3">In force</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/70">
              {rows.map((row) => {
                const retired = lifeLabel(row) === 'Retired';
                return (
                  <tr
                    key={row.id}
                    className={retired ? 'text-slate-500 dark:text-slate-400' : 'text-slate-700 dark:text-slate-200'}
                  >
                    <td className="px-4 py-3 font-medium">{row.nickname || '—'}</td>
                    <td className="px-4 py-3 font-mono">{toTimeInputValue(row.start_time) || '—'}</td>
                    <td className="px-4 py-3 font-mono">{toTimeInputValue(row.end_time) || '—'}</td>
                    <td className="px-4 py-3">
                      {activeDayCount(row) > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {DAYS.filter((day) => isTruthy(row[day.key])).map((day) => (
                            <span
                              key={day.key}
                              className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-600 border border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800"
                            >
                              {day.label}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span>—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${
                          retired
                            ? 'bg-slate-100 text-slate-500 border-slate-300 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800'
                        }`}
                      >
                        {lifeLabel(row)}
                      </span>
                      <span className="block mt-1 text-xs">
                        {row.effective_date || 'always'} → {row.end_date || 'still current'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleEdit(row)}
                          className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(row)}
                          disabled={deletingId === row.id}
                          className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
                        >
                          {deletingId === row.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Confirmed in the app rather than by a native dialog: it can be styled, it is heard (ConfirmModal plays the
          tone), and it names what is about to be deleted. A window that members have claimed should normally be
          RETIRED by setting an end date rather than deleted, which is what the editor above says. */}
      {pendingDelete && (
        <ConfirmModal
          title="Delete availability window"
          message={
            <>
              Delete{' '}
              <strong className="text-slate-900 dark:text-white">{pendingDelete.nickname || 'this window'}</strong>? Any
              claims pointing at it are left behind, without a window to explain them. Setting an end date retires it
              instead, and keeps the history readable.
            </>
          }
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

export default AdminAvailabilityWindowsTab;
