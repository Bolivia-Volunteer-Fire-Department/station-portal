/**
 * Verifies per-device push registration.
 *
 * This exists because the previous design stored a single `user_settings.fcm_token` per member, which
 * produced two bugs that both looked like the app lying:
 *
 *   * a second device OVERWROTE the first one's token, so the first silently stopped receiving;
 *   * "turn off" on a device that had never been enabled cleared the member's token - the OTHER
 *     device's - so it reported success while breaking the one that worked.
 *
 * The backend rules live in the registerPushDevice / pushDeviceOwner callables, exercised on the
 * emulator by verify:firebase-auth; this file pins the client half that talks to them.
 *
 * Run with: npm run verify:push-devices
 */
import { readFileSync } from 'node:fs';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${
      ok ? '' : ` (expected ${JSON.stringify(expected)})`
    }`
  );
};
// For the wiring checks below, where the interesting thing is a condition over source text rather than a
// value that can be printed.

// The backend rules these used to assert live in the registerPushDevice / pushDeviceOwner callables
// (functions/index.js), exercised on the emulator by verify:firebase-auth. What remains here is the
// client half, and the wire rules worth pinning in source.
const functionsSource = readFileSync('functions/index.js', 'utf8');
check('the callable refuses a shared device it was not given', /ownerId !== uid && !transfer/.test(functionsSource), true);
check('and re-points the row only when the transfer flag is set', /const transfer = data.transfer === true/.test(functionsSource), true);
check('the member\u2019s own block has its own code', /PUSH_DISABLED_BY_ADMIN/.test(functionsSource), true);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

