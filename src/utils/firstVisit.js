// WHAT THIS DEVICE HAS ALREADY BEEN SHOWN, and the one thing built on top of it: `intro_short.mp3`, the station's welcome,
// played as the boot screen clears after a sign-in.
//
// PER DEVICE, NOT PER MEMBER, and that is the decision rather than a shortcut. A member who signs in on the station's shared
// tablet wants the welcome; the same member signing in on a phone they have used for a year does not. "Once" therefore means
// once on THIS MACHINE - which is what localStorage is for, and is the same per-device promise the announcements make when
// they remember a dismissal (utils/announcements.js).
//
// AND ONLY AFTER A SIGN-IN. Two reasons, and the second is not negotiable: a greeting that repeats every visit is a noise
// rather than a greeting, and a browser only allows a page to make a sound shortly after somebody has touched it. A session
// RESTORED from a token has no click behind it - `playSound` would be refused by the browser and the member would hear
// nothing while the code believed it had played something. So the caller passes what it knows, and this decides.
//
// The storage is guarded because this module is read by a Node harness (scripts/verify-sounds.mjs), where there is no
// localStorage and no reason for one - the same reason services/firebase.js reads `import.meta.env` defensively.
const INTRO_KEY = 'fireClock.introHeard';

const store = () => (typeof localStorage === 'undefined' ? null : localStorage);

// WHETHER THIS DEVICE SHOULD HEAR THE INTRO. Pure, so the rule can be asked directly: a fresh sign-in, an app that has
// finished loading, and a device that has not heard it before.
export const shouldPlayIntro = ({ signedInNow = false, ready = false, heard = false } = {}) =>
  Boolean(signedInNow && ready && !heard);

// Whether this device has already heard it. Never throws: a browser with storage disabled (private mode, a locked-down
// kiosk) gets the intro every time rather than an error, which is the harmless direction.
export const introHeardOnThisDevice = () => {
  try {
    return store()?.getItem(INTRO_KEY) === '1';
  } catch {
    return false;
  }
};

// TAKES the intro: true the first time on this device, false after - and it RECORDS BEFORE IT ANSWERS, so two renders in the
// same frame cannot both be told yes. This is the half that makes "once" true rather than likely.
export const takeIntroForThisDevice = () => {
  try {
    const said = store()?.getItem(INTRO_KEY);
    if (said === '1') return false;
    store()?.setItem(INTRO_KEY, '1');
    return true;
  } catch {
    // Storage that cannot be written to - the intro plays, and plays again next time. Better a repeat than a member who can
    // never be greeted because a browser is in a strange mode.
    return true;
  }
};

// What the Debug page shows, and what a member would ask for if they wanted to hear it again. Not wired to a button yet.
export const forgetIntroOnThisDevice = () => {
  try {
    store()?.removeItem(INTRO_KEY);
    return true;
  } catch {
    return false;
  }
};