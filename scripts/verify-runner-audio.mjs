/**
 * Verifies the Firefighter Runner's audio: which music track plays when, and the two switches - the
 * music, and the game's own sound effects.
 *
 * The track choice is a pure decision in src/utils/runnerMusic.js, so it is exercised directly. The
 * Audio elements, the file imports and the two buttons are the component's job, and are asserted
 * against its source - the same split, and the same reason, as the rest of the game.
 *
 *   npm run verify:runner-audio
 */
import { readFileSync, readdirSync } from 'node:fs';
import { MUSIC_TRACKS, MUSIC_VOLUME, musicTrackFor } from '../src/utils/runnerMusic.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` -> ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`}`);
};
const checkIs = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` -> ${detail}`}`);
};

console.log('--- which track plays when ---');
check('a run that is not on plays the menu', musicTrackFor({ playing: false, boss: false, cycle: 0 }), 'menu');
check('the boss level plays the boss track', musicTrackFor({ playing: true, boss: true, cycle: 3 }), 'boss');
check('ordinary play starts on the first normal track', musicTrackFor({ playing: true, boss: false, cycle: 0 }), 'normal');
check('and alternates on the next cycle', musicTrackFor({ playing: true, boss: false, cycle: 1 }), 'normal2');
check('then back again the cycle after', musicTrackFor({ playing: true, boss: false, cycle: 2 }), 'normal');
check('the menu wins even mid-cycle', musicTrackFor({ playing: false, boss: true, cycle: 5 }), 'menu');

console.log('\n--- the tracks are the files beside the game ---');
const DIR = 'src/components/FirefighterRunner';
const FILE_FOR = {
  menu: 'menu_music.mp3',
  normal: 'normal_music.mp3',
  normal2: 'normal_music2.mp3',
  boss: 'boss_music.mp3',
};
const present = readdirSync(DIR);
check('the track names are the four the game uses', MUSIC_TRACKS, Object.keys(FILE_FOR));
check('and every one is on disk', MUSIC_TRACKS.filter((track) => !present.includes(FILE_FOR[track])), []);

console.log('\n--- the music sits under the effects ---');
checkIs('the volume is set and low', MUSIC_VOLUME > 0 && MUSIC_VOLUME <= 0.5, `${MUSIC_VOLUME}`);

console.log('\n--- the component wires the music in ---');
const component = readFileSync(`${DIR}/FirefighterRunner.jsx`, 'utf8');
checkIs(
  'every track is imported',
  Object.values(FILE_FOR).every((file) => component.includes(`from "./${file}"`))
);
checkIs(
  'the loop asks the pure decision what to play',
  /playMusic\(musicTrackFor\(\{ playing: true, boss: !!level\.chief, cycle: level\.cycle \}\)\)/.test(component)
);
checkIs(
  'and the screens either side of a run play the menu track',
  /musicTrackFor\(\{ playing: false \}\)/.test(component)
);
checkIs(
  'the music button is in the HUD, for everyone',
  /aria-label=\{musicMuted \? "Unmute the music" : "Mute the music"\}/.test(component)
);
checkIs(
  'toggling it flips the state',
  /onClick=\{\(\) => setMusicMuted\(\(muted\) => !muted\)\}/.test(component)
);
checkIs('and it is the flag stored under the music key', /useStoredFlag\(MUSIC_MUTED_KEY\)/.test(component));
checkIs('leaving the game stops the music', /musicAudioRef\.current\.pause\(\)/.test(component));

console.log('\n--- the sounds switch (the game\u2019s own effects) ---');
checkIs(
  'there is a switch for them, beside the music one',
  /aria-label=\{sfxMuted \? "Unmute the game sounds" : "Mute the game sounds"\}/.test(component)
);
checkIs(
  'toggling it flips the state',
  /onClick=\{\(\) => setSfxMuted\(\(muted\) => !muted\)\}/.test(component)
);
checkIs('it gates every effect through playSound', /if \(sfxMutedRef\.current\) return;/.test(component));
checkIs('and it is the flag stored under its own key', /useStoredFlag\(SFX_MUTED_KEY\)/.test(component));

console.log('\n--- both switches are remembered on the device ---');
checkIs('through one helper', /function useStoredFlag\(key\) \{/.test(component));
checkIs('that reads the key back on mount', /localStorage\.getItem\(key\)/.test(component));
checkIs('and writes the choice out', /localStorage\.setItem\(key, on \? "1" : "0"\)/.test(component));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
