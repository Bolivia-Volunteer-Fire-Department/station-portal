import React, { useMemo, useState } from 'react';
import ClockHistoryTable from './clock/ClockHistoryTable';
import { Clock, CheckCircle2, ArrowUpDown, FilterX, History } from 'lucide-react';
import {
  CLOCK_LOG_SORT_OPTIONS,
  CLOCK_LOG_STATUS_OPTIONS,
  clockLogTotals,
  emptyClockLogFilters,
  filterAndSortClockLogs,
  formatClockHours,
  hasClockLogFilters,
} from '../utils/clockLogs';
import { clockRoundingMinutes } from '../utils/clockRounding';

const SELECT_CLASS =
  'w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500';

const LABEL_CLASS = 'block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1.5';

export default function MyClockHistory({ currentUser, logs = [], timeFormat, shifts = [], systemSettings = [], loadedFrom = '', onLoadOlder }) {
  const [filters, setFilters] = useState(emptyClockLogFilters);
  const [loadingOlder, setLoadingOlder] = useState(false);

  // THE STATION'S ROUNDING STEP, from System Settings > Clock Settings, applied to every hour on this page - the rows, the
  // shift each entry fell in, and the totals. It is the same setting the Clocked-vs-scheduled report rounds by, so what a
  // member reads here is what an officer pays for. See utils/clockRounding.
  const roundingMinutes = useMemo(() => clockRoundingMinutes(systemSettings), [systemSettings]);

  // This member's entries, then their filters and chosen order applied. Both the table and the summary
  // cards below read from this one list, so a total can never disagree with what is on screen.
  const visibleLogs = useMemo(() => {
    const mine = logs.filter((log) => String(log.user_id) === String(currentUser.id));
    return filterAndSortClockLogs(mine, filters);
  }, [logs, currentUser.id, filters]);

  const mineCount = useMemo(
    () => logs.filter((log) => String(log.user_id) === String(currentUser.id)).length,
    [logs, currentUser.id]
  );

  const totals = useMemo(() => clockLogTotals(visibleLogs, { roundingMinutes }), [visibleLogs, roundingMinutes]);
  const isFiltered = hasClockLogFilters(filters);
  const setFilter = (key) => (event) => setFilters((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <div className="space-y-6">
      {/* Filter & Sort Controls */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className={LABEL_CLASS} htmlFor="clock-history-from">From</label>
            <input
              id="clock-history-from"
              type="date"
              value={filters.from}
              onChange={setFilter('from')}
              className={SELECT_CLASS}
            />
          </div>

          <div>
            <label className={LABEL_CLASS} htmlFor="clock-history-to">To</label>
            <input
              id="clock-history-to"
              type="date"
              value={filters.to}
              onChange={setFilter('to')}
              className={SELECT_CLASS}
            />
          </div>

          <div>
            <label className={LABEL_CLASS} htmlFor="clock-history-status">Status</label>
            <select
              id="clock-history-status"
              value={filters.status}
              onChange={setFilter('status')}
              className={SELECT_CLASS}
            >
              {CLOCK_LOG_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={`${LABEL_CLASS} flex items-center gap-1.5`} htmlFor="clock-history-sort">
              <ArrowUpDown className="w-3.5 h-3.5" /> Sort By
            </label>
            <select
              id="clock-history-sort"
              value={filters.sortBy}
              onChange={setFilter('sortBy')}
              className={SELECT_CLASS}
            >
              {/* Member Name is for the administrator's all-members view, so this screen leaves it out. */}
              {CLOCK_LOG_SORT_OPTIONS.filter((option) => option.value !== 'name_asc').map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span>
            Showing {totals.count} of {mineCount} {mineCount === 1 ? 'entry' : 'entries'}
            {isFiltered ? ' (filtered)' : ''}
            {/* THE PAGE DOES NOT HOLD YOUR WHOLE HISTORY, and it says so: it opens on the station's PAY PERIOD - the last
                seven days, including today - and can be asked for older ones a week at a time. Without this line, "Showing
                8 of 8" reads as a lifetime total, which it is not. The size of the default is a READ decision: the same
                list serves an officer's whole-station table, where a year is tens of thousands of entries (see the window
                note in App#loadLogs). */}
            {loadedFrom ? ` · entries back to ${loadedFrom}` : ''}
          </span>
          <span className="flex items-center gap-3">
            {onLoadOlder && (
              <button
                type="button"
                disabled={loadingOlder}
                onClick={async () => {
                  setLoadingOlder(true);
                  try {
                    await onLoadOlder();
                  } finally {
                    setLoadingOlder(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 font-semibold text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
              >
                <History className="w-3.5 h-3.5" />
                {loadingOlder ? 'Loading…' : 'Load older entries'}
              </button>
            )}
            {isFiltered && (
              <button
                type="button"
                onClick={() => setFilters(emptyClockLogFilters())}
                className="inline-flex items-center gap-1.5 font-semibold text-red-600 dark:text-red-400 hover:underline"
              >
                <FilterX className="w-3.5 h-3.5" />
                Clear filters
              </button>
            )}
          </span>
        </div>
      </div>

      {/* Summary Metrics - computed from the filtered set, so they match the table below */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-lg flex items-center gap-4">
          <div className="p-3 bg-red-600/10 border border-red-500/20 rounded-xl text-red-500">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs uppercase font-semibold text-slate-500 dark:text-slate-400">
              Total Hours Logged{isFiltered ? ' (filtered)' : ''}
            </p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-0.5">{formatClockHours(totals.hours)}</p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-lg flex items-center gap-4">
          <div className="p-3 bg-emerald-600/10 border border-emerald-500/20 rounded-xl text-emerald-500 dark:text-emerald-400">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs uppercase font-semibold text-slate-500 dark:text-slate-400">
              Total Clock Entries{isFiltered ? ' (filtered)' : ''}
            </p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-0.5">
              {totals.count} {totals.count === 1 ? 'entry' : 'entries'}
            </p>
          </div>
        </div>
      </div>

      {/* Reusable History Table */}
      <ClockHistoryTable
        logs={visibleLogs}
        emptyMessage={
          isFiltered ? 'No clock entries match these filters.' : 'You have no recorded clock entries yet.'
        }
        timeFormat={timeFormat}
        shifts={shifts}
        roundingMinutes={roundingMinutes}
      />
    </div>
  );
}
