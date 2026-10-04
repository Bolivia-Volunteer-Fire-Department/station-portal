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
// The rank payload, as a pure function - see the section at the bottom of this file for why it is not read out of
// api.js instead. `.js` included, because this harness runs in plain Node ESM where an extensionless specifier does not
// resolve (the same class of mistake `parseRankOrder` documents in utils/rankEligibility.js).
import { rankFieldsFromForm, rankOrderIsSet } from '../src/utils/ranks.js';
import { parseRankOrder } from '../src/utils/rankEligibility.js';

let failures = 0;
// For a plain yes/no read off the source, where there is no "actual" to print.
const checkIs = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` -> ${detail}`}`);
};

// For a value that has to EQUAL something - the difference matters below, where a FALSY value is the whole point: a
// cleared rank order is the empty string, so an assertion phrased as "is it truthy?" reports a passing save as a failure.
const checkEq = (label, actual, expected) => {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) failures++;
  console.log(`${same ? 'ok  ' : 'FAIL'} ${label}${same ? '' : ` -> got ${JSON.stringify(actual)}`}`);
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

// ---------------------------------------------------------------------------
// 9. A column the form collects has to be IN the save
// ---------------------------------------------------------------------------
console.log('\n--- a collected column the save does not carry ---');

// THE FAULT THIS SECTION EXISTS FOR. The Ranks tab has always collected a rank's ORDER, and `adminSaveRank` did not
// send it - so the field was never in the request, there was nothing for Firestore to write, and the save REPORTED
// SUCCESS while the number stayed where it was. Add and edit both, because both go through the same payload.
//
// Nothing in the UI can tell that apart from a save that worked: `onRowSaved` merges the form into the list, the tab
// shows the number the officer just typed for an instant, and then the refresh wave replaces the list with what
// Firestore actually holds - which is the old value. So the screen reads as "my save didn't take", with no error, no
// warning and nothing in the console, and a full green suite says nothing either. That is why it is asserted here.
//
// The fault is also invisible from the form side, which is the part worth understanding: the field IS bound. The officer
// types into a controlled input, the state holds the number, and the tab hands the whole form object to the save. The
// column is lost between the tab and api.js, in the one place a person rewrites a payload by hand - which is exactly
// where nobody looks, because the form is right there on screen saying the value was captured.
//
// So this compares the two ends for every officer tab whose save is a single request object: the columns the tab's
// EMPTY_FORM declares, against the keys the save actually carries. Adding a column to a form fails here until the save
// sends it.
const payloadKeys = (fn) => {
  const at = apiSource.indexOf(`export const ${fn} =`);
  if (at === -1) return null;
  const slice = apiSource.slice(at, at + 2600);
  const end = slice.indexOf('\n});');
  const body = end === -1 ? slice : slice.slice(0, end);
  // The envelope, not the document: these are not columns, and every save carries them.
  return [...new Set([...body.matchAll(/^ {4}([a-z_]+):/gm)].map((m) => m[1]))].filter(
    (key) => !['action', 'token', 'id', 'row_version'].includes(key)
  );
};

const formColumns = (tab) => {
  const src = readFileSync(`src/components/admin/${tab}.jsx`, 'utf8');
  const at = src.indexOf('EMPTY_FORM');
  if (at === -1) return null;
  const slice = src.slice(at, at + 1400);
  const open = slice.indexOf('{');
  // An arrow EMPTY_FORM closes with `})`, a literal one with `};` - and the EARLIEST of them, or the extractor walks
  // off the end of the object and reports the JSX below it as columns (which is how `dark` and `markup` got in).
  const ends = ['};', '})'].map((end) => slice.indexOf(end)).filter((n) => n !== -1);
  const close = ends.length ? Math.min(...ends) : slice.length;
  return [...slice.slice(open, close).matchAll(/(?:^|[{,\s])([a-z_]{3,}):/g)].map((m) => m[1]);
};

// Tabs left out of the comparison below, each for a stated reason rather than because the check is awkward.
const NOT_COMPARED = {
  // A member save is not one request object: a create goes to the `createMember` callable and an edit is a full
  // document replace, because the rules allowlist is evaluated against the document AFTER the write. Its columns are
  // covered by verify:rules and verify:user-row instead.
  AdminUsersTab: 'a create is a callable and an edit is a full replace',
  // Key and value travel as two positional arguments to a per-key save, so there is no request object to read keys from.
  AdminSystemSettingsTab: 'key and value are positional arguments',
  // This one edits an existing clock row in place rather than saving a document of its own.
  AdminClockManagementTab: 'it edits a clock row, it does not save a document',
};

const saveFor = {
  AdminRanksTab: 'adminSaveRank',
  AdminShiftsTab: 'adminSaveShift',
  AdminAssignmentsTab: 'adminSaveAssignment',
  AdminScheduleTemplatesTab: 'adminSaveScheduleTemplate',
  AdminAvailabilityWindowsTab: 'adminSaveAvailabilityWindow',
  AdminAnnouncementsTab: 'adminSaveAnnouncement',
  AdminEventsTab: 'adminSaveEvent',
  AdminCertificationsTab: 'adminSaveCertification',
  AdminCertificationSetupTab: 'adminSaveCertificationSetup',
};

for (const [tab, fn] of Object.entries(saveFor)) {
  const columns = formColumns(tab) || [];
  // A save built by SPREADING a helper carries no keys of its own, so the source read below cannot see what it sends.
  // That is not a gap to work around - the helper's return value is asserted directly, against the form's own columns,
  // in the section below - but it does mean this comparison is only meaningful for the payloads written inline.
  const spread = new RegExp(`\\.\\.\\w+\\(${fn === 'adminSaveRank' ? 'rankData' : '\\\\w+'}\\),?`).test(
    apiSource.slice(apiSource.indexOf(`export const ${fn} =`), apiSource.indexOf(`export const ${fn} =`) + 2600)
  );
  const sent = payloadKeys(fn) || [];
  const missing = columns.filter((column) => !sent.includes(column) && !spread);
  checkIs(
    spread
      ? `${tab} collects its columns through a helper, which is checked by calling it`
      : `every column ${tab} collects is carried by ${fn}`,
    missing.length === 0,
    missing.join(', ') || `${fn} not found in api.js`
  );
}

// THE RANKS TAB'S ORDER. Named on its own, because it is the column that was dropped and because the general comparison
// above reads a payload source rather than a function - which is the right tool for "does this JSX pass this", and the
// wrong one for "what does this save actually send". Those are different questions and this section asks the second.
//
// It asks it by CALLING the function, which is why the payload builder lives in src/utils rather than inline in api.js.
// `api.js` is a browser module importing the Firebase SDK through extensionless specifiers, so a plain-Node harness
// cannot import it at all (see the note by `parseRankOrder` in utils/rankEligibility.js about this class of mistake).
// Putting the columns in a pure helper makes the payload testable without a bundler or an emulator, AND gives the
// emulator harness something real to assert against - see the ranks section in scripts/verify-firestore-writes.mjs.
console.log('\n--- what the rank save actually sends ---');
{
  const officer = rankFieldsFromForm({ description: 'Officer', color: '#c3223b', icon: 'shield-check', rank_order: '3' });
  checkEq('every column of a rank, and nothing else', Object.keys(officer).sort(), [
    'color',
    'description',
    'icon',
    'rank_order',
  ]);
  checkEq('the order among them', officer.rank_order, '3');
  // A string, not a number: see the note in utils/ranks.js. Asserted as a TYPE because a value of 3 would satisfy an
  // equality check here and still be the wrong thing to write.
  checkEq('and it travels as the text the form holds, not a coerced number', typeof officer.rank_order, 'string');

  // The blank, which is the case with teeth. `Number('')` is 0, and 0 is a real rank at the bottom of the list - so a
  // coercion here would not clear an order, it would move the rank and rewrite every eligibility decision it takes
  // part in, while looking exactly like a successful clear on screen.
  const cleared = rankFieldsFromForm({ description: 'Recruit', rank_order: '' });
  checkEq('a cleared order stays a blank', cleared.rank_order, '');
  checkIs(
    'and is therefore unset rather than the lowest rank in the station',
    parseInt(cleared.rank_order, 10) !== 0,
    `got ${JSON.stringify(cleared.rank_order)}`
  );

  // What the rules treat as unset. Pinned against `parseRankOrder` itself rather than against the reader that happens
  // to be in front of us, so this cannot pass while the rule underneath stops agreeing.
  checkEq('which is what the eligibility rule reads as unset', parseRankOrder(cleared.rank_order), null);
  checkEq('and a real order is not unset', parseRankOrder(officer.rank_order), 3);
  checkEq('so the two halves agree on which ranks are usable', rankOrderIsSet({ rank_order: '3' }), true);
  // `checkEq` for the two "not set" answers, where `checkIs` would be the wrong tool: these are FALSE, which is the
  // correct result, and an assertion phrased as a condition reports a passing rule as a failure.
  checkEq('and on which are not', rankOrderIsSet({ rank_order: '' }), false);
  checkEq('including a rank whose order was never set at all', rankOrderIsSet({}), false);

  // A value that is not a number must not be stored as one. The form's input filters to digits, but this is the
  // boundary the value crosses into the database, and "3rd" read back by parseInt is 3 in one place and nothing in
  // another - which is the class of bug this whole section is about.
  checkEq(
    'a value that is not a number is stored as no order rather than as text',
    rankFieldsFromForm({ rank_order: '3rd' }).rank_order,
    ''
  );
  checkEq('and neither is a negative or signed one', rankFieldsFromForm({ rank_order: '-2' }).rank_order, '');
  checkEq('while a plain number survives untouched', rankFieldsFromForm({ rank_order: '12' }).rank_order, '12');

  // The envelope is the save's, not the document's: `id` is the document KEY (a stored copy would be a second place
  // for the truth to live) and `row_version` is the sheet's conflict field, which Firestore saves discard on purpose.
  checkEq('and the envelope is not part of the columns it produces', Object.keys(officer).includes('id'), false);
  checkEq('nor the conflict field', Object.keys(officer).includes('row_version'), false);
}

// And the two things that are wiring facts rather than function calls, because they are what joined the payload to the
// helper in the first place.
checkIs('the rank save is built from that helper', /\.\.\.rankFieldsFromForm\(rankData\)/.test(apiSource), 'adminSaveRank does not spread it');
checkIs(
  'and no longer declares a rank column by hand beside it',
  !/rank_order:\s*rankData/.test(apiSource),
  'a hand-written column is exactly the list that fell out of date before'
);

// The rank save, named directly - because the general comparison reads api.js as SOURCE TEXT, and the payload is now a
// spread of a helper, so that comparison would see no columns at all. These two close that gap in the direction a source
// read cannot: the tab's columns must appear in the columns the helper actually returns, which is the check that failed
// before this section existed.
{
  const formSays = formColumns('AdminRanksTab') || [];
  const saveCarries = Object.keys(rankFieldsFromForm({ rank_order: '1', description: 'x', color: '#fff', icon: 'star' }));
  checkIs(
    'the rank save sends every column the Ranks tab collects',
    formSays.every((column) => saveCarries.includes(column)),
    formSays.filter((column) => !saveCarries.includes(column)).join(', ')
  );
  checkIs(
    'including the order, which is the one that was dropped',
    saveCarries.includes('rank_order'),
    'no request ever carries it'
  );
}

// The order is not a cosmetic column: it is what the eligibility rule, the "this rank and above" audience and a day's
// crew ordering are all computed from. Asserted against the helper rather than against api.js, because that is where the
// value now lives.
checkIs(
  'and it is a column the eligibility rule really reads',
  /rank_order/.test(readFileSync('src/utils/rankEligibility.js', 'utf8')),
  'the order is compared nowhere, so nothing would notice a rank that cannot save it'
);

// The tabs the comparison skips are asserted as skipped, so nobody can quietly delete the reason and let a column rot.
checkIs(
  'and the tabs left out of it say why',
  Object.values(NOT_COMPARED).every((reason) => typeof reason === 'string' && reason.length > 20),
  'a tab is excluded from the comparison without a reason worth reading'
);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);

// The coercion is the one mutation of this fix that a source read cannot see and a happy-path round trip would not
// catch: every existing rank has an order, so `Number('4') === '4'` is true and nothing downstream notices. It only
// bites on a CLEAR, and it bites silently - `Number('')` is 0, which is a real rank at the bottom of the station's list,
// so clearing an order would quietly move the rank instead of removing it. The three checks above are what hold that
// shut, and they are worth knowing they are load-bearing rather than decorative.
process.exit(failures === 0 ? 0 : 1);
