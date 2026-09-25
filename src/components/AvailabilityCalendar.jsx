import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Eye, Loader2, Save } from 'lucide-react';
import { toDateKey, parseSheetDateKey } from '../utils/scheduleDate';
import { WEEKDAYS, MONTHS } from '../utils/calendarConstants';
import { templateTimeText, formatClockRange, shiftTimeLabel } from '../utils/shiftTime';
import {
  availabilityKey,
  availabilityRowsFor,
  availableSlotsForMonth,
  slotsByDay,
} from '../utils/availability';
import RankIcon from './RankIcon';
import EventPill from './EventPill';
import { eventSegmentsByDay, normalizeEventList } from '../utils/events';
import ViewToggle from './ViewToggle';

// Month navigation, shared by the member editor and the administrator's roster view so
// the two always move the same way.
export function MonthNav({ year, month, onPrev, onNext, onToday, isCurrentMonth }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
      <button
        type="button"
        onClick={onPrev}
        aria-label="Previous month"
        className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      <h3 className="flex-1 text-center text-base font-semibold text-slate-900 dark:text-white">
        {MONTHS[month]} {year}
      </h3>

      <button
        type="button"
        onClick={onNext}
        aria-label="Next month"
        className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700"
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      <button
        type="button"
        onClick={onToday}
        disabled={isCurrentMonth}
        className="ml-2 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-emerald-600 disabled:opacity-40"
      >
        Today
      </button>
    </div>
  );
}

// Month-at-a-time availability editor, modelled on the schedule calendar.
//
// It preloads every shift template occurrence the member could actually fill (same rank
// rule the schedule uses) and lets them mark each one available or not. There is no
// "show everyone" toggle here on purpose: this screen is about the member's own
// availability.
//
// Ticks are held locally and saved in ONE request. The draft stores the member's INTENT
// per slot rather than an optimistic copy of the server state, so a failed save keeps what
// they chose and the refetched `availability` stays the source of truth for every slot they
// did not touch. `onSave` receives only what actually changed.
export default function AvailabilityCalendar({
  member,
  availability = [],
  scheduleTemplates = [],
  assignments = [],
  ranks = [],
  onSave,
  timeFormat = '12',
  // Non-shift calendar entries, rendered above the slots and never mixed into them: an event is not a
  // shift and cannot be marked available for. See utils/events.
  events = [],
  eventAudience = {},
}) {
  const now = new Date();
  const [viewDate, setViewDate] = useState(
    () => new Date(now.getFullYear(), now.getMonth(), 1)
  );
  const [overrides, setOverrides] = useState(() => new Map());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  // Events are visible by default, and this is deliberately not persisted - it is a "get these off my
  // screen for a moment" control, exactly like "Show everyone".
  const [showEvents, setShowEvents] = useState(true);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const todayKey = toDateKey(now);
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();

  const slots = useMemo(
    () =>
      availableSlotsForMonth({
        year,
        month,
        templates: scheduleTemplates,
        assignments,
        ranks,
        member,
      }),
    [year, month, scheduleTemplates, assignments, ranks, member]
  );
  const byDay = useMemo(() => slotsByDay(slots), [slots]);
  const slotByKey = useMemo(() => new Map(slots.map((slot) => [slot.key, slot])), [slots]);

  // Events for the visible month, grouped by day. Normalised defensively so the calendar is correct
  // whichever caller hands it rows: the engine reads `isAllDay`/`startsAt`, and a raw sheet row would
  // silently produce no occurrences at all.
  const normalizedEvents = useMemo(() => normalizeEventList(events), [events]);
  const eventSegmentsByDate = useMemo(() => {
    if (!showEvents || !normalizedEvents.length) return new Map();
    // The window is the month itself, so this does not depend on the grid being built first.
    return eventSegmentsByDay(
      normalizedEvents,
      toDateKey(new Date(year, month, 1)),
      toDateKey(new Date(year, month + 1, 0)),
      { ...eventAudience, ranks }
    );
  }, [showEvents, normalizedEvents, eventAudience, ranks, year, month]);

  // What the server currently says, keyed exactly like the slots.
  const serverMarked = useMemo(() => {
    const keys = new Set();
    for (const row of availabilityRowsFor(availability, member?.id)) {
      const dateKey = parseSheetDateKey(row?.date_from);
      if (dateKey) keys.add(availabilityKey(row?.schedule_template_id, dateKey));
    }
    return keys;
  }, [availability, member]);

  // Switching member must never carry a draft across.
  useEffect(() => {
    setOverrides(new Map());
    setMessage(null);
  }, [member?.id]);

  const isMarked = (slot) =>
    overrides.has(slot.key) ? overrides.get(slot.key) : serverMarked.has(slot.key);
  const markedCount = slots.filter(isMarked).length;

  // Only the slots whose intent differs from the server travel.
  const adds = [];
  const removes = [];
  for (const [key, wanted] of overrides) {
    const slot = slotByKey.get(key);
    if (!slot) continue;
    if (wanted && !serverMarked.has(key)) adds.push(slot);
    else if (!wanted && serverMarked.has(key)) removes.push(slot);
  }
  const changeCount = adds.length + removes.length;
  const dirty = changeCount > 0;

  const toggleSlot = (slot) => {
    const serverValue = serverMarked.has(slot.key);
    const next = !isMarked(slot);
    setOverrides((prev) => {
      const map = new Map(prev);
      // Ticking back to the server's answer drops the override, so "unsaved changes"
      // can never count a no-op.
      if (next === serverValue) map.delete(slot.key);
      else map.set(slot.key, next);
      return map;
    });
    setMessage(null);
  };

  const handleSave = async () => {
    if (!dirty || !onSave) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await onSave({ adds, removes });
      if (!result?.success) throw new Error(result?.message || 'Failed to save availability.');
      setOverrides(new Map());
      setMessage(
        result.skipped
          ? {
              type: 'warn',
              text: `Saved, but ${result.skipped} shift(s) could not be marked — the template no longer exists.`,
            }
          : {
              type: 'ok',
              text: `Saved ${changeCount} change${changeCount === 1 ? '' : 's'}.`,
            }
      );
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Failed to save availability.' });
    } finally {
      setSaving(false);
    }
  };

  const assignmentById = (id) =>
    assignments.find((a) => String(a?.id ?? '').trim() === String(id ?? '').trim()) || null;

  const monthLabel = `${MONTHS[month]} ${year}`;

  // Leading blanks, one cell per day, trailing blanks - the grid the schedule calendar
  // builds, so the two months line up.
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);

  const goPrev = () => setViewDate(new Date(year, month - 1, 1));
  const goNext = () => setViewDate(new Date(year, month + 1, 1));
  const goToday = () => setViewDate(new Date(now.getFullYear(), now.getMonth(), 1));

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <MonthNav
        year={year}
        month={month}
        onPrev={goPrev}
        onNext={goNext}
        onToday={goToday}
        isCurrentMonth={isCurrentMonth}
      />

      {/* Events switch. Shown only when there is something to show, so a station that uses no events never
          sees a control for them. Not persisted: a temporary view choice. */}
      {normalizedEvents.length > 0 && (
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40 flex items-center">
          <ViewToggle
            noun="events"
            description="Include non-shift entries such as trainings. Your availability is not affected."
            icon={Eye}
            enabled={showEvents}
            onChange={setShowEvents}
          />
        </div>
      )}

      <div className="px-4 py-3 space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-sm bg-emerald-600 shrink-0" />
            Available
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-sm border border-dashed border-slate-400 dark:border-slate-500 shrink-0" />
            Not marked
          </span>
          <span className="ml-auto">
            {markedCount} of {slots.length} shift{slots.length === 1 ? '' : 's'} marked available
          </span>
        </div>

        {slots.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No shift templates match {member?.name ? `${member.name}'s` : 'your'} rank in {monthLabel}.
          </p>
        )}

        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEKDAYS.map((label) => (
            <div key={label} className="text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">
              {label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, index) => {
            if (!day) return <div key={`blank-${index}`} className="min-h-[76px]" />;
            const dateKey = toDateKey(day);
            const daySlots = byDay.get(dateKey) || [];
            const isToday = dateKey === todayKey;
            const past = dateKey < todayKey;

            return (
              <div
                key={dateKey}
                className={`min-h-[76px] rounded-lg flex flex-col items-stretch ${
                  past
                    ? 'bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700/40'
                    : daySlots.length
                      ? 'bg-emerald-50/40 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700'
                      : 'bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/40'
                }`}
              >
                <span
                  className={`text-[11px] leading-none px-1 pt-0.5 ${
                    isToday ? 'text-emerald-600 font-bold' : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {day.getDate()}
                </span>

                {/* Events above the slots: they are context for the day and must never look markable, so
                    they are plain divs rather than buttons and carry no availability state. */}
                {(eventSegmentsByDate.get(dateKey) || []).map((segment) => (
                  <EventPill
                    key={`event-${segment.eventId}-${segment.dateKey}`}
                    segment={segment}
                    timeFormat={timeFormat}
                    className="mx-0.5 mt-0.5"
                  />
                ))}

                {daySlots.map((slot) => {
                  const marked = isMarked(slot);
                  const assignment = assignmentById(slot.assignmentId);
                  const timing = shiftTimeLabel(
                    slot.template,
                    formatClockRange(templateTimeText(slot.template), timeFormat)
                  );
                  const label = [assignment?.description || '', timing].filter(Boolean).join(' · ');

                  return (
                    <button
                      key={slot.key}
                      type="button"
                      disabled={past}
                      onClick={() => toggleSlot(slot)}
                      title={`${label || 'Shift'} — ${
                        marked ? 'marked available' : 'not marked'
                      }${past ? ' (this date has passed)' : ` — click to ${marked ? 'remove' : 'mark'}`}`}
                      className={`mt-0.5 w-full overflow-hidden text-left px-1.5 py-0.5 rounded-md text-[10px] leading-tight font-semibold transition ${
                        marked
                          ? 'bg-emerald-600 text-white'
                          : 'border border-dashed bg-white/70 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400'
                      } ${
                        past ? 'opacity-40' : 'cursor-pointer hover:ring-1 hover:ring-emerald-400/70'
                      }`}
                    >
                      <span className="flex items-center gap-1">
                        {marked ? <Check className="w-2.5 h-2.5 shrink-0" /> : null}
                        {assignment?.icon && (
                          <RankIcon name={assignment.icon} className="w-2.5 h-2.5 shrink-0" />
                        )}
                        <span className="truncate">{label || 'Shift'}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Save row. The count is the number of slots whose intent differs from the server,
          so a tick that was undone does not count as a change. */}
      <div className="px-4 py-3 flex flex-wrap items-center gap-3 border-t border-slate-200 dark:border-slate-700">
        {dirty && (
          <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 rounded-full px-2.5 py-1">
            {changeCount} unsaved change{changeCount === 1 ? '' : 's'}
          </span>
        )}
        {message && (
          <span
            className={`text-xs font-medium ${
              message.type === 'error'
                ? 'text-red-600 dark:text-red-400'
                : message.type === 'warn'
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-emerald-700 dark:text-emerald-400'
            }`}
          >
            {message.text}
          </span>
        )}

        <div className="ml-auto flex items-center gap-3">
          {dirty && (
            <button
              type="button"
              onClick={() => {
                setOverrides(new Map());
                setMessage(null);
              }}
              disabled={saving}
              className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-40"
            >
              Discard
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm px-4 py-2.5 rounded-xl transition shadow-lg shadow-emerald-600/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save availability
          </button>
        </div>
      </div>
    </div>
  );
}
