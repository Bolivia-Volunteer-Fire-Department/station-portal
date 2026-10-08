// THE STATION LEADERBOARD'S OWN DECISION, where a harness can ask it.
//
// The board is drawn by src/components/FirefighterRunner/FirefighterRunner.jsx, and what it shows is whatever the last
// read returned - not this file's business. The one thing around it that is a rule rather than drawing is WHEN THE BOARD
// OPENS ITSELF: after a run, and only when that run set a new high score. That answer decides whether a dialog covers the
// game-over screen, so it is the kind of thing that should not be an inline boolean in a 1500-line component.
//
// TWO NUMBERS CAN SAY YES, AND THEY ARE NOT THE SAME NUMBER:
//
//   improved        - the SERVER's answer. The score is a personal best on the member's row, `SAVE_RUNNER_SCORE` stores
//                     it only when it beats what is there, and it reports back whether the record moved.
//   beatShownBest   - this SCREEN's answer: the run beat the number the HUD was showing when the run started.
//
// They agree in every ordinary run, and come apart in the cases worth naming. A browser whose copy of the best is behind
// the record - storage cleared, a board read that failed, a best below the rows the board draws - will cheer the member
// on for beating the number in front of them while the record does not move. A record repaired or reset on the sheet
// moves while the HUD's number does not.
//
// A NEW HIGH SCORE IS EITHER OF THEM, and that is the decision this file exists to hold, rather than the simpler-looking
// "the server said so": a member who watches HI go up and gets no board has been told by the game's own HUD that their run
// was a record, and a member whose stored best has just been beaten belongs on the board whether or not their browser
// remembered the old number. Only a run that improves NOTHING opens nothing - which is the promise the ask was made for.
//
// A FAILED SAVE IS NOT A THIRD CASE. With no answer from the server, `improved` is simply false, and the screen's own
// comparison is the only evidence there is - which is what falling through to `beatShownBest` does, without a branch.
export const isNewRunnerBest = ({ improved = false, beatShownBest = false } = {}) =>
  improved === true || beatShownBest === true;
