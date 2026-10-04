// THE ONE DEVICE BREAKPOINT THIS APP HAS, and whether the window is above it.
//
// NOT TO BE CONFUSED WITH utils/viewportLayer.js, which is about where a DIALOG is rendered (it hands the node to
// document.body so no transformed, `overflow: hidden` ancestor can clip it). This module is about size only.
//
// 768px IS TAILWIND'S `md`, WHICH IS THE THRESHOLD THE SHELL ALREADY SWITCHES ON. The sidebar is a drawer below `md`
// and a static column at `md` (Sidebar.jsx: `fixed md:static`), and the app bar's own layout follows it. A screen that
// decides something in JAVASCRIPT has to use the same number, or the same window would be one shape in the layout and
// another in the behaviour - a single-day board whose arrows still walked months, which is the contradiction this
// module exists to make impossible. Tailwind's copy of the number is in its own config-free defaults; this is the copy
// a component reads, and it is written down once here rather than repeated per screen.
export const DESKTOP_MEDIA_QUERY = '(min-width: 768px)';

// Whether this window is at or above that threshold.
//
// NO WINDOW MEANS YES, and there are three callers that depend on it: a server render (every server-side harness in
// this repo, and any future SSR) has no viewport to measure; a browser old enough to lack `matchMedia` cannot be asked;
// and a component's first paint before any effect has run has only the snapshot. In all three the DESKTOP answer is
// the safe one - it is the layout that holds everything (a month grid, the full toolbar, the printed sheet's shape) -
// so the failure mode of guessing wrong is a screen that is too wide for a moment, never one that refuses to show the
// data. It is also what makes the server-rendered harness cases keep asserting the calendar.
export const desktopViewport = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
};

// The same question, REACTIVELY: resizing the window past the breakpoint (or rotating a tablet) answers differently,
// and a screen that branches on this must redraw when it does.
//
// Shaped for `useSyncExternalStore`, the same way the certification badge registry is (utils/certifications): a
// module-level subscribe function and a module-level snapshot function, both stable identities - which is a
// requirement, not a convenience. An inline `() => ...` getSnapshot is a new function every render, and React
// re-subscribes forever.
//
// `change` RATHER THAN A RESIZE LISTENER. A media query listener fires exactly when the ANSWER changes, so dragging a
// window across 768px costs one listener call rather than one per pixel, and the callback needs no threshold
// comparison of its own. `addEventListener` on a MediaQueryList is the modern API; the two `addListener` spellings are
// what Safari before 14 and Chrome before 84 expose, and they are the same event.
export const subscribeViewport = (listener) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(DESKTOP_MEDIA_QUERY);
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }
  query.addListener(listener);
  return () => query.removeListener(listener);
};