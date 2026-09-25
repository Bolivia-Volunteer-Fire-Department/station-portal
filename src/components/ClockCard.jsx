import React from 'react';
import { LogIn, LogOut } from 'lucide-react';

export default function ClockCard({ isClockedIn, loading, onClockAction }) {
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 md:p-8 shadow-xl">
      <div className="flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <span className={`h-3 w-3 rounded-full ${isClockedIn ? 'bg-emerald-500 animate-pulse' : 'bg-slate-500'}`} />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
              Current Status: {isClockedIn ? 'On Duty (Clocked In)' : 'Off Duty (Clocked Out)'}
            </h3>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            {isClockedIn
              ? 'Click below to end your active shift.'
              : 'Click below to start a new shift record.'}
          </p>
        </div>

        <div>
          {!isClockedIn ? (
            <button
              onClick={() => onClockAction('CLOCK_IN')}
              disabled={loading}
              className="w-full md:w-auto flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold py-3.5 px-8 rounded-xl transition shadow-lg shadow-emerald-600/20"
            >
              <LogIn className="w-5 h-5" />
              Clock In
            </button>
          ) : (
            <button
              onClick={() => onClockAction('CLOCK_OUT')}
              disabled={loading}
              className="w-full md:w-auto flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold py-3.5 px-8 rounded-xl transition shadow-lg shadow-red-600/20"
            >
              <LogOut className="w-5 h-5" />
              Clock Out
            </button>
          )}
        </div>
      </div>
    </div>
  );
}