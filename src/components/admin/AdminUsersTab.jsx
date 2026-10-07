import React, { useState, useMemo } from 'react';
import { Loader2, Pencil, Trash2, Plus, AlertCircle, Users as UsersIcon, Music, KeyRound, ListChecks, ChevronUp, ChevronDown as ChevronDownIcon } from 'lucide-react';
import RankIcon from '../RankIcon';
import { adminSaveUser, adminDeleteUser, saveMemberPrivateFields } from '../../services/api';
import ConfirmModal from '../ConfirmModal';
import ViewportModal from '../ViewportModal';
import MemberName from '../MemberName';
import PasswordInput from '../PasswordInput';
import { recordHeading } from '../../utils/displayLabel';
import { MEMBER_PRIVATE_ADMIN_FIELDS } from '../../utils/memberFields';

// The editor form's id: the modal's toolbar submits it through the HTML `form` attribute.
const USER_FORM_ID = 'user-editor-form';
const BULK_FORM_ID = 'user-bulk-editor-form';

// Every bulk field starts as '' = leave alone; only a field the officer changes is written, for every selected member.
const BULK_EMPTY = { password: '', is_change_password_on_login: '', status: '', role_id: '', rank_id: '', exclude_from_scheduling: '' };
const BULK_FIELD_CLASS = 'w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500';
const BULK_LABEL_CLASS = 'block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5';
const BULK_CHANGE_LABELS = {
  password: 'password',
  is_change_password_on_login: 'must change password at next login',
  status: 'status',
  role_id: 'role',
  rank_id: 'rank',
  exclude_from_scheduling: 'scheduling',
};

const EMPTY_FORM = { id: '', user_name: '', name: '', password: '', status: 'active', role_id: '', rank_id: '', exclude_from_scheduling: 'FALSE', runner_sound_profile: '', is_change_password_on_login: 'FALSE', fema_student_id: '', member_id: '', email: '', phone: '' };

// The fields this form edits on the member's PRIVATE record - the half of an account a member may partly keep themselves.
// utils/memberFields holds the one list, so this, the writer and the rules cannot disagree about which fields those are.
const PRIVATE_FIELDS = [...MEMBER_PRIVATE_ADMIN_FIELDS];

export default function AdminUsersTab({ token, users, roles, ranks, onDataChanged, isAdmin = false, onRowSaved }) {
  const [formData, setFormData] = useState(EMPTY_FORM);
  // What the member's FEMA student id WAS when the editor opened. It lives on the member's private record rather than on
  // the roster row, so it is saved as its own write - and only when this differs, so an ordinary save stays one request.
  const [savedPrivate, setSavedPrivate] = useState({});
  // Whether the editor modal is open: "a new member" and "no editor" are both `formData.id === ''`.
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  // The row whose delete is being confirmed in the modal below.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [error, setError] = useState(null);
  // True while the background refresh after a save is still in flight.
  const [refreshing, setRefreshing] = useState(false);
  const [sortField, setSortField] = useState('user_name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [filterStatus, setFilterStatus] = useState('');
  // Bulk edit: the table gains a selection column, and the chosen members are edited together.
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState(BULK_EMPTY);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkProgress, setBulkProgress] = useState('');
  const [bulkError, setBulkError] = useState('');
  const [pendingBulk, setPendingBulk] = useState(false);

  const sortedUsers = useMemo(() => {
    let filtered = [...users];
    if (filterStatus) {
      filtered = filtered.filter((u) => u.status === filterStatus);
    }
    filtered.sort((a, b) => {
      const aVal = a[sortField] || '';
      const bVal = b[sortField] || '';
      if (sortDirection === 'asc') {
        return String(aVal).localeCompare(String(bVal));
      }
      return String(bVal).localeCompare(String(aVal));
    });
    return filtered;
  }, [users, sortField, sortDirection, filterStatus]);

  const isEditing = !!formData.id;

  const exitBulkMode = () => {
    setBulkMode(false);
    setSelectedIds(new Set());
    setBulkOpen(false);
    setBulkForm(BULK_EMPTY);
    setBulkError('');
  };

  const toggleSelected = (id) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allVisibleSelected = sortedUsers.length > 0 && sortedUsers.every((user) => selectedIds.has(user.id));
  const toggleAllVisible = () =>
    setSelectedIds((current) => {
      const next = new Set(current);
      sortedUsers.forEach((user) => (allVisibleSelected ? next.delete(user.id) : next.add(user.id)));
      return next;
    });

  // Only the fields that were changed. An untouched field is absent, which is what leaves it alone on every member.
  const bulkChanges = () => {
    const changes = {};
    Object.entries(bulkForm).forEach(([key, value]) => {
      if (value !== '') changes[key] = value;
    });
    return changes;
  };
  const bulkChangeNames = Object.keys(bulkChanges()).map((key) => BULK_CHANGE_LABELS[key]);

  const handleBulkSubmit = (e) => {
    e.preventDefault();
    setBulkError('');
    if (!bulkChangeNames.length) {
      setBulkError('Change at least one field - anything left alone is not saved.');
      return;
    }
    if (bulkForm.password && bulkForm.password.length < 8) {
      setBulkError('A password must be at least 8 characters.');
      return;
    }
    setPendingBulk(true);
  };

  const runBulkSave = async () => {
    setPendingBulk(false);
    const changes = bulkChanges();
    const targets = users.filter((user) => selectedIds.has(user.id));
    const failures = [];
    setBulkSaving(true);
    setBulkError('');
    for (let index = 0; index < targets.length; index += 1) {
      const user = targets[index];
      setBulkProgress(`Updating ${index + 1} of ${targets.length}…`);
      try {
        // The member's own values for everything not changed: the save replaces the roster document, so it has to be
        // handed what is already there. user_name is left out, which is what keeps the username from being touched.
        const result = await adminSaveUser({
          id: user.id,
          name: user.name,
          rank_id: changes.rank_id ?? String(user.rank_id ?? ''),
          role_id: changes.role_id ?? String(user.role_id ?? ''),
          exclude_from_scheduling: changes.exclude_from_scheduling ?? String(user.exclude_from_scheduling ?? ''),
          runner_sound_profile: user.runner_sound_profile || '',
          status: changes.status,
          password: changes.password,
          is_change_password_on_login: changes.is_change_password_on_login,
        }, token);
        if (!result?.success) throw new Error(result?.message || 'Failed to save.');
        const { password: _password, ...visible } = changes;
        void _password;
        onRowSaved?.('users', { ...user, ...visible, id: user.id });
      } catch (err) {
        failures.push({ user, message: err.message || 'Failed to save.' });
      }
    }
    setBulkSaving(false);
    setBulkProgress('');
    setRefreshing(true);
    Promise.resolve(onDataChanged?.('users')).finally(() => setRefreshing(false));

    if (!failures.length) {
      exitBulkMode();
      return;
    }
    // The ones that did not save stay selected, so fixing the cause and pressing Save again retries only them.
    setSelectedIds(new Set(failures.map((failure) => failure.user.id)));
    setBulkError(
      `${targets.length - failures.length} saved, ${failures.length} failed: ` +
        failures.map((failure) => `${failure.user.name} (${failure.message})`).join('; ')
    );
  };

  const resetForm = () => {
    setFormData(EMPTY_FORM);
    setSavedPrivate({});
    setEditorOpen(false);
  };

  const handleEdit = (user) => {
    setEditorOpen(true);
    setError(null);
    // What the record holds now, so the save below can send only what the officer actually changed.
    setSavedPrivate(Object.fromEntries(PRIVATE_FIELDS.map((key) => [key, String(user[key] ?? '').trim()])));
    setFormData({
      id: user.id,
      // Carried through the form so the backend can refuse a save built on a stale copy.
      row_version: user.row_version,
      user_name: user.user_name || '',
      name: user.name || '',
      password: '',
      status: user.status || 'active',
      role_id: String(user.role_id ?? ''),
      rank_id: String(user.rank_id ?? ''),
      exclude_from_scheduling:
        String(user.exclude_from_scheduling ?? '').trim().toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE',
      runner_sound_profile: user.runner_sound_profile || '',
      fema_student_id: user.fema_student_id || '',
      // The rest of the member's private details, edited here beside it. The member id is the officer's to set: the rules
      // refuse it to the member on their own row, which is what keeps an issued identifier out of their hands.
      member_id: user.member_id || '',
      email: user.email || '',
      phone: user.phone || '',
      // Normalized on the way in, so the checkbox is never in doubt about what the sheet holds.
      is_change_password_on_login:
        String(user.is_change_password_on_login ?? '').trim().toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE',
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

      // THE MEMBER'S OWN DETAILS ARE THEIR OWN WRITE, and only what CHANGED is sent: they live on the member's private
      // record rather than the roster row this save wrote, and the rules allow only these keys there - so an untouched
      // field is left alone rather than round-tripped, and an ordinary save is still the single request it has always been.
      const savedId = result.id || formData.id;
      const changed = Object.fromEntries(
        PRIVATE_FIELDS.map((key) => [key, String(formData[key] ?? '').trim()]).filter(
          ([key, value]) => value !== String(savedPrivate[key] ?? '').trim()
        )
      );
      if (savedId && Object.keys(changed).length) {
        const privateResult = await saveMemberPrivateFields({ userId: savedId, fields: changed });
        if (!privateResult?.success) {
          throw new Error(privateResult?.message || 'The member saved, but their personal details did not.');
        }
      }

      // Show the saved values in the list NOW. The refresh below is authoritative but cannot be
      // waited on, and until it lands the list still holds the pre-save row - so re-opening the
      // form straight after saving would show the old values.
      onRowSaved?.('users', { ...formData, id: result.id || formData.id });
      resetForm();

      // The refresh is NOT awaited: doPost serializes every request behind a script lock, so
      // waiting for the wave meant the spinner stayed up for the length of the queue rather than
      // for the save. It is tracked instead, so the tab can say it is happening rather than
      // leaving the list silently stale.
      setRefreshing(true);
      Promise.resolve(onDataChanged?.('users')).finally(() => setRefreshing(false));
    } catch (err) {
      setError(err.message || 'Failed to save user.');
    } finally {
      setSaving(false);
    }
  };

  // The row awaiting confirmation. Nothing is written until the modal below is answered; the work
  // itself is unchanged, it just runs from the modal's callback instead of inline.
  const handleDelete = (user) => setPendingDelete(user);

  const confirmDelete = async () => {
    const user = pendingDelete;
    setPendingDelete(null);
    if (!user) return;
    setDeletingId(user.id);
    setError(null);
    try {
      const result = await adminDeleteUser(user.id, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to delete user.');
      void onDataChanged('users');
      if (String(formData.id) === String(user.id)) resetForm();
    } catch (err) {
      setError(err.message || 'Failed to delete user.');
    } finally {
      setDeletingId(null);
    }
  };

  const roleLabel = (roleId) => roles.find((r) => String(r.id) === String(roleId))?.description || '—';
  const rankLabel = (rankId) => {
    const rank = ranks.find((r) => String(r.id) === String(rankId));
    if (!rank) return <span className="text-slate-400">—</span>;
    const color = String(rank.color || '').trim();

    if (color) {
      return (
        <span style={{ color }} className="inline-flex items-center gap-1.5">
          <RankIcon name={rank.icon} className="w-4 h-4 shrink-0" />
          <span>{rank.description || rankId}</span>
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1.5">
        <RankIcon name={rank.icon} className="w-4 h-4 shrink-0" />
        <span>{rank.description || rankId}</span>
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* The editor, in the viewport modal every New card in this module now uses. */}
      {editorOpen && (
        <ViewportModal
          title={isEditing ? recordHeading('User', formData.name || formData.user_name) : 'New member'}
          subtitle={isEditing ? 'Editing an existing member' : 'Not saved yet'}
          icon={<UsersIcon className="h-4 w-4" />}
          formId={USER_FORM_ID}
          saveLabel={isEditing ? 'Save changes' : 'Add member'}
          saving={saving}
          onClose={resetForm}
        >
        <form id={USER_FORM_ID} onSubmit={handleSubmit} className="space-y-4">

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
              Saved. Reloading the list in the background…
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
              <PasswordInput
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              {/* Sits with the password rather than with the other flags: it only means anything when a
                  password is being set, and it is about THIS password. */}
              <label className="mt-2 flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={formData.is_change_password_on_login === 'TRUE'}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      is_change_password_on_login: e.target.checked ? 'TRUE' : 'FALSE',
                    })
                  }
                  className="w-4 h-4 accent-red-600"
                />
                <span className="text-sm text-slate-700 dark:text-slate-200">Must change password at next login</span>
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                They sign in with this password once, then cannot do anything else until they set their own.
              </p>
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

            {/* <div>
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
            </div> */}

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

          {/* THE MEMBER'S OWN DETAILS: four fields that live on the PRIVATE half of the account rather than the roster row
              (a roster is readable by every member), written as their own call - see the note in firestore.rules. Offered
              on the new-member form too, so an officer can record them while adding somebody.

              MEMBER ID IS THE OFFICER'S ALONE. It is set here and nowhere else: no member sees it, which is why it is
              absent from the sign-in shape (firebaseAuth) rather than merely left undrawn. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Member ID</label>
              <input
                type="text"
                maxLength={20}
                value={formData.member_id}
                onChange={(e) => setFormData({ ...formData, member_id: e.target.value })}
                placeholder="e.g. 1042 (optional)"
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                The station&rsquo;s own number for this member. Members cannot see or change it, and it may be reused once
                somebody goes inactive.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">FEMA Student ID</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={40}
                value={formData.fema_student_id}
                onChange={(e) => setFormData({ ...formData, fema_student_id: e.target.value })}
                placeholder="e.g. 1234567 (optional)"
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                From FEMA&rsquo;s training system. The member can keep this up to date themselves.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Email Address</label>
              <input
                type="email"
                maxLength={120}
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="name@example.com (optional)"
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                For the station&rsquo;s records. Sign-in is unaffected &mdash; it still uses the username. The member can
                change this themselves.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Phone Number</label>
              <input
                type="tel"
                maxLength={40}
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="e.g. 555-0100 (optional)"
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                The member can change this themselves in My Settings.
              </p>
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

        </form>
        </ViewportModal>
      )}

      {/* Bulk edit: one form for every selected member, and only what is changed here is written. */}
      {bulkOpen && (
        <ViewportModal
          size="small"
          title={`Edit ${selectedIds.size} member${selectedIds.size === 1 ? '' : 's'}`}
          subtitle="Only the fields you change are saved. Everything else stays as it is for each person."
          icon={<ListChecks className="h-4 w-4" />}
          formId={BULK_FORM_ID}
          saveLabel="Apply changes"
          saving={bulkSaving}
          busy={bulkSaving}
          busyLabel={bulkProgress || 'Saving…'}
          onClose={() => setBulkOpen(false)}
        >
          <form id={BULK_FORM_ID} onSubmit={handleBulkSubmit} className="space-y-4 p-4 sm:p-6">
            {bulkError && (
              <div role="alert" className="p-3 rounded-xl flex items-start gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{bulkError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={BULK_LABEL_CLASS}>New password <span className="text-slate-500">(blank = unchanged)</span></label>
                <PasswordInput
                  autoComplete="new-password"
                  value={bulkForm.password}
                  onChange={(e) => setBulkForm({ ...bulkForm, password: e.target.value })}
                  className={BULK_FIELD_CLASS}
                />
              </div>
              <div>
                <label className={BULK_LABEL_CLASS}>Must change password at next login</label>
                <select value={bulkForm.is_change_password_on_login} onChange={(e) => setBulkForm({ ...bulkForm, is_change_password_on_login: e.target.value })} className={BULK_FIELD_CLASS}>
                  <option value="">No change</option>
                  <option value="TRUE">Yes</option>
                  <option value="FALSE">No</option>
                </select>
              </div>
              <div>
                <label className={BULK_LABEL_CLASS}>Status</label>
                <select value={bulkForm.status} onChange={(e) => setBulkForm({ ...bulkForm, status: e.target.value })} className={BULK_FIELD_CLASS}>
                  <option value="">No change</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div>
                <label className={BULK_LABEL_CLASS}>Scheduling</label>
                <select value={bulkForm.exclude_from_scheduling} onChange={(e) => setBulkForm({ ...bulkForm, exclude_from_scheduling: e.target.value })} className={BULK_FIELD_CLASS}>
                  <option value="">No change</option>
                  <option value="TRUE">Exclude from scheduling</option>
                  <option value="FALSE">Include in scheduling</option>
                </select>
              </div>
              <div>
                <label className={BULK_LABEL_CLASS}>Role</label>
                <select value={bulkForm.role_id} onChange={(e) => setBulkForm({ ...bulkForm, role_id: e.target.value })} className={BULK_FIELD_CLASS}>
                  <option value="">No change</option>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.description}</option>)}
                </select>
              </div>
              <div>
                <label className={BULK_LABEL_CLASS}>Rank</label>
                <select value={bulkForm.rank_id} onChange={(e) => setBulkForm({ ...bulkForm, rank_id: e.target.value })} className={BULK_FIELD_CLASS}>
                  <option value="">No change</option>
                  {ranks.map((r) => <option key={r.id} value={r.id}>{r.description}</option>)}
                </select>
              </div>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              {bulkChangeNames.length ? `Will change: ${bulkChangeNames.join(', ')}.` : 'Nothing is changed yet.'}
            </p>
          </form>
        </ViewportModal>
      )}

      {/* The roster, with New member where somebody looks for another one. */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-x-auto">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <UsersIcon className="h-4 w-4 shrink-0 text-red-500" />
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Members</h3>

          {/* Status filter */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="ml-auto rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>

          <button
            type="button"
            onClick={() => (bulkMode ? exitBulkMode() : setBulkMode(true))}
            className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition ${
              bulkMode
                ? 'border-red-500 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40'
                : 'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700'
            }`}
          >
            <ListChecks className="h-4 w-4" />
            {bulkMode ? 'Cancel bulk edit' : 'Bulk edit'}
          </button>

          {bulkMode && (
            <button
              type="button"
              disabled={selectedIds.size === 0}
              onClick={() => {
                setBulkError('');
                setBulkForm(BULK_EMPTY);
                setBulkOpen(true);
              }}
              className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
            >
              <Pencil className="h-4 w-4" />
              Edit selected ({selectedIds.size})
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              resetForm();
              setEditorOpen(true);
            }}
            className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500"
          >
            <Plus className="h-4 w-4" />
            New member
          </button>
        </div>
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-100 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 uppercase text-xs">
            <tr>
              {bulkMode && (
                <th className="w-10 px-4 py-3">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="Select all shown" className="h-4 w-4 accent-red-600" />
                </th>
              )}
              {[
                { field: 'user_name', label: 'Username' },
                { field: 'name', label: 'Name' },
                { field: 'status', label: 'Status' },
                { field: 'role_id', label: 'Role' },
                { field: 'rank_id', label: 'Rank' },
              ].map(({ field, label }) => (
                <th
                  key={field}
                  className="px-4 py-3 cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-200"
                  onClick={() => {
                    if (sortField === field) {
                      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
                    } else {
                      setSortField(field);
                      setSortDirection('asc');
                    }
                  }}
                >
                  <span className="inline-flex items-center gap-1">
                    {label}
                    {sortField === field ? (
                      sortDirection === 'asc' ? (
                        <ChevronUp className="w-3 h-3" />
                      ) : (
                        <ChevronDownIcon className="w-3 h-3" />
                      )
                    ) : null}
                  </span>
                </th>
              ))}
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700/70">
            {sortedUsers.map((user) => (
              <tr
                key={user.id}
                onClick={bulkMode ? () => toggleSelected(user.id) : undefined}
                className={`text-slate-700 dark:text-slate-200 ${bulkMode ? `cursor-pointer ${selectedIds.has(user.id) ? 'bg-red-50/60 dark:bg-red-950/20' : ''}` : ''}`}
              >
                {bulkMode && (
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selectedIds.has(user.id)} onChange={() => {}} aria-label={`Select ${user.name}`} className="h-4 w-4 accent-red-600" />
                  </td>
                )}
                <td className="px-4 py-3 font-mono text-slate-500 dark:text-slate-400">{user.user_name}</td>
                <td className="px-4 py-3 font-medium"><MemberName user={user} /></td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="capitalize">{user.status}</span>
                    {String(user.is_change_password_on_login ?? '').trim().toUpperCase() === 'TRUE' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                        <KeyRound className="w-3 h-3" />
                        Password change due
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">{roleLabel(user.role_id)}</td>
                <td className="px-4 py-3">{rankLabel(user.rank_id)}</td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
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
            {sortedUsers.length === 0 && (
              <tr>
                <td colSpan={bulkMode ? 7 : 6} className="px-4 py-6 text-center text-slate-500">No members found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pendingBulk && (
        <ConfirmModal
          title={`Change ${selectedIds.size} member${selectedIds.size === 1 ? '' : 's'}?`}
          message={`This will change ${bulkChangeNames.join(', ')} for every selected member. It cannot be undone in one step.`}
          confirmLabel="Apply"
          onConfirm={runBulkSave}
          onCancel={() => setPendingBulk(false)}
        />
      )}

      {/* Confirmed in the app rather than by a native dialog: it can be styled, it is heard
          (ConfirmModal plays the tone), and it names what is about to be deleted. */}
      {pendingDelete && (
        <ConfirmModal
          title="Delete member"
          message={<>Delete <strong className="text-slate-900 dark:text-white">{pendingDelete.name}</strong>? This cannot be undone.</>}
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

