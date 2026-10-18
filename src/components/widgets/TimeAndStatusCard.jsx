import React, { useState, useEffect, useRef } from 'react';
import { Clock, Loader2, LogIn, LogOut, WifiOff, Lock, History } from 'lucide-react';
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
  onNavigate,
}) {
  const [time, setTime] = useState(() => new Date());
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const [fontSize, setFontSize] = useState(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formattedTime = formatStationTime(time, timeFormat, true);

  const fallbackCqw = String(timeFormat) === '24' ? '16cqw' : '12cqw';

  // Measure container width and dynamically scale font size so the time fills ~80% of the widget width
  useEffect(() => {
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl) return;

    const measureAndFit = () => {
      const containerWidth = container.clientWidth;
      if (!containerWidth) return;

      const currentWidth = textEl.scrollWidth;
      const currentFs = parseFloat(window.getComputedStyle(textEl).fontSize) || 100;
      if (currentWidth > 0 && currentFs > 0) {
        // Target 80% of container width
        const targetWidth = Math.max(0, containerWidth * 0.8);
        const targetFontSize = (targetWidth / currentWidth) * currentFs;
        // Cap max font size at 110px so extra-wide spans don't push content out of bounds
        const clamped = Math.min(Math.max(24, targetFontSize), 110);
        setFontSize(Math.floor(clamped * 10) / 10);
      }
    };

    const rafId = requestAnimationFrame(measureAndFit);

    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        requestAnimationFrame(measureAndFit);
      });
      ro.observe(container);
    }

    const handleResize = () => requestAnimationFrame(measureAndFit);
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(rafId);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [timeFormat, formattedTime.length]);

  const formattedDate = time.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="relative h-full max-h-[500px] flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800 p-5 md:p-6 shadow-xl transition-all">
      {/* Widget Header */}
      <div className="shrink-0 flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700/60 mb-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 flex items-center justify-center font-bold shrink-0">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Station Time
            </h3>
            <p className="text-[11px] text-slate-400">
              Official department time & status
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {isCustomizing && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700/80 text-[10px] font-semibold text-slate-500 dark:text-slate-300 border border-slate-200 dark:border-slate-600">
              <Lock className="w-3 h-3 text-amber-500" />
              <span>Locked Top-Left</span>
            </div>
          )}
          <span className="inline-flex items-center justify-center h-5 px-2 text-[10px] font-bold rounded-full bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300 uppercase tracking-wider">
            {String(timeFormat) === '24' ? '24-HR' : '12-HR EST'}
          </span>
        </div>
      </div>

      {/* Clock Display & Centered Date */}
      <div className="flex-1 flex flex-col items-center justify-center py-2 min-h-0">
        <div
          ref={containerRef}
          className="w-full overflow-hidden flex items-center justify-center"
          style={{ containerType: 'inline-size' }}
        >
          <div
            ref={textRef}
            style={{
              fontSize: fontSize ? `${fontSize}px` : `clamp(2rem, ${fallbackCqw}, 7rem)`,
              lineHeight: 1.05,
            }}
            className="font-extrabold text-slate-900 dark:text-white font-mono tracking-tight whitespace-nowrap text-center tabular-nums select-none"
          >
            {formattedTime}
          </div>
        </div>

        <div className="text-sm md:text-base font-medium text-slate-600 dark:text-slate-300 text-center mt-1.5">
          {formattedDate}
        </div>
      </div>

      {/* Divider */}
      <hr className="my-3 border-slate-100 dark:border-slate-700/60 shrink-0" />

      {/* Status & Clock Action */}
      <div className="space-y-3 shrink-0">
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
          <div className="flex items-stretch gap-2">
            {!isClockedIn ? (
              <button
                type="button"
                onClick={() => onClockAction?.('CLOCK_IN')}
                disabled={loading || offline}
                className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold py-2.5 px-4 rounded-xl transition shadow-md shadow-emerald-600/20 active:scale-[0.98]"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                <span>{loading ? 'Clocking In...' : 'Clock In'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onClockAction?.('CLOCK_OUT')}
                disabled={loading || offline}
                className="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold py-2.5 px-4 rounded-xl transition shadow-md shadow-red-600/20 active:scale-[0.98]"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
                <span>{loading ? 'Clocking Out...' : 'Clock Out'}</span>
              </button>
            )}
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('clock-history')}
                className="shrink-0 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/60 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold transition active:scale-[0.98]"
                title="View Clock History"
              >
                <History className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                <span>History</span>
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

