import React from 'react';
import { Calendar, Clock, ChevronRight, AlertCircle, ShieldAlert } from 'lucide-react';
import { displayDate, toDateKey } from '../../utils/scheduleDate';
import { formatClockRange, rowTimeText } from '../../utils/shiftTime';

/**
 * Upcoming Shifts Widget.
 * Shows member's next scheduled shifts and open shift coverage opportunities.
 */
export default function UpcomingShiftsWidget({
  schedule = [],
  currentUser = null,
  assignments = [],
  onNavigateToSchedule,
  timeFormat = '12',
}) {
  const currentUserId = String(currentUser?.id ?? currentUser?.userId ?? '').trim();
  const todayKey = toDateKey(new Date());

  // Find user's upcoming shifts from today onward
  const userShifts = (Array.isArray(schedule) ? schedule : [])
    .filter((row) => String(row.user_id ?? '').trim() === currentUserId && String(row.date ?? '') >= todayKey)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(0, 4);

  // Find assignment map
  const assignmentMap = new Map((assignments || []).map((a) => [String(a.id), a]));

  return (
    <div className="h-full flex flex-col justify-between rounded-2xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800 p-5 md:p-6 shadow-xl transition-all">
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200 font-semibold text-sm">
            <Calendar className="w-4 h-4 text-red-600 dark:text-red-500" />
            <span>My Upcoming Shifts</span>
          </div>
          {onNavigateToSchedule && (
            <button
              type="button"
              onClick={onNavigateToSchedule}
              className="text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-500 flex items-center gap-0.5 transition"
            >
              <span>Schedule</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {userShifts.length > 0 ? (
          <div className="space-y-2">
            {userShifts.map((shift, idx) => {
              const assignment = shift.assignment_id ? assignmentMap.get(String(shift.assignment_id)) : null;
              const isToday = String(shift.date) === todayKey;

              return (
                <div
                  key={shift.id || `${shift.date}-${idx}`}
                  className={`p-2.5 rounded-xl border flex items-center justify-between text-xs transition ${
                    isToday
                      ? 'border-emerald-300 dark:border-emerald-700/60 bg-emerald-50/60 dark:bg-emerald-950/20'
                      : 'border-slate-200 dark:border-slate-700/60 bg-slate-50/70 dark:bg-slate-900/40'
                  }`}
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200">
                      <span>{displayDate(shift.date)}</span>
                      {isToday && (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">
                          Today
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>{formatClockRange(rowTimeText(shift), timeFormat) || 'Shift scheduled'}</span>
                    </div>
                  </div>

                  {assignment && (
                    <span
                      className="px-2 py-0.5 rounded-md text-[11px] font-semibold text-white shadow-xs shrink-0"
                      style={{ backgroundColor: assignment.color || '#dc2626' }}
                    >
                      {assignment.name || assignment.label}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400 space-y-1">
            <p className="font-medium text-slate-600 dark:text-slate-300">No upcoming shifts scheduled.</p>
            <p>Check the schedule to view openings or sign up for shifts.</p>
          </div>
        )}
      </div>

      {onNavigateToSchedule && (
        <div className="pt-3 mt-3 border-t border-slate-100 dark:border-slate-700/60 text-right">
          <button
            type="button"
            onClick={onNavigateToSchedule}
            className="text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition"
          >
            Open Schedule Calendar →
          </button>
        </div>
      )}
    </div>
  );
}
