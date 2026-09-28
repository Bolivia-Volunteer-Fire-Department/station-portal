import React, { useMemo, useState } from 'react';
import { Loader2, Pencil, Trash2, AlertCircle, Award, Plus } from 'lucide-react';
import { adminSaveCertification, adminDeleteCertification } from '../../services/api';
import RankIcon from '../RankIcon';
import CertificationBadges from '../CertificationBadges';
import ConfirmModal from '../ConfirmModal';
import ViewportModal from '../ViewportModal';
import { userLabel } from '../../utils/displayLabel';
import {
  certificationStateLabel,
  certificationStateBadge,
  certificationCountdown,
} from '../../utils/certifications';

const EMPTY_FORM = {
  id: '',
  user_id: '',
  certification_id: '',
  effective_date: '',
  end_date: '',
  notes: '',
};

// One field style, so the four inputs and two selects on this screen stay identical and the markup stays short
// enough to read.
const FIELD_CLASS =
  'mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-white';

const FILTERS = [
  { id: 'all', label: 'Everyone' },
  { id: 'attention', label: 'Expiring or expired' },
  { id: 'current', label: 'Current' },
];

const STATE_ORDER = { expiring: 0, expired: 1, active: 2, upcoming: 3 };

// The Certifications tab: one row per member per certification PERIOD.
//
// Two things about this screen are the feature rather than decoration:
//
//   * renewing saves a NEW row. Editing an existing one is for correcting a mistake; recording a renewal is a
//     new period, which is what leaves the station a history instead of a single current answer.
//   * the end date is DISABLED for a certification whose setup says it cannot be renewed. One-off achievements
//     have no expiry, and the server blanks the field too, so the rule survives somebody editing the sheet.
export default function AdminCertificationsTab({ token, users = [], setup = [], records = [], onDataChanged }) {
  const [formData, setFormData] = useState(EMPTY_FORM);
  // Whether the editor modal is open: "a new record" and "no editor" are both `formData.id === ''`.
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const usersById = useMemo(() => {
    const index = {};
    users.forEach((user) => {
      index[String(user.id)] = user;
    });
    return index;
  }, [users]);

  const selectedType = useMemo(
    () => setup.find((type) => type.id === formData.certification_id) || null,
    [setup, formData.certification_id]
  );

  // A certification that cannot be renewed has no end date. This is the visible half of that rule; the server
  // enforces the other half.
  const endDateOff = !selectedType || !selectedType.is_renewable;

  // Opening and closing are two different acts: `startNew` OPENS the editor (the New record button calls it), so it
  // could not also be the close handler - closing it left `editorOpen` true, the dismissal animation hid the panel
  // anyway, and the next Edit changed the form data with nothing on screen to show for it.
  const closeEditor = () => {
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
      user_id: row.user_id || '',
      certification_id: row.certification_id || '',
      effective_date: row.effective_date || '',
      end_date: row.end_date || '',
      notes: row.notes || '',
    });
    setError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await adminSaveCertification(formData, token);
      if (!response?.success) {
        setError(response?.message || 'Could not save this certification.');
        return;
      }
      // Saved, so the editor closes - the same close the Cancel path uses.
      closeEditor();
      // Not awaited: the save is confirmed and the refresh is a background reload. Written as `void` so the call
      // is greppable - see verify-refresh-wiring, which checks every saving screen still asks for its refresh.
      void onDataChanged?.();
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
      const response = await adminDeleteCertification(target.id, token);
      if (!response?.success) {
        setError(response?.message || 'Could not delete this record.');
        return;
      }
      if (formData.id === target.id) closeEditor();
      void onDataChanged?.();
    } catch (err) {
      setError(err.message || 'Could not delete this record.');
    } finally {
      setDeletingId(null);
    }
  };

  // Attention first, then by how soon the date is: the reason to open this tab is almost always "who is running
  // out", so that is the order it opens in.
  const visible = useMemo(() => {
    const rows = records.filter((row) => {
      if (filter === 'attention') return row.state === 'expiring' || row.state === 'expired';
      if (filter === 'current') return row.state === 'active' || row.state === 'upcoming';
      return true;
    });

    return rows.slice().sort((a, b) => {
      const byState = (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9);
      if (byState !== 0) return byState;
      return String(a.end_date || '9999').localeCompare(String(b.end_date || '9999'));
    });
  }, [records, filter]);

  const attentionCount = records.filter((row) => row.state === 'expiring' || row.state === 'expired').length;

  return (
    <div className="space-y-6">
      {/* The editor, in the viewport modal every New card in this module now uses. Its body is a div rather than a
          <form>, so the toolbar's Save calls handleSave through onSave instead of submitting anything. */}
      {editorOpen && (
        <ViewportModal
          title={formData.id ? 'Edit certification record' : 'New certification record'}
          subtitle={formData.id ? 'Editing an existing record' : 'Not saved yet'}
          icon={<Award className="h-4 w-4" />}
          onSave={handleSave}
          saveLabel={formData.id ? 'Save changes' : 'Record certification'}
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

        {setup.length === 0 && (
          <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800/80 dark:bg-amber-950/40 dark:text-amber-200">
            Add the certifications the station tracks under <strong>Certification Setup</strong> first — a record
            needs something to be a record of.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Member</span>
            <select
              value={formData.user_id}
              onChange={(event) => setFormData({ ...formData, user_id: event.target.value })}
              className={FIELD_CLASS}
            >
              <option value="">-- Choose a member --</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {userLabel(user)}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
              Certification
            </span>
            <select
              value={formData.certification_id}
              onChange={(event) =>
                setFormData({ ...formData, certification_id: event.target.value, end_date: '' })
              }
              className={FIELD_CLASS}
            >
              <option value="">-- Choose a certification --</option>
              {setup.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
              Effective date
            </span>
            <input
              type="date"
              value={formData.effective_date}
              onChange={(event) => setFormData({ ...formData, effective_date: event.target.value })}
              className={FIELD_CLASS}
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">End date</span>
            <input
              type="date"
              value={formData.end_date}
              disabled={endDateOff}
              onChange={(event) => setFormData({ ...formData, end_date: event.target.value })}
              className={FIELD_CLASS}
            />
            <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
              {endDateOff
                ? 'This certification cannot be renewed, so it has no end date.'
                : 'Renewals are new rows — record the next period rather than changing this one.'}
            </span>
          </label>

          <label className="block sm:col-span-2">
            <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
              Notes (optional)
            </span>
            <input
              type="text"
              value={formData.notes}
              onChange={(event) => setFormData({ ...formData, notes: event.target.value })}
              className={FIELD_CLASS}
            />
          </label>
        </div>

        </div>
        </ViewportModal>
      )}

      {/* The records, with the New button in the filter row - the only header this card has. */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4 dark:border-slate-700">
          <button
            type="button"
            onClick={startNew}
            className="ml-auto flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500"
          >
            <Plus className="h-4 w-4" />
            New record
          </button>
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
              className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                filter === option.id
                  ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              {option.label}
              {option.id === 'attention' && attentionCount > 0 ? ` (${attentionCount})` : ''}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-xs uppercase text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Certification</th>
                <th className="px-4 py-3">Effective</th>
                <th className="px-4 py-3">Ends</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/70">
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500 dark:text-slate-400">
                    Nothing to show for this filter.
                  </td>
                </tr>
              ) : (
                visible.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                      <span className="flex items-center gap-1.5">
                        {userLabel(usersById[row.user_id])}
                        <CertificationBadges userId={row.user_id} />
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      <span className="flex items-center gap-2">
                        <RankIcon name={row.icon} className="h-4 w-4 shrink-0" />
                        {row.name || 'Unknown certification'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {row.effective_date || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {row.end_date || (row.is_renewable ? '—' : 'No end date')}
                      {row.state === 'expiring' || row.state === 'expired' ? (
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          {certificationCountdown(row.days_until_end)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full border px-2.5 py-1 text-xs font-semibold ${certificationStateBadge(
                          row.state
                        )}`}
                      >
                        {certificationStateLabel(row.state)}
                      </span>
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
          title={`Delete this ${pendingDelete.name} record?`}
          message={`This removes the ${pendingDelete.name} period for ${userLabel(
            usersById[pendingDelete.user_id]
          )}. The rest of their history is untouched — renewals are separate rows, so deleting one period does not delete the others.`}
          confirmLabel="Delete record"
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

