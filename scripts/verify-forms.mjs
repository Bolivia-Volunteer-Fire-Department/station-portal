/**
 * Verifies the PDF-form engine: the training summary a form is filled from, the declarative field map, and the pdf-lib
 * fill itself.
 *
 * NO BINARY FIXTURE IS COMMITTED. The template is BUILT here, in memory, with pdf-lib - a small AcroForm that exercises
 * every field type a state sheet is likely to use (text, checkbox, radio, dropdown) - so the whole pipeline is proven
 * WITHOUT the station's real form, and this harness cannot rot the day that form is replaced. When the real PDF arrives
 * it is a template and a field map, not a rewrite.
 *
 * Plain Node, not a Vite build: none of the modules under test imports anything but pdf-lib (and this file imports the
 * server's reducer for the parity check), so Node resolves them directly - the same shape scripts/verify-reporting.mjs
 * uses for the server-side aggregation.
 *
 * Run with: npm run verify:forms
 */
import { PDFDocument } from 'pdf-lib';
// The server's reducer, to pin the client one against it. CJS, so this is its default export (module.exports).
import reporting from '../functions/reporting.js';
import { summarizeTrainingByCategory, categoryPairsFrom } from '../src/utils/trainingSummary.js';
import { readFrom, resolveFormValues } from '../src/utils/formValues.js';
import { listFormFields, fillPdfForm } from '../src/utils/formFill.js';
import { normalizeFormDefinition, formAudienceKeys, groupLinkages, sourceFor, sourceLinkages } from '../src/utils/formDefinition.js';
import { generateForm, buildFormContext } from '../src/utils/generateForm.js';
import { findFormBlank, loadBundledBlank } from '../src/utils/formCatalog.js';
import { formPdfFileName } from '../src/utils/formExport.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};
const checkIs = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` -> ${detail}`}`);
};

// --- the training summary, PINNED AGAINST THE SERVER'S REDUCER ---------------------------------
//
// This is the whole reason two copies of the arithmetic are allowed to exist: they are run over the same rows here, and
// a drift between them fails the suite. The client copy is dependency-free so Node can load it; the server copy is the
// one the Reports module ships.
console.log('--- the training summary, against the server’s reducer ---');
const trainings = [
  { id: 't1', duration: '4', is_hazmat: 'TRUE' },
  { id: 't2', duration: 2, is_company_training: true, is_officer_training: 'yes' }, // two categories in one training
  { id: 't3', duration: '1.5' }, // uncategorised -> "No category"
  { id: 't4', duration: 'x', is_ems: '1' }, // a bad duration is zero hours, not NaN
  { id: 't5', duration: '3', is_ems: 'FALSE' }, // an explicit false is not a category
];
const signatures = [
  { training_id: 't1' },
  { training_id: 't2' },
  { training_id: 't3' },
  { training_id: 't4' },
  { training_id: 't5' },
  { training_id: 'missing' }, // a signature whose training is gone is skipped, not counted
];
const keyed = (rows) => Object.fromEntries(rows.map((row) => [row.key, row.value]));
const clientSummary = summarizeTrainingByCategory({
  signatures,
  trainings,
  categories: reporting.TRAINING_CATEGORY_FLAGS.map((flag) => [flag, flag]),
});
const serverSummary = reporting.aggregateTrainingRows(signatures, { groupBy: 'category', trainings });
check('the client and the server agree on every category total', keyed(clientSummary.rows), keyed(serverSummary));
check('the overall total counts each hour once', clientSummary.total, 4 + 2 + 1.5 + 0 + 3);
check('and nothing invented by the missing training', clientSummary.count, 5);
const rowsSum = clientSummary.rows.reduce((sum, row) => sum + row.value, 0);
check(
  'a training in two categories counts in both, so the rows add up to more than the total',
  rowsSum > clientSummary.total,
  true
);
check(
  'the app’s flag table becomes the pairs the reducer wants',
  categoryPairsFrom([
    { key: 'is_hazmat', label: 'Hazmat' },
    { key: 'is_entered_into_external', label: 'External', adminOnly: true },
  ]),
  [['is_hazmat', 'Hazmat']]
);

// --- the declarative field map -----------------------------------------------------------------
console.log('\n--- the field map ---');
const context = {
  member: { name: 'Jane Smith' },
  station: { name: 'Station 1', department_name: 'Bolivia Fire Department' },
  range: { from: '2026-01-01', to: '2026-12-31', year: '2026' },
  record: { is_hazmat: true, level: '2' },
  totals: { is_hazmat: 12.5, is_ems: 4, total: 16.5 },
  today: '2026-10-06',
};
check('a dot-path reads through the context', readFrom(context, 'member.name'), 'Jane Smith');
check('a path that is not there reads as empty rather than throwing', readFrom(context, 'member.middle'), undefined);
check('a literal is passed straight through', readFrom(context, 'literal:Not applicable'), 'Not applicable');
checkIs('an empty expression reads as nothing', readFrom(context, '') === undefined);

const fields = {
  'Member Name': { from: 'member.name' },
  'Reporting Year': { from: 'range.year' },
  'Hazmat Hours': { from: 'totals.is_hazmat' },
  'EMS Hours': { from: 'totals.is_ems' },
  'Total Hours': { from: 'totals.total' },
  Completed: { from: 'record.is_hazmat', as: 'checkbox' },
  Level: { from: 'record.level', as: 'radio' },
  Station: { from: 'station.name', as: 'dropdown' },
};
const resolved = resolveFormValues(fields, context);
check('a text field is a string', resolved['Member Name'].value, 'Jane Smith');
check('a number becomes the string a PDF field holds', resolved['Hazmat Hours'].value, '12.5');
check('a checkbox is a real boolean', resolved.Completed.value, true);
check('the target type is kept for the filler', resolved.Level.as, 'radio');
check(
  'a fallback is used only when the value is blank',
  resolveFormValues({ X: { from: 'member.middle', fallback: '—' } }, context).X.value,
  '—'
);
check('and a blank value with no fallback stays blank', resolveFormValues({ X: { from: 'member.middle' } }, context).X.value, '');

// --- the fill -----------------------------------------------------------------------------------
console.log('\n--- the fill, against a template built here ---');
// A template with one of each field type. Built, not committed: no binary in the repo, and the test proves the ENGINE
// rather than one form's layout.
const buildTemplate = async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([420, 560]);
  const form = doc.getForm();
  const text = (name, y) => form.createTextField(name).addToPage(page, { x: 20, y, width: 220, height: 18 });
  text('Member Name', 500);
  text('Reporting Year', 470);
  text('Hazmat Hours', 440);
  text('EMS Hours', 410);
  text('Total Hours', 380);
  form.createCheckBox('Completed').addToPage(page, { x: 20, y: 340, width: 16, height: 16 });
  const level = form.createRadioGroup('Level');
  level.addOptionToPage('1', page, { x: 20, y: 300, width: 16, height: 16 });
  level.addOptionToPage('2', page, { x: 60, y: 300, width: 16, height: 16 });
  const station = form.createDropdown('Station');
  station.addOptions(['Station 1', 'Station 2']);
  station.addToPage(page, { x: 20, y: 260, width: 180, height: 18 });
  return doc.save();
};

const template = await buildTemplate();
const listed = await listFormFields(template);
check(
  'the template lists its own fields',
  listed.map((field) => field.name).sort(),
  ['Member Name', 'Reporting Year', 'Hazmat Hours', 'EMS Hours', 'Total Hours', 'Completed', 'Level', 'Station'].sort()
);
const typeOf = (name) => (listed.find((field) => field.name === name) || {}).type;
check(
  'each field is named with its type',
  [typeOf('Member Name'), typeOf('Completed'), typeOf('Level'), typeOf('Station')],
  ['text', 'checkbox', 'radio', 'dropdown']
);

const filled = await fillPdfForm({ templateBytes: template, values: resolved, flatten: false });
check('every mapped field was applied', filled.applied.sort(), Object.keys(resolved).sort());
check('with nothing reported as a problem', filled.problems, []);
const outDoc = await PDFDocument.load(filled.bytes);
const outForm = outDoc.getForm();
check('the name landed on its field', outForm.getTextField('Member Name').getText(), 'Jane Smith');
check('a number landed as text', outForm.getTextField('Hazmat Hours').getText(), '12.5');
check('the checkbox was ticked', outForm.getCheckBox('Completed').isChecked(), true);
check('the radio option was selected', outForm.getRadioGroup('Level').getSelected(), '2');
check('the dropdown option was selected', outForm.getDropdown('Station').getSelected(), ['Station 1']);

const flat = await fillPdfForm({ templateBytes: template, values: resolved, flatten: true });
const flatDoc = await PDFDocument.load(flat.bytes);
check('flattening removes every interactive field', flatDoc.getForm().getFields().length, 0);
check('and the document survives', flatDoc.getPageCount(), 1);

// A mapping mistake is REPORTED, not thrown: the officer can fix it, and one bad field must not cost them the whole sheet.
const mismapped = await fillPdfForm({
  templateBytes: template,
  values: { 'No Such Field': { name: 'No Such Field', as: 'text', value: 'x' } },
  flatten: true,
});
check(
  'a field the template does not have is reported, not thrown',
  mismapped.problems.map((problem) => problem.name),
  ['No Such Field']
);
checkIs('and the rest of the document is still produced', mismapped.bytes.length > 0);
const badOption = await fillPdfForm({
  templateBytes: template,
  values: { Level: { name: 'Level', as: 'radio', value: '9' } },
  flatten: false,
});
check('a radio value the group does not offer is reported too', badOption.problems.map((problem) => problem.name), ['Level']);

// --- the catalogue ------------------------------------------------------------------------------
console.log('\n--- the blank catalogue ---');
const blanks = [{ id: 'x', label: 'X', path: 'forms/x.pdf' }];
check('an unknown blank id is null rather than a throw', findFormBlank('nope', blanks), null);
check('a known one is found', findFormBlank('x', blanks).path, 'forms/x.pdf');
const fakeFetch = async (url) => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(`bytes of ${url}`).buffer });
const fetched = await loadBundledBlank('x', { baseUrl: '/app/', blanks, fetchImpl: fakeFetch });
check('a bundled blank is fetched from the app’s own base path', new TextDecoder().decode(fetched), 'bytes of /app/forms/x.pdf');
const refusalOf = async (run) => {
  try {
    await run();
    return '';
  } catch (error) {
    return (error && error.message) || String(error);
  }
};
checkIs(
  'an unregistered blank names the id it could not find, rather than fetching nothing',
  /registered with the id "nope"/.test(await refusalOf(() => loadBundledBlank('nope', { blanks, fetchImpl: fakeFetch })))
);
checkIs(
  'and a file the registry names but the repo lacks says so too',
  /404/.test(await refusalOf(() => loadBundledBlank('x', { blanks, fetchImpl: async () => ({ ok: false, status: 404 }) })))
);

// --- the definition layer -----------------------------------------------------------------------
console.log('\n--- the definition ---');
const definitionInput = {
  name: 'State Training Record',
  description: 'Annual training summary',
  source: 'training_summary',
  template: { id: 'state-training' },
  fields: { 'Member Name': { from: 'member.name' }, Completed: { from: 'literal:TRUE', as: 'checkbox' } },
  audience_role_ids: ['r2', 'r2'],
  audience_rank_ids: ['k1'],
};
const normalized = normalizeFormDefinition(definitionInput);
check('a valid definition dedupes its audience into keys', normalized.audience_keys, ['role:r2', 'rank:k1']);
check('it keeps the field map, typed', normalized.fields['Member Name'], { from: 'member.name', as: 'text' });
check('and defaults to enabled', normalized.enabled, true);
// The keys match the server's report audience rule, so a form is read the way a report is.
check(
  'the audience keys are the server’s report audience keys',
  formAudienceKeys({ roleIds: ['r2', 'r2'], rankIds: ['k1'] }),
  reporting.reportAudienceKeys({ roleIds: ['r2', 'r2'], rankIds: ['k1'] })
);
check('the wildcard matches too', formAudienceKeys({ all: true }), reporting.reportAudienceKeys({ everyone: true }));

const refusal = (input) => {
  try {
    normalizeFormDefinition(input);
    return '';
  } catch (error) {
    return (error && error.message) || String(error);
  }
};
const base = { name: 'A form', source: 'training_summary', template: { id: 'x' }, fields: { F: { from: 'today' } }, audience_all: true };
checkIs('a name off the 2-80 range is refused', /2 to 80/.test(refusal({ ...base, name: 'x' })));
checkIs('an unknown source is refused', /data source/.test(refusal({ ...base, source: 'nope' })));
checkIs('a missing blank is refused', /blank PDF/.test(refusal({ ...base, template: { id: '' } })));
checkIs('an empty field map is refused', /Map at least one/.test(refusal({ ...base, fields: {} })));
checkIs('a field with no value is refused', /no value to fill/.test(refusal({ ...base, fields: { F: { from: '' } } })));
checkIs('an unknown field type is refused', /not a field type/.test(refusal({ ...base, fields: { F: { from: 'today', as: 'list' } } })));
checkIs('an audience naming nobody is refused', /who may generate/.test(refusal({ ...base, audience_all: false })));
checkIs('and a source names itself for the picker', !!sourceFor('training_summary').label);

// --- the source, and the whole call -------------------------------------------------------------
console.log('\n--- the source, then the whole call ---');
const formData = {
  subject: { name: 'Jane Smith' },
  station: { name: 'Station 1' },
  trainings,
  signatures,
  categories: reporting.TRAINING_CATEGORY_FLAGS.map((flag) => [flag, flag]),
};
const built = buildFormContext({ source: 'training_summary', data: formData });
check('the source shapes the totals a map reads', built.totals.is_hazmat, 4);
check('and carries the member through', built.member.name, 'Jane Smith');
checkIs(
  'a caller missing part of what a source needs hears which part',
  /signatures/.test(await refusalOf(() => buildFormContext({ source: 'training_summary', data: { subject: {} } })))
);

// The BLANK is injected: here it is the template built above, and in the app it is a bundled fetch. The engine cannot
// tell the difference, which is the point - and why this whole feature needed no real PDF.
const loadTemplate = async (id) => {
  if (id !== 'state-training') throw new Error(`unexpected blank ${id}`);
  return template;
};
const generated = await generateForm({
  definition: {
    ...definitionInput,
    fields: {
      'Member Name': { from: 'member.name' },
      'Hazmat Hours': { from: 'totals.is_hazmat' },
      'Total Hours': { from: 'total' },
      Completed: { from: 'literal:TRUE', as: 'checkbox' },
      Level: { from: 'literal:2', as: 'radio' },
      Station: { from: 'station.name', as: 'dropdown' },
    },
  },
  data: formData,
  loadTemplate,
  flatten: false,
});
check('the whole call leaves nothing unmapped', generated.problems, []);
const generatedForm = (await PDFDocument.load(generated.bytes)).getForm();
check('with the member’s name on it', generatedForm.getTextField('Member Name').getText(), 'Jane Smith');
check('their hazmat hours, straight from the summary', generatedForm.getTextField('Hazmat Hours').getText(), '4');
check('the total, counted once', generatedForm.getTextField('Total Hours').getText(), '10.5');
check('a ticked box', generatedForm.getCheckBox('Completed').isChecked(), true);
check('a chosen radio option', generatedForm.getRadioGroup('Level').getSelected(), '2');
check('and a chosen dropdown option', generatedForm.getDropdown('Station').getSelected(), ['Station 1']);
const flattened = await generateForm({
  definition: { ...definitionInput, fields: { 'Total Hours': { from: 'total' } } },
  data: formData,
  loadTemplate,
});
check('and a flattened generation has no interactive fields left', (await PDFDocument.load(flattened.bytes)).getForm().getFields().length, 0);

// --- the period, and the file name ---------------------------------------------------------------
console.log('\n--- a period narrows, and the file is named ---');
const ranged = buildFormContext({
  source: 'training_summary',
  data: {
    ...formData,
    range: { from: '2026-01-01', to: '2026-12-31' },
    trainings: [
      { id: 't1', duration: '4', is_hazmat: 'TRUE', date_key: '2026-03-01' },
      { id: 'old', duration: '9', is_ems: 'TRUE', date_key: '2020-01-01' },
      { id: 'undated', duration: '1', is_ems: 'TRUE' },
    ],
    signatures: [{ training_id: 't1' }, { training_id: 'old' }, { training_id: 'undated' }],
  },
});
check('an out-of-period training is left out', ranged.totals.is_hazmat, 4);
check('and the one inside it is still there', ranged.totals.is_ems, 1);
check('an UNDATED training is counted rather than silently dropped', ranged.count, 2);
check(
  'a form saves under which form, for whom, and when',
  formPdfFileName({ formName: 'State Training Record', subjectName: 'Jane Smith', today: '2026-10-06' }),
  'state-training-record-jane-smith-2026-10-06.pdf'
);
check('and a nameless one still saves as something', formPdfFileName({}), 'form.pdf');

// --- the linkages the config screen offers ------------------------------------------------------
//
// A screen that lists the values a source offers is only worth having if the list is TRUE, and the way this goes wrong is
// quiet: an officer points a field at a path the source never fills, the form still generates, and that box prints empty.
// So every path the source offers is READ against a real context here - one built so every category has hours AND
// something falls outside all of them, which is what makes each `totals.*` present. A path added to a source's `linkages`
// with no matching key in its `contextFor` fails this, and that is exactly what it is for.
console.log('\n--- the linkages the config screen offers ---');
const richCategories = reporting.TRAINING_CATEGORY_FLAGS.map((flag) => [flag, flag]);
const richTrainings = richCategories.map(([flag], index) => ({ id: `c${index}`, duration: '1', [flag]: 'TRUE' }));
richTrainings.push({ id: 'uncategorised', duration: '1' });
const richContext = buildFormContext({
  source: 'training_summary',
  data: {
    // The subject is a ROSTER row, which is what the run screen hands over - so `member.id` and `member.rank_id` are
    // real, and would fail this check if they were not.
    subject: { id: 'm1', name: 'Jane Smith', rank_id: 'r1' },
    station: { name: 'Bolivia Fire Department', department_name: 'Bolivia Fire Department' },
    categories: richCategories,
    trainings: richTrainings,
    signatures: richTrainings.map((training) => ({ training_id: training.id })),
    today: '2026-10-06',
    range: { from: '2026-01-01', to: '2026-12-31' },
  },
});
const offered = sourceLinkages('training_summary', { categories: richCategories });
checkIs('the source offers a list of paths', offered.length > 0);
check(
  'and every path it offers reads something from a real context',
  offered.filter((linkage) => readFrom(richContext, linkage.from) === undefined).map((linkage) => linkage.from),
  []
);
checkIs(
  'a category the station uses is offered as a total of its own',
  offered.some((linkage) => linkage.from === `totals.${richCategories[0][0]}`)
);
checkIs('and the hours in no category are offered as well', offered.some((linkage) => linkage.from === 'totals.none'));
checkIs(
  'a path that is not a path - a category nobody uses - is not offered',
  !offered.some((linkage) => linkage.from === 'totals.is_not_a_category')
);
check('an unknown source offers nothing rather than throwing', sourceLinkages('nope'), []);
check('and neither does a source named by nothing at all', sourceLinkages(''), []);
check(
  'the paths are grouped for the screen without losing any of them',
  groupLinkages(offered).reduce((sum, group) => sum + group.values.length, 0),
  offered.length
);
check(
  'and each group is named once, however the list is ordered',
  groupLinkages(offered).map((group) => group.group).length,
  new Set(groupLinkages(offered).map((group) => group.group)).size
);
checkIs('every path carries a label to show beside it', offered.every((linkage) => !!linkage.label));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

