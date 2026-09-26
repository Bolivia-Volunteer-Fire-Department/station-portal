// The app's sounds: the engine.
//
// The RULES live in utils/soundRules - which sound a press makes, which tone a modal opens with, which setting
// wins - because those are pure decisions worth testing without a browser. This file is the other half: the
// Audio elements, the mute gate, and the one set of delegated listeners the whole app is covered by.
//
// Nine files, four uses:
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
// and truncates the previous play.
const POOL_SIZE = 3;
const pools = new Map();
let poolCursor = 0;

const audioFor = (name) => {
  if (pools.has(name)) return pools.get(name);
  const url = SOUND_FILES[name];
  if (!url || typeof Audio === 'undefined') return null;
  const voices = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const audio = new Audio(url);
    audio.preload = 'auto';
    audio.volume = SOUND_VOLUME[name] ?? SOUND_VOLUME.default;
    voices.push(audio);
  }
  pools.set(name, voices);
  return voices;
};

// Plays one sound. Silent - and harmless - when sounds are off, the name is unknown, or the browser refuses to
// start audio; none of which is worth surfacing, since every sound here is decoration.
//
// `force` bypasses the mute gate for the sounds toggle's own feedback, which has to be heard on the way ON - the
// one moment the member is listening for a result while sound is still switched off. It is a flag on this call
// rather than a check at the call site because the state lives here.
export const playSound = (name, { force = false } = {}) => {
  if (!force && !soundsEnabled) return false;

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

