import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { MONTHS, WEEKDAYS, monthGridCells } from '../utils/calendarConstants';
import { toDateKey } from '../utils/scheduleDate';
// Which tone a modal opens with is decided in one table - see MODAL_SOUNDS in utils/uiSounds.
import { playSound, modalSoundFor } from '../utils/uiSounds';
import { useDismissAnimation } from '../utils/motion';
import { renderInViewport } from '../utils/viewportLayer';

/**
 * The month, as a calendar, to pick ONE day from.
 *
 * WHAT THIS IS FOR: a day view steps a day at a time, which is the right unit for looking around and the wrong one for
 * getting somewhere. "The 14th of next month" was fourteen presses and a month boundary; this is one press and a day.
 *
 * NOTHING BUT THE CALENDAR IS ON IT, deliberately, and that is the whole of the spec: no shifts, no pills, no counts,
 * no legend. It is a day picker, not a second board - the moment it draws a shift it becomes a screen somebody tries to
 * manage the schedule from, which is what the calendar behind it is already for. The month arrows are here because a
 * month calendar that cannot leave its month cannot pick a day outside it.
 *
 * The month it OPENS ON is the month on screen (so the day you are reading is visible rather than a month you would have
 * to find again), and it keeps its own month as you page through - the calendar behind it does not move until a day is
 * chosen. That is the difference between this and the grid: browsing here is free and changes nothing.
 *
 * `selectedKey`/`todayKey` are marked rather than remembered: which day you are on is the calendar's state, not this
 * modal's, and a modal that could disagree with the screen behind it would be a second answer to the same question.
 */
export default function MonthPickerModal({ viewDate, selectedKey, todayKey, onPick, onClose }) {
  // The month being BROWSED here, which starts as the month on screen. A Date rather than a year/month pair, so
  // "step a month" is the same arithmetic every other calendar in the app uses.
  const [monthDate, setMonthDate] = useState(
    () => new Date(viewDate.getFullYear(), viewDate.getMonth(), 1)
  );

  // Before any conditional work: the tone is played once per mount, and this is only mounted while it is open.
  useEffect(() => {
    playSound(modalSoundFor('monthPicker'));
  }, []);

  // Escape and the backdrop leave through the exit animation, like every other dismissable dialog here (see
  // utils/motion). Choosing a day does NOT go through it: the member asked for the day, so the 110ms would sit in front
  // of the thing they asked for - the same exception Confirm and a successful save already take.
  const { ref: overlayRef, dismiss } = useDismissAnimation(onClose);

  // Escape too, and it goes through `dismiss` rather than unmounting in a frame: this dialog is opened from a toolbar
  // button a keyboard user has just pressed, so it is the one they will try to leave with the keyboard.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss]);

  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const cells = monthGridCells(year, month);

  return renderInViewport(
    <div
      ref={overlayRef}
      // The app's own dialog shade, so the picker reads as a dialog rather than as a menu hanging off a button: it is
      // not anchored to anything, and the day it returns changes the screen behind it.
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm animate-fadeIn"
      onClick={dismiss}
      role="dialog"
      aria-modal="true"
      aria-label="Choose a day"
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl animate-modalIn dark:border-slate-700 dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMonthDate(new Date(year, month - 1, 1))}
            aria-label="Previous month"
            className="rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          {/* An h2 rather than the h3 the screens' cards use, so this dialog's heading cannot be mistaken for the page's
              own title by anything reading the document (the runtime harnesses look up the toolbar's h3). */}
          <h2 className="flex-1 text-center text-base font-semibold text-slate-900 dark:text-white">
            {MONTHS[month]} {year}
          </h2>

          <button
            type="button"
            onClick={() => setMonthDate(new Date(year, month + 1, 1))}
            aria-label="Next month"
            className="rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={dismiss}
            aria-label="Close month picker"
            className="ml-1 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-700 dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-7 gap-1 text-center">
          {WEEKDAYS.map((label) => (
            <div key={label} className="py-1 text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">
              {label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, index) => {
            // A padding cell: not a day, so not a button. An unclickable div rather than a disabled button, so a screen
            // reader is not told about a control that does nothing.
            if (!day) return <div key={`blank-${index}`} className="h-9 rounded-lg" />;

            const key = toDateKey(day);
            const isSelected = key === String(selectedKey || '');
            const isToday = key === String(todayKey || '');

            return (
              <button
                key={key}
                type="button"
                onClick={() => onPick(key)}
                // The date itself, because "14" read aloud is not a day: this is what a screen reader announces, and it
                // is also what lets a harness press an exact date rather than counting cells.
                aria-label={key}
                // `aria-current` is the honest way to say "this is the day the screen is on": the filled pill on it is
                // styling, and styling is not announced.
                aria-current={isSelected ? 'date' : undefined}
                className={`h-9 rounded-lg text-sm font-medium transition ${
                  isSelected
                    ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                    : isToday
                      ? 'border border-red-400 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/40'
                      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}