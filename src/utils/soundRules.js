// When the app makes a noise, and which noise. Pure decisions only - no React, no Audio, no asset imports - so
// these can be exercised directly (scripts/verify-sounds.mjs) and so a component can ask a question about sound
// without pulling the sound files into its bundle.
//
// utils/uiSounds plays what these functions choose: it owns the Audio elements, the mute gate and the delegated
// listeners. The split is deliberate - the interesting part is the DECISION (which press makes which noise, which
// modal opens on which tone, which setting wins), and that part is pure.

// ---------------------------------------------------------------------------
// The sounds the app must have
// ---------------------------------------------------------------------------
// The contract between this module and src/assets: every name here is a file of the same name, and
// utils/uiSounds imports exactly these. A name with no file breaks the build; a file with no name is silent
// forever, and that is the failure this list exists to catch.
export const REQUIRED_SOUNDS = [
  'click',
  'click_double',
  'modal_positive',
  'modal_error',
  'notification',
  'sound_on',
  'sound_off',
  'toast_success',
  'toast_error',
  'toast_normal',
  // CHAT'S SIX, and they are app sounds rather than a module's own: a message arriving is the same kind of event as a
  // toast or a push, so they belong in the one engine - fetched once each, listed on the Debug page's mix sliders, and
  // silenced by the member's own sound setting like everything else here. WHICH one a moment makes is a pure decision in
  // utils/chatSounds.js; this list is only the contract that the files exist and the engine knows them.
  //
  // (The Firefighter Runner is the exception and keeps its own, because it is a game with its own volume, its own mute
  // button and its own music - see the note at the top of utils/uiSounds.js.)
  'chat_open',
  'chat_close',
  'chat_enter',
  'chat_exit',
  'chat_notify',
  'chat_send',
  // THE STATION'S WELCOME, played once per device as the boot screen clears after a sign-in. See utils/firstVisit.js for why
  // it is per device and why it waits for a sign-in rather than a restored session.
  'intro_short',
];

// FILES THAT ARE IN THE TREE ON PURPOSE, WITHOUT A NAME IN THE CONTRACT ABOVE.
//
// The check in scripts/verify-sounds.mjs exists for one failure: a sound added to src/assets that nobody ever wired to a
// name, which would sit there for ever, silent, and be mentioned nowhere. This list is how a deliberate one is told apart
// from an accidental one - every entry has to say WHY, and the verifier refuses an entry that is empty, that names something
// already in the contract, or whose file is not actually there. A name in both places is a contradiction rather than an
// allowance, and that is checked rather than trusted.
export const UNWIRED_SOUNDS = {
  // Wanted, not built yet: the sound for a Firefighter Runner achievement. The idea is not settled - which achievements get
  // one, and whether it competes with the leaderboard's own noises - so the file waits in the tree until it is.
  achievement: 'a Firefighter Runner achievement tone, waiting on a decided design',
};

// Mix levels. A click fires on every single tap, so it sits well below the one-shot sounds - at the same level it
// reads as noisy rather than responsive. Change them here, not at the call sites.
//
// `click_double` is the heavier sibling played for consequential, infrequent actions (see IMPACT_VERBS below): more
// present than the everyday click, because it is confirming something that mattered, but still under the one-shots.
export const SOUND_VOLUME = {
  click: 0.15,
  click_double: 0.25,
  sound_on: 0.4,
  sound_off: 0.4,
  // CHAT, mixed by what each one is for rather than by how it sounds.
  //
  // `chat_notify` is the loudest of the six and the loudest thing in this table: it means "somebody is talking to you and
  // you are not looking at it", which is the one chat sound that has to be heard over whatever else is going on.
  // `chat_send` is the opposite case - it fires on every message in a conversation you ARE watching, so it sits down
  // near the click, where a busy room reads as a busy room rather than as an alarm.
  //
  // `chat_open` and `chat_close` are navigation: quieter than a notification and quieter than the entry and exit tones,
  // which are about people rather than about the screen you are on.
  chat_notify: 0.6,
  chat_send: 0.3,
  chat_open: 0.35,
  chat_close: 0.35,
  chat_enter: 0.25,
  chat_exit: 0.15,
  // The welcome: louder than a click, quieter than a notification. It is the one sound in the app nobody asked for, so it
  // should be heard without arriving as an alarm.
  intro_short: 0.45,
  default: 0.4,
};

// The range a level may take, and the step the Debug page's sliders move in. 5% is fine enough to hear the
// difference between two positions and coarse enough to land on a round number nobody has to type.
export const SOUND_VOLUME_MIN = 0;
export const SOUND_VOLUME_MAX = 1;
export const SOUND_VOLUME_STEP = 0.05;

// A level from anywhere - a slider, a session override, a mistake - forced into the range every Audio element
// accepts. A value that is not a number at all falls back to the shipped default rather than to silence: an
// unreadable level must not be the one that turns a sound off.
export const clampSoundVolume = (value) => {
  const number = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(number)) return SOUND_VOLUME.default;
  return Math.min(SOUND_VOLUME_MAX, Math.max(SOUND_VOLUME_MIN, number));
};

// The level a sound plays at: the session's override when the Debug page has set one, the shipped mix otherwise.
// `overrides` is what utils/uiSounds holds, and is a Map there and a plain object everywhere it is tested.
export const soundVolumeFor = (name, overrides) => {
  const override = overrides instanceof Map ? overrides.get(name) : overrides && overrides[name];
  if (override !== undefined && override !== null) return clampSoundVolume(override);
  return clampSoundVolume(SOUND_VOLUME[name] ?? SOUND_VOLUME.default);
};

// One row per sound the app ships, for the Debug page's level sliders: the level in force, the level it ships with,
// whether the two differ (so a moved sound is visible as one and can be put back on its own), and where its shipped
// level comes from - its own entry in the table above, or the shared `default` the one-shot sounds use.
export const soundVolumeRows = (overrides) =>
  REQUIRED_SOUNDS.map((name) => {
    const shipped = clampSoundVolume(SOUND_VOLUME[name] ?? SOUND_VOLUME.default);
    const volume = soundVolumeFor(name, overrides);
    return {
      name,
      volume,
      shipped,
      shippedFrom: SOUND_VOLUME[name] === undefined ? 'default' : name,
      overridden: Math.abs(volume - shipped) > 0.0001,
    };
  });

// ---------------------------------------------------------------------------
// The setting
// ---------------------------------------------------------------------------
// `is_sounds_active` on user_settings, inheriting from the same column on system_settings, which is TRUE unless
// an administrator says otherwise. A member who has never saved the preference has a blank cell, which is what
// "inherit" looks like in this sheet - the same convention the notification preferences use.
export const SOUNDS_SETTING_KEY = 'is_sounds_active';
export const SOUNDS_DEFAULT = true;

// A blank or unreadable value is NOT a decision: it falls through to the next level, which is why this cannot be
// isTruthyFlag on its own. "FALSE" means off, and "" means "ask the station".
export const soundsActiveFrom = (userValue, systemValue) => {
  const decide = (value) => {
    const text = String(value ?? '').trim().toUpperCase();
    if (text === 'TRUE') return true;
    if (text === 'FALSE') return false;
    return null;
  };
  const own = decide(userValue);
  if (own !== null) return own;
  const station = decide(systemValue);
  if (station !== null) return station;
  return SOUNDS_DEFAULT;
};

// ---------------------------------------------------------------------------
// Which sound for a modal
// ---------------------------------------------------------------------------
// A modal the member opened, or a form they are expected to fill in, is positive. An error tone means the app
// interrupted them with something they did not ask for, or is reporting a refusal.
//
// The default is positive on purpose: a modal added later with no entry here still gets a sound, and gets the
// forgiving one. Every modal component has to name its own tone (the verifier requires it), so this table cannot
// drift quietly out of step with the components it describes.
export const MODAL_SOUNDS = {
  scheduleItem: 'positive',
  shiftOffer: 'positive',
  // A confirmation is positive by the rule above: the member opened it, by pressing the button that asks. The
  // wording and the red button carry the caution; the tone is about who asked, and nobody was interrupted.
  confirm: 'positive',
  // The document editor: a screen of its own opened from the toolbar or a row, so the reader asked for it too.
  documentEditor: 'positive',
  // The month picker, opened from the calendar button in a day view. Positive for the same reason: it is a control the
  // reader just pressed, not something the app put in front of them.
  monthPicker: 'positive',
  // Assigning somebody to a shift on a NARROW screen, where the board's member picker is a dialog rather than a menu
  // hanging off the pill (see ScheduleAssignmentModal). Positive: the officer clicked the slot.
  //
  // NOTE THE SPLIT, because it is deliberate and the popovers are NOT this: on a wide screen the same picker is a
  // context menu, and a menu takes no tone - the panel opening is not an interruption, only the thing you click in it
  // is. So this key belongs to the dialog frame alone, which is asserted in verify-sounds.
  scheduleAssignment: 'positive',
  reauth: 'error',
  clockBlocked: 'error',
  passwordChange: 'error',
};

export const MODAL_TONE_FILES = { positive: 'modal_positive', error: 'modal_error' };

// Pass a tone directly for a one-off, or a modal key to look the tone up. Anything unrecognized is positive.
export const modalSoundFor = (modal, tone) => MODAL_TONE_FILES[tone || MODAL_SOUNDS[modal]] || 'modal_positive';

// ---------------------------------------------------------------------------
// Which sound for a toast
// ---------------------------------------------------------------------------
// Success and failure are worth their own earcon; everything else is the normal one. "When in doubt, use the
// normal variant" is the rule, so an unstyled call - and any kind added to the wrapper later - lands on
// toast_normal rather than on a sound that promises something.
export const TOAST_SOUNDS = {
  success: 'toast_success',
  error: 'toast_error',
  loading: 'toast_normal',
  info: 'toast_normal',
  warning: 'toast_error',
  message: 'toast_normal',
};


// ---------------------------------------------------------------------------
// Which clickables make a noise
// ---------------------------------------------------------------------------
// The delegated listener plays a click for anything matching this, once per press. Note what is deliberately
// absent: no bare div or span, so clicking a paragraph, a table row or a calendar cell that does nothing is
// silent. `[draggable="true"]` is in because the schedule board's pills are draggable divs - the most clicked
// thing an administrator touches, and not a <button>.
export const CLICKABLE_SELECTOR = [
  'button',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[draggable="true"]',
  'a[href]',
  'summary',
  'select',
  'input',
  '[data-sound="click"]',
].join(', ');

// What a caller can put on an element to override the default. `none` silences a subtree (the minigame), `click`
// marks something the selector would not otherwise recognize, `click-double` promotes an action to the heavier
// sound (or demotes one the rule below would have promoted, by saying `click`), and the two toggle values carry
// the sound the toggle is ABOUT to make, so nothing has to infer it from a state the member cannot see yet.
export const SOUND_DIRECTIVES = ['none', 'click', 'click-double', 'sound-on', 'sound-off'];

export const DIRECTIVE_SOUNDS = {
  click: 'click',
  'click-double': 'click_double',
  'sound-on': 'sound_on',
  'sound-off': 'sound_off',
};

// The two sounds that play while sounds are switched OFF, because they ARE the switch for sounds: turning them
// back on must be audible or the control that fixes a silent app would be silent.
export const TOGGLE_SOUNDS = ['sound_on', 'sound_off'];
export const isToggleSound = (name) => TOGGLE_SOUNDS.includes(name);

// The nearest directive in effect for an element, or '' when there is none. Also what makes a marked subtree
// silent, since closest() finds the ancestor.
export const soundDirectiveFor = (element) => {
  if (!element || typeof element.closest !== 'function') return '';
  const marked = element.closest('[data-sound]');
  const value =
    marked && typeof marked.getAttribute === 'function' ? String(marked.getAttribute('data-sound') || '') : '';
  return SOUND_DIRECTIVES.includes(value) ? value : '';
};

// Whether an element is something the member is pressing "as a control". Split out from the listener so the
// awkward cases are visible and testable: a label with no `for` and no control inside is decoration, and
// clicking it should be silent.
export const isClickableElement = (element) => {
  if (!element || typeof element.closest !== 'function') return false;
  if (element.closest('[data-sound="none"]')) return false;
  if (element.closest('[aria-disabled="true"]')) return false;
  if (element.disabled === true) return false;

  if (element.closest(CLICKABLE_SELECTOR)) return true;

  const label = element.closest('label');
  return !!(
    label &&
    (label.htmlFor ||
      (typeof label.querySelector === 'function' && label.querySelector('input, select, textarea')))
  );
};

// The sound one press should make, or '' for silence. A directive wins over the generic click, so a marked
// subtree or a sounds toggle is never sounded twice.
export const soundForPress = (element) => {
  const directive = soundDirectiveFor(element);
  if (directive === 'none') return '';
  if (directive) return DIRECTIVE_SOUNDS[directive] || '';
  if (!isClickableElement(element)) return '';
  // Everything else clicks; the consequential ones click twice.
  return isImpactfulControl(controlFor(element)) ? 'click_double' : 'click';
};

// ---------------------------------------------------------------------------
// Which presses are worth the heavier sound
// ---------------------------------------------------------------------------
// The policy, in one sentence: an action that is CONSEQUENTIAL and INFREQUENT gets click_double. Saving, deleting,
// editing, canceling, exporting, printing, signing out, approving - things the member means to do, as opposed to
// the navigation, toggles, filters and pills that make up most of a session's clicking.
//
// The exclusions are as deliberate as the inclusions, and the interesting ones:
//
//   - **Clock in / clock out.** The most-pressed buttons in the app, often in a hurry. A heavier sound every shift
//     would wear out its welcome, and the clock's own confirmation is the dashboard changing in front of them.
//   - **"Reset" and "Clear".** Almost always a filter or a draft, not data.
//   - **"Close".** Dismissals: the sound equivalent of the backdrop clicks that are silent on purpose.
//   - **"Add"/"New".** Opening a form, not committing it - the form's own Save is where the weight is.
//
// Which controls get it is decided from what the control already says about itself instead of a marker on each of
// ~30 buttons: the accessible name, or the icon, because the app's Edit and Delete buttons are icon-only (a
// pencil and a bin) with no text to read. `data-sound="click-double"` promotes anything the rule cannot see, and
// `data-sound="click"` demotes a false positive, so the rule never has the last word.
export const IMPACT_VERBS = [
  'save',
  'delete',
  'remove',
  'edit',
  'rename',
  'cancel',
  'export',
  'download',
  'print',
  'sign out',
  'log out',
  'approve',
  'decline',
  'discard',
  'revoke',
  'archive',
];

// Icon-only equivalents: matched against the class lucide puts on every icon (`lucide-trash-2`, `lucide-pencil`,
// ...). Deliberately NOT included: `loader` (a spinner mid-save is not the save), `x` (close), `rotate` (reset),
// `plus` (open a form), `eye` (show/hide).
export const IMPACT_ICONS = [
  'lucide-pencil',
  'lucide-trash',
  'lucide-save',
  'lucide-download',
  'lucide-printer',
  'lucide-file-down',
  'lucide-user-minus',
  'lucide-archive',
];

// A control's own words, and only its own: aria-label, else title, else its visible text. Capped, because a
// container that happens to be clickable can hold a paragraph, and a paragraph is not a button label.
export const CONTROL_LABEL_LIMIT = 40;

export const controlLabel = (control) => {
  if (!control || typeof control.getAttribute !== 'function') return '';
  const named = control.getAttribute('aria-label') || control.getAttribute('title') || '';
  const text = named || (typeof control.textContent === 'string' ? control.textContent : '');
  return text.replace(/\s+/g, ' ').trim().slice(0, CONTROL_LABEL_LIMIT);
};

// The nearest thing the member actually pressed: the button, the pill, or the label - not the icon or the div
// inside it, which is what the event target usually is.
export const controlFor = (element) => {
  if (!element || typeof element.closest !== 'function') return null;
  return element.closest(CLICKABLE_SELECTOR) || element.closest('label') || element;
};

// Whether this control's own words say it is a consequential action.
export const labelSaysImpactful = (control) => {
  const label = controlLabel(control).toLowerCase();
  if (!label) return false;
  return IMPACT_VERBS.some((verb) => label.includes(verb));
};

// ...or whether its icon does, for the app's many icon-only buttons.
export const iconSaysImpactful = (control) => {
  if (!control || typeof control.querySelectorAll !== 'function') return false;
  const icons = control.querySelectorAll('[class*="lucide-"]');
  return Array.from(icons || []).some((icon) => {
    const classes = typeof icon.getAttribute === 'function' ? String(icon.getAttribute('class') || '') : '';
    return IMPACT_ICONS.some((name) => classes.includes(name));
  });
};

export const isImpactfulControl = (control) => labelSaysImpactful(control) || iconSaysImpactful(control);

// A press that turned into a DRAG gets a second sound when it is released - the "grab" is the press itself.
// Movement is what separates a drag from a tap, and the threshold stops a shaky finger turning every tap into two
// clicks.
export const DRAG_THRESHOLD_PX = 6;

export const movedEnoughToBeADrag = (from, to, threshold = DRAG_THRESHOLD_PX) => {
  if (!from || !to) return false;
  return (
    Math.abs(Number(to.x) - Number(from.x)) >= threshold || Math.abs(Number(to.y) - Number(from.y)) >= threshold
  );
};

export const toastSoundFor = (kind) => TOAST_SOUNDS[kind] || 'toast_normal';


// ---------------------------------------------------------------------------
// The press tracker
// ---------------------------------------------------------------------------
// The behavior of the delegated listeners, with `play` injected - so the whole thing can be driven by fake
// events in a test, including the awkward parts that are easy to get wrong: a tap must make ONE sound, a drag
// must make two, and a right-click must make none.
//
// uiSounds installs these on the document. Keeping the decisions here means the browser-facing file has almost
// nothing in it that could be wrong.
//
// `play(name, { force })` - force is for the toggle sounds, which must be heard while sounds are switched off
// (that is the whole point of them).
export const createPressTracker = (play) => {
  // The press in flight: where it started, what it started on, which sound it is owed, whether it came from a
  // finger, and whether it turned into an HTML5 drag - whose release arrives as dragend rather than pointerup.
  let pressOrigin = null;
  let pressTarget = null;
  let pressSound = '';
  let pressWasTouch = false;
  let dragging = false;

  const clearPress = () => {
    pressOrigin = null;
    pressTarget = null;
    pressSound = '';
    pressWasTouch = false;
  };

  const onPointerDown = (event) => {
    // Left button or touch only: a right-click opens a context menu, which is not a press on a control.
    if (typeof event?.button === 'number' && event.button > 0) return;
    const sound = soundForPress(event?.target);
    pressOrigin = { x: event?.clientX, y: event?.clientY };
    pressTarget = sound ? event.target : null;
    pressSound = sound;
    pressWasTouch = event?.pointerType === 'touch';
    dragging = false;

    // A mouse or pen press sounds at once: that is what pressing a physical button feels like.
    //
    // A finger does NOT. On a touch screen a press begins wherever the finger lands, which is just as likely to
    // be the start of a scroll as a tap - so sounding here would click on every flick of a list. The finger's
    // sound is played on release instead, and only if the finger stayed put (see onPointerUp).
    //
    // Only the two toggle sounds bypass the mute gate; every other sound, including the heavier click, obeys the
    // member's setting.
    if (sound && !pressWasTouch) play(sound, { force: isToggleSound(sound) });
  };

  const onPointerUp = (event) => {
    const sound = pressSound;
    const started = pressTarget;
    const origin = pressOrigin;
    const wasTouch = pressWasTouch;
    clearPress();
    if (!started || dragging) return;

    const moved = movedEnoughToBeADrag(origin, { x: event?.clientX, y: event?.clientY });

    if (wasTouch) {
      // A tap: the finger went down and came up without traveling, so the sound it was owed is played now. A
      // finger that moved was scrolling or dragging, and makes no sound at all.
      if (!moved) play(sound, { force: isToggleSound(sound) });
      return;
    }

    // A mouse release: the press has already clicked, so this is only the RELEASE of a drag, which is the second
    // half of a pill being moved.
    if (moved && sound === 'click') play('click');
  };

  // A touch that becomes a scroll is canceled rather than released, so the pending press has to be dropped - or
  // the next release anywhere on the screen would play the sound the scroll was owed.
  const onPointerCancel = () => {
    clearPress();
    dragging = false;
  };

  // An HTML5 drag (the schedule board's pills) begins after the press has already sounded, so dragstart itself
  // stays quiet and only the release is heard.
  const onDragStart = () => {
    dragging = true;
    clearPress();
  };

  const onDragEnd = (event) => {
    dragging = false;
    if (isClickableElement(event?.target)) play('click');
  };

  // A native dropdown's list is drawn by the browser and cannot make a sound per item, so the CHOICE plays the
  // click instead - the nearest thing to "menu selection" a <select> allows.
  const onChange = (event) => {
    const element = event?.target;
    if (element && element.tagName === 'SELECT' && isClickableElement(element)) play('click');
  };

  return { onPointerDown, onPointerUp, onPointerCancel, onDragStart, onDragEnd, onChange };
};
