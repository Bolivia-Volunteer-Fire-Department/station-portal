// The two gestures an installed app does not have.
//
// In a browser tab, pinch-zoom and double-tap-zoom belong to the PAGE: pinch is how a low-vision member
// reads a schedule or a document, so index.html deliberately leaves both alone. Installed on a Home
// Screen they stop meaning "zoom the page" and start meaning "the app just resized itself under my
// fingers" - a stray two-finger touch during a shift change, or a double-tap on a button the member was
// pressing twice, and the layout is suddenly wrong with no way for them to know why.
//
// So the lock is applied ONLY when this window is not a tab, which is also the only place it works:
// Safari has ignored `user-scalable=no` in a tab since iOS 10 (a deliberate accessibility decision) and
// honors it in a Home Screen app, and Chrome honors it in a standalone window. Asking for it in a tab
// would be asking for something the browser has already decided against.

// The display modes that mean "installed". `minimal-ui` counts: it is a Home Screen window that kept a
// sliver of browser chrome, which is still not a tab.
const INSTALLED_WINDOWS = ['standalone', 'fullscreen', 'minimal-ui'];

// Whether this window is an installed app rather than a browser tab.
//
// `display-mode` is the modern answer and the media query is the only way to ask it; `navigator.standalone`
// is iOS's older non-standard spelling of the same fact, still worth checking because it is what iOS
// Safari sets for a Home Screen app on versions that report the media query too.
export function installedWindow() {
  if (typeof window === 'undefined') return false;
  if (window.navigator?.standalone === true) return true;
  if (typeof window.matchMedia !== 'function') return false;
  return INSTALLED_WINDOWS.some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches);
}

// Swaps the viewport for one that cannot be zoomed. Returns whether it changed anything, which is what
// the verifier checks.
//
// `viewport-fit=cover` is kept: it is what lets the app paint into the notch and the home-indicator
// area, and it is the reason the safe-area insets in App.jsx and Sidebar.jsx do anything at all.
export function lockGesturesWhenInstalled() {
  if (typeof document === 'undefined') return false;
  if (!installedWindow()) return false;

  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return false;

  meta.setAttribute(
    'content',
    'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
  );
  return true;
}

// The status bar is deliberately NOT handled here, and that is a finding rather than an omission.
//
// `apple-mobile-web-app-status-bar-style: black-translucent` is what paints an installed app UNDER the
// status bar. The obvious refinement - use it in the dark theme, where its forced-white clock is
// readable, and fall back to `default` in the light one - does not work: iOS caches this meta when the
// app is added to the Home Screen and ignores later changes, including a different value served by a
// reload. Reported consistently (Apple's own developer forum, and a StackOverflow question doing exactly
// this for exactly this reason), and it matches the one workaround that does work, which is removing and
// re-adding the icon. So the value is static in index.html, and the legibility it needs in BOTH themes is
// provided by the navy strip the shell paints under it (App.jsx) - which is what makes a fixed
// `black-translucent` safe rather than a bet on the theme a member happens to be using.

