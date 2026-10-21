// Data types, validation, scheduling, and helpers for the Tasks & Notes module.
//
// Supports:
// 1. Shift Notes: chronological entries logged by crew during shifts.
// 2. Daily Tasks: station operations, recurring chore lists, and safety routines.
// 3. Apparatus Checklists: truck pre-trip inspections and daily fleet walk-arounds.
//
// All entries are built on the interactive form engine (FormBuilderCanvas layout).

import { permissionGranted } from './permissions.js';

export const TASK_NOTE_KINDS = {
  NOTE: 'note',
  TASK: 'task',
  APPARATUS_CHECKLIST: 'apparatus_checklist',
};

export const KIND_META = {
  [TASK_NOTE_KINDS.NOTE]: {
    id: TASK_NOTE_KINDS.NOTE,
    label: 'Shift Note',
    pluralLabel: 'Shift Notes',
    badgeClass: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800',
    dotClass: 'bg-purple-500',
  },
  [TASK_NOTE_KINDS.TASK]: {
    id: TASK_NOTE_KINDS.TASK,
    label: 'Daily Task',
    pluralLabel: 'Daily Tasks',
    badgeClass: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800',
    dotClass: 'bg-sky-500',
  },
  [TASK_NOTE_KINDS.APPARATUS_CHECKLIST]: {
    id: TASK_NOTE_KINDS.APPARATUS_CHECKLIST,
    label: 'Apparatus Checklist',
    pluralLabel: 'Apparatus Checklists',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800',
    dotClass: 'bg-emerald-500',
  },
};

export const TASK_NOTE_STATUS = {
  EDITABLE: 'editable',
  SIGNED: 'signed',
};

export const STATUS_META = {
  [TASK_NOTE_STATUS.EDITABLE]: {
    label: 'Editable',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
    dotClass: 'bg-amber-500',
  },
  [TASK_NOTE_STATUS.SIGNED]: {
    label: 'Signed',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800',
    dotClass: 'bg-emerald-500',
  },
};

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Returns date key YYYY-MM-DD N days before reference date.
 */
export const daysAgoDateKey = (referenceDate = new Date(), days = 14) => {
  const d = new Date(referenceDate);
  d.setDate(d.getDate() - days);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Returns true if a template is active on the given date (respects effective and end dates).
 */
export const isTemplateActiveOn = (template, dateKey) => {
  if (!template) return false;
  const effective = String(template.effective_date || '').slice(0, 10);
  const end = String(template.end_date || '').slice(0, 10);
  if (effective && dateKey < effective) return false;
  if (end && dateKey > end) return false;
  return true;
};

/**
 * Computes lifecycle status of a template: 'active' | 'retired' | 'upcoming'.
 */
export const getTemplateLifecycle = (template, todayKey) => {
  if (!template) return 'retired';
  const effective = String(template.effective_date || '').slice(0, 10);
  const end = String(template.end_date || '').slice(0, 10);
  if (end && todayKey > end) return 'retired';
  if (effective && todayKey < effective) return 'upcoming';
  return 'active';
};

/**
 * Checks whether a template is scheduled to run on the specified dateKey.
 */
export const isTemplateScheduledForDate = (template, dateKey) => {
  if (!template || !isTemplateActiveOn(template, dateKey)) return false;
  const scheduling = template.scheduling;
  if (!scheduling || !scheduling.enabled) return false;

  const freq = String(scheduling.frequency || 'daily').toLowerCase();
  if (freq === 'daily') return true;

  if (freq === 'weekly') {
    const d = new Date(`${dateKey}T12:00:00`);
    const dayName = WEEKDAY_NAMES[d.getDay()];
    const days = Array.isArray(scheduling.days_of_week)
      ? scheduling.days_of_week.map((w) => String(w).toLowerCase())
      : [];
    return days.includes(dayName);
  }

  if (freq === 'monthly') {
    const dayNum = parseInt(dateKey.slice(8, 10), 10);
    const targetDay = parseInt(scheduling.day_of_month || 1, 10);
    return dayNum === targetDay;
  }

  return false;
};

/**
 * Extracts default tasks & notes permissions for a given station role.
 */
export const getRoleDefaultTasksAndNotesPermissions = (role) => {
  if (!role) {
    return { can_view: false, can_edit: false, can_unsign: false, can_delete: false };
  }
  const isAdmin = Boolean(role.is_admin) || permissionGranted(role, 'is_admin');
  if (isAdmin) {
    return { can_view: true, can_edit: true, can_unsign: true, can_delete: true };
  }
  return {
    can_view: permissionGranted(role, 'can_view_tasks_and_notes') || Boolean(role.can_view_tasks_and_notes || role.canViewTasksAndNotes),
    can_edit: permissionGranted(role, 'can_edit_tasks_and_notes') || Boolean(role.can_edit_tasks_and_notes || role.canEditTasksAndNotes),
    can_unsign: permissionGranted(role, 'can_unsign_tasks_and_notes') || Boolean(role.can_unsign_tasks_and_notes || role.canUnsignTasksAndNotes),
    can_delete: permissionGranted(role, 'can_delete_tasks_and_notes') || Boolean(role.can_delete_tasks_and_notes || role.canDeleteTasksAndNotes),
  };
};

/**
 * Resolves effective user permissions for a specific task/note template.
 * Evaluates template-level custom overrides if enabled, falling back to role defaults.
 */
export const getTemplatePermissionsForUser = ({
  template,
  user,
  role,
  roles = [],
}) => {
  const isAdmin = Boolean(user?.is_admin || role?.is_admin || permissionGranted(role, 'is_admin'));
  if (isAdmin) {
    return {
      canView: true,
      canEdit: true,
      canUnsign: true,
      canDelete: true,
    };
  }

  const userRoleId = String(user?.role_id || role?.id || '').trim();
  const effectiveRole = role || (Array.isArray(roles) ? roles.find((r) => String(r.id) === userRoleId) : null);
  const roleDefaults = getRoleDefaultTasksAndNotesPermissions(effectiveRole);

  if (!template?.custom_permissions_enabled || !template?.role_permissions) {
    return {
      canView: roleDefaults.can_view,
      canEdit: roleDefaults.can_edit,
      canUnsign: roleDefaults.can_unsign,
      canDelete: roleDefaults.can_delete,
    };
  }

  const override = template.role_permissions[userRoleId];
  if (!override) {
    return {
      canView: roleDefaults.can_view,
      canEdit: roleDefaults.can_edit,
      canUnsign: roleDefaults.can_unsign,
      canDelete: roleDefaults.can_delete,
    };
  }

  return {
    canView: override.can_view !== undefined ? Boolean(override.can_view) : roleDefaults.can_view,
    canEdit: override.can_edit !== undefined ? Boolean(override.can_edit) : roleDefaults.can_edit,
    canUnsign: override.can_unsign !== undefined ? Boolean(override.can_unsign) : roleDefaults.can_unsign,
    canDelete: override.can_delete !== undefined ? Boolean(override.can_delete) : roleDefaults.can_delete,
  };
};

/**
 * Normalizes a task/note template object for storage and UI display.
 */
export const normalizeTaskNoteTemplate = (raw = {}) => {
  const id = String(raw.id || '').trim();
  const name = String(raw.name || raw.title || 'Untitled Template').trim();
  const kind = Object.values(TASK_NOTE_KINDS).includes(raw.kind)
    ? raw.kind
    : TASK_NOTE_KINDS.TASK;
  const description = String(raw.description || '').trim();
  const effectiveDate = String(raw.effective_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const endDate = raw.end_date ? String(raw.end_date).slice(0, 10) : '';
  const apparatusId = String(raw.apparatus_id || '').trim();

  const scheduling = raw.scheduling
    ? {
        enabled: Boolean(raw.scheduling.enabled),
        frequency: String(raw.scheduling.frequency || 'daily').toLowerCase(),
        days_of_week: Array.isArray(raw.scheduling.days_of_week)
          ? raw.scheduling.days_of_week.map((w) => String(w).toLowerCase())
          : [],
        day_of_month: Number(raw.scheduling.day_of_month) || 1,
        shift_type: String(raw.scheduling.shift_type || 'all').trim(),
      }
    : {
        enabled: false,
        frequency: 'daily',
        days_of_week: [],
        day_of_month: 1,
        shift_type: 'all',
      };

  return {
    id,
    name,
    kind,
    description,
    effective_date: effectiveDate,
    end_date: endDate,
    apparatus_id: apparatusId,
    scheduling,
    layout: Array.isArray(raw.layout) ? raw.layout : [],
    audience_all: raw.audience_all !== false,
    audience_role_ids: Array.isArray(raw.audience_role_ids) ? raw.audience_role_ids : [],
    audience_rank_ids: Array.isArray(raw.audience_rank_ids) ? raw.audience_rank_ids : [],
    custom_permissions_enabled: Boolean(raw.custom_permissions_enabled),
    role_permissions:
      typeof raw.role_permissions === 'object' && raw.role_permissions !== null
        ? raw.role_permissions
        : {},
    created_at: raw.created_at || new Date().toISOString(),
    updated_at: raw.updated_at || new Date().toISOString(),
    created_by_uid: String(raw.created_by_uid || ''),
  };
};

/**
 * Normalizes a log entry object for storage and UI display.
 */
export const normalizeTaskNoteEntry = (raw = {}) => {
  const id = String(raw.id || '').trim();
  const templateId = String(raw.template_id || '').trim();
  const templateName = String(raw.template_name || raw.title || 'Untitled Log').trim();
  const kind = Object.values(TASK_NOTE_KINDS).includes(raw.kind)
    ? raw.kind
    : TASK_NOTE_KINDS.TASK;
  const title = String(raw.title || templateName).trim();
  const entryDate = String(raw.entry_date || raw.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const entryTime = String(raw.entry_time || raw.time || new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })).trim();
  const apparatusId = String(raw.apparatus_id || '').trim();
  const apparatusIdentifier = String(raw.apparatus_identifier || '').trim();
  const submittedByUid = String(raw.submitted_by_uid || raw.author_id || '').trim();
  const submittedByName = String(raw.submitted_by_name || raw.author_name || 'Member').trim();
  const submittedByRank = String(raw.submitted_by_rank || '').trim();
  const status = raw.status === TASK_NOTE_STATUS.SIGNED ? TASK_NOTE_STATUS.SIGNED : TASK_NOTE_STATUS.EDITABLE;

  return {
    id,
    template_id: templateId,
    template_name: templateName,
    kind,
    title,
    entry_date: entryDate,
    entry_time: entryTime,
    apparatus_id: apparatusId,
    apparatus_identifier: apparatusIdentifier,
    submitted_by_uid: submittedByUid,
    submitted_by_name: submittedByName,
    submitted_by_rank: submittedByRank,
    status,
    signed_by_uid: String(raw.signed_by_uid || ''),
    signed_by_name: String(raw.signed_by_name || ''),
    signed_at: raw.signed_at || null,
    signature_data: raw.signature_data || null,
    data: typeof raw.data === 'object' && raw.data !== null ? raw.data : {},
    created_at: raw.created_at || new Date().toISOString(),
    updated_at: raw.updated_at || new Date().toISOString(),
  };
};

