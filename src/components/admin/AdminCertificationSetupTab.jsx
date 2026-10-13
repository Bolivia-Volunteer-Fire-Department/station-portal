import React, { useState } from 'react';
import { Pencil, Trash2, AlertCircle, Award, Plus, Loader2 } from 'lucide-react';
import { adminSaveCertificationSetup, adminDeleteCertificationSetup } from '../../services/api';
import RankIcon from '../RankIcon';
import IconPicker from '../IconPicker';
import ConfirmModal from '../ConfirmModal';
import ViewportModal from '../ViewportModal';
import { recordHeading } from '../../utils/displayLabel';

// Text fields for configuring a certification type.
const TEXT_FIELDS = [
  { key: 'name', label: 'Name', type: 'text', placeholder: 'EMT, Paramedic, EVOC, Instructor 1…' },
  {
    key: 'warn_days_before',
    label: 'Warn this many days before it expires',
    type: 'number',
    placeholder: 'Blank = do not warn',
  },
  { key: 'sort_order', label: 'Sort order', type: 'number', placeholder: 'Lower first' },
];

// Toggle switches for certification behaviors and display options.
const SWITCHES = [
  {
    key: 'is_renewable',
    label: 'This certification can be renewed',
    help:
      'Renewals are recorded as a new period rather than overwriting the last. Unticked is for a one-off ' +
      'achievement: that turns the end date off, here and on the Certifications tab.',
  },
  {
    key: 'show_next_to_name',
    label: 'Display icon next to user name',
    help:
      "Shown beside the member's name wherever they appear, and only while the certification is current - an " +
      'expired badge would be the app claiming something the station cannot back.',
  },
  {
    key: 'show_on_roster',
    label: 'Show on Roster',
    help: 'Add a certification column to the Roster and mark members whose certification is current.',
  },
];

const EMPTY_FORM = {
  id: '',
  name: '',
  icon: '',
  description: '',
  sort_order: '',
  warn_days_before: '',
  is_renewable: false,
  show_next_to_name: false,
  show_on_roster: false,
};

// Certification Setup tab: manage the types of certifications the station tracks.
export default function AdminCertificationSetupTab({ token, setup = [], onDataChanged, onBadgesChanged }) {
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  // Close the editor modal and reset the form.
  const closeEditor = () => {
    setFormData(EMPTY_FORM);
    setError(null);
    setEditorOpen(false);
  };

  const startNew = () => {
    setFormData(EMPTY_FORM);
    setError(null);
    setEditorOpen(true);
  };

  const startEdit = (row) => {
    setEditorOpen(true);
    setFormData({
      id: row.id,
      name: row.name || '',
      icon: row.icon || '',
      description: row.description || '',
      sort_order: row.sort_order === undefined || row.sort_order === null ? '' : String(row.sort_order),
      warn_days_before:
        row.warn_days_before === null || row.warn_days_before === undefined ? '' : String(row.warn_days_before),
      is_renewable: !!row.is_renewable,
      show_next_to_name: !!row.show_next_to_name,
      show_on_roster: !!row.show_on_roster,
    });
    setError(null);
  };

  const handleSave = async () => {
    if (!String(formData.name).trim()) {
      setError('A certification needs a name.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await adminSaveCertificationSetup(formData, token);
      if (!response?.success) {
        setError(response?.message || 'Could not save this certification.');
        return;
      }
      closeEditor();
      // Update badge icons across the app immediately.
      onBadgesChanged?.(response.badges);
      void onDataChanged?.('certificationSetup');
    } catch (err) {
      setError(err.message || 'Could not save this certification.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;

    setDeletingId(target.id);
    setError(null);
    try {
      const response = await adminDeleteCertificationSetup(target.id, token);
      if (!response?.success) {
        setError(response?.message || 'Could not delete this certification.');
        return;
      }
      if (formData.id === target.id) closeEditor();
      void onDataChanged?.('certificationSetup');
    } catch (err) {
      setError(err.message || 'Could not delete this certification.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* The editor, in the viewport modal every New card in this module now uses. Its body is a div rather than a
          <form>, so the toolbar's Save calls handleSave through onSave instead of submitting anything. */}
      {editorOpen && (
        <ViewportModal
          title={formData.id ? recordHeading('certification', formData.name) : 'New certification type'}
          subtitle={formData.id ? 'Editing an existing type' : 'Not saved yet'}
          icon={<Award className="h-4 w-4" />}
          onSave={handleSave}
          saveLabel={formData.id ? 'Save changes' : 'Add certification'}
          saving={saving}
          onClose={closeEditor}
        >
        <div className="space-y-4">
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-600 dark:border-red-800/80 dark:bg-red-950/80 dark:text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {TEXT_FIELDS.map((field) => (
            <label key={field.key} className="block">
              <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                {field.label}
              </span>
              <input
                type={field.type}
                min={field.type === 'number' ? 0 : undefined}
                value={formData[field.key]}
                onChange={(event) => setFormData({ ...formData, [field.key]: event.target.value })}
                placeholder={field.placeholder}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </label>
          ))}

          <label className="block">
            <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Icon</span>
            <IconPicker
              value={formData.icon}
              onChange={(icon) => setFormData({ ...formData, icon })}
              label="certification icon"
            />
          </label>
        </div>

        <div className="mt-6 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">
          {SWITCHES.map((item) => (
            <label key={item.key} className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={formData[item.key]}
                onChange={(event) => setFormData({ ...formData, [item.key]: event.target.checked })}
                className="mt-0.5 h-4 w-4"
              />
              <span className="text-sm text-slate-700 dark:text-slate-200">
                <span className="font-medium">{item.label}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">{item.help}</span>
              </span>
            </label>
          ))}
        </div>

        </div>
        </ViewportModal>
      )}

      {/* List of certification types with add button. */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <Award className="h-4 w-4 shrink-0 text-red-500" />
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Certification types</h3>
          <button
            type="button"
            onClick={startNew}
            className="ml-auto flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500"
          >
            <Plus className="h-4 w-4" />
            New certification type
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-xs uppercase text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Certification</th>
                <th className="px-4 py-3">Renewable</th>
                <th className="px-4 py-3">Warn</th>
                <th className="px-4 py-3">Beside name</th>
                <th className="px-4 py-3">Show on Roster</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/70">
              {setup.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500 dark:text-slate-400">
                    No certifications yet. Add the first one above.
                  </td>
                </tr>
              ) : (
                setup.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                      <span className="flex items-center gap-2">
                        <RankIcon name={row.icon} className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-300" />
                        {row.name}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {row.is_renewable ? 'Yes' : 'No (no end date)'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {row.warn_days_before === null || row.warn_days_before === undefined
                        ? 'Not warned'
                        : `${row.warn_days_before} days`}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {row.show_next_to_name ? 'Yes' : 'No'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {row.show_on_roster ? 'Yes' : 'No'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-700"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDelete(row)}
                          disabled={deletingId === row.id}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-100 disabled:opacity-50 dark:bg-red-950/60 dark:text-red-400 dark:hover:bg-red-900/60"
                        >
                          {deletingId === row.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pendingDelete && (
        <ConfirmModal
          title={`Delete ${pendingDelete.name}?`}
          message="This removes the certification from the setup list. It is refused while any member record still uses it, so no record is ever left pointing at nothing."
          confirmLabel="Delete certification"
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

