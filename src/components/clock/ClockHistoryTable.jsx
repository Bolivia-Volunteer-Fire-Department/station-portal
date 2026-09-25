import React from 'react';
import ClockTableRow from './ClockTableRow';
import { Calendar } from 'lucide-react';

export default function ClockHistoryTable({ 
  logs = [], 
  showUserColumn = false, 
  emptyMessage = "No clock entries found.",
  timeFormat = '12',
  shifts = []
}) {
  if (!logs || logs.length === 0) {
    return (
      <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 rounded-2xl p-8 text-center">
        <Calendar className="w-10 h-10 text-slate-500 mx-auto mb-3" />
        <p className="text-slate-500 dark:text-slate-400 font-medium">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-100 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {showUserColumn && <th className="px-4 py-3.5">Member</th>}
              <th className="px-4 py-3.5">Time In</th>
              <th className="px-4 py-3.5">Time Out</th>
              <th className="px-4 py-3.5">Duration</th>
              <th className="px-4 py-3.5">Shift Time</th>
              <th className="px-4 py-3.5">Clock-In Location</th>
              <th className="px-4 py-3.5">Clock-Out Location</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
            {logs.map((log) => (
              <ClockTableRow key={log.id} log={log} showUserColumn={showUserColumn} timeFormat={timeFormat} shifts={shifts} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}