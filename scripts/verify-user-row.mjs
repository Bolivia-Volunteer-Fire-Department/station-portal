/**
 * Verifies the Users tab's save path: the local merge that keeps the list live, and the SHAPE OF THE WRITE.
 *
 * The save is one write, but the list it renders is refreshed by a separate wave of requests - tens of seconds
 * under Apps Script, and a scoped section read now. The saved row is therefore merged into the list locally, and
 * these are the rules that merge has to keep:
 *
 *   - only an EXISTING row is touched (a new member's id is server-assigned)
 *   - no password ever reaches the list
 *   - only the fields the editor owns are copied, so a server-set column is not clobbered
 *   - the refresh still runs, so the local copy is eventually replaced
 *
 * The second half is the one a member reported: "missing or insufficient access" when saving a member, from an
 * administrator who could save roles and certifications. The cause was mine, not the rules': `users` writes are
 * checked with `hasOnly`, against the document AFTER the write - and the save used `{ merge: true }`, so every extra
 * field already on the stored row (the spreadsheet's `id`, which the migration left in place) was re-produced in
 * `request.resource.data` and the write was refused. The rule's allowlist and the fields api.js sends are therefore
 * asserted AGAINST EACH OTHER here, so a merge cannot come back without one of them noticing.
 *
 *   npm run verify:user-row
 */
import { readFileSync } from 'node:fs';
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

console.log('\n--- the write sends exactly the shape the rules allow ---');
// The rule's allowlist, read out of the rules file rather than restated, so the two cannot drift apart.
// Paths are relative to the REPO ROOT, which is where the harness is run from - and it has to be that, not
// import.meta.url: this file is run from a built copy under tmp-test-out/, one directory away from the sources.
const rulesSource = readFileSync('firestore.rules', 'utf8');
const usersRule = /match \/users\/\{userId\} \{[\s\S]*?hasOnly\(\[([^\]]*)\]\)/.exec(rulesSource)?.[1];
const allowedFields = String(usersRule || '')
  .split(',')
  .map((name) => name.trim().replace(/^'|'$/g, ''))
  .filter(Boolean);
check('the rules list the fields a client may write', allowedFields.length >= 5, true);

const apiSource = readFileSync('src/services/api.js', 'utf8');
const writeStart = apiSource.indexOf("doc(firestore(), 'users', String(userData.id))");
check('the member save writes the users document', writeStart > -1, true);
// The call, comments stripped: a comment naming a field would otherwise be read as one being written.
const writeCall = apiSource
  .slice(writeStart, apiSource.indexOf(');', writeStart))
  .replace(/\/\/[^\n]*/g, '');
const writtenFields = [...writeCall.matchAll(/^\s*([a-z_]+):/gm)].map((match) => match[1]);
check('it writes no field the rules do not allow', writtenFields.filter((field) => !allowedFields.includes(field)), []);
check('and it writes every field they do', allowedFields.filter((field) => !writtenFields.includes(field)), []);
// THE BUG ITSELF. A merge makes the written document the post-merge one, so ANY field already stored - a spreadsheet
// column the migration copied, a field added by an older build - is re-produced and refused by `hasOnly`. A full
// replace writes the declared shape and nothing else, which is why it is required rather than preferred.
check('and it REPLACES the document rather than merging into it', /merge\s*:/.test(writeCall), false);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);