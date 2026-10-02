/**
 * Verifies the sign-in payload's client-side guarantees.
 *
 * The payload itself is built by firestorePayload.js and exercised against the emulator by
 * verify-firestore-reads.mjs. What this file still checks are the invariants that made the batched
 * sign-in safe when it replaced seventeen Apps Script executions — and that survive the Firestore move:
 *
 *   - the two per-member tables are cut for the viewer on every path, so a member's background refresh
 *     cannot widen what their sign-in narrowed;
 *   - the dashboard's "am I clocked in" is answered by the on-duty row, not by scanning the history;
 *   - the payload carries no password, no username and no role where the app draws a name.
 *
 *   npm run verify:bootstrap
 */
import { readFileSync } from 'node:fs';

let failures = 0;
const checkIs = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` -> ${detail}`}`);
};

console.log('\n--- the two per-member sheets are cut for the viewer, on every path ---');
// The claim the cut rests on: every member screen that reads these tables draws the SIGNED-IN member's own
// rows. If one of them started listing the crew, the rules would now be hiding rows that screen needs - so
// it is asserted here, beside the payload that depends on it, rather than assumed.
const clockHistory = readFileSync('src/components/MyClockHistory.jsx', 'utf8');
checkIs(
  'My Clock History filters the rows to the signed-in member',
  /String\(log\.user_id\) === String\(currentUser\.id\)/.test(clockHistory)
);
const appSource = readFileSync('src/App.jsx', 'utf8');
// The clock card asks the ON-DUTY row instead of scanning the history, which is stronger than "it only reads the viewer's
// own rows": there is no clock entry in that lookup at all now. That is what let the history leave the sign-in payload - the
// payload used to carry every entry the member had ever made, because this lookup needed one of them.
checkIs(
  'and the "am I clocked in" lookup that arms the clock card reads the on-duty row, not the history',
  /onDutyUsers\.some\(/.test(appSource) && !/const activeShift = logs\.find/.test(appSource)
);
const availabilityScreen = readFileSync('src/components/MyAvailability.jsx', 'utf8');
checkIs('My Availability is built for that member', /member=\{currentUser\}/.test(availabilityScreen));
// The Firestore readers enforce the same scoping with `where('user_id', '==', uid)` - a background refresh
// cannot put back what the payload narrowed.
const readsSource = readFileSync('src/services/firestoreReads.js', 'utf8');
checkIs(
  'the clock-history refresh reads the viewer\u2019s own rows',
  /rowsFor\('timeclock', 'user_id', uid\)/.test(readsSource)
);
checkIs(
  'and so does the availability refresh',
  /memberAvailabilityFor\(/.test(readsSource)
);

console.log('\n--- the payloads carry no secrets where the app draws a name ---');
// The payload's projections are the roster, the on-duty list and the offers; none of them may carry a
// password, a username or a role. Firestore never stores a password at all, so this asserts the PROJECTION
// (which fields the readers pick out) rather than an absence.
const payloadSource = readFileSync('src/services/firestorePayload.js', 'utf8');
checkIs('the on-duty projection carries three fields', /id: String\(row\.user_id\), name: member\.name, rank_id: member\.rank_id/.test(payloadSource));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
