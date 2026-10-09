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
  chiefFrame,
  createLevel,
  startBoss,
  stepLevel,
} from '../src/utils/runnerLevel.js';
// The chief's lines: five settings, and the two rules that decide what the game is handed (see utils/systemSettings).
import {
  BOSS_SAYING_KEYS,
  DEFAULT_BOSS_SAYINGS,
  bossSayingSavePlan,
  bossSayingsFrom,
  getBossSayings,
  PUBLIC_SETTING_KEYS,
} from '../src/utils/systemSettings.js';
// The arithmetic that fits the fixed 800x280 world into the box it is given - the bug the last block here is about.
import { gameFit } from '../src/utils/runnerFit.js';

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
// THE CONTROL IS FOUND BY WHAT IT DOES, not by the words on it. This read "SKIP TO BOSS" and then "DEBUG BOSS", and both
// times the harness reported trouble with a button nobody had touched: a label is free to change, and a check that pins
// the wording is a check that fails on a rename. So the guard is read to its matching bracket, and the button inside it
// has to be the one that SKIPS - which is the behaviour worth catching if it ever stops being inside the guard.
const adminGuardBlock = (source) => {
  const start = source.indexOf('{isAdmin && (');
  if (start === -1) return '';
  let depth = 0;
  for (let position = source.indexOf('(', start); position < source.length; position += 1) {
    if (source[position] === '(') depth += 1;
    else if (source[position] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(start, position + 1);
    }
  }
  return '';
};
checkIs('the debug control is admin-only', adminGuardBlock(component).includes('onClick={skipToBoss}'));
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

console.log('\n--- the touch pads, for a phone ---');
const stylesheet = readFileSync('src/components/FirefighterRunner/FirefighterRunner.css', 'utf8');
{
  // WHERE THEY SIT is the ask, and the order in the source is the only thing that decides it: below the play area.
  // The station board used to be the next thing down, and this assertion used to pin the pads between the two - the
  // board is a dialog over the game now (see verify:runner), so what is left to hold here is that the pads are BELOW
  // the play area and that the board is not a panel in the page flow any more.
  checkIs(
    'a pad for each control',
    /ffr__touch-button--duck/.test(component) && /ffr__touch-button--jump/.test(component)
  );
  checkIs(
    'placed below the play area, with the board moved out of the page flow',
    component.indexOf('ffr__touch"') > component.indexOf('ffr__sky"') &&
      component.indexOf('ffr__modal-backdrop') < component.indexOf('ffr__board-list') &&
      !/className="ffr__board"/.test(component)
  );
  // A DEVICE TEST, not a width one: a narrow window on a desktop gets a mouse and a keyboard, and two dead buttons in
  // the tab order would be worse than nothing. `display: none` by default is what keeps them out of it.
  checkIs(
    'hidden unless the device cannot hover',
    /\.ffr__touch \{\n  display: none;\n\}/.test(stylesheet) &&
      /@media \(hover: none\) and \(pointer: coarse\)/.test(stylesheet)
  );
  checkIs(
    'with a thumb-sized target',
    /width: 72px;/.test(stylesheet) && /height: 72px;/.test(stylesheet)
  );
  // A control that is held, or tapped repeatedly, must not behave like a web page: the double-tap wait, the scroll that
  // steals the gesture, the text selection and the grey tap flash are all suppressed, and a duck that cannot be held is
  // a duck that cannot be played.
  checkIs(
    'that does not behave like a web page when tapped and held',
    /touch-action: none;/.test(stylesheet) &&
      /-webkit-tap-highlight-color: transparent;/.test(stylesheet) &&
      /user-select: none;/.test(stylesheet)
  );
  // The jump pad goes through startOrJump - the SAME call the keyboard and the whole-screen tap make - so it starts a
  // run, restarts one and jumps mid-run without any of that being a second implementation of the rule.
  checkIs(
    'the jump pad starts or jumps through the shared call',
    /ffr__touch-button--jump[\s\S]{0,400}startOrJump\(\)/.test(component)
  );
  // Duck is the one control that is HELD, so every way a finger can leave the pad has to release it: up, a cancelled
  // pointer, and losing the capture. A stuck duck is an unplayable game, not a cosmetic bug.
  checkIs(
    'and the duck pad holds it, releasing on lift, cancel and lost capture',
    /setDuck\(true\)[\s\S]{0,700}onPointerUp=\{\(\) => setDuck\(false\)\}/.test(component) &&
      /onPointerCancel=\{\(\) => setDuck\(false\)\}/.test(component) &&
      /onLostPointerCapture=\{\(\) => setDuck\(false\)\}/.test(component)
  );
  // THE WHOLE CABINET IS ONE POINTER SURFACE THAT JUMPS, so a tap that reached it would jump twice - once from the pad
  // and once from the cabinet. Both pads stop it, and so does everything else that is interactive in here.
  checkIs(
    'and each one stops the tap reaching the cabinet',
    (component.match(/onPointerDown=\{\(event\) => \{\s*event\.stopPropagation\(\);/g) || []).length >= 2
  );
}

console.log("\n--- the chief's commentary, in the gaps between shots ---");
{
  const SAYINGS = ['One', 'Two', 'Three', 'Four', 'Five'];
  const LONG = { ...BOUNDS, duration: 30, sayings: SAYINGS };
  const mid = () => 0.5;
  const level = createLevel();
  startBoss(level, LONG, mid);

  // Watched frame by frame from OUTSIDE the chief: when the bubble appears, what it says, how long it stays, and
  // whether a shot ever leaves while one is up. Nothing here reads the chief's own timers, so a change to how they are
  // kept cannot make these pass by accident.
  const bubbles = [];
  let current = '';
  let shownAt = 0;
  let longest = 0;
  let sim = 0;
  let shotWithBubble = 0;
  let saidAfterHalfway = 0;

  for (let i = 0; i < Math.round(LONG.duration / DT) + 200 && level.phase === 'boss'; i += 1) {
    const before = level.chief.saying;
    for (const event of stepLevel(level, DT, LONG, mid)) {
      if (event.type === 'fireball' && level.chief.saying) shotWithBubble += 1;
    }
    const after = level.chief.saying;

    if (after !== before) {
      if (after) {
        // A new line on screen.
        if (current) longest = Math.max(longest, sim - shownAt);
        current = after;
        shownAt = sim;
        bubbles.push(after);
        if (sim > LONG.duration / 2) saidAfterHalfway += 1;
      } else {
        longest = Math.max(longest, sim - shownAt);
        current = '';
      }
    }
    sim += DT;
  }

  // A fight that lasts half a minute with a cooldown that starts near 1.5s and tightens: the chief has room to talk for
  // roughly the first third of it (see SAYING_MIN_COOLDOWN), which is several bubbles.
  checkIs('the chief speaks several times', bubbles.length >= 3, `${bubbles.length}: ${bubbles.join(' | ')}`);
  checkIs(
    'always with one of the configured lines',
    bubbles.every((line) => SAYINGS.includes(line)),
    bubbles.join(' | ')
  );
  checkIs(
    'and never the same line twice in a row',
    bubbles.slice(1).every((line, index) => line !== bubbles[index]),
    bubbles.join(' | ')
  );
  // The bubble is between the BLASTS: a fireball never leaves with one still on screen.
  check('no shot is fired with a bubble up', shotWithBubble, 0);
  // READABLE, and no longer: the delay plus the two seconds, plus a frame of slack for the step that ends it.
  checkIs('a bubble stays for a moment or two, never longer', longest > 0 && longest <= 2.35 + 2 * DT, `${longest.toFixed(3)}s`);
  // SILENT AS IT GETS MEANER: the end of the fight fires faster than a line can be read, so the chief stops talking -
  // which is the same rule as the one above seen from the other end, asserted because it is the part that would look
  // like a bug (a bubble flashing for a fifth of a second) if the delay alone decided it.
  check('and he says nothing in the back half of the fight', saidAfterHalfway, 0);

  // WHERE IT IS DRAWN, and the two details that make it decoration rather than a second game object: it comes from the
  // view the loop already publishes, and the stylesheet puts it to the LEFT of the head and lets pointers through it -
  // the whole cabinet is a tap-to-jump surface, so a box that swallowed a tap would be a hole in the runway.
  const sheet = readFileSync('src/components/FirefighterRunner/FirefighterRunner.css', 'utf8');
  checkIs(
    'drawn from the view, in a bubble beside the head',
    /view\.boss\.saying \? <div className="ffr__bubble">/.test(component) && /saying: chief\.saying/.test(component)
  );
  checkIs(
    'which lets the tap through and sits out of the clipping',
    /\.ffr__bubble \{[\s\S]{0,220}right: 100%;/.test(sheet) && /pointer-events: none;/.test(sheet)
  );
}

console.log('\n--- and a station that wants him quiet gets quiet ---');
{
  const silent = { ...BOUNDS, duration: 30, sayings: [] };
  const level = createLevel();
  startBoss(level, silent, () => 0.5);

  let spoke = false;
  for (let i = 0; i < Math.round(silent.duration / DT) + 200 && level.phase === 'boss'; i += 1) {
    stepLevel(level, DT, silent, () => 0.5);
    if (level.chief.saying) spoke = true;
  }
  checkIs('with no lines configured there is no bubble at all', !spoke);
}

console.log('\n--- the sayings are settings, and five of them ---');
{
  check('five keys, one per saying', BOSS_SAYING_KEYS.length, 5);
  check('a station that has never set them gets the defaults', bossSayingsFrom([]), DEFAULT_BOSS_SAYINGS);
  // THE TWO KINDS OF EMPTY, which is the whole of bossSayingsFrom: an UNSET key speaks with its default, a key set to
  // nothing says nothing. A station clearing a box is turning that line off, and clearing all five is turning the
  // bubbles off - not being overruled by the defaults.
  check(
    'a cleared line is left out, not replaced by its default',
    bossSayingsFrom([{ key: 'boss_saying0', value: '' }]),
    DEFAULT_BOSS_SAYINGS.slice(1)
  );
  check(
    'and clearing all five is silence',
    bossSayingsFrom(BOSS_SAYING_KEYS.map((key) => ({ key, value: '   ' }))),
    []
  );
  check(
    'the editor always shows five fields, defaults included',
    getBossSayings([]).map((row) => row.value),
    DEFAULT_BOSS_SAYINGS
  );
  check(
    'and a save carries every key, blanks included',
    bossSayingSavePlan(getBossSayings([{ key: 'boss_saying0', value: 'Oi' }])).map((row) => row.key),
    BOSS_SAYING_KEYS
  );
  checkIs(
    'they are PUBLIC, because the member playing the game draws them',
    BOSS_SAYING_KEYS.every((key) => PUBLIC_SETTING_KEYS.includes(key))
  );
}

console.log('\n--- the fixed world, fitted to the box it is given ---');
{
  // THE BUG THIS PINS: the game is a fixed 800x280 world drawn inside a responsive cabinet, and the play area clips. On
  // a screen narrower than the world, what vanished was the RIGHT-HAND edge - and the chief holds it, at `width - 118`,
  // which on a 390px phone is x = 682, outside the box and throwing fireballs from off-screen. So the world is scaled
  // to fit rather than cropped, and the arithmetic of that is here where it can be asked directly.
  check('the world at its own size is not scaled', gameFit(800, 800), 1);
  check('nor is it stretched up on a wider screen', gameFit(1200, 800), 1);
  check('a narrower box scales it to fit', gameFit(400, 800), 0.5);
  check('a phone in portrait', gameFit(390, 800), 0.4875);
  // A MEASUREMENT THAT CANNOT BE USED IS THE WORLD AT ITS OWN SIZE, never a collapsed game: a renderer with no layout
  // engine (every harness that imports this component), a hidden container, a division by zero upstream. The caller
  // measures again as soon as it has a real width, so the safe direction is the only sensible one.
  check('no measurement yet is no scaling', gameFit(0, 800), 1);
  check('neither is nonsense', gameFit(undefined, 800), 1);
  check('nor is a missing design width a scale of anything', gameFit(400, 0), 1);

  // WHERE IT IS APPLIED, and the details that would each be a bug on their own. The first is the subtle one: the SKY
  // carries the transform, so measuring the sky would read its unscaled 800 for ever - the stage is measured instead.
  const css = readFileSync('src/components/FirefighterRunner/FirefighterRunner.css', 'utf8');
  checkIs(
    'the component measures the stage',
    /className="ffr__stage"[\s\S]{0,160}ref=\{stageRef\}/.test(component) &&
      /new ResizeObserver\(measure\)/.test(component)
  );
  checkIs(
    'and scales the world inside it, keeping the WebKit layer promotion an inline transform would replace',
    /transform: `translateZ\(0\) scale\(\$\{fit\}\)`/.test(component) &&
      /transformOrigin: "top left"/.test(component)
  );
  checkIs(
    'with the play area carrying the world width rather than a share of the room',
    /\.ffr__sky \{[\s\S]{0,500}width: var\(--ffr-width\);/.test(css)
  );
  // OUTSIDE THE SCALE, because it is text: an overlay shrunk with the game is an overlay nobody can read on the phone
  // this is all for. Its bottom tracks the scaled ground rather than the unscaled 42px the stylesheet used to name.
  const skyAt = component.indexOf('className="ffr__sky"');
  const overlayAt = component.indexOf('ffr__overlay');
  const closing = component.lastIndexOf('</div>', overlayAt);
  checkIs(
    'and the overlay outside it, sitting above the SCALED ground',
    skyAt > -1 && overlayAt > skyAt && closing > skyAt && closing < overlayAt &&
      /className="ffr__overlay"[\s\S]{0,80}bottom: `\$\{Math.round\(GROUND_HEIGHT \* fit\)\}px`/.test(component)
  );
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

