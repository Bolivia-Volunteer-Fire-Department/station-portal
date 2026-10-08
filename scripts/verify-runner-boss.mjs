/**
 * Verifies the Firefighter Runner's boss level.
 *
 * The chief's arrival, hover, firing and departure are pure decisions - see src/utils/runnerLevel.js -
 * so they are exercised here directly, at a fixed step with the random cooldown pinned. The three
 * things that need the component (obstacles pausing, the fireball colliding, the sprites rendering)
 * are asserted against its source, the way the rest of the runner's wiring is.
 *
 * Written at 60 steps a second and with a short interval/duration, so a whole cycle runs in well under
 * a second of wall clock while the arithmetic stays exactly what the game does at 1:16 and 0:30.
 *
 *   npm run verify:runner-boss
 */
import { readFileSync } from 'node:fs';
import {
  BOSS_INTERVAL_SECONDS,
  BOSS_DURATION_SECONDS,
  BOSS_SPEED_STEP,
  CHIEF_DISPLAY_SIZE,
  FIREBALL_SPEED,
  chiefFrame,
  createLevel,
  startBoss,
  stepLevel,
} from '../src/utils/runnerLevel.js';

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

const DT = 1 / 60;
// The real play area, but the two durations shortened so a cycle is a fraction of a second here.
const BOUNDS = {
  width: 800,
  height: 280,
  groundY: 238,
  chiefSize: CHIEF_DISPLAY_SIZE,
  interval: 1, // the game's BOSS_INTERVAL_SECONDS is 76
  duration: 3, // the game's BOSS_DURATION_SECONDS is 30
};
// The minimum cooldown, so the first shot lands at a known moment: 0.7s to rise in, then 1.4s.
const random = () => 0;

console.log('--- a fresh level ---');
{
  const level = createLevel();
  check('it starts in ordinary play', level.phase, 'normal');
  check('at the base speed', level.speed, 1);
  check('with no cycle behind it', level.cycle, 0);
  check('and no chief', level.chief, null);
}

console.log('\n--- the two durations are the ones asked for ---');
check('the boss comes every 1:16', BOSS_INTERVAL_SECONDS, 76);
check('and stays 0:30', BOSS_DURATION_SECONDS, 30);
check('each cycle is 5% faster', BOSS_SPEED_STEP, 1.05);

console.log('\n--- the chief: arrives, stays put, fires, leaves ---');
{
  const level = createLevel();
  let sim = 0;
  let bossAt = null;
  let firstShot = null;
  let cycles = 0;
  const chiefX = new Set();
  const chiefFrames = new Set();
  let startsBelowFrame = false;
  let sawEntering = false;

  while (sim < 10) {
    const events = stepLevel(level, DT, BOUNDS, random);
    sim += DT;

    for (const event of events) {
      if (event.type === 'fireball' && !firstShot) firstShot = { ...event };
      if (event.type === 'boss-ended') cycles += 1;
    }

    if (level.chief) {
      if (bossAt === null) {
        bossAt = sim;
        startsBelowFrame = level.chief.y === BOUNDS.height; // it begins below the frame
      }
      if (level.chief.enter < 1) sawEntering = true;
      chiefX.add(level.chief.x);
      chiefFrames.add(chiefFrame(level.chief));
    }
  }

  check('the boss arrives after the interval', Math.abs(bossAt - BOUNDS.interval) < 2 * DT, true);
  check('it rises in from below the frame', startsBelowFrame, true);
  checkIs('and is seen on the way in', sawEntering);
  // The whole point: it holds the right edge and never drifts toward the player.
  check('the chief never moves left', [...chiefX], [BOUNDS.width - CHIEF_DISPLAY_SIZE - 22]);
  check('it fires a fireball', !!firstShot, true);
  check('one sequence per shot: the idle frame held, then 0..3 plays', [...chiefFrames].sort(), [0, 1, 2, 3]);
  check('two full cycles in ten seconds', cycles, 2);
  check('and the speed steps up once per cycle', Number(level.speed.toFixed(4)), Number((BOSS_SPEED_STEP ** 2).toFixed(4)));
  check('the chief is gone', level.chief, null);
  check('and ordinary play is back', level.phase, 'normal');
}

console.log('\n--- the shot is a duck-or-die one ---');
{
  const level = createLevel();
  let shot = null;
  let guard = 0;
  while (!shot && guard < 600) {
    guard += 1;
    for (const event of stepLevel(level, DT, BOUNDS, random)) {
      if (event.type === 'fireball') shot = event;
    }
  }
  // The player hitboxes mirror PLAYER_NORMAL_HITBOX / PLAYER_DUCK_HITBOX in the component, with the
  // player standing on the ground at groundY - 64.
  const overlaps = (a, b) => a.y < b.y + b.height && a.y + a.height > b.y;
  const stand = { y: BOUNDS.groundY - 64 + 6, height: 52 };
  const duck = { y: BOUNDS.groundY - 64 + 28, height: 30 };
  const ball = { y: shot.y, height: 24 };
  check('it flies at chest height', shot.y, BOUNDS.groundY - 70);
  checkIs('so a standing player is hit', overlaps(ball, stand));
  checkIs('and a ducking player is safe', !overlaps(ball, duck));
}

console.log('\n--- the admin debug skip ---');
{
  // The debug button calls this directly; the schedule calls it through stepLevel. Same function, so
  // a skip lands the player in exactly the boss the interval would have produced.
  const level = createLevel();
  startBoss(level, BOUNDS, random);
  check('it jumps straight to the boss', level.phase, 'boss');
  checkIs(
    'with the chief on the right',
    !!level.chief && level.chief.x === BOUNDS.width - CHIEF_DISPLAY_SIZE - 22
  );
  check('and the level clock restarts', level.elapsed, 0);
}

console.log('\n--- the shots get more aggressive as the boss goes on ---');
{
  // A full-length boss, with the random pinned to the middle of each range, so the gaps between shots
  // are a plain reading of the ramp rather than noise.
  const LONG = { ...BOUNDS, duration: 30 };
  const mid = () => 0.5;
  const level = createLevel();
  startBoss(level, LONG, mid);

  const shots = [];
  let sim = 0;
  for (let i = 0; i < Math.round(LONG.duration / DT) + 200 && level.phase === "boss"; i += 1) {
    for (const event of stepLevel(level, DT, LONG, mid)) {
      if (event.type === "fireball") shots.push(sim);
    }
    sim += DT;
  }

  const gaps = shots.slice(1).map((t, i) => Number((t - shots[i]).toFixed(4)));
  checkIs('there are several shots to compare', gaps.length >= 5, `${gaps.length}`);
  checkIs('the first gap is the wide one', gaps[0] > gaps[gaps.length - 1]);
  checkIs('and the last is clearly tighter', gaps[gaps.length - 1] < gaps[0] * 0.6);
  checkIs('every gap is positive', gaps.every((gap) => gap > 0));
}

console.log('\n--- the component wires it in ---');
const component = readFileSync('src/components/FirefighterRunner/FirefighterRunner.jsx', 'utf8');
const app = readFileSync('src/App.jsx', 'utf8');
checkIs(
  'obstacles only spawn in normal play, so the boss level replaces them',
  /if \(level\.phase === "normal"\) \{[\s\S]{0,160}spawnObstacle\(\)/.test(component)
);
checkIs(
  'a fireball can end the run against the player\u2019s hitbox',
  /hitFireball = fireballsRef\.current\.some[\s\S]{0,200}FIREBALL_FLAME/.test(component)
);
checkIs('the chief and its fireballs are rendered', /view\.boss &&/.test(component) && /view\.fireballs\.map/.test(component));
checkIs('the fireball is always animating', /fireball\.frame = \(fireball\.frame \+ 1\) % BOSS_STRIP_FRAMES/.test(component));
checkIs(
  'and its own mp3 is played when one is fired',
  /fireballAudioRef\.current = new Audio\(fireballSound\)/.test(component) && /playSound\(fireballAudioRef\)/.test(component)
);
checkIs('the debug control is admin-only', /\{isAdmin && \([\s\S]{0,320}SKIP TO BOSS/.test(component));
checkIs(
  'and it skips with the module\u2019s own startBoss',
  /startBoss\(levelRef\.current, levelBounds\)/.test(component)
);
checkIs(
  'the app tells the game who is an administrator',
  /soundProfile=\{runnerSoundProfile\}[\s\S]{0,140}isAdmin=\{isAdmin\}/.test(app)
);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

