const REPORT_VISUALIZATIONS = ['table', 'bar', 'pie', 'line'];
const REPORT_DATASET_GROUPINGS = {
  schedule: ['assignment', 'member', 'day', 'month'],
  training: ['category', 'member', 'training', 'day', 'month'],
};
const REPORT_DATASETS = Object.keys(REPORT_DATASET_GROUPINGS);
const REPORT_GROUPINGS = [...new Set(Object.values(REPORT_DATASET_GROUPINGS).flat())];
const REPORT_SCOPES = ['mine', 'station'];
const REPORT_RANGE_PRESETS = ['this_month', 'last_month', 'last_30_days', 'this_year', 'last_year'];

const cleanIds = (values) =>
  [...new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? '').trim()).filter(Boolean))];

const reportAudienceKeys = ({ roleIds = [], rankIds = [], everyone = false } = {}) => {
  if (everyone === true) return ['*'];
  return [
    ...cleanIds(roleIds).map((id) => `role:${id}`),
    ...cleanIds(rankIds).map((id) => `rank:${id}`),
  ];
};

const canUseReport = (report, roleId, rankId) => {
  const keys = new Set(report?.audience_keys || []);
  return keys.has('*') || keys.has(`role:${String(roleId || '').trim()}`) || keys.has(`rank:${String(rankId || '').trim()}`);
};

const normalizeReportDefinition = (input = {}) => {
  const name = String(input.name || '').trim();
  const description = String(input.description || '').trim();
  const visualization = String(input.visualization || 'table');
  const dataset = String(input.dataset || 'schedule');
  const groupBy = String(input.group_by || REPORT_DATASET_GROUPINGS[dataset]?.[0] || '');
  const scope = String(input.scope || 'station');
  const audienceRoleIds = cleanIds(input.audience_role_ids);
  const audienceRankIds = cleanIds(input.audience_rank_ids);
  const audienceAll = input.audience_all === true;
  const audienceKeys = reportAudienceKeys({ roleIds: audienceRoleIds, rankIds: audienceRankIds, everyone: audienceAll });

  if (name.length < 2 || name.length > 80) throw new Error('Report name must be 2-80 characters.');
  if (description.length > 300) throw new Error('Report description must be 300 characters or fewer.');
  if (!REPORT_DATASETS.includes(dataset)) throw new Error('That report dataset is not available.');
  if (!REPORT_VISUALIZATIONS.includes(visualization)) throw new Error('Choose a supported report visualization.');
  if (!REPORT_DATASET_GROUPINGS[dataset].includes(groupBy)) throw new Error('Choose a supported report grouping.');
  if (!REPORT_SCOPES.includes(scope)) throw new Error('Choose a supported report scope.');
  if (!audienceKeys.length) throw new Error('Choose at least one role or rank for this report.');

  const defaultRange = String(input.default_range || 'this_month');
  if (!REPORT_RANGE_PRESETS.includes(defaultRange)) throw new Error('Choose a supported default date range.');

  return {
    name,
    description,
    dataset,
    visualization,
    group_by: groupBy,
    scope,
    default_range: defaultRange,
    allow_range: input.allow_range !== false,
    allow_group_by: input.allow_group_by === true,
    allow_visualization: input.allow_visualization === true,
    allow_category: dataset === 'training' && input.allow_category === true,
    allow_members: scope === 'station' && input.allow_members === true,
    enabled: input.enabled !== false,
    audience_all: audienceAll,
    audience_role_ids: audienceAll ? [] : audienceRoleIds,
    audience_rank_ids: audienceAll ? [] : audienceRankIds,
    audience_keys: audienceKeys,
  };
};

const aggregateScheduleRows = (rows, { groupBy = 'assignment', assignments = [], users = [] } = {}) => {
  const assignmentNames = new Map(assignments.map((row) => [String(row.id), String(row.description || '').trim()]));
  const userNames = new Map(users.map((row) => [String(row.id), String(row.name || '').trim()]));
  const groups = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const date = String(row.date_from || '').slice(0, 10);
    let key;
    let label;
    if (groupBy === 'member') {
      key = String(row.user_id || '').trim() || 'open';
      label = key === 'open' ? 'Open shifts' : userNames.get(key) || 'Unnamed member';
    } else if (groupBy === 'day') {
      key = date;
      label = date || 'Unknown date';
    } else if (groupBy === 'month') {
      key = date.slice(0, 7);
      label = key || 'Unknown month';
    } else {
      key = String(row.assignment_id || '').trim() || 'unknown';
      label = assignmentNames.get(key) || 'Unknown assignment';
    }

    const current = groups.get(key) || { key, label, value: 0 };
    current.value += 1;
    groups.set(key, current);
  });

  const result = [...groups.values()];
  if (groupBy === 'day' || groupBy === 'month') {
    return result.sort((a, b) => a.key.localeCompare(b.key));
  }
  return result.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
};

// Category flags on a training, in the order the Training form lists them (src/utils/training.js TRAINING_FLAGS).
const TRAINING_CATEGORIES = [
  ['is_company_training', 'Company Training'],
  ['is_hazmat', 'Hazmat'],
  ['is_ems', 'EMS'],
  ['is_fire_prevention', 'Fire prevention'],
  ['is_multicompany', 'Multi-company'],
  ['is_training_facility', 'Training Facility'],
  ['is_officer_training', 'Officer training'],
  ['is_driver_training', 'Driver training'],
];

const isTruthyFlag = (value) => value === true || /^(true|yes|1)$/i.test(String(value ?? '').trim());

// Trainings keep their date as sheet text, so the same formats the client accepts are read here.
const trainingDateKey = (value) => {
  const text = String(value ?? '').trim();
  const pad = (part) => String(part).padStart(2, '0');
  let match = /^(\d{4})-(\d{2})-(\d{2})T/.exec(text);
  if (match) {
    const instant = new Date(text);
    if (Number.isNaN(instant.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(instant);
    const get = (type) => parts.find((part) => part.type === type)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
  if (match) return `${match[3]}-${pad(match[1])}-${pad(match[2])}`;
  match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  return match ? `${match[1]}-${pad(match[2])}-${pad(match[3])}` : '';
};

// Each signature is one member's attendance, worth the training's duration in hours. A training with several
// category flags counts in each of them, so category totals can exceed the overall total.
const aggregateTrainingRows = (signatures, { groupBy = 'category', trainings = [], users = [] } = {}) => {
  const trainingById = new Map(trainings.map((row) => [String(row.id), row]));
  const userNames = new Map(users.map((row) => [String(row.id), String(row.name || '').trim()]));
  const groups = new Map();
  const add = (key, label, hours) => {
    const current = groups.get(key) || { key, label, value: 0 };
    current.value = Math.round((current.value + hours) * 100) / 100;
    groups.set(key, current);
  };

  (Array.isArray(signatures) ? signatures : []).forEach((signature) => {
    const training = trainingById.get(String(signature.training_id));
    if (!training) return;
    const duration = Number(training.duration);
    const hours = Number.isFinite(duration) && duration > 0 ? duration : 0;
    const date = String(training.date_key || '') || trainingDateKey(training.date);
    if (groupBy === 'category') {
      const matched = TRAINING_CATEGORIES.filter(([flag]) => isTruthyFlag(training[flag]));
      if (!matched.length) add('none', 'No category', hours);
      matched.forEach(([flag, label]) => add(flag, label, hours));
    } else if (groupBy === 'member') {
      const key = String(signature.user_id || '').trim() || 'unknown';
      add(key, userNames.get(key) || 'Unnamed member', hours);
    } else if (groupBy === 'training') {
      add(String(training.id), String(training.title || '').trim() || 'Untitled training', hours);
    } else if (groupBy === 'month') {
      add(date.slice(0, 7), date.slice(0, 7) || 'Unknown month', hours);
    } else {
      add(date, date || 'Unknown date', hours);
    }
  });

  const result = [...groups.values()];
  if (groupBy === 'day' || groupBy === 'month') return result.sort((a, b) => a.key.localeCompare(b.key));
  return result.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
};

// What a viewer may change when running a report. Anything the definition does not open up falls back to the
// definition's own value, so a hand-built request cannot reach past what the author allowed.
const resolveReportOptions = (report, request = {}) => {
  const dataset = report.dataset || 'schedule';
  const groupings = REPORT_DATASET_GROUPINGS[dataset] || [];
  const asked = String(request.group_by || '');
  const askedVisual = String(request.visualization || '');
  const askedCategory = String(request.category || '');
  const categoryKeys = [...TRAINING_CATEGORIES.map(([flag]) => flag), 'none'];
  return {
    groupBy: report.allow_group_by === true && groupings.includes(asked) ? asked : report.group_by,
    visualization: report.allow_visualization === true && REPORT_VISUALIZATIONS.includes(askedVisual) ? askedVisual : report.visualization,
    category: report.allow_category === true && categoryKeys.includes(askedCategory) ? askedCategory : '',
    memberIds: report.allow_members === true && report.scope === 'station' ? cleanIds(request.member_ids).slice(0, 100) : [],
  };
};

module.exports = {
  REPORT_RANGE_PRESETS,
  TRAINING_CATEGORY_FLAGS: TRAINING_CATEGORIES.map(([flag]) => flag),
  resolveReportOptions,
  REPORT_DATASET_GROUPINGS,
  REPORT_DATASETS,
  REPORT_GROUPINGS,
  aggregateTrainingRows,
  trainingDateKey,
  REPORT_SCOPES,
  REPORT_VISUALIZATIONS,
  aggregateScheduleRows,
  canUseReport,
  normalizeReportDefinition,
  reportAudienceKeys,
};