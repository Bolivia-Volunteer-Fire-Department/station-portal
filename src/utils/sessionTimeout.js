// Session idle timeout.
//
// The `session_timeout` system setting holds a number of MINUTES. When it is set, a member who
// neither interacts with the app nor navigates within that window is signed out.
//
// Two halves, deliberately:
//
//   * **Client** - a timer that watches for real interaction (pointer, key, scroll, touch) and for
//     navigation between modules, and signs the user out visibly at the threshold.
//   * **Session** - Firebase's own token lifetime is independent of this; the value here governs
//     so a client that ignores the timer still cannot act afterwards. The client timer is the
//     courtesy; the server expiry is the rule.
//
// Everything here is a pure function so the parsing and the state transitions can be tested
// directly - see scripts/verify-session-timeout.mjs.

export const SESSION_TIMEOUT_KEY = 'session_timeout';

// A value below this is treated as unconfigured rather than as "expire immediately". A typo like
// `0` or `-5` must not lock the whole department out of a shared terminal the moment it is saved.
export const MIN_SESSION_TIMEOUT_MINUTES = 1;

// The warning countdown, in seconds, before the session ends. Long enough to click, short enough
// not to be mistaken for the timeout itself.
export const SESSION_WARNING_SECONDS = 60;

// What counts as the user being present.
//
// Mouse movement is included on purpose: the scenario this guards against is a shared station
// terminal left unattended, and a pointer that is moving means somebody is there. Reads and
// scrolls are included so that reading a long help guide or a schedule does not count as idleness.
// `visibilitychange` is handled separately, because returning to an abandoned tab should end the
// session at once rather than after a further tick.
export const IDLE_RESET_EVENTS = [
  'mousemove',
  'mousedown',
  'keydown',
  'scroll',
  'wheel',
  'touchstart',
  'touchmove',
  'focus',
];

const text = (value) => String(value ?? '').trim();

// The configured timeout in minutes, or null when it is unset or unusable.
//
// Strict on purpose: a cell holding `30 mins` or `1,000` reads as NOT configured rather than as 30,
// and the settings card reports that so it can be corrected. Guessing would be worse than doing
// nothing here - the failure mode of guessing wrong is either no protection at all or a session
// that ends before anyone can use it.
export const parseSessionTimeoutMinutes = (raw) => {
  const value = text(raw);
  if (value === '') return null;
  // A bare number only, so `30m` and `1,000` cannot silently become 30 and 1.
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < MIN_SESSION_TIMEOUT_MINUTES) return null;
  return Math.floor(minutes);
};

// The setting value from the system settings rows the app already holds.
export const sessionTimeoutSetting = (systemSettings) => {
  const rows = Array.isArray(systemSettings) ? systemSettings : [];
  const row = rows.find((entry) => String(entry?.key || '') === SESSION_TIMEOUT_KEY);
  return row ? row.value : undefined;
};

// Everything the UI and the timer need.
//
// `configured` is what gates the feature: when it is false the app behaves exactly as it did
// before - the server's own default session length applies and nothing is signed out for idleness.
// `invalid` distinguishes "not set yet" from "cannot be used", which is the only case worth
// showing a warning about.
export const sessionTimeoutConfig = (systemSettings) => {
  const raw = sessionTimeoutSetting(systemSettings);
  const minutes = parseSessionTimeoutMinutes(raw);
  const touched = text(raw) !== '';

  return {
    raw: touched ? text(raw) : '',
    minutes,
    ms: minutes === null ? 0 : minutes * 60 * 1000,
    warningMs: SESSION_WARNING_SECONDS * 1000,
    configured: minutes !== null,
    invalid: touched && minutes === null,
  };
};

// Milliseconds of idle time left before the session ends. Negative when it already has.
export const idleRemainingMs = (lastActivityAt, now, config) => {
  if (!config || !config.configured) return Number.POSITIVE_INFINITY;
  return config.ms - (Math.max(Number(now) || 0, 0) - (Number(lastActivityAt) || 0));
};

// 'off' when the feature is unconfigured, otherwise where the session stands right now.
//
// Separate from the countdown because the timer's behavior is driven by this, and the states have
// to be distinguishable at the boundary: at the threshold the session is over, not merely warning.
export const idleState = (lastActivityAt, now, config) => {
  if (!config || !config.configured) return 'off';
  const remaining = idleRemainingMs(lastActivityAt, now, config);
  if (remaining <= 0) return 'expired';
  if (remaining <= config.warningMs) return 'warning';
  return 'active';
};

// Whole seconds left, rounded up so the countdown never shows 0 while there is still time.
export const idleSecondsRemaining = (lastActivityAt, now, config) => {
  const remaining = idleRemainingMs(lastActivityAt, now, config);
  if (!Number.isFinite(remaining)) return null;
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / 1000);
};

// "45 seconds", "1 minute", "30 minutes" - for the warning banner.
export const formatIdleCountdown = (seconds) => {
  const value = Math.max(0, Math.ceil(Number(seconds) || 0));
  if (value < 60) return `${value} second${value === 1 ? '' : 's'}`;
  const minutes = Math.round(value / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
};

// What the login screen says afterwards, so an unexplained sign-out never happens.
export const idleLogoutMessage = (minutes) => {
  const value = Math.floor(Number(minutes));
  const label = Number.isFinite(value) && value > 0
    ? `${value} minute${value === 1 ? '' : 's'}`
    : 'a period';
  return `You were signed out after ${label} of inactivity. Sign in again to continue.`;
};

// WHAT THE LOGIN SCREEN SAYS WHEN THE SESSION ENDED WITHOUT ANYBODY SIGNING OUT.
//
// The app and the Auth SDK hold the same session in two places, and only one of them notices when it ends. The SDK
// signs out on its own when the refresh token is refused - an expired or revoked session, an account disabled - and it
// does so in EVERY TAB, because the persistence is shared: a sign-out in one tab (or that tab's idle timer, which
// signs out of Firebase as it ends the app's session) leaves this one drawing a signed-in screen whose next save is
// refused by the gate every routed call passes through. That refusal arrived as "was not routed ... there is no sheet
// behind it", which reads like a deployment fault rather than like an ended session.
export const SESSION_ENDED_MESSAGE = 'Your session ended, so you were signed out. Sign in again to continue.';

// Whether a report from the Auth SDK should end the app's session.
//
// `appUser` is who the APP believes is signed in (its own state, or null); `account` is who the SDK reports (its User,
// or null). The two agree in every ordinary moment, and it is the moments they disagree that matter:
//
//   * NOBODY WHILE THE APP HAS SOMEBODY: the session ended under the app's feet, which is the message above.
//   * SOMEBODY ELSE: the browser has since been signed in as another member - a shared station computer is exactly the
//     case this portal is built for - so this tab's screens, and its next write, would belong to the wrong person.
//     Both of the app's own sign-outs clear its state BEFORE they sign out of Firebase, so neither can be mistaken for
//     this.
//
// A null account with no app session is the login screen's ordinary state, and ends nothing.
export const accountChangeEndsSession = (appUser, account) => {
  if (!appUser) return false;
  if (!account) return true;
  return String(account.uid || '') !== String(appUser.id || '');
};

// Is an UNAUTHORIZED reply ABOUT the session we are holding?
//
// No, when the request that got it used a different token: that answer belongs to a superseded session and is
// obsolete. This matters more than it looks. Every background refresh opens the "verify your username and
// password" prompt when its reply says UNAUTHORIZED, so a refresh that was already in flight when somebody
// signed in again - or when every session was invalidated at once, which is what the id migration does - would
// otherwise ask a freshly signed-in member to sign in again, over a token the app no longer holds.
//
// A reply for the CURRENT token is genuine: the session really has expired, and the prompt is right.
export const unauthorizedIsStale = (usedToken, currentToken) => {
  const used = String(usedToken === undefined || usedToken === null ? '' : usedToken);
  const current = String(currentToken === undefined || currentToken === null ? '' : currentToken);
  return used !== current;
};

