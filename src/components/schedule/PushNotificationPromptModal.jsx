import React from 'react';
import { Bell, ArrowRight, X, ShieldAlert } from 'lucide-react';
import { renderInViewport } from '../../utils/viewportLayer';
import { useDismissAnimation } from '../../utils/motion';

/**
 * Modal shown after a user offers to fill a shift IF their current device
 * does not have push notifications enabled. Encourages enabling notifications
 * on personal/non-shared devices so they receive updates when the offer is approved.
 */
export default function PushNotificationPromptModal({ isOpen, onClose, onNavigateToSettings }) {
  const { ref: overlayRef, dismiss } = useDismissAnimation(onClose);

  if (!isOpen) return null;

  const handleGoToSettings = () => {
    onClose?.();
    onNavigateToSettings?.();
  };

  return renderInViewport(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm transition-opacity duration-300 animate-fadeIn"
      onClick={dismiss}
    >
      <div
        className="w-full max-w-md mx-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-6 animate-modalIn"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="p-3 bg-red-500/10 dark:bg-red-500/20 rounded-full shrink-0 text-red-600 dark:text-red-400">
            <Bell className="w-7 h-7" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Enable Push Notifications?</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Your shift offer has been submitted! Would you like to get notified on this device as soon as an officer approves or declines your offer?
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <div>
            <span className="font-semibold">Personal device recommendation:</span> Only enable notifications if this is your personal device. For privacy, avoid enabling notifications on shared station terminals.
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
          <button
            type="button"
            onClick={dismiss}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
          >
            Maybe Later
          </button>
          <button
            type="button"
            onClick={handleGoToSettings}
            className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-500 shadow-lg shadow-red-600/20 transition"
          >
            <span>Go to Settings</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

