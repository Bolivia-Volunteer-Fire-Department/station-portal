import React, { useState, useEffect } from 'react';
import { Clock, Loader2, LogIn, LogOut, WifiOff, Lock } from 'lucide-react';
import { formatStationTime } from '../../utils/timeFormat';
import { OFFLINE_CLOCK_MESSAGE } from '../../utils/connectivity';

/**
 * Combined Station Time & Current Status Card.
 * Permanently pinned at the top-left of the Dashboard grid (and first on mobile).
 * Non-resizable and non-movable.
 */
export default function TimeAndStatusCard({
  isClockedIn = false,
  loading = false,
  offline = false,
  canUseTimeclock = false,
  onClockAction,
  timeFormat = '12',
  isCustomizing = false,
}) {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formattedTime = formatStationTime(time, timeFormat, true);

  const formattedDate = time.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="relative h-full flex flex-col justify-between rounded-2xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800 p-5 md:p-6 shadow-xl transition-all">
      {/* Pinned Indicator when customizing */}
      {isCustomizing && (
        <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700/80 text-[10px] font-semibold text-slate-500 dark:text-slate-300 border border-slate-200 dark:border-slate-600">
          <Lock className="w-3 h-3 text-amber-500" />
          <span>Locked Top-Left</span>
        </div>
      )}

      {/* Clock Header */}
      <div>
        <div className="flex items-center gap-2 text-red-600 dark:text-red-500 font-semibold text-xs tracking-wider uppercase mb-1">
          <Clock className="w-4 h-4 shrink-0" />
          <span>Station Time ({String(timeFormat) === '24' ? '24-HR' : '12-HR EST'})</span>
        </div>

        <div className="text-3xl md:text-4xl font-extrabold text-slate-900 dark:text-white font-mono tracking-tight my-1">
          {formattedTime}
        </div>

        <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {formattedDate}
        </div>
      </div>

      {/* Divider */}
      <hr className="my-4 border-slate-100 dark:border-slate-700/60" />

      {/* Status & Clock Action */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span
              className={`h-3 w-3 rounded-full shrink-0 ${
                isClockedIn ? 'bg-emerald-500 animate-pulse shadow-xs shadow-emerald-500/50' : 'bg-slate-400 dark:bg-slate-500'
              }`}
            />
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              Current Status:{' '}
              <span className={isClockedIn ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-slate-500 dark:text-slate-400'}>
                {isClockedIn ? 'On Duty' : 'Off Duty'}
              </span>
            </span>
          </div>
        </div>

        {offline && (
          <p className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 text-xs font-medium bg-amber-50 dark:bg-amber-950/40 p-2 rounded-lg border border-amber-200 dark:border-amber-800/60">
            <WifiOff className="w-3.5 h-3.5 shrink-0" />
            <span>{OFFLINE_CLOCK_MESSAGE}</span>
          </p>
        )}

        {/* Action Button */}
        {canUseTimeclock ? (
          <div>
            {!isClockedIn ? (
              <button
                type="button"
                onClick={() => onClockAction?.('CLOCK_IN')}
                disabled={loading || offline}
                className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold py-2.5 px-4 rounded-xl transition shadow-md shadow-emerald-600/20 active:scale-[0.98]"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                <span>{loading ? 'Clocking In...' : 'Clock In'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onClockAction?.('CLOCK_OUT')}
                disabled={loading || offline}
                className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold py-2.5 px-4 rounded-xl transition shadow-md shadow-red-600/20 active:scale-[0.98]"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
                <span>{loading ? 'Clocking Out...' : 'Clock Out'}</span>
              </button>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-400 dark:text-slate-500 italic">
            Clocking in/out is not enabled for your account.
          </p>
        )}
      </div>
    </div>
  );
}

