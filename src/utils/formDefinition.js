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

export const FORM_TYPES = ['generated', 'entered'];

export const ENTERED_FIELD_KINDS = [
  'text',
  'textarea',
  'tel',
  'number',
  'date',
  'time',
  'select',
  'multiselect',
  'checkbox',
  'radio',
  'file',
  'signature',
  'signature_stamp',
  'divider',
  'markdown',
];

export const isNonDataField = (fieldType) => ['markdown', 'divider'].includes(fieldType);

export const formatPhoneNumber = (val) => {
  if (!val) return '';
  const str = String(val);
  const extMatch = str.match(/(?:x|ext|#|\*)\s*(\d*)/i);
  const hasExtTrigger = Boolean(extMatch);
  let ext = extMatch ? extMatch[1] : '';

  const baseStr = extMatch ? str.slice(0, extMatch.index) : str;
  const digits = baseStr.replace(/\D/g, '');

  let mainDigits = digits;
  if (!ext && digits.length > 10) {
    mainDigits = digits.slice(0, 10);
    ext = digits.slice(10);
  } else if (digits.length > 10) {
    mainDigits = digits.slice(0, 10);
  }

  let formatted = '';
  if (mainDigits.length === 0) {
    formatted = '';
  } else if (mainDigits.length <= 3) {
    formatted = `(${mainDigits}`;
  } else if (mainDigits.length <= 6) {
    formatted = `(${mainDigits.slice(0, 3)}) ${mainDigits.slice(3)}`;
  } else {
    formatted = `(${mainDigits.slice(0, 3)}) ${mainDigits.slice(3, 6)}-${mainDigits.slice(6, 10)}`;
  }

  if (hasExtTrigger || ext) {
    formatted += ` x${ext || ''}`;
  }
  return formatted;
};

export const sanitizeDataName = (raw) =>
  String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);

export const normalizeEnteredFieldItem = (item = {}, index = 0) => {
  const id = text(item.id) || `field_${Date.now()}_${index}`;
  let rawType = text(item.field_type || item.type).toLowerCase();
  if (rawType === 'multi_select') rawType = 'multiselect';
  if (rawType === 'file_upload' || rawType === 'upload') rawType = 'file';
  const fieldType = ENTERED_FIELD_KINDS.includes(rawType) ? rawType : 'text';
  const isNonData = isNonDataField(fieldType);
  const isMarkdown = fieldType === 'markdown';
  const isDivider = fieldType === 'divider';
  const isMultiSelect = fieldType === 'multiselect';

  let dataName = sanitizeDataName(item.data_name || item.name || '');
  if (!isNonData && !dataName) {
    dataName = `field_${index + 1}`;
  }

  const caption = text(item.caption || item.label);
  if (!isNonData && !caption) {
    throw new Error(`Field #${index + 1} needs a caption/label.`);
  }

  const rawSpan = Number.parseInt(item.col_span ?? item.colSpan ?? 3, 10);
  const colSpan = Number.isFinite(rawSpan) && rawSpan >= 1 && rawSpan <= 3 ? rawSpan : 3;

  const rawOptions = Array.isArray(item.options)
    ? item.options
    : typeof item.options === 'string'
    ? item.options.split('\n')
    : [];
  const options = rawOptions.map((opt) => String(opt ?? '').trim()).filter(Boolean);

  const validation = {};
  if (item.validation && typeof item.validation === 'object') {
    if (Number.isFinite(item.validation.min)) validation.min = Number(item.validation.min);
    if (Number.isFinite(item.validation.max)) validation.max = Number(item.validation.max);
    if (text(item.validation.pattern)) validation.pattern = text(item.validation.pattern);
    if (text(item.validation.custom_hint)) validation.custom_hint = text(item.validation.custom_hint);
  }

  let defaultValue = '';
  if (!isNonData) {
    if (isMultiSelect) {
      defaultValue = Array.isArray(item.default_value)
        ? item.default_value
        : item.default_value
        ? [item.default_value]
        : [];
    } else {
      defaultValue = item.default_value !== undefined ? item.default_value : '';
    }
  }

  const isSignature = ['signature', 'signature_stamp'].includes(fieldType);
  const modifiable = isNonData || isSignature ? true : (item.modifiable !== undefined ? Boolean(item.modifiable) : true);
  if (!isNonData && !isSignature && !modifiable) {
    const hasDefault = isMultiSelect
      ? (Array.isArray(defaultValue) && defaultValue.length > 0)
      : defaultValue !== undefined && defaultValue !== null && String(defaultValue).trim() !== '';
    if (!hasDefault) {
      throw new Error(`Field "${caption || index + 1}" is not modifiable and must have a default value.`);
    }
  }

  return {
    id,
    data_name: isNonData ? '' : dataName,
    caption: isMarkdown ? 'Instructions' : isDivider ? (caption || 'Divider') : caption,
    field_type: fieldType,
    col_span: colSpan,
    required: isNonData ? false : Boolean(item.required),
    modifiable,
    default_value: defaultValue,
    placeholder: text(item.placeholder),
    instructions: isMarkdown ? '' : text(item.instructions || item.help_text || item.instruction_text),
    options,
    validation,
    markdown_content: isMarkdown ? String(item.markdown_content || item.content || '') : '',
  };
};

// Normalizes signature values from either raw data URL strings or objects with timestamp metadata
export const parseSignatureValue = (value) => {
  if (!value) return { image: '', signed_at: null, readable_time: '' };
  if (typeof value === 'string') {
    return { image: value, signed_at: null, readable_time: '' };
  }
  if (typeof value === 'object') {
    const image = value.image || value.dataUrl || '';
    const signed_at = value.signed_at || value.timestamp || null;
    let readable_time = value.readable_time || '';
    if (!readable_time && signed_at) {
      try {
        readable_time = new Date(signed_at).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
      } catch {
        readable_time = '';
      }
    }
    return { image, signed_at, readable_time };
  }
  return { image: '', signed_at: null, readable_time: '' };
};

export const validateFormSubmission = (layout = [], answers = {}) => {
  const errors = {};
  const data = {};
  const items = Array.isArray(layout) ? layout : Array.isArray(layout?.layout) ? layout.layout : [];

  items.forEach((item, index) => {
    if (isNonDataField(item.field_type)) return;
    const name = item.data_name || `field_${index + 1}`;
    const value = answers[name];

    if (item.required) {
      const isEmpty =
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value.trim() === '') ||
        (item.field_type === 'checkbox' && value !== true) ||
        (item.field_type === 'signature' &&
          (typeof value === 'object'
            ? !value?.image && !value?.dataUrl
            : typeof value === 'string'
            ? value.trim() === ''
            : !value)) ||
        (item.field_type === 'signature_stamp' &&
          (!value || typeof value !== 'object' || (!value.stamped && !value.signed))) ||
        (item.field_type === 'file' &&
          (Array.isArray(value)
            ? value.length === 0
            : typeof value === 'object'
            ? !value?.fileId && !value?.name && !value?.dataUrl && !value?.downloadUrl
            : typeof value === 'string'
            ? value.trim() === ''
            : !value)) ||
        (Array.isArray(value) && value.length === 0);
      if (isEmpty) {
        errors[name] = `${item.caption || name} is required.`;
        return;
      }
    }

    if (value !== undefined && value !== null && value !== '') {
      if (item.field_type === 'number') {
        const num = Number(value);
        if (!Number.isFinite(num)) {
          errors[name] = `${item.caption} must be a valid number.`;
        } else {
          if (item.validation?.min !== undefined && num < item.validation.min) {
            errors[name] = `${item.caption} must be at least ${item.validation.min}.`;
          }
          if (item.validation?.max !== undefined && num > item.validation.max) {
            errors[name] = `${item.caption} must be at most ${item.validation.max}.`;
          }
        }
      }

      if (item.validation?.pattern && typeof value === 'string') {
        try {
          const regex = new RegExp(item.validation.pattern);
          if (!regex.test(value)) {
            errors[name] = item.validation.custom_hint || `${item.caption} is not in the required format.`;
          }
        } catch {
          // ignore invalid pattern regex
        }
      }
    }

    data[name] = value ?? (item.field_type === 'multiselect' || item.field_type === 'file' ? [] : '');
  });

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    data,
  };
};

// Validate and normalise a definition, throwing on the first problem with a message that names it - the same contract
// report definitions have, so an admin screen shows `error.message` unchanged.
export const normalizeFormDefinition = (input = {}) => {
  const name = text(input.name);
  const description = text(input.description);
  const formType = text(input.form_type).toLowerCase() === 'entered' ? 'entered' : 'generated';

  if (name.length < 2 || name.length > 80) throw new Error('A form name is 2 to 80 characters.');
  if (description.length > 300) throw new Error('A form description is 300 characters or fewer.');

  const audienceAll = input.audience_all === true;
  const audienceRoleIds = audienceAll ? [] : [...new Set((input.audience_role_ids || []).map((id) => String(id)))];
  const audienceRankIds = audienceAll ? [] : [...new Set((input.audience_rank_ids || []).map((id) => String(id)))];
  const audienceKeys = formAudienceKeys({ all: audienceAll, roleIds: audienceRoleIds, rankIds: audienceRankIds });
  if (!audienceKeys.length) throw new Error('Choose who may generate this form.');

  if (formType === 'entered') {
    const rawLayout = Array.isArray(input.layout) ? input.layout : [];
    if (!rawLayout.length) throw new Error('An entered form needs at least one field or instruction.');

    const layout = rawLayout.map((item, idx) => normalizeEnteredFieldItem(item, idx));
    const fieldsSchema = {};
    layout.forEach((item) => {
      if (item.data_name) fieldsSchema[item.data_name] = item;
    });

    return {
      name,
      description,
      form_type: 'entered',
      layout,
      fields_schema: fieldsSchema,
      fields: fieldsSchema, // satisfy rules checking fields.size() > 0 if required
      enabled: input.enabled !== false,
      allow_editing_after_submission: Boolean(input.allow_editing_after_submission),
      audience_all: audienceAll,
      audience_role_ids: audienceRoleIds,
      audience_rank_ids: audienceRankIds,
      audience_keys: audienceKeys,
    };
  }

  // Generated form
  const source = text(input.source);
  const templateId = text(input.template && input.template.id);
  const fields = input.fields && typeof input.fields === 'object' && !Array.isArray(input.fields) ? input.fields : null;

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

  return {
    name,
    description,
    form_type: 'generated',
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

