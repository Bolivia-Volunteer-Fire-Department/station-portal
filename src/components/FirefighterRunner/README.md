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
/>
```

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
