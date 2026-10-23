import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle, ChevronLeft, FileText, KeyRound, Loader2, Mail } from 'lucide-react';
import { stationLogoUrl } from '../utils/assets';
import { APP_VERSION } from '../utils/appVersion.js';
import PasswordInput from './PasswordInput';
import PasswordCrackEstimate from './PasswordCrackEstimate';
import ViewportModal from './ViewportModal';
import Markdown from './Markdown';
import termsMarkdown from '../content/help/member/98-terms-of-service.md?raw';
import privacyMarkdown from '../content/help/member/99-privacy-policy.md?raw';
import { requestPasswordReset, completePasswordReset } from '../services/firebaseAuth.js';

const LEGAL_DOCUMENTS = {
  terms: {
    title: 'Terms of Service',
    subtitle: 'StationSync Legal & Compliance',
    markdown: termsMarkdown,
  },
  privacy: {
    title: 'Privacy Policy',
    subtitle: 'StationSync Legal & Compliance',
    markdown: privacyMarkdown,
  },
};

// THE LOGIN SCREEN CARRIES NO ANNOUNCEMENTS, and that is deliberate rather than an omission: it is read before anybody
// has signed in, so it cannot be targeted at a role or a person, and it was the reason the app made a read without a
// session at all. Anything that has to be read here belongs in this file, as a line of code somebody reviews - not in a
// form. See utils/announcements#ANNOUNCEMENT_LOCATIONS.
export default function LoginScreen({ onLogin, statusMessage: propStatusMessage, departmentName, departmentLogoUrl, isLoading = false, systemSettings = [] }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const forgotPasswordSetting = Array.isArray(systemSettings)
    ? systemSettings.find((s) => String(s?.key ?? '').trim() === 'forgot_password_enabled')
    : null;
  const isForgotPasswordEnabled = forgotPasswordSetting
    ? String(forgotPasswordSetting.value ?? '').trim() !== 'false'
    : true;

  // Self-service password reset state
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotStatus, setForgotStatus] = useState(null);

  // Set new password (when following email reset link)
  const [resetToken, setResetToken] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetStatus, setResetStatus] = useState(null);
  const [localStatusMessage, setLocalStatusMessage] = useState(null);
  const [activeLegalDoc, setActiveLegalDoc] = useState(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('reset_token');
      if (token) {
        setResetToken(token);
      }
    }
  }, []);

  const isBusy = submitting || isLoading || forgotSubmitting || resetSubmitting;
  const activeStatusMessage = localStatusMessage || propStatusMessage;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isBusy) return;
    setSubmitting(true);
    setLocalStatusMessage(null);
    try {
      await onLogin(username, password);
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    if (isBusy) return;
    const cleanEmail = forgotEmail.trim();
    if (!cleanEmail) return;

    setForgotSubmitting(true);
    setForgotStatus(null);
    try {
      const appOrigin = typeof window !== 'undefined' ? window.location.origin : '';
      const result = await requestPasswordReset({ email: cleanEmail, appOrigin });
      setForgotStatus({
        type: 'success',
        text: result?.message || `If the email you entered (${cleanEmail}) matches an active member account, you will receive a link to reset your password.`,
      });
    } catch (err) {
      setForgotStatus({
        type: 'error',
        text: err?.message || 'Could not process password reset request. Please try again.',
      });
    } finally {
      setForgotSubmitting(false);
    }
  };

  const handleResetSubmit = async (e) => {
    e.preventDefault();
    if (isBusy) return;
    setResetStatus(null);

    if (newPassword.length < 8) {
      setResetStatus({ type: 'error', text: 'Password must be at least 8 characters long.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetStatus({ type: 'error', text: 'Passwords do not match. Please re-enter.' });
      return;
    }

    setResetSubmitting(true);
    try {
      await completePasswordReset({ token: resetToken, newPassword });
      // Remove query parameter from address bar
      if (typeof window !== 'undefined') {
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
      }
      setResetToken(null);
      setLocalStatusMessage({
        type: 'success',
        text: 'Your password has been reset successfully! Please sign in with your username and new password.',
      });
    } catch (err) {
      setResetStatus({
        type: 'error',
        text: err?.message || 'This password reset link is invalid or has expired. Please request a new one.',
      });
    } finally {
      setResetSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100 flex flex-col items-center justify-center p-4 pt-[calc(1rem_+_env(safe-area-inset-top))] pb-[calc(1rem_+_env(safe-area-inset-bottom))]">
      <div className="my-auto flex w-full flex-col items-center justify-center">
      <div className="w-full max-w-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-8">
        <div className="flex flex-col items-center mb-8">
          <div className="mb-3">
            <img
              src={departmentLogoUrl || stationLogoUrl()}
              alt={departmentName ? `${departmentName} Logo` : 'Department Logo'}
              className="w-20 h-20 object-contain"
            />
          </div>
          <h1 className="text-2xl font-bold tracking-wide text-slate-900 dark:text-white">{departmentName || 'Station'}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {resetToken
              ? 'Choose a new password'
              : forgotMode
              ? 'Reset your password'
              : 'Please login to continue'}
          </p>
        </div>

        {/* Following Reset Link Mode */}
        {resetToken ? (
          <div>
            {resetStatus?.text && (
              <div
                className={`mb-6 p-4 rounded-xl flex items-center gap-3 ${
                  resetStatus.type === 'error'
                    ? 'bg-red-50 border border-red-200 text-red-700 dark:bg-red-950/80 dark:border-red-800 dark:text-red-200'
                    : 'bg-emerald-50 border border-emerald-200 text-emerald-700 dark:bg-emerald-950/80 dark:border-emerald-800 dark:text-emerald-200'
                }`}
              >
                {resetStatus.type === 'error' ? <AlertCircle className="w-5 h-5 shrink-0" /> : <CheckCircle className="w-5 h-5 shrink-0" />}
                <p className="text-sm font-medium">{resetStatus.text}</p>
              </div>
            )}

            <form onSubmit={handleResetSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-2">New Password</label>
                <PasswordInput
                  placeholder="Enter new password (min. 8 characters)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  disabled={isBusy}
                  required
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-60"
                />
                <PasswordCrackEstimate password={newPassword} />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-2">Confirm New Password</label>
                <PasswordInput
                  placeholder="Re-enter new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  disabled={isBusy}
                  required
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-60"
                />
              </div>

              <button
                type="submit"
                disabled={isBusy}
                className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-xl transition shadow-lg shadow-red-600/20"
              >
                {resetSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <KeyRound className="w-5 h-5" />}
                {resetSubmitting ? 'Saving New Password...' : 'Save New Password'}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.history.replaceState({}, document.title, window.location.pathname);
                  }
                  setResetToken(null);
                  setResetStatus(null);
                }}
                disabled={isBusy}
                className="w-full flex items-center justify-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 py-2 transition"
              >
                <ChevronLeft className="w-4 h-4" />
                Cancel and return to sign in
              </button>
            </form>
          </div>
        ) : (forgotMode && isForgotPasswordEnabled) ? (
          /* Forgot Password Request Form */
          <div>
            {forgotStatus?.text && (
              <div
                className={`mb-6 p-4 rounded-xl flex items-center gap-3 ${
                  forgotStatus.type === 'error'
                    ? 'bg-red-50 border border-red-200 text-red-700 dark:bg-red-950/80 dark:border-red-800 dark:text-red-200'
                    : 'bg-emerald-50 border border-emerald-200 text-emerald-700 dark:bg-emerald-950/80 dark:border-emerald-800 dark:text-emerald-200'
                }`}
              >
                {forgotStatus.type === 'error' ? <AlertCircle className="w-5 h-5 shrink-0" /> : <CheckCircle className="w-5 h-5 shrink-0" />}
                <p className="text-sm font-medium">{forgotStatus.text}</p>
              </div>
            )}

            {forgotStatus?.type === 'success' ? (
              <div className="space-y-4">
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Please check your inbox (and junk/spam folder) for the reset link. The link remains valid for 30 minutes.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setForgotMode(false);
                    setForgotStatus(null);
                    setForgotEmail('');
                  }}
                  className="w-full flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 font-semibold py-3 px-4 rounded-xl transition"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back to Sign In
                </button>
              </div>
            ) : (
              <form onSubmit={handleForgotSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-2">
                    Registered Email Address
                  </label>
                  <input
                    type="email"
                    placeholder="Enter your email address"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={isBusy}
                    required
                    autoFocus
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-60"
                  />
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    If this matches your member profile, you will receive a secure password reset link.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={isBusy}
                  className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-xl transition shadow-lg shadow-red-600/20"
                >
                  {forgotSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Mail className="w-5 h-5" />}
                  {forgotSubmitting ? 'Sending Link...' : 'Send Reset Link'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setForgotMode(false);
                    setForgotStatus(null);
                  }}
                  disabled={isBusy}
                  className="w-full flex items-center justify-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 py-2 transition"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back to Sign In
                </button>
              </form>
            )}
          </div>
        ) : (
          /* Standard Login Form */
          <div>
            {activeStatusMessage?.text && (
              <div
                className={`mb-6 p-4 rounded-xl flex items-center gap-3 ${
                  activeStatusMessage.type === 'error'
                    ? 'bg-red-50 border border-red-200 text-red-700 dark:bg-red-950/80 dark:border-red-800 dark:text-red-200'
                    : 'bg-emerald-50 border border-emerald-200 text-emerald-700 dark:bg-emerald-950/80 dark:border-emerald-800 dark:text-emerald-200'
                }`}
              >
                {activeStatusMessage.type === 'error' ? (
                  <AlertCircle className="w-5 h-5 shrink-0" />
                ) : (
                  <CheckCircle className="w-5 h-5 shrink-0" />
                )}
                <p className="text-sm font-medium">{activeStatusMessage.text}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-2">Username</label>
                <input
                  type="text"
                  placeholder="Enter your username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={isBusy}
                  required
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-60"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">Password</label>
                  {isForgotPasswordEnabled && (
                    <button
                      type="button"
                      onClick={() => {
                        setForgotMode(true);
                        setForgotStatus(null);
                        setForgotEmail('');
                      }}
                      tabIndex={-1}
                      className="text-xs font-semibold text-red-600 hover:text-red-500 dark:text-red-400 dark:hover:text-red-300 transition"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <PasswordInput
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  disabled={isBusy}
                  required
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-60"
                />
              </div>

              <button
                type="submit"
                disabled={isBusy}
                className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-xl transition shadow-lg shadow-red-600/20"
              >
                {isBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                {isBusy ? 'Signing In...' : 'Sign In'}
              </button>
            </form>
          </div>
        )}
      </div>

      <p className="mt-6 text-xs text-slate-400 dark:text-slate-500 text-center select-none tracking-wide">
        StationSync v{APP_VERSION}
      </p>
      </div>

      <div className="sticky bottom-0 z-10 mt-4 flex items-center justify-center gap-3 rounded-full bg-slate-100/90 px-4 py-1.5 text-xs text-slate-400 backdrop-blur-sm dark:bg-slate-900/90 dark:text-slate-500">
        <button
          type="button"
          onClick={() => setActiveLegalDoc('terms')}
          className="text-xs text-slate-400 hover:text-slate-600 hover:underline dark:text-slate-500 dark:hover:text-slate-300 transition"
        >
          Terms of Service
        </button>
        <span aria-hidden="true" className="select-none">•</span>
        <button
          type="button"
          onClick={() => setActiveLegalDoc('privacy')}
          className="text-xs text-slate-400 hover:text-slate-600 hover:underline dark:text-slate-500 dark:hover:text-slate-300 transition"
        >
          Privacy Policy
        </button>
      </div>

      {activeLegalDoc && LEGAL_DOCUMENTS[activeLegalDoc] && (
        <ViewportModal
          title={LEGAL_DOCUMENTS[activeLegalDoc].title}
          subtitle={LEGAL_DOCUMENTS[activeLegalDoc].subtitle}
          icon={<FileText className="h-5 w-5 text-red-500" />}
          readOnly
          size="large"
          onClose={() => setActiveLegalDoc(null)}
        >
          <Markdown markdown={LEGAL_DOCUMENTS[activeLegalDoc].markdown} />
        </ViewportModal>
      )}
    </div>
  );
}