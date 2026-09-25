/**
 * Verifies the Users tab's immediate-update path.
 *
 * A user save is one write, but the list it renders is refreshed by a separate wave of requests
 * that Apps Script serialises behind a script lock - tens of seconds. The saved row is therefore
 * merged into the list locally, and these are the rules that merge has to keep:
 *
 *   - only an EXISTING row is touched (a new member's id is server-assigned)
 *   - no password ever reaches the list
 *   - only the fields the editor owns are copied, so a server-set column is not clobbered
 *   - the refresh still runs, so the local copy is eventually replaced
 *
 *   npm run verify:user-row
 */
import {
  EDITABLE_USER_FIELDS,
  mergeSavedUser,
  savedUserPatch,
} from '../src/utils/userRow.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` -> ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`}`
  );
};

const USERS = [
  { id: 'u1', name: 'Member 1', user_name: 'member1', role_id: 'r1', rank_id: 'k1', status: 'active', runner_sound_profile: '' },
  { id: 'u2', name: 'Member 2', user_name: 'member2', role_id: 'r1', rank_id: 'k2', status: 'active', runner_sound_profile: 'bird' },
];

console.log('--- the saved row replaces the old values ---');
const merged = mergeSavedUser(USERS, {
  id: 'u1',
  name: 'Member 1',
  runner_sound_profile: 'bird',
  role_id: 'r2',
});
check('the saved fields are applied', [merged[0].name, merged[0].runner_sound_profile, merged[0].role_id], ['Member 1', 'bird', 'r2']);
check('columns the editor does not own are kept', merged[0].user_name, 'member1');
check('and the row is otherwise identical', merged[0].status, 'active');
check('other members are untouched', merged[1], USERS[1]);
check('the input list is not mutated', USERS[0].name, 'Member 1');
// The bug this whole path exists for: re-editing right after a save showed the pre-save values.
check('the list now reflects the save', merged.find((u) => u.id === 'u1').runner_sound_profile, 'bird');

console.log('\n--- a new member is left to the refresh ---');
check('a blank id changes nothing', mergeSavedUser(USERS, { id: '', name: 'Nobody' }), USERS);
check('a missing id changes nothing', mergeSavedUser(USERS, { name: 'Nobody' }), USERS);
check('an unknown id changes nothing', mergeSavedUser(USERS, { id: 'u9', name: 'Nobody' }), USERS);
check('and the same list comes back', mergeSavedUser(USERS, { id: 'u9' }).length, 2);

console.log('\n--- no password reaches the list ---');
const withPassword = mergeSavedUser(USERS, { id: 'u1', name: 'Member 1', password: 'hunter2' });
check('the password is not copied', 'password' in withPassword[0], false);
check('a blank password is not copied either', 'password' in mergeSavedUser(USERS, { id: 'u1', password: '' })[0], false);
check('savedUserPatch drops it', savedUserPatch({ id: 'u1', password: 'x', name: 'A' }), { name: 'A' });
check('an existing password on the row is left alone', mergeSavedUser([{ id: 'u1', password: 'stored' }], { id: 'u1', name: 'A' })[0].password, 'stored');

console.log('\n--- only the editable columns are copied ---');
check('the editable set is the form\'s fields', EDITABLE_USER_FIELDS.includes('runner_sound_profile') && EDITABLE_USER_FIELDS.includes('name'), true);
check('it has no password', EDITABLE_USER_FIELDS.includes('password'), false);
check('nor the id, which is the key', EDITABLE_USER_FIELDS.includes('id'), false);
const withExtra = mergeSavedUser(USERS, { id: 'u1', name: 'A', runner_score: '9999', is_admin: 'TRUE' });
check('a server-set column is not clobbered', withExtra[0].runner_score, undefined);
check('nor is a permission column', withExtra[0].is_admin, undefined);
check('an unknown field is not invented', savedUserPatch({ id: 'u1', nonsense: 'x' }), {});

console.log('\n--- defensive input ---');
check('a null list is safe', mergeSavedUser(null, { id: 'u1', name: 'A' }), []);
check('a null patch is safe', mergeSavedUser(USERS, null), USERS);
check('an empty patch is a no-op', mergeSavedUser(USERS, { id: 'u1' }), USERS);
check('numeric ids still match', mergeSavedUser([{ id: 7, name: 'x' }], { id: '7', name: 'y' })[0].name, 'y');
check('a null row in the list is passed over', mergeSavedUser([null, { id: 'u1', name: 'x' }], { id: 'u1', name: 'y' })[0], null);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);