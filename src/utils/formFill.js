// Put a form's values onto a PDF template and hand back the bytes.
//
// THE LIBRARY IS LOADED ON DEMAND, and that is deliberate rather than tidy. pdf-lib is roughly a megabyte, and it is
// needed by exactly two screens - generating a form and configuring one - so a static import would put it in the main
// bundle and make every member who only clocks in pay for it. `await import('pdf-lib')` fetches it the first time a form
// is generated, and the module registry caches it from then on. Same reasoning as utils/deferredModules, one level down.
//
// THE WHOLE LIBRARY NEVER TOUCHES THE NETWORK OR A SERVER. The template is read once (a bundled file, or a Storage blob
// later), the values come from data the app already has, and the result is bytes the browser downloads or prints. So
// generating a form works offline, on a station laptop with no signal, which is the point.
//
// TWO ENTRY POINTS:
//   listFormFields  - what fields a template HAS, so the admin screen can offer them to be mapped. This is the trick that
//                     makes configuration painless: the officer never types a field name, they pick from the template's
//                     own list.
//   fillPdfForm     - the values (from utils/formValues) onto the template, optionally flattened, as bytes.
//
// IT REPORTS RATHER THAN THROWS, per field. A definition that names a field the template does not have, or sends a value
// a radio group does not offer, is a MAPPING MISTAKE an officer can fix - so it comes back in `problems` beside the
// document that was still produced, instead of aborting the whole generation. The one thing that can still throw is a
// save that the PDF engine itself refuses (see the font note below), because there is no document to return then.

// The field types pdf-lib models, in the order the mapper shows them. `instanceof` is how a PDFField's type is told -
// pdf-lib exposes no type string - so the classes are named here once rather than scattered through the branches.
const FIELD_TYPES = [
  ['PDFTextField', 'text'],
  ['PDFCheckBox', 'checkbox'],
  ['PDFRadioGroup', 'radio'],
  ['PDFDropdown', 'dropdown'],
  ['PDFOptionList', 'optionlist'],
  ['PDFButton', 'button'],
];

const typeNameOf = (field, lib) => {
  const match = FIELD_TYPES.find(([className]) => lib[className] && field instanceof lib[className]);
  return match ? match[1] : 'unknown';
};

// What a template offers: `[{ name, type }]`, in the order the document declares them. Read-only, and it loads nothing
// but the template.
export const listFormFields = async (templateBytes) => {
  const lib = await import('pdf-lib');
  const doc = await lib.PDFDocument.load(templateBytes, { ignoreEncryption: true });
  return doc.getForm().getFields().map((field) => ({ name: field.getName(), type: typeNameOf(field, lib) }));
};

// Apply `values` (the output of utils/formValues.resolveFormValues) to `templateBytes`.
//
// `flatten` bakes the values into the page and removes the interactive fields - what an auditor wants, because the sheet
// can no longer be edited after the fact. Left false for a preview that the reader could still fill by hand.
//
// Returns `{ bytes, applied, problems }`: the document to save, the field names that took, and the ones that did not with
// the reason. Every field is attempted, so one bad mapping does not hide the rest.
export const fillPdfForm = async ({ templateBytes, values = {}, flatten = true } = {}) => {
  const lib = await import('pdf-lib');
  const doc = await lib.PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const applied = [];
  const problems = [];

  Object.values(values).forEach((spec) => {
    const { name, as, value } = spec || {};
    if (!name) return;
    try {
      if (as === 'checkbox') {
        const box = form.getCheckBox(name);
        if (value) box.check();
        else box.uncheck();
      } else if (as === 'radio') {
        form.getRadioGroup(name).select(String(value));
      } else if (as === 'dropdown') {
        form.getDropdown(name).select(String(value));
      } else if (as === 'optionlist') {
        form.getOptionList(name).select(String(value));
      } else {
        form.getTextField(name).setText(String(value ?? ''));
      }
      applied.push(name);
    } catch (error) {
      problems.push({ name, message: (error && error.message) || String(error) });
    }
  });

  // Flatten before saving, so the appearance streams are generated for the values just set and then frozen with the page.
  if (flatten) {
    try {
      form.flatten();
    } catch (error) {
      problems.push({ name: '', message: `could not flatten the form: ${(error && error.message) || error}` });
    }
  }

  // This save can throw for one reason worth naming: pdf-lib's default appearance font is WinAnsi (Latin), so a value
  // with a character outside it - an accented or non-Latin name - has no glyph to draw with. The message says so rather
  // than surfacing "WinAnsi cannot encode ...", which reads as a library fault instead of "embed a font for this field".
  let bytes;
  try {
    bytes = await doc.save();
  } catch (error) {
    const message = (error && error.message) || String(error);
    throw new Error(
      /winansi|encode/i.test(message)
        ? `A value contains a character the form's default font cannot draw (${message}). Embed a Unicode font for that field.`
        : message
    );
  }

  return { bytes, applied, problems };
};
