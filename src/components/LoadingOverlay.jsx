import React, { useEffect, useState } from 'react';
import { Loader2, Shield } from 'lucide-react';
import { renderInViewport } from '../utils/viewportLayer';

// How long a wait has to last before this overlay is worth showing at all.
//
// It used to appear on the first frame of every operation, so a save that took 80ms flashed a full-screen
// takeover - a dark veil and a card, appearing and vanishing inside two frames, which reads as a glitch
// rather than as progress. Anything that finishes inside this window now shows nothing at all.
const APPEAR_AFTER_MS = 140;

// ...and once it IS up it stays up long enough to be seen and to leave: a veil that appears at 140ms and
// disappears at 150ms is the same glitch with a delay on it.
const MINIMUM_VISIBLE_MS = 320;

export default function LoadingOverlay({ isLoading, message = 'Communicating with server...' }) {
  const [shown, setShown] = useState(isLoading);
  const [leaving, setLeaving] = useState(false);

  // App renders this unconditionally and flips `isLoading`, so - unlike every other dialog in the app - this
  // one owns its own appearing AND its own leaving. `isLoading` false runs the exit class and only then
  // unmounts, which is what stops the end of a wait from being a single frame.
  useEffect(() => {
    if (isLoading) {
      const appear = window.setTimeout(() => setShown(true), APPEAR_AFTER_MS);
      return () => window.clearTimeout(appear);
    }

    if (!shown) return undefined;

    setLeaving(true);
    const gone = window.setTimeout(() => {
      setShown(false);
      setLeaving(false);
    }, MINIMUM_VISIBLE_MS);
    return () => window.clearTimeout(gone);
  }, [isLoading, shown]);

  if (!shown) return null;

  return renderInViewport(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm ${leaving ? 'animate-overlayOut' : 'animate-fadeIn'}`}
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-2xl p-6 md:p-8 shadow-2xl flex flex-col items-center max-w-sm w-full mx-4 text-center animate-modalIn">
        <div className="relative mb-4 flex items-center justify-center">
          {/* Pulsing Outer Glow */}
          <div className="absolute inset-0 rounded-full bg-red-600/20 blur-xl animate-pulse" />
          
          {/* Animated Spinner */}
          <Loader2 className="w-12 h-12 text-red-500 animate-spin relative z-10" />
          
          {/* Subtle Center Icon */}
          <Shield className="w-5 h-5 text-slate-400 absolute z-10" />
        </div>

        <h4 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">Please Wait</h4>
        <p className="text-sm text-slate-500 dark:text-slate-400">{message}</p>
      </div>
    </div>
  );
}