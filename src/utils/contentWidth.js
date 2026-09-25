// Content width policy, in one place.
//
// Most screens fill the panel the sidebar leaves. Table- and calendar-heavy pages need that: capping them
// wasted the horizontal space a wide monitor has. But a form or a status page stretched edge to edge looks
// sparse and is harder to scan, so those are capped and centred instead.
//
// Two ways to opt in, and only these two:
//
//   * a whole top-level module, listed in CENTERED_CONTENT_TABS (App caps the <main> for it), and
//   * part of a screen - an administration sub-tab, or one view inside a tab - by wrapping it in
//     components/CenteredContent.
//
// The width itself lives here so both mechanisms agree, and so there is one number to change.

export const CONTENT_MAX_WIDTH = 'max-w-3xl';

// Top-level modules whose content is capped and centred.
export const CENTERED_CONTENT_TABS = ['dashboard', 'settings'];
