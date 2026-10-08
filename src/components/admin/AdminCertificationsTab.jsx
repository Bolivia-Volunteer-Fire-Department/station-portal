import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Pencil, Trash2, AlertCircle, Award, Plus, Check, Printer, Download, X, Users } from 'lucide-react';
import { adminSaveCertification, adminDeleteCertification, adminBulkSaveCertification, fetchAdminCertificationRecords } from '../../services/api';
import RankIcon from '../RankIcon';
import CertificationBadges from '../CertificationBadges';
import ConfirmModal from '../ConfirmModal';
import ViewportModal from '../ViewportModal';
import PrintableCertifications from '../PrintableCertifications';
import { userLabel } from '../../utils/displayLabel';
import { certificationRowsCsv, sortCertificationRows } from '../../utils/certificationReport';
import {
  certificationFiltersActive,
  certificationRowMatches,
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

// The fields a bulk edit may change, and ONLY these. A record's member and its certification are what the row IS, so
// changing them across a selection would be re-labelling history rather than correcting it - the honest way to fix a
// record given to the wrong person, or of the wrong type, is to delete it and add the right one, which is what the
// table's own Delete does one row at a time.
const EDITABLE_FIELDS = [
  { key: 'effective_date', label: 'Effective date', type: 'date' },
  { key: 'end_date', label: 'End date', type: 'date' },
  { key: 'notes', label: 'Notes', type: 'text' },
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
  // THE TWO SEARCHES, kept apart from the chips above because they answer a different question: the chips are "what
  // needs my attention", these are "the member and the paperwork in front of me". Both are ANDed with the chips, so
  // the table is narrowed by everything the officer has asked for rather than by the last thing they pressed.
  const [memberQuery, setMemberQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState([]);
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
    const nameOf = (row) => userLabel(usersById[row.user_id]);
    const rows = recordsForView.filter((row) => {
      if (filter === 'attention') return row.state === 'expiring' || row.state === 'expired';
      if (filter === 'current') return row.state === 'active' || row.state === 'upcoming';
      return true;
    });

    // Then the two searches, so everything downstream - the table, the print sheet and the CSV - is the same list the
    // officer is looking at. A filtered table that exports the whole database is the bug this avoids.
    return sortCertificationRows(
      rows.filter((row) =>
        certificationRowMatches(row, { memberName: memberQuery, certificationIds: typeFilter }, nameOf)
      ),
      nameOf
    );
  }, [recordsForView, filter, usersById, memberQuery, typeFilter]);

  // Whether either search is on, for the Clear control and the empty state.
  const searchesActive = certificationFiltersActive({ memberName: memberQuery, certificationIds: typeFilter });

  const toggleType = (id) =>
    setTypeFilter((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
    );

  // ---- Bulk -------------------------------------------------------------------------------------------------------
  //
  // TWO gestures, because a station does two things in batches:
  //
  //   * RECORD FOR SEVERAL - one certification and one set of dates, for every member ticked. That is how a course a
  //     group sat together gets onto the books, and the shared dates are the whole point of the gesture.
  //   * EDIT SELECTED - a change applied to the rows ticked in the table. Each field has its own "change this" box,
  //     so a blank box means UNTOUCHED rather than "clear it": without that, an officer fixing one date would wipe
  //     every note on the rows they had selected.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState({ certification_id: '', effective_date: '', end_date: '', notes: '' });
  const [bulkMembers, setBulkMembers] = useState([]);
  const [bulkMemberQuery, setBulkMemberQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editFields, setEditFields] = useState({ effective_date: '', end_date: '', notes: '' });
  const [editApply, setEditApply] = useState({ effective_date: false, end_date: false, notes: false });
  const [bulkSaving, setBulkSaving] = useState(false);

  const bulkType = useMemo(
    () => setup.find((type) => type.id === bulkForm.certification_id) || null,
    [setup, bulkForm.certification_id]
  );
  const bulkEndDateOff = !bulkType || !bulkType.is_renewable;

  // The roster the bulk add ticks through: everyone, since a record can be given to somebody whose status is
  // inactive as easily as to one on duty, with the search an officer needs at a station of any size.
  const bulkMemberList = useMemo(() => {
    const wanted = bulkMemberQuery.trim().toLowerCase();
    const rows = users.filter((user) => !wanted || userLabel(user).toLowerCase().includes(wanted));
    return [...rows].sort((a, b) => userLabel(a).localeCompare(userLabel(b)));
  }, [users, bulkMemberQuery]);

  // ONLY the ticked rows that are ON SCREEN. A row hidden by a search cannot be seen to be selected, and changing
  // something the officer cannot see is how a bulk edit becomes a surprise.
  const selectedRows = useMemo(
    () => visible.filter((row) => selectedIds.includes(row.id)),
    [visible, selectedIds]
  );
  const allVisibleSelected = visible.length > 0 && visible.every((row) => selectedIds.includes(row.id));

  const toggleAllVisible = () =>
    setSelectedIds((current) =>
      allVisibleSelected
        ? current.filter((id) => !visible.some((row) => row.id === id))
        : [...new Set([...current, ...visible.map((row) => row.id)])]
    );

  const toggleSelected = (id) =>
    setSelectedIds((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));

  // The same two gestures over the roster inside the bulk-add editor: tick one member, tick everybody the search is
  // showing, or clear. "Select all" adds and removes only what is ON SCREEN, so a search left running cannot become
  // a way to tick people the officer never saw.
  const toggleBulkMember = (id) =>
    setBulkMembers((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));

  const allShownSelected =
    bulkMemberList.length > 0 && bulkMemberList.every((user) => bulkMembers.includes(String(user.id)));

  const toggleAllShownMembers = () =>
    setBulkMembers((current) =>
      allShownSelected
        ? current.filter((id) => !bulkMemberList.some((user) => String(user.id) === id))
        : [...new Set([...current, ...bulkMemberList.map((user) => String(user.id))])]
    );

  const openBulkAdd = () => {
    setError(null);
    setBulkForm({ certification_id: '', effective_date: '', end_date: '', notes: '' });
    setBulkMembers([]);
    setBulkMemberQuery('');
    setBulkOpen(true);
  };

  const openBulkEdit = () => {
    setError(null);
    setEditFields({ effective_date: '', end_date: '', notes: '' });
    setEditApply({ effective_date: false, end_date: false, notes: false });
    setEditOpen(true);
  };

  // Both bulk saves end the way the single one does: close, hand up the rebuilt badge index, and ask for the refresh
  // in the background. The rows are built here because what is SHARED between them - the dates, or the one field being
  // changed - is the gesture rather than something the writer could work out.
  const handleBulkAdd = async () => {
    if (!bulkForm.certification_id || !bulkForm.effective_date || bulkMembers.length === 0) return;
    setBulkSaving(true);
    setError(null);
    try {
      const response = await adminBulkSaveCertification(
        {
          records: bulkMembers.map((userId) => ({
            user_id: userId,
            certification_id: bulkForm.certification_id,
            effective_date: bulkForm.effective_date,
            end_date: bulkEndDateOff ? '' : bulkForm.end_date,
            notes: bulkForm.notes,
          })),
        },
        token
      );
      if (!response?.success) {
        setError(response?.message || 'Could not save these certifications.');
        return;
      }
      setBulkOpen(false);
      onBadgesChanged?.(response.badges);
      void onDataChanged?.('certificationRecords');
    } catch (err) {
      setError(err.message || 'Could not save these certifications.');
    } finally {
      setBulkSaving(false);
    }
  };

  const handleBulkEdit = async () => {
    // Only the ticked fields travel. A ticked box with an empty value is a deliberate CLEAR, which is why the tick
    // decides and the value does not.
    const changes = {};
    if (editApply.effective_date) changes.effective_date = editFields.effective_date;
    if (editApply.end_date) changes.end_date = editFields.end_date;
    if (editApply.notes) changes.notes = editFields.notes;
    if (selectedRows.length === 0 || Object.keys(changes).length === 0) return;

    setBulkSaving(true);
    setError(null);
    try {
      const response = await adminBulkSaveCertification(
        { updates: selectedRows.map((row) => ({ id: row.id, ...changes })) },
        token
      );
      if (!response?.success) {
        setError(response?.message || 'Could not change these records.');
        return;
      }
      setEditOpen(false);
      setSelectedIds([]);
      onBadgesChanged?.(response.badges);
      void onDataChanged?.('certificationRecords');
    } catch (err) {
      setError(err.message || 'Could not change these records.');
    } finally {
      setBulkSaving(false);
    }
  };

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
            {/* Contextual, and only when there is a selection to act on: a button that changes several records at
                once should never be reachable by accident. */}
            {selectedRows.length > 0 && (
              <button
                type="button"
                onClick={openBulkEdit}
                className={`${TOOLBAR_BUTTON_CLASS} border border-slate-800 bg-slate-800 text-white hover:bg-slate-700 dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300`}
              >
                <Pencil className="h-4 w-4" /> Edit selected ({selectedRows.length})
              </button>
            )}
            <button
              type="button"
              onClick={openBulkAdd}
              disabled={setup.length === 0}
              title={
                setup.length
                  ? 'Record one certification for several members at once'
                  : 'Add the certifications the station tracks first'
              }
              className={`${TOOLBAR_BUTTON_CLASS} border border-red-600 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-400 dark:text-red-400 dark:hover:bg-red-950/40`}
            >
              <Users className="h-4 w-4" /> Record for several
            </button>
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

        {/* THE TWO SEARCHES, on their own row under the chips because they answer a different question: the chips are
            "what needs my attention", these are "the member and the paperwork in front of me". They are visible at all
            times - a table that looks empty because something is filtered is the failure this prevents, and a Clear
            control that only appears when there is something to clear is what makes it obvious. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700/70">
          <label className="inline-flex h-9 items-center gap-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
            Member
            <input
              type="search"
              value={memberQuery}
              onChange={(event) => setMemberQuery(event.target.value)}
              placeholder="Name"
              aria-label="Filter by member name"
              className="h-9 w-40 rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal normal-case text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>

          <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Certifications</span>
          {setup.length === 0 ? (
            <span className="text-xs text-slate-500 dark:text-slate-400">None set up yet</span>
          ) : (
            setup.map((type) => (
              <button
                key={type.id}
                type="button"
                onClick={() => toggleType(type.id)}
                aria-pressed={typeFilter.includes(type.id)}
                title={`Show only ${type.name}`}
                className={`${TOOLBAR_BUTTON_CLASS} border ${
                  typeFilter.includes(type.id)
                    ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                <RankIcon name={type.icon} className="h-3.5 w-3.5 shrink-0" />
                {type.name}
              </button>
            ))
          )}

          {searchesActive && (
            <button
              type="button"
              onClick={() => {
                setMemberQuery('');
                setTypeFilter([]);
              }}
              className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-slate-500 underline decoration-dotted underline-offset-2 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
            >
              <X className="h-3.5 w-3.5" /> Clear searches
            </button>
          )}
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
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    aria-label="Select every record shown"
                    className="h-4 w-4 accent-red-600"
                  />
                </th>
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
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-500 dark:text-slate-400">
                    {searchesActive
                      ? 'No records match these searches — clear them to see the rest.'
                      : 'Nothing to show for this filter.'}
                  </td>
                </tr>
              ) : (
                visible.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(row.id)}
                        onChange={() => toggleSelected(row.id)}
                        aria-label={`Select the ${row.name} record for ${userLabel(usersById[row.user_id])}`}
                        className="h-4 w-4 accent-red-600"
                      />
                    </td>
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

      {/* RECORD FOR SEVERAL: one certification and one set of dates, for the members who earned it. The dates are asked
          for ONCE, above the list, because their being shared is the whole gesture. */}
      {bulkOpen && (
        <ViewportModal
          title="Record for several members"
          subtitle={bulkMembers.length ? `${bulkMembers.length} chosen` : 'Nobody chosen yet'}
          icon={<Users className="h-4 w-4" />}
          onSave={handleBulkAdd}
          saveLabel={bulkMembers.length ? `Record for ${bulkMembers.length}` : 'Record'}
          saving={bulkSaving}
          onClose={() => setBulkOpen(false)}
        >
          <div className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-600 dark:border-red-800/80 dark:bg-red-950/80 dark:text-red-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  Certification
                </span>
                <select
                  value={bulkForm.certification_id}
                  onChange={(event) =>
                    setBulkForm({ ...bulkForm, certification_id: event.target.value, end_date: '' })
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
                  value={bulkForm.effective_date}
                  onChange={(event) => setBulkForm({ ...bulkForm, effective_date: event.target.value })}
                  className={FIELD_CLASS}
                />
              </label>

              <label className="block">
                <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  End date{bulkEndDateOff ? ' — not used' : ''}
                </span>
                <input
                  type="date"
                  value={bulkForm.end_date}
                  disabled={bulkEndDateOff}
                  onChange={(event) => setBulkForm({ ...bulkForm, end_date: event.target.value })}
                  className={FIELD_CLASS}
                />
              </label>

              <label className="block">
                <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Notes</span>
                <input
                  type="text"
                  value={bulkForm.notes}
                  onChange={(event) => setBulkForm({ ...bulkForm, notes: event.target.value })}
                  placeholder="Recorded on every one"
                  className={FIELD_CLASS}
                />
              </label>
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  Members ({bulkMembers.length} chosen)
                </span>
                <input
                  type="search"
                  value={bulkMemberQuery}
                  onChange={(event) => setBulkMemberQuery(event.target.value)}
                  placeholder="Find a member"
                  aria-label="Find a member to include"
                  className="h-8 w-40 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                />
                <button
                  type="button"
                  onClick={toggleAllShownMembers}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 underline decoration-dotted underline-offset-2 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
                >
                  {allShownSelected ? 'Clear all shown' : 'Select all shown'}
                </button>
              </div>

              <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700">
                {bulkMemberList.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-slate-500 dark:text-slate-400">No member matches that name.</p>
                ) : (
                  bulkMemberList.map((user) => (
                    <label
                      key={user.id}
                      className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700/50"
                    >
                      <input
                        type="checkbox"
                        checked={bulkMembers.includes(String(user.id))}
                        onChange={() => toggleBulkMember(String(user.id))}
                        className="h-4 w-4 accent-red-600"
                      />
                      {userLabel(user)}
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>
        </ViewportModal>
      )}

      {/* EDIT SELECTED: only what is ticked changes. A field with its box unticked is absent from the request
          altogether, which is what keeps a date fix from wiping a note on every row in the selection. */}
      {editOpen && (
        <ViewportModal
          title="Change selected records"
          subtitle={selectedRows.length ? `${selectedRows.length} selected` : 'Nothing selected'}
          icon={<Pencil className="h-4 w-4" />}
          onSave={handleBulkEdit}
          saveLabel={selectedRows.length ? `Change ${selectedRows.length}` : 'Change'}
          saving={bulkSaving}
          onClose={() => setEditOpen(false)}
        >
          <div className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-600 dark:border-red-800/80 dark:bg-red-950/80 dark:text-red-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <p className="text-sm text-slate-500 dark:text-slate-400">
              Tick only what you want to set. Anything left unticked stays exactly as it is — and a ticked field with
              nothing in it clears that field on every selected record.
            </p>

            {EDITABLE_FIELDS.map((field) => (
              <div key={field.key} className="flex items-center gap-3">
                <label className="inline-flex w-40 shrink-0 items-center gap-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  <input
                    type="checkbox"
                    checked={editApply[field.key]}
                    onChange={(event) => setEditApply({ ...editApply, [field.key]: event.target.checked })}
                    className="h-4 w-4 accent-red-600"
                  />
                  {field.label}
                </label>
                <input
                  type={field.type}
                  value={editFields[field.key]}
                  disabled={!editApply[field.key]}
                  onChange={(event) => setEditFields({ ...editFields, [field.key]: event.target.value })}
                  className={`${FIELD_CLASS} mt-0 flex-1`}
                />
              </div>
            ))}
          </div>
        </ViewportModal>
      )}

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

