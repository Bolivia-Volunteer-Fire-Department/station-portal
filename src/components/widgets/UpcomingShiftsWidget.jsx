import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, Clock, ChevronRight, Loader2 } from 'lucide-react';
import { displayDate, parseSheetDateKey, stationTodayKey } from '../../utils/scheduleDate';
import { monthKeyFor, scheduleWindowFor, windowCoversMonth } from '../../utils/scheduleWindow';
import { formatClockRange, rowTimeText, templateTimeText } from '../../utils/shiftTime';
import { assignmentColor } from '../../utils/assignmentColor';

/**
 * Upcoming Shifts Widget.
 * Shows member's next scheduled shifts and duty assignments.
 */
export default function UpcomingShiftsWidget({
  schedule = [],
  scheduleWindow = null,
  onNeedSchedule = null,
  scheduleTemplates = [],
  currentUser = null,
  assignments = [],
  onNavigateToSchedule,
  timeFormat = '12',
}) {
  const [loadingSchedule, setLoadingSchedule] = useState(false);

  // If the schedule window does not yet cover the current month, ask for it
  useEffect(() => {
    if (!onNeedSchedule) return;
    const currentMonthKey = monthKeyFor(new Date());
    if (!windowCoversMonth(scheduleWindow, currentMonthKey)) {
      const win = scheduleWindowFor(new Date());
      setLoadingSchedule(true);
      Promise.resolve(onNeedSchedule(win.from, win.to)).finally(() => {
        setLoadingSchedule(false);
      });
    }
  }, [onNeedSchedule, scheduleWindow]);

  const currentUserId = String(currentUser?.id ?? currentUser?.userId ?? '').trim();
  const todayKey = stationTodayKey();

  const templateMap = useMemo(
    () => new Map((scheduleTemplates || []).map((t) => [String(t.id), t])),
    [scheduleTemplates]
  );
  const assignmentMap = useMemo(
    () => new Map((assignments || []).map((a) => [String(a.id), a])),
    [assignments]
  );

  // Find user's upcoming shifts from today onward
  const userShifts = useMemo(() => {
    if (!currentUserId || !Array.isArray(schedule)) return [];
    return schedule
      .map((row) => {
        const from = parseSheetDateKey(row.date_from || row.date || row._from) || '';
        const to = parseSheetDateKey(row.date_to || row.date_from || row.date || row._from) || from;
        return { ...row, _fromDateKey: from, _toDateKey: to };
      })
      .filter((row) => {
        if (String(row.user_id ?? row.userId ?? '').trim() !== currentUserId) return false;
        if (!row._fromDateKey) return false;
        // Keep shifts that either end today or in the future
        return row._toDateKey >= todayKey || row._fromDateKey >= todayKey;
      })
      .sort((a, b) => {
        if (a._fromDateKey !== b._fromDateKey) {
          return a._fromDateKey.localeCompare(b._fromDateKey);
        }
        return a._toDateKey.localeCompare(b._toDateKey);
      })
      .slice(0, 10);
  }, [schedule, currentUserId, todayKey]);

  return (
    <div className="h-full max-h-[500px] flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-xl transition-all">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700/60 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 flex items-center justify-center font-bold shrink-0">
            <Calendar className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              My Upcoming Shifts
            </h3>
            <p className="text-[11px] text-slate-400">
              Your scheduled duty assignments
            </p>
          </div>
        </div>

        <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-bold rounded-full bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300">
          {userShifts.length}
        </span>
      </div>

      {/* Content */}
      <div className="overflow-y-auto min-h-0 flex-1 pr-1">
        {loadingSchedule && userShifts.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin text-red-600" />
            <span className="ml-2 text-xs">Loading schedule...</span>
          </div>
        ) : userShifts.length > 0 ? (
          <div className="space-y-2">
            {userShifts.map((shift, idx) => {
              const template = shift.schedule_template_id
                ? templateMap.get(String(shift.schedule_template_id))
                : null;
              const assignmentId = String(
                shift.assignment_id || template?.assignment_id || ''
              ).trim();
              const assignment = assignmentId ? assignmentMap.get(assignmentId) : null;
              const isToday =
                shift._fromDateKey <= todayKey && todayKey <= shift._toDateKey;

              const dateLabel =
                shift._fromDateKey === shift._toDateKey
                  ? displayDate(shift._fromDateKey)
                  : `${displayDate(shift._fromDateKey)} – ${displayDate(shift._toDateKey)}`;

              const rawTimeRange =
                rowTimeText(shift) || (template ? templateTimeText(template) : '');
              const formattedTimes = formatClockRange(rawTimeRange, timeFormat);
              const shiftDisplayTime =
                formattedTimes || (template?.nickname ? template.nickname : 'Shift scheduled');

              const assignmentName =
                assignment?.description ||
                assignment?.name ||
                assignment?.label ||
                '';
              const apparatusName = String(
                shift.apparatus_id || template?.apparatus_id || ''
              ).trim();

              const badgeText = assignmentName
                ? apparatusName
                  ? `${assignmentName} (${apparatusName})`
                  : assignmentName
                : apparatusName || 'Scheduled';

              const badgeColor = assignmentId
                ? assignmentColor(assignmentId, assignments)
                : (assignment?.color || '#dc2626');

              return (
                <div
                  key={shift.id || `${shift._fromDateKey}-${idx}`}
                  className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs transition ${
                    isToday
                      ? 'border-emerald-300 dark:border-emerald-700/60 bg-emerald-50/60 dark:bg-emerald-950/20'
                      : 'border-slate-200 dark:border-slate-700/60 bg-slate-50/70 dark:bg-slate-900/40'
                  }`}
                >
                  <div className="space-y-0.5 min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200">
                      <span className="truncate">{dateLabel}</span>
                      {isToday && (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300 shrink-0">
                          Today
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400 font-mono text-[11px] truncate">
                      <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                      <span className="truncate">{shiftDisplayTime}</span>
                      {template?.nickname && formattedTimes && (
                        <span className="text-slate-400 dark:text-slate-500 font-sans font-medium text-[10px] shrink-0">
                          ({template.nickname})
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center shrink-0 ml-2">
                    <span
                      className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold text-white shadow-xs max-w-[160px] truncate"
                      style={{ backgroundColor: badgeColor }}
                      title={badgeText}
                    >
                      {badgeText}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400 space-y-1">
            <Calendar className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-1 opacity-70" />
            <p className="font-semibold text-slate-700 dark:text-slate-300">No upcoming shifts scheduled.</p>
            <p className="text-[11px]">Check the schedule to view openings or sign up for shifts.</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 pt-3 mt-3 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-xs">
        <span className="text-[11px] text-slate-400">
          {userShifts.length} shift{userShifts.length === 1 ? '' : 's'} scheduled
        </span>
        {onNavigateToSchedule && (
          <button
            type="button"
            onClick={onNavigateToSchedule}
            className="text-xs font-semibold text-red-600 dark:text-red-400 hover:text-red-500 flex items-center gap-0.5 transition"
          >
            <span>Schedule Calendar</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
