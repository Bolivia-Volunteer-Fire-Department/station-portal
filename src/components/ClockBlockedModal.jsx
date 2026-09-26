import React, { useEffect } from 'react';
import { AlertTriangle, MapPinOff, ShieldAlert, X, Ruler } from 'lucide-react';
import { playSound, modalSoundFor } from '../utils/uiSounds';

/**
 * Why a clock in/out was refused, shown as a modal.
 *
 * The geofence check runs before the request, so a refusal is not an error the member can miss in a
 * corner of the screen - it is the answer to the button they just pressed. This modal is the delivery
 * vehicle for that answer, and also carries the server's own refusals (which arrive as a bare code,
 * because the fence can be turned on while a page is already open).
 *
 * `notice` comes from clockLocationNotice() in utils/clockLocation.js, so the wording is decided in a
 * tested pure function and this component only renders it.
 *
 * No Escape-to-dismiss and no backdrop click: these are deliberate actions with a clear "Got it", and
 * an accidental dismissal would leave the member wondering what happened. Same reasoning as
 * ReauthModal having no close affordance.
 */
const ICONS = {
  'too-far': AlertTriangle,
  'no-location': MapPinOff,
  blocked: ShieldAlert,
};

export default function ClockBlockedModal({ notice, onDismiss }) {
  // A refusal, so it opens on the error tone - and before the early return, because a hook cannot follow one.
  useEffect(() => {
    playSound(modalSoundFor('clockBlocked'));
  }, []);

  if (!notice) return null;

  const Icon = ICONS[notice.kind] || ShieldAlert;
  const hasNumbers = Number.isFinite(notice.distanceFeet) || Number.isFinite(notice.limitFeet);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm transition-opacity duration-300 animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clock-blocked-title"
    >
      <div className="w-full max-w-md mx-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-8">
        <div className="flex flex-col items-center mb-6 text-center">
          <div className="p-3 bg-amber-500/10 rounded-full mb-3">
            <Icon className="w-10 h-10 text-amber-500" />
          </div>
          <h2
            id="clock-blocked-title"
            className="text-xl font-bold tracking-wide text-slate-900 dark:text-white"
          >
            {notice.title}
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">{notice.message}</p>
        </div>

        {hasNumbers && (
          <div className="mb-6 grid grid-cols-2 gap-3">
            {Number.isFinite(notice.distanceFeet) && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 p-3 text-center">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Your distance
                </div>
                <div className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
                  {Math.round(notice.distanceFeet).toLocaleString('en-US')} ft
                </div>
              </div>
            )}
            {Number.isFinite(notice.limitFeet) && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 p-3 text-center">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Allowed
                </div>
                <div className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
                  {Math.round(notice.limitFeet).toLocaleString('en-US')} ft
                </div>
              </div>
            )}
          </div>
        )}

        {notice.hint && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
            <Ruler className="w-5 h-5 shrink-0 mt-0.5" />
            <p className="text-sm">{notice.hint}</p>
          </div>
        )}

        <button
          type="button"
          onClick={onDismiss}
          autoFocus
          className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white font-semibold py-3 px-4 rounded-xl transition shadow-lg shadow-red-600/20"
        >
          <X className="w-5 h-5" />
          Got it
        </button>
      </div>
    </div>
  );
}
