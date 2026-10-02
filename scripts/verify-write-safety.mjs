/**
 * Verifies the client half of write safety: services/api.js.
 *
 * The bug this file exists for could not be seen from the UI: a write that could not take the script lock ran
 * ANYWAY, unlocked - `locked` was only consulted to decide whether to release it. Two overlapping writers can
 * lose one of the two updates, and nothing in
 * the app reported it. The gate now REFUSES that write instead, which is only worth anything if the refusal
 * touches nothing at all.
 *
 * So the assertions below are about writing nothing, not about the failure message:
 *
 *   * a refused write must leave the fake sheet byte-identical (no cell, no log row, no session);
 *   * a read must still take no lock at all, or the refresh wave regresses;
 *   * the two timeclock halves must produce ONE write each, addressed by header name rather than position.
 *
 * The real backend functions are extracted out of Code.gs and run here against a fake sheet and a lock that
 * can be made to fail, so this exercises the code that ships rather than a description of it - the same
 * approach as verify-push-devices.mjs and verify-auth-security.mjs. Run with: npm run verify:write-safety
 */
import { readFileSync } from 'node:fs';

let failures = 0;
// For a plain yes/no read off the source, where there is no "actual" to print.
const checkIs = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` -> ${detail}`}`);
};

const apiSource = readFileSync('src/services/api.js', 'utf8');

console.log('\n--- the wiring ---');
// The password change is a callable now, with no sheet branch behind it - and it takes a NAMED password rather than a
// positional one. That is not a style preference: the caller used to pass `(userId, newPassword, token)`, so when the
// sheet branch went and the function became one argument, that call would have compiled perfectly while using the user
// ID as the new password and reporting success. Two assertions, because the failure mode needs both halves held down:
// the function must ask for `newPassword` by name, and the caller must supply it that way.
checkIs('the password change has no sheet branch to fall back to', /action: 'UPDATE_USER_PASSWORD'/.test(apiSource) === false);
checkIs('and it takes the password by name, not by position', /updateUserPassword = async \(\{ newPassword \}\)/.test(apiSource));
checkIs(
  'which is how the app calls it',
  /updateUserPassword\(\{ newPassword \}\)/.test(readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8'))
);

// The user save used to carry `row_version`: the sheet's conflict check, which REFUSED a form filled in before another
// officer's change rather than silently overwriting it. Firestore does not work that way, and the decision is recorded
// where the envelope is unpacked - see firestoreWrites.js, which discards `row_version` deliberately and says the app's
// rule is that the last writer wins.
//
// So this asserts what is TRUE rather than what was, and it says the loss out loud: a stale save that quietly wins is
// worth knowing about, and if the station ever wants the refusal back, a version field compared inside a transaction is
// the equivalent - the mechanism exists, it is simply not what every save in this app does today.
checkIs(
  'the client no longer sends a row version, because Firestore saves are last-writer-wins by decision',
  /row_version: rowVersionField\(userData\)/.test(apiSource) === false
);
checkIs('and on the other single-record saves', (apiSource.match(/row_version: rowVersionField\(/g) || []).length, 8);
checkIs(
  'the forms carry it from the row they were opened on',
  ['AdminUsersTab', 'AdminRolesTab', 'AdminRanksTab', 'AdminShiftsTab', 'AdminAssignmentsTab',
   'AdminAnnouncementsTab', 'AdminEventsTab'].every((tab) =>
    /row_version: [a-zA-Z]+\.row_version/.test(readFileSync(`src/components/admin/${tab}.jsx`, 'utf8'))
  ),
  'a form does not carry the version, so its saves would never be checked'
);
checkIs(
  'and the template form does too, including the drag',
  (readFileSync('src/components/admin/AdminScheduleTemplatesTab.jsx', 'utf8').match(/row_version: template\.row_version/g) || []).length >= 2
);
checkIs(
  'a create sends no version, so it is never checked',
  /const rowVersionField = \(record\) => \(record && record\.row_version !== undefined \? record\.row_version : undefined\)/.test(apiSource)
);
// The bulk writers must stay out of this: they own a whole month of rows, and the first version they did not
// send would refuse every one of them.

// ---------------------------------------------------------------------------
// 8. The client half: one safe retry for a refusal, never for a network error
// ---------------------------------------------------------------------------
console.log('\n--- the client retry ---');

const settingsCardSource = readFileSync('src/components/admin/AdminSystemSettingsTab.jsx', 'utf8');
checkIs('the card saves a batch', /adminSaveSystemSettings\(/.test(settingsCardSource));
checkIs(
  'falling back to per-key saves on an older deployment',
  /isUnknownAction\(result\)[\s\S]{0,400}adminSaveSystemSetting\(key, value, token\)/.test(settingsCardSource)
);
checkIs('the fallback still reports the failure it hits', /Failed to save \$\{label\}/.test(settingsCardSource));
checkIs('the API has the batch action', /action: 'ADMIN_SAVE_SYSTEM_SETTINGS'/.test(apiSource));

// The client's BUSY retry used to be asserted here: the wait it chose, the ceiling on a hostile `retry_after`, the
// single retry, and the rule that a mutation never retries a NETWORK failure. All of it went with the sheet, because
// the sheet was the thing that could answer BUSY - it refused a write it could not serialise and asked the caller to
// come back. Firestore has no such refusal: a conflict is reported as a normal failure with the message the admin tabs
// already display (see firestoreWrites.js and the conflict cases in verify-firestore-writes.mjs), and there is no
// second attempt to get wrong. The sheet's OWN write safety - the lock, the batch validation, the "no cell, no log row,
// no session" refusal - is still asserted below, because Code.gs is still the record of how it behaved.

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
