import React, { useState } from 'react';
import { Loader2, Pencil, Shield, Trash2, Plus, AlertCircle } from 'lucide-react';
import { adminSaveRank, adminDeleteRank } from '../../services/api';
import RankIcon from '../RankIcon';
import IconPicker from '../IconPicker';
import ConfirmModal from '../ConfirmModal';
import ViewportModal from '../ViewportModal';
import { recordHeading } from '../../utils/displayLabel';

const EMPTY_FORM = { id: '', description: '', color: '#ef4444', icon: '', rank_order: '' };

// The editor form's id. The modal's Save button lives in the toolbar, outside the <form>, and submits it through
// the HTML `form` attribute - so Enter in a text input still submits the rank.
const RANK_FORM_ID = 'rank-editor-form';

export default function AdminRanksTab({ token, ranks, onDataChanged, onRowSaved }) {
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  // The row whose delete is being confirmed in the modal below.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [error, setError] = useState(null);
  // The editor is a modal now, opened by New rank or by choosing a row, so the page behind it is the list.
  const [editorOpen, setEditorOpen] = useState(false);

  const isEditing = !!formData.id;
  // Closing the editor and clearing the form are the same act, which is why every existing call site - saved,
  // cancelled, and deleted-while-open - carries on working: all three wanted both.
  const resetForm = () => {
    setFormData(EMPTY_FORM);
    setEditorOpen(false);
  };

  const handleEdit = (rank) => {
    setError(null);
    setEditorOpen(true);
    setFormData({
      id: rank.id,
      // Carried through the form so the backend can refuse a save built on a stale copy.
      row_version: rank.row_version,
      description: rank.description || '',
      color: rank.color || '#ef4444',
      icon: rank.icon || '',
      rank_order:
        rank.rank_order === undefined || rank.rank_order === null ? '' : String(rank.rank_order),
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await adminSaveRank(formData, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to save rank.');
      // Straight onto the table; the refresh wave lands on its own time.
      onRowSaved?.('ranks', formData);
      void onDataChanged('ranks');
      resetForm();
    } catch (err) {
      setError(err.message || 'Failed to save rank.');
    } finally {
      setSaving(false);
    }
  };

  // The row awaiting confirmation. Nothing is written until the modal below is answered; the work
  // itself is unchanged, it just runs from the modal's callback instead of inline.
  const handleDelete = (rank) => setPendingDelete(rank);

  const confirmDelete = async () => {
    const rank = pendingDelete;
    setPendingDelete(null);
    if (!rank) return;
    setDeletingId(rank.id);
    setError(null);
    try {
      const result = await adminDeleteRank(rank.id, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to delete rank.');
      void onDataChanged('ranks');
      if (String(formData.id) === String(rank.id)) resetForm();
    } catch (err) {
      setError(err.message || 'Failed to delete rank.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* The editor, in a modal that takes most of the viewport - the format every New card in the Administration
          module uses. The rank form is short, but the table behind it was being pushed down the page by a form
          that was almost always empty, and the modal also gives an unsaved rank somewhere to be abandoned.
          Mounted only while it is open, so the page is just the list. */}
      {editorOpen && (
        <ViewportModal
          title={isEditing ? recordHeading('Rank', formData.description) : 'New rank'}
          subtitle={isEditing ? 'Editing an existing rank' : 'Not saved yet'}
          icon={<Shield className="h-4 w-4" />}
          formId={RANK_FORM_ID}
          saveLabel={isEditing ? 'Save changes' : 'Add rank'}
          saving={saving}
          onClose={resetForm}
        >
          <form id={RANK_FORM_ID} onSubmit={handleSubmit} className="space-y-4">

              {error && (
                <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Description</label>
                  <input
                    type="text"
                    required
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Rank Order</label>
                  <input
                    type="number"
                    step="1"
                    value={formData.rank_order}
                    onChange={(e) => setFormData({ ...formData, rank_order: e.target.value })}
                    placeholder="e.g. 1"
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                    Higher number = higher rank. Members can be scheduled for their own rank and every lower one.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={formData.color}
                      onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                      className="w-11 h-11 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl cursor-pointer"
                    />
                    <input
                      type="text"
                      value={formData.color}
                      onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Icon</label>
                  <div className="flex items-end gap-3">
                    <IconPicker
                      value={formData.icon}
                      onChange={(icon) => setFormData({ ...formData, icon })}
                    />
                    {/* The picker can only show one neutral glyph; this shows the same icon in the rank's colour. */}
                    <div className="shrink-0 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700">
                      <RankIcon name={formData.icon} className="w-5 h-5" style={{ color: formData.color }} />
                    </div>
                  </div>
                </div>
              </div>

          </form>
        </ViewportModal>
      )}

      {/* The list, with New rank where somebody looks when they want another one - the same place Documents keeps
          its New document. */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-x-auto">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <Shield className="h-4 w-4 shrink-0 text-red-500" />
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Ranks</h3>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {(Array.isArray(ranks) ? ranks.length : 0)} rank
            {(Array.isArray(ranks) ? ranks.length : 0) === 1 ? '' : 's'}
          </span>
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
            New rank
          </button>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-100 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 uppercase text-xs">
            <tr>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3">Rank Order</th>
              <th className="px-4 py-3">Color</th>
              <th className="px-4 py-3">Icon</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700/70">
            {[...ranks]
              .sort((a, b) => {
                const ao = parseInt(a.rank_order, 10);
                const bo = parseInt(b.rank_order, 10);
                if (!Number.isFinite(ao) && !Number.isFinite(bo)) return String(a.description || '').localeCompare(String(b.description || ''));
                if (!Number.isFinite(ao)) return 1;
                if (!Number.isFinite(bo)) return -1;
                return bo - ao;
              })
              .map((rank) => (
              <tr key={rank.id} className="text-slate-700 dark:text-slate-200">
                <td className="px-4 py-3 font-medium">{rank.description}</td>
                <td className="px-4 py-3 font-mono text-slate-500 dark:text-slate-400">
                  {Number.isFinite(parseInt(rank.rank_order, 10)) ? parseInt(rank.rank_order, 10) : <span className="text-amber-600 dark:text-amber-400">Not set</span>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full border border-slate-300 dark:border-slate-600" style={{ backgroundColor: rank.color }} />
                    <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{rank.color}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {rank.icon ? (
                    <div className="flex items-center gap-2" title={rank.icon}>
                      <RankIcon name={rank.icon} className="w-4 h-4" style={{ color: rank.color }} />
                      <span className="text-slate-500 dark:text-slate-400 text-xs">{rank.icon}</span>
                    </div>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button onClick={() => handleEdit(rank)} className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(rank)}
                      disabled={deletingId === rank.id}
                      className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
                    >
                      {deletingId === rank.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {ranks.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">No ranks found.</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>

      </div>

      {/* Confirmed in the app rather than by a native dialog: it can be styled, it is heard
          (ConfirmModal plays the tone), and it names what is about to be deleted. */}
      {pendingDelete && (
        <ConfirmModal
          title="Delete rank"
          message={<>Delete <strong className="text-slate-900 dark:text-white">{pendingDelete.description}</strong>? Users with this rank will need to be reassigned.</>}
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
