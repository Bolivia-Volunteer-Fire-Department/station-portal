import React from 'react';
import CertificationBadges from './CertificationBadges';
import { userLabel } from '../utils/displayLabel';

// A member's name, with the certification icons they currently hold after it.
//
// This is the whole-app answer to "display the icon wherever the name appears": rather than every screen
// remembering to add badges, it adds them itself, so a screen that renders a name through this gets them for
// free. `userLabel` is still used where a plain STRING is needed (an option in a select, a printout, a log
// line) - which is exactly the distinction: text where an icon cannot go, this everywhere else.
//
// The name itself is `userLabel`, the same helper every other screen uses, so a half-filled row reads the same
// way here as anywhere else.
//
// `className` sizes the icons and `iconClassName` tones them (see CertificationBadges): a caller drawing a name on a
// surface whose color it does not control - the schedule's assignment-colored pills - passes a tone of '' so each
// glyph inherits that surface's text color instead of fighting it.
export default function MemberName({
  user,
  className = 'w-3.5 h-3.5',
  iconClassName,
  nameClassName = '',
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 align-middle">
      <span className={`truncate ${nameClassName}`}>{userLabel(user)}</span>
      <CertificationBadges userId={user?.id} className={className} iconClassName={iconClassName} />
    </span>
  );
}
