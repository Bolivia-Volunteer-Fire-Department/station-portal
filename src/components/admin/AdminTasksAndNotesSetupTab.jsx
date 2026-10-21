import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Search,
  Filter,
  CheckSquare,
  ClipboardList,
  Truck,
  FileText,
  Repeat,
  Archive,
  Layers,
  ChevronDown,
  Shield,
  ShieldCheck,
  RotateCcw,
  Lock,
  Copy,
} from 'lucide-react';
import ConfirmModal from '../ConfirmModal';
import ViewportModal from '../ViewportModal';
import FormBuilderCanvas from './forms/FormBuilderCanvas';
import { fetchTaskNoteTemplates, saveTaskNoteTemplate, deleteTaskNoteTemplate, fetchApparatus } from '../../services/api';
import {
  TASK_NOTE_KINDS,
  KIND_META,
  getTemplateLifecycle,
  normalizeTaskNoteTemplate,
  getRoleDefaultTasksAndNotesPermissions,
} from '../../utils/tasksAndNotes';
import { permissionGranted } from '../../utils/permissions';
import { stationTodayKey } from '../../utils/scheduleDate';
import { toast } from '../../utils/toast';

const DAYS_OF_WEEK = [
  { id: 'sunday', label: 'Sun' },
  { id: 'monday', label: 'Mon' },
  { id: 'tuesday', label: 'Tue' },
  { id: 'wednesday', label: 'Wed' },
  { id: 'thursday', label: 'Thu' },
  { id: 'friday', label: 'Fri' },
  { id: 'saturday', label: 'Sat' },
];

const TEMPLATE_FORM_ID = 'task-note-template-form';

const EMPTY_TEMPLATE = {
  id: '',
  name: '',
  kind: TASK_NOTE_KINDS.TASK,
  description: '',
  effective_date: new Date().toISOString().slice(0, 10),
  end_date: '',
  apparatus_id: '',
  scheduling: {
    enabled: false,
    frequency: 'daily',
    days_of_week: [],
    day_of_month: 1,
    shift_type: 'all',
  },
  custom_permissions_enabled: false,
  role_permissions: {},
  layout: [],
  audience_all: true,
  audience_role_ids: [],
  audience_rank_ids: [],
};

export default function AdminTasksAndNotesSetupTab({
  mode = 'all', // 'all' | 'task' | 'note'
  roles = [],
  ranks = [],
  token = '',
  currentUser = null,
}) {
  const [templates, setTemplates] = useState([]);
  const [apparatusList, setApparatusList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [kindFilter, setKindFilter] = useState(
    mode === 'note' ? TASK_NOTE_KINDS.NOTE : mode === 'task' ? TASK_NOTE_KINDS.TASK : 'all'
  );
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'active' | 'retired'

  // Editor Modal State
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(EMPTY_TEMPLATE);
  const [pendingDelete, setPendingDelete] = useState(null);

  const todayKey = useMemo(() => stationTodayKey(), []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [fetchedTemplates, fetchedApparatus] = await Promise.all([
        fetchTaskNoteTemplates(),
        fetchApparatus(token).catch(() => ({ apparatus: [] })),
      ]);
      setTemplates(fetchedTemplates || []);
      if (fetchedApparatus?.apparatus) {
        setApparatusList(fetchedApparatus.apparatus);
      }
    } catch (err) {
      setError(err.message || 'Failed to load task and note templates.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Restrict available kinds depending on mode
  const allowedKinds = useMemo(() => {
    if (mode === 'note') return [TASK_NOTE_KINDS.NOTE];
    if (mode === 'task') return [TASK_NOTE_KINDS.TASK, TASK_NOTE_KINDS.APPARATUS_CHECKLIST];
    return [TASK_NOTE_KINDS.NOTE, TASK_NOTE_KINDS.TASK, TASK_NOTE_KINDS.APPARATUS_CHECKLIST];
  }, [mode]);

  const filteredTemplates = useMemo(() => {
    return templates.filter((tpl) => {
      // Respect mode restriction
      if (!allowedKinds.includes(tpl.kind)) return false;

      // Filter by kind
      if (kindFilter !== 'all' && tpl.kind !== kindFilter) return false;

      // Filter by lifecycle
      const lifecycle = getTemplateLifecycle(tpl, todayKey);
      if (statusFilter !== 'all' && lifecycle !== statusFilter) return false;

      // Filter by search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = String(tpl.name || '').toLowerCase().includes(q);
        const matchesDesc = String(tpl.description || '').toLowerCase().includes(q);
        if (!matchesName && !matchesDesc) return false;
      }

      return true;
    });
  }, [templates, allowedKinds, kindFilter, statusFilter, searchQuery, todayKey]);

  const handleOpenNew = () => {
    const defaultKind = mode === 'note' ? TASK_NOTE_KINDS.NOTE : TASK_NOTE_KINDS.TASK;
    const initialRolePerms = {};
    (roles || []).forEach((r) => {
      initialRolePerms[r.id] = getRoleDefaultTasksAndNotesPermissions(r);
    });
    setEditingTemplate({
      ...EMPTY_TEMPLATE,
      kind: defaultKind,
      effective_date: stationTodayKey(),
      custom_permissions_enabled: false,
      role_permissions: initialRolePerms,
    });
    setEditorOpen(true);
  };

  const handleOpenEdit = (template) => {
    const normalized = normalizeTaskNoteTemplate(template);
    const existing = { ...(normalized.role_permissions || {}) };
    (roles || []).forEach((r) => {
      if (!existing[r.id]) {
        existing[r.id] = getRoleDefaultTasksAndNotesPermissions(r);
      }
    });
    setEditingTemplate({
      ...normalized,
      role_permissions: existing,
    });
    setEditorOpen(true);
  };

  const handleDuplicate = () => {
    if (!editingTemplate) return;
    setEditingTemplate((prev) => ({
      ...prev,
      id: '',
      name: `${prev.name || 'Template'} (Copy)`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
    toast.success('Template duplicated. Ready to save as a new template.');
  };

  const handleToggleCustomPermissions = (enabled) => {
    setEditingTemplate((prev) => {
      const perms = { ...(prev.role_permissions || {}) };
      (roles || []).forEach((r) => {
        if (!perms[r.id]) {
          perms[r.id] = getRoleDefaultTasksAndNotesPermissions(r);
        }
      });
      return {
        ...prev,
        custom_permissions_enabled: enabled,
        role_permissions: perms,
      };
    });
  };

  const handleResetAllPermissions = () => {
    const perms = {};
    (roles || []).forEach((r) => {
      perms[r.id] = getRoleDefaultTasksAndNotesPermissions(r);
    });
    setEditingTemplate((prev) => ({
      ...prev,
      role_permissions: perms,
    }));
    toast.success('Reset all role permissions to station defaults.');
  };

  const handleToggleRolePerm = (roleId, permKey, checked) => {
    setEditingTemplate((prev) => {
      const roleObj = (roles || []).find((r) => r.id === roleId);
      const currentRolePerms = prev.role_permissions?.[roleId] || getRoleDefaultTasksAndNotesPermissions(roleObj);
      let nextRolePerms = { ...currentRolePerms, [permKey]: checked };

      // Dependency rules:
      // If unchecking can_view -> automatically clear can_edit, can_unsign, can_delete
      if (permKey === 'can_view' && !checked) {
        nextRolePerms.can_edit = false;
        nextRolePerms.can_unsign = false;
        nextRolePerms.can_delete = false;
      }
      // If checking can_edit, can_unsign, or can_delete -> must be able to view
      if ((permKey === 'can_edit' || permKey === 'can_unsign' || permKey === 'can_delete') && checked) {
        nextRolePerms.can_view = true;
      }

      return {
        ...prev,
        role_permissions: {
          ...prev.role_permissions,
          [roleId]: nextRolePerms,
        },
      };
    });
  };

  const handleResetSingleRole = (roleId) => {
    const roleObj = (roles || []).find((r) => r.id === roleId);
    if (!roleObj) return;
    const defaults = getRoleDefaultTasksAndNotesPermissions(roleObj);
    setEditingTemplate((prev) => ({
      ...prev,
      role_permissions: {
        ...prev.role_permissions,
        [roleId]: defaults,
      },
    }));
  };

  const isRoleOverridden = (role) => {
    if (Boolean(role.is_admin) || permissionGranted(role, 'is_admin')) return false;
    if (!editingTemplate.custom_permissions_enabled) return false;
    const current = editingTemplate.role_permissions?.[role.id];
    if (!current) return false;
    const defaults = getRoleDefaultTasksAndNotesPermissions(role);
    return (
      Boolean(current.can_view) !== Boolean(defaults.can_view) ||
      Boolean(current.can_edit) !== Boolean(defaults.can_edit) ||
      Boolean(current.can_unsign) !== Boolean(defaults.can_unsign) ||
      Boolean(current.can_delete) !== Boolean(defaults.can_delete)
    );
  };

  const handleSave = async (e) => {
    e?.preventDefault();
    if (!editingTemplate.name.trim()) {
      toast.error('Template name is required.');
      return;
    }
    if (!editingTemplate.effective_date) {
      toast.error('Effective date is required.');
      return;
    }

    setSaving(true);
    try {
      await saveTaskNoteTemplate({
        ...editingTemplate,
        name: editingTemplate.name.trim(),
        description: editingTemplate.description.trim(),
        authorId: currentUser?.id || '',
      });
      toast.success(editingTemplate.id ? 'Template updated successfully.' : 'Template created successfully.');
      setEditorOpen(false);
      await loadData();
    } catch (err) {
      toast.error(err.message || 'Failed to save template.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setSaving(true);
    try {
      await deleteTaskNoteTemplate(pendingDelete.id);
      toast.success('Template deleted successfully.');
      setPendingDelete(null);
      await loadData();
    } catch (err) {
      toast.error(err.message || 'Failed to delete template.');
    } finally {
      setSaving(false);
    }
  };

  const toggleDayOfWeek = (dayId) => {
    const current = editingTemplate.scheduling?.days_of_week || [];
    const next = current.includes(dayId) ? current.filter((d) => d !== dayId) : [...current, dayId];
    setEditingTemplate((prev) => ({
      ...prev,
      scheduling: {
        ...prev.scheduling,
        days_of_week: next,
      },
    }));
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            {mode === 'note' ? (
              <>
                <ClipboardList className="h-6 w-6 text-purple-600" />
                Shift Note Templates
              </>
            ) : mode === 'task' ? (
              <>
                <CheckSquare className="h-6 w-6 text-sky-600" />
                Task & Apparatus Checklist Templates
              </>
            ) : (
              <>
                <Layers className="h-6 w-6 text-red-600" />
                Task, Note & Checklist Templates
              </>
            )}
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {mode === 'note'
              ? 'Configure daily shift note templates, required fields, and active lifecycle dates.'
              : mode === 'task'
              ? 'Design recurring operational tasks, apparatus daily checks, and schedule frequencies.'
              : 'Create interactive templates for shift notes, operational tasks, and apparatus walk-around checklists.'}
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenNew}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700 transition"
        >
          <Plus className="h-4 w-4" />
          <span>New Template</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search templates by title or description…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>

        {mode === 'all' && (
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            className="px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            <option value="all">All Types</option>
            <option value={TASK_NOTE_KINDS.NOTE}>Shift Notes</option>
            <option value={TASK_NOTE_KINDS.TASK}>Daily Tasks</option>
            <option value={TASK_NOTE_KINDS.APPARATUS_CHECKLIST}>Apparatus Checklists</option>
          </select>
        )}

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active Only</option>
          <option value="retired">Retired Only</option>
          <option value="upcoming">Upcoming Only</option>
        </select>
      </div>

      {/* Content State */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin text-red-600" />
          <span className="ml-3 text-sm">Loading templates…</span>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center dark:border-slate-700">
          <FileText className="mx-auto h-12 w-12 text-slate-400" />
          <h3 className="mt-3 text-sm font-semibold text-slate-900 dark:text-white">No templates found</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {searchQuery || kindFilter !== 'all' || statusFilter !== 'all'
              ? 'Try adjusting your search or filters.'
              : 'Create your first template to get started.'}
          </p>
          <button
            type="button"
            onClick={handleOpenNew}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 transition"
          >
            <Plus className="h-4 w-4" />
            <span>Create Template</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredTemplates.map((tpl) => {
            const kindMeta = KIND_META[tpl.kind] || KIND_META[TASK_NOTE_KINDS.TASK];
            const lifecycle = getTemplateLifecycle(tpl, todayKey);
            const apparatus = apparatusList.find((a) => a.id === tpl.apparatus_id);

            return (
              <div
                key={tpl.id}
                className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:shadow-md dark:border-slate-700 dark:bg-slate-800"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${kindMeta.badgeClass}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${kindMeta.dotClass}`} />
                      {kindMeta.label}
                    </span>

                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        lifecycle === 'active'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                          : lifecycle === 'retired'
                          ? 'bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                          : 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800'
                      }`}
                    >
                      {lifecycle === 'active' ? 'Active' : lifecycle === 'retired' ? 'Retired' : 'Upcoming'}
                    </span>
                  </div>

                  <h3 className="mt-3 text-base font-semibold text-slate-900 dark:text-white line-clamp-1">
                    {tpl.name}
                  </h3>

                  {tpl.description && (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                      {tpl.description}
                    </p>
                  )}

                  {/* Metadata & Scheduling info */}
                  <div className="mt-4 space-y-1.5 text-xs text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-700/60 pt-3">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span>
                        Effective: <strong className="text-slate-700 dark:text-slate-300">{tpl.effective_date}</strong>
                        {tpl.end_date ? ` to ${tpl.end_date}` : ' (Ongoing)'}
                      </span>
                    </div>

                    {tpl.kind === TASK_NOTE_KINDS.APPARATUS_CHECKLIST && (
                      <div className="flex items-center gap-1.5">
                        <Truck className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span>
                          Apparatus:{' '}
                          <strong className="text-slate-700 dark:text-slate-300">
                            {apparatus ? `${apparatus.identifier || ''} - ${apparatus.description}` : 'Any Apparatus'}
                          </strong>
                        </span>
                      </div>
                    )}

                    {tpl.scheduling?.enabled && (
                      <div className="flex items-center gap-1.5 text-sky-600 dark:text-sky-400">
                        <Repeat className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          Schedule:{' '}
                          <strong className="capitalize">
                            {tpl.scheduling.frequency === 'daily'
                              ? 'Every Day'
                              : tpl.scheduling.frequency === 'weekly'
                              ? `Weekly (${(tpl.scheduling.days_of_week || []).map((d) => d.slice(0, 3)).join(', ') || 'None'})`
                              : `Monthly (Day ${tpl.scheduling.day_of_month})`}
                          </strong>
                        </span>
                      </div>
                    )}

                    {tpl.custom_permissions_enabled && (
                      <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                        <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                        <span>Custom role permissions</span>
                      </div>
                    )}

                    <div className="flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span>{Array.isArray(tpl.layout) ? tpl.layout.length : 0} form fields configured</span>
                    </div>
                  </div>
                </div>

                {/* Card Actions */}
                <div className="mt-5 flex items-center justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-700/60">
                  <button
                    type="button"
                    onClick={() => handleOpenEdit(tpl)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(tpl)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-400 dark:hover:bg-rose-950/40 transition"
                    title="Delete template"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Editor Modal */}
      {editorOpen && (
        <ViewportModal
          title={editingTemplate.id ? `Edit Template: ${editingTemplate.name}` : 'New Template'}
          subtitle={editingTemplate.id ? 'Configure layout, frequency & role access' : 'Create a new task, note, or checklist'}
          formId={TEMPLATE_FORM_ID}
          saveLabel={editingTemplate.id ? 'Save Template' : 'Create Template'}
          saving={saving}
          size="large"
          onClose={() => setEditorOpen(false)}
          actions={
            editingTemplate.id ? (
              <button
                type="button"
                onClick={handleDuplicate}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
                title="Duplicate this template as a new template"
              >
                <Copy className="h-4 w-4" />
                <span>Duplicate</span>
              </button>
            ) : null
          }
        >
          <form id={TEMPLATE_FORM_ID} onSubmit={handleSave} className="space-y-6 p-6">
            {/* Template Identity */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Template Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editingTemplate.name}
                  onChange={(e) => setEditingTemplate((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. Engine 1 Daily Walk-Around, Shift Log, Weekly Bay Chore"
                  className="mt-1 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Template Type <span className="text-red-500">*</span>
                </label>
                <select
                  value={editingTemplate.kind}
                  disabled={Boolean(editingTemplate.id) || allowedKinds.length === 1}
                  onChange={(e) => setEditingTemplate((prev) => ({ ...prev, kind: e.target.value }))}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white disabled:opacity-60"
                >
                  {allowedKinds.map((k) => (
                    <option key={k} value={k}>
                      {KIND_META[k]?.label || k}
                    </option>
                  ))}
                </select>
              </div>

              {editingTemplate.kind === TASK_NOTE_KINDS.APPARATUS_CHECKLIST && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Target Apparatus
                  </label>
                  <select
                    value={editingTemplate.apparatus_id || ''}
                    onChange={(e) => setEditingTemplate((prev) => ({ ...prev, apparatus_id: e.target.value }))}
                    className="mt-1 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                  >
                    <option value="">Any Apparatus (Fleet-wide)</option>
                    {apparatusList.map((app) => (
                      <option key={app.id} value={app.id}>
                        {app.identifier ? `${app.identifier} - ` : ''}
                        {app.description}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Description / Instructions
                </label>
                <textarea
                  rows={2}
                  value={editingTemplate.description}
                  onChange={(e) => setEditingTemplate((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="Instructions for crew members completing this task or shift note…"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Effective Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={editingTemplate.effective_date}
                  onChange={(e) => setEditingTemplate((prev) => ({ ...prev, effective_date: e.target.value }))}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                />
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  Date from which this template becomes active for crew use.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  End / Retirement Date (Optional)
                </label>
                <input
                  type="date"
                  value={editingTemplate.end_date || ''}
                  onChange={(e) => setEditingTemplate((prev) => ({ ...prev, end_date: e.target.value }))}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                />
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  Leave blank for ongoing. Set an end date to retire this version.
                </p>
              </div>
            </div>

            {/* Scheduling Section (For Tasks & Checklists) */}
            {editingTemplate.kind !== TASK_NOTE_KINDS.NOTE && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-800/40 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                      <Repeat className="h-4 w-4 text-sky-600" />
                      Recurring Schedule & Dashboard Widget
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      When enabled, this task automatically surfaces on the Station Dashboard on its scheduled days.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(editingTemplate.scheduling?.enabled)}
                      onChange={(e) =>
                        setEditingTemplate((prev) => ({
                          ...prev,
                          scheduling: {
                            ...prev.scheduling,
                            enabled: e.target.checked,
                          },
                        }))
                      }
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-sky-600" />
                  </label>
                </div>

                {editingTemplate.scheduling?.enabled && (
                  <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Frequency
                      </label>
                      <div className="mt-2 flex gap-4 text-xs font-medium text-slate-700 dark:text-slate-300">
                        {['daily', 'weekly', 'monthly'].map((freq) => (
                          <label key={freq} className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              name="scheduling_frequency"
                              value={freq}
                              checked={(editingTemplate.scheduling?.frequency || 'daily') === freq}
                              onChange={(e) =>
                                setEditingTemplate((prev) => ({
                                  ...prev,
                                  scheduling: {
                                    ...prev.scheduling,
                                    frequency: e.target.value,
                                  },
                                }))
                              }
                              className="accent-sky-600"
                            />
                            <span className="capitalize">{freq}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {editingTemplate.scheduling?.frequency === 'weekly' && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                          Scheduled Days of Week
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {DAYS_OF_WEEK.map((d) => {
                            const isSelected = (editingTemplate.scheduling?.days_of_week || []).includes(d.id);
                            return (
                              <button
                                type="button"
                                key={d.id}
                                onClick={() => toggleDayOfWeek(d.id)}
                                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition ${
                                  isSelected
                                    ? 'bg-sky-600 text-white border-sky-600'
                                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                                }`}
                              >
                                {d.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {editingTemplate.scheduling?.frequency === 'monthly' && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Day of Month (1 - 31)
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={31}
                          value={editingTemplate.scheduling?.day_of_month || 1}
                          onChange={(e) =>
                            setEditingTemplate((prev) => ({
                              ...prev,
                              scheduling: {
                                ...prev.scheduling,
                                day_of_month: parseInt(e.target.value, 10) || 1,
                              },
                            }))
                          }
                          className="mt-1 h-9 w-24 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Interactive Form Builder Canvas */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <FileText className="h-4 w-4 text-red-600" />
                    Interactive Form Layout Builder
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Add headers, checkboxes, text fields, ratings, drop-downs, and digital signature sign-offs.
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
                <FormBuilderCanvas
                  layout={editingTemplate.layout || []}
                  onChange={(newLayout) =>
                    setEditingTemplate((prev) => ({ ...prev, layout: newLayout }))
                  }
                />
              </div>
            </div>

            {/* Role Permissions & Access Overrides */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-800/40 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-red-600" />
                    Role Permissions & Access Overrides
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Control which member roles can view, fill, un-sign, or delete entries for this template.
                  </p>
                </div>

                <div className="flex items-center gap-3 self-start sm:self-auto">
                  {editingTemplate.custom_permissions_enabled && (
                    <button
                      type="button"
                      onClick={handleResetAllPermissions}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 transition"
                      title="Reset all role permissions to station defaults"
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span>Reset to Defaults</span>
                    </button>
                  )}

                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(editingTemplate.custom_permissions_enabled)}
                      onChange={(e) => handleToggleCustomPermissions(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-red-600" />
                  </label>
                </div>
              </div>

              {!editingTemplate.custom_permissions_enabled ? (
                <div className="rounded-xl border border-sky-100 dark:border-sky-900/50 bg-sky-50/70 dark:bg-sky-950/30 p-3 flex items-start gap-2.5 text-xs text-sky-800 dark:text-sky-300">
                  <Shield className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">Using Station Role Defaults:</span> Roles currently access this template based on their station-wide Tasks & Notes permissions shown below. Toggle the switch above to customize permissions for individual roles on this specific template.
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-amber-100 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/30 p-3 flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300">
                  <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">Template-Specific Overrides Enabled:</span> Custom permissions configured below will override station role defaults for this template and its logged entries.
                  </div>
                </div>
              )}

              {/* Permissions Matrix Table */}
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xs">
                <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800 text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 font-semibold text-slate-700 dark:text-slate-300">
                    <tr>
                      <th className="py-2.5 px-3">Role</th>
                      <th className="py-2.5 px-3">Station Role Default</th>
                      <th className="py-2.5 px-3">Template Access</th>
                      <th className="py-2.5 px-3 text-center">View</th>
                      <th className="py-2.5 px-3 text-center">Fill & Edit</th>
                      <th className="py-2.5 px-3 text-center">Un-sign</th>
                      <th className="py-2.5 px-3 text-center">Delete</th>
                      {editingTemplate.custom_permissions_enabled && (
                        <th className="py-2.5 px-3 text-right">Reset</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {roles.length === 0 ? (
                      <tr>
                        <td colSpan={editingTemplate.custom_permissions_enabled ? 8 : 7} className="py-4 text-center text-slate-400">
                          No roles configured.
                        </td>
                      </tr>
                    ) : (
                      roles.map((r) => {
                        const isAdminRole = Boolean(r.is_admin) || permissionGranted(r, 'is_admin');
                        const defaults = getRoleDefaultTasksAndNotesPermissions(r);
                        const rolePerms = isAdminRole
                          ? { can_view: true, can_edit: true, can_unsign: true, can_delete: true }
                          : editingTemplate.role_permissions?.[r.id] || defaults;
                        const overridden = isRoleOverridden(r);
                        const isInteractive = editingTemplate.custom_permissions_enabled && !isAdminRole;

                        // Formatted summary of station-wide tasks & notes defaults
                        const defaultsSummary = isAdminRole
                          ? 'Full Access (Admin)'
                          : [
                              defaults.can_view ? 'View' : null,
                              defaults.can_edit ? 'Fill & Edit' : null,
                              defaults.can_unsign ? 'Un-sign' : null,
                              defaults.can_delete ? 'Delete' : null,
                            ]
                              .filter(Boolean)
                              .join(', ') || 'No Tasks/Notes Access';

                        return (
                          <tr
                            key={r.id}
                            className={`hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition ${
                              isAdminRole ? 'bg-slate-50/30 dark:bg-slate-800/20' : ''
                            }`}
                          >
                            {/* Role Name & Station Default Subtitle */}
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-1.5 font-medium text-slate-900 dark:text-white">
                                {isAdminRole ? (
                                  <Lock className="h-3.5 w-3.5 text-red-500 shrink-0" />
                                ) : (
                                  <Shield className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                )}
                                <span>{r.description || r.name || r.id}</span>
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-normal pl-5 mt-0.5">
                                Station default: <span className="font-medium text-slate-700 dark:text-slate-300">{defaultsSummary}</span>
                              </div>
                            </td>

                            {/* Station Role Default Badges */}
                            <td className="py-2.5 px-3">
                              {isAdminRole ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
                                  <ShieldCheck className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                                  Full Access
                                </span>
                              ) : (
                                <div className="flex flex-wrap gap-1 items-center">
                                  {defaults.can_view && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700">
                                      View
                                    </span>
                                  )}
                                  {defaults.can_edit && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700">
                                      Fill & Edit
                                    </span>
                                  )}
                                  {defaults.can_unsign && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700">
                                      Un-sign
                                    </span>
                                  )}
                                  {defaults.can_delete && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700">
                                      Delete
                                    </span>
                                  )}
                                  {!defaults.can_view && !defaults.can_edit && !defaults.can_unsign && !defaults.can_delete && (
                                    <span className="text-[11px] text-slate-400 italic">No access</span>
                                  )}
                                </div>
                              )}
                            </td>

                            {/* Template Override Status */}
                            <td className="py-2.5 px-3">
                              {isAdminRole ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900">
                                  Full Access
                                </span>
                              ) : overridden ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-900">
                                  Custom Override
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                  Station Default
                                </span>
                              )}
                            </td>

                            {/* View Checkbox */}
                            <td className="py-2.5 px-3 text-center">
                              <div className="inline-flex flex-col items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={Boolean(rolePerms.can_view)}
                                  disabled={!isInteractive}
                                  onChange={(e) => handleToggleRolePerm(r.id, 'can_view', e.target.checked)}
                                  title={
                                    isAdminRole
                                      ? 'Administrators always retain View access'
                                      : !isInteractive
                                      ? `Inherited from station default (${defaults.can_view ? 'Allowed' : 'Denied'})`
                                      : 'Toggle View access'
                                  }
                                  className={`rounded border-slate-300 text-red-600 focus:ring-red-500 dark:border-slate-600 dark:bg-slate-800 ${
                                    !isInteractive ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                                  }`}
                                />
                                <span
                                  className={`text-[9px] px-1 py-0.5 rounded font-medium border leading-none ${
                                    defaults.can_view
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                                      : 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                                  }`}
                                  title={`Station Role Default: ${defaults.can_view ? 'Allowed' : 'Denied'}`}
                                >
                                  Def: {defaults.can_view ? 'Yes' : 'No'}
                                </span>
                                {editingTemplate.custom_permissions_enabled && !isAdminRole && Boolean(rolePerms.can_view) !== Boolean(defaults.can_view) && (
                                  <span className="text-[8px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-tighter">
                                    Changed
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Fill & Edit Checkbox */}
                            <td className="py-2.5 px-3 text-center">
                              <div className="inline-flex flex-col items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={Boolean(rolePerms.can_edit)}
                                  disabled={!isInteractive || !rolePerms.can_view}
                                  onChange={(e) => handleToggleRolePerm(r.id, 'can_edit', e.target.checked)}
                                  title={
                                    isAdminRole
                                      ? 'Administrators always retain Fill & Edit access'
                                      : !isInteractive
                                      ? `Inherited from station default (${defaults.can_edit ? 'Allowed' : 'Denied'})`
                                      : !rolePerms.can_view
                                      ? 'Requires View permission'
                                      : 'Toggle Fill & Edit access'
                                  }
                                  className={`rounded border-slate-300 text-red-600 focus:ring-red-500 dark:border-slate-600 dark:bg-slate-800 ${
                                    !isInteractive || !rolePerms.can_view
                                      ? 'cursor-not-allowed opacity-40'
                                      : 'cursor-pointer'
                                  }`}
                                />
                                <span
                                  className={`text-[9px] px-1 py-0.5 rounded font-medium border leading-none ${
                                    defaults.can_edit
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                                      : 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                                  }`}
                                  title={`Station Role Default: ${defaults.can_edit ? 'Allowed' : 'Denied'}`}
                                >
                                  Def: {defaults.can_edit ? 'Yes' : 'No'}
                                </span>
                                {editingTemplate.custom_permissions_enabled && !isAdminRole && Boolean(rolePerms.can_edit) !== Boolean(defaults.can_edit) && (
                                  <span className="text-[8px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-tighter">
                                    Changed
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Un-sign Checkbox */}
                            <td className="py-2.5 px-3 text-center">
                              <div className="inline-flex flex-col items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={Boolean(rolePerms.can_unsign)}
                                  disabled={!isInteractive || !rolePerms.can_view}
                                  onChange={(e) => handleToggleRolePerm(r.id, 'can_unsign', e.target.checked)}
                                  title={
                                    isAdminRole
                                      ? 'Administrators always retain Un-sign access'
                                      : !isInteractive
                                      ? `Inherited from station default (${defaults.can_unsign ? 'Allowed' : 'Denied'})`
                                      : !rolePerms.can_view
                                      ? 'Requires View permission'
                                      : 'Toggle Un-sign access'
                                  }
                                  className={`rounded border-slate-300 text-red-600 focus:ring-red-500 dark:border-slate-600 dark:bg-slate-800 ${
                                    !isInteractive || !rolePerms.can_view
                                      ? 'cursor-not-allowed opacity-40'
                                      : 'cursor-pointer'
                                  }`}
                                />
                                <span
                                  className={`text-[9px] px-1 py-0.5 rounded font-medium border leading-none ${
                                    defaults.can_unsign
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                                      : 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                                  }`}
                                  title={`Station Role Default: ${defaults.can_unsign ? 'Allowed' : 'Denied'}`}
                                >
                                  Def: {defaults.can_unsign ? 'Yes' : 'No'}
                                </span>
                                {editingTemplate.custom_permissions_enabled && !isAdminRole && Boolean(rolePerms.can_unsign) !== Boolean(defaults.can_unsign) && (
                                  <span className="text-[8px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-tighter">
                                    Changed
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Delete Checkbox */}
                            <td className="py-2.5 px-3 text-center">
                              <div className="inline-flex flex-col items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={Boolean(rolePerms.can_delete)}
                                  disabled={!isInteractive || !rolePerms.can_view}
                                  onChange={(e) => handleToggleRolePerm(r.id, 'can_delete', e.target.checked)}
                                  title={
                                    isAdminRole
                                      ? 'Administrators always retain Delete access'
                                      : !isInteractive
                                      ? `Inherited from station default (${defaults.can_delete ? 'Allowed' : 'Denied'})`
                                      : !rolePerms.can_view
                                      ? 'Requires View permission'
                                      : 'Toggle Delete access'
                                  }
                                  className={`rounded border-slate-300 text-red-600 focus:ring-red-500 dark:border-slate-600 dark:bg-slate-800 ${
                                    !isInteractive || !rolePerms.can_view
                                      ? 'cursor-not-allowed opacity-40'
                                      : 'cursor-pointer'
                                  }`}
                                />
                                <span
                                  className={`text-[9px] px-1 py-0.5 rounded font-medium border leading-none ${
                                    defaults.can_delete
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                                      : 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                                  }`}
                                  title={`Station Role Default: ${defaults.can_delete ? 'Allowed' : 'Denied'}`}
                                >
                                  Def: {defaults.can_delete ? 'Yes' : 'No'}
                                </span>
                                {editingTemplate.custom_permissions_enabled && !isAdminRole && Boolean(rolePerms.can_delete) !== Boolean(defaults.can_delete) && (
                                  <span className="text-[8px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-tighter">
                                    Changed
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Reset Single Role Action */}
                            {editingTemplate.custom_permissions_enabled && (
                              <td className="py-2.5 px-3 text-right">
                                {overridden ? (
                                  <button
                                    type="button"
                                    onClick={() => handleResetSingleRole(r.id)}
                                    className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 transition"
                                    title="Reset this role to station default"
                                  >
                                    <RotateCcw className="h-3 w-3" />
                                    <span>Reset</span>
                                  </button>
                                ) : (
                                  <span className="text-[11px] text-slate-300 dark:text-slate-600">—</span>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-5 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 transition"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700 transition disabled:opacity-60"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>{editingTemplate.id ? 'Save Template' : 'Create Template'}</span>
              </button>
            </div>
          </form>
        </ViewportModal>
      )}

      {/* Delete Confirmation Modal */}
      {pendingDelete && (
        <ConfirmModal
          isOpen={Boolean(pendingDelete)}
          title="Delete Template"
          message={`Are you sure you want to delete "${pendingDelete.name}"? Existing logged entries will be preserved, but new entries will no longer be created with this template.`}
          confirmLabel="Delete"
          confirmVariant="danger"
          loading={saving}
          onConfirm={handleDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

