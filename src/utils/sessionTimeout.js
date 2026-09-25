// Session idle timeout.
//
// The `session_timeout` system setting holds a number of MINUTES. When it is set, a member who
// neither interacts with the app nor navigates within that window is signed out.
//
// Two halves, deliberately:
//
//   * **Client** - a timer that watches for real interaction (pointer, key, scroll, touch) and for
//     navigation between modules, and signs the user out visibly at the threshold.
//   * **Server** - the session's sliding expiry uses the same value (see sessionTtlMs in Code.gs),
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
// Separate from the countdown because the timer's behaviour is driven by this, and the states have
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
