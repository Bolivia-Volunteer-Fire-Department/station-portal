import React, { useEffect, useState } from 'react';
import {
  FlaskConical, Bell, Volume2, Layers, MousePointerClick, Trash2, Ear,
  CheckCircle2, XCircle, AlertTriangle, Info, MessageSquare, Loader2,
} from 'lucide-react';
import { toast, notificationToast } from '../../utils/toast';
import { playSound, SOUND_FILES, TOAST_SOUNDS, soundVolumeRows, setSoundVolume, resetSoundVolumes, SOUND_VOLUME_STEP } from '../../utils/uiSounds';
import {
  DEBUG_PREVIEWS,
  OVERLAY_PREVIEW_MS,
  clockNoticePreviews,
  debugLoadingMessage,
  debugToastMessage,
} from '../../utils/debugPage';
import ConfirmModal from '../ConfirmModal';
import LoadingOverlay from '../LoadingOverlay';
import ReauthModal from '../ReauthModal';
import PasswordChangeModal from '../PasswordChangeModal';
import ClockBlockedModal from '../ClockBlockedModal';

// System Debug Tab: lets administrators preview app sounds, alerts, and modal popups on demand without changing any real data.

// Map each toast type to its icon.
const TOAST_ICONS = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
  message: MessageSquare,
  loading: Loader2,
};

// Main debug tab component.
export default function AdminDebugTab({ systemSettings = [] }) {
  const [preview, setPreview] = useState(null);
  const [longMessages, setLongMessages] = useState(false);
  // Track volume level for each sound.
  const [volumeRows, setVolumeRows] = useState(() => soundVolumeRows());

  // Close the loading overlay preview after a brief timeout.
  useEffect(() => {
    if (preview !== 'overlay') return undefined;
    const timer = setTimeout(() => setPreview(null), OVERLAY_PREVIEW_MS);
    return () => clearTimeout(timer);
  }, [preview]);

  const close = () => setPreview(null);
  const loadingMessage = debugLoadingMessage(systemSettings);
  const notices = clockNoticePreviews();

  // Trigger a test toast alert.
  const fireToast = (kind) => {
    const message = debugToastMessage(kind, { long: longMessages });
    const options = { description: 'Fired from Administration ▸ System ▸ Debug.' };

    if (kind === 'loading') {
      const id = 'debug-progress';
      toast.loading(message, { ...options, id });
      setTimeout(() => toast.success('The test finished.', { ...options, id }), 2500);
      return;
    }

    toast[kind](message, options);
  };

  // Update sound volume and refresh current state.
  const applyVolume = (name, value) => {
    setSoundVolume(name, value);
    setVolumeRows(soundVolumeRows());
  };

  const resetLevels = () => {
    resetSoundVolumes();
    setVolumeRows(soundVolumeRows());
  };

  return (
    <div className="space-y-6">
      {/* Overview card */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl p-6">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300 shrink-0">
            <FlaskConical className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Debug</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Fires the app&rsquo;s own feedback on demand: the toasts, dialogs and sounds that are otherwise only
              seen when something really happens.
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Nothing here writes. No button on this page can change a row, and the dialogs that normally submit
              close themselves instead of sending.
            </p>
          </div>
        </div>
      </div>

      {/* Toast alert buttons */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl p-6">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300 shrink-0">
            <Bell className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Toasts</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Each button fires the app&rsquo;s own toast wrapper, so the sound that comes with it is the one a
              member would hear for that kind.
            </p>

            <label className="mt-3 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={longMessages}
                onChange={(event) => setLongMessages(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-red-600 focus:ring-red-500"
              />
              Use a long message, to see how a notification wraps
            </label>

            <div className="mt-4 flex flex-wrap gap-2">
              {Object.keys(TOAST_SOUNDS).map((kind) => {
                const Icon = TOAST_ICONS[kind] || Info;
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => fireToast(kind)}
                    className="flex items-center gap-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-medium text-sm px-4 py-2 rounded-xl transition"
                  >
                    <Icon className="w-4 h-4" />
                    {kind}
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() =>
                  notificationToast('Test notification', {
                    description: 'What an in-app push notification looks like while the app is open.',
                  })
                }
                className="flex items-center gap-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-medium text-sm px-4 py-2 rounded-xl transition"
              >
                <Bell className="w-4 h-4" />
                push notification
              </button>

              <button
                type="button"
                onClick={() => toast.dismiss()}
                className="flex items-center gap-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-medium text-sm px-4 py-2 rounded-xl transition"
              >
                <Trash2 className="w-4 h-4" />
                dismiss them all
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Dialogs and modal previews */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl p-6">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300 shrink-0">
            <Layers className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Dialogs and overlays</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              The dialogs the app opens over the page, including the two it opens without asking &mdash; a dead
              session and a forced password change. Each one opens on its own tone.
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              The buttons INSIDE these previews close the preview: none of them sends anything, because none of them
              is attached to a session or a password here.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {DEBUG_PREVIEWS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  data-debug-preview={entry.id}
                  onClick={() => setPreview(entry.id)}
                  title={entry.description}
                  className="flex items-center gap-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-medium text-sm px-4 py-2 rounded-xl transition"
                >
                  <MousePointerClick className="w-4 h-4" />
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Sound effect previews */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl p-6">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300 shrink-0">
            <Volume2 className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Sounds</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Every file the app plays, by name. These buttons play even when sounds are switched off, and they are
              silent themselves &mdash; what you hear is the sample and nothing else.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {Object.keys(SOUND_FILES).map((name) => (
                <button
                  key={name}
                  type="button"
                  data-sound="none"
                  onClick={() => playSound(name, { force: true })}
                  className="flex items-center gap-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-medium text-sm px-4 py-2 rounded-xl transition"
                >
                  <Ear className="w-4 h-4" />
                  {name}
                </button>
              ))}
            </div>

            {/* Note about login sound */}
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium text-slate-600 dark:text-slate-300">The welcome</span> is the one sound that cannot be
              tested in place: <span className="font-mono">intro_short</span> plays on every sign-in, once the form is submitted.
              To hear it where it belongs, sign out and sign back in &mdash; the button above plays the file itself.
            </p>

            {/* Sound volume sliders (session only, not saved) */}
            <div className="mt-6 border-t border-slate-200 dark:border-slate-700 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Levels
                </h4>
                <button
                  type="button"
                  onClick={resetLevels}
                  className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                >
                  reset all levels
                </button>
              </div>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Temporary, for this session only: nothing is saved to the sheet, and every level goes back to the
                app&rsquo;s own mix when you sign out. A level set here is used everywhere the app plays that sound,
                so move a slider and then press its button above to hear it.
              </p>

              <div className="mt-4 space-y-2">
                {volumeRows.map((row) => (
                  <div key={row.name} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="w-36 shrink-0 font-mono text-xs text-slate-600 dark:text-slate-300">
                      {row.name}
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step={SOUND_VOLUME_STEP}
                      value={row.volume}
                      data-sound="none"
                      aria-label={`Volume for ${row.name}`}
                      onChange={(event) => applyVolume(row.name, event.target.value)}
                      // Play sound sample when user releases the slider
                      onPointerUp={() => playSound(row.name, { force: true })}
                      onKeyUp={() => playSound(row.name, { force: true })}
                      className="h-2 w-40 accent-red-600"
                    />
                    <span className="w-10 shrink-0 text-right text-xs tabular-nums text-slate-600 dark:text-slate-300">
                      {Math.round(row.volume * 100)}%
                    </span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      ships at {Math.round(row.shipped * 100)}%
                      {row.shippedFrom === 'default' ? ' (shared default)' : ` (${row.shippedFrom})`}
                    </span>
                    {row.overridden && (
                      <button
                        type="button"
                        onClick={() => applyVolume(row.name, row.shipped)}
                        className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                      >
                        reset
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal and overlay previews */}

      {preview === 'confirm-danger' && (
        <ConfirmModal
          title="Delete this training?"
          message={
            <>
              Its signatures would go with it, and that cannot be undone. Nothing is deleted from this page &mdash;
              this is a preview.
            </>
          }
          confirmLabel="Delete"
          onConfirm={() => {
            close();
            toast.success('The preview confirmed. Nothing was deleted.');
          }}
          onCancel={() => {
            close();
            toast.message('The preview was canceled.');
          }}
        />
      )}

      {preview === 'confirm-default' && (
        <ConfirmModal
          tone="default"
          title="Publish this announcement?"
          message="Everyone who has notifications switched on would be told about it."
          confirmLabel="Publish"
          onConfirm={() => {
            close();
            toast.success('The preview confirmed. Nothing was published.');
          }}
          onCancel={() => {
            close();
            toast.message('The preview was canceled.');
          }}
        />
      )}

      {preview === 'clock-too-far' && notices.tooFar && (
        <ClockBlockedModal
          notice={notices.tooFar}
          onDismiss={() => {
            close();
            toast.message('The preview was dismissed.');
          }}
        />
      )}

      {preview === 'clock-no-location' && notices.noLocation && (
        <ClockBlockedModal
          notice={notices.noLocation}
          onDismiss={() => {
            close();
            toast.message('The preview was dismissed.');
          }}
        />
      )}

      {preview === 'reauth' && (
        <ReauthModal
          reason={{ action: 'ADMIN_SAVE_USER', ageSeconds: 61, tokenTail: 'AB12CD' }}
          // Preview only: simulate a cancelled or rejected password check
          onReauth={async () => ({
            success: false,
            message: 'This is a preview: no password is checked here. Close it with the button below.',
          })}
          onSignOut={close}
        />
      )}

      {preview === 'password-change' && (
        <PasswordChangeModal
          // Preview only: simulate a rejection without modifying passwords
          onPasswordChange={async () => ({
            success: false,
            message: 'This is a preview: no password is changed here. Close it with the button below.',
          })}
          onSignOut={close}
        />
      )}

      {preview === 'overlay' && <LoadingOverlay isLoading message={loadingMessage} />}
    </div>
  );
}

