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
import { isNewRunnerBest } from '../src/utils/runnerBoard.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` -> ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`}`
  );
};
// The second shape, for the questions whose answer is a condition rather than a value - every harness here has both.
const checkIs = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` -> ${detail}`}`);
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

console.log('\n--- a run opens the board only when it set a new high score ---');
// THE DECISION IS A RULE, not an inline boolean: it decides whether a dialog covers the game-over screen. Two numbers
// can say yes and utils/runnerBoard holds the argument for why both count - the server's `improved`, and whether the run
// beat the number the HUD was showing. What this pins is the ONLY-IF half: a run that improved nothing opens nothing.
check('a run that beat the record opens it', isNewRunnerBest({ improved: true, beatShownBest: false }), true);
check('a run that beat the number on screen opens it', isNewRunnerBest({ improved: false, beatShownBest: true }), true);
check('a run that beat both opens it', isNewRunnerBest({ improved: true, beatShownBest: true }), true);
check('a run that beat neither does not', isNewRunnerBest({ improved: false, beatShownBest: false }), false);
check('and a score that was merely recorded does not', isNewRunnerBest({}), false);
check('nor does nothing at all', isNewRunnerBest(), false);
// A FAILED SAVE IS NOT A THIRD CASE: there is no answer from the server to read, so the screen's own comparison is what
// is left - which is what happens when the only fact passed in is that one.
check('a save that never landed falls back to the screen', isNewRunnerBest({ beatShownBest: true }), true);
check('and opens nothing if the screen saw no record either', isNewRunnerBest({ beatShownBest: false }), false);
// Strictly true, not merely truthy: `improved` is the callable's own flag, and a string that arrived in its place is
// not the server saying yes.
check('a truthy flag is not the server saying so', isNewRunnerBest({ improved: 'yes' }), false);

console.log('\n--- the board is a dialog, and the component wires it that way ---');
const componentSource = readFileSync('src/components/FirefighterRunner/FirefighterRunner.jsx', 'utf8');
checkIs(
  'the board is a dialog that says so',
  /role="dialog"/.test(componentSource) && /aria-modal="true"/.test(componentSource)
);
// THE PORTAL, and the reason it is not optional here: the cabinet carries the world's scale transform, and a fixed child
// of a transformed ancestor is positioned against it rather than the viewport.
checkIs('handed to the viewport rather than left inside the cabinet', /renderInViewport\(/.test(componentSource));
checkIs(
  'opened from a button in the HUD, beside the sound switches',
  /aria-haspopup="dialog"[\s\S]{0,200}aria-expanded=\{boardOpen\}[\s\S]{0,200}onClick=\{openBoard\}/.test(componentSource)
);
// ASKED BEFORE rememberBest - which is what makes the question answerable at all. `rememberBest` writes the run's score
// into the very ref the comparison reads, so asking afterwards would always answer "no", and the board would never open
// by itself for anybody.
checkIs(
  'the question is asked before the best is overwritten',
  /const beatShownBest = finalScore > highScoreRef\.current;[\s\S]{0,120}rememberBest\(finalScore\);/.test(componentSource)
);
checkIs(
  'and both answers are put to the rule',
  /isNewRunnerBest\(\{ improved: result\.improved === true, beatShownBest \}\)/.test(componentSource) &&
    /isNewRunnerBest\(\{ beatShownBest \}\)/.test(componentSource)
);
// THE KEYBOARD IS THE DIALOG'S WHILE IT IS UP, or space would restart a run behind it - the game's keys are on `window`,
// so the guard has to be there rather than on the cabinet.
checkIs(
  'the game keys stand down while it is open, and Escape closes it',
  /if \(boardOpen\) \{[\s\S]{0,200}event\.key === "Escape"[\s\S]{0,80}dismissBoard\(\)/.test(componentSource)
);
// The backdrop dismisses, the panel does not: a press that lands inside is the member reading the board.
checkIs(
  'only the backdrop itself dismisses it',
  /event\.target === event\.currentTarget/.test(componentSource)
);
// WHAT HAPPENED TO THE SCORE is on the run's own screen, not in the board: "SCORE SENT · YOUR BEST IS STILL …" has to be
// readable without opening anything, and the board is a dialog that is usually shut.
checkIs(
  'the save notices are on the game-over screen, not inside the board',
  componentSource.indexOf('SCORE SENT') > 0 &&
    componentSource.indexOf('SCORE SENT') < componentSource.indexOf('ffr__modal-backdrop') &&
    // Nothing about the save notice appears anywhere after the dialog begins, which is the positive form of "the board
    // does not draw it" - and it survives the dialog growing.
    componentSource.lastIndexOf('savedNotice') < componentSource.indexOf('ffr__modal-backdrop')
);
const boardStyles = readFileSync('src/components/FirefighterRunner/FirefighterRunner.css', 'utf8');
// THE CLOSED STATE, which is the one that would be a bug rather than an annoyance: an invisible backdrop that still took
// presses would swallow every click on the game.
checkIs(
  'the closed dialog is hidden and takes no clicks',
  /\.ffr__modal-backdrop \{[\s\S]{0,400}visibility: hidden;/.test(boardStyles)
);
checkIs(
  'and the open one is visible, so the fade has two ends',
  /\.ffr__modal-backdrop--open \{[\s\S]{0,80}visibility: visible;/.test(boardStyles)
);
checkIs(
  'with the fade dropped when motion is not wanted',
  /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,600}\.ffr__modal-backdrop \{[\s\S]{0,60}transition: none;/.test(boardStyles)
);
checkIs(
  'and a close control a thumb can hit',
  /\.ffr__modal-close \{[\s\S]{0,220}width: 40px;[\s\S]{0,40}height: 40px;/.test(boardStyles)
);
// THE PALETTE AND THE FACE REACH THE DIALOG, which they only do because they are declared for BOTH elements. The portal
// puts the dialog in document.body - outside `.ffr` - so a palette and a font-family declared on the cabinet alone are
// simply absent in there: the yellow frame would take the text colour and the dialog would come up in the app's default
// face instead of the cabinet's. This is the check that would have caught it.
checkIs(
  'the palette and the face are declared for the portalled dialog too',
  /\.ffr,\n\.ffr__modal-backdrop \{[\s\S]{0,400}--ffr-yellow:/.test(boardStyles) &&
    /\.ffr,\n\.ffr__modal-backdrop \{[\s\S]{0,500}font-family:/.test(boardStyles)
);

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
