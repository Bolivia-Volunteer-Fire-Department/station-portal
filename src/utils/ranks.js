// The rank document's columns, in one place.
//
// WHY A HELPER, when `adminSaveRank` is an object literal four fields long. Because the SET of columns is the part that
// rots, not the writing of them: the Ranks tab's form has carried a rank's ORDER since the tab was written, and the
// save payload simply did not include it. The form was bound, the input was on screen, the officer typed a number, the
// save reported success - and the number never left the browser, so there was nothing for Firestore to write. Every
// other layer was green, because each was looking at a save that was never asked to carry the field.
//
// Naming the columns here makes that failure visible to a reader: the list below is the whole rank, and adding a column
// means adding it in the one place the harnesses can check it against the form's own declaration.
//
// This is the same arrangement as `roleFieldsFromForm` for a role's permission set (utils/permissions.js): the shape of
// a document is one fact, stated once, and the save spreads it.
//
// It is also what makes the payload testable. `services/api.js` is a browser module importing the Firebase SDK through
// extensionless specifiers, so a plain-Node harness cannot import it - so a payload written inline there can only be READ
// as source text, which cannot tell a saved value from a dropped one. Here it can be called, which is what covers both
// halves of the fault: the columns the save sends (scripts/verify-write-safety.mjs) and the document they land in (the
// ranks section of scripts/verify-firestore-writes.mjs).
//
// `.js` on the specifier for the same reason `rankEligibility.js` has it: this module is loaded directly by harnesses
// through plain Node ESM, where an extensionless relative import does not resolve. The bundler hides that.
import { parseRankOrder } from './rankEligibility.js';

// The rank document, without the envelope: `id` is the save's to carry because it is the document KEY (a stored copy
// would be a second place for the truth to live), and `row_version` is the sheet's conflict field, which Firestore saves
// discard on purpose (see `withoutEnvelope` in services/firestoreWrites.js).
//
// THE ORDER IS SENT AS TEXT, and that is deliberate rather than lazy. `Number('')` is 0, and an order of 0 is not "not
// set" - it is a real rank at the bottom of the list, which would silently rewrite every eligibility decision that rank
// takes part in. A cleared order has to stay a blank, which is what every reader already treats as unset:
// `parseRankOrder('')` returns null, and the Ranks tab draws "Not set" for it.
export const rankFieldsFromForm = (formRank) => {
  const raw = String(formRank?.rank_order ?? '').trim();
  return {
    description: formRank?.description,
    color: formRank?.color,
    icon: formRank?.icon,
    // Digits only, and NOT coerced to a number. Two reasons, and the second is the dangerous one.
    //
    // The form's input already filters to digits, but this is the boundary the value crosses on its way into the
    // database, and "3rd" read back by `parseInt` is 3 in one place and nothing in another - the same class of
    // disagreement this module exists to prevent. A value that is not a number is stored as no order, which the tab shows
    // as "Not set" and the rules treat as unverifiable: a state the station can see and fix, rather than a value that
    // parses differently in each place it is read.
    //
    // `Number('')` is 0, and an order of 0 is a REAL rank at the bottom of the list rather than an absent one - so
    // coercing would turn "clear this order" into "move this member to the bottom of the hierarchy", rewriting every
    // eligibility decision the rank takes part in while looking exactly like a successful clear on screen.
    rank_order: /^\d+$/.test(raw) ? raw : '',
  };
};

// Whether a saved order is one the rules can compare. A rank with no usable order takes part in none of the eligibility
// decisions - an assignment's `rank_order_required` has nothing to compare against, and an event's "this rank and above"
// audience cannot be expanded - so a screen that needs to say so asks here rather than each re-deriving `parseRankOrder`.
export const rankOrderIsSet = (rank) => parseRankOrder(rank?.rank_order) !== null;