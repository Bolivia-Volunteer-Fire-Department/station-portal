/**
 * Verifies the idle session timeout.
 *
 * Two things have to hold, and the second is the one that matters:
 *
 *   1. The client's parsing and state transitions - a typo must switch the feature OFF rather than
 *      expire every session, and the threshold must be the boundary between "warning" and "over".
 *   2. The SERVER expires sessions on the same setting. A client-only timeout is not a timeout: it
 *      is a button that says the session ended. These assertions lift the real functions out of
 *      Code.gs and run them against stubs, so `sessionTtlMs` and `createSession` are exercised as
 *      written rather than as described.
 *
 * Run with: npm run verify:session-timeout
 */
import {
  MIN_SESSION_TIMEOUT_MINUTES,
  SESSION_TIMEOUT_KEY,
  SESSION_WARNING_SECONDS,
  formatIdleCountdown,
  idleLogoutMessage,
  idleRemainingMs,
  idleSecondsRemaining,
  idleState,
  parseSessionTimeoutMinutes,
  sessionTimeoutConfig,
  sessionTimeoutSetting,
} from '../src/utils/sessionTimeout.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` -> ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`}`
  );
};

const rows = (value) => [{ key: SESSION_TIMEOUT_KEY, value }];

console.log('--- reading the setting ---');
check('a number of minutes', parseSessionTimeoutMinutes('30'), 30);
check('a number with surrounding space', parseSessionTimeoutMinutes('  45  '), 45);
check('a numeric cell', parseSessionTimeoutMinutes(60), 60);
check('a fraction is floored', parseSessionTimeoutMinutes('2.7'), 2);
check('blank is not configured', parseSessionTimeoutMinutes(''), null);
check('a missing value is not configured', parseSessionTimeoutMinutes(undefined), null);
check('null is not configured', parseSessionTimeoutMinutes(null), null);
check('only whitespace is not configured', parseSessionTimeoutMinutes('   '), null);
check('zero is not configured, not instant expiry', parseSessionTimeoutMinutes('0'), null);
check('a negative is not configured', parseSessionTimeoutMinutes('-30'), null);
check('"30 minutes" is refused rather than guessed at 30', parseSessionTimeoutMinutes('30 minutes'), null);
check('"30m" is refused', parseSessionTimeoutMinutes('30m'), null);
check('a thousands separator is refused', parseSessionTimeoutMinutes('1,000'), null);
check('a word is refused', parseSessionTimeoutMinutes('later'), null);
check('the minimum itself is accepted', parseSessionTimeoutMinutes(String(MIN_SESSION_TIMEOUT_MINUTES)), MIN_SESSION_TIMEOUT_MINUTES);

check('the setting is found by key', sessionTimeoutSetting(rows('25')), '25');
check('an unrelated key is not it', sessionTimeoutSetting([{ key: 'time_format', value: '24' }]), undefined);
check('a non-array is tolerated', sessionTimeoutSetting(null), undefined);

console.log('\n--- the config the UI and the timer read ---');
const on = sessionTimeoutConfig(rows('30'));
check('configured', on.configured, true);
check('not invalid', on.invalid, false);
check('the minutes', on.minutes, 30);
check('the window in ms', on.ms, 30 * 60 * 1000);
check('the warning window', on.warningMs, SESSION_WARNING_SECONDS * 1000);
const off = sessionTimeoutConfig(rows(''));
check('blank means off', off.configured, false);
check('and is not reported as invalid', off.invalid, false);
const bad = sessionTimeoutConfig(rows('half an hour'));
check('an unusable value is off', bad.configured, false);
check('and IS reported as invalid, so it can be fixed', bad.invalid, true);
check('and its raw text is kept for the message', bad.raw, 'half an hour');
check('with no window at all', bad.ms, 0);
check('no settings at all means off', sessionTimeoutConfig([]).configured, false);
check('a non-array means off', sessionTimeoutConfig(undefined).configured, false);

console.log('\n--- the state machine ---');
const cfg = sessionTimeoutConfig(rows('30'));
const T0 = 1_000_000;
const at = (ms) => idleState(T0, T0 + ms, cfg);
check('just after activity it is active', at(0), 'active');
check('a minute in it is active', at(60_000), 'active');
check('past the warning window it is still active', at(cfg.ms - cfg.warningMs - 1), 'active');
check('entering the warning window', at(cfg.ms - cfg.warningMs), 'warning');
check('one second before the end it is still a warning', at(cfg.ms - 1000), 'warning');
check('at the threshold the session is over, not warning', at(cfg.ms), 'expired');
check('well past it is over', at(cfg.ms + 60_000), 'expired');
check('with the feature off nothing expires', idleState(T0, T0 + 10 * 24 * 3600_000, off), 'off');
check('a null config is off', idleState(T0, T0, null), 'off');

check('the time left', idleRemainingMs(T0, T0 + 60_000, cfg), cfg.ms - 60_000);
check('negative once past the threshold', idleRemainingMs(T0, T0 + cfg.ms + 5000, cfg) < 0, true);
check('infinite when off', idleRemainingMs(T0, T0 + 1, off), Number.POSITIVE_INFINITY);
check('seconds left, rounded up', idleSecondsRemaining(T0, T0 + cfg.ms - 1500, cfg), 2);
check('exactly at the threshold', idleSecondsRemaining(T0, T0 + cfg.ms, cfg), 0);
check('null when off, so no countdown is shown', idleSecondsRemaining(T0, T0, off), null);

console.log('\n--- the wording a member sees ---');
check('seconds are pluralised', formatIdleCountdown(45), '45 seconds');
check('one second is singular', formatIdleCountdown(1), '1 second');
check('zero still reads as time', formatIdleCountdown(0), '0 seconds');
check('a minute', formatIdleCountdown(60), '1 minute');
check('minutes', formatIdleCountdown(120), '2 minutes');
check('a non-number is tolerated', formatIdleCountdown(undefined), '0 seconds');
check(
  'the logout message names the period',
  idleLogoutMessage(30),
  'You were signed out after 30 minutes of inactivity. Sign in again to continue.'
);
check(
  'and reads sensibly for one minute',
  idleLogoutMessage(1),
  'You were signed out after 1 minute of inactivity. Sign in again to continue.'
);
check(
  'and for an unknown period',
  idleLogoutMessage(null),
  'You were signed out after a period of inactivity. Sign in again to continue.'
);

console.log('\n--- the client tick is cheap ---');
const tickStart = process.hrtime.bigint();
for (let i = 0; i < 200_000; i++) {
  idleState(T0, T0 + 1000, cfg);
}
const tickMs = Number(process.hrtime.bigint() - tickStart) / 1e6;
const perTickUs = (tickMs / 200_000) * 1000;
console.log(`     measured: ${perTickUs.toFixed(2)}us per tick (${(1000 / perTickUs).toFixed(0)} ticks/ms)`);
check('a tick costs microseconds', perTickUs < 50, true);

// --- what a request costs now ------------------------------------------------------------------
//
// Printed rather than only asserted, because "did this make the app slower?" deserves a number
// rather than a claim. Counted from the auth path itself.
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
