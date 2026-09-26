// The Debug page's data: which previews exist, what they are built from, and the wording of a test toast. Pure, and
// separate from the component for the same reason utils/soundRules is separate from utils/uiSounds - the decisions
// are the part worth testing without a browser, and a component file that also exports constants breaks Fast
// Refresh for the whole module.
//
// Everything here is DERIVED from rules that already exist, deliberately:
//
//   - The clock refusals are run through evaluateClockLocation and clockLocationNotice, so their wording and their
//     numbers (how far away, what the limit is) are the ones the clock buttons produce. A hand-written copy would
//     be free to drift from both.
//   - The toast wording is built from the kind, so the buttons cannot disagree with each other.
//
// The component reads the rest of its catalog straight from the engine: the toast buttons come from TOAST_SOUNDS
// and the sound buttons from SOUND_FILES, so a kind or a file added to the app turns up on the page by itself.

import { clockLocationNotice, evaluateClockLocation } from './clockLocation';
import { getLoadingMessages } from './systemSettings';

// How long the overlay preview stays up. A preloader is shown while a wave runs, so a flash would not preview
// anything - this is about the shortest real wave that shows it.
export const OVERLAY_PREVIEW_MS = 3000;

// The station's loading messages, so the overlay says what the app would actually say. Falls back to the app's own
// default when the messages have never been set, which is also what the real overlay does.
export const debugLoadingMessage = (systemSettings) => {
  const configured = getLoadingMessages(systemSettings)
    .map((message) => String(message.value || '').trim())
    .find(Boolean);
  return configured || 'Communicating with server...';
};

// The coordinates are the only invented part of a clock preview: a member standing about 1,280ft from the station on
// the equator. The config is fixed rather than read from the station's settings on purpose - a station with no
// geofence configured is exactly the station that has never seen this dialog, so the preview has to work there too.
export const DEBUG_CLOCK_CONFIG = { configured: true, latitude: 0, longitude: 0, marginFeet: 500 };
export const DEBUG_CLOCK_FAR_AWAY = { latitude: 0, longitude: 0.0035 };

export const clockNoticePreviews = () => ({
  tooFar: clockLocationNotice(evaluateClockLocation(DEBUG_CLOCK_FAR_AWAY, DEBUG_CLOCK_CONFIG), DEBUG_CLOCK_CONFIG),
  noLocation: clockLocationNotice(evaluateClockLocation(null, DEBUG_CLOCK_CONFIG), DEBUG_CLOCK_CONFIG),
});

// Every modal and overlay the page can open. ONE list, used both for the buttons and for what is rendered, so a
// preview can never be listed without working - and the verifier asserts every id here reaches the page.
export const DEBUG_PREVIEWS = [
  {
    id: 'confirm-danger',
    label: 'Confirmation, destructive',
    description: 'The dialog every delete and remove goes through. Opens on the confirm tone.',
  },
  {
    id: 'confirm-default',
    label: 'Confirmation, not a warning',
    description: 'The same dialog for something that is not destructive: only the button color differs.',
  },
  {
    id: 'clock-too-far',
    label: 'Clock refused: too far away',
    description: 'A clock action the station refused on location, with the distance and the limit.',
  },
  {
    id: 'clock-no-location',
    label: 'Clock refused: no location',
    description: 'What a member sees when the browser will not give their position.',
  },
  {
    id: 'reauth',
    label: 'Session expired',
    description: 'The re-authentication prompt, with the reason line the app builds when a request is refused.',
  },
  {
    id: 'password-change',
    label: 'Forced password change',
    description: 'The prompt a member with must_change_password sees, and cannot dismiss.',
  },
  {
    id: 'overlay',
    label: `Loading overlay (${OVERLAY_PREVIEW_MS / 1000}s)`,
    description: 'The preloader shown while a request runs, saying the station\u2019s own loading message.',
  },
];

// A long message, on demand. Toast wording is usually short, so the interesting case - a server refusal that wraps
// to three lines on a phone, and whether the dismiss button stays reachable - is otherwise impossible to see.
export const DEBUG_LONG_MESSAGE =
  'This is a deliberately long message, to show how a toast wraps when the text is longer than the box it is ' +
  'given, which is what a server refusal looks like when it names the field, the row and the rule it broke.';

export const debugToastMessage = (kind, { long = false } = {}) =>
  long
    ? `A test ${kind} toast, deliberately long: ${DEBUG_LONG_MESSAGE}`
    : `A test ${kind} toast, from the Debug page.`;
