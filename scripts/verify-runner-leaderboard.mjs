/**
 * Verifies the Firefighter Runner leaderboard rules in Code.gs.
 *
 * Both halves of the feature are pure functions extracted from the real backend, so they run
 * here against stubbed sheet data:
 *
 *   - runnerLeaderboard: which rows reach the client. A blank or 0 cell means "never played",
 *     so those members must not pad the board with zeroes, and the projection must not leak
 *     other columns off the users sheet.
 *   - runnerScoreToStore: what may be written. The score arrives from a browser, so it is
 *     clamped, and a run may only ever improve a personal best - a bad game must not cost a
 *     member their position.
 *
 *   npm run verify:runner
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  RUNNER_SOUNDS,
  isValidSoundProfile,
  normalizeSoundProfile,
  resolveSoundUrl,
  soundPath,
  soundsForProfile,
} from '../src/utils/runnerSounds.js';

const source = fs.readFileSync(path.resolve(process.cwd(), 'src/services/Code.gs'), 'utf8');
const lines = source.split('\n');

const findLine = (marker) => {
  const index = lines.findIndex((line) => line.startsWith(marker));
  if (index === -1) throw new Error(`Could not find "${marker}" in Code.gs`);
  return lines[index];
};

const extractFunction = (marker) => {
  const start = lines.findIndex((line) => line.startsWith(marker));
  if (start === -1) throw new Error(`Could not find "${marker}" in Code.gs`);
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === '}') return lines.slice(start, i + 1).join('\n');
  }
  throw new Error(`Could not find the end of "${marker}"`);
};

const block = [
  findLine('const RUNNER_LEADERBOARD_LIMIT'),
  findLine('const RUNNER_SCORE_MAX'),
  extractFunction('function runnerLeaderboard(ss) {'),
  extractFunction('function runnerScoreToStore(currentBest, rawScore) {'),
].join('\n');

// The one Apps Script global these functions touch.
const makeApi = (users) => {
  const factory = new Function(
    'getSheetData',
    `${block}\nreturn { runnerLeaderboard, runnerScoreToStore, RUNNER_LEADERBOARD_LIMIT, RUNNER_SCORE_MAX };`
  );
  return factory((ss, sheetName) => (sheetName === 'users' ? users : []));
};

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` -> ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`}`
  );
};

console.log('--- the board only lists real scores ---');
// Deliberately messy, the way a hand-kept sheet is: blanks, a 0, a text score, a member row
// with no name, and a stray password column that must never leave the server.
const users = [
  { id: 'u1', name: 'Member 3', runner_score: 900, password: 'secret-hash' },
  { id: 'u2', name: 'Member 1', runner_score: '1450' },
  { id: 'u3', name: 'Never Played', runner_score: 0 },
  { id: 'u4', name: 'Blank Cell', runner_score: '' },
  { id: 'u5', name: 'No Column' },
  { id: 'u6', name: '   ', runner_score: 300 },
  { id: 'u7', name: 'Junk', runner_score: 'abc' },
  { id: '', name: 'No Id', runner_score: 5000 },
  { id: 'u8', name: '  Padded  ', runner_score: 300 },
];

const api = makeApi(users);
const board = api.runnerLeaderboard({});

check('only scores above zero are listed', board.rows.length, 4);
check('in descending order', board.rows.map((r) => r.score), [1450, 900, 300, 300]);
check('a numeric string counts as a score', board.rows[0].name, 'Member 1');
// The 300 tie keeps sheet order, so the blank-name row (u6) precedes the padded one (u8).
check('a blank name stays blank for the client to label', board.rows[2].name, '');
check('names are trimmed', board.rows[3].name, 'Padded');
check('a row with no id is not a member', board.rows.some((r) => r.score === 5000), false);
check('the total counts everyone with a score', board.total, 4);
check('only id, name and score are projected', Object.keys(board.rows[0]).sort(), ['id', 'name', 'score']);
check('no other column leaks out', JSON.stringify(board.rows).includes('secret-hash'), false);
check('an empty users sheet is an empty board', makeApi([]).runnerLeaderboard({}), { rows: [], total: 0 });
// Ties keep their sheet order (no invented tiebreak).
check('a tie keeps sheet order', board.rows.map((r) => r.id), ['u2', 'u1', 'u6', 'u8']);

console.log('\n--- the board is capped, but the total is not ---');
const many = Array.from({ length: 40 }, (_, i) => ({
  id: `m${i}`,
  name: `Member ${i}`,
  runner_score: 1000 - i,
}));
const capped = makeApi(many).runnerLeaderboard({});
check('the limit is applied', capped.rows.length, api.RUNNER_LEADERBOARD_LIMIT);
check('starting from the highest', capped.rows[0].score, 1000);
check('while the total still counts everyone', capped.total, 40);
check('the limit is a sane positive number', api.RUNNER_LEADERBOARD_LIMIT > 0, true);

console.log('\n--- a run may only ever improve a personal best ---');
const store = api.runnerScoreToStore;
check('a first score is stored', store(0, 500), 500);
check('a blank cell counts as no best', store('', 500), 500);
check('beating the best is stored', store(400, 900), 900);
check('tying the best changes nothing', store(900, 900), null);
check('a worse run changes nothing', store(900, 120), null);
check('scoring nothing is never stored', store(0, 0), null);

console.log('\n--- the score arrives from a browser, so it is clamped ---');
check('a negative score is refused', store(0, -250), null);
check('a text score is refused', store(0, 'lots'), null);
check('a missing score is refused', store(0, undefined), null);
check('null is refused', store(0, null), null);
check('a float is truncated to a whole number', store(0, '1234.9'), 1234);
check('an absurd score is clamped to the ceiling', store(0, 99999999), api.RUNNER_SCORE_MAX);
check('and the ceiling is well above a real run', api.RUNNER_SCORE_MAX >= 10000, true);
check('a corrupted best is treated as none', store('rubbish', 700), 700);

console.log('\n--- sound profiles: which files the game plays ---');
// A profile is a PREFIX, so `bird` means bird-jump.wav. The resolution is pure, and the fallback
// to the defaults is what makes an empty or mistyped profile harmless rather than silent.
const FILES = {
  './jump.wav': '/assets/jump.wav',
  './die.wav': '/assets/die.wav',
  './point.wav': '/assets/point.wav',
  './bird-jump.wav': '/assets/bird-jump.wav',
  './bird-die.wav': '/assets/bird-die.wav',
  './bird-point.wav': '/assets/bird-point.wav',
  // A set that is incomplete: only the jump sound exists.
  './half-jump.wav': '/assets/half-jump.wav',
};

check('the sounds are named jump, die and point', RUNNER_SOUNDS, ['jump', 'die', 'point']);
check('no profile resolves to the default file', soundPath('', 'jump'), './jump.wav');
check('a profile prefixes the filename', soundPath('bird', 'jump'), './bird-jump.wav');
check(
  'and for each sound',
  RUNNER_SOUNDS.map((s) => soundPath('bird', s)),
  ['./bird-jump.wav', './bird-die.wav', './bird-point.wav']
);
// The profile comes from a text field, so surrounding whitespace must not break the lookup.
check('a padded profile still resolves', soundPath('  bird  ', 'die'), './bird-die.wav');

check('an empty profile plays the default', resolveSoundUrl(FILES, '', 'jump'), '/assets/jump.wav');
check('a set profile plays that set', resolveSoundUrl(FILES, 'bird', 'jump'), '/assets/bird-jump.wav');
check(
  'and the rest of the set too',
  RUNNER_SOUNDS.map((s) => resolveSoundUrl(FILES, 'bird', s)),
  ['/assets/bird-jump.wav', '/assets/bird-die.wav', '/assets/bird-point.wav']
);
check('a padded profile works', resolveSoundUrl(FILES, ' bird ', 'point'), '/assets/bird-point.wav');

// The fallbacks: an unknown profile, and a set that is only half there.
check('an unknown profile falls back to the default', resolveSoundUrl(FILES, 'nope', 'jump'), '/assets/jump.wav');
check('a half-complete set uses what it has', resolveSoundUrl(FILES, 'half', 'jump'), '/assets/half-jump.wav');
check('and falls back for the sounds it is missing', resolveSoundUrl(FILES, 'half', 'die'), '/assets/die.wav');
check('a missing default resolves to nothing', resolveSoundUrl({}, 'bird', 'jump'), null);
check('soundsForProfile returns all three', Object.keys(soundsForProfile(FILES, 'bird')).sort(), ['die', 'jump', 'point']);
check('and the defaults for an empty profile', soundsForProfile(FILES, '').point, '/assets/point.wav');

console.log('\n--- a profile has to be usable in a filename ---');
check('empty is valid', isValidSoundProfile(''), true);
check('whitespace is valid, because it trims to empty', isValidSoundProfile('   '), true);
check('letters are valid', isValidSoundProfile('bird'), true);
check('digits, dashes and underscores too', isValidSoundProfile('set-2_b'), true);
check('a path separator is not', isValidSoundProfile('../secrets'), false);
check('nor is a slash', isValidSoundProfile('sounds/bird'), false);
check('nor a space in the middle', isValidSoundProfile('two words'), false);
check('nor an extension', isValidSoundProfile('bird.wav'), false);
check('undefined normalizes to empty', normalizeSoundProfile(undefined), '');
check('and null too', normalizeSoundProfile(null), '');
check('a number is stringified', normalizeSoundProfile(42), '42');

console.log('\n--- the backend validates it the same way ---');
const backendSounds = new Function(
  `${extractFunction('const RUNNER_SOUND_PROFILE_PATTERN')}
   ${extractFunction('function normalizeRunnerSoundProfile')}
   ${extractFunction('function runnerSoundProfileIsValid')}
   return { normalizeRunnerSoundProfile, runnerSoundProfileIsValid };`
)();

check('the backend accepts an empty profile', backendSounds.runnerSoundProfileIsValid(''), true);
check('and a plain prefix', backendSounds.runnerSoundProfileIsValid('bird'), true);
check('but not a path', backendSounds.runnerSoundProfileIsValid('../x'), false);
check('nor a space', backendSounds.runnerSoundProfileIsValid('two words'), false);
check('and it trims before validating', backendSounds.normalizeRunnerSoundProfile('  bird  '), 'bird');
// The two validators must agree, or the form and the server would disagree about what is allowed.
const soundProbes = ['', 'bird', 'set-2_b', '../x', 'two words', 'bird.wav', 'BIRD'];
check(
  'the client and backend agree on every probe',
  soundProbes.every(
    (value) =>
      isValidSoundProfile(value) ===
      backendSounds.runnerSoundProfileIsValid(backendSounds.normalizeRunnerSoundProfile(value))
  ),
  true
);

console.log('\n--- only an administrator can set it ---');
// The requirement is is_admin, not can_edit_users. The field rides along with the users row now, so
// the guard sits inside ADMIN_SAVE_USER; the member's own settings save must not accept the column
// either, or anyone could choose their own sound set.
//
// The body is bounded by the NEXT case rather than by a named one: naming a case that appears
// earlier in the file yields an empty slice, which makes an assertion pass without testing
// anything. The length guard below is what turns that mistake into a failure.
const caseBody = (name) => {
  const marker = `case "${name}"`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`Code.gs is missing ${marker}`);
  const next = source.indexOf('\n      case "', start);
  return source.slice(start, next === -1 ? source.length : next);
};
const saveUserCase = caseBody('ADMIN_SAVE_USER');
const memberSettingsCase = caseBody('UPDATE_USER_SETTINGS');
const getUsersCase = caseBody('ADMIN_GET_USERS');

check('all three case bodies were found', [saveUserCase, memberSettingsCase, getUsersCase].every((c) => c.length > 200), true);

// ADMIN_SAVE_USER still requires can_edit_users for the row itself.
check('saving a user requires can_edit_users', /hasRolePermission\(ss, authCtx\.userId, "can_edit_users"\)/.test(saveUserCase), true);
// But the profile needs is_admin on top of it.
check('the profile additionally requires is_admin', /isAdminUser\(ss, authCtx\.userId\)/.test(saveUserCase), true);
check('and is only written inside that check', saveUserCase.indexOf('isAdminUser(ss, authCtx.userId)') < saveUserCase.indexOf('userFields.runner_sound_profile'), true);
check('it validates the profile', /runnerSoundProfileIsValid\(soundProfile\)/.test(saveUserCase), true);
// Anchored on the CALL, not the bare name: the name is also mentioned in the comments above this block, and
// indexOf would then be measuring a comment against the refusal it is supposed to precede.
const writeCall = saveUserCase.indexOf('const savedUserId = upsertSheetRowById');
check('the write call was found in the case', writeCall > -1, true);
check('and refuses an invalid one before writing', saveUserCase.indexOf('A sound profile can only contain') < writeCall, true);
// upsertSheetRowById does not grow the header row, so a missing column has to be reported.
check('a missing column is reported, not swallowed', /has no runner_sound_profile column/.test(saveUserCase), true);
check('the column check happens before the write', saveUserCase.indexOf('has no runner_sound_profile column') < saveUserCase.indexOf('upsertSheetRowById(usersSheetAdmin'), true);

check('a member\'s own settings save never writes the column', /settingsValues\.runner_sound_profile/.test(memberSettingsCase), false);
check('it is not in the whitelist at all', /settingsValues\.runner_sound_profile\s*=/.test(memberSettingsCase), false);
check('and the exclusion is recorded', /Deliberately NOT accepted/.test(memberSettingsCase), true);

// The column lives on the users sheet, so the admin fetch needs no merge from anywhere else.
check('the admin user list is the users sheet', /getSheetData\(ss, "users"\)/.test(getUsersCase), true);
check('with no merge from user_settings', /user_settings/.test(getUsersCase), false);
check('and passwords are still stripped', /delete userCopy\.password/.test(getUsersCase), true);

check('the column lives on the users sheet', /runner_sound_profile/.test(saveUserCase), true);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);


console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
