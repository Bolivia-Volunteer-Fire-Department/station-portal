import React from 'react';

// A view toggle: a chip-shaped button with a pressed state, matching the control on the Schedule Management
// board.
//
// Used for every TEMPORARY view option - "Show everyone" and "Show events" - so they read as one family of
// view controls rather than as settings. Preference switches keep ToggleSwitch, because those persist and a
// switch communicates a saved state; a pressed button communicates a temporary filter.
//
// The text names the ACTION, not the state: "Show events" while they are hidden, "Hide events" while they are
// shown. A button labelled "Show events" that is currently showing them reads as a promise the button has
// already kept, so the verb follows the state. It is derived from `noun` in this one place, so a call site
// cannot pair the wrong verb with the wrong state.
//
// The description becomes the tooltip (`title`) rather than a second line of text: a chip has no room for
// one, and these are self-describing labels sitting next to the thing they change.
export default function ViewToggle({ noun, description, enabled, onChange, icon: Icon, className = '' }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      aria-pressed={enabled}
      title={description}
      className={`flex items-center gap-2 font-medium text-sm px-3 py-2.5 rounded-xl transition border ${
        enabled
          ? 'text-slate-900 dark:text-white bg-slate-200 dark:bg-slate-600 border-slate-300 dark:border-slate-500'
          : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-700'
      } ${className}`.trim()}
    >
      {Icon && <Icon className="w-4 h-4" />}
      {enabled ? 'Hide' : 'Show'} {noun}
    </button>
  );
}
