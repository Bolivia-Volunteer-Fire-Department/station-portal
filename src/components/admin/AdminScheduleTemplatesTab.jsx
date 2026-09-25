import React, { useState } from 'react';
import { Save, Loader2, Pencil, Trash2, Plus, AlertCircle, X, CalendarRange } from 'lucide-react';
import { adminSaveScheduleTemplate, adminDeleteScheduleTemplate } from '../../services/api';
import { toTimeInputValue } from '../../utils/timeInputValue';
import { toDateKey } from '../../utils/scheduleDate';
import { templateNickname } from '../../utils/shiftTime';
import {
  templateDateError,
  templateDateKey,
  templateDateLabel,
  templateLifecycle,
  templateNeedsDate,
} from '../../utils/scheduleTemplates';
import { assignmentColor } from '../../utils/assignmentColor';
import { choosableAssignments } from '../../utils/assignmentDates';
import { MINUTES_PER_DAY, layoutWeekDayCards } from '../../utils/weekLayout';

const EMPTY_FORM = { id: '', day_of_week: '', start_time: '', end_time: '', assignment_id: '', nickname: '', effective_date: '', end_date: '' };

const DAYS = [
  { value: 'monday', label: 'Mon' },
  { value: 'tuesday', label: 'Tue' },
  { value: 'wednesday', label: 'Wed' },
  { value: 'thursday', label: 'Thu' },
  { value: 'friday', label: 'Fri' },
  { value: 'saturday', label: 'Sat' },
  { value: 'sunday', label: 'Sun' },
];

const DAY_NAMES = {
  monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday',
  thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
};

// Week calendar track: 24h tall at 24px per hour.
const TRACK_H = 576;
const DAY_KEYS = DAYS.map((d) => d.value);
const todayColumnIndex = () => (new Date().getDay() + 6) % 7; // Monday = 0
// Read once per render so every card on the grid is judged against the same day.
const todayKeyValue = toDateKey(new Date());

// Parses a sheet time value into minutes since midnight (null if unparseable)
const toMinuteOfDay = (value) => {
  const t = toTimeInputValue(value);
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  if (h === undefined || m === undefined) return null;
  return h * 60 + m;
};

const formatMinutes = (minutes) => {
  const m = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

// Render duration; end on/before start wraps past midnight (equal = 24h)
const durationMinutes = (startMin, endMin) => {
  if (startMin === null || endMin === null) return null;
  let d = endMin - startMin;
  if (d <= 0) d += MINUTES_PER_DAY;
  return d;
};

const cardFor = (template) => {
  const startMin = toMinuteOfDay(template.start_time);
  const endMin = toMinuteOfDay(template.end_time);
  return {
    template,
    startMin,
    durMin: durationMinutes(startMin, endMin),
    key: String(template.id ?? template.start_time ?? 'card'),
  };
};

export default function AdminScheduleTemplatesTab({ token, scheduleTemplates = [], assignments = [], onDataChanged, onRowSaved }) {
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [savingMoveId, setSavingMoveId] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [dragOverDay, setDragOverDay] = useState(null);
  const [error, setError] = useState(null);

  const isEditing = !!formData.id;
  const resetForm = () => setFormData(EMPTY_FORM);

  const assignmentLabel = (id) => {
    if (id === undefined || id === null || id === '') return '—';
    const found = assignments.find((a) => String(a.id) === String(id));
    return found?.description || `#${id}`;
  };

  const dayName = (value) => DAY_NAMES[String(value ?? '').trim().toLowerCase()] || 'Template';

  const handleEdit = (template) => {
    setError(null);
    setFormData({
      id: template.id,
      // Carried through the form so the backend can refuse a save built on a stale copy.
      row_version: template.row_version,
      day_of_week: String(template.day_of_week ?? '').trim().toLowerCase(),
      start_time: toTimeInputValue(template.start_time),
      end_time: toTimeInputValue(template.end_time),
      assignment_id: String(template.assignment_id ?? ''),
      nickname: String(template.nickname ?? ''),
      // An <input type="date"> takes yyyy-MM-dd, so the sheet's date cell is normalized here just as
      // the comparison does - a template edited and re-saved must not shift by a day.
      effective_date: templateDateKey(template.effective_date),
      end_date: templateDateKey(template.end_date),
    });
  };

  const startAdd = (day) => {
    setError(null);
    resetForm();
    setFormData({ ...EMPTY_FORM, day_of_week: day });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // The same rule the backend enforces, checked here so a bad pair is caught before a round trip.
      const dateError = templateDateError(formData.effective_date, formData.end_date);
      if (dateError) throw new Error(dateError);
      const result = await adminSaveScheduleTemplate(formData, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to save schedule template.');
      // Straight onto the week grid; the refresh wave lands on its own time.
      onRowSaved?.('scheduleTemplates', formData);
      void onDataChanged();
      resetForm();
    } catch (err) {
      setError(err.message || 'Failed to save schedule template.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (template) => {
    if (!window.confirm(`Delete the ${dayName(template.day_of_week).toLowerCase()} template "${assignmentLabel(template.assignment_id)}"? This cannot be undone.`)) return;
    setDeletingId(template.id);
    setError(null);
    try {
      const result = await adminDeleteScheduleTemplate(template.id, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to delete schedule template.');
      void onDataChanged();
      if (String(formData.id) === String(template.id)) resetForm();
    } catch (err) {
      setError(err.message || 'Failed to delete schedule template.');
    } finally {
      setDeletingId(null);
    }
  };

  // Lay out each day's templates into side-by-side columns so overlapping (or
  // identically timed) cards never hide each other (see utils/weekLayout).
  const dayLayouts = DAYS.map((day) => {
    const cards = scheduleTemplates
      .map(cardFor)
      .filter(
        (c) =>
          c.startMin !== null &&
          c.durMin !== null &&
          c.durMin > 0 &&
          String(c.template.day_of_week ?? '').trim().toLowerCase() === day.value
      )
      .sort((a, b) => a.startMin - b.startMin || b.durMin - a.durMin);

    return { day, cards, segments: layoutWeekDayCards(cards) };
  });

  // Distinct assignments referenced by the templates, shown in the color legend
  const legendAssignments = [];
  for (const t of scheduleTemplates) {
    const id = t.assignment_id;
    if (id === undefined || id === null || id === '') continue;
    if (legendAssignments.some((a) => String(a.id) === String(id))) continue;
    const found = assignments.find((a) => String(a.id) === String(id));
    legendAssignments.push({ id, description: found?.description || `#${id}` });
  }

  const handleDragStart = (e, template) => {
    if (savingMoveId || deletingId) {
      e.preventDefault();
      return;
    }
    setDragId(template.id);
    e.dataTransfer?.setData('text/plain', String(template.id));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDragId(null);
    setDragOverDay(null);
  };

  // Drops a dragged template onto a day track. The drop's vertical position
  // sets the new start time (snapped to 15 min); duration is preserved.
  const handleDrop = async (e, dayValue) => {
    e.preventDefault();
    setDragOverDay(null);
    if (savingMoveId) return;

    let templateId = dragId;
    if (!templateId) {
      try {
        templateId = e.dataTransfer?.getData('text/plain') || null;
      } catch {
        templateId = null;
      }
    }
    const template = scheduleTemplates.find((t) => String(t.id) === String(templateId));
    if (!template) {
      setDragId(null);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientY - rect.top) / TRACK_H));
    const newStartMin = Math.min(1439, Math.round((ratio * MINUTES_PER_DAY) / 15) * 15);
    const startMin = toMinuteOfDay(template.start_time);
    const durMin = durationMinutes(startMin, toMinuteOfDay(template.end_time)) ?? 480;
    const newEndMin = (newStartMin + durMin) % MINUTES_PER_DAY;

    setDragId(null);
    setSavingMoveId(template.id);
    setError(null);
    try {
      const result = await adminSaveScheduleTemplate(
        {
          id: template.id,
          // A drag is a save like any other, so it carries the version the card was drawn from.
          row_version: template.row_version,
          day_of_week: dayValue,
          start_time: formatMinutes(newStartMin),
          end_time: formatMinutes(newEndMin),
          assignment_id: template.assignment_id,
          apparatus_id: template.apparatus_id ?? '',
        },
        token
      );
      if (!result?.success) throw new Error(result?.message || 'Failed to move template.');
      // A drag is a save too: the card moves under the cursor rather than after the wave.
      onRowSaved?.('scheduleTemplates', {
        id: template.id,
        day_of_week: dayValue,
        start_time: formatMinutes(newStartMin),
        end_time: formatMinutes(newEndMin),
      });
      void onDataChanged();
    } catch (err) {
      setError(err.message || 'Failed to move template.');
    } finally {
      setSavingMoveId(null);
    }
  };

  return (
    <div className="space-y-6">
{/* Add / Edit Schedule Template Card */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
              {isEditing ? `Edit Schedule Template #${formData.id}` : 'Add New Schedule Template'}
            </h3>
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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Day of Week</label>
              <select
                required
                value={formData.day_of_week}
                onChange={(e) => setFormData({ ...formData, day_of_week: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="">-- Select Day --</option>
                {DAYS.map((d) => (
                  <option key={d.value} value={d.value}>{DAY_NAMES[d.value]}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Start Time</label>
              <input
                type="time"
                required
                value={formData.start_time}
                onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">End Time</label>
              <input
                type="time"
                required
                value={formData.end_time}
                onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            {/* Optional window. Both blank keeps the template running indefinitely, which is how every
                template behaved before these columns existed. */}
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                Effective Date <span className="font-normal text-slate-400">(required)</span>
              </label>
              <input
                type="date"
                required
                value={formData.effective_date}
                onChange={(e) => setFormData({ ...formData, effective_date: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                The first date this pattern runs.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                End Date <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <input
                type="date"
                value={formData.end_date}
                onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Blank means it is still running.
              </p>
            </div>

            <div className="md:col-span-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
              A template stops producing shifts outside its window. Use it to start a new pattern on a
              date, or to retire an old one without deleting it, so the schedule history stays intact.
              Both dates are inclusive.
            </div>

            <div className="md:col-span-3">
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Assignment</label>
              <select
                required
                value={formData.assignment_id}
                onChange={(e) => setFormData({ ...formData, assignment_id: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="">-- Select Assignment --</option>
                {/* Underlying list excludes assignments outside their own window, while always keeping the
                    one already on this template (see utils/assignmentDates). */}
                {choosableAssignments(assignments, todayKeyValue, formData.assignment_id).map((a) => (
                  <option key={String(a.id)} value={String(a.id)}>{a.description}</option>
                ))}
              </select>
              {assignments.length === 0 && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                  No assignments found — add them under Scheduling → Assignments first.
                </p>
              )}
            </div>

            <div className="md:col-span-3">
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Nickname (optional)</label>
              <input
                type="text"
                value={formData.nickname}
                onChange={(e) => setFormData({ ...formData, nickname: e.target.value })}
                placeholder="e.g. Day Shift"
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                Shown on the schedules in place of the times wherever this shift appears. Leave it blank to
                keep showing the times — custom shifts, which have no template, always show theirs.
              </p>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : isEditing ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {isEditing ? 'Save Changes' : 'Add Template'}
            </button>
          </div>
        </form>
      </div>
{/* Visual week calendar */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <CalendarRange className="w-4 h-4 text-red-500" /> Weekly Schedule Templates
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Drag a shift to move it to another day — the drop position sets its start time (15-min steps). Click a shift to edit its details. Overlapping shifts sit side by side so nothing is hidden.
          </p>

          {legendAssignments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2 items-center">
              {legendAssignments.map((a) => (
                <span key={String(a.id)} className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-[3px] border border-black/10 dark:border-white/20" style={{ backgroundColor: assignmentColor(a.id, assignments) }} />
                  {a.description}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-3 space-y-3">
          {/* Day headers with counts */}
          <div className="grid grid-cols-7">
            {dayLayouts.map(({ day, cards }) => {
              const isToday = DAY_KEYS.indexOf(day.value) === todayColumnIndex();
              return (
                <div key={day.value} className={`text-center text-[11px] font-semibold uppercase py-1 truncate ${isToday ? 'text-red-600' : 'text-slate-600 dark:text-slate-300'}`}>
                  {day.label}
                  <span className="text-slate-400 dark:text-slate-500"> · {cards.length}</span>
                </div>
              );
            })}
          </div>

          {/* 24h week grid */}
          <div className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700" style={{ height: TRACK_H }}>
            {/* Hour lines */}
            {Array.from({ length: 25 }, (_, h) => (
              <div
                key={h}
                className={`absolute inset-x-0 ${h % 6 === 0 ? 'border-t border-slate-300 dark:border-slate-600' : 'border-t border-slate-100 dark:border-slate-800'}`}
                style={{ top: `${(h / 24) * 100}%` }}
              />
            ))}

            <div className="absolute inset-0 grid grid-cols-[3rem_1fr_1fr_1fr_1fr_1fr_1fr_1fr]">
              {/* Hour gutter */}
              <div className="relative h-full overflow-hidden">
                {[0, 6, 12, 18, 24].map((h) => (
                  <span
                    key={h}
                    className="absolute right-1 -translate-y-1/2 font-mono text-[10px] leading-none text-slate-400 dark:text-slate-500"
                    style={{ top: `${(h / 24) * 100}%` }}
                  >
                    {String(h).padStart(2, '0')}
                  </span>
                ))}
              </div>
{/* Day tracks */}
              {dayLayouts.map(({ day, segments }, dayIdx) => (
                <div
                  key={day.value}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                    setDragOverDay(day.value);
                  }}
                  onDrop={(e) => handleDrop(e, day.value)}
                  className={`relative h-full overflow-hidden ${dayIdx === 0 ? '' : 'border-l border-slate-200 dark:border-slate-700'} ${
                    dragOverDay === day.value ? 'bg-red-50/40 dark:bg-red-950/40 ring-2 ring-red-400' : ''
                  }`}
                >
                  {segments.map((s) => {
                    const top = (s.start / MINUTES_PER_DAY) * TRACK_H;
                    const height = Math.max(16, ((s.end - s.start) / MINUTES_PER_DAY) * TRACK_H);
                    const lanePct = 100 / s.laneCount;
                    const isMoving = String(s.c.template.id) === String(savingMoveId);
                    const isDragging = String(s.c.template.id) === String(dragId);
                    const showLabel = height >= 36;
                    const color = assignmentColor(s.c.template.assignment_id, assignments);
                    const timeLabel =
                      s.c.durMin >= MINUTES_PER_DAY
                        ? '24h'
                        : `${formatMinutes(s.c.startMin)}–${formatMinutes(s.c.startMin + s.c.durMin)}`;
                    return (
                      <div
                        key={s.c.key + (s.isTail ? '-tail' : '')}
                        draggable={!savingMoveId && !deletingId}
                        onDragStart={(e) => handleDragStart(e, s.c.template)}
                        onDragEnd={handleDragEnd}
                        onClick={() => handleEdit(s.c.template)}
                        title={[
                          assignmentLabel(s.c.template.assignment_id),
                          templateDateLabel(s.c.template),
                          templateLifecycle(s.c.template, todayKeyValue) === 'retired' ? 'Retired' : '',
                          templateLifecycle(s.c.template, todayKeyValue) === 'scheduled' ? 'Not yet effective' : '',
                        ].filter(Boolean).join(' · ')}
                        className={`group absolute text-white cursor-grab active:cursor-grabbing select-none flex flex-col rounded-md shadow-md shadow-black/20 transition-opacity ${
                          isDragging ? 'opacity-40' : ''
                        } ${s.isTail ? 'ring-1 ring-white/40' : ''} ${
                          templateLifecycle(s.c.template, todayKeyValue) === 'retired' ? 'opacity-40' : ''
                        } ${
                          templateLifecycle(s.c.template, todayKeyValue) === 'scheduled' ? 'ring-2 ring-dashed ring-white/70' : ''
                        }`}
                        style={{ top, height, left: `calc(${s.lane * lanePct}% + 2px)`, width: `calc(${lanePct}% - 4px)`, backgroundColor: color, zIndex: 10 }}
                      >
                        <div className="px-1.5 leading-tight font-mono text-[10px] truncate">
                          {s.isTail ? `↻ ${timeLabel}` : isMoving ? 'Moving…' : timeLabel}
                        </div>
                        {showLabel && templateNickname(s.c.template) && (
                          <div className="px-1.5 truncate text-[10px] font-semibold leading-tight mt-0.5">
                            {s.isTail ? '↻ ' : ''}{templateNickname(s.c.template)}
                          </div>
                        )}
                        {showLabel && (
                          <div className="px-1.5 truncate text-[10px] font-semibold leading-tight mt-0.5">
                            {s.isTail ? '↻ ' : ''}{assignmentLabel(s.c.template.assignment_id)}
                          </div>
                        )}
                        {/* The window, so a retired or not-yet-effective template is identifiable on the
                            grid without opening it. The grid keeps drawing it either way - this is the
                            editor, and the point of the dates is to retire a template WITHOUT deleting it. */}
                        {showLabel && templateDateLabel(s.c.template) && (
                          <div className="px-1.5 truncate text-[9px] leading-tight mt-0.5 text-white/80">
                            {templateDateLabel(s.c.template)}
                          </div>
                        )}
                        {/* A template created before the effective date became required still has a blank
                            cell, which keeps working - so it is nudged here rather than silently left. */}
                        {showLabel && templateNeedsDate(s.c.template) && (
                          <div className="px-1.5 truncate text-[9px] leading-tight mt-0.5 font-semibold text-amber-100">
                            ⚠ No start date
                          </div>
                        )}

                        {!s.isTail && (
                          <div className="pointer-events-none group-hover:pointer-events-auto absolute top-0 right-0 opacity-0 group-hover:opacity-100 flex gap-0.5">
                            <button
                              type="button"
                              draggable={false}
                              onClick={(e) => { e.stopPropagation(); handleEdit(s.c.template); }}
                              className="p-0.5 rounded bg-black/30 text-white hover:bg-red-700"
                              title="Edit"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              draggable={false}
                              disabled={deletingId === s.c.template.id}
                              onClick={(e) => { e.stopPropagation(); handleDelete(s.c.template); }}
                              className="p-0.5 rounded bg-black/30 text-white hover:bg-red-700 disabled:opacity-50"
                              title="Delete"
                            >
                              {deletingId === s.c.template.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
{/* Per-day add buttons */}
          <div className="grid grid-cols-7">
            {DAYS.map((day) => (
              <button
                key={day.value}
                type="button"
                onClick={() => startAdd(day.value)}
                className="flex items-center justify-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-red-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 py-1.5 transition"
              >
                <Plus className="w-3 h-3" />
                Add
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}