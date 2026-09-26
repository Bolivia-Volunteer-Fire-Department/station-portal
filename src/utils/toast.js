// Toasts, with their sounds.
//
// A drop-in replacement for sonner's `toast`, with the same shape: call it directly for the plain variant, or use
// .success/.error/.info/.warning/.loading/.message/.dismiss. The only difference is that each call plays the
// sound utils/uiSounds maps to that kind first, which is why every toast in the app gets an earcon for free.
//
// The mapping is by KIND, never by message text, so a toast cannot end up with the wrong sound because its
// wording changed. Anything unrecognised - including a kind added to the wrapper later and forgotten here -
// falls back to toast_normal, per the "when in doubt, normal" rule.
//
// Import `toast` from HERE rather than from 'sonner'. The verifier fails if any other file imports it directly,
// because that is exactly how a toast would quietly lose its sound.
import { toast as sonnerToast } from 'sonner';
import { playSound, toastSoundFor, SOUND_FILES } from './uiSounds';

export { toastSoundFor };

// Loading toasts are re-fired on every progress tick (the refresh wave reports "3 of 10 done…", "7 of 10 done…"
// through the same id), and each of those would replay the sound. Announced ids are remembered so one wave makes
// one noise; the set is bounded because a long session would otherwise accumulate ids for the rest of the day.
const announcedLoading = new Set();
const ANNOUNCED_LOADING_LIMIT = 50;

const soundFirst = (kind, run) => (...args) => {
  playSound(toastSoundFor(kind));
  return run(...args);
};

const loading = (message, options) => {
  const id = options?.id;
  if (id === undefined || !announcedLoading.has(id)) {
    playSound(toastSoundFor('loading'));
    if (id !== undefined) {
      announcedLoading.add(id);
      if (announcedLoading.size > ANNOUNCED_LOADING_LIMIT) {
        announcedLoading.delete(announcedLoading.values().next().value);
      }
    }
  }
  return sonnerToast.loading(message, options);
};

// The plain call, i.e. `toast('Saved')`.
const plain = (...args) => {
  playSound(toastSoundFor('message'));
  return sonnerToast(...args);
};

export const toast = Object.assign(plain, {
  success: soundFirst('success', sonnerToast.success),
  error: soundFirst('error', sonnerToast.error),
  info: soundFirst('info', sonnerToast.info),
  warning: soundFirst('warning', sonnerToast.warning),
  message: soundFirst('message', sonnerToast.message),
  loading,
  // Dismissing is not an event the member caused with a control; it takes no sound.
  dismiss: (...args) => sonnerToast.dismiss(...args),
});

// A push notification that arrives while the member is looking at the app. It surfaces as a toast (the OS
// notification is drawn separately, and on some desktops is suppressed entirely), and it gets the notification
// sound rather than a toast one - the member is being told something happened, not that something they did
// worked.
export const notificationToast = (title, options) => {
  playSound('notification');
  return sonnerToast.message(title, options);
};

// Whether the notification sound is available at all. Used by the verifier to prove the asset is wired, rather
// than only that some sound is wired.
export const notificationSoundAvailable = () => !!SOUND_FILES.notification;
