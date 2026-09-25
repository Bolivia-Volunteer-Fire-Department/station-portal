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

const codeSource = readFileSync('src/services/Code.gs', 'utf8');
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

// The payload, which is where the other flag was lost.
checkIs('the save sends the flag', /is_change_password_on_login: userData\.is_change_password_on_login/.test(apiSource));
checkIs(
  'and the exclusion flag that was already being dropped',
  /exclude_from_scheduling: userData\.exclude_from_scheduling/.test(apiSource),
  'this payload did not carry exclude_from_scheduling, so that checkbox did nothing'
);
checkIs('the backend accepts the flag', /userFields\.is_change_password_on_login =/.test(codeSource));
checkIs(
  'normalized to TRUE/FALSE, and only when supplied',
  /rawMustChange !== undefined/.test(codeSource) && /=== "TRUE" \? "TRUE" : "FALSE"/.test(codeSource)
);
// A missing column is the silent failure this feature cannot have: upsertSheetRowById writes by header name and
// does not grow the header row, so the value would vanish and the checkbox would appear to work.
checkIs(
  'a missing column is refused rather than swallowed',
  /if \(userHeadersForFlag\.indexOf\("is_change_password_on_login"\) === -1\)/.test(codeSource)
);

// ---------------------------------------------------------------------------
// 4. Clearing the flag
// ---------------------------------------------------------------------------
console.log('\n--- when it is cleared ---');
checkIs(
  'changing your own password clears it',
  /const changeFlagIdx = userHeaders\.indexOf\("is_change_password_on_login"\);/.test(codeSource) &&
    /usersSheet\.getRange\(targetUserRow, changeFlagIdx \+ 1\)\.setValue\("FALSE"\)/.test(codeSource)
);
checkIs(
  'and says whether that change was the required one',
  /responseData = \{ success: true, requiredChange: wasForced \}/.test(codeSource)
);
checkIs(
  'the log distinguishes a required change',
  /User changed the password they were required to change at sign-in/.test(codeSource)
);
// An administrator setting a password decides the flag themselves, so their path must NOT auto-clear it - or the
// temporary password they just handed over could never be forced to change. Scoped to the case body itself,
// because the comment above the self-service clear names this action and would otherwise match.
const adminSaveUserBody = (codeSource.split('case "ADMIN_SAVE_USER": {')[1] || '').split('\n      case ')[0];
checkIs('the ADMIN_SAVE_USER case was found', adminSaveUserBody.length > 0);
checkIs(
  'an administrator setting a password does not auto-clear it',
  !/is_change_password_on_login"\)\.setValue|changeFlagIdx/.test(adminSaveUserBody),
  'the admin path must let the checkbox decide'
);
checkIs(
  'and it writes the flag the administrator chose',
  /userFields\.is_change_password_on_login =/.test(adminSaveUserBody)
);
checkIs(
  'the client clears its own copy so the modal closes',
  /setCurrentUser\(\(prev\) => \(\{ \.\.\.prev, \[MUST_CHANGE_PASSWORD_COLUMN\]: 'FALSE' \}\)\)/.test(appSource)
);

// ---------------------------------------------------------------------------
// 5. The popup itself
// ---------------------------------------------------------------------------
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
// 6. The real switch cases, against a stand-in users sheet
// ---------------------------------------------------------------------------
// extractCase lifts one case out of doPost by name, brace-matched so nested blocks come with it. The body is run
// inside its own switch (the trailing `break` needs one) with the spreadsheet calls standing in for Apps Script.
const extractCase = (name, source = codeSource) => {
  const marker = `case "${name}": {`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`Code.gs has no case ${name}`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces in case ${name}`);
};

class FakeSheet {
  // Copies the rows it is given, so a test's own fixture is never mutated by the code under test - read the
  // result back off `result.sheet.rows`, not off the array you passed in.
  constructor(rows) {
    this.rows = rows.map((row) => row.slice());
  }
  getDataRange() {
    return { getValues: () => this.rows.map((row) => row.slice()) };
  }
  getRange(row, column) {
    const sheet = this;
    return {
      setValue(value) {
        sheet.rows[row - 1][column - 1] = value;
        return this;
      },
      getValue() {
        return sheet.rows[row - 1][column - 1];
      },
    };
  }
}

const runUserCase = (actionName, { rows, data = {}, userId = 'user-1', source = codeSource, deps = {} }) => {
  const sheet = new FakeSheet(rows);
  const recorded = { logged: [], revoked: [], upserted: null };
  const scope = {
    ss: { getSheetByName: (name) => (name === 'users' ? sheet : null) },
    data,
    payload: {},
    getAuthContext: () => ({ userId }),
    hashPasswordValue: (value) => `hashed:${value}`,
    revokeSessionsForUser: (id, token) => recorded.revoked.push([id, token]),
    logSystemEvent: (unused, actor, action, details) => recorded.logged.push({ actor, action, details }),
    // The administrator path's own dependencies.
    hasRolePermission: () => true,
    isAdminUser: () => true,
    normalizeRunnerSoundProfile: (value) => String(value == null ? '' : value),
    runnerSoundProfileIsValid: () => true,
    upsertSheetRowById: (unused, fields) => {
      recorded.upserted = { ...fields };
      return fields.id || 'saved-row';
    },
    ...deps,
  };
  const names = Object.keys(scope);
  const body = `let responseData = null;\nswitch (${JSON.stringify(actionName)}) {\n${extractCase(actionName, source)}\n}\nreturn responseData;`;
  const response = new Function(...names, body)(...names.map((name) => scope[name]));
  return { response, sheet, recorded };
};

const HEADERS = ['id', 'user_name', 'name', 'password', 'status', 'role_id', 'rank_id', 'exclude_from_scheduling', 'is_change_password_on_login'];
const HEADERS_NO_FLAG = HEADERS.filter((header) => header !== 'is_change_password_on_login');
const withFlag = (flag) => [HEADERS, ['user-1', 'jsmith', 'Jane Smith', 'hashed:old', 'active', 'r1', 'k1', 'FALSE', flag]];
const across = (rows) => rows[1][HEADERS.indexOf('is_change_password_on_login')];
const withoutFlag = () => [HEADERS_NO_FLAG, ['user-1', 'jsmith', 'Jane Smith', 'hashed:old', 'active', 'r1', 'k1', 'FALSE']];
const passwordColumn = (result) => result.sheet.rows[1][HEADERS.indexOf('password')];

console.log('\n--- the self-service change, run for real ---');
const forced = runUserCase('UPDATE_USER_PASSWORD', { rows: withFlag('TRUE'), data: { password: 'unit-42', token: 'tok' } });
check('it succeeds', forced.response.success, true);
check('and reports that this change was a required one', forced.response.requiredChange, true);
check('the new password is stored hashed, never in the clear', passwordColumn(forced), 'hashed:unit-42');
check('the flag is cleared', across(forced.sheet.rows), 'FALSE');
checkIs(
  'and the log says it was the one they were required to change',
  forced.recorded.logged[0].details.includes('required to change'),
  forced.recorded.logged[0].details
);
check('other sessions are still revoked', forced.recorded.revoked.length, 1);

const ordinaryChange = runUserCase('UPDATE_USER_PASSWORD', { rows: withFlag('FALSE'), data: { password: 'unit-42' } });
check('an ordinary change reports nothing required', ordinaryChange.response.requiredChange, false);
check('and logs the ordinary wording', ordinaryChange.recorded.logged[0].details, 'User successfully updated their account password.');

// The escape route that must not exist: a refusal has to leave the flag alone, or clearing it would be as easy
// as submitting an empty password.
const refused = runUserCase('UPDATE_USER_PASSWORD', { rows: withFlag('TRUE'), data: { password: '' } });
check('a blank password is refused', refused.response.success, false);
check('the flag is untouched', across(refused.sheet.rows), 'TRUE');
check('and nothing was written', passwordColumn(refused), 'hashed:old');

// An older copy of the station's file, without the column.
const noColumn = runUserCase('UPDATE_USER_PASSWORD', { rows: withoutFlag(), data: { password: 'unit-42' } });
check('a sheet with no flag column still changes the password', noColumn.response.success, true);
check('and reports nothing required rather than guessing', noColumn.response.requiredChange, false);
check('with the password stored', passwordColumn(noColumn), 'hashed:unit-42');

console.log('\n--- the administrator save, run for real ---');
const ticked = runUserCase('ADMIN_SAVE_USER', {
  rows: withFlag('FALSE'),
  data: { id: 'user-1', user_name: 'jsmith', name: 'Jane Smith', password: 'temp-1', is_change_password_on_login: 'TRUE' },
});
check('ticking the box writes TRUE', ticked.recorded.upserted.is_change_password_on_login, 'TRUE');
check('and the temporary password is hashed', ticked.recorded.upserted.password, 'hashed:temp-1');

const unticked = runUserCase('ADMIN_SAVE_USER', {
  rows: withFlag('TRUE'),
  data: { id: 'user-1', user_name: 'jsmith', name: 'Jane Smith', is_change_password_on_login: 'false' },
});
check('unticking it writes FALSE, whatever case it arrives in', unticked.recorded.upserted.is_change_password_on_login, 'FALSE');
check('and with no password supplied, none is written', 'password' in unticked.recorded.upserted, false);

// An older client that has never heard of the column must not clear it behind the administrator's back.
const silent = runUserCase('ADMIN_SAVE_USER', {
  rows: withFlag('TRUE'),
  data: { id: 'user-1', user_name: 'jsmith', name: 'Jane Smith' },
});
check('a client that does not send the flag leaves it alone', 'is_change_password_on_login' in silent.recorded.upserted, false);

const noColumnSave = runUserCase('ADMIN_SAVE_USER', {
  rows: withoutFlag(),
  data: { id: 'user-1', user_name: 'jsmith', name: 'Jane Smith', is_change_password_on_login: 'TRUE' },
});
check('ticking it on a sheet with no column is refused', noColumnSave.response.success, false);
checkIs(
  'with a message naming the column',
  /is_change_password_on_login column/.test(noColumnSave.response.message || ''),
  noColumnSave.response.message
);
check('and nothing was written', noColumnSave.recorded.upserted, null);

console.log('\n--- and the flag reaches the member at sign-in ---');
// The end of the chain: an administrator ticks the box, and the flag has to come back out with the login so the
// app knows to hold them. Run rather than reasoned about, because the login reply is built by copying the whole
// row and deleting the password - copy-then-delete is exactly the shape that can go wrong silently.
const loginDeps = (member) => ({
  getSheetData: () => [member],
  checkLoginRateLimit: () => ({ allowed: true }),
  verifyPasswordValue: (stored, submitted) => ({ ok: stored === `hashed:${submitted}`, needsRehash: false, reason: 'pbkdf2' }),
  createSession: () => 'test-token',
  cleanupExpiredSessions: () => {},
  recordLoginSuccess: () => {},
  dummyPasswordVerification_: () => {},
  Logger: { log: () => {} },
});
const signedIn = runUserCase('LOGIN', {
  rows: withFlag('TRUE'),
  data: { username: 'jsmith', password: 'temp-1' },
  deps: loginDeps({ id: 'user-1', user_name: 'jsmith', name: 'Jane Smith', password: 'hashed:temp-1', status: 'active', is_change_password_on_login: 'TRUE' }),
});
check('the member signs in with the temporary password', signedIn.response.success, true);
check('and the flag comes back with them', signedIn.response.user.is_change_password_on_login, 'TRUE');
check('so the app knows to hold them at the popup', mustChangePassword(signedIn.response.user), true);
check('and the password is still never sent to the client', 'password' in signedIn.response.user, false);

const signedInWithout = runUserCase('LOGIN', {
  rows: withFlag('FALSE'),
  data: { username: 'jsmith', password: 'temp-1' },
  deps: loginDeps({ id: 'user-1', user_name: 'jsmith', name: 'Jane Smith', password: 'hashed:temp-1', status: 'active', is_change_password_on_login: 'FALSE' }),
});
check('an ordinary member is not held', mustChangePassword(signedInWithout.response.user), false);

// And the whole round trip, driven through the sheet: tick it, sign in, change, sign in again.
console.log('\n--- the round trip ---');
const rowAsObject = (rows) => Object.fromEntries(HEADERS.map((header, column) => [header, rows[1][column]]));
const roundTrip = withFlag('FALSE');
const handedOver = runUserCase('ADMIN_SAVE_USER', {
  rows: roundTrip,
  data: { id: 'user-1', user_name: 'jsmith', name: 'Jane Smith', password: 'temp-1', is_change_password_on_login: 'TRUE' },
});
// Apply what the administrator's save wrote, the way upsertSheetRowById does it: by header name, onto the row.
HEADERS.forEach((header, column) => {
  if (header in handedOver.recorded.upserted) roundTrip[1][column] = handedOver.recorded.upserted[header];
});
check('the administrator hands over a temporary password, flagged', across(roundTrip), 'TRUE');
check('so the member is held at the next sign-in', mustChangePassword(rowAsObject(roundTrip)), true);
const changedOwn = runUserCase('UPDATE_USER_PASSWORD', { rows: roundTrip, data: { password: 'my-own-42' } });
check('they set their own password', changedOwn.response.success, true);
check('which was the required change', changedOwn.response.requiredChange, true);
check('they are free to use the app afterwards', mustChangePassword(rowAsObject(changedOwn.sheet.rows)), false);
check('with the new password on the sheet, hashed', passwordColumn(changedOwn), 'hashed:my-own-42');
console.log('\n--- and the harness notices when it is broken ---');
const withoutClearing = codeSource.replace(
  'usersSheet.getRange(targetUserRow, changeFlagIdx + 1).setValue("FALSE");',
  '/* mutation check: the clearing write removed */'
);
checkIs('the mutation actually changed the source', withoutClearing !== codeSource);
const mutated = runUserCase('UPDATE_USER_PASSWORD', {
  rows: withFlag('TRUE'),
  data: { password: 'unit-42' },
  source: withoutClearing,
});
check('the password still changes in the mutated copy', mutated.response.success, true);
checkIs(
  'but the flag is left set, which is what the test above exists to catch',
  across(mutated.sheet.rows) === 'TRUE',
  across(mutated.sheet.rows)
);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

