// The one call a screen makes: a definition + the app's data + where blanks come from -> the bytes of a filled PDF.
//
// It is a thin join on purpose, and every piece it joins is separately testable:
//
//   definition  -> utils/formDefinition  (what the form IS, validated)
//   data        -> the source kind       (how the station's rows become a context)
//   context     -> utils/formValues      (which value goes in which field)
//   blank       -> loadTemplate          (BYTES, so the source is a decision the caller makes)
//   values      -> utils/formFill        (pdf-lib, flattened)
//
// `loadTemplate` IS A FUNCTION, NOT A PATH, and that is the seam that makes the whole thing PDF-independent: the app
// passes a loader that fetches a bundled file (utils/formCatalog.loadBundledBlank), a harness passes one that returns a
// fixture it built in memory, and a future Storage-backed loader slots in without touching this file. Nothing here knows
// what a PDF is beyond "bytes in, bytes out".
import { resolveFormValues } from './formValues.js';
import { normalizeFormDefinition, sourceFor } from './formDefinition.js';
import { fillPdfForm } from './formFill.js';

// The context a definition's `from` paths read, from the raw data a screen gathered. Split out so a config screen can
// PREVIEW a mapping against real values without filling anything.
export const buildFormContext = ({ source, data = {} } = {}) => {
  const kind = sourceFor(source);
  if (!kind) throw new Error(`"${source}" is not a data source this app knows.`);
  // A source names what it needs, so a caller missing half of it hears which half - rather than a sheet of blank fields
  // that looks like the form "not working". Presence is checked, not emptiness: an empty list of signatures is a member
  // with no training, which is a real answer.
  const missing = (kind.needs || []).filter((key) => data[key] === undefined);
  if (missing.length) throw new Error(`This form needs ${missing.join(', ')}.`);
  return kind.contextFor(data);
};

export const generateForm = async ({ definition, data, loadTemplate, flatten = true } = {}) => {
  if (typeof loadTemplate !== 'function') throw new Error('generateForm needs a function that loads the blank PDF.');
  const normalized = normalizeFormDefinition(definition);
  const context = buildFormContext({ source: normalized.source, data });
  const values = resolveFormValues(normalized.fields, context);
  const bytes = await loadTemplate(normalized.template.id);
  // `{ bytes, applied, problems }`, straight from the filler: a field the blank does not have comes back in `problems`
  // beside a document that is otherwise complete, rather than losing the officer the whole sheet.
  return fillPdfForm({ templateBytes: bytes, values, flatten });
};
