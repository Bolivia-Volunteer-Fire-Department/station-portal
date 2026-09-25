// Applying a saved user row to the in-memory list.
//
// The rules live in utils/savedRow.js (shared with roles, ranks, assignments and templates). This wrapper
// adds the one thing specific to members: the field whitelist, so a password can never reach a list that
// otherwise holds none.
import { mergeSavedRow } from './savedRow';

// The columns the editor owns. Anything else on the row is left as the server sent it.
export const EDITABLE_USER_FIELDS = [
  'user_name',
  'name',
  'status',
  'role_id',
  'rank_id',
  'exclude_from_scheduling',
  'runner_sound_profile',
];

// The saved row, limited to the fields worth showing immediately. A blank password is dropped
// rather than written as an empty string, since the list must never hold one.
export const savedUserPatch = (fields) => {
  const source = fields || {};
  const patch = {};
  EDITABLE_USER_FIELDS.forEach((key) => {
    if (source[key] !== undefined) patch[key] = source[key];
  });
  return patch;
};

// `users` with the saved row applied, or the same list when nothing matches.
export const mergeSavedUser = (users, fields) => {
  const patch = savedUserPatch(fields);
  // Driven through the shared merge with an explicit field set, so "only the editor's columns" is enforced
  // in one place rather than two.
  return mergeSavedRow(users, { ...patch, id: fields?.id }, { omit: ['password'] });
};

