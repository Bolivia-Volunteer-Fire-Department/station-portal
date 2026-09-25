import React, { useMemo, useState } from 'react';
import { CalendarDays, CalendarRange, Users } from 'lucide-react';
import { MonthNav } from '../AvailabilityCalendar';
import RankIcon from '../RankIcon';
import { MONTHS } from '../../utils/calendarConstants';
import { displayDate, toDateKey } from '../../utils/scheduleDate';
import { templateTimeText, formatClockRange, shiftTimeLabel } from '../../utils/shiftTime';
import { availabilityRosterForMonth } from '../../utils/availability';
import { eventSegmentTimeLabel, eventSegmentTitle, eventSegmentsByDay, normalizeEventList } from '../../utils/events';

// "All Members" availability: every template occurrence in the month, with the members
// who marked themselves available for it.
//
// Rendered as a date-grouped list rather than a month grid on purpose. The question this
// view answers is "who can work this shift?", and one line per slot answers it far better
// than a seven-column cell crammed with names. Slots nobody has marked stay visible,
// because an uncovered shift is exactly what an administrator needs to spot; members who
// said nothing are simply absent, which is the point of the view.
//
// Each name carries its rank - the rank's colour and icon - so a glance down a shift shows
// who is senior enough to lead it without opening anything. Members with no rank (or a rank
// with no colour set) keep the plain chip, which also keeps a misconfigured ranks sheet
// visible rather than rendering everyone identically by accident.
export default function AdminAvailabilityRoster({
  scheduleTemplates = [],
  availability = [],
  users = [],
  assignments = [],
  ranks = [],
  timeFormat = '12',
  // Non-shift entries. Shown once per DATE rather than per shift: an event belongs to the day, and repeating
  // it down every slot would bury the names this view exists to show. No audience filter - this is an
  // administrator's view of the whole crew, so an event aimed at one rank still belongs here.
  events = [],
}) {
  const now = new Date();
  const [viewDate, setViewDate] = useState(
    () => new Date(now.getFullYear(), now.getMonth(), 1)
  );
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();

  const days = availabilityRosterForMonth({
    year,
    month,
    templates: scheduleTemplates,
    availability,
    users,
    assignments,
  });

  // The month's events, keyed by date. Normalised defensively so a raw sheet row cannot silently vanish.
  const eventsByDay = useMemo(
    () =>
      eventSegmentsByDay(
        normalizeEventList(events),
        toDateKey(new Date(year, month, 1)),
        toDateKey(new Date(year, month + 1, 0)),
        { ranks }
      ),
    [events, ranks, year, month]
  );
  const eventCount = days.reduce((sum, day) => sum + (eventsByDay.get(day.dateKey) || []).length, 0);

  const assignmentById = (id) =>
    assignments.find((a) => String(a?.id ?? '').trim() === String(id ?? '').trim()) || null;

  const rankById = (id) =>
    ranks.find((r) => String(r?.id ?? '').trim() === String(id ?? '').trim()) || null;

  const slotCount = days.reduce((sum, day) => sum + day.slots.length, 0);
  const markedCount = days.reduce(
    (sum, day) => sum + day.slots.reduce((n, slot) => n + slot.members.length, 0),
    0
  );
  const uncoveredCount = days.reduce(
    (sum, day) => sum + day.slots.filter((slot) => slot.members.length === 0).length,
    0
  );

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <MonthNav
        year={year}
        month={month}
        onPrev={() => setViewDate(new Date(year, month - 1, 1))}
        onNext={() => setViewDate(new Date(year, month + 1, 1))}
        onToday={() => setViewDate(new Date(now.getFullYear(), now.getMonth(), 1))}
        isCurrentMonth={isCurrentMonth}
      />

      <div className="px-4 py-3 space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-2">
            <Users className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            {markedCount} member{markedCount === 1 ? '' : 's'} marked available across {slotCount} shift
            {slotCount === 1 ? '' : 's'}
          </span>
          {uncoveredCount > 0 && (
            <span className="text-amber-600 dark:text-amber-400">
              {uncoveredCount} shift{uncoveredCount === 1 ? '' : 's'} with nobody available
            </span>
          )}
          {/* Counted here as well as shown per day: an event is often why fewer people are available. */}
          {eventCount > 0 && (
            <span className="flex items-center gap-2">
              <CalendarDays className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              {eventCount} event{eventCount === 1 ? '' : 's'} this month
            </span>
          )}
        </div>

        {days.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No shift templates are configured for {MONTHS[month]} {year}.
          </p>
        ) : (
          <div className="space-y-2">
            {days.map(({ dateKey, slots }) => (
              <div
                key={dateKey}
                className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden"
              >
                <div className="px-3 py-1.5 bg-slate-50 dark:bg-slate-900/60 text-xs font-semibold text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <CalendarRange className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  {displayDate(dateKey) || dateKey}
                  <span className="text-slate-400 dark:text-slate-500 font-normal">
                    · {slots.length} shift{slots.length === 1 ? '' : 's'}
                  </span>

                  {/* What else is happening that day. A colored dot rather than a filled chip keeps the date
                      readable when an event's color is pale, and keeps these visibly not-shift-shaped. */}
                  <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
                    {(eventsByDay.get(dateKey) || []).map((segment) => (
                      <span
                        key={`event-${segment.eventId}-${segment.dateKey}`}
                        title={`${eventSegmentTitle(segment)} · ${eventSegmentTimeLabel(segment, timeFormat)}`}
                        className="flex items-center gap-1.5 font-normal text-slate-600 dark:text-slate-300"
                      >
                        <span
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-black/10"
                          style={{ backgroundColor: segment.color }}
                        />
                        <span className="truncate max-w-[16rem]">{eventSegmentTitle(segment)}</span>
                        <span className="text-slate-400 dark:text-slate-500">
                          {eventSegmentTimeLabel(segment, timeFormat)}
                        </span>
                      </span>
                    ))}
                  </span>
                </div>

                <div className="divide-y divide-slate-200 dark:divide-slate-700/70">
                  {slots.map((slot) => {
                    const assignment = assignmentById(slot.assignmentId);
                    const timing = shiftTimeLabel(
                      slot.template,
                      formatClockRange(templateTimeText(slot.template), timeFormat)
                    );
                    const label = [assignment?.description || '', timing]
                      .filter(Boolean)
                      .join(' · ');

                    return (
                      <div
                        key={slot.key}
                        className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1"
                      >
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-200 min-w-[11rem]">
                          {label || 'Shift'}
                        </span>

                        {slot.members.length > 0 ? (
                          <span className="flex flex-wrap gap-1">
                            {slot.members.map((member) => {
                              const rank = rankById(member.rank_id);
                              const rankColor = String(rank?.color ?? '').trim();
                              return (
                                <span
                                  key={member.id}
                                  // Neutral chip when a rank supplies the colour, so the rank's
                                  // colour is what stands out; the plain emerald chip otherwise, so
                                  // an unranked member still reads as "available".
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium border ${
                                    rank
                                      ? 'bg-white text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700'
                                      : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70'
                                  }`}
                                  title={rank?.description ? `${member.name} — ${rank.description}` : member.name}
                                >
                                  {rank && (
                                    <RankIcon
                                      name={rank.icon}
                                      className="w-3 h-3 shrink-0"
                                      // Inline style, matching how ranks are coloured on the
                                      // dashboard's on-duty card.
                                      style={rankColor ? { color: rankColor } : undefined}
                                    />
                                  )}
                                  <span style={rankColor ? { color: rankColor } : undefined}>
                                    {member.name}
                                  </span>
                                </span>
                              );
                            })}
                          </span>
                        ) : (
                          <span className="text-[11px] italic text-slate-400 dark:text-slate-500">
                            No one available
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
