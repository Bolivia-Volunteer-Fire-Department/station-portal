/**
 * Verifies the Firefighter Runner leaderboard and the runner sound profiles.
 *
 * The WRITE rules (clamp, improve-only, the type-repair) live in the `saveRunnerScore` callable in
 * `functions/index.js` — a browser cannot be trusted with the one number everybody compares — and
 * the board read is a bounded Firestore query exercised on the emulator by verify-firestore-reads.
 * This file pins the callable's rules as source assertions and exercises the pure sound-profile
 * helpers the game and the settings screen share:
 *
 *   - sound profile resolution and validation (src/utils/runnerSounds.js): a profile is a PREFIX,
 *     an unknown one falls back to the defaults, and a profile has to be usable in a filename;
 *   - the callable's guard rails: clamped, improve-only, applied in a transaction.
 *
 *   npm run verify:runner
 */
import { readFileSync } from 'node:fs';
import {
  RUNNER_SOUNDS,
  isValidSoundProfile,
  normalizeSoundProfile,
  resolveSoundUrl,
  soundPath,
  soundsForProfile,
} from '../src/utils/runnerSounds.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` -> ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`}`
  );
};

console.log('--- sound profiles: which files the game plays ---');
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

console.log('\n--- the callable\u2019s guard rails ---');
// The score arrives from a browser, so the clamp and the improve-only rule live in the callable.
// Asserted as source so a regression here fails a test rather than the leaderboard's integrity.
const functionsSource = readFileSync('functions/index.js', 'utf8');
check('the score is clamped to a ceiling', /Math\.max\(0, Math\.min\(parsed, RUNNER_SCORE_MAX\)\)/.test(functionsSource), true);
check('the ceiling is a sane positive number', /const RUNNER_SCORE_MAX = \d+;/.test(functionsSource), true);
check('a run may only ever improve a personal best', /if \(score > previous\) \{[\s\S]{0,200}runner_score: score/.test(functionsSource), true);
check('the comparison and the write run in a transaction', /runTransaction/.test(functionsSource), true);
check('a non-numeric stored score is repaired, not changed', /typeof stored !== 'number' && previous > 0/.test(functionsSource), true);
check('and requires sign-in', /if \(!request\.auth\) throw new HttpsError\('unauthenticated'/.test(functionsSource), true);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
