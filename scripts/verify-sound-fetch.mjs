/**
 * Verifies that a sound is fetched ONCE per session, and not once per voice in its pool.
 *
 * What this exists for: a session's network log showed every sound arriving three times - a 206 for the first and
 * two 304 revalidations for the others. The three voices are deliberate (a single element restarts and truncates
 * itself, so rapid clicks would cut each other off), but each voice used to be `new Audio(url)` with
 * `preload = 'auto'`, and each of those loads the URL itself: three requests for one file, for every sound that got
 * used, every session.
 *
 * The fix is one fetch per sound, with every voice built from those bytes. It is asserted by driving the REAL
 * engine against a stubbed transport and counting what it asked for, because "fetched once" is a claim about
 * requests rather than about how the code reads - and this feature has been wrong about that before: the pool
 * promised overlapping sounds while quietly downloading each of them three times.
 *
 * A voice created against a file URL counts as a request, because in a browser it is one. Only the copies
 * (`blob:`) are free. That is why the FIRST press of a sound is reported as two - the press plays from the file in
 * the gesture that asked for it, while the copy is fetched alongside - and why every press after it is zero.
 *
 * Run with: npm run verify:sound-fetch
 */
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

// ---------------------------------------------------------------------------
// The transport the engine will be handed
// ---------------------------------------------------------------------------
// Installed BEFORE the engine is imported, because the engine registers its first-gesture priming as it loads.
const fetches = [];
const audios = [];
const gestures = new Map();

let failNextFetch = false;
globalThis.fetch = (url) => {
  fetches.push(String(url));
  if (failNextFetch) {
    failNextFetch = false;
    return Promise.reject(new Error('offline'));
  }
  return Promise.resolve({ ok: true, blob: async () => new Blob([new Uint8Array([0])]) });
};

class FakeAudio {
  constructor(src) {
    this.src = src;
    this.preload = '';
    this.volume = 1;
    this.paused = true;
    this.currentTime = 0;
    this.plays = 0;
    audios.push(this);
  }

  play() {
    this.plays += 1;
    this.paused = false;
    return Promise.resolve();
  }
}
globalThis.Audio = FakeAudio;

globalThis.document = {
  addEventListener(event, handler, options) {
    gestures.set(event, { handler, options });
  },
  removeEventListener(event) {
    gestures.delete(event);
  },
};

// Every sound the engine has asked the network for, counting the voices that load a file as the requests they are.
const requests = () => fetches.length + audios.filter((voice) => !String(voice.src).startsWith('blob:')).length;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// Driven from an async main() rather than at the top level: the vite-ssr build this runs through does not accept
// top-level await.
const main = async () => {
  const { playSound, primeSound, setSoundsEnabled, SOUND_FILES, setSoundVolume, resetSoundVolumes, soundVolumeRows } =
    await import('../src/utils/uiSounds.js');
  // Held onto from the section below, so the level checks can drive the SAME voices the presses did - which is the
  // only way to show that a level reaches voices that already exist.
  let toastSuccessPool = [];

  console.log('\n--- the first press of a sound ---');
  checkIs('the engine resolves a sound to a file', String(SOUND_FILES.toast_success).includes('.mp3'));
  check('pressing it still plays immediately', playSound('toast_success'), true);
  check('from the file, in the gesture that asked for it', audios.length, 1);
  checkIs('and not from a copy', !String(audios[0].src).startsWith('blob:'));
  // Two, and only on this first press: the press loads the file itself (that is the request that makes it audible
  // inside the gesture that asked for it) and the copy is fetched alongside it. Every press after this one is
  // free, which is the whole point.
  check('so the first press of a sound costs two requests', requests(), 2);
  await settle();
  check('one of which is the copy', fetches.length, 1);

  console.log('\n--- every press after it ---');
  {
    const before = requests();
    check('the second press plays', playSound('toast_success'), true);
    await settle();
    // The one-off voice from the first press is first in the list; the pool the app clicks through is the tail.
    const pool = audios.slice(1);
    toastSuccessPool = pool;
    check('from a pool of three voices, for overlapping plays', pool.length, 3);
    check('all three built from the one copy', new Set(pool.map((voice) => voice.src)).size, 1);
    checkIs('which is a copy of the file, not the file', String(pool[0].src).startsWith('blob:'));
    checkIs(
      'so the second press costs no request at all',
      requests() === before,
      'a voice is still being built from the file URL'
    );

    // Three more, which between them take every voice in the pool for a turn.
    playSound('toast_success');
    playSound('toast_success');
    playSound('toast_success');
    check('nor does any press after it', requests(), before);
    check('and the pool never grows', audios.length, 4);
    check(
      'the voices take turns, so a rapid press never truncates one',
      pool.map((voice) => voice.plays),
      [2, 1, 1]
    );

    await primeSound('toast_success');
    await primeSound('toast_success');
    check('and asking for an already-fetched sound fetches nothing', fetches.length, 1);
  }

  console.log('\n--- a sound that is switched off is not fetched ---');
  {
    setSoundsEnabled(false);
    const muted = { fetches: fetches.length, audios: audios.length };
    check('a muted press plays nothing', playSound('notification'), false);
    check('and fetches nothing', fetches.length, muted.fetches);
    check('and creates no voice', audios.length, muted.audios);

    // The one exception, and the reason the flag exists at all: the sounds toggle has to be heard on the way ON.
    check('the sounds toggle still plays', playSound('sound_on', { force: true }), true);
    checkIs('so it created a voice despite being muted', audios.length > muted.audios);
    setSoundsEnabled(true);
  }

  console.log('\n--- a sound that cannot be fetched is remembered as such ---');
  {
    const before = fetches.length;
    failNextFetch = true;
    check('the fetch fails', (await primeSound('notification')) === null, true);
    check('it was attempted once', fetches.length - before, 1);
    await primeSound('notification');
    check('and is not attempted again', fetches.length - before, 1);

    const voicesBefore = audios.length;
    check('the next press plays anyway', playSound('notification'), true);
    await settle();
    const pool = audios.slice(voicesBefore);
    check('from a pool of three, as before', pool.length, 3);
    checkIs(
      'this is the one case that still loads the file itself per voice',
      pool.every((voice) => !String(voice.src).startsWith('blob:')),
      'the voices were expected to fall back to the file URL'
    );
    check('and nothing is fetched again', fetches.length - before, 1);
  }

  console.log('\n--- the first gesture of a session primes the two click sounds ---');
  {
    check('the engine waits for a touch, not for a click', typeof gestures.get('pointerdown')?.handler, 'function');
    check(
      'in capture phase, so an earlier handler cannot silence it',
      gestures.get('pointerdown')?.options?.capture,
      true
    );
    check('and only once', gestures.get('pointerdown')?.options?.once, true);
    const before = { requests: requests(), fetches: fetches.length };
    gestures.get('pointerdown').handler();
    await settle();
    check('both click sounds are fetched', fetches.length - before.fetches, 2);
    check('which is all they cost', requests() - before.requests, 2);
    gestures.get('keydown').handler();
    await settle();
    check('and a later gesture fetches nothing more', fetches.length - before.fetches, 2);
  }

  console.log('\n--- a sound that does not exist ---');
  {
    const unknown = { fetches: fetches.length, audios: audios.length };
    check('plays nothing', playSound('no_such_sound'), false);
    check('fetches nothing', fetches.length - unknown.fetches, 0);
    check('and creates no voice', audios.length - unknown.audios, 0);
  }

  console.log('\n--- the Debug page\u2019s levels ---');
  {
    // The crux: a voice takes its volume when it is BUILT, and toast_success already has a pool from the presses
    // above. A slider that only affected sounds not yet played would be the wrong half of the feature.
    const built = toastSuccessPool;
    check('the sound already has its three voices', built.length, 3);
    check('at the shipped level', new Set(built.map((voice) => voice.volume)).size, 1);
    check('which is the shared default', built[0].volume, 0.4);

    check('setting a level reports what it applied', setSoundVolume('toast_success', 0.9), 0.9);
    check(
      'and it reaches the voices that already exist',
      built.map((voice) => voice.volume),
      [0.9, 0.9, 0.9]
    );

    // Clamped on the way in, so a slider (or a mistake) cannot push an Audio element out of range.
    check('a level above full is clamped to full', setSoundVolume('toast_success', 5), 1);
    check('and the voices follow', built[0].volume, 1);
    check('a level below nothing is clamped to nothing', setSoundVolume('toast_success', -2), 0);

    // A sound with no pool yet is built at the level in force, so a slider moved before the sound is ever heard
    // still applies.
    const voicesBefore = audios.length;
    setSoundVolume('click', 0.05);
    playSound('click');
    await settle();
    const freshVoices = audios.slice(voicesBefore);
    check('a sound first played after the slider moved is built at that level', freshVoices.length, 3);
    check(
      'all three of them',
      freshVoices.map((voice) => voice.volume),
      [0.05, 0.05, 0.05]
    );

    // What the page renders: the engine's own answer, so a slider cannot show a level other than the played one.
    const rows = soundVolumeRows();
    check('the rows cover every sound', rows.length, Object.keys(SOUND_FILES).length);
    check(
      'and name only the moved ones',
      rows.filter((row) => row.overridden).map((row) => row.name).sort(),
      ['click', 'toast_success']
    );
    check('showing the level in force', rows.find((row) => row.name === 'toast_success').volume, 0);
    check('and what it ships at', rows.find((row) => row.name === 'toast_success').shipped, 0.4);
    check('a sound nobody touched is not marked', rows.find((row) => row.name === 'notification').overridden, false);

    // Signing out is what ends the experiment: every level goes back to the shipped mix, live voices included.
    resetSoundVolumes();
    check('resetting puts the rows back', soundVolumeRows().filter((row) => row.overridden).length, 0);
    check('and the voices with them', built.map((voice) => voice.volume), [0.4, 0.4, 0.4]);
    check('including the click', freshVoices.map((voice) => voice.volume), [0.15, 0.15, 0.15]);

    // The page can be asked about a name that is not a sound; it must not throw, and must not invent a level.
    check('an unknown sound has no level to set', setSoundVolume('no_such_sound', 0.5), 0.4);
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
};

main();

