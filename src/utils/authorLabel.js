// "Who created this row", for the administrative screens that reveal it.
//
// Shared by announcements and events rather than duplicated: both stamp `author_user_id` from the
// session on create and never accept it from a client, so both resolve it the same way. One copy means
// the two screens cannot disagree about what a missing or unknown author looks like.
//
// A blank value yields '' rather than a dangling "#": rows can predate the column, or be typed straight
// into the sheet, and neither is something to report to a reader as an error.
import { unnamedLabel } from './displayLabel';
const text = (value) => String(value ?? '').trim();

export const authorLabel = (row, users = [], { prefix = 'Created by' } = {}) => {
  const authorId = text(row && row.author_user_id);
  if (!authorId) return '';
  const found = (Array.isArray(users) ? users : []).find((user) => String(user?.id) === authorId);
  const name = found ? text(found.name) : '';
  // An author who cannot be resolved reads as a phrase, not as their id. That happens when the member has been
  // deleted since, or when the row names somebody the directory does not hold - neither of which a reader should
  // have to interpret a UUID to understand.
  return `${prefix} ${name || unnamedLabel('member')}`;
};
