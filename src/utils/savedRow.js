// Applying a saved row to an in-memory list, for the tables that render app state rather than their own.
//
// Why this exists: a save is ONE backend write, but the screen it lives on is refreshed by a wave of
// requests (App.jsx#refreshAdminData asks for nine things). Apps Script serializes those behind a script
// lock in doPost, so the wave takes tens of seconds - far too long to hold a form or a button on. So a save
// now applies its own row locally and lets the wave land whenever it lands.
//
// The rules matter, and each is easy to get subtly wrong:
//
//   * Only an EXISTING row is touched. A new record's id is server-assigned, so its row arrives with the
//     refresh; inventing a row from a blank id would show a phantom entry.
//   * Only the fields the editor owns are copied (`omit` keeps secrets and server-set columns out).
//   * The input list is never mutated, and nothing matching returns the SAME list so React can skip a render.
//
// Pure, so scripts/verify-refresh-wiring.mjs can exercise every rule.
export const mergeSavedRow = (rows, fields, options = {}) => {
  const id = String(fields?.id ?? '').trim();
  if (!id) return rows;

  const omit = new Set([...(options.omit || []), 'id']);
  const patch = {};
  Object.keys(fields || {}).forEach((key) => {
    if (omit.has(key)) return;
    if (fields[key] === undefined) return;
    patch[key] = fields[key];
  });
  if (!Object.keys(patch).length) return rows;

  return (Array.isArray(rows) ? rows : []).map((row) =>
    String(row?.id ?? '') === id ? { ...row, ...patch } : row
  );
};

// Two sets of rows as one, by id: a row that arrives replaces the one already held, and a row only the existing list has
// is KEPT. Used when a window of the schedule lands after the one the sign-in carried - the calendar draws whatever it
// holds, and the board diffs a month of it, so replacing the array would drop shifts nobody meant to drop.
export const mergeRowsById = (rows, arriving) => {
  const byId = new Map();
  const add = (list) =>
    (Array.isArray(list) ? list : []).forEach((row) => {
      const id = row && row.id !== undefined && row.id !== null ? String(row.id) : '';
      if (id) byId.set(id, row);
    });
  add(rows);
  add(arriving);
  return [...byId.values()];
};

