import React from 'react';

// A preference switch: a stacked row with a description, used for saved settings in User Settings, the
// Notification settings and the System Settings tab.
//
// Temporary view options do NOT use this - they use ViewToggle, whose pressed state reads as "this filter is
// on" rather than "this is saved".
//
// `feedbackSound="onOff"` is for the one switch that controls sounds themselves. Every other press in the app
// gets click.mp3 from the delegated listener (utils/uiSounds), but this one has to say what it just did, and it
// has to be heard on the way ON as well - when sounds are still off. So the button carries the sound it is about
// to make as a directive, which the listener plays even while muted.
export default function ToggleSwitch({ label, description, enabled, onChange, disabled, feedbackSound }) {
  // The sound is named for the RESULT of pressing, so the listener needs no idea what the new state will be.
  const soundDirective = feedbackSound === 'onOff' ? (enabled ? 'sound-off' : 'sound-on') : undefined;

  return (
    <div className="flex items-center justify-between py-4 border-b border-slate-200 dark:border-slate-700/60 last:border-0">
      <div className="pr-4">
        <p className="text-sm font-medium text-slate-900 dark:text-white">{label}</p>
        {description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{description}</p>}
      </div>
      <button
        type="button"
        disabled={disabled}
        data-sound={soundDirective}
        onClick={() => onChange(!enabled)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
          enabled ? 'bg-red-600' : 'bg-slate-300 dark:bg-slate-700'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
            enabled ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}