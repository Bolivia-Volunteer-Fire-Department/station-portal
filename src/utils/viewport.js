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

// THE OTHER END OF THE SCALE: 640px IS TAILWIND'S `sm`, so a window below it is the one this app calls a phone. It is the
// SECOND breakpoint rather than a replacement, and the band between the two is the point of it:
//
//   768px and up  - DESKTOP. The sidebar is a static column, and the calendar draws the month.
//   640-767px     - A TABLET IN PORTRAIT, or a large phone in landscape. The sidebar has collapsed to a drawer, so the
//                   full month grid no longer has the room it was drawn for - but there IS room for two days side by
//                   side, and a member checking "am I on tomorrow" is the common case in this band.
//   under 640px   - A PHONE. One day, and the window's height to itself.
//
// BOTH NUMBERS ARE TAILWIND'S, and that is deliberate for the same reason 768 is: the sidebar (`fixed md:static`) and the
// app bar switch on Tailwind's own breakpoints, so a screen that decides something in JAVASCRIPT has to use the same
// numbers or the layout and the behaviour disagree about what shape the window is.
//
// `max-width: 639px` rather than `min-width: 640px`, and the asymmetry is not cosmetic: `min-width: 768px` and
// `min-width: 640px` OVERLAP, and a 700px window matches both. Two `min-width` queries therefore cannot be compared by
// "which one matched" - a window between them would be both a tablet and a phone. Writing the phone end as an upper
// bound makes the two disjoint, which is what lets `dayViewSpan` below decide by asking them in order without caring
// which matched first.
export const PHONE_MEDIA_QUERY = '(max-width: 639px)';

// ONE MEDIA QUERY, ANSWERED AS A STORE.
//
// `subscribeViewport` and `subscribePhoneViewport` would otherwise be the same twenty lines twice, and the awkward parts
// of those twenty lines - the `addEventListener`/`addListener` split, the stable identities `useSyncExternalStore`
// requires, the no-window fallback - are exactly the parts a second copy gets subtly wrong. Built ONCE at module level,
// so both exports below are stable function identities for the lifetime of the module.
//
// THE QUERY IS RESOLVED LAZILY, ON EVERY CALL, and that is load-bearing rather than an optimisation either way. Resolving
// it once at module load looks tidier and is WRONG: every harness in this repo installs its own `window.matchMedia` AFTER
// importing the module under test, so a store that captured the MediaQueryList at import time would hold the real
// browser's answer - `false`, because there is no window - and the board would silently render the MONTH view in every
// narrow-view test. It was caught by scripts/verify-admin-schedule-runtime asserting that the day view draws the day view.
//
// `noWindow` IS THE ANSWER, not a guess about one: a server render, a browser without `matchMedia`, and a component's
// first paint before any effect has run all land here, and all three are answered with the desktop shape. That is the
// layout that holds everything - a month grid, the full toolbar, the printed sheet's shape - so the failure mode is a
// screen that is briefly too wide, never one that refuses to show the data. It is also what keeps the server-rendered
// harness cases asserting the calendar.
const mediaQueryStore = (queryString, noWindow) => {
  const query = () =>
    typeof window === 'undefined' || typeof window.matchMedia !== 'function' ? null : window.matchMedia(queryString);
  return {
    getSnapshot: () => {
      const current = query();
      return current ? current.matches : noWindow;
    },
    subscribe: (listener) => {
      // No window, or no `matchMedia`: nothing to listen to, and the answer will not change.
      const current = query();
      if (!current) return () => {};
      if (typeof current.addEventListener === 'function') {
        current.addEventListener('change', listener);
        return () => current.removeEventListener('change', listener);
      }
      current.addListener(listener);
      return () => current.removeListener(listener);
    },
  };
};

const desktopStore = mediaQueryStore(DESKTOP_MEDIA_QUERY, true);
const phoneStore = mediaQueryStore(PHONE_MEDIA_QUERY, false);

// Whether this window is at or above that threshold.
//
// NO WINDOW MEANS YES, and there are three callers that depend on it: a server render (every server-side harness in
// this repo, and any future SSR) has no viewport to measure; a browser old enough to lack `matchMedia` cannot be asked;
// and a component's first paint before any effect has run has only the snapshot. In all three the DESKTOP answer is
// the safe one - it is the layout that holds everything (a month grid, the full toolbar, the printed sheet's shape) -
// so the failure mode of guessing wrong is a screen that is too wide for a moment, never one that refuses to show the
// data. It is also what makes the server-rendered harness cases keep asserting the calendar.
export const desktopViewport = () => desktopStore.getSnapshot();

// Whether this window is narrow enough to be a phone. No window means NO - the same reasoning as `desktopViewport`,
// read from the other end: a window nobody can measure is drawn in the roomiest shape it has.
export const phoneViewport = () => phoneStore.getSnapshot();

// The same question, REACTIVELY: resizing the window past the breakpoint (or rotating a tablet) answers differently,
// and a screen that branches on this must redraw when it does.
//
// Shaped for `useSyncExternalStore`, the same way the certification badge registry is (utils/certifications): a
// module-level subscribe function and a module-level snapshot function, both stable identities - which is a
// requirement, not a convenience. An inline `() => ...` getSnapshot is a new function every render, and React
// re-subscribes forever.
//
// `change` RATHER THAN A RESIZE LISTENER. A media query listener fires exactly when the ANSWER changes, so dragging a
// window across a breakpoint costs one listener call rather than one per pixel, and the callback needs no threshold
// comparison of its own. `addEventListener` on a MediaQueryList is the modern API; the two `addListener` spellings are
// what Safari before 14 and Chrome before 84 expose, and they are the same event.
export const subscribeViewport = desktopStore.subscribe;
export const subscribePhoneViewport = phoneStore.subscribe;