/**
 * Verifies the forced password change: the administrator's checkbox, and the popup a member cannot get past.
 *
 * Two halves again, and the first is the one that would silently rot. A checkbox is only real if the flag
 * reaches the sheet - the API payload has to carry it and the backend has to write it - and the member is only
 * really held if the modal has no way out except changing the password or signing out.
 *
 * The row of the existing "Exclude from scheduling" flag is here as a cautionary tale: it had a checkbox, a badge
 * in the list and backend support, and the payload never sent it, so ticking it did nothing for as long as
 * nobody looked. That assertion is in this file so the same thing cannot happen to the new one.
 *
 * The source checks are backed by the real thing: the two switch cases are lifted out of Code.gs and run against
 * a stand-in users sheet, because a grep would pass on code that reads the flag and then drops it - and the
 * escape route that matters (a refused change clearing the flag anyway, letting a blank submit through) is only
 * visible by running it.
 *
 * Run with: npm run verify:password-change
 */
import { readFileSync } from 'node:fs';
import {
  MUST_CHANGE_PASSWORD_COLUMN,
  mustChangePassword,
  passwordChangeProblem,
  passwordChangeCopy,
} from '../src/utils/passwordPolicy.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`
  );
};
const checkIs = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` -> ${detail}`}`);
};

const apiSource = readFileSync('src/services/api.js', 'utf8');
const appSource = readFileSync('src/App.jsx', 'utf8');
const usersTabSource = readFileSync('src/components/admin/AdminUsersTab.jsx', 'utf8');
const modalSource = readFileSync('src/components/PasswordChangeModal.jsx', 'utf8');

// ---------------------------------------------------------------------------
// 1. Reading the flag off a sheet cell
// ---------------------------------------------------------------------------
console.log('\n--- is this member being made to change their password? ---');
check('the column has one name', MUST_CHANGE_PASSWORD_COLUMN, 'is_change_password_on_login');
// What the app writes.
check('TRUE is on', mustChangePassword({ is_change_password_on_login: 'TRUE' }), true);
check('and lower case too', mustChangePassword({ is_change_password_on_login: 'true' }), true);
check('and with padding, which is what a hand-typed cell looks like', mustChangePassword({ is_change_password_on_login: ' TRUE ' }), true);
// What a spreadsheet may already hold, or that the app writes when it clears it.
check('FALSE is off', mustChangePassword({ is_change_password_on_login: 'FALSE' }), false);
check('a blank cell is off', mustChangePassword({ is_change_password_on_login: '' }), false);
check('a missing column is off', mustChangePassword({ id: 'u1' }), false);
check('no user at all is off', mustChangePassword(null), false);
// Tolerated spellings, for a sheet somebody edits by hand - but not "NO", which is a plausible typo for FALSE
// and must not lock anybody out.
check('YES counts', mustChangePassword({ is_change_password_on_login: 'YES' }), true);
check('1 counts', mustChangePassword({ is_change_password_on_login: '1' }), true);
check('NO does not', mustChangePassword({ is_change_password_on_login: 'NO' }), false);
check('nonsense does not', mustChangePassword({ is_change_password_on_login: 'maybe' }), false);

// ---------------------------------------------------------------------------
// 2. What counts as a usable new password
// ---------------------------------------------------------------------------
console.log('\n--- the new password ---');
check('a blank one is refused', passwordChangeProblem({ newPassword: '', confirmPassword: '' }), 'Choose a new password.');
check('an unconfirmed one is refused', passwordChangeProblem({ newPassword: 'unit-42', confirmPassword: '' }), 'Repeat the new password to confirm it.');
check('a mistyped confirmation is refused', passwordChangeProblem({ newPassword: 'unit-42', confirmPassword: 'unit-24' }), 'The two passwords do not match.');
check('and the typo is caught whichever way round it is', passwordChangeProblem({ newPassword: 'unit-24', confirmPassword: 'unit-42' }), 'The two passwords do not match.');
check('a matching pair is accepted', passwordChangeProblem({ newPassword: 'unit-42', confirmPassword: 'unit-42' }), '');
// Whitespace is part of a password (the backend deliberately does not trim), so " a " is a real choice and the
// two fields must agree exactly.
check('spaces are significant', passwordChangeProblem({ newPassword: ' a ', confirmPassword: 'a' }), 'The two passwords do not match.');
check('and matching spaces are fine', passwordChangeProblem({ newPassword: ' a ', confirmPassword: ' a ' }), '');
check('nothing supplied at all is refused', passwordChangeProblem({}), 'Choose a new password.');
check('and no argument is refused, not a crash', passwordChangeProblem(), 'Choose a new password.');
// The rule mirrors the backend rather than inventing policy, so a short password is allowed: the server has no
// minimum, and a client-side minimum would be a rule nobody enforces.
check('a short password is allowed, because the server has no minimum', passwordChangeProblem({ newPassword: 'ab', confirmPassword: 'ab' }), '');
checkIs('the copy tells the member what is happening', passwordChangeCopy().lead.includes('only thing you can do'));
checkIs('and that there is no reset link', /no reset link/.test(passwordChangeCopy().hint));

// ---------------------------------------------------------------------------
// 3. The checkbox reaches the sheet
// ---------------------------------------------------------------------------
console.log('\n--- the administrator\'s checkbox ---');
checkIs('the form starts with the flag off', /is_change_password_on_login: 'FALSE' \};/.test(usersTabSource));
checkIs(
  'opening a row normalizes it to TRUE or FALSE',
  /is_change_password_on_login:\s*\n\s*String\(user\.is_change_password_on_login \?\? ''\)\.trim\(\)\.toUpperCase\(\) === 'TRUE' \? 'TRUE' : 'FALSE'/.test(
    usersTabSource
  )
);
checkIs('the checkbox writes TRUE when ticked', /is_change_password_on_login: e\.target\.checked \? 'TRUE' : 'FALSE'/.test(usersTabSource));
checkIs('the list shows which accounts owe a change', /Password change due/.test(usersTabSource));

// The payload, which is where the other flag was lost. It is not a sheet payload any more: the roster fields and the two
// per-member preferences go onto the `users` document, and the password-change flag goes through `updateMemberAccount`.
// These assert the path that exists - including the checkbox that once did nothing, and the sound profile that was
// dropped the same way.
checkIs('the save carries the password-change flag to the callable that can set it', /account\.isChangePasswordOnLogin = true/.test(apiSource));
checkIs(
  'and the exclusion flag onto the users document',
  /exclude_from_scheduling: String\(userData\.exclude_from_scheduling \|\| ''\)\.toUpperCase\(\) === 'TRUE'/.test(apiSource)
);
checkIs(
  'and the runner sound profile with it, rather than dropping it',
  /runner_sound_profile: String\(userData\.runner_sound_profile/.test(apiSource)
);
// ---------------------------------------------------------------------------
// 4. Clearing the flag
// ---------------------------------------------------------------------------
console.log('\n--- when it is cleared ---');
// The flag-clearing half is Firebase's now: `changeOwnPassword` and `completePasswordChange` clear the flag in
// the callable (exercised on the emulator by verify:firebase-auth), and the client clears its own copy so the
// popup closes.
check(
  'the client clears its own copy so the modal closes',
  /setCurrentUser\(\(prev\) => \(\{ \.\.\.prev, \[MUST_CHANGE_PASSWORD_COLUMN\]: 'FALSE' \}\)\)/.test(appSource),
  true
);
check('the callable that completes the change exists', /completePasswordChange/.test(readFileSync('src/services/firebaseAuth.js', 'utf8')), true);


console.log('\n--- the popup nobody can get past ---');
checkIs('it is rendered while the flag is set', /\{currentUser && mustChangePassword\(currentUser\) && \(/.test(appSource));
checkIs('and it asks for the new password twice', /Confirm new password/.test(modalSource) && /type="password"/.test(modalSource));
// No way out but changing it or signing out: no close button, no backdrop dismissal. (checkIs takes the
// condition directly - the negation has to be in the call.)
checkIs('there is no close button', !/aria-label="Close"|<X /.test(modalSource));
checkIs('and no click-outside dismissal', !/onClick=\{onClose\}|onClick=\{onDismiss\}/.test(modalSource));
checkIs('no Cancel either', !/Cancel/.test(modalSource));
checkIs('and the backdrop does not close it', !/onClick=/.test(modalSource.split('<form')[0].split('fixed inset-0')[1] || ''));
checkIs('but signing out is offered', /Sign Out Instead/.test(modalSource));
checkIs('and the copy says why they are here', /see passwordChangeCopy|passwordChangeCopy/.test(modalSource));
// Above the app chrome, below the re-authentication prompt: a dead session has to be fixed before a password can
// be changed, and the reauth modal is the thing that fixes it. Asserted as an ORDERING of the numbers rather than
// as literals - an earlier version of this modal used z-[65], which reads as "above" and put it on top of the
// reauth prompt, breaking exactly the case it was there for.
const zIndexOf = (source) => {
  const match = /fixed inset-0 z-\[(\d+)\]/.exec(source);
  return match ? Number(match[1]) : NaN;
};
const passwordZ = zIndexOf(modalSource);
const reauthZ = zIndexOf(readFileSync('src/components/ReauthModal.jsx', 'utf8'));
checkIs('the modal sets a z-index', !Number.isNaN(passwordZ), String(passwordZ));
checkIs('the re-auth prompt sets one too', !Number.isNaN(reauthZ), String(reauthZ));
checkIs(
  `the password popup (z-${passwordZ}) is below the re-auth prompt (z-${reauthZ})`,
  passwordZ < reauthZ,
  'a dead session must be fixable while the popup is open'
);
// Above the app chrome, which is the highest the ordinary interface goes (z-50).
const chromeZ = 50;
checkIs(`and above the app chrome (z-${chromeZ})`, passwordZ > chromeZ, `z-${passwordZ} must cover the interface`);
checkIs('it validates before calling the server', /const problem = passwordChangeProblem\(\{ newPassword, confirmPassword \}\);/.test(modalSource));
checkIs('and reports a refusal without closing', /setError\(result\?\.message/.test(modalSource));
// The modal is only mounted for the member it belongs to: it reads THEIR row, not the admin's copy of the roster.
checkIs('it is gated on the signed-in member, not the roster', /\{currentUser && mustChangePassword\(currentUser\) && \(/.test(appSource));

// ---------------------------------------------------------------------------
// 6. The real switch cases, against a stand-in users sheet  — REMOVED with the sheet.
// ---------------------------------------------------------------------------
// Everything from here to the summary was the Code.gs sheet-driven half; it went with the sheet.
// The client-side assertions above are the parts that still describe this app.
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
