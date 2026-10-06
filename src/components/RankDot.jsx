import React from 'react';

// The coloured dot drawn before a member's name for the rank they hold.
//
// THE COLOUR IS THE RANKS TAB'S, and only that: `ranks/<id>.color`, set in Administration → Ranks. This component invents
// no colour and holds no palette of its own, so a station that repaints "Officer" repaints every officer on every
// schedule at once, and a rank with no colour is left exactly as blank as the station left it.
//
// A DOT RATHER THAN THE RANK'S ICON, which is what the All Members list and the on-duty card draw. A schedule pill is two
// lines of 10px text on an assignment-coloured background, and it already carries an assignment icon on its second line
// and the member's certification icons beside their name - a fourth glyph per person would be a pile of glyphs to read
// rather than a fact to glance at. A dot carries the one thing a rank is scanned for at this size, the colour.
//
// WHY THIS COSTS NO FIRESTORE READ - the question asked when this was added, and the answer is in the two fields it
// needs, both of which are already on the screen:
//
//   * `rank_id` rides every roster row. GET_ROSTER's projection is `{ id, name, rank_id }` (the same three columns the
//     sign-in payload's on-duty rows carry), and the administrator's `users` section SPREADS the whole user document.
//     So the row the name is being drawn from already answers "which rank".
//   * `color` arrives with the rest of the rank. `ranks` is read whole wherever a schedule is drawn - the sign-in
//     payload's station wave, GET_SCHEDULE_SETUP, and the administration wave that refreshes it in place - and both
//     calendars are already handed it as a prop, for the eligibility rule.
//
// So the dot is a lookup over two arrays the screen is holding, and this module imports no service, no firestore and no
// store: there is nothing here that CAN read. `npm run verify:rank-dot` asserts exactly that, because "does this feature
// cost a read" is a question about imports rather than about intent.
//
// NOTHING IS DRAWN WHEN THERE IS NOTHING TO DRAW. A member with no rank, a rank id that matches no rank, and a rank whose
// colour is blank all render nothing. The Ranks tab leaves the colour empty until somebody paints it, and a blank colour
// is a TRANSPARENT dot - an empty ring on every unpainted pill, which is a colour the station never chose and reads as a
// rendering fault. Same rule the assignment icons and the certification badges already follow. It also means a station
// that has painted no rank colours sees no change from this at all.
//
// NOT ANNOUNCED BY A SCREEN READER, matching the badges beside the name: the dot is decoration over a name that is
// already being read out, and it carries no text of its own - so there is nothing to announce, and `aria-hidden` says so
// rather than leaving it ambiguous. The TOOLTIP is the sighted path, and it is the point of it: a colour nobody
// recognizes is a question answered in place ("what is that red dot?") instead of a colour to go and look up.
//
// `className` is the GEOMETRY - the size, and how the caller's line lays it out (see CertificationBadges for the same
// split of size from tone). The dot's own shape, ring and colour are this component's, because a dot that is not round,
// or that does not separate from its background, is not the thing being asked for.
const rankInitials = (name) => {
  const words = String(name || '').trim().split(/[\s/,&-]+/).filter(Boolean);
  if (words.length > 1) return words.map((word) => word[0]).join('').slice(0, 3).toUpperCase();
  return (words[0] || '?').slice(0, 2).toUpperCase();
};

export default function RankDot({
  user,
  ranks = [],
  className = 'inline-block w-2 h-2 shrink-0 align-middle',
  showLabel = false,
}) {
  const rankId = String(user?.rank_id ?? '').trim();
  if (!rankId) return null;
  const rank = ranks.find((r) => String(r.id) === rankId);
  // `?? ''` as well as the trim: a rank with no colour field at all and one with an empty string are the same answer.
  const color = String(rank?.color ?? '').trim();
  if (!color) return null;
  const name = String(rank?.description ?? '').trim();

  if (showLabel) {
    return (
      <span
        className={`inline-flex shrink-0 align-middle ${className}`}
        title={name || undefined}
        aria-label={`Rank: ${name || 'Unnamed rank'}`}
      >
        <span className="inline-flex h-3 min-w-4 items-center justify-center rounded-[3px] border border-white/80 px-0.5 text-[8px] font-bold leading-none text-white shadow-sm" style={{ backgroundColor: color }}>
          {rankInitials(name)}
        </span>
      </span>
    );
  }

  return (
    <span
      // `ring-white/70` because this is always drawn ON a solid pill - a filled shift is the assignment's colour with
      // white text over it (both boards draw it that way), so a rank colour close to the assignment colour would
      // otherwise disappear into it. The ring is the same white the pill's own text uses, which is the rule the
      // assignment icon inside a pill already follows. On a surface we do not control, that is the honest separator.
      className={`rounded-full ring-1 ring-white/70 ${className}`}
      style={{ backgroundColor: color }}
      title={String(rank?.description ?? '').trim() || undefined}
      aria-hidden="true"
    />
  );
}
