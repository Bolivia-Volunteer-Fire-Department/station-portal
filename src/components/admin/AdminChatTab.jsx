import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import ConfirmModal from '../ConfirmModal';
import { deleteChatRoom, fetchAdminChatRooms, saveChatRoom } from '../../services/api';
import { sortChatRooms } from '../../utils/chat';
import { unnamedLabel, userLabel } from '../../utils/displayLabel';
import { audienceKeysFor } from '../../services/firestorePayload';

/**
 * CHAT ROOMS: the station's rooms, who may see each one, and their order.
 *
 * A ROOM'S AUDIENCE IS THE SAME THREE FIELDS AN ANNOUNCEMENT CARRIES - everyone, a role, a rank, or a member - turned
 * into the key list the rules check with `audienceKeysFor`, the shared helper the announcements composer already uses.
 * That is deliberate rather than convenient: the rules and the client's query match on those same keys, so a room
 * configured here cannot mean one thing to the database and another to the list a member sees.
 *
 * WHAT IS NOT HERE: reading or writing anybody's messages. This tab is the shape of the station's chat, and an officer
 * with only this permission has no seat in any room it creates (see utils/chat.js#chatPermissionsFrom).
 */
const EMPTY_FORM = {
  id: '',
  name: '',
  everyone: true,
  role_id: '',
  rank_id: '',
  user_id: '',
  sort_order: 100,
  archived: false,
};

export default function AdminChatTab({ token, roles = [], ranks = [], users = [], onDataChanged, onRowSaved }) {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await fetchAdminChatRooms(token);
      setRooms(sortChatRooms(data?.chatRooms || []));
      setError('');
    } catch (err) {
      setError(err.message || 'Could not load the rooms.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // The audience as the shared rule reads it, so the form and the backend agree about who a room reaches.
  const audience = useMemo(
    () => ({
      userId: form?.everyone ? '' : form?.user_id || '',
      roleId: form?.everyone ? '' : form?.role_id || '',
      rankId: form?.everyone ? '' : form?.rank_id || '',
    }),
    [form]
  );

  const save = useCallback(async () => {
    if (!form || saving) return;
    setSaving(true);
    try {
      const keys = form.everyone ? ['*'] : audienceKeysFor(audience).filter((key) => key !== '*');
      const saved = await saveChatRoom(
        {
          id: form.id,
          name: form.name,
          audience_keys: keys,
          sort_order: form.sort_order,
          archived: form.archived,
        },
        token
      );
      // The row is applied locally so the list is right at once, and the refresh is STARTED rather than awaited: the
      // save has already happened, and a tab that waits on the refresh wave holds the button over a write that landed
      // (see verify:refresh-wiring).
      onRowSaved?.('chat_conversations', saved);
      onDataChanged?.();
      setForm(null);
      await load();
    } catch (err) {
      setError(err.message || 'Could not save the room.');
    } finally {
      setSaving(false);
    }
  }, [form, saving, audience, token, onRowSaved, onDataChanged, load]);

  const remove = useCallback(async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    try {
      await deleteChatRoom(target.id, token);
      setRooms((current) => current.filter((room) => room.id !== target.id));
      onDataChanged?.();
    } catch (err) {
      setError(err.message || 'Could not delete the room.');
    }
  }, [pendingDelete, token, onDataChanged]);

  // Which names a room's keys stand for, for the table. A key whose role, rank or member has since been deleted is shown
  // as the shared "unnamed" wording rather than as the id - a row of hex in an officer's table is a row they cannot act on,
  // and this file's other tables already answer that question the same way (see utils/displayLabel).
  const audienceLabel = (room) => {
    const keys = Array.isArray(room.audience_keys) ? room.audience_keys : [];
    if (keys.includes('*')) return 'Everyone';
    const named = keys
      .map((key) => {
        const [kind, id] = String(key).split(':');
        if (kind === 'role') return roles.find((row) => String(row.id) === id)?.label || unnamedLabel('role');
        if (kind === 'rank') return ranks.find((row) => String(row.id) === id)?.description || unnamedLabel('rank');
        if (kind === 'user') return users.find((row) => String(row.id) === id)?.name || unnamedLabel('member');
        return '';
      })
      .filter(Boolean);
    return named.join(', ') || 'Nobody';
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Chat Rooms</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            The rooms a member can see, and who each one is for. Whether somebody has Chat at all is a role permission,
            not a setting here.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setForm({ ...EMPTY_FORM })}
          className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500"
        >
          <Plus className="h-4 w-4" /> New room
        </button>
      </div>

      {error && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2">Room</th>
              <th className="px-4 py-2">Who can see it</th>
              <th className="px-4 py-2">Order</th>
              <th className="px-4 py-2">Last message</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {rooms.map((room) => (
              <tr key={room.id} className={room.archived ? 'opacity-60' : ''}>
                <td className="px-4 py-2 font-medium text-slate-900 dark:text-white">
                  {room.name}
                  {room.archived && <span className="ml-2 text-xs text-slate-500">(archived)</span>}
                </td>
                <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{audienceLabel(room)}</td>
                <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{room.sort_order ?? 999}</td>
                <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{room.last_preview || '—'}</td>
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        setForm({
                          id: room.id,
                          name: room.name || '',
                          everyone: (room.audience_keys || []).includes('*'),
                          role_id: '',
                          rank_id: '',
                          user_id: '',
                          sort_order: room.sort_order ?? 100,
                          archived: room.archived === true,
                        })
                      }
                      className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                      aria-label={`Edit ${room.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(room)}
                      className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                      aria-label={`Delete ${room.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && rooms.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500 dark:text-slate-400">
                  No rooms yet. Add one and it appears for every member who may see it.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {loading && (
          <p className="flex items-center gap-2 px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the rooms…
          </p>
        )}
      </div>

      {form && (
        <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
          <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">
            {form.id ? 'Edit room' : 'New room'}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Name</span>
              <input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                maxLength={60}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Order</span>
              <input
                type="number"
                value={form.sort_order}
                onChange={(event) => setForm({ ...form, sort_order: Number(event.target.value) })}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={form.everyone}
                onChange={(event) => setForm({ ...form, everyone: event.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-red-600"
              />
              <span className="text-slate-700 dark:text-slate-200">Everyone may see this room</span>
            </label>
            {!form.everyone && (
              <>
                <label className="text-sm">
                  <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">…or a role</span>
                  <select
                    value={form.role_id}
                    onChange={(event) => setForm({ ...form, role_id: event.target.value, rank_id: '', user_id: '' })}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                  >
                    <option value="">Any role</option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.label || role.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">…or a rank</span>
                  <select
                    value={form.rank_id}
                    onChange={(event) => setForm({ ...form, rank_id: event.target.value, role_id: '', user_id: '' })}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                  >
                    <option value="">Any rank</option>
                    {ranks.map((rank) => (
                      <option key={rank.id} value={rank.id}>
                        {rank.description || unnamedLabel('rank')}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm sm:col-span-2">
                  <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">…or one member</span>
                  <select
                    value={form.user_id}
                    onChange={(event) => setForm({ ...form, user_id: event.target.value, role_id: '', rank_id: '' })}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                  >
                    <option value="">Nobody in particular</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {userLabel(user)}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={form.archived}
                onChange={(event) => setForm({ ...form, archived: event.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-red-600"
              />
              <span className="text-slate-700 dark:text-slate-200">
                Archived — kept, but marked as out of use. Members in it still see it.
              </span>
            </label>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setForm(null)}
              className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !form.name.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save room
            </button>
          </div>
        </div>
      )}

      {pendingDelete && (
        <ConfirmModal
          title={`Delete ${pendingDelete.name}?`}
          message="The room and every message in it are removed for everybody, and each member's place in it goes with it. This cannot be undone."
          confirmLabel="Delete room"
          onConfirm={() => void remove()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
