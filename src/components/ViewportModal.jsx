import React, { useEffect, useId, useRef } from 'react';
import { Loader2, Save, X } from 'lucide-react';
// Which tone a modal opens with is decided in one table - see MODAL_SOUNDS in utils/soundRules.
import { playSound, modalSoundFor } from '../utils/uiSounds';
import { useDismissAnimation } from '../utils/motion';
import { renderInViewport } from '../utils/viewportLayer';

/**
 * A modal for editing something with more than a few fields - most of the viewport rather than a small box.
 *
 * The other dialogs in the app are for answering a question: a confirmation, a detail popup. This one is for
 * WORKING - the document editor is a stack of fields, a markdown body, a checklist and a signature record - and
 * a 28rem box in the middle of the screen would make it worse than the card it replaced. So: full screen on a
 * phone, and up to 92% of the viewport once there is room, with the page behind it as background.
 *
 * The toolbar is pinned at the top and the body is the only thing that scrolls, which is what makes it stay put
 * without needing `position: sticky` - the panel is a flex column and the body is the flexible child. Save and
 * Cancel live there, so they are reachable from the bottom of a long checklist without scrolling back.
 *
 * `busy` is the saving state, and it does three things at once, because they are three faces of one promise:
 *   * the body is wrapped in a disabled fieldset, so nothing can be typed into while a write is in flight;
 *   * the toolbar shows a spinner in place of the Save icon and says what it is waiting for;
 *   * Escape, the backdrop and the close button are IGNORED. A modal that can be dismissed mid-save would leave
 *     the reader unsure whether it saved, and the answer would arrive as a toast over a list they had left.
 *
 * Callers close it themselves when the write is confirmed - this component does not decide when saving is over.
 */
// How big the frame is.
//
//   'large'  the default, and the reason this component exists: an editor with a body, a checklist, a signature
//            record or a grid of twenty-four checkboxes needs the screen.
//   'small'  for the editors that are a handful of short fields. A 92dvh panel around three inputs is mostly
//            empty space, and the eye reads a compact dialog as "this is a small thing to do".
//
// The BEHAVIOUR is identical in both - the pinned toolbar, the disabled fieldset while saving, the blocked
// dismissal, closing only once the write lands. Size is the frame, not the contract, which is why it is one prop
// and not two components.
//
// The rule of thumb, in one place so it does not have to be re-argued per tab: FIVE OR FEWER SHORT FIELDS is
// small. Anything with a long text area, a list, a signature panel, a date range or a grid of checkboxes is
// large, because those grow in one direction and would scroll inside a small frame. `editorModalSize(fieldCount)`
// encodes the count so a caller can pass a number rather than a judgement.
export const SMALL_EDITOR_FIELD_LIMIT = 5;

export const editorModalSize = (fieldCount) =>
  Number(fieldCount) <= SMALL_EDITOR_FIELD_LIMIT ? 'small' : 'large';

// The frame, per size. Mobile is the full screen either way: a compact dialog on a phone is a keyboard's worth of
// scrolling, and the safe-area padding only makes sense against the whole screen.
const PANEL_SIZE_CLASS = {
  small: 'sm:h-auto sm:max-h-[85dvh] sm:w-[34rem] sm:max-w-[94vw]',
  large: 'sm:h-[92dvh] sm:max-h-[92dvh] sm:w-[94vw] sm:max-w-6xl',
};

export default function ViewportModal({
  title,
  subtitle = '',
  icon = null,
  // 'large' or 'small': see above. Anything else falls back to large, so a typo cannot produce a frame with no
  // height at all.
  size = 'large',
  // Extra toolbar buttons that belong beside Save (a Delete, say). Rendered before the Save button.
  actions = null,
  // The id of the <form> inside. Save submits it through the HTML `form` attribute, so the fields keep their
  // native behaviour: Enter in a text input still submits, and validation still runs.
  formId,
  // For editors whose body is NOT a form - a stack of fields with a save handler, as the certification tabs are.
  // Save then simply calls this, and formId is left off.
  onSave,
  saveLabel = 'Save',
  // A caller whose save is refused for a reason of its own (the Roles editor refuses to store an administrator
  // role for a non-administrator) disables the toolbar's Save without disabling the whole form: the fields stay
  // readable and the reason goes in `actions`, beside the button.
  saveDisabled = false,
  saving = false,
  busy = false,
  busyLabel = 'Saving…',
  onClose,
  children,
}) {
  const titleId = useId();
  const panelRef = useRef(null);

  // One tone per open, like every other modal. The reader asked for this one by pressing New document or opening
  // a row, so it is a positive tone by the rule the sound table states.
  useEffect(() => {
    playSound(modalSoundFor('documentEditor'));
  }, []);

  const { ref: overlayRef, dismiss } = useDismissAnimation(onClose);

  // Escape gets out, unless a write is in flight. Capture, so a handler that stops the event on the way up cannot
  // leave the dialog stuck open.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (busy) return;
      dismiss();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [busy, dismiss]);


  return renderInViewport(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[60] flex items-stretch justify-center bg-slate-950/80 backdrop-blur-sm animate-fadeIn pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:items-center sm:p-4"
    >
      {/* Clicking the background is a dismissal - unless a write is in flight, which is the one thing this modal
          must not let anybody walk away from by accident. */}
      <div
        className="absolute inset-0"
        onClick={() => {
          if (!busy) dismiss();
        }}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
        className={`relative flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl animate-modalIn dark:bg-slate-800 ${
          PANEL_SIZE_CLASS[size === 'small' ? 'small' : 'large']
        } sm:rounded-2xl sm:border sm:border-slate-200 sm:dark:border-slate-700`}
      >
        {/* The pinned toolbar. `shrink-0` is what keeps it visible while the body scrolls under it. */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-700 dark:bg-slate-800/95 sm:px-6">
          {icon && (
            <div className="hidden shrink-0 rounded-xl border border-slate-200 bg-slate-100 p-2.5 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 sm:block">
              {icon}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-base font-bold text-slate-900 dark:text-white">
              {title}
            </h2>
            {/* The author and the last edit, under the title: the reader is about to change a document other
                people rely on, and this is where they find out whose it is. */}
            {subtitle && (
              <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
            <button
              type="button"
              onClick={dismiss}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent dark:text-slate-300 dark:hover:bg-slate-700"
            >
              <X className="h-4 w-4" />
              Cancel
            </button>
            {/* Submits the form inside through the HTML `form` attribute, so the fields keep their native
                behaviour: Enter in a text input still submits the document. A body that is not a form (the
                certification editors) passes onSave instead, and this calls it. */}
            <button
              type={formId ? 'submit' : 'button'}
              form={formId}
              onClick={formId ? undefined : onSave}
              disabled={busy || saveDisabled}
              className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-red-600/20 transition hover:bg-red-500 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? busyLabel : saveLabel}
            </button>
            {/* A close button for a phone, where the toolbar wraps to two rows and a thumb finds the corner more
                easily than the word Cancel. */}
            <button
              type="button"
              onClick={dismiss}
              disabled={busy}
              aria-label="Close"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-slate-700 dark:hover:text-white sm:hidden"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* The body: the one part that scrolls. `overscroll-contain` stops the page behind from being dragged
            along when the reader reaches the end of a long checklist on a touch screen. */}
        <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {/* A disabled fieldset is what "the form is disabled while saving" means in HTML: every input, select,
              textarea and button inside it stops responding, in one place, rather than one `disabled` per field
              that somebody will eventually forget. */}
          <fieldset disabled={busy} className="min-w-0 border-0 p-4 sm:p-6">
            {children}
          </fieldset>

          {busy && (
            <div className="absolute inset-0 flex items-start justify-center bg-white/60 pt-16 backdrop-blur-[2px] dark:bg-slate-800/60">
              <span className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-lg dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200">
                <Loader2 className="h-4 w-4 animate-spin text-red-600 dark:text-red-400" />
                {busyLabel}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
