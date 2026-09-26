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

// The Debug page (System ▸ Debug).
//
// What it is for: the app's feedback layers - toasts, modals, sounds - are the parts nobody can check on demand.
// A member reports "I saved it and nothing happened", and the only way to see it is to save something again; a
// session has to expire before the re-authentication prompt can be looked at; a clock refusal has to be earned by
// standing in the wrong place. This page fires each of them from a button instead, so a station can be walked
// through what it should see and hear in a minute.
//
// Three rules keep it safe to leave on a production station:
//
//   - NOTHING HERE WRITES. No button on this page calls a backend action, so no button can change a row. The two
//     modals that normally submit (the forced password change, the re-authentication prompt) are previews: their
//     own buttons close the preview and send nothing, which is what their handlers below do.
//   - THE CATALOGE IS NOT A SECOND COPY. The toast buttons come from TOAST_SOUNDS and the sound buttons from
//     SOUND_FILES, so a kind or a file added anywhere else in the app appears here by itself. A hand-written list
//     would be out of date the first time somebody added a toast, and wrong in the worst way - a preview page that
//     quietly stops previewing something.
//   - THE PREVIEWS ARE THE REAL COMPONENTS. Every modal below is the app's own component, opened with the props
//     the app passes it, and the clock refusals are run through the same location rules the clock buttons use
//     (evaluateClockLocation, then clockLocationNotice). A mock-up would prove nothing about what the member sees.
//
// What it deliberately does NOT preview: the modals that only mean anything with real data behind them (the
// schedule item details and the offer-to-fill prompt). They need a shift, a date and an assignment, so opening
// them here would mean inventing a fake shift and showing a station something that is not in its schedule. They
// are checked where they are used instead.


// Where the page's data lives: utils/debugPage. The preview list, the clock refusals (run through the real
// location rules, so their wording and numbers are the ones the clock produces) and the toast wording are all
// there, because they are pure decisions worth testing without a browser - and because a component file that also
// exports constants turns Fast Refresh off for the whole module.

// The icons the toast buttons carry, by kind. Looked up from the kind rather than written beside each button, so the
// order and the verbs cannot drift apart.
const TOAST_ICONS = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
  message: MessageSquare,
  loading: Loader2,
};

// The page itself.
//
// Every preview is state, and only one is open at a time: two dialogs stacked on each other is a state the app
// never shows, and it is the app's real states this page exists to show.
export default function AdminDebugTab({ systemSettings = [] }) {
  const [preview, setPreview] = useState(null);
  const [longMessages, setLongMessages] = useState(false);
  // The level of every sound, read back from the engine after each change rather than computed here: the sliders
  // then cannot show a level other than the one that will be played.
  const [volumeRows, setVolumeRows] = useState(() => soundVolumeRows());

  // The overlay clears itself, like the real one: it is a preloader, not a dialog waiting to be dismissed.
  useEffect(() => {
    if (preview !== 'overlay') return undefined;
    const timer = setTimeout(() => setPreview(null), OVERLAY_PREVIEW_MS);
    return () => clearTimeout(timer);
  }, [preview]);

  const close = () => setPreview(null);
  const loadingMessage = debugLoadingMessage(systemSettings);
  const notices = clockNoticePreviews();

  // One toast, through the app's own wrapper - so the sound that comes out is the one a member would hear for that
  // kind, which is half of what this page is for.
  //
  // Loading is the exception: it reports progress and is then replaced by its own outcome, because a loading toast
  // that never resolves is not a state the app is ever in.
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

  // Levels. Applied to the engine as the slider moves - the app genuinely plays at the next level straight away -
  // and then read straight back, so the row can only ever show what the engine holds.
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
      {/* What this page is, and the two limits on it: it writes nothing, and it previews the app's real
          components rather than mock-ups. */}
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

      {/* Toasts. The kinds are read off TOAST_SOUNDS rather than listed here, so a kind added to the wrapper
          turns up as a button without anybody remembering to add one. */}
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

      {/* Dialogs and overlays. The buttons come from DEBUG_PREVIEWS and the rendering below is driven by the same
          list, so a preview cannot be listed here without working. */}
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

      {/* Sounds. Every file the app ships, played through the engine, so an earcon can be checked by ear without
          waiting for the event that triggers it.

          `data-sound="none"` is what makes this a test rather than a guess: the delegated listener silences the
          press itself, so the only thing heard is the sample. Without it, pressing "click_double" would play a
          click first and leave you wondering which of the two you were hearing.

          `force` plays past the mute gate on purpose - the point of the button is to hear a sound on a station
          whose sounds have been switched off. */}
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

            {/* The level sliders. Deliberately NOT saved anywhere: a level is a thing to try, so it lives in the
                engine's memory for this session and is dropped when the session ends. */}
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
                      // Silent itself, like the sound buttons: the press must not play a click at the level being
                      // judged. The sample plays on release instead - see the handlers below.
                      data-sound="none"
                      aria-label={`Volume for ${row.name}`}
                      onChange={(event) => applyVolume(row.name, event.target.value)}
                      // On RELEASE, not on every move: a slider that made noise continuously while being dragged
                      // would be unusable, and one that made none would be a guess. This covers a mouse, a finger
                      // and the arrow keys.
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

      {/* The previews. Each one is the app's own component with the props the app gives it - see the header. The
          overlay is last because it is the only one that covers the page rather than sitting on top of it. */}

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
          // A preview cannot verify a password - there is no session behind it. Refusing, with the reason, is the
          // honest answer: it is also the error state a member sees when the credentials they typed are wrong.
          onReauth={async () => ({
            success: false,
            message: 'This is a preview: no password is checked here. Close it with the button below.',
          })}
          onSignOut={close}
        />
      )}

      {preview === 'password-change' && (
        <PasswordChangeModal
          // The same: a preview cannot change a password, and must not look as if it had.
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

