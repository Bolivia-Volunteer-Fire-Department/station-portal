import React, { useSyncExternalStore } from 'react';
import RankIcon from './RankIcon';
import { certificationBadgesFor, certificationBadgeTitle, subscribeCertificationBadges } from '../utils/certifications';

// The icons shown after a member's name for the certifications they currently hold.
//
// A component rather than part of `userLabel`, because `userLabel` returns a string and an icon is not
// characters - and because a name is often already inside a flex row, which is where this drops in. It reads
// the badge index (see utils/certifications) so a caller only needs the member's id.
//
// SUBSCRIBED to that index, not just reading it. The index arrives from a read that lands after the first
// paint, and a name rendered in the meantime has already been drawn with no icons - React only redraws it
// because this hook says the index changed. Reading the registry directly during render looks identical and
// renders nothing, on every screen, which is exactly how this broke.
//
// Nothing is rendered for somebody with no badges, so dropping this beside a name is free for the other 90% of
// rows, and it is silent to a screen reader: the tooltip names the certifications for anyone using a mouse, and
// the certifications themselves are on the member's own page and in the table.
//
// `className` is the SIZE and `iconClassName` is the tone, kept apart because different things decide them. The
// default tone is the sky that reads as "certification" on a white card or a dark one. A surface whose own color the
// caller does not control - the schedule's assignment-colored pills, the red sidebar item - passes 'text-current'
// (or '' to inherit outright), because a fixed sky on an arbitrary background color is exactly how an icon becomes
// unreadable. Same rule the assignment icons on the calendar already follow.
export default function CertificationBadges({
  userId,
  className = 'w-3.5 h-3.5',
  iconClassName = 'text-sky-600 dark:text-sky-400',
}) {
  // The third argument is the server render's snapshot, and it is not optional: the harnesses render these
  // screens with renderToString, which has no store and throws without it.
  const badges = useSyncExternalStore(
    subscribeCertificationBadges,
    () => certificationBadgesFor(userId),
    () => certificationBadgesFor(userId)
  );
  if (badges.length === 0) return null;

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 align-middle"
      title={certificationBadgeTitle(badges)}
      aria-hidden="true"
    >
      {badges.map((badge) => (
        <RankIcon key={badge.id} name={badge.icon} className={`${className} ${iconClassName}`.trim()} />
      ))}
    </span>
  );
}
