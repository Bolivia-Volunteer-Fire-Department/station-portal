// Effective and end dates for assignments.
//
// The assignments sheet gained the same two columns as schedule_templates, for the same reason: to start a
// new assignment on a date and retire an old one on a date, instead of deleting it and losing the record of
// what the station used to run.
//
// The rule lives in utils/effectiveDates (shared with templates); these are the assignment-facing spellings.
//
// What a retired assignment does, and deliberately does NOT do:
//
//   * It is excluded from the places an administrator CHOOSES an assignment - the Add Shift picker and the
//     Schedule Templates form - so no new work can be created against it.
//   * It stops producing shifts through its own templates, the same way a retired template does.
//   * It does NOT stop existing scheduled shifts from being drawn. A row on the schedule sheet is a real
//     shift that was worked or is planned, and hiding it would strand the people on it and any offers
//     against it. The pill keeps its assignment's color, icon and name.

import {
  dateKeyText,
  dateLifecycle,
  dateWindow,
  dateWindowError,
  dateWindowLabel,
  effectiveDateKey,
  isActiveOnDate,
  needsEffectiveDate,
} from './effectiveDates';

// A sheet date cell as a yyyy-MM-dd key, or '' when it is blank or unreadable.
export const assignmentDateKey = effectiveDateKey;

// The effective window, with blanks left open.
export const assignmentDateRange = dateWindow;

// Whether an assignment is in force on a date. Both ends are inclusive.
export const assignmentIsActiveOn = isActiveOnDate;

// 'scheduled' | 'active' | 'retired', for badges and warnings.
export const assignmentLifecycle = dateLifecycle;

// A short label for the window, or '' when the assignment has neither date.
export const assignmentDateLabel = dateWindowLabel;

// A single date as "Jul 1, 2026", for a date shown on its own.
export const assignmentDateText = dateKeyText;

// Whether a pair of dates makes sense. Shared with the backend's own check.
//
// The effective date is REQUIRED: an assignment must say when it came into use. Enforced on save only -
// see dateWindowError for why records that already exist with a blank cell must keep working.
export const assignmentDateError = (effectiveDate, endDate) =>
  dateWindowError(effectiveDate, endDate, { requireFrom: true });

// Whether an assignment already in the sheet predates that rule and still has no effective date.
export const assignmentNeedsDate = needsEffectiveDate;

// The assignments an administrator may CHOOSE on a date: the ones in force then.
//
// `keepId` is the assignment already on the record being edited, which is always included even when it has
// been retired - otherwise editing an old template would silently rewrite it onto whatever assignment
// happened to be first in the list, or refuse to save the value it already had.
export const choosableAssignments = (assignments, dateKey, keepId = null) => {
  const keep = String(keepId ?? '').trim();
  return (Array.isArray(assignments) ? assignments : []).filter(
    (assignment) =>
      assignment &&
      (String(assignment.id ?? '').trim() === keep || assignmentIsActiveOn(assignment, dateKey))
  );
};

// How many templates would stop producing shifts if an assignment ended on a date, for the warning shown in
// the assignments form. Counted over templates that currently overlap the window, so an already-retired
// template is not blamed on the new date.
export const templatesAffectedByEndDate = (assignmentId, templates, dateKey) => {
  const id = String(assignmentId ?? '').trim();
  if (!id) return 0;
  return (Array.isArray(templates) ? templates : []).filter(
    (template) => String(template?.assignment_id ?? '').trim() === id
  ).length;
};
