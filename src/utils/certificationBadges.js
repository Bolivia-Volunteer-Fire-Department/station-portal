// What the icon beside a member's name is, derived from their records.
//
// Pure and dependency-free, which is the whole point. The rule used to live inside `refreshCertificationBadges` in
// services/firestoreWrites.js - a browser module that imports the Firebase SDK, so NO repair script could reach it. That is
// why there was no way to rebuild the index outside a save that happened to trigger one, and why a station that migrated
// its certifications without them has had no cure: the one function that knows the rule could not be run from a script.
//
// This is the shape the repo already uses for exactly this problem: `scoreToStore` in scripts/normalize-runner-scores.mjs,
// extracted so the repair script and the app cannot disagree about what a stored value should be. The loop around it is
// the part that differs per caller.
//
// `.js` on the specifier where it is imported from plain Node ESM, which does not resolve an extensionless relative path
// (the same constraint `rankEligibility.js` documents).
import { stationTodayKey } from './scheduleDate.js';

// Whether ONE record earns a badge today.
//
// The claim a badge makes is narrow on purpose: a paramedic badge on somebody whose licence lapsed is worse than no badge,
// because it is the app making a claim the station cannot back. So a record earns nothing unless its type asks to be
// shown beside a name (`show_next_to_name`) and names an icon to draw, and only while it is actually in force:
//   * not yet effective - a future licence is not a qualification today;
//   * past its end date - lapsed, and the app should not keep asserting it.
export const badgeForRecord = (record = {}, type = {}, today = '') => {
  if (!type || type.show_next_to_name !== true || !type.icon) return null;
  const from = String(record.effective_date || '');
  const to = String(record.end_date || '');
  if (from && from > today) return null; // not started yet
  if (to && to < today) return null; // lapsed - the badge would be a claim the station cannot back
  return { id: type.id, name: type.name, icon: type.icon };
};

// The whole index, from the records and the types. The map is `userId -> badges`, and a member with none is ABSENT rather
// than present with an empty list: a missing document and an empty one have to mean the same thing, because the roster
// draws whatever this returns and cannot tell those apart.
//
// One badge per type however many periods a member holds of it - two EMT periods is still one EMT badge, and drawing it
// twice beside a name would be noise rather than information.
export const badgeIndexFor = (records = [], types = [], today = '') => {
  const typeById = Object.fromEntries((Array.isArray(types) ? types : []).map((t) => [String(t.id), t]));
  const index = {};
  (Array.isArray(records) ? records : []).forEach((record) => {
    const owner = String(record?.user_id ?? '').trim();
    const badge = owner ? badgeForRecord(record, typeById[String(record.certification_id ?? '')], today) : null;
    if (!badge) return;
    index[owner] = index[owner] || [];
    if (index[owner].some((existing) => existing.id === badge.id)) return;
    index[owner].push(badge);
  });
  return index;
};

// Today, as the STATION's today - so a rebuild run from a laptop in another timezone draws the same badges the members
// see. Shared with the app's own rebuild for that reason.
export const badgeToday = () => stationTodayKey();