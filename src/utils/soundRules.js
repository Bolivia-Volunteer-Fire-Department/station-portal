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
];

// Mix levels. A click fires on every single tap, so it sits well below the one-shot sounds - at the same level it
// reads as noisy rather than responsive. Change them here, not at the call sites.
//
// `click_double` is the heavier sibling played for consequential, infrequent actions (see IMPACT_VERBS below): more
// present than the everyday click, because it is confirming something that mattered, but still under the one-shots.
export const SOUND_VOLUME = {
  click: 0.05,
  click_double: 0.15,
  sound_on: 0.4,
  sound_off: 0.4,
  default: 0.5,
};

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
  reauth: 'error',
  clockBlocked: 'error',
  passwordChange: 'error',
};

export const MODAL_TONE_FILES = { positive: 'modal_positive', error: 'modal_error' };

// Pass a tone directly for a one-off, or a modal key to look the tone up. Anything unrecognised is positive.
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
// marks something the selector would not otherwise recognise, `click-double` promotes an action to the heavier
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
// editing, cancelling, exporting, printing, signing out, approving - things the member means to do, as opposed to
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
// The behaviour of the delegated listeners, with `play` injected - so the whole thing can be driven by fake
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
      // A tap: the finger went down and came up without travelling, so the sound it was owed is played now. A
      // finger that moved was scrolling or dragging, and makes no sound at all.
      if (!moved) play(sound, { force: isToggleSound(sound) });
      return;
    }

    // A mouse release: the press has already clicked, so this is only the RELEASE of a drag, which is the second
    // half of a pill being moved.
    if (moved && sound === 'click') play('click');
  };

  // A touch that becomes a scroll is cancelled rather than released, so the pending press has to be dropped - or
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
