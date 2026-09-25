import React, { useState } from 'react';
import { Save, Loader2, Pencil, Trash2, Plus, AlertCircle, X } from 'lucide-react';
import { adminSaveRank, adminDeleteRank } from '../../services/api';
import RankIcon, { RANK_ICON_MAP } from '../RankIcon';

const EMPTY_FORM = { id: '', description: '', color: '#ef4444', icon: '', rank_order: '' };

export default function AdminRanksTab({ token, ranks, onDataChanged, onRowSaved }) {
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState(null);

  const isEditing = !!formData.id;
  const resetForm = () => setFormData(EMPTY_FORM);

  const handleEdit = (rank) => {
    setError(null);
    setFormData({
      id: rank.id,
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
      void onDataChanged();
      resetForm();
    } catch (err) {
      setError(err.message || 'Failed to save rank.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (rank) => {
    if (!window.confirm(`Delete rank "${rank.description}"? Users with this rank will need to be reassigned.`)) return;
    setDeletingId(rank.id);
    setError(null);
    try {
      const result = await adminDeleteRank(rank.id, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to delete rank.');
      void onDataChanged();
      if (String(formData.id) === String(rank.id)) resetForm();
    } catch (err) {
      setError(err.message || 'Failed to delete rank.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{isEditing ? `Edit Rank #${formData.id}` : 'Add New Rank'}</h3>
            {isEditing && (
              <button type="button" onClick={resetForm} className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1 text-sm">
                <X className="w-4 h-4" /> Cancel
              </button>
            )}
          </div>

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
              <div className="flex items-center gap-3">
                <select
                  value={formData.icon}
                  onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="">-- No Icon --</option>
                  {Object.keys(RANK_ICON_MAP).map((iconName) => (
                    <option key={iconName} value={iconName}>{iconName}</option>
                  ))}
                </select>
                <div className="shrink-0 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700">
                  <RankIcon name={formData.icon} className="w-5 h-5" style={{ color: formData.color }} />
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : isEditing ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {isEditing ? 'Save Changes' : 'Add Rank'}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-x-auto">
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
  );
}
