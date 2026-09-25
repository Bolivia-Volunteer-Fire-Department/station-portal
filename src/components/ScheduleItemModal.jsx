import React from 'react';
import { CalendarDays, CalendarClock, X } from 'lucide-react';
import RankIcon from './RankIcon';

/**
 * Read-only detail popup for one calendar item: a shift, or an event.
 *
 * The layout deliberately mirrors ShiftOfferModal - same shell, same label/value rows - because the two are
 * seen side by side in My Schedule and should read as one family. The difference is that this one only
 * reports: a shift you cannot act on still deserves to be readable.
 *
 * `details` is the output of utils/scheduleItemDetails, so the contents are tested rather than the markup.
 * Mounted only while an item is selected, so there is no state to reset.
 */
export default function ScheduleItemModal({ details, icon, onClose }) {
  if (!details) return null;

  const HeaderIcon = icon === 'event' ? CalendarClock : CalendarDays;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm transition-opacity duration-300 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md mx-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="p-3 bg-slate-100 dark:bg-slate-900/60 rounded-full shrink-0">
            <HeaderIcon className="w-7 h-7 text-slate-500 dark:text-slate-400" />
          </div>
          <div className="min-w-0 flex-1">
            {/* A colour bar rather than a filled header: an assignment can be any colour, and white text on
                an arbitrary one is unreadable. */}
            <div className="flex items-center gap-2">
              {details.color && (
                <span
                  className="h-3 w-3 shrink-0 rounded-full border border-black/10"
                  style={{ backgroundColor: details.color }}
                  aria-hidden="true"
                />
              )}
              <h2 className="min-w-0 truncate text-lg font-bold text-slate-900 dark:text-white">{details.title}</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{details.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 divide-y divide-slate-200 dark:divide-slate-700/70">
          {details.rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-xs uppercase font-semibold text-slate-500 dark:text-slate-400">{row.label}</span>
              <span className="flex items-center gap-1.5 min-w-0 text-sm font-medium text-slate-900 dark:text-white text-right">
                {row.icon && <RankIcon name={row.icon} className="w-3.5 h-3.5 shrink-0 text-slate-400" />}
                <span className="truncate">{row.value}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
