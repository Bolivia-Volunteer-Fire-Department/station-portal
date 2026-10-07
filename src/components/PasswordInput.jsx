import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

// A password field with an eye on it.
//
// TYPING A PASSWORD BLIND IS WHY PEOPLE PICK SHORT ONES, and on a phone at a station door the typos are frequent enough to
// matter. So every password field in the app is this component rather than a bare `<input type="password">`: one place
// decides how the reveal behaves, and a new password field cannot be added without it.
//
// IT REVEALS NOTHING THAT IS NOT ALREADY IN THE FIELD. The toggle changes the input's `type` and nothing else - it cannot
// show a saved password, because a saved password is never in the input to begin with. That is the honest limit of the
// feature rather than a gap in it, and it is why the reveal is safe to offer on a shared station laptop.
//
// It is a drop-in for the input it replaces: the wrapper is a plain `block` span, so a caller's `w-full` still means the
// full width of the same column, and `pr-12` is added to whatever classes are passed so the button can never sit on top of
// what is being typed.
//
// The button is `type="button"` so it cannot submit the form it lives inside, it greys out with the field it belongs to,
// and it says what it does out loud because "the eye" means nothing read aloud.
export default function PasswordInput({ className = '', disabled = false, ...props }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <span className="relative block">
      <input {...props} disabled={disabled} type={revealed ? 'text' : 'password'} className={`${className} pr-12`} />
      <button
        type="button"
        onClick={() => setRevealed((current) => !current)}
        disabled={disabled}
        aria-label={revealed ? 'Hide password' : 'Show password'}
        aria-pressed={revealed}
        title={revealed ? 'Hide password' : 'Show password'}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50 dark:hover:bg-slate-700 dark:hover:text-slate-200"
      >
        {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </span>
  );
}
