// How much of the game's own coordinate space fits in the room it has been given.
//
// THE RUNNER IS DRAWN IN A FIXED 800x280 WORLD. Every sprite position, the ground line and the boss's right-hand edge
// are arithmetic on that rectangle. The cabinet around it is responsive (`width: min(100%, 800px)`), so on a screen
// narrower than the world the world is simply too big for its box - and because the play area clips (`overflow:
// hidden`), what disappeared was the RIGHTMOST thing in it: the floating chief, which holds `width - 118` and so sat at
// x = 682 on a 390px phone, outside the box, invisible, throwing fireballs from off-screen. "It doesn't always render"
// was a window width, not a fault in the boss.
//
// So the world is SCALED to fit rather than cropped. Never above 1: a screen with the room gets the game at its own
// size, and the scale only ever comes down.
//
// A measurement that cannot be used - no layout yet, a hidden container, a test renderer with no layout engine at all -
// comes back as 1, the world at its own size. That is the safe direction: a scale of 0 would collapse the game to
// nothing, and a caller that measured 0 measures again the moment it has a real width (see the ResizeObserver in
// FirefighterRunner).
export const gameFit = (available, designWidth) => {
  const room = Number(available);
  const design = Number(designWidth);
  if (!Number.isFinite(room) || !Number.isFinite(design) || design <= 0) return 1;
  if (room <= 0) return 1;
  return Math.min(1, room / design);
};
