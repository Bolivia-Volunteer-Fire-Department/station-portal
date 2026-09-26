import React, { useEffect, useState } from 'react';
import { KeyRound, AlertCircle, Loader2, LogOut, ShieldCheck } from 'lucide-react';
import { passwordChangeCopy, passwordChangeProblem } from '../utils/passwordPolicy';
import { playSound, modalSoundFor } from '../utils/uiSounds';

/**
 * The forced password change.
 *
 * Shown when an administrator ticked "must change password" on the member's row, and it is deliberately not
 * dismissable: there is no close button, no backdrop click, and no Save-and-carry-on. The only two ways out are
 * choosing a password (which clears the flag) or signing out.
 *
 * It sits above the app chrome but BELOW the re-authentication prompt: if the session expires while this is open,
 * the member has to verify first, or the change would be attempted with a dead session and fail with a message
 * about permissions rather than about the session. Hence z-[55] - above the app (which tops out at z-50) and
 * below the modal layer (z-[60]), where ReauthModal lives.
 */
export default function PasswordChangeModal({ username = '', onPasswordChange, onSignOut }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const copy = passwordChangeCopy();

  // An interruption - the member is being made to act before they can do anything else - so the error tone.
  useEffect(() => {
    playSound(modalSoundFor('passwordChange'));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    const problem = passwordChangeProblem({ newPassword, confirmPassword });
    if (problem) {
      setError(problem);
      return;
    }

    setError('');
    setIsSubmitting(true);
    try {
      const result = await onPasswordChange(newPassword);
      if (!result || !result.success) {
        setError(result?.message || 'The password could not be changed. Please try again.');
      }
      // On success the parent clears the flag and this modal unmounts with it.
    } catch {
      setError('Unable to reach the server. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-slate-950/85 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-md mx-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-8">
        <div className="flex flex-col items-center mb-6 text-center">
          <div className="p-3 bg-amber-500/10 rounded-full mb-3">
            <KeyRound className="w-10 h-10 text-amber-500" />
          </div>
          <h2 className="text-xl font-bold tracking-wide text-slate-900 dark:text-white">{copy.title}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{copy.lead}</p>
          {/* Named, because a station tablet is often shared and this popup is the one moment where signing in as
              the wrong member would be worth catching. */}
          {username && (
            <p className="text-xs font-mono text-slate-400 dark:text-slate-500 mt-2">Signed in as {username}</p>
          )}
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 dark:bg-red-950/80 dark:border-red-800 dark:text-red-200">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-2">
              New password
            </label>
            <input
              type="password"
              placeholder="Enter your new password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              autoFocus
              disabled={isSubmitting}
              required
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-60"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-2">
              Confirm new password
            </label>
            <input
              type="password"
              placeholder="Type it again"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              disabled={isSubmitting}
              required
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-60"
            />
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400">{copy.hint}</p>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-xl transition shadow-lg shadow-red-600/20"
          >
            {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
            {isSubmitting ? 'Saving...' : 'Save new password'}
          </button>
        </form>

        <button
          type="button"
          onClick={onSignOut}
          disabled={isSubmitting}
          className="w-full mt-3 flex items-center justify-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 transition"
        >
          <LogOut className="w-4 h-4" />
          Sign Out Instead
        </button>
      </div>
    </div>
  );
}
