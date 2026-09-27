import React from 'react';
import RankIcon from './RankIcon';
import { certificationBadgesFor, certificationBadgeTitle } from '../utils/certifications';

// The icons shown after a member's name for the certifications they currently hold.
//
// A component rather than part of `userLabel`, because `userLabel` returns a string and an icon is not
// characters - and because a name is often already inside a flex row, which is where this drops in. It reads
// the badge index filled from the bootstrap (see utils/certifications) so a caller only needs the member's id.
//
// Nothing is rendered for somebody with no badges, so dropping this beside a name is free for the other 90% of
// rows, and it is silent to a screen reader: the tooltip names the certifications for anyone using a mouse, and
// the certifications themselves are on the member's own page and in the table.
export default function CertificationBadges({ userId, className = 'w-3.5 h-3.5' }) {
  const badges = certificationBadgesFor(userId);
  if (badges.length === 0) return null;

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 align-middle"
      title={certificationBadgeTitle(badges)}
      aria-hidden="true"
    >
      {badges.map((badge) => (
        <RankIcon key={badge.id} name={badge.icon} className={`${className} text-sky-600 dark:text-sky-400`} />
      ))}
    </span>
  );
}
