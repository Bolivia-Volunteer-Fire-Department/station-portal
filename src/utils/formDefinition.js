// What a form IS: which blank, which data, and which value goes where.
//
// Three pluggable parts, and keeping them apart is what makes this work for a VARIETY of PDFs rather than one:
//
//   1. THE BLANK   - a file, named by `template.id`, listed in utils/formCatalog.
//   2. THE SOURCE  - what data feeds it, named by `source` and described in SOURCE_KINDS below.
//   3. THE MAP     - which PDF field reads which value, `fields`.
//
// Add a blank and a source kind and a new kind of sheet exists with no change to the engine (utils/generateForm) or the
// filler (utils/formFill). The registry here is the list of ways the station's data can be shaped for a form; a new one
// is a small function, not a new pipeline.
//
// A DEFINITION IS DATA, WRITTEN BY AN OFFICER AND STORED. So this is where it is VALIDATED, once, with a message that
// names the field - the same shape functions/reporting.normalizeReportDefinition uses for report definitions, so an
// admin screen and the thing that stores it agree about what "valid" means.
import { summarizeTrainingByCategory } from './trainingSummary.js';

// The field types a value can target. `text` is the default; the rest must match the PDF field or the filler reports it
// (see utils/formFill's `problems` rather than throwing over a whole sheet).
export const FIELD_KINDS = ['text', 'checkbox', 'radio', 'dropdown', 'optionlist'];

// Every way the station's data can be shaped for a blank. `needs` names what the caller must hand over in `data`, and
// `contextFor` turns that data into the flat object a field map's `from` paths read (`member.name`, `totals.is_hazmat`).
//
// A SOURCE IS NOT A QUERY. It describes a shape; the screen that runs a form fetches the rows the shape needs (the
// subject's signatures, the training catalogue) and hands them in. That is what lets the same registry run offline and
// keeps the data-fetching decision out of a document definition.
export const SOURCE_KINDS = {
  training_summary: {
    key: 'training_summary',
    label: 'A member’s training, totalled by category',
    description: 'Every training the member has attended, with hours by category - what a state training record asks for.',
    needs: ['subject', 'trainings', 'signatures', 'categories'],
    contextFor(data = {}) {
      // A PERIOD, if the caller named one: a state training record is usually for a year, so the source says how to
      // narrow rather than leaving each screen to invent it. An UNDATED training is kept rather than dropped - a row
      // whose date nobody filled in is still a training somebody attended - and a signature whose training falls outside
      // the period simply finds no training below and is skipped.
      const range = data.range || {};
      const within = (training) => {
        if (!range.from && !range.to) return true;
        const key = String(training.date_key || '').slice(0, 10);
        if (!key) return true;
        if (range.from && key < range.from) return false;
        if (range.to && key > range.to) return false;
        return true;
      };
      const summary = summarizeTrainingByCategory({
        signatures: data.signatures,
        trainings: (Array.isArray(data.trainings) ? data.trainings : []).filter(within),
        categories: data.categories,
      });
      return {
        member: data.subject || {},
        station: data.station || {},
        range,
        today: data.today || '',
        // The per-category hours, as `totals.is_hazmat`, plus `rows` for a form that draws a table and `total` for the
        // one number that counts an hour once however many categories it fell into.
        totals: summary.totals,
        rows: summary.rows,
        total: summary.total,
        count: summary.count,
      };
    },
    // WHAT A FIELD MAP MAY READ, named for the config screen so an officer mapping a PDF is OFFERED the paths rather than
    // having to guess at them. It sits beside `contextFor` deliberately: these are the keys that function returns, and
    // scripts/verify-forms asserts every one of them resolves against a real context - so the list cannot drift away from
    // what the source actually provides, which is the failure this feature would otherwise invite.
    linkages({ categories = [] } = {}) {
      const pairs = Array.isArray(categories) ? categories : [];
      return [
        { group: 'The member', from: 'member.name', label: 'Full name' },
        { group: 'The member', from: 'member.rank_id', label: 'Rank id' },
        { group: 'The member', from: 'member.id', label: 'Member id' },
        { group: 'The station', from: 'station.name', label: 'Station name (this is the department)' },
        { group: 'The station', from: 'station.department_name', label: 'The same name, for a blank that asks for a department' },
        { group: 'The period', from: 'range.from', label: 'Start of the period' },
        { group: 'The period', from: 'range.to', label: 'End of the period' },
        { group: 'The period', from: 'today', label: 'Today’s date' },
        { group: 'The totals', from: 'total', label: 'Every hour, counted once' },
        { group: 'The totals', from: 'count', label: 'How many trainings are counted' },
        // One per category the station actually uses, so a category added later appears here without a code change.
        ...pairs.map(([flag, label]) => ({
          group: 'By category',
          from: `totals.${flag}`,
          label: `${label} hours`,
        })),
        { group: 'By category', from: 'totals.none', label: 'Hours that fall into no category' },
      ];
    },
  },
};

export const sourceFor = (key) => SOURCE_KINDS[String(key || '').trim()] || null;

// The values a source offers a field map, for the config screen to list. The options are the same ones `contextFor` is
// given, because a source can offer different paths depending on them - this one widens `totals.*` to the categories the
// station actually uses. Returns `[]` for an unknown source rather than throwing: the screen calls it as the officer is
// still typing the key.
export const sourceLinkages = (key, options) => {
  const source = sourceFor(key);
  return source && typeof source.linkages === 'function' ? source.linkages(options || {}) : [];
};

// The linkages grouped for display, in the order the source declared them - so the screen renders what it is handed and
// decides nothing about what belongs together.
export const groupLinkages = (linkages = []) => {
  const groups = [];
  (Array.isArray(linkages) ? linkages : []).forEach((linkage) => {
    const group = String(linkage.group || 'Values');
    const existing = groups.find((entry) => entry.group === group);
    if (existing) existing.values.push(linkage);
    else groups.push({ group, values: [linkage] });
  });
  return groups;
};

// The audience a definition is shared with, as the `audience_keys` the rules and readers compare against - the SAME shape
// functions/reporting.reportAudienceKeys builds, character for character, because a form is read the way a report is.
// scripts/verify-forms asserts the two agree; that pairing is why a third copy of the rule never appears.
export const formAudienceKeys = ({ all = false, roleIds = [], rankIds = [] } = {}) => {
  if (all === true) return ['*'];
  const clean = (values) =>
    [...new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? '').trim()).filter(Boolean))];
  return [...clean(roleIds).map((id) => `role:${id}`), ...clean(rankIds).map((id) => `rank:${id}`)];
};

const text = (value) => String(value ?? '').trim();

// Validate and normalise a definition, throwing on the first problem with a message that names it - the same contract
// report definitions have, so an admin screen shows `error.message` unchanged.
export const normalizeFormDefinition = (input = {}) => {
  const name = text(input.name);
  const description = text(input.description);
  const source = text(input.source);
  const templateId = text(input.template && input.template.id);
  const fields = input.fields && typeof input.fields === 'object' && !Array.isArray(input.fields) ? input.fields : null;

  if (name.length < 2 || name.length > 80) throw new Error('A form name is 2 to 80 characters.');
  if (description.length > 300) throw new Error('A form description is 300 characters or fewer.');
  if (!sourceFor(source)) throw new Error('Choose a data source for this form.');
  if (!templateId) throw new Error('Choose the blank PDF this form fills.');
  if (!fields || !Object.keys(fields).length) throw new Error('Map at least one PDF field to a value.');

  const mapped = {};
  Object.entries(fields).forEach(([fieldName, raw]) => {
    const spec = raw && typeof raw === 'object' ? raw : { from: raw };
    const from = text(spec.from);
    const as = text(spec.as) || 'text';
    if (!from) throw new Error(`"${fieldName}" has no value to fill it with.`);
    if (!FIELD_KINDS.includes(as)) throw new Error(`"${fieldName}" is mapped as "${as}", which is not a field type.`);
    mapped[fieldName] = { from, as, ...(spec.fallback === undefined ? {} : { fallback: String(spec.fallback) }) };
  });

  const audienceAll = input.audience_all === true;
  const audienceRoleIds = audienceAll ? [] : [...new Set((input.audience_role_ids || []).map((id) => String(id)))];
  const audienceRankIds = audienceAll ? [] : [...new Set((input.audience_rank_ids || []).map((id) => String(id)))];
  const audienceKeys = formAudienceKeys({ all: audienceAll, roleIds: audienceRoleIds, rankIds: audienceRankIds });
  if (!audienceKeys.length) throw new Error('Choose who may generate this form.');

  return {
    name,
    description,
    source,
    template: { id: templateId },
    fields: mapped,
    enabled: input.enabled !== false,
    audience_all: audienceAll,
    audience_role_ids: audienceRoleIds,
    audience_rank_ids: audienceRankIds,
    audience_keys: audienceKeys,
  };
};

