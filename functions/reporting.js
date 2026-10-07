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
  schedule: ['assignment', 'template', 'member', 'day', 'month'],
  training: ['category', 'member', 'training', 'day', 'month'],
  reconciliation: ['member', 'template', 'day', 'month'],
};
// What each grouping is CALLED, in one place, because the config screen, the runner, the table's column headings and the
// server's own validation all name the same six things. A grouping added here appears as a choice everywhere.
const REPORT_GROUPING_LABELS = {
  assignment: 'Assignment',
  template: 'Shift Template',
  category: 'Category',
  member: 'Member',
  training: 'Training',
  day: 'Day',
  month: 'Month',
};

// THE LEVELS A REPORT GROUPS BY, ALWAYS A LIST.
//
// One grouping is a list of one. That is what makes "group by month, then by member" the same code path as "group by
// month" rather than a second kind of report: an aggregator reads the levels in order, and a report with one level is
// simply the case where there is nothing after the first.
//
// THE OLDER SHAPE IS STILL ACCEPTED - a definition saved before this was a list holds a bare string - so nothing already
// configured has to be rewritten.
const reportGroupingLevels = (groupBy, fallback = '') => {
  const asked = (Array.isArray(groupBy) ? groupBy : [groupBy])
    .map((level) => String(level ?? '').trim())
    .filter(Boolean);
  const unique = [...new Set(asked)];
  if (unique.length) return unique;
  return fallback ? [fallback] : [];
};

// The order a report asks for, normalised: only keys this report could sort on - its own grouping levels, plus the
// measure - one entry per key, each with a direction. Anything else is dropped rather than refused, because a stale key
// (a level the report no longer groups by) should not stop a report being SAVED.
const normalizeOrderBy = (orderBy, levels = []) => {
  const allowed = new Set([...levels, 'value']);
  const seen = new Set();
  return (Array.isArray(orderBy) ? orderBy : [])
    .map((entry) => (entry && typeof entry === 'object' ? entry : { key: entry }))
    .map((entry) => ({
      key: String(entry.key || '').trim(),
      direction: String(entry.direction || '').toLowerCase() === 'desc' ? 'desc' : 'asc',
    }))
    .filter((entry) => allowed.has(entry.key) && !seen.has(entry.key) && seen.add(entry.key))
    .slice(0, 4);
};

// The key a combination of levels is known by. A unit separator joins the parts because no grouping key can contain one,
// so two different combinations can never collide on the same joined string.
const GROUP_KEY_SEPARATOR = '\u001f';
const groupKeyOf = (parts) => parts.map((part) => String(part.key)).join(GROUP_KEY_SEPARATOR);

// The buckets a report's rows fall into, keyed by the combination of levels they matched.
//
// `parts` stays on the bucket because the ORDER depends on it - see sortByLevels - and `levels` is what a table draws as
// its leading columns.
const makeBuckets = () => {
  const buckets = new Map();
  return {
    buckets,
    forParts(parts) {
      const key = groupKeyOf(parts);
      if (!buckets.has(key)) {
        buckets.set(key, { key, parts, levels: parts.map((part) => part.label) });
      }
      return buckets.get(key);
    },
  };
};

// Rows in the order the grouping READS: by the first level, then the second, and so on. That is what "group by month,
// then by member" has to mean, and it is also what makes the table readable without any nested rows - a month's members
// sit together because the month sorts first.
//
// IT ORDERS THE BUCKETS, NOT THE FINISHED ROWS, because the order depends on the level PARTS and a finished row carries
// only their labels. A label repeats where a key does not ("Unnamed member" twice), so sorting on it would interleave two
// members who merely share a name.
//
// A DATE LEVEL SORTS FORWARDS BY ITS KEY, so months read January to December rather than alphabetically; everything else
// sorts by the label the reader sees, which is what makes a member list read by name.
//
// ONE LEVEL KEEPS THE ORDER A SINGLE-GROUPING REPORT HAS ALWAYS HAD - heaviest first, or chronological for a date -
// because one grouping is a ranking question and the biggest row is the one worth reading first. MORE THAN ONE READS BY
// THE GROUPING ORDER, because "month, then member" is a statement about how the report is LAID OUT, and sorting those
// rows by size would scatter each month's members through the table.
const orderBuckets = (buckets, levels, { valueOf = () => 0, labelOf = () => '', orderBy = null } = {}) => {
  const list = [...buckets.values()];
  // AN EXPLICIT ORDER WINS WHEN THERE IS ONE, and it replaces the rule below rather than refining it: a report that says
  // "biggest difference first, then by member" has said what it wants, and quietly re-sorting part of it would be doing
  // something else.
  const chosen = sortByOrder(list, orderBy, { levels, valueOf });
  if (chosen) return chosen;
  if (levels.length > 1) {
    return list.sort((a, b) => {
      for (let index = 0; index < levels.length; index += 1) {
        const left = a.parts[index] || { key: '', label: '' };
        const right = b.parts[index] || { key: '', label: '' };
        if (String(left.key) === String(right.key)) continue;
        const chronological = levels[index] === 'day' || levels[index] === 'month';
        return chronological
          ? String(left.key).localeCompare(String(right.key))
          : String(left.label).localeCompare(String(right.label));
      }
      return 0;
    });
  }
  const single = levels[0];
  if (single === 'day' || single === 'month') {
    return list.sort((a, b) => String(a.key).localeCompare(String(b.key)));
  }
  return list.sort((a, b) => valueOf(b) - valueOf(a) || String(labelOf(a)).localeCompare(String(labelOf(b))));
};

// The label a single bucket carries for its LAST level - what the old single-grouping sort used.
const lastLabelOf = (bucket) => bucket.levels[bucket.levels.length - 1] || '';

// ONE KEY OF AN EXPLICIT ORDER: the measure, or one of the levels the report is grouped by.
//
// THE KEYS ARE THE GROUPING'S OWN LEVELS PLUS THE MEASURE, and that is not a restriction for its own sake: a row carries
// only what it was grouped by, so "order by member" on a report grouped by month alone has nothing to sort on. What the
// choice BUYS is putting the number first - biggest difference first, then by member - which is the ordering an officer
// reconciling actually wants and which the one-size rule could not express.
const compareByOrderKey = (a, b, key, { levels, valueOf }) => {
  if (key === 'value') return valueOf(a) - valueOf(b);
  const index = levels.indexOf(key);
  if (index === -1) return 0;
  const left = a.parts[index] || { key: '', label: '' };
  const right = b.parts[index] || { key: '', label: '' };
  if (String(left.key) === String(right.key)) return 0;
  // A date level sorts by its KEY so months read in order; everything else by the label a reader sees, so a member list
  // reads by name.
  const chronological = key === 'day' || key === 'month';
  return chronological
    ? String(left.key).localeCompare(String(right.key))
    : String(left.label).localeCompare(String(right.label));
};

// The order a report ASKED FOR, or null when it did not ask. A key the report is not grouped by contributes nothing
// rather than throwing: the runner may have changed the grouping since, and a stale key should not empty the report.
const sortByOrder = (list, orderBy, context) => {
  const spec = (Array.isArray(orderBy) ? orderBy : [])
    .map((entry) => (entry && typeof entry === 'object' ? entry : { key: entry, direction: '' }))
    .map((entry) => ({
      key: String(entry.key || '').trim(),
      // DESCENDING IS THE USEFUL DEFAULT for a number and ascending for a name, which is why the direction is stored per
      // key rather than once for the whole order.
      sign: String(entry.direction || '').toLowerCase() === 'desc' ? -1 : 1,
    }))
    .filter((entry) => entry.key);
  if (!spec.length) return null;
  return [...list].sort((a, b) => {
    for (const entry of spec) {
      const result = compareByOrderKey(a, b, entry.key, context);
      if (result) return result * entry.sign;
    }
    return 0;
  });
};


// The row a bucket becomes: the combination's parts, the label a chart or a printout shows, and the measure(s).
//
// `label` IS THE WHOLE PATH rather than the last level, because a chart has one axis and a bar reading "Ana" twice gives
// no clue which month each belongs to. `levels` keeps the parts separate so a table can draw them as columns.
const rowFromBucket = (bucket) => ({
  key: bucket.key,
  label: bucket.levels.filter(Boolean).join(' · ') || 'Unknown',
  levels: bucket.levels,
});

// HOW A REPORT'S ROWS ARE ORDERED - see orderBuckets for the rule. This maps the ordered buckets into the rows a client
// receives, which is the only place the measure is turned into the shape that goes over the wire.
const rowsFromBuckets = (buckets, levels, options = {}) =>
  orderBuckets(buckets, levels, options).map((bucket) => options.rowOf(bucket));

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
const REPORT_RANGE_PRESETS = [
  'this_month',
  'last_week',
  'last_7_days',
  'last_month',
  'last_30_days',
  'this_year',
  'last_year',
];

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
  const groupBy = reportGroupingLevels(input.group_by, REPORT_DATASET_GROUPINGS[dataset]?.[0] || '');
  const scope = String(input.scope || 'station');
  const audienceRoleIds = cleanIds(input.audience_role_ids);
  const audienceRankIds = cleanIds(input.audience_rank_ids);
  const audienceAll = input.audience_all === true;
  const audienceKeys = reportAudienceKeys({ roleIds: audienceRoleIds, rankIds: audienceRankIds, everyone: audienceAll });

  if (name.length < 2 || name.length > 80) throw new Error('Report name must be 2-80 characters.');
  if (description.length > 300) throw new Error('Report description must be 300 characters or fewer.');
  if (!REPORT_DATASETS.includes(dataset)) throw new Error('That report dataset is not available.');
  if (!REPORT_VISUALIZATIONS.includes(visualization)) throw new Error('Choose a supported report visualization.');
  if (!REPORT_DATASET_GROUPINGS[dataset].includes(groupBy[0]) || groupBy.some((level) => !REPORT_DATASET_GROUPINGS[dataset].includes(level))) {
    throw new Error('Choose a supported report grouping.');
  }
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
    // The order the report asks for, kept only for the keys it could actually sort on - see normalizeOrderBy.
    order_by: normalizeOrderBy(input.order_by, groupBy),
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

const aggregateScheduleRows = (rows, { groupBy = 'assignment', assignments = [], users = [], templates = [], orderBy = [] } = {}) => {
  const levels = reportGroupingLevels(groupBy, 'assignment');
  const assignmentNames = new Map(assignments.map((row) => [String(row.id), String(row.description || '').trim()]));
  const userNames = new Map(users.map((row) => [String(row.id), String(row.name || '').trim()]));
  const templateNames = new Map(templates.map((row) => [String(row.id), String(row.nickname || '').trim()]));
  const { buckets, forParts } = makeBuckets();

  // How one row reads at one level. A level a row cannot answer - a shift with no template, an unrouted row - gets a
  // label of its own rather than being dropped: a report that hides rows is the fault this file keeps guarding against.
  const partFor = (level, row) => {
    if (level === 'member') {
      const id = String(row.user_id || '').trim() || 'open';
      return { key: id, label: id === 'open' ? 'Open shifts' : userNames.get(id) || 'Unnamed member' };
    }
    if (level === 'template') {
      const id = String(row.schedule_template_id || '').trim();
      return { key: id || 'one-off', label: id ? templateNames.get(id) || 'Unknown shift' : 'One-off shifts' };
    }
    if (level === 'day') {
      const date = String(row.date_from || '').slice(0, 10);
      return { key: date, label: date || 'Unknown date' };
    }
    if (level === 'month') {
      const month = String(row.date_from || '').slice(0, 7);
      return { key: month, label: month || 'Unknown month' };
    }
    const id = String(row.assignment_id || '').trim() || 'unknown';
    return { key: id, label: assignmentNames.get(id) || 'Unknown assignment' };
  };

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const bucket = forParts(levels.map((level) => partFor(level, row)));
    bucket.value = (bucket.value || 0) + 1;
  });

  return rowsFromBuckets(buckets, levels, {
    orderBy,
    valueOf: (bucket) => bucket.value || 0,
    labelOf: lastLabelOf,
    rowOf: (bucket) => ({ ...rowFromBucket(bucket), value: bucket.value || 0 }),
  });
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

// WHERE A SCHEDULED SHIFT RUNS: its TEMPLATE's times, or - for a one-off shift, which has no template - the times stored
// on the row itself. An end at or before the start runs past midnight rather than being an error, and equal times are a
// full day, which is what utils/shiftHours says on the client. Kept in one place because a shift's own hours and the
// question "did this clock entry happen during it" are the same window read two ways.
const shiftWindowOf = (row, templateById) => {
  const template = templateById.get(String(row.schedule_template_id || '').trim()) || null;
  const startMin = minutesOfDay(template ? template.start_time : row.start_time);
  const endMin = minutesOfDay(template ? template.end_time : row.end_time);
  if (startMin === null || endMin === null) return null;
  return {
    startMin,
    endMin,
    wraps: endMin <= startMin,
    hours: (endMin <= startMin ? endMin + 1440 - startMin : endMin - startMin) / 60,
  };
};

// The hours a scheduled shift is worth.
const shiftRowHours = (row, templateById) => shiftWindowOf(row, templateById)?.hours ?? 0;

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

// HOW THE STATION ROUNDS THE HOURS IT REPORTS, which is one setting in System Settings -> Clock Settings.
//
// THE SERVER'S COPY of src/utils/clockRounding.js, for the same reason the two hour rules above exist twice: the member's
// Clock History rounds in the browser and a report is summed here, and the two must round the same way or the hours a
// member reads would not be the hours an officer pays for. scripts/verify-reporting runs both copies over the same hours
// and fails on any drift.
//
// The setting lives in `settings/public`, but nothing here reads it: the runner reads that one document and hands the
// step in, so this file has no opinion about where settings are kept. A step that is not one of the three on offer - a
// typo, a stray value somebody added by hand - falls back to the finest step rather than rounding by something nobody
// chose.
const CLOCK_ROUNDING_KEY = 'clock_hours_rounding';
const DEFAULT_CLOCK_ROUNDING_MINUTES = 15;
const clockRoundingStep = (value) => {
  const step = Number(String(value ?? '').trim());
  return [15, 30, 60].includes(step) ? step : DEFAULT_CLOCK_ROUNDING_MINUTES;
};
// Hours rounded to the nearest step, a half rounded up.
const roundToStep = (hours, step) => (Math.round((hours * 60) / step) * step) / 60;

// THE STATION'S OWN CLOCK, for the same reason utils/scheduleIcs names a zone: shift times are wall-clock values with no
// zone of their own, so 07:00 means seven in the morning at the station whatever timezone this runs in.
const STATION_TZ = 'America/New_York';

// A date and a time of day, read the way the member's own screen reads them: the app's own text ("2026-10-06 17:00:00")
// is ALREADY station wall-clock and is taken as written, while a real instant ('2026-10-02T04:00:00.000Z', from the
// migration) is converted onto the station's clock. `trainingDateKey` draws the same line in the same place.
const stationWallClockOf = (value) => {
  const text = String(value ?? '').trim();
  const pad = (part) => String(part).padStart(2, '0');
  const dashed = /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})/.exec(text);
  if (dashed && !/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    return { dateKey: `${dashed[1]}-${pad(dashed[2])}-${pad(dashed[3])}`, minutes: Number(dashed[4]) * 60 + Number(dashed[5]) };
  }
  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})/.exec(text);
  if (slashed) {
    return { dateKey: `${slashed[3]}-${pad(slashed[1])}-${pad(slashed[2])}`, minutes: Number(slashed[4]) * 60 + Number(slashed[5]) };
  }
  const instant = dashed ? new Date(text) : NaN;
  if (Number.isNaN(Number(instant))) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: STATION_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  if (!get('year')) return null;
  return { dateKey: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
};

// A wall-clock moment as one number - minutes on from 1970-01-01 - so a shift window and a clock entry can be compared by
// subtracting them and nothing has to think about timezones twice. Summer time is deliberately not modelled: a shift is a
// wall-clock range (17:00 to 07:00, in the station's own clock) and the client's split reads it the same way.
const wallMinutes = ({ dateKey, minutes }) => Date.parse(`${dateKey}T00:00:00Z`) / 60000 + minutes;

// WHO WORKED DURING A SCHEDULED SHIFT, AND WHO DID NOT. For one clock entry and the member's own shifts in range, this
// returns the overlap with each shift that it touches, in minutes. The entry's remaining minutes are the hours that
// happened while NOTHING was scheduled - which is the other half of the question a reconciliation is asked, and the reason
// this exists: "13.75 hours of the night shift was worked, and an hour of it was not during a shift at all".
//
// THE SHIFTS ARE THE WINDOWS. Not the station's list of shift patterns: THOSE ARE A DIFFERENT COLLECTION (`shifts`), and
// they answer a different question - which pattern somebody's hours fell in - which is what the member's own Clock History
// prints in its Shift Time column. A reconciliation is about the shifts that were actually scheduled, so the row in front
// of it is the window: its template's times, or its own times for a one-off shift (see `shiftWindowOf`). That also means
// there is nothing to look up and nothing to keep in step - the window is on the row.
//
// EXACT HOURS, NOT ROUNDED TO THE HALF HOUR. The history rounds each window it prints to the nearest half hour, so its
// Shift Time column can add up to more than the entry's own duration; a report that pays people does not have that
// luxury, so the minutes are carried through and the parts always add back up to the entry.
const splitClockEntry = (entry, shiftRows, templateById) => {
  const start = stationWallClockOf(entry?.time_in);
  const end = stationWallClockOf(entry?.time_out);
  if (!start || !end) return null;
  const startAt = wallMinutes(start);
  const endAt = wallMinutes(end);
  if (!(endAt > startAt)) return null;

  const portions = [];
  for (const row of Array.isArray(shiftRows) ? shiftRows : []) {
    const window = shiftWindowOf(row, templateById);
    const dateKey = String(row?.date_from || '').slice(0, 10);
    if (!window || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
    // the shift's own day, as a wall-clock number, so the window can be lined up against the entry by subtraction
    const dayNumber = wallMinutes({ dateKey, minutes: 0 }) / 1440;
    const windowStart = dayNumber * 1440 + window.startMin;
    const windowEnd = dayNumber * 1440 + window.endMin + (window.wraps ? 1440 : 0);
    const overlap = Math.max(0, Math.min(endAt, windowEnd) - Math.max(startAt, windowStart));
    if (overlap <= 0) continue;
    portions.push({
      templateId: String(row.schedule_template_id || '').trim(),
      dateKey,
      minutes: overlap,
    });
  }
  return portions;
};
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
  templateIds = [],
  orderBy = [],
  roundingMinutes = DEFAULT_CLOCK_ROUNDING_MINUTES,
} = {}) => {
  const userNames = new Map(users.map((row) => [String(row.id), String(row.name || '').trim()]));
  const templateById = new Map(templates.map((row) => [String(row.id), row]));
  const templateNames = new Map(templates.map((row) => [String(row.id), String(row.nickname || '').trim()]));
  const wanted = new Set(
    (Array.isArray(assignmentIds) ? assignmentIds : []).map((id) => String(id ?? '').trim()).filter(Boolean)
  );
  // THE TEMPLATE AXIS IS THE FINER ONE, and it exists because an assignment can carry several patterns at different pay
  // rates - `Officer` is one assignment, but "Officer - Day" and "Officer - Night" are two templates. Ticking a template
  // counts only that pattern's shifts; ticking nothing counts every template. A one-off shift has no template at all, so
  // it is counted by its ASSIGNMENT and is left out as soon as any template is ticked.
  const wantedTemplate = new Set(
    (Array.isArray(templateIds) ? templateIds : []).map((id) => String(id ?? '').trim()).filter(Boolean)
  );

  const levels = reportGroupingLevels(groupBy, 'member');
  const { buckets, forParts } = makeBuckets();

  // A level's key and label for one row. THE TEMPLATE LEVEL IS FILLED IN BY THE SPLIT ABOVE: a clock entry does not
  // record which pattern somebody was on, but the shift they were scheduled for is a window with two ends, so the entry's
  // hours are measured against the shifts around it and filed under the template of the one they fall in. So "No shift" is
  // not "we declined to attribute these hours": it is the hours that fell outside every shift they were scheduled for,
  // which is exactly the time nobody booked them for. A template grouping answers "what was I supposed to pay for?", and
  // the No-shift row is the one to look at first - it is where somebody working outside their roster shows up.
  const partFor = (level, userId, dateKey, templateId) => {
    if (level === 'member') {
      const id = userId || 'unknown';
      return { key: id, label: id === 'unknown' ? 'Unassigned' : userNames.get(id) || 'Unnamed member' };
    }
    if (level === 'template') {
      const id = String(templateId || '').trim();
      if (!id) return { key: 'no-shift', label: 'No shift' };
      return { key: id, label: templateNames.get(id) || 'Unknown shift' };
    }
    if (level === 'month') return { key: String(dateKey).slice(0, 7), label: String(dateKey).slice(0, 7) || 'Unknown month' };
    return { key: dateKey, label: dateKey || 'Unknown date' };
  };
  const bucketFor = (userId, dateKey, templateId) =>
    forParts(levels.map((level) => partFor(level, userId, dateKey, templateId)));

  // EVERY SHIFT, GROUPED BY WHOSE IT IS, and collected BEFORE the tick boxes narrow anything: the clocked side is never
  // narrowed by them (see the note above), so a member who worked a shift the officer did not tick still needs that
  // shift's hours as a window to be measured against. Filing those hours as "No shift" would say nobody had scheduled
  // them when somebody had.
  const shiftsByMember = new Map();
  (Array.isArray(scheduleRows) ? scheduleRows : []).forEach((row) => {
    const owner = String(row.user_id || '').trim();
    if (!shiftsByMember.has(owner)) shiftsByMember.set(owner, []);
    shiftsByMember.get(owner).push(row);

    if (wanted.size && !wanted.has(String(row.assignment_id || '').trim())) return;
    const templateId = String(row.schedule_template_id || '').trim();
    if (wantedTemplate.size && !wantedTemplate.has(templateId)) return;
    const hours = shiftRowHours(row, templateById);
    if (!hours) return;
    const bucket = bucketFor(String(row.user_id || '').trim(), String(row.date_from || '').slice(0, 10), templateId);
    bucket.scheduled = round2((bucket.scheduled || 0) + hours);
  });

  (Array.isArray(clockRows) ? clockRows : []).forEach((row) => {
    const userId = String(row.user_id || '').trim();
    const hours = clockEntryHours(row);
    if (hours === null) {
      // AN OPEN ENTRY CANNOT BE SPLIT - there is no end to split to - so it is counted where it always was, against the
      // day it started, and the reader is told how many of those there are rather than being handed a wrong number.
      const bucket = bucketFor(userId, trainingDateKey(row.time_in), '');
      bucket.open = (bucket.open || 0) + 1;
      return;
    }
    // THE HOURS ARE SPLIT ACROSS THE SHIFTS THIS MEMBER WAS ACTUALLY SCHEDULED FOR. A clock entry cannot name the shift
    // somebody was on, but it does not have to: their own shifts are in front of us, with the hours each one covers, so
    // the entry is divided by overlap and the remainder is the time nobody scheduled them for. That is the two numbers a
    // reconciliation is read for - "13.75 of the night shift was worked, and an hour of it was not during a shift".
    const portions = splitClockEntry(row, shiftsByMember.get(userId) || [], templateById) || [];
    const step = clockRoundingStep(roundingMinutes);
    let placed = 0;
    portions.forEach((portion) => {
      placed += portion.minutes;
      const bucket = bucketFor(userId, portion.dateKey, portion.templateId);
      // ROUNDED PER SHIFT, not once for the whole entry: a pay period rounds what it pays for, and what it pays for is
      // the hours inside a shift. So a night that runs 15 minutes over is 15 minutes over, not a rounding of the day.
      bucket.clocked = round2((bucket.clocked || 0) + roundToStep(portion.minutes / 60, step));
    });
    // WHATEVER HAPPENED OUTSIDE EVERY SHIFT IS THE HOURS NOBODY SCHEDULED, and that is exactly what the No-shift bucket is
    // for. Measured in minutes so the parts add back up to the entry rather than drifting from it by a rounding.
    const leftover = Math.max(0, hours - placed / 60);
    if (leftover > 0.0001 || !portions.length) {
      // The day for what is left comes from the timestamp, read in STATION time by the same rule the training report uses
      // for its own timestamps - an entry stored as an instant must not land on the wrong day for the station reading it.
      const bucket = bucketFor(userId, trainingDateKey(row.time_in), '');
      bucket.clocked = round2((bucket.clocked || 0) + roundToStep(leftover, step));
    }
  });

  // Worst differences first when there is one level - an officer reconciling is looking for the rows that do not match -
  // and by the grouping order when there are more, which is what "month, then member" asks for.
  return rowsFromBuckets(buckets, levels, {
    orderBy,
    valueOf: (bucket) => Math.abs(round2((bucket.clocked || 0) - (bucket.scheduled || 0))),
    labelOf: lastLabelOf,
    rowOf: (bucket) => {
      const scheduled = bucket.scheduled || 0;
      const clocked = bucket.clocked || 0;
      const variance = round2(clocked - scheduled);
      return {
        ...rowFromBucket(bucket),
        // `value` is what a chart plots, and for a reconciliation that is the VARIANCE: the difference is the finding, and
        // the two totals are the detail behind it in `values`.
        value: variance,
        values: {
          variance,
          scheduled_hours: scheduled,
          clocked_hours: clocked,
          open_clock_entries: bucket.open || 0,
        },
      };
    },
  });
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
const aggregateTrainingRows = (signatures, { groupBy = 'category', trainings = [], users = [], orderBy = [] } = {}) => {
  const levels = reportGroupingLevels(groupBy, 'category');
  const trainingById = new Map(trainings.map((row) => [String(row.id), row]));
  const userNames = new Map(users.map((row) => [String(row.id), String(row.name || '').trim()]));
  const { buckets, forParts } = makeBuckets();

  const partFor = (level, signature, training, date) => {
    if (level === 'member') {
      const id = String(signature.user_id || '').trim() || 'unknown';
      return { key: id, label: userNames.get(id) || 'Unnamed member' };
    }
    if (level === 'training') {
      return { key: String(training.id), label: String(training.title || '').trim() || 'Untitled training' };
    }
    if (level === 'month') return { key: date.slice(0, 7), label: date.slice(0, 7) || 'Unknown month' };
    if (level === 'day') return { key: date, label: date || 'Unknown date' };
    return null; // category, handled below - one training can be in several
  };

  (Array.isArray(signatures) ? signatures : []).forEach((signature) => {
    const training = trainingById.get(String(signature.training_id));
    if (!training) return;
    const duration = Number(training.duration);
    const hours = Number.isFinite(duration) && duration > 0 ? duration : 0;
    const date = String(training.date_key || '') || trainingDateKey(training.date);

    // A CATEGORY LEVEL IS THE ONE THAT CAN PUT A ROW IN MORE THAN ONE BUCKET: a training flagged as both hazmat and
    // company training counts in each, which is why category totals can exceed the overall total. Every combination the
    // levels allow is built here, so "category then member" counts that training under both categories for that member.
    const options = levels.map((level) => {
      if (level !== 'category') return [partFor(level, signature, training, date)].filter(Boolean);
      const matched = TRAINING_CATEGORIES.filter(([flag]) => isTruthyFlag(training[flag]));
      if (!matched.length) return [{ key: 'none', label: 'No category' }];
      return matched.map(([flag, label]) => ({ key: flag, label }));
    });
    const combinations = options.reduce(
      (acc, parts) => acc.flatMap((combo) => parts.map((part) => [...combo, part])),
      [[]]
    );
    combinations.forEach((parts) => {
      const bucket = forParts(parts);
      bucket.value = round2((bucket.value || 0) + hours);
    });
  });

  return rowsFromBuckets(buckets, levels, {
    orderBy,
    valueOf: (bucket) => bucket.value || 0,
    labelOf: lastLabelOf,
    rowOf: (bucket) => ({ ...rowFromBucket(bucket), value: bucket.value || 0 }),
  });
};

// The grouping a RUN may use: what the viewer asked for when the definition opened it up and EVERY level is one this
// dataset supports, and the definition's own otherwise.
//
// A REQUEST NAMING ONE UNSUPPORTED LEVEL FALLS BACK WHOLESALE rather than being partly honoured. Half of a requested
// grouping is not what anybody asked for, and a report must never be run on a combination its author did not choose from.
const resolveGroupingRequest = (report, request, groupings) => {
  const own = reportGroupingLevels(report.group_by, groupings[0]);
  const asked = reportGroupingLevels(request.group_by, '');
  if (!asked.length) return own;
  return asked.every((level) => groupings.includes(level)) ? asked : own;
};

// What a viewer may change when running a report. Anything the definition does not open up falls back to the
// definition's own value, so a hand-built request cannot reach past what the author allowed.
const resolveReportOptions = (report, request = {}) => {
  const dataset = report.dataset || 'schedule';
  const groupings = REPORT_DATASET_GROUPINGS[dataset] || [];
  const askedVisual = String(request.visualization || '');
  const askedCategory = String(request.category || '');
  const categoryKeys = [...TRAINING_CATEGORIES.map(([flag]) => flag), 'none'];
  const groupBy =
    report.allow_group_by === true
      ? resolveGroupingRequest(report, request, groupings)
      : reportGroupingLevels(report.group_by, groupings[0]);
  const askedVisualization =
    report.allow_visualization === true && REPORT_VISUALIZATIONS.includes(askedVisual) ? askedVisual : report.visualization;
  return {
    groupBy,
    // A definition-only setting rather than another thing the runner may change: the order is part of what the report IS,
    // and a viewer reordering it would be authoring a different report under the same name.
    orderBy: normalizeOrderBy(report.order_by, groupBy),
    // A CHART HAS ONE AXIS, so a report grouped by more than one thing is drawn as a TABLE whatever was asked for.
    //
    // This is enforced here rather than only in the two dropdowns that offer the choice, because a rule a client can opt
    // out of is not a rule: a hand-built request must not be able to ask for a bar graph of a two-level grouping, which
    // the chart component would draw as a single scrambled series. The dropdowns say the same thing in advance, which is
    // how an author finds out; this is what makes it true.
    visualization: groupBy.length > 1 ? 'table' : askedVisualization,
    category: report.allow_category === true && categoryKeys.includes(askedCategory) ? askedCategory : '',
    memberIds: report.allow_members === true && report.scope === 'station' ? cleanIds(request.member_ids).slice(0, 100) : [],
    // The ticked assignments, only for a dataset that compares scheduled time against something, and only when the
    // definition opened it up. EMPTY MEANS EVERY ASSIGNMENT - see aggregateReconciliation.
    assignmentIds:
      report.allow_assignments === true && REPORT_DATASETS_WITH_ASSIGNMENTS.includes(dataset)
        ? cleanIds(request.assignment_ids).slice(0, 200)
        : [],
    // The finer axis, under the same permission: which SHIFT TEMPLATES count. An assignment can carry several patterns at
    // different pay rates, so an officer reconciling pay needs to tick the pattern rather than the whole assignment.
    templateIds:
      report.allow_assignments === true && REPORT_DATASETS_WITH_ASSIGNMENTS.includes(dataset)
        ? cleanIds(request.template_ids).slice(0, 200)
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
  REPORT_GROUPING_LABELS,
  reportGroupingLevels,
  REPORT_DATASETS,
  REPORT_GROUPINGS,
  aggregateReconciliation,
  aggregateTrainingRows,
  trainingDateKey,
  REPORT_SCOPES,
  REPORT_VISUALIZATIONS,
  aggregateScheduleRows,
  clockEntryHours,
  splitClockEntry,
  CLOCK_ROUNDING_KEY,
  clockRoundingStep,
  roundToStep,
  minutesOfDay,
  shiftRowHours,
  canUseReport,
  normalizeReportDefinition,
  reportAudienceKeys,
};