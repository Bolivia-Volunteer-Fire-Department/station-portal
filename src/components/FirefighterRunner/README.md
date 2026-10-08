# FirefighterRunner

A self-contained React/Vite endless runner using the supplied 256×320 firefighter
sprite sheet.

## Usage

```jsx
import FirefighterRunner from "./components/FirefighterRunner/FirefighterRunner";

export default function App() {
  return <FirefighterRunner />;
}
```

## Controls

- Space / Arrow Up: jump
- Arrow Down: duck
- Click: jump / start / restart
- Holding Arrow Down while jumping increases downward acceleration
- On a phone: two pads **below the play area and above the leaderboard** — DUCK on the left, JUMP on the right, the way
  a controller puts them. They appear only on a device that cannot hover (`hover: none` and `pointer: coarse`), so a
  desktop never sees them and they are never in its tab order. Duck holds while it is pressed; jump is one press, and
  doubles as start and restart, because it goes through the same call the keyboard does.
- Getting hit: the four death frames play out, the firefighter falls to the ground if it was caught in
  the air, and the last frame stays on screen behind the game-over panel

## The obstacles

Two kinds come at the player. At ground level, jumped over: a fire hydrant, or — just as often — a
firetruck parked in the road, flipped to face the way it is parked and drawn a fifth bigger than its
own SVG. In the air, ducked under: a **helicopter**, hovering at one of three heights with its rotor
always turning. The helicopter is drawn from `heli.png` — a four-cell strip like the boss sheets — at
80% of a cell, and it collides on its measured body, scaled with the sprite, never on the transparent
margin around it.

## The boss level

Every 1:16 of play the **chief** rises in on the right and the hydrants, trucks and helicopters stop —
the boss takes over. It holds the right edge, floating up and down between two firing heights, and lobs
fireballs the player has to read: a **high** one passes over a ducking player, so duck it, and a
**low** one skims the ground under both hitboxes, so jump it. It never fires the same height twice in
a row — no held key survives the fight — and each ball leaves from the chief's own mouth, at whatever
height it is floating. Between shots it says something: a speech bubble beside its head, one of the station's five
**Boss Sayings** from System Settings, never the same line twice in a row. That part is decoration — nothing collides
with it, nothing is dodged because of it, and the level never waits for it. Both boss sheets are four-frame strips: the
fireball loops, while the chief is
frozen on its last frame until it fires, when its four-frame sequence plays once per fireball (with
`fireball.mp3`). The gap between shots opens at 1–2 seconds and closes to under a second as the fight
goes on. After 30 seconds the chief floats up out of the frame and the normal run resumes. Each
completed cycle makes everything that flies at the player 5% faster.

The schedule and the chief's behaviour are pure decisions in `src/utils/runnerLevel.js`, so they are
tested without a browser by `npm run verify:runner-boss`; this component is only the sprites,
collision and rendering.

## Music and sound

The game has its own music and its own sound effects, with two switches in the HUD — **MUSIC** and
**SOUNDS** — each remembered on the device. The music follows the game:

- the menu screens — before a run and after one ends — play `menu_music.mp3`;
- ordinary play plays `normal_music.mp3`, alternating with `normal_music2.mp3` each time a boss cycle ends;
- the boss level plays `boss_music.mp3`.

One track plays at a time, looped, at `MUSIC_VOLUME` (0.175 — under the effects). **SOUNDS** switches
the effects — jump, die, the point chime and the fireball — on and off. Which track should play is a
pure decision in `src/utils/runnerMusic.js`; both switches are covered by `npm run verify:runner-audio`.

## Configuration

```jsx
<FirefighterRunner
  width={800}
  height={280}
  initialSpeed={350}
  maxSpeed={900}
  onGameOver={(score) => console.log(score)}
  token={authToken}
  currentUser={currentUser}
  isAdmin={isAdmin}
  bossSayings={['Nice dodge. Try it again.', 'Too slow!']}
/>
```

`isAdmin` shows a small **SKIP TO BOSS** debug control (left of the HUD) that jumps straight into
the boss scene for testing. It is off by default, so an ordinary member never sees it.

`bossSayings` is the list the floating head may come out with between fireball blasts — the station's own, from
System Settings, which is where they are edited. It is a list of short strings and it **must keep the same identity
between renders**: it ends up in the level's bounds, and the game loop's effect depends on those, so an array rebuilt
every render would restart the loop every render. App memoises it against the settings it comes from. An empty list
means the chief says nothing, which is what a station that has cleared all five is asking for.

No additional npm dependencies are required.

## Leaderboard

Passing `token` (and optionally `currentUser`) adds the **STATION LEADERBOARD** panel below
the game. Both are optional: without them the game plays exactly as before, just with no board.

- **Scores live on the `users` sheet's `runner_score` column** as personal bests, so the board
  is the station roster rather than a separate table. `GET_RUNNER_LEADERBOARD` projects
  `{ id, name, score }` for every member scoring **above zero** — a blank or `0` cell means
  "has never played", so those members are left out instead of padding the board with zeroes.
  It is capped at the top 25 with a `total` count, so the panel can say "top 25 of 40".
- **The backend keeps the higher score.** `SAVE_RUNNER_SCORE` clamps the client-supplied value
  (a browser can send anything) and stores it only when it beats the existing best, so a bad
  run cannot cost a member their position and a repeat call is harmless. The response reports
  `improved`, and the panel says either "new personal best saved" or what the best still is.
- **The HUD keeps working offline.** The local `localStorage` best is still written, and the
  board's number for your own row raises it when it is higher — so a member's best follows them
  between devices once the request succeeds.
- **A failure never blocks play.** An unreachable backend only makes the panel say "board
  unavailable right now"; the game itself has no dependency on the network.

`npm run verify:runner` covers the two backend rules (which rows reach the client, and what may
be written) by extracting both functions from `Code.gs`.
