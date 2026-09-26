// The app's sounds: the engine.
//
// The RULES live in utils/soundRules - which sound a press makes, which tone a modal opens with, which setting
// wins - because those are pure decisions worth testing without a browser. This file is the other half: the
// Audio elements, the mute gate, and the one set of delegated listeners the whole app is covered by.
//
// Ten files, four uses:
//
//   - Clicks. ONE delegated listener on the document, not 145 call sites. Every button, switch, pill, menu item
//     and dropdown is covered by CLICKABLE_SELECTOR, including ones added later, which is the point: a sound per
//     component would rot the first time somebody adds a control and forgets the sound. Pills are the reason
//     grab/release are separate events rather than one per click - see createPressTracker.
//   - Modals. An opening tone from MODAL_SOUNDS, played by each modal component as it mounts.
//   - Toasts. Wrapped in utils/toast, so the mapping lives in one place.
//   - Push notifications. notification.mp3, played where the in-app toast is raised (App.jsx).
//
// The Firefighter Runner is left alone: it has its own sounds, and its root carries data-sound="none" so the UI
// click does not intrude on them. Nothing here is imported by the minigame.
//
// Each sound is fetched ONCE per session, and every voice plays from those bytes - see the pool below, which used
// to download each sound three times over.

import clickSound from '../assets/click.mp3';
import clickDoubleSound from '../assets/click_double.mp3';
import modalErrorSound from '../assets/modal_error.mp3';
import modalPositiveSound from '../assets/modal_positive.mp3';
import notificationSound from '../assets/notification.mp3';
import soundOffSound from '../assets/sound_off.mp3';
import soundOnSound from '../assets/sound_on.mp3';
import toastErrorSound from '../assets/toast_error.mp3';
import toastNormalSound from '../assets/toast_normal.mp3';
import toastSuccessSound from '../assets/toast_success.mp3';
import {
  SOUND_VOLUME,
  SOUNDS_DEFAULT,
  createPressTracker,
} from './soundRules';

// Every sound the app can play, by name. Imported rather than referenced by path so Vite fingerprints and bundles
// them, and so a missing or renamed file fails the build instead of 404ing at the moment it is needed.
//
// The keys are REQUIRED_SOUNDS from utils/soundRules, and the verifier checks these two lists against each other
// and against the files on disk.
export const SOUND_FILES = {
  click: clickSound,
  click_double: clickDoubleSound,
  modal_positive: modalPositiveSound,
  modal_error: modalErrorSound,
  notification: notificationSound,
  sound_on: soundOnSound,
  sound_off: soundOffSound,
  toast_success: toastSuccessSound,
  toast_error: toastErrorSound,
  toast_normal: toastNormalSound,
};

// Everything else a call site needs, re-exported so a component imports one module rather than two.
export {
  SOUNDS_SETTING_KEY,
  SOUNDS_DEFAULT,
  REQUIRED_SOUNDS,
  CLICKABLE_SELECTOR,
  SOUND_DIRECTIVES,
  MODAL_SOUNDS,
  MODAL_TONE_FILES,
  TOAST_SOUNDS,
  soundsActiveFrom,
  soundDirectiveFor,
  isClickableElement,
  soundForPress,
  modalSoundFor,
  toastSoundFor,
  movedEnoughToBeADrag,
} from './soundRules';


// ---------------------------------------------------------------------------
// Playing
// ---------------------------------------------------------------------------
// Module state, read by every play. Set from App.jsx whenever the resolved setting changes.
let soundsEnabled = SOUNDS_DEFAULT;

export const setSoundsEnabled = (enabled) => {
  soundsEnabled = enabled === true;
  return soundsEnabled;
};

// One pool per sound, so that rapid clicks overlap instead of cutting each other off: a single element restarts
// and truncates the previous play. Three voices is the right number of ELEMENTS - but three `new Audio(url)`
// elements each fetch the file, which is what a session's network log showed: a 206 for the first and two 304
// revalidations for the others, three requests for one sound, every time it was used.
//
// So the bytes are fetched once and every voice is built from that in-memory copy. The one press that cannot wait
// for it is the FIRST press of a sound, before the copy has arrived: that press plays from the file itself, inside
// the same gesture, while the copy is fetched alongside it. The click sounds are primed on the first gesture of the
// session, so that window is normally already closed by the time anything is pressed.
//
// A pool is only ever built AFTER its sound's answer is known - `playSound` stays in the pre-prime branch until it
// is - so the voices are created from the copy when there is one and from the file when there is not, and nothing
// has to be re-pointed afterwards.
const POOL_SIZE = 3;
const pools = new Map();
let poolCursor = 0;

// name -> object URL once the bytes are in hand, or null when the fetch failed. A null is REMEMBERED: an asset that
// could not be fetched must not be re-fetched on every press.
const blobUrls = new Map();
const blobPromises = new Map();

// Declared below the maps it reads, for the same reason App.jsx's derived values are: a `const` that mentions
// `blobUrls` before that `const` has run throws, and it would throw on the first press of a sound.
const objectUrlFor = (name) => blobUrls.get(name) || SOUND_FILES[name];

// Fetches a sound's bytes once, so that the voices built afterwards play from memory rather than from the file.
// Idempotent, and never awaited by a press.
export const primeSound = (name) => {
  if (blobUrls.has(name)) return Promise.resolve(blobUrls.get(name));
  if (blobPromises.has(name)) return blobPromises.get(name);

  const url = SOUND_FILES[name];
  const canFetch =
    !!url && typeof fetch === 'function' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
  if (!canFetch) {
    blobUrls.set(name, null);
    return Promise.resolve(null);
  }

  const promise = fetch(url)
    .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(String(response.status)))))
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      blobUrls.set(name, objectUrl);
      return objectUrl;
    })
    .catch(() => {
      // Offline, or the asset is missing: the voices keep playing from the file, exactly as they did before, and
      // no further fetches are attempted.
      blobUrls.set(name, null);
      return null;
    })
    .finally(() => blobPromises.delete(name));

  blobPromises.set(name, promise);
  return promise;
};

const audioFor = (name) => {
  if (pools.has(name)) return pools.get(name);
  const source = objectUrlFor(name);
  if (!source || typeof Audio === 'undefined') return null;
  const voices = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const audio = new Audio(source);
    audio.preload = 'auto';
    audio.volume = SOUND_VOLUME[name] ?? SOUND_VOLUME.default;
    voices.push(audio);
  }
  pools.set(name, voices);
  return voices;
};

// The two sounds a first press is most likely to make, fetched as soon as the member touches anything. In capture
// phase and once-only, so it costs nothing after the first gesture and cannot delay the press itself.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  const primeClickSounds = () => {
    void primeSound('click');
    void primeSound('click_double');
  };
  document.addEventListener('pointerdown', primeClickSounds, { once: true, capture: true });
  document.addEventListener('keydown', primeClickSounds, { once: true, capture: true });
}


// Plays one sound. Silent - and harmless - when sounds are off, the name is unknown, or the browser refuses to
// start audio; none of which is worth surfacing, since every sound here is decoration.
//
// `force` bypasses the mute gate for the sounds toggle's own feedback, which has to be heard on the way ON - the
// one moment the member is listening for a result while sound is still switched off. It is a flag on this call
// rather than a check at the call site because the state lives here.
export const playSound = (name, { force = false } = {}) => {
  if (!force && !soundsEnabled) return false;
  if (!SOUND_FILES[name]) return false;

  // The first press of a sound, before its in-memory copy has arrived: play it from the file, in this gesture, and
  // fetch the copy so that every press after it is served from memory. That is the whole cost of a sound - two
  // requests on its first press, then none, ever - instead of the three the pool used to spend on every press.
  if (!blobUrls.has(name)) {
    if (typeof Audio === 'undefined') return false;
    try {
      const oneOff = new Audio(SOUND_FILES[name]);
      oneOff.volume = SOUND_VOLUME[name] ?? SOUND_VOLUME.default;
      const started = oneOff.play();
      if (started && typeof started.catch === 'function') started.catch(() => {});
    } catch {
      return false;
    }
    void primeSound(name);
    return true;
  }

  const voices = audioFor(name);
  if (!voices) return false;

  const audio = voices[poolCursor % voices.length];
  poolCursor += 1;
  try {
    audio.currentTime = 0;
    const started = audio.play();
    if (started && typeof started.catch === 'function') started.catch(() => {});
  } catch {
    return false;
  }
  return true;
};


// ---------------------------------------------------------------------------
// The listeners
// ---------------------------------------------------------------------------
// Installed once, from App.jsx, and removed when it unmounts. Everything is delegated, so no component has to
// know this feature exists in order to make a sound, and everything is in CAPTURE phase because a press that a
// handler stops from propagating is still a press the member made.
//
// The decisions themselves live in createPressTracker (utils/soundRules) - which event means grab, which means
// release, which means nothing - and are tested there. This is the wiring.
export const installUiSoundListeners = (target = typeof document === 'undefined' ? null : document) => {
  if (!target || typeof target.addEventListener !== 'function') return () => {};

  const tracker = createPressTracker((name, options) => playSound(name, options));
  const pairs = [
    ['pointerdown', tracker.onPointerDown],
    ['pointerup', tracker.onPointerUp],
    // A touch that becomes a scroll arrives as pointercancel, not pointerup. Without this the press stays pending
    // and the next release anywhere on the screen plays the sound the scroll was owed.
    ['pointercancel', tracker.onPointerCancel],
    ['dragstart', tracker.onDragStart],
    ['dragend', tracker.onDragEnd],
    ['change', tracker.onChange],
  ];

  pairs.forEach(([event, handler]) => target.addEventListener(event, handler, true));
  return () => pairs.forEach(([event, handler]) => target.removeEventListener(event, handler, true));
};

