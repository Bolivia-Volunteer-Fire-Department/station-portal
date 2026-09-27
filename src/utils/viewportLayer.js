import { createPortal } from 'react-dom';

// Hands a dialog (or a popover) to document.body.
//
// A `position: fixed` element is positioned against its nearest ancestor that has a transform, filter or
// backdrop-filter - not against the viewport - and it is CLIPPED by any `overflow: hidden` ancestor between
// the two. Both of those are the app's own furniture: the page transition puts a transform on the module's
// container, and every card is a rounded panel with `overflow: hidden`.
//
// The result was a dialog that came up in the middle of the card it was opened from, with the shade confined
// to that card: the calendar item popup being the one members see most (it is rendered inside the calendar
// card). The transform fill mode has since been fixed, so the capture is no longer PERMANENT - but it is still
// true for the 160ms a page transition runs, and "a dialog belongs to the window" is a better rule than "make
// sure no ancestor of a dialog ever animates a transform", which the next feature would break.
//
// A function rather than a component so the call sites read `return renderInViewport(<div ...>...</div>);` -
// one line changed per dialog, and nothing re-indented, which for markup this long is the difference between
// a reviewable change and a reflow.
//
// In a DOM-less render (the verifiers use renderToString) the portal would emit nothing at all, so the node
// is returned as it is: the markup stays visible to the checks that read it, instead of every assertion about
// a dialog passing vacuously.
export function renderInViewport(node) {
  if (typeof document === 'undefined' || !document.body) return node;
  return createPortal(node, document.body);
}
