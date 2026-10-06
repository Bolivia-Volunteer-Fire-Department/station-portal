import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Pencil, Trash2, AlertCircle, Award, Plus, Check, Printer, Download } from 'lucide-react';
import { adminSaveCertification, adminDeleteCertification, fetchAdminCertificationRecords } from '../../services/api';
import RankIcon from '../RankIcon';
import CertificationBadges from '../CertificationBadges';
import ConfirmModal from '../ConfirmModal';
import ViewportModal from '../ViewportModal';
import PrintableCertifications from '../PrintableCertifications';
import { userLabel } from '../../utils/displayLabel';
import { certificationRowsCsv, sortCertificationRows } from '../../utils/certificationReport';
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
  { id: 'all', label: 'Active members' },
  { id: 'attention', label: 'Attention' },
  { id: 'current', label: 'Current' },
];

const TOOLBAR_BUTTON_CLASS =
  'inline-flex h-9 min-w-32 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500';

// The Certifications tab: one row per member per certification PERIOD.
//
// Two things about this screen are the feature rather than decoration:
//
//   * renewing saves a NEW row. Editing an existing one is for correcting a mistake; recording a renewal is a
//     new period, which is what leaves the station a history instead of a single current answer.
//   * the end date is DISABLED for a certification whose setup says it cannot be renewed. One-off achievements
//     have no expiry, and the server blanks the field too, so the rule survives somebody editing the sheet.
export default function AdminCertificationsTab({ token, users = [], setup = [], records = [], departmentName = '', onDataChanged, onBadgesChanged }) {
  const [formData, setFormData] = useState(EMPTY_FORM);
  // Whether the editor modal is open: "a new record" and "no editor" are both `formData.id === ''`.
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [inactiveResult, setInactiveResult] = useState(null);
  const [inactiveFailure, setInactiveFailure] = useState(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  // The rows names are drawn from arrive as `users` - the panel merges the crew directory with the joined Users
  // section before handing them over (see AdminPanel#nameRows), so this tab does not care which of the two a row
  // came from. They are directory-shaped on a fresh session, which is why nothing here reads `user_name` or
  // `status`: userLabel already falls back to the name.
  const usersById = useMemo(() => {
    const index = {};
    users.forEach((user) => {
      index[String(user.id)] = user;
    });
    return index;
  }, [users]);

  const inactiveRecords = inactiveResult?.sourceRecords === records ? inactiveResult.rows : null;
  const inactiveError = inactiveFailure?.sourceRecords === records ? inactiveFailure.message : '';
  const inactiveLoading = includeInactive && !inactiveRecords && !inactiveError;

  useEffect(() => {
    if (!includeInactive) return undefined;

    let cancelled = false;
    fetchAdminCertificationRecords({ includeInactive: true })
      .then((rows) => {
        if (!cancelled) setInactiveResult({ sourceRecords: records, rows });
      })
      .catch((error) => {
        if (!cancelled) {
          setInactiveFailure({
            sourceRecords: records,
            message: error.message || 'Could not load inactive members.',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [includeInactive, records]);

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
      // THE BADGE INDEX COMES BACK WITH THE REPLY. The server rebuilds it after the write - the badges beside a name
      // are derived from these records, so a save here can change every member's icons - and the reply carries the
      // result. Handing it up is what makes a badge appear or vanish the moment an officer saves, instead of on the next
      // sign-in. Free: the work is already done, and this is the only way to get it without reading it again.
      onBadgesChanged?.(response.badges);
      // Not awaited: the save is confirmed and the refresh is a background reload. Written as `void` so the call
      // is greppable - see verify-refresh-wiring, which checks every saving screen still asks for its refresh.
      void onDataChanged?.('certificationRecords');
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
      // Deleting a record can remove a badge too, and the reply carries the rebuilt index - see the save path above.
      onBadgesChanged?.(response.badges);
      void onDataChanged?.('certificationRecords');
    } catch (err) {
      setError(err.message || 'Could not delete this record.');
    } finally {
      setDeletingId(null);
    }
  };

  const recordsForView = includeInactive && inactiveRecords ? inactiveRecords : records;

  // Non-current certifications first, then member and certification names for a stable, scannable roster.
  const visible = useMemo(() => {
    const rows = recordsForView.filter((row) => {
      if (filter === 'attention') return row.state === 'expiring' || row.state === 'expired';
      if (filter === 'current') return row.state === 'active' || row.state === 'upcoming';
      return true;
    });

    return sortCertificationRows(rows, (row) => userLabel(usersById[row.user_id]));
  }, [recordsForView, filter, usersById]);

  const attentionCount = recordsForView.filter((row) => row.state === 'expiring' || row.state === 'expired').length;
  const printableRows = visible.map((row) => ({
    ...row,
    member_name: userLabel(usersById[row.user_id]),
  }));

  const handleExportCsv = () => {
    const content = certificationRowsCsv(visible, (row) => userLabel(usersById[row.user_id]));
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `certifications-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {printOpen && (
        <PrintableCertifications
          rows={printableRows}
          departmentName={departmentName}
          onDone={() => setPrintOpen(false)}
        />
      )}
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

      {/* The records and their filters share one toolbar. */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4 dark:border-slate-700">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
              aria-pressed={filter === option.id}
              className={`${TOOLBAR_BUTTON_CLASS} border ${
                filter === option.id
                  ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              {option.label}
              {option.id === 'attention' && attentionCount > 0 ? ` (${attentionCount})` : ''}
            </button>
          ))}
          <label className="inline-flex h-9 items-center gap-2 px-2 text-xs font-medium text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(event) => {
                setIncludeInactive(event.target.checked);
                setInactiveResult(null);
                setInactiveFailure(null);
              }}
              className="h-4 w-4 accent-red-600"
            />
            Include inactive members
            {inactiveLoading && <Loader2 aria-label="Loading inactive records" className="h-3.5 w-3.5 animate-spin" />}
          </label>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={startNew}
              className={`${TOOLBAR_BUTTON_CLASS} bg-red-600 text-white hover:bg-red-500`}
            >
              <Plus className="h-4 w-4" /> New record
            </button>
            <button
              type="button"
              onClick={() => setPrintOpen(true)}
              disabled={visible.length === 0}
              title={visible.length ? 'Print the filtered certification records' : 'No certifications match these filters'}
              className={`${TOOLBAR_BUTTON_CLASS} border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700`}
            >
              <Printer className="h-4 w-4" /> Print
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={visible.length === 0}
              title={visible.length ? 'Export the filtered certification records as CSV' : 'No certifications match these filters'}
              className={`${TOOLBAR_BUTTON_CLASS} border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700`}
            >
              <Download className="h-4 w-4" /> Export CSV
            </button>
          </div>
        </div>

        {inactiveError && (
          <div role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
            {inactiveError}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-xs uppercase text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Certification</th>
                <th className="px-4 py-3">Effective</th>
                <th className="px-4 py-3">Ends</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-center">Notes</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/70">
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-500 dark:text-slate-400">
                    Nothing to show for this filter.
                  </td>
                </tr>
              ) : (
                visible.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                      <span className="flex items-center gap-1.5">
                        {userLabel(usersById[row.user_id])}
                        {row.member_status === 'inactive' && (
                          <span className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500 dark:border-slate-600 dark:text-slate-400">
                            Inactive
                          </span>
                        )}
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
                    {/* Notes are too long for a cell and are read in the editor, so the column answers the only
                        question a table row can: is there anything in them? The icon carries a title, because an
                        icon-only cell is a mystery to a screen reader otherwise. */}
                    <td className="px-4 py-3 text-center">
                      {row.notes ? (
                        <span
                          className="inline-flex text-emerald-600 dark:text-emerald-400"
                          title="This record has notes — open it to read them"
                        >
                          <Check className="h-4 w-4" />
                        </span>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-600">—</span>
                      )}
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

