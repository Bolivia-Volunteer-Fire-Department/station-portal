// The boss level's decisions, as pure functions.
//
// When the chief arrives, how it hovers, when it fires and when it floats away - all of that is
// arithmetic worth testing without a browser and without a player who can dodge, so it lives here.
// FirefighterRunner.jsx is the other half: sprites, sound and rendering. (The same split, and for the
// same reason, as utils/soundRules and utils/uiSounds.)
//
// Nothing in this file touches the DOM, React or Audio.

export const BOSS_INTERVAL_SECONDS = 76; // 1:16 of ordinary play before the first boss, and between bosses
export const BOSS_DURATION_SECONDS = 30; // the chief stays half a minute before it leaves
export const BOSS_SPEED_STEP = 1.05; // +5% to everything that flies at the player, per completed cycle

// Both boss sheets are one row of four 128px cells (a 512x128 png).
export const CHIEF_FRAMES = 4;
export const CHIEF_IDLE_FRAME = CHIEF_FRAMES - 1; // frozen on the right-most frame until it fires
export const CHIEF_DISPLAY_SIZE = 96; // also the chief's collision-free footprint for bounds

export const FIREBALL_SPEED = 430; // px per second leftward, before the cycle multiplier

const CHIEF_FRAME_SECONDS = 0.09; // one firing sequence plays in ~0.36s
const CHIEF_MARGIN_RIGHT = 22;
const CHIEF_REST_ABOVE_GROUND = 26; // its feet rest this far above the ground line
const CHIEF_HOVER_AMPLITUDE = 9;
const CHIEF_HOVER_SPEED = 1.7; // radians per second
const CHIEF_ENTER_SECONDS = 0.7; // rises in from below the frame over this long
const CHIEF_EXIT_SPEED = 340; // px per second upward when it leaves

// The flame's top, this far above the ground: chest height, so a standing player is hit and a ducking
// one is not. The component draws the sprite so the flame - not its transparent margin - lands here.
const FIREBALL_FLIGHT_ABOVE_GROUND = 70;

// The gap between shots, in seconds. It opens at the range it has always been and tightens toward the
// end, so the chief grows meaner the longer it lasts: two ranges, interpolated by how far through the
// boss we are.
const FIREBALL_COOLDOWN_START = { min: 1.4, max: 2.8 };
const FIREBALL_COOLDOWN_END = { min: 0.6, max: 1.2 };

// A fresh run: ordinary play, at the base speed, with no boss cycle behind it.
export const createLevel = () => ({
  phase: "normal", // "normal" | "boss" | "leaving"
  elapsed: 0, // seconds spent in the current phase
  cycle: 0, // completed boss cycles
  speed: 1, // multiplier applied to everything that flies at the player
  chief: null,
});

// The frame to draw the chief on: 0..3 while a firing sequence plays, the frozen last frame otherwise.
export const chiefFrame = (chief) =>
  chief && chief.fireSeq >= 0 ? chief.fireSeq : CHIEF_IDLE_FRAME;

// Advance the level by `dt` seconds. `level` is mutated in place, and the events the caller has to
// act on are returned:
//
//   { type: "fireball", x, y }  a fireball to add at that spot
//   { type: "boss-ended" }      a cycle finished (so the caller can restart its obstacle timer)
//
// `random` is injectable so a test can pin the cooldown. `bounds` carries the play area, the chief's
// drawn size, and the two durations.
export function stepLevel(level, dt, bounds, random = Math.random) {
  const events = [];
  level.elapsed += dt;

  if (level.phase === "normal") {
    if (level.elapsed >= bounds.interval) startBoss(level, bounds, random);
  } else if (level.phase === "boss") {
    stepChief(level, dt, bounds, random, events);
    if (level.elapsed >= bounds.duration) level.phase = "leaving";
  } else {
    // "leaving": the chief floats straight up until it is off the top, then it is de-rendered and
    // the ordinary run resumes - one cycle faster.
    const chief = level.chief;
    chief.y -= CHIEF_EXIT_SPEED * dt;
    if (chief.y + bounds.chiefSize < 0) {
      level.chief = null;
      level.phase = "normal";
      level.elapsed = 0;
      level.cycle += 1;
      level.speed *= BOSS_SPEED_STEP;
      events.push({ type: "boss-ended" });
    }
  }

  return events;
}

const lerp = (from, to, t) => from + (to - from) * t;

// How far through the boss we are, 0..1 - the thing the aggression ramps on.
function bossProgress(level, bounds) {
  if (!(bounds.duration > 0)) return 1;
  return Math.min(1, level.elapsed / bounds.duration);
}

// The next gap to wait before firing, drawn from the range in force at this point in the fight.
function fireballCooldown(level, bounds, random) {
  const progress = bossProgress(level, bounds);
  const min = lerp(FIREBALL_COOLDOWN_START.min, FIREBALL_COOLDOWN_END.min, progress);
  const max = lerp(FIREBALL_COOLDOWN_START.max, FIREBALL_COOLDOWN_END.max, progress);
  return min + random() * (max - min);
}

// Bring the chief on: it rises from the bottom edge, then hovers on the right and starts firing.
//
// Exported because the game's admin-only debug button calls it on demand; stepLevel calls it itself
// when the interval elapses, so both paths start the boss exactly the same way.
export function startBoss(level, bounds, random = Math.random) {
  level.phase = "boss";
  level.elapsed = 0;
  level.chief = {
    x: bounds.width - bounds.chiefSize - CHIEF_MARGIN_RIGHT,
    restY: bounds.groundY - bounds.chiefSize - CHIEF_REST_ABOVE_GROUND,
    y: bounds.height, // just below the frame, rising in
    enter: 0,
    hover: 0,
    fireSeq: -1, // idle: frozen on CHIEF_IDLE_FRAME
    fireSeqT: 0,
    cooldown: fireballCooldown(level, bounds, random),
  };
}

function stepChief(level, dt, bounds, random, events) {
  const chief = level.chief;
  if (!chief) return;

  // Rise in, then hover on a slow sine so it reads as floating rather than parked. The x never
  // changes: the chief holds the right edge and does not drift toward the player.
  if (chief.enter < 1) {
    chief.enter = Math.min(1, chief.enter + dt / CHIEF_ENTER_SECONDS);
    const eased = 1 - (1 - chief.enter) ** 3; // ease-out cubic
    chief.y = bounds.height + (chief.restY - bounds.height) * eased;
  } else {
    chief.hover += dt * CHIEF_HOVER_SPEED;
    chief.y = chief.restY + Math.sin(chief.hover) * CHIEF_HOVER_AMPLITUDE;
  }

  // A firing sequence plays frames 0..3 once, then drops back to the frozen idle frame - one
  // sequence per fireball, with the ball leaving at the start of it.
  if (chief.fireSeq >= 0) {
    chief.fireSeqT += dt;
    while (chief.fireSeqT >= CHIEF_FRAME_SECONDS) {
      chief.fireSeqT -= CHIEF_FRAME_SECONDS;
      chief.fireSeq += 1;
      if (chief.fireSeq >= CHIEF_FRAMES) {
        chief.fireSeq = -1;
        break;
      }
    }
    return;
  }

  // Only once it has finished rising, so it cannot fire mid-entrance.
  if (chief.enter < 1) return;

  chief.cooldown -= dt;
  if (chief.cooldown <= 0) {
    chief.fireSeq = 0;
    chief.fireSeqT = 0;
    chief.cooldown = fireballCooldown(level, bounds, random);
    events.push({
      type: "fireball",
      x: chief.x, // leaves from the chief's front (left) edge
      y: bounds.groundY - FIREBALL_FLIGHT_ABOVE_GROUND,
    });
  }
}
