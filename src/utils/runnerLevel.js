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
const CHIEF_HOVER_AMPLITUDE = 5; // the float either side of the height it is holding
const CHIEF_HOVER_SPEED = 1.7; // radians per second
const CHIEF_ENTER_SECONDS = 0.7; // rises in from below the frame over this long
const CHIEF_EXIT_SPEED = 340; // px per second upward when it leaves
const CHIEF_FLOAT_SPEED = 130; // px per second travelling between two shot heights

// Where the flame leaves the head: this far below the top of the chief's sprite. The one-height shot
// this replaced was a 96px chief resting 26px above the ground firing at 70px above it, so the ball
// still leaves the chief exactly where it always did - it just follows the chief up and down now.
export const CHIEF_FLAME_OFFSET_Y = 52;

// What the chief lines up next, as the flame's height above the ground. Two bands, because a boss
// that only ever shoots one height is a boss you beat by holding one key: the high shot passes over a
// ducking player and catches a standing one, and the low shot is under both - it has to be jumped.
//
// Each band is the height the chief floats to; the hover (CHIEF_HOVER_AMPLITUDE either side of it) is
// what stops every shot of a band being the identical one.
export const FIREBALL_SHOT_BANDS = [
  { id: "high", above: 70 }, // duck under it - the chest height the boss has always fired at
  { id: "low", above: 30 }, // jump it - the flame skims the ground
];

// The gap between shots, in seconds. It opens tight and closes tighter, so the chief grows meaner the
// longer it lasts: two ranges, interpolated by how far through the boss we are. Both are quicker than
// the fixed-height chief could get away with, since every shot now has to be read and answered.
const FIREBALL_COOLDOWN_START = { min: 1, max: 2 };
const FIREBALL_COOLDOWN_END = { min: 0.45, max: 0.9 };

// THE COMMENTARY, in the gaps between shots. Three numbers decide when a bubble is on screen:
//
//   * SAYING_DELAY_SECONDS - the beat of silence after a shot before it appears. Without it the bubble lands with the
//     fireball, which reads as part of the attack rather than as something said about it.
//   * SAYING_SECONDS - how long it stays when nothing interrupts it: "a moment or two". Long enough to read a short
//     line, short enough that it is gone before the next shot needs your eyes.
//   * SAYING_MIN_COOLDOWN - the shortest gap the chief will talk over. A bubble that appears for a fifth of a second
//     and is cut off by the next fireball is worse than no bubble at all, and the END of the fight is exactly where
//     that would happen: the cooldowns there are shorter than the delay. So he only speaks when the gap can hold a
//     line - which also makes him go quiet as he grows meaner, without anybody writing that rule down.
const SAYING_DELAY_SECONDS = 0.35;
const SAYING_SECONDS = 2;
const SAYING_MIN_COOLDOWN = 1.2;

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
// drawn size, the two durations, and the lines the chief may say - content handed in rather than kept
// here, so this file stays arithmetic and the sayings stay a setting.
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

// The band to line up next: drawn at random, but never the one just fired. Two bands means one
// redraw at most, and the choice stays even between them - while a held key can never survive two
// shots in a row.
function pickShotBand(previous, random) {
  const options = previous
    ? FIREBALL_SHOT_BANDS.filter((band) => band.id !== previous.id)
    : FIREBALL_SHOT_BANDS;
  const index = Math.min(options.length - 1, Math.floor(random() * options.length));
  return options[index];
}

// Where the chief floats to for a shot to leave its mouth at that height above the ground.
const restYForShot = (bounds, shot) => bounds.groundY - shot.above - CHIEF_FLAME_OFFSET_Y;

// The line to say next: one of the chief's, at random, but never the one he just said - the same rule the shot bands
// follow, and for the same reason. A comment that repeats itself stops reading as a comment, and with five configured
// lines this also guarantees all five get used.
//
// A single configured line has to repeat, because silence would be a strange way to honour a rule about variety. NO
// lines at all is silence, which is exactly what a station that has blanked the card is asking for.
function pickSaying(previous, sayings, random) {
  if (!sayings.length) return "";
  const options = sayings.filter((line) => line !== previous);
  const pool = options.length ? options : sayings;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

// Bring the chief on: it rises from the bottom edge, then hovers on the right and starts firing.
//
// Exported because the game's admin-only debug button calls it on demand; stepLevel calls it itself
// when the interval elapses, so both paths start the boss exactly the same way.
export function startBoss(level, bounds, random = Math.random) {
  level.phase = "boss";
  level.elapsed = 0;
  // It rises straight to the height of the shot it already has lined up, so its first fireball comes
  // off its mouth like every later one.
  const shot = pickShotBand(null, random);
  const restY = restYForShot(bounds, shot);
  level.chief = {
    x: bounds.width - bounds.chiefSize - CHIEF_MARGIN_RIGHT,
    shot, // the band it is lining up
    restY, // where it is floating now
    targetRestY: restY, // and where it is floating to
    y: bounds.height, // just below the frame, rising in
    enter: 0,
    hover: 0,
    fireSeq: -1, // idle: frozen on CHIEF_IDLE_FRAME
    fireSeqT: 0,
    cooldown: fireballCooldown(level, bounds, random),
    // The bubble: what is on screen right now, the line this gap is going to say (or null for a quiet one), how long it
    // has been since the last shot, and the last thing said - so the same line is never said twice in a row.
    saying: "",
    sayingPlan: null,
    sayingT: 0,
    lastSaying: "",
  };
}

function stepChief(level, dt, bounds, random, events) {
  const chief = level.chief;
  if (!chief) return;

  // Rise in, then float on a slow sine so it reads as floating rather than parked. The x never
  // changes: the chief holds the right edge and does not drift toward the player.
  if (chief.enter < 1) {
    chief.enter = Math.min(1, chief.enter + dt / CHIEF_ENTER_SECONDS);
    const eased = 1 - (1 - chief.enter) ** 3; // ease-out cubic
    chief.y = bounds.height + (chief.restY - bounds.height) * eased;
  } else {
    // Travel to the height of the shot it is lining up at a fixed speed, so the head is seen to go
    // there and the player can read the next shot off it. The shortest cooldown is 0.45s and the
    // widest move 40px, so it always arrives in time.
    const step = CHIEF_FLOAT_SPEED * dt;
    const gap = chief.targetRestY - chief.restY;
    chief.restY += Math.max(-step, Math.min(step, gap));
    chief.hover += dt * CHIEF_HOVER_SPEED;
    chief.y = chief.restY + Math.sin(chief.hover) * CHIEF_HOVER_AMPLITUDE;
  }

  // THE COMMENTARY. A beat after each shot the chief says something, and the bubble goes when either the line has had
  // its moment OR the next fireball arrives - the second of which is what "between the blasts" means. Both timings run
  // off the same clock, and the shot itself is what resets it (below), so there is one number to reason about.
  chief.sayingT += dt;
  if (chief.saying) {
    if (chief.sayingT >= SAYING_DELAY_SECONDS + SAYING_SECONDS) chief.saying = "";
  } else if (chief.sayingPlan && chief.sayingT >= SAYING_DELAY_SECONDS) {
    chief.saying = chief.sayingPlan;
    // Consumed as it is shown, so the same line cannot drift back on its own a moment later.
    chief.sayingPlan = null;
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
    // The bubble goes the instant a shot leaves: the gap is over, and a chief talking through his own fireball is one
    // nobody can read anyway. The line for THIS gap is chosen now rather than when it is shown, so the decision is
    // made once and the delay is only ever about timing.
    chief.saying = "";
    chief.sayingT = 0;
    const sayings = Array.isArray(bounds.sayings) ? bounds.sayings : [];
    // Silence unless the gap can actually hold a line - see SAYING_MIN_COOLDOWN.
    const saying = chief.cooldown >= SAYING_MIN_COOLDOWN ? pickSaying(chief.lastSaying, sayings, random) : "";
    chief.sayingPlan = saying || null;
    if (saying) chief.lastSaying = saying;
    // Line up the next shot now - never the same band as the one going out, so no two shots in a row
    // can be answered with one held key. The head starts floating to it while the cooldown runs.
    chief.shot = pickShotBand(chief.shot, random);
    chief.targetRestY = restYForShot(bounds, chief.shot);
    events.push({
      type: "fireball",
      x: chief.x, // leaves from the chief's front (left) edge
      // Off the chief's own mouth at whatever height it is floating - the flame's top, which is the
      // spot the component draws the sprite around.
      y: chief.y + CHIEF_FLAME_OFFSET_Y,
    });
  }
}
