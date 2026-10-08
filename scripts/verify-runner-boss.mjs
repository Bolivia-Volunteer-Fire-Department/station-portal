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
 * The ordinary play the boss sits on top of is covered here too, since it is the same wiring: the
 * obstacles the boss replaces - their boxes, their sheets, how they are dodged - and the death
 * animation that ends a run.
 *
 *   npm run verify:runner-boss
 */
import { readFileSync } from 'node:fs';
import {
  BOSS_INTERVAL_SECONDS,
  BOSS_DURATION_SECONDS,
  BOSS_SPEED_STEP,
  CHIEF_DISPLAY_SIZE,
  CHIEF_FLAME_OFFSET_Y,
  FIREBALL_SHOT_BANDS,
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

console.log('\n--- the shots come at two heights, and one key cannot answer both ---');
{
  // A full-length boss. The cooldown is pinned to the middle of each range so the gaps stay even, and
  // the player hitboxes mirror PLAYER_NORMAL_HITBOX / PLAYER_DUCK_HITBOX in the component, with the
  // player standing on the ground at groundY - 64. The hop mirrors its JUMP_VELOCITY and GRAVITY.
  const LONG = { ...BOUNDS, duration: 30 };
  const mid = () => 0.5;
  const overlaps = (a, b) => a.y < b.y + b.height && a.y + a.height > b.y;
  const stand = { y: LONG.groundY - 64 + 6, height: 52 };
  const duck = { y: LONG.groundY - 64 + 28, height: 30 };
  const JUMP_APEX = 700 ** 2 / (2 * 1850); // ~132px at the component's values

  const level = createLevel();
  startBoss(level, LONG, mid);

  const shots = [];
  const chiefYs = [];
  let offsetFromHead = null;
  for (let i = 0; i < Math.round(LONG.duration / DT) + 200 && level.phase === 'boss'; i += 1) {
    for (const event of stepLevel(level, DT, LONG, mid)) {
      if (event.type !== 'fireball') continue;
      // Read off the chief in the same step the shot leaves, so it has not moved since.
      offsetFromHead = event.y - level.chief.y;
      const ball = { y: event.y, height: 24 };
      shots.push({
        above: LONG.groundY - event.y, // the flame's top, above the ground
        hitsStanding: overlaps(ball, stand),
        hitsDucking: overlaps(ball, duck),
      });
    }
    if (level.chief) chiefYs.push(level.chief.y);
  }

  const HOVER = 5; // CHIEF_HOVER_AMPLITUDE, which the module keeps to itself
  const bandOf = (shot) => {
    let best = FIREBALL_SHOT_BANDS[0];
    for (const band of FIREBALL_SHOT_BANDS) {
      if (Math.abs(shot.above - band.above) < Math.abs(shot.above - best.above)) best = band;
    }
    return best;
  };
  const idOf = (shot) => bandOf(shot).id;
  const heights = shots.map((shot) => shot.above.toFixed(1)).join(', ');

  checkIs('the chief gets several shots away', shots.length >= 6, `${shots.length}: ${heights}`);
  checkIs(
    'each one is at one of the two band heights, give or take the hover',
    shots.every((shot) => Math.abs(shot.above - bandOf(shot).above) <= HOVER),
    heights
  );
  checkIs(
    'so there is more than one height to deal with',
    new Set(shots.map(idOf)).size === 2,
    shots.map(idOf).join(', ')
  );
  checkIs(
    'and no two in a row come from the same band, so no held key survives them',
    shots.slice(1).every((shot, i) => idOf(shot) !== idOf(shots[i])),
    shots.map(idOf).join(', ')
  );
  checkIs(
    'the ball leaves the chief\u2019s own mouth, wherever it is floating',
    Math.abs(offsetFromHead - CHIEF_FLAME_OFFSET_Y) < 0.01,
    `${offsetFromHead}`
  );
  const travelled = Math.max(...chiefYs) - Math.min(...chiefYs);
  checkIs(
    'and the head is seen to travel between the two heights',
    travelled >= 35,
    `${travelled.toFixed(1)}px`
  );
  // The bug this replaces: every shot flew at 70, so holding duck beat the whole boss.
  const high = shots.filter((shot) => idOf(shot) === 'high');
  const low = shots.filter((shot) => idOf(shot) === 'low');
  checkIs(
    'the high shots are ducked, and catch a standing player',
    high.every((shot) => !shot.hitsDucking && shot.hitsStanding)
  );
  checkIs('while the low ones hit a ducking player', low.every((shot) => shot.hitsDucking));
  // The hover carries each band either side of its base, so the whole swing has to keep its answer -
  // a shot that arrives with no answer is not difficulty, it is a coin toss.
  const ballAt = (above) => ({ y: LONG.groundY - above, height: 24 });
  const swing = (id) => {
    const band = FIREBALL_SHOT_BANDS.find((candidate) => candidate.id === id);
    return [band.above - HOVER, band.above + HOVER];
  };
  const [highLow, highHigh] = swing('high');
  const [lowLow, lowHigh] = swing('low');
  checkIs(
    'the high band is duckable at the bottom of its swing, and still catches a standing player',
    !overlaps(ballAt(highLow), duck) && overlaps(ballAt(highLow), stand),
    `${highLow}px`
  );
  checkIs(
    'it catches one at the top of the swing too',
    overlaps(ballAt(highHigh), stand),
    `${highHigh}px`
  );
  checkIs(
    'and the low band is under a ducking player across its whole swing',
    overlaps(ballAt(lowLow), duck) && overlaps(ballAt(lowHigh), duck),
    `${lowLow}..${lowHigh}px`
  );
  checkIs(
    'so they have to be jumped - and a hop clears them halfway up',
    low.every((shot) => shot.above + 24 < JUMP_APEX / 2),
    low.map((shot) => shot.above.toFixed(1)).join(', ')
  );
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
  checkIs(
    'and the last is well under it',
    gaps[gaps.length - 1] < gaps[0] * 0.7,
    `${gaps[0]}s -> ${gaps[gaps.length - 1]}s`
  );
  // The gap carries the 0.4s firing sequence on top of the cooldown, so the fight closing in on a
  // shot a second is a cooldown well under that.
  checkIs(
    'so the fight ends at roughly a shot a second',
    gaps[gaps.length - 1] < 1.2,
    `${gaps[gaps.length - 1]}s`
  );
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
checkIs('the fireball is always animating', /fireball\.frame = \(fireball\.frame \+ 1\) % STRIP_FRAMES/.test(component));
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

console.log('\n--- the obstacles the boss replaces ---');
{
  // Read out of the component, so these are the numbers it really spawns with: change one and it has
  // to be re-measured here rather than quietly drifting.
  const bodyMatch = component.match(
    /const HELI_BODY = \{ x: (\d+), y: (\d+), width: (\d+), height: (\d+) \};/
  );
  const scaleMatch = component.match(/const HELI_SCALE = ([\d.]+);/);
  const cellMatch = component.match(/const HELI_CELL_SIZE = (\d+);/);
  const bottomsMatch = component.match(/const HELI_BODY_BOTTOMS = \[([^\]]+)\];/);
  const body = bodyMatch ? bodyMatch.slice(1).map(Number) : null;
  const scale = scaleMatch ? Number(scaleMatch[1]) : null;
  const cell = cellMatch ? Number(cellMatch[1]) : null;
  const bottoms = bottomsMatch
    ? bottomsMatch[1].split(',').map((value) => Number(value.trim()))
    : null;
  const groundBox = (type) => {
    const match = component.match(
      new RegExp(
        `type: "${type}",[\\s\\S]{0,120}?y: groundY - ([\\d.]+),[\\s\\S]{0,60}?width: ([\\d.]+),[\\s\\S]{0,60}?height: ([\\d.]+),`
      )
    );
    return match ? match.slice(1).map(Number) : null;
  };
  const hydrant = groundBox('hydrant');
  const truck = groundBox('truck');

  check('the helicopter is drawn at 80% of its sheet cell', scale, 0.8);
  check('which is the 128px cell the sheet is cut into', cell, 128);
  check('and collides on the rectangle measured inside it', body, [8, 25, 114, 75]);
  check('it hovers where the truck used to fly, measured to its body', bottoms, [44, 78, 110]);
  check('the hydrant is 34x44, room for a jump', [hydrant?.[1], hydrant?.[2]], [34, 44]);
  check('and the parked truck a fifth bigger than its own 64x40 SVG', [truck?.[1], truck?.[2]], [76.8, 48]);
  // The offset above the ground being the box's own height is what "sits on the ground" means.
  checkIs(
    'both ground obstacles stand exactly on the ground line',
    hydrant?.[0] === hydrant?.[2] && truck?.[0] === truck?.[2]
  );

  // The player hitboxes mirror the component's, with the player standing on the ground at groundY - 64.
  const overlaps = (a, b) => a.y < b.y + b.height && a.y + a.height > b.y;
  const stand = { y: BOUNDS.groundY - 64 + 6, height: 52 };
  const duck = { y: BOUNDS.groundY - 64 + 28, height: 30 };
  // Its body is measured in sheet pixels, so what is drawn - and hit - is that rectangle scaled. The
  // bottom of it is the part that matters, and that is where the component puts it.
  const drawnBody = body[3] * scale;
  const heliAt = (bottom) => ({ y: BOUNDS.groundY - bottom - drawnBody, height: drawnBody });
  const groundAt = (box) => ({ y: BOUNDS.groundY - box[0], height: box[2] });

  checkIs('the lowest helicopter catches a standing player', overlaps(stand, heliAt(bottoms[0])));
  checkIs(
    'and passes over a ducking one, so ducking is the answer',
    !overlaps(duck, heliAt(bottoms[0]))
  );
  checkIs(
    'the other two fly clear over both',
    bottoms
      .slice(1)
      .every((bottom) => !overlaps(stand, heliAt(bottom)) && !overlaps(duck, heliAt(bottom)))
  );
  // Ground obstacles are jumped, so ducking into one has to be fatal - that is the whole difference.
  checkIs('a ducking player runs into the hydrant', overlaps(duck, groundAt(hydrant)));
  checkIs('and into the parked truck', overlaps(duck, groundAt(truck)));

  checkIs(
    'the helicopter is drawn from its own sheet, on its own frame',
    /import heliSheet from "\.\/heli\.png"/.test(component) &&
      /sheet=\{heliSheet\}[\s\S]{0,90}frame=\{obstacle\.frame\}/.test(component)
  );
  checkIs(
    'and its rotor never stops turning',
    /obstacle\.frameTimer \+= dt[\s\S]{0,200}obstacle\.frame = \(obstacle\.frame \+ 1\) % STRIP_FRAMES/.test(
      component
    )
  );
  checkIs(
    'its hitbox is the measured body, scaled with the sprite',
    /obstacle\.type === "heli"[\s\S]{0,400}HELI_BODY\.width \* HELI_SCALE[\s\S]{0,140}HELI_BODY\.height \* HELI_SCALE/.test(
      component
    )
  );
  checkIs(
    'the firetruck spawns at ground level now, as often as the hydrant',
    /else if \(Math\.random\(\) < 0\.5\)[\s\S]{0,420}type: "truck"/.test(component)
  );
  const css = readFileSync('src/components/FirefighterRunner/FirefighterRunner.css', 'utf8');
  checkIs(
    'and is flipped to face the way it is parked',
    /\.ffr__obstacle--truck \.ffr__obstacle-sprite \{[\s\S]{0,90}transform: scaleX\(-1\)/.test(css)
  );
}

console.log('\n--- dying ---');
{
  // The sprite sheet already holds four death frames and clamps on the last one; what used to stop it
  // was the loop tearing down on the collision, which drew frame 0 and nothing else.
  checkIs(
    'the sheet has four death frames, and the last is held rather than looped',
    /dead: \[\[0, 4\], \[1, 4\], \[2, 4\], \[3, 4\]\]/.test(component) &&
      /desiredAnimation === "dead"[\s\S]{0,200}Math\.min\(/.test(component)
  );
  checkIs(
    'a collision starts the death instead of ending the run on the spot',
    /if \(collision\) \{\s*startDying\(\);/.test(component)
  );
  checkIs(
    'the old "stop the loop on collision" gate is gone',
    !/if \(!collision\)/.test(component)
  );
  checkIs(
    'so the loop runs through the animation',
    /if \(dyingRef\.current\) \{[\s\S]{0,2000}animationRef\.current = requestAnimationFrame\(frame\);/.test(
      component
    )
  );
  checkIs(
    'the firefighter falls to the ground if it died in the air',
    /if \(dyingRef\.current\) \{[\s\S]{0,500}player\.velocityY \+= GRAVITY \* dt[\s\S]{0,500}player\.grounded = true;/.test(
      component
    )
  );
  checkIs(
    'and the run ends on the last frame, on the ground',
    /dyingAnimation\.frame >= SPRITES\.dead\.length - 1[\s\S]{0,90}player\.grounded[\s\S]{0,90}endGame\(\);/.test(
      component
    )
  );
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

