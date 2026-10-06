// Turn a form's DECLARATIVE field map into the values that go on the PDF.
//
// A form definition says which PDF field comes from what, as data - never as code:
//
//   fields: {
//     'Member Name':   { from: 'member.name' },
//     'Hazmat Hours':  { from: 'totals.is_hazmat' },
//     'Total Hours':   { from: 'totals.total' },
//     'Completed':     { from: 'record.is_hazmat', as: 'checkbox' },
//     'Class Type':    { from: 'record.category', as: 'dropdown' },
//     'Generated':     { from: 'literal:Station copy' },
//   }
//
// WHY DATA AND NOT A FUNCTION. A definition is written by an officer in an admin screen and stored in Firestore; turning
// it into `eval` would make every definition arbitrary code with the reader's rights. A dot-path into a context object
// cannot do anything except name a value that is already there, so a definition can be edited freely and still be safe.
//
// `from` resolves against a CONTEXT the caller assembles (`{ member, record, station, range, totals, rows, today }`), and
// a path that is not there reads as empty rather than throwing - a half-filled definition produces a blank field, not a
// broken screen, which is what an officer mid-edit needs.
//
// The resolver is pure and does no PDF work, so it is asserted on its own (scripts/verify-forms.mjs) without a document.
// utils/formFill is what puts these values onto a template.

const text = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return String(value);
};

// The TRUE parser the rest of the app uses for sheet columns (see utils/training, functions/reporting). A checkbox on a
// form is fed the same way a training's flag is, so "TRUE", "true", "yes" and 1 all tick it.
const isTruthy = (value) => value === true || /^(true|yes|1)$/i.test(text(value).trim());

// One `from` expression. `literal:<rest>` is the escape hatch for a constant printed on the sheet; everything else is a
// dot-path into the context. A missing segment is `undefined`, never an error.
export const readFrom = (context, expression) => {
  const expressionText = text(expression).trim();
  if (!expressionText) return undefined;
  if (expressionText.startsWith('literal:')) return expressionText.slice('literal:'.length);
  return expressionText.split('.').reduce((current, key) => {
    if (current === undefined || current === null) return undefined;
    return current[key];
  }, context);
};

// The whole map, in the shapes the filler applies. `as` decides the target field type; `value` is already coerced to the
// final form (a boolean for a checkbox, a string for everything else) so the filler does no interpretation of its own.
//
// THE ORDER IS PRESERVED from the definition, so a form fills the way it was described - which matters only for a
// definition that reads its own footer before its header, but costs nothing to keep.
export const resolveFormValues = (fields, context = {}) => {
  const resolved = {};
  Object.entries(fields && typeof fields === 'object' ? fields : {}).forEach(([name, raw]) => {
    const spec = raw && typeof raw === 'object' ? raw : { from: raw };
    const as = text(spec.as).trim() || 'text';
    const value = readFrom(context, spec.from);
    const fallback = spec.fallback === undefined ? '' : text(spec.fallback);
    const present = as === 'checkbox' ? value !== undefined && value !== null : text(value).trim() !== '';
    resolved[name] = {
      name,
      as,
      // A checkbox is a boolean; the others are the string the PDF field holds. An empty value falls back only when the
      // definition asked for one, so a blank field stays blank unless the author said otherwise.
      value: as === 'checkbox' ? isTruthy(value) : text(present ? value : fallback),
    };
  });
  return resolved;
};
