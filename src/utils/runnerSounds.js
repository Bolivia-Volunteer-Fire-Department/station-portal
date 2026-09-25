// Which sound files the Firefighter Runner plays.
//
// A member's `runner_sound_profile` in user_settings is a PREFIX, not a path: a profile of `bird`
// means the game looks for `bird-jump.wav`, `bird-die.wav` and `bird-point.wav` next to the
// defaults. An empty profile (the normal case) means the defaults themselves - `jump.wav`,
// `die.wav`, `point.wav` - which is why a station that never touches this setting hears exactly
// what it always has.
//
// Every sound is discovered through a glob rather than an import statement, so adding a new set is
// dropping three files into the folder: no code change, and the files are bundled on the next
// build. A profile whose files are missing falls back to the defaults rather than going silent,
// because a typo in a prefix should not make the game mute.

// The sounds the game plays, in the order the files are named.
export const RUNNER_SOUNDS = ['jump', 'die', 'point'];

// A profile has to be usable as part of a filename. Kept deliberately strict and validated on
// save (in the Administration form and again on the server) rather than silently rewritten, so
// what an administrator typed is what the game looks for.
const PROFILE_PATTERN = /^[A-Za-z0-9_-]+$/;

export const normalizeSoundProfile = (value) => String(value ?? '').trim();

// Empty is valid: it means "use the defaults".
export const isValidSoundProfile = (value) => {
  const profile = normalizeSoundProfile(value);
  return profile === '' || PROFILE_PATTERN.test(profile);
};

// The bundle-relative path for one sound, given a profile. `./` because that is the form
// import.meta.glob keys use.
export const soundPath = (profile, sound) => {
  const prefix = normalizeSoundProfile(profile);
  return prefix ? `./${prefix}-${sound}.wav` : `./${sound}.wav`;
};

// The URL to play, or null when even the default is missing.
//
// `files` is the glob map (path -> URL). Falling back to the default is what makes an unknown or
// mistyped profile harmless.
export const resolveSoundUrl = (files, profile, sound) => {
  const map = files || {};
  const requested = soundPath(profile, sound);
  if (map[requested]) return map[requested];
  return map[soundPath('', sound)] || null;
};

// Every sound for one profile, as { jump: url, die: url, point: url }. Used once per game so the
// component does not repeat the lookup for each play.
export const soundsForProfile = (files, profile) =>
  RUNNER_SOUNDS.reduce((sounds, sound) => {
    sounds[sound] = resolveSoundUrl(files, profile, sound);
    return sounds;
  }, {});
