import React, { useEffect } from 'react';
import { X } from 'lucide-react';
// Which tone a modal opens with is decided in one table - see MODAL_SOUNDS in utils/uiSounds.
import { playSound, modalSoundFor } from '../utils/uiSounds';
import { useDismissAnimation } from '../utils/motion';
import { renderInViewport } from '../utils/viewportLayer';

/**
 * The board's member picker as a DIALOG - the shape it takes in a day view, where the pill it used to hang off is one
 * of a handful on a phone-sized screen and a 300px panel anchored to it covers the day it is about.
 *
 * IT IS THE SAME PICKER, NOT A SECOND ONE. The board computes the title, the subtitle and the list of members once and
 * hands them here as `children`; this component owns only the FRAME - the shade, the centred panel, the header, and the
 * three ways out. That is the split the popover keeps on a wide screen, for the same reason: which members may take the
 * shift is a decision about the schedule, and where the panel sits is a decision about the window.
 *
 * WHY IT IS A SEPARATE FILE rather than a second branch of the board's markup: a modal names its own tone
 * (utils/soundRules), and verify-sounds holds that table and the components to each other by scanning the components.
 * Keeping the dialog here is what lets the board's popovers stay exactly what they were - menus, which take no tone -
 * while this one opens like the dialog it is.
 */
export default function ScheduleAssignmentModal({ title, subtitle, tone = 'default', onClose, children }) {
  // Before any conditional work: played once per mount, and this is only mounted while it is open.
  useEffect(() => {
    playSound(modalSoundFor('scheduleAssignment'));
  }, []);

  // Every way out of this dialog is a dismissal - the backdrop, Escape and the close button - so all three leave
  // through the exit animation (see utils/motion). Choosing a member deliberately does not: the officer asked for the
  // assignment, and the write is what they are waiting for.
  const { ref: overlayRef, dismiss } = useDismissAnimation(onClose);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss]);

  return renderInViewport(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm animate-fadeIn"
      onClick={dismiss}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl animate-modalIn dark:bg-slate-800 ${
          tone === 'offer' ? 'border-amber-300 dark:border-amber-700' : 'border-slate-200 dark:border-slate-700'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
            {subtitle && (
              <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-700 dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* The body scrolls, so a picker longer than the window does not push its own actions out of reach. */}
        <div className="min-h-0 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  );
}