/**
 * Verifies the station board dialog: that the button opens it, that it is a dialog in the window rather than a panel in
 * the cabinet, and that while it is up it owns the keyboard.
 *
 *   npm run verify:runner-board
 *
 * WHY THIS FILE EXISTS. The runner's other coverage is source assertions and a server render (verify:runner,
 * verify:admin-render). Those can prove that the dialog's MARKUP renders and how it is wired; neither of them can press
 * anything, and "the button opens the board" is the whole feature. That is the gap scripts/dom-env.mjs exists for - a
 * hook effect only runs after a commit, and a server render never commits - so this file mounts the real game in a real
 * (jsdom) DOM and presses the button.
 *
 * WHAT IT CANNOT SHOW, and it is worth being exact about it: how the dialog LOOKS, and that the cabinet's palette and
 * monospace face reach it through the portal. The stylesheet is bundled as a file rather than applied in here, so jsdom
 * has no computed styles to read. That half is held by the CSS assertions in verify:runner - including the one that
 * caught the palette being declared on the cabinet alone, which is exactly the kind of fault a mount like this cannot
 * see.
 *
 * TWO STUBS, both facts about jsdom rather than about the game: `Audio` (the game builds its sound elements on mount)
 * and `ResizeObserver` (it measures the stage). Neither exists in jsdom, and without them the mount throws before any of
 * the assertions below run.
 */
import './dom-env.mjs';
import React from 'react';
import { render, fireEvent, act, cleanup } from '@testing-library/react';
import FirefighterRunner from '../src/components/FirefighterRunner/FirefighterRunner.jsx';

class SilentAudio {
  constructor() {
    this.volume = 1;
    this.preload = 'auto';
    this.currentTime = 0;
    this.loop = false;
  }

  play() {
    return Promise.resolve();
  }

  pause() {}
}

globalThis.Audio = SilentAudio;
globalThis.ResizeObserver = class {
  observe() {}

  unobserve() {}

  disconnect() {}
};

let failures = 0;
// A CONDITION, not a value to compare: every question in this file is "did this happen", and the numeric ones are
// comparisons written out (`hudScore() === moving`). Passing a number in as the condition would be truthy and always
// pass - which is how a check silently stops checking. It happened once while this file was being written, and the bite
// test (removing the pause and watching this file stay green) is what caught it.
const check = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || detail === undefined ? '' : ` -> ${detail}`}`);
};

// A session, because the board is what needs one: without a token the game is the game with no board at all. Nothing
// here reaches a backend - the read is left to fail, which is its own case below.
const mount = async (props = {}) => {
  let view;
  await act(async () => {
    view = render(
      React.createElement(FirefighterRunner, {
        width: 800,
        height: 280,
        token: 'test-token',
        currentUser: { id: 'u1', name: 'Matt' },
        ...props,
      })
    );
  });
  return view;
};

// The dialog, identified by the two hooks that find it wherever it lives: the backdrop is the portalled node, the panel
// is the dialog inside it. Queried from the DOCUMENT rather than from the render's container, which is what makes the
// portal cases below possible.
const backdrop = () => document.body.querySelector('.ffr__modal-backdrop');
const panel = () => document.body.querySelector('.ffr__modal');
const isOpen = () => Boolean(document.body.querySelector('.ffr__modal-backdrop--open'));
const boardButton = (view) => view.getByRole('button', { name: 'Station leaderboard' });
const readyOverlay = (view) => view.queryByText(/CLICK TO RESPOND/);

console.log('--- the button, and the dialog it opens ---');
{
  const view = await mount();

  check('the cabinet renders, with the game ready', Boolean(readyOverlay(view)));
  check('with a button for the board in the HUD', Boolean(boardButton(view)));
  // CLOSED TO START, and the class is the state: the backdrop is always in the document (its markup is what
  // verify:admin-render renders), so "closed" is the absence of the open class rather than a missing element. Which is
  // also why a launch screen cannot end up covered by an invisible sheet.
  check('and the dialog shut', !isOpen() && Boolean(panel()));
  // THE PORTAL: the dialog is NOT inside the cabinet, because the cabinet carries the world's scale transform and a fixed
  // child of a transformed ancestor is centred on the game area rather than on the window.
  check('the dialog lives in the viewport layer, not in the cabinet', !view.container.querySelector('.ffr__modal'));
  check('so it belongs to the document body', Boolean(document.body.contains(panel())));

  await act(async () => {
    fireEvent.click(boardButton(view));
  });

  check('pressing it opens the board', isOpen());
  check('and the board is the station leaderboard', panel().textContent.includes('STATION LEADERBOARD'));
  // A read with no backend behind it - the honest state of a harness - and it must not read as "nobody has ever played".
  check(
    'a board that cannot be read says so rather than looking empty',
    panel().textContent.includes('BOARD UNAVAILABLE') || panel().textContent.includes('CHECKING THE BOARD'),
    panel().textContent
  );
  // THE FOCUS GOES IN, which is what makes Escape and the two controls reachable without a click first.
  check(
    'and takes the focus, on its close control',
    document.activeElement === document.body.querySelector('.ffr__modal-close'),
    document.activeElement && document.activeElement.className
  );

  // A PRESS INSIDE THE PANEL IS NOT A DISMISSAL: the member is reading it.
  await act(async () => {
    fireEvent.pointerDown(panel());
  });
  check('a press inside the board leaves it up', isOpen());

  await act(async () => {
    fireEvent.pointerDown(backdrop());
  });
  check('and a press on the backdrop behind it closes it', !isOpen());
  // THE FOCUS COMES BACK TO THE CABINET rather than to the button that opened it: the next thing a member does is press
  // space, and space on a focused button presses it - which would open the board straight back up.
  check(
    'returning the focus to the cabinet, so the next space is a jump',
    document.activeElement === view.container.querySelector('.ffr'),
    document.activeElement && document.activeElement.className
  );

  cleanup();
}

console.log('\n--- the keyboard belongs to the dialog while it is up ---');
{
  const view = await mount();
  await act(async () => {
    fireEvent.click(boardButton(view));
  });

  // SPACE MUST NOT START A RUN BEHIND IT. The game's keys are on `window` (see the keydown effect), so this guard is all
  // that stands between a member reading the board and a run they cannot see - and the ready overlay is how a run
  // starting shows itself, because a run takes that overlay away.
  await act(async () => {
    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
  });
  check('space does not start a run behind the board', Boolean(readyOverlay(view)) && isOpen());

  await act(async () => {
    fireEvent.keyDown(window, { key: 'ArrowUp', code: 'ArrowUp' });
  });
  check('nor does the other jump key', Boolean(readyOverlay(view)) && isOpen());

  await act(async () => {
    fireEvent.keyDown(window, { key: 'Escape' });
  });
  check('and Escape closes it', !isOpen());

  // ...AND THE GAME HAS THE KEYS BACK THE MOMENT IT CLOSES, which is what the game-over message promises.
  await act(async () => {
    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
  });
  check('after which space starts a run again', !readyOverlay(view));

  cleanup();
}

console.log('\n--- the board pauses the run rather than covering one that keeps playing ---');
{
  const view = await mount();
  // REAL TIME, because the loop is driven by requestAnimationFrame and jsdom's is a real ~16ms timer (dom-env builds the
  // window with `pretendToBeVisual`, which is what supplies it). Waiting on rAF frames instead would be a longer, less
  // readable version of the same wait.
  const runFor = (ms) => act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
  // The HUD's second span, which is the score (the first is the high score).
  const hudScore = () => {
    const spans = view.container.querySelectorAll('.ffr__hud > span');
    return Number(String(spans[spans.length - 1].textContent).trim()) || 0;
  };

  await act(async () => {
    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
  });
  check('a run starts', !readyOverlay(view));

  await runFor(700);
  const moving = hudScore();
  // THE CONTROL FOR THE CHECK BELOW: the score has to be moving for "it stopped" to mean anything, and if this line ever
  // fails it is the harness that is broken rather than the game (a run at 350px/s scores ~17 a second, so 700ms of play
  // is worth about a dozen points).
  check('and the score is climbing while it plays', moving > 0, `${moving} after 700ms`);

  await act(async () => {
    fireEvent.click(boardButton(view));
  });
  await runFor(700);
  check('opening the board stops the score where it was', hudScore() === moving, `${hudScore()} against ${moving}`);

  await act(async () => {
    fireEvent.keyDown(window, { key: 'Escape' });
  });
  await runFor(400);
  check('and closing it puts the run back on', hudScore() > moving, `${hudScore()} after resuming`);

  cleanup();
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
