const REPORT_VISUALIZATIONS = ['table', 'bar', 'pie', 'line'];
// WHAT A DATASET IS: a shape of rows, the groupings that can slice them, and the measures each row can contribute.
//
// THE DATASET IS CODE; THE REPORT IS CONFIG. That is the honest boundary, and it is the answer to "can we add reports
// without hard-coding them": adding a REPORT is configuration (Administration > Reports Configuration) and needs no
// deploy, while adding a DATASET is a new aggregator here, because a genuinely new kind of report asks a new question of
// the data and there is no honest way to express that as a checkbox.
//
// `reconciliation` is the second kind, and it is why this list grew a `measures` declaration: every earlier dataset
// contributed ONE number per group (`shifts`, or `hours`), so a report definition had nothing to choose. A
// reconciliation compares TWO - the hours somebody was scheduled for against the hours they were actually on station -
// and the difference between them, which is the number the officer is looking for.
const REPORT_DATASET_GROUPINGS = {
  schedule: ['assignment', 'member', 'day', 'month'],
  training: ['category', 'member', 'training', 'day', 'month'],
  reconciliation: ['member', 'day', 'month'],
};
// What each dataset can measure, for the config screen to offer and for the runner to validate against. The order is the
// order a report's columns read, and the FIRST one is what a chart plots.
const REPORT_DATASET_MEASURES = {
  schedule: ['shifts'],
  training: ['hours'],
  reconciliation: ['variance', 'scheduled_hours', 'clocked_hours', 'open_clock_entries'],
};
// Whether a dataset can be narrowed to particular ASSIGNMENTS. Only the reconciliation has any use for it: an officer
// ticks the paid assignments for a given run, which is how a station separates paid time from volunteering without a
// column saying which assignments are paid (see the note on `allow_assignments` in normalizeReportDefinition).
const REPORT_DATASETS_WITH_ASSIGNMENTS = ['reconciliation'];
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
    // Whether the runner may tick which ASSIGNMENTS count as paid for a reconciliation. A permission on the definition
    // rather than a column on the assignment, because "which of these are paid?" is a question about THIS comparison - a
    // station with one paid assignment would otherwise have to mark it and then live with that answer everywhere.
    allow_assignments: REPORT_DATASETS_WITH_ASSIGNMENTS.includes(dataset) && input.allow_assignments === true,
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

// "HH:MM" (or "H:MM AM/PM") as minutes from midnight, or null when there is no usable time.
//
// NULL IS NOT MIDNIGHT, and that is not a technicality: `Number('')` is 0 and `Number(null)` is 0, so reading these
// straight would turn "no end time" into "ends at midnight" - a wrong answer rather than a missing one, and one that
// would quietly cost a shift its hours. The client has the same rule in utils/shiftHours.
const minutesOfDay = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = String(match[3] || '').toUpperCase();
  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours > 24 || minutes > 59) return null;
  return hours * 60 + minutes;
};

// The hours a scheduled shift is worth: its TEMPLATE's times, or - for a one-off shift, which has no template - the times
// stored on the row itself. An end at or before the start runs past midnight rather than being an error, and equal times
// are a full day, which is what utils/shiftHours says on the client.
const shiftRowHours = (row, templateById) => {
  const template = templateById.get(String(row.schedule_template_id || '').trim()) || null;
  const start = minutesOfDay(template ? template.start_time : row.start_time);
  const end = minutesOfDay(template ? template.end_time : row.end_time);
  if (start === null || end === null) return 0;
  return (end <= start ? end + 1440 - start : end - start) / 60;
};

// How long a clock entry was: the SERVER'S COPY of the rule the member's own clock history uses
// (src/utils/clockLogs.js#clockLogHours) - `calc_hours` when it is a usable number, otherwise measured from the two
// timestamps, otherwise nothing.
//
// TWO COPIES EXIST ON PURPOSE, because the two sides need it for different jobs: the history adds up entries already in
// the browser, and a report is summed here without shipping a year of entries to the phone that asked. They are held
// together by scripts/verify-reporting, which runs BOTH over the same rows and fails on any drift - the same arrangement
// as the training summary's two reducers, and for the same reason.
//
// AN OPEN ENTRY (one with no clock-out) IS WORTH NOTHING HERE, which is what the member's own history says too. That
// understates somebody who is on station right now, so those entries are COUNTED alongside the hours rather than
// silently dropped - see `open_clock_entries`.
const clockEntryHours = (entry) => {
  const stored = parseFloat(entry?.calc_hours);
  if (Number.isFinite(stored)) return stored;
  const start = Date.parse(entry?.time_in ?? '');
  if (!Number.isFinite(start)) return null;
  const end = entry?.time_out ? Date.parse(entry.time_out) : NaN;
  if (!Number.isFinite(end) || end < start) return null;
  return (end - start) / 3600000;
};

const round2 = (value) => Math.round(value * 100) / 100;

// A RECONCILIATION: for each member, the hours they were SCHEDULED for against the hours they were actually CLOCKED IN
// for, and the difference between the two.
//
// THE TWO SIDES COME FROM DIFFERENT COLLECTIONS AND NOTHING JOINS THEM. A clock entry records that somebody was on
// station; it does not say which shift they were on, and no field on it could - the app never asks at clock-in. So this
// compares the two TOTALS for a member over the range, which is the question an officer actually has ("were they here as
// long as we said they would be?") rather than a pretended match of entries to shifts.
//
// THE ASSIGNMENT FILTER NARROWS ONE SIDE ONLY. `assignmentIds` decides which shifts count as SCHEDULED; clocked time is
// never filtered by it, because a clock entry carries no assignment. That asymmetry is the useful part rather than an
// oversight: it is how a volunteer's hours and a paid member's extra hours both show up beside the paid schedule that was
// supposed to cover them. An empty list means EVERY assignment counts - the default before an officer ticks anything.
const aggregateReconciliation = ({
  scheduleRows = [],
  clockRows = [],
  groupBy = 'member',
  users = [],
  templates = [],
  assignmentIds = [],
} = {}) => {
  const userNames = new Map(users.map((row) => [String(row.id), String(row.name || '').trim()]));
  const templateById = new Map(templates.map((row) => [String(row.id), row]));
  const wanted = new Set(
    (Array.isArray(assignmentIds) ? assignmentIds : []).map((id) => String(id ?? '').trim()).filter(Boolean)
  );

  const groups = new Map();
  const groupFor = (userId, dateKey) => {
    let key;
    let label;
    if (groupBy === 'member') {
      key = userId || 'unknown';
      label = key === 'unknown' ? 'Unassigned' : userNames.get(key) || 'Unnamed member';
    } else if (groupBy === 'month') {
      key = String(dateKey).slice(0, 7);
      label = key || 'Unknown month';
    } else {
      key = dateKey;
      label = dateKey || 'Unknown date';
    }
    if (!groups.has(key)) {
      groups.set(key, { key, label, scheduled_hours: 0, clocked_hours: 0, open_clock_entries: 0 });
    }
    return groups.get(key);
  };

  (Array.isArray(scheduleRows) ? scheduleRows : []).forEach((row) => {
    if (wanted.size && !wanted.has(String(row.assignment_id || '').trim())) return;
    const hours = shiftRowHours(row, templateById);
    if (!hours) return;
    const group = groupFor(String(row.user_id || '').trim(), String(row.date_from || '').slice(0, 10));
    group.scheduled_hours = round2(group.scheduled_hours + hours);
  });

  (Array.isArray(clockRows) ? clockRows : []).forEach((row) => {
    // The grouping date comes from the timestamp, read in STATION time by the same rule the training report uses for its
    // own timestamps - a clock entry stored as an instant must not land on the wrong day for the station reading it.
    const group = groupFor(String(row.user_id || '').trim(), trainingDateKey(row.time_in));
    const hours = clockEntryHours(row);
    if (hours === null) {
      group.open_clock_entries += 1;
      return;
    }
    group.clocked_hours = round2(group.clocked_hours + hours);
  });

  const rows = [...groups.values()].map((group) => {
    const variance = round2(group.clocked_hours - group.scheduled_hours);
    return {
      key: group.key,
      label: group.label,
      // `value` is what a chart plots, and for a reconciliation that is the VARIANCE: the difference is the finding, and
      // the two totals are the detail behind it in `values`.
      value: variance,
      values: {
        variance,
        scheduled_hours: group.scheduled_hours,
        clocked_hours: group.clocked_hours,
        open_clock_entries: group.open_clock_entries,
      },
    };
  });

  if (groupBy === 'day' || groupBy === 'month') return rows.sort((a, b) => a.key.localeCompare(b.key));
  // Worst differences first, either direction: an officer reconciling is looking for the rows that do not match.
  return rows.sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.label.localeCompare(b.label));
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
    // The ticked assignments, only for a dataset that compares scheduled time against something, and only when the
    // definition opened it up. EMPTY MEANS EVERY ASSIGNMENT - see aggregateReconciliation.
    assignmentIds:
      report.allow_assignments === true && REPORT_DATASETS_WITH_ASSIGNMENTS.includes(dataset)
        ? cleanIds(request.assignment_ids).slice(0, 200)
        : [],
  };
};

module.exports = {
  REPORT_RANGE_PRESETS,
  TRAINING_CATEGORY_FLAGS: TRAINING_CATEGORIES.map(([flag]) => flag),
  resolveReportOptions,
  REPORT_DATASET_GROUPINGS,
  REPORT_DATASET_MEASURES,
  REPORT_DATASETS_WITH_ASSIGNMENTS,
  REPORT_DATASETS,
  REPORT_GROUPINGS,
  aggregateReconciliation,
  aggregateTrainingRows,
  trainingDateKey,
  REPORT_SCOPES,
  REPORT_VISUALIZATIONS,
  aggregateScheduleRows,
  clockEntryHours,
  minutesOfDay,
  shiftRowHours,
  canUseReport,
  normalizeReportDefinition,
  reportAudienceKeys,
};