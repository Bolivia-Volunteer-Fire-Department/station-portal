import React, { useState } from 'react';
import { Save, Loader2, Pencil, Trash2, Plus, AlertCircle, X, Music } from 'lucide-react';
import { adminSaveUser, adminDeleteUser } from '../../services/api';

const EMPTY_FORM = { id: '', user_name: '', name: '', password: '', status: 'active', role_id: '', rank_id: '', exclude_from_scheduling: 'FALSE', runner_sound_profile: '' };

export default function AdminUsersTab({ token, users, roles, ranks, onDataChanged, isAdmin = false, onRowSaved }) {
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const isEditing = !!formData.id;

  const resetForm = () => setFormData(EMPTY_FORM);

  const handleEdit = (user) => {
    setError(null);
    setFormData({
      id: user.id,
      user_name: user.user_name || '',
      name: user.name || '',
      password: '',
      status: user.status || 'active',
      role_id: String(user.role_id ?? ''),
      rank_id: String(user.rank_id ?? ''),
      exclude_from_scheduling:
        String(user.exclude_from_scheduling ?? '').trim().toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE',
      runner_sound_profile: user.runner_sound_profile || '',
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // One request: the sound profile rides along with the rest of the row, and the backend
      // ignores it unless the caller is an administrator.
      const result = await adminSaveUser(formData, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to save user.');

      // Show the saved values in the list NOW. The refresh below is authoritative but cannot be
      // waited on, and until it lands the list still holds the pre-save row - so re-opening the
      // form straight after saving would show the old values.
      onRowSaved?.('users', { ...formData, id: result.id || formData.id });
      resetForm();

      // The refresh is NOT awaited: doPost serialises every request behind a script lock, so
      // waiting for the wave meant the spinner stayed up for the length of the queue rather than
      // for the save. It is tracked instead, so the tab can say it is happening rather than
      // leaving the list silently stale.
      setRefreshing(true);
      Promise.resolve(onDataChanged?.()).finally(() => setRefreshing(false));
    } catch (err) {
      setError(err.message || 'Failed to save user.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (user) => {
    if (!window.confirm(`Delete user "${user.name}"? This cannot be undone.`)) return;
    setDeletingId(user.id);
    setError(null);
    try {
      const result = await adminDeleteUser(user.id, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to delete user.');
      void onDataChanged();
      if (String(formData.id) === String(user.id)) resetForm();
    } catch (err) {
      setError(err.message || 'Failed to delete user.');
    } finally {
      setDeletingId(null);
    }
  };

  const roleLabel = (roleId) => roles.find((r) => String(r.id) === String(roleId))?.description || '—';
  const rankLabel = (rankId) => ranks.find((r) => String(r.id) === String(rankId))?.description || '—';

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{isEditing ? `Edit User #${formData.id}` : 'Add New User'}</h3>
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

          {/* The saved row is applied locally straight away, so this is about the authoritative
              refresh catching up rather than the copy in the list being wrong. Saying so is
              better than a silently stale table. */}
          {refreshing && (
            <p className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              Saved. Reloading the full list in the background…
            </p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Username</label>
              <input
                type="text"
                required
                value={formData.user_name}
                onChange={(e) => setFormData({ ...formData, user_name: e.target.value })}
                autoComplete="off"
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Name</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                Password {isEditing && <span className="text-slate-500">(leave blank to keep unchanged)</span>}
              </label>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Scheduling</label>
              <label className="flex items-center gap-2 h-[46px] px-4 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={formData.exclude_from_scheduling === 'TRUE'}
                  onChange={(e) => setFormData({ ...formData, exclude_from_scheduling: e.target.checked ? 'TRUE' : 'FALSE' })}
                  className="w-4 h-4 accent-red-600"
                />
                <span className="text-sm text-slate-700 dark:text-slate-200">Exclude from scheduling</span>
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                Excluded members can't be assigned to shifts in Schedule Management.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Role</label>
              <select
                required
                value={formData.role_id}
                onChange={(e) => setFormData({ ...formData, role_id: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="">-- Select Role --</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.description}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Rank</label>
              <select
                value={formData.rank_id}
                onChange={(e) => setFormData({ ...formData, rank_id: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="">-- Select Rank --</option>
                {ranks.map((r) => (
                  <option key={r.id} value={r.id}>{r.description}</option>
                ))}
              </select>
            </div>
          </div>

          {/* The Firefighter Runner sound set. Shown to anyone who can manage users so the value
              is visible, but only an administrator can change it - and the server enforces that
              as well, so disabling the input here is convenience rather than the control. */}
          {isEditing && (
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                <span className="inline-flex items-center gap-1.5">
                  <Music className="w-3.5 h-3.5" />
                  Runner Sound Profile
                </span>
              </label>
              <input
                type="text"
                value={formData.runner_sound_profile}
                onChange={(e) => setFormData({ ...formData, runner_sound_profile: e.target.value })}
                disabled={!isAdmin}
                placeholder="e.g. bird (leave blank for the default sounds)"
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed font-mono text-sm"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                {isAdmin ? (
                  <>
                    A prefix for this member's Firefighter Runner sounds. <span className="font-mono">bird</span> plays{' '}
                    <span className="font-mono">bird-jump.wav</span>, <span className="font-mono">bird-die.wav</span> and{' '}
                    <span className="font-mono">bird-point.wav</span> from the game's folder. Leave blank to use the
                    default sounds, and add the files to the repository to use a new set.
                  </>
                ) : (
                  'Only an administrator can change this setting.'
                )}
              </p>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : isEditing ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {isEditing ? 'Save Changes' : 'Add User'}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-100 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 uppercase text-xs">
            <tr>
              <th className="px-4 py-3">Username</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Rank</th>
              <th className="px-4 py-3">Scheduling</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700/70">
            {users.map((user) => (
              <tr key={user.id} className="text-slate-700 dark:text-slate-200">
                <td className="px-4 py-3 font-mono text-slate-500 dark:text-slate-400">{user.user_name}</td>
                <td className="px-4 py-3 font-medium">{user.name}</td>
                <td className="px-4 py-3 capitalize">{user.status}</td>
                <td className="px-4 py-3">{roleLabel(user.role_id)}</td>
                <td className="px-4 py-3">{rankLabel(user.rank_id)}</td>
                <td className="px-4 py-3">
                  {String(user.exclude_from_scheduling ?? '').trim().toUpperCase() === 'TRUE' ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                      Excluded
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                      Schedulable
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button onClick={() => handleEdit(user)} className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(user)}
                      disabled={deletingId === user.id}
                      className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
                    >
                      {deletingId === user.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-500">No users found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

