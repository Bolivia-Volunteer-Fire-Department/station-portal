import React, { useEffect, useId, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
// The tone table, so this dialog sounds like every other modal (see MODAL_SOUNDS in utils/soundRules).
import { playSound, modalSoundFor } from '../utils/uiSounds';

/**
 * A confirmation dialog, for actions that cannot be undone.
 *
 * This replaces `window.confirm`, which is what the app used until now. A native dialog cannot be styled, cannot be
 * heard (the sound layer never sees it), blocks the main thread, and on some browsers is suppressed entirely -
 * which for a delete is the worst possible failure. It also cannot say anything beyond two strings, so the
 * confirmations that needed to name what would be lost (a training's signatures, a role's members) had to fit their
 * warning into a sentence.
 *
 * Dismissing is expected here, unlike the forced modals (ReauthModal, PasswordChangeModal, ClockBlockedModal): this
 * is the member's own choice being confirmed, so Escape and a click outside both cancel, and the SAFE answer is
 * what has the focus when it opens.
 *
 * `tone="danger"` (the default) paints the confirm button red, for anything destructive. Use `tone="default"` when
 * the confirmation is not a warning - it is only ever the button's colour, not the wording.
 */
export default function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  onConfirm,
  onCancel,
}) {
  const titleId = useId();
  const messageId = useId();
  const cancelRef = useRef(null);

  // The modal is mounted when it opens (see the callers), so this is once per confirmation - which is also what the
  // sound layer expects: one tone per open, not per re-render.
  useEffect(() => {
    playSound(modalSoundFor('confirm'));
  }, []);

  // The safe answer takes the focus: Enter then cancels, and the destructive button takes a deliberate choice.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  // Escape cancels, from anywhere - including a button inside the dialog. Capture, so a handler that stops the
  // event on the way up cannot leave the dialog stuck open.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCancel?.();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onCancel]);

  const danger = tone !== 'default';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      {/* Clicking away is a cancel, not a trap: this dialog asks a question the member can decline. */}
      <div className="absolute inset-0" onClick={onCancel} aria-hidden="true" />

      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
        className="relative w-full max-w-md mx-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-6"
      >
        <div className="flex items-start gap-3">
          <div
            className={`p-2.5 rounded-xl shrink-0 ${
              danger
                ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                : 'bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300'
            }`}
          >
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-bold text-slate-900 dark:text-white">
              {title}
            </h2>
            {/* A node is allowed: some of these need to name the thing being deleted in bold. */}
            {message && (
              <div id={messageId} className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">
                {message}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-800 ${
              danger
                ? 'bg-red-600 hover:bg-red-500 shadow-lg shadow-red-600/20 focus-visible:ring-red-500'
                : 'bg-slate-700 hover:bg-slate-600 focus-visible:ring-slate-500'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
