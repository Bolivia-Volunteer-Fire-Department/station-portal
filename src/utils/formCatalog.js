// The blank PDFs this app can fill, by id.
//
// A BLANK IS A FILE IN THE REPO (`public/forms/`), not something uploaded, and that is a decision rather than a
// convenience: the site is public and the blanks are public state forms, so bundling costs nothing, needs no Storage
// bucket, and makes generation work OFFLINE - a station's coverage is patchy and filling a sheet is exactly the thing an
// officer does with no signal. If a blank ever stops being public, or has to change without a deploy, `loadTemplate` is
// injected (see utils/generateForm) and a Storage-backed loader takes this one's place without touching the engine.
//
// ADDING A BLANK is two steps: drop the PDF in `public/forms/`, and add a row here. Nothing discovers the folder at
// runtime - a bundler cannot list files it has already hashed - so this list is the registry, and it is deliberately a
// plain array so a harness can pass its own.
//
// THERE ARE NONE YET, and that is the expected state: the engine was built before the forms were. The list is empty
// rather than filled with a placeholder, so an empty registry reads as "no blanks registered", which is true, instead of
// a fake form somebody would have to remember to delete.
export const FORM_BLANKS = [
  // The stand-in, built by `npm run make:form-sample` so the whole feature can be seen working before the station's real
  // state form exists. Replace it by dropping the real PDF into public/forms/ and pointing this row at it.
  { id: 'member-training-record', label: 'Member Training Record (sample)', path: 'forms/member-training-record.pdf' },
];

// The blank with this id, or null. `blanks` is injectable so a harness (or a future Storage-backed registry) can supply
// its own without this module knowing.
export const findFormBlank = (id, blanks = FORM_BLANKS) => {
  const wanted = String(id || '').trim();
  if (!wanted) return null;
  return (Array.isArray(blanks) ? blanks : []).find((blank) => String(blank.id) === wanted) || null;
};

// Fetch a bundled blank's bytes. `baseUrl` is the app's own base path (the site is served from a subdirectory on Pages),
// and both it and `fetchImpl` are arguments so this module stays free of `import.meta.env` and runs under plain Node.
//
// An unknown id and a failed fetch are DIFFERENT failures and say so: a missing registry entry is a configuration
// mistake ("that blank is not registered"), while a 404 is a packaging one ("the file is not where the registry says").
export const loadBundledBlank = async (id, { baseUrl = '', blanks = FORM_BLANKS, fetchImpl = fetch } = {}) => {
  const blank = findFormBlank(id, blanks);
  if (!blank) throw new Error(`No blank PDF is registered with the id "${id}".`);
  const response = await fetchImpl(`${baseUrl}${blank.path}`);
  if (!response || response.ok === false) {
    throw new Error(`Could not load the blank "${blank.path}" (${(response && response.status) || 'no response'}).`);
  }
  return new Uint8Array(await response.arrayBuffer());
};
