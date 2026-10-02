// A REAL DOM FOR THE HARNESSES THAT NEED ONE.
//
// Every other harness in this repo server-renders, and a server render does execute component bodies and hook CALLS.
// What it cannot execute is a hook EFFECT, because effects only run after a commit - and a server render never commits.
//
// That gap cost a run of releases of the admin schedule board. Each bug lived in an effect, each one shipped past
// a full green suite, and each one was found by an officer staring at a board that would not load:
//
//   1. AdminPanel never forwarded `onNeedSchedule`, so the board had no reader and silently drew a stale array. A server
//      render shows no error for a prop that arrives nowhere.
//   2. An effect listed `onNeedSchedule` as a dependency. App re-creates that function every render, so the effect re-ran
//      after every read it had just started - an unbounded loop of Firestore reads.
//   3. The fix for (2) added a cleanup flag and an "already reading" guard. `main.jsx` wraps the app in StrictMode, which
//      mounts, unmounts and remounts: run one was cancelled, run two started nothing, and the answer that arrived was
//      discarded. The board never loaded at all.
//
// None of those are visible without a commit. So the DOM exists now, and scripts/verify-admin-schedule-runtime.mjs mounts
// the real board in it. Import this module FIRST and statically: ESM evaluates imports in declaration order, so the
// globals below are in place before anything imports react-dom/client. Do not convert that import to a dynamic one - a
// bundler is free to hoist it, and then the DOM arrives after the code that needs it.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  // Supplies requestAnimationFrame, which React's scheduler wants.
  pretendToBeVisual: true,
});

const { window } = dom;

// Defined, not assigned: Node exposes some of these (navigator in particular) as getter-only properties on globalThis, so
// a plain assignment throws before the harness ever renders anything.
const define = (name, value) => {
  if (value === undefined) return;
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: true });
};

define('window', window);
define('document', window.document);
define('navigator', window.navigator);
define('location', window.location);
define('history', window.history);
define('localStorage', window.localStorage);
define('sessionStorage', window.sessionStorage);
define('getComputedStyle', window.getComputedStyle);
define('requestAnimationFrame', window.requestAnimationFrame);
define('cancelAnimationFrame', window.cancelAnimationFrame);
for (const name of [
  'HTMLElement',
  'HTMLInputElement',
  'HTMLButtonElement',
  'HTMLAnchorElement',
  'Element',
  'Node',
  'Text',
  'DocumentFragment',
  'Event',
  'CustomEvent',
  'MouseEvent',
  'KeyboardEvent',
  'PointerEvent',
  'DragEvent',
  'DataTransfer',
  'MutationObserver',
  'DOMParser',
  'SVGElement',
]) {
  define(name, window[name]);
}

// jsdom implements none of these, and all three are reached by components that measure themselves or ask about a
// viewport. A component that reads one during a commit must not take the whole harness down over a missing browser API.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  define('matchMedia', window.matchMedia);
}
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  define('ResizeObserver', window.ResizeObserver);
}
if (!window.IntersectionObserver) {
  window.IntersectionObserver = class {
    constructor() {
      this.root = null;
      this.rootMargin = '';
      this.thresholds = [];
    }

    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
  define('IntersectionObserver', window.IntersectionObserver);
}
if (!window.scrollTo) window.scrollTo = () => {};

// Tells React it is inside an act() environment, without which every state update from a promise or a timer logs
// "not wrapped in act(...)" and the harness output becomes unreadable.
define('IS_REACT_ACT_ENVIRONMENT', true);

// @testing-library/react cleans up between tests by hooking the global `afterEach` when one exists. There is no test
// runner here - this is a plain script - so each case unmounts its own tree instead, and saying so keeps the next reader
// from wondering why trees appear to leak.
export const domWindow = window;
export const domDocument = window.document;
