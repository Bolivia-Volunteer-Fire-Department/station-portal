// Which music track the Firefighter Runner plays, and when.
//
// A pure decision - the game's phase and cycle in, a track name out - so it is tested without a
// browser, exactly like utils/runnerLevel. The component holds the Audio elements and the mute
// switch; this only says what should be playing.

// Every track, and the file beside the game each one maps to. `normal_music` and `normal_music2` are
// two normal-play tracks, alternated each time ordinary play resumes so a long run does not loop the
// same tune forever.
export const MUSIC_TRACKS = ["menu", "normal", "normal2", "boss"];

// Music sits under the effects (the loudest effect is 1.0, the fireball 0.6), so it never fights them.
// Halved from 0.35: at that level the tunes were still competing with the effects.
export const MUSIC_VOLUME = 0.175;

// What should be playing right now:
//
//   - the menu screens (before a run, and after one ends): `menu`;
//   - the boss level: `boss`;
//   - ordinary play: `normal` on even cycles and `normal2` on odd, so the pair alternate.
//
// `boss` is true whenever the chief is on screen, which includes the moment it is floating away.
export function musicTrackFor({ playing, boss, cycle }) {
  if (!playing) return "menu";
  if (boss) return "boss";
  return cycle % 2 === 0 ? "normal" : "normal2";
}
