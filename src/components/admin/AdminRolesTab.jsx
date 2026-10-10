import React, { useState } from 'react';
import { Loader2, Pencil, Trash2, Plus, AlertCircle, ShieldCheck, Lock } from 'lucide-react';
import { adminSaveRole, adminDeleteRole } from '../../services/api';
import ConfirmModal from '../ConfirmModal';
import ViewportModal from '../ViewportModal';

// The editor form's id: the modal's toolbar submits it through the HTML `form` attribute.
const ROLE_FORM_ID = 'role-editor-form';
import { recordHeading } from '../../utils/displayLabel';
import {
  ADMIN_PERMISSION_GROUPS,
  ADMIN_PERMISSIONS,
  ALL_PERMISSIONS,
  MASTER_PERMISSION_KEY,
  MEMBER_PERMISSION_GROUPS,
  MEMBER_PERMISSIONS,
  permissionBlockedByDependency,
  permissionGranted,
  permissionLockedByAdmin,
  permissionsByGroup,
} from '../../utils/permissions';

// A new role starts as an ordinary member: they can see their own schedule and use
// the timeclock, and nothing else. Every permission is still listed in the editor,
// so granting more is a deliberate act.
const MEMBER_DEFAULTS = ['can_view_my_schedule', 'can_use_timeclock'];

const buildEmptyForm = () => {
  const form = { id: '', description: '', [MASTER_PERMISSION_KEY]: false };
  ALL_PERMISSIONS.forEach((permission) => {
    form[permission.key] = MEMBER_DEFAULTS.includes(permission.key);
  });
  return form;
};

// Turn a stored role row into editable form state. Every flag is read through the
// shared TRUE parser, so a sheet holding "TRUE" behaves the same as a boolean.
const formFromRole = (role) => {
  const form = {
    id: role.id,
      // Carried through the form so the backend can refuse a save built on a stale copy.
      row_version: role.row_version,
    description: role.description || '',
    [MASTER_PERMISSION_KEY]: permissionGranted(role, MASTER_PERMISSION_KEY),
  };
  ALL_PERMISSIONS.forEach((permission) => {
    form[permission.key] = permissionGranted(role, permission.key);
  });
  return form;
};

const grantedCount = (role) =>
  ALL_PERMISSIONS.filter((permission) => permissionGranted(role, permission.key)).length;

export default function AdminRolesTab({ token, roles = [], isAdmin = false, onDataChanged, onRowSaved }) {
  const [formData, setFormData] = useState(buildEmptyForm);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  // The row whose delete is being confirmed in the modal below.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [error, setError] = useState(null);
  // Whether the editor modal is open: "a new role" and "no editor" are both `formData.id === ''`.
  const [editorOpen, setEditorOpen] = useState(false);

  const isEditing = !!formData.id;
  const resetForm = () => {
    setFormData(buildEmptyForm());
    setEditorOpen(false);
  };

  // The STORED row being edited (if any). Its current flags decide what this editor
  // is allowed to touch - the backend enforces the same rule.
  const storedRole = isEditing
    ? roles.find((role) => String(role.id) === String(formData.id))
    : null;
  const targetIsAdministrator = !!storedRole && permissionGranted(storedRole, MASTER_PERMISSION_KEY);
  // An administrator-only role is out of reach for a role that merely manages roles.
  const blockedByAdminRole = targetIsAdministrator && !isAdmin;

  const handleEdit = (role) => {
    setEditorOpen(true);
    setError(null);
    setFormData(formFromRole(role));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await adminSaveRole(formData, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to save role.');
      // The row shows on the table straight away; the refresh wave lands in the background. A role edit
      // changes permissions, so the screen that depends on them (this one, and the nav) must not wait for it.
      onRowSaved?.('roles', formData);
      void onDataChanged('roles');
      resetForm();
    } catch (err) {
      setError(err.message || 'Failed to save role.');
    } finally {
      setSaving(false);
    }
  };

  // The row awaiting confirmation. Nothing is written until the modal below is answered; the work
  // itself is unchanged, it just runs from the modal's callback instead of inline.
  const handleDelete = (role) => setPendingDelete(role);

  const confirmDelete = async () => {
    const role = pendingDelete;
    setPendingDelete(null);
    if (!role) return;
    setDeletingId(role.id);
    setError(null);
    try {
      const result = await adminDeleteRole(role.id, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to delete role.');
      // A deletion has no row to merge, so the table is honest for a moment longer than it was; the wave
      // removes it. Nothing is held open for it.
      void onDataChanged('roles');
      if (String(formData.id) === String(role.id)) resetForm();
    } catch (err) {
      setError(err.message || 'Failed to delete role.');
    } finally {
      setDeletingId(null);
    }
  };

  // One permission row: a checkbox plus its explanation. Administrators have every
  // permission, so the box is shown locked on rather than removed; a permission
  // whose prerequisite is off is locked off the same way.
  const PermissionCheckbox = ({ permission }) => {
    const lockedOn = permissionLockedByAdmin(formData, permission.key);
    const blocked = permissionBlockedByDependency(formData, permission.key);
    const checked = blocked ? false : lockedOn ? true : permissionGranted(formData, permission.key);
    const requires = permission.requires
      ? ALL_PERMISSIONS.find((entry) => entry.key === permission.requires)
      : null;

    return (
      <label
        className={`flex items-start gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700/70 ${
          blocked ? 'opacity-60' : 'hover:bg-slate-50 dark:hover:bg-slate-900/40'
        }`}
        title={
          lockedOn
            ? 'Administrator access grants every permission'
            : blocked
              ? `Requires "${requires?.label}"`
              : permission.description
        }
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={lockedOn || blocked}
          onChange={(e) => setFormData({ ...formData, [permission.key]: e.target.checked })}
          className="w-4 h-4 mt-0.5 rounded accent-red-600 disabled:cursor-not-allowed"
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-medium text-slate-800 dark:text-slate-100">
            {permission.label}
            {(lockedOn || blocked) && <Lock className="w-3 h-3 text-slate-400 shrink-0" />}
          </span>
          <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {permission.description}
          </span>
        </span>
      </label>
    );
  };

  return (
    <div className="space-y-6">
      {/* The role list comes first: it is the overview an administrator opens
          this tab for, and the permission editor is only needed once a
          role is chosen or a new one is being added. */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-x-auto">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <ShieldCheck className="h-4 w-4 shrink-0 text-red-500" />
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Roles</h3>
          <button
            type="button"
            onClick={() => {
              resetForm();
              setEditorOpen(true);
            }}
            className="ml-auto flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500"
          >
            <Plus className="h-4 w-4" />
            New role
          </button>
        </div>
        <table className="w-full text-sm text-left">
          <thead className="sticky top-0 z-10 bg-slate-100/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700/60 text-slate-500 dark:text-slate-400 uppercase text-xs">
            <tr>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3">Administrator</th>
              <th className="px-4 py-3">Permissions</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700/70">
            {roles.map((role) => {
              const isAdminRole = permissionGranted(role, MASTER_PERMISSION_KEY);
              // An administrator-only role cannot be edited or deleted by a role
              // that merely manages roles (enforced server-side as well).
              const lockedRow = isAdminRole && !isAdmin;
              const granted = grantedCount(role);
              return (
                <tr key={role.id} className="text-slate-700 dark:text-slate-200">
                  <td className="px-4 py-3 font-medium">
                    {role.description}
                  </td>
                  <td className="px-4 py-3">
                    {isAdminRole ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400">
                        <ShieldCheck className="w-3.5 h-3.5" /> Full access
                      </span>
                    ) : (
                      <span className="text-slate-500 dark:text-slate-400">No</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isAdminRole ? (
                      <span className="text-slate-500 dark:text-slate-400">All</span>
                    ) : (
                      <span title={ALL_PERMISSIONS.filter((p) => permissionGranted(role, p.key)).map((p) => p.label).join(', ')}>
                        {granted} of {ALL_PERMISSIONS.length}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => handleEdit(role)}
                        disabled={lockedRow}
                        title={lockedRow ? 'Only an administrator can change this role' : `Edit ${role.description}`}
                        className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(role)}
                        disabled={deletingId === role.id || lockedRow}
                        title={lockedRow ? 'Only an administrator can delete this role' : `Delete ${role.description}`}
                        className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                      >
                        {deletingId === role.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {roles.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-500">No roles found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* The editor, in the viewport modal every New card in this module now uses. Its own Save was disabled for a
          non-administrator editing the administrator role; that rule moved to saveDisabled, so the toolbar button
          carries it instead - with the reason beside it, where the granted count already was. */}
      {editorOpen && (
        <ViewportModal
          title={isEditing ? recordHeading('Role', formData.description) : 'New role'}
          subtitle={isEditing ? 'Editing an existing role' : 'Not saved yet'}
          icon={<ShieldCheck className="h-4 w-4" />}
          formId={ROLE_FORM_ID}
          saveLabel={isEditing ? 'Save changes' : 'Add role'}
          saving={saving}
          saveDisabled={blockedByAdminRole}
          onClose={resetForm}
          actions={
            <span className="mr-1 hidden text-xs text-slate-500 dark:text-slate-400 sm:inline">
              {blockedByAdminRole
                ? 'Only an administrator can change this role.'
                : `${grantedCount(formData)} of ${ALL_PERMISSIONS.length} permissions granted.`}
            </span>
          }
        >
        <form id={ROLE_FORM_ID} onSubmit={handleSubmit} className="space-y-5">

          {error && (
            <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {blockedByAdminRole && (
            <div className="p-3 rounded-xl flex items-start gap-2 text-sm bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                This role has Administrator access. Only an administrator can change or delete it —
                ask an administrator to make any changes.
              </span>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Description</label>
            <input
              type="text"
              required
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="e.g. Lieutenant"
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          {/* The master switch. Locked on for a non-administrator, who cannot grant
              it to themselves or anyone else. */}
          <label
            className={`flex items-start gap-3 p-4 rounded-xl border ${
              isAdmin
                ? 'border-red-300 dark:border-red-800 bg-red-50/60 dark:bg-red-950/30'
                : 'border-slate-200 dark:border-slate-700/70 opacity-60'
            }`}
            title={isAdmin ? 'Grants every permission below' : 'Only an administrator can grant Administrator access'}
          >
            <input
              type="checkbox"
              checked={permissionGranted(formData, MASTER_PERMISSION_KEY)}
              disabled={!isAdmin}
              onChange={(e) => setFormData({ ...formData, [MASTER_PERMISSION_KEY]: e.target.checked })}
              className="w-4 h-4 mt-0.5 rounded accent-red-600 disabled:cursor-not-allowed"
            />
            <span>
              <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-white">
                Administrator access
                {!isAdmin && <Lock className="w-3 h-3 text-slate-400 shrink-0" />}
              </span>
              <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Full access to everything, everywhere. Every permission below is granted and locked on while this is ticked.
              </span>
            </span>
          </label>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Administration module
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 -mt-1">
              Any one of these opens the Administration module for this role — it does not require
              Administrator access. Each grants its own tab only.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {permissionsByGroup(ADMIN_PERMISSIONS, ADMIN_PERMISSION_GROUPS).map((group) => (
                <div key={group.label} className="md:col-span-2 space-y-2">
                  {/* A HEADING PER GROUP, and the row still lays out in two columns beneath it - which is the whole point
                      of the change: twenty-two checkboxes in one grid is a wall, and the same twenty-two under six
                      headings is a form somebody can read. */}
                  <h5 className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    {group.label}
                  </h5>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {group.permissions.map((permission) => (
                      <PermissionCheckbox key={permission.key} permission={permission} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Member modules
            </h4>
            <div className="grid grid-cols-1 gap-5">
              {permissionsByGroup(MEMBER_PERMISSIONS, MEMBER_PERMISSION_GROUPS).map((group) => (
                <div key={group.label} className="space-y-2">
                  <h5 className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    {group.label}
                  </h5>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {group.permissions.map((permission) => (
                      <PermissionCheckbox key={permission.key} permission={permission} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

        </form>
        </ViewportModal>
      )}


      {/* Confirmed in the app rather than by a native dialog: it can be styled, it is heard
          (ConfirmModal plays the tone), and it names what is about to be deleted. */}
      {pendingDelete && (
        <ConfirmModal
          title="Delete role"
          message={<>Delete <strong className="text-slate-900 dark:text-white">{pendingDelete.description}</strong>? Users with this role will need to be reassigned.</>}
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

