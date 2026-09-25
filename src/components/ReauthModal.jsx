import React, { useState } from 'react';
import { ShieldAlert, AlertCircle, Loader2, LogOut } from 'lucide-react';

/**
 * Full-screen reauthentication gate rendered on top of the app UI.
 * Mounted only while reauthentication is required (by App.jsx), so internal
 * state starts fresh on every open. onReauth receives (username, password)
 * and resolves to { success, message }.
 */
export default function ReauthModal({ username = '', reason = null, onReauth, onSignOut }) {
  const [formUsername, setFormUsername] = useState(username);
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // What was refused, in the terms of the person reading it: which request, how long the session had lasted, and
  // which token the server turned down. Without this the prompt is indistinguishable from a session that was
  // simply idle too long, and the difference matters - one is expected, the other is a bug.
  const reasonText = reason
    ? [
        reason.action ? `The server refused "${reason.action}"` : 'The server refused a request',
        reason.ageSeconds !== null && reason.ageSeconds !== undefined
          ? `${reason.ageSeconds}s after you signed in`
          : null,
        reason.tokenTail ? `token …${reason.tokenTail}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError('');
    setIsSubmitting(true);
    try {
      const result = await onReauth(formUsername, password);
      if (!result || !result.success) {
        setError(result?.message || 'Verification failed. Please try again.');
      }
      // On success the parent unmounts this modal
    } catch {
      setError('Unable to connect to authentication server.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm transition-opacity duration-300 animate-fadeIn">
      <div className="w-full max-w-md mx-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-8">
        <div className="flex flex-col items-center mb-6 text-center">
          <div className="p-3 bg-red-500/10 rounded-full mb-3">
            <ShieldAlert className="w-10 h-10 text-red-500" />
          </div>
          <h2 className="text-xl font-bold tracking-wide text-slate-900 dark:text-white">Verification Required</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Your session has expired. Confirm your credentials to pick up right where you left off.
          </p>
          {reasonText && (
            <p className="mt-2 font-mono text-[11px] leading-snug text-slate-400 dark:text-slate-500">{reasonText}</p>
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
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-2">Username</label>
            <input
              type="text"
              placeholder="Enter your username"
              value={formUsername}
              onChange={(e) => setFormUsername(e.target.value)}
              autoComplete="username"
              autoFocus={!formUsername}
              disabled={isSubmitting}
              required
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-60"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-2">Password / PIN</label>
            <input
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus={!!formUsername}
              disabled={isSubmitting}
              required
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-60"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-xl transition shadow-lg shadow-red-600/20"
          >
            {isSubmitting && <Loader2 className="w-5 h-5 animate-spin" />}
            {isSubmitting ? 'Verifying...' : 'Verify & Continue'}
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
