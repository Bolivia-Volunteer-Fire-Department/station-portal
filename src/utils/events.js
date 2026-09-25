// Events: non-shift entries on the calendars, behaving like calendar events rather than shifts.
//
// Three things separate an event from a shift, and all three matter here:
//
//   * An event occupies EVERY day it spans. A shift is drawn on its start day only
//     (utils/shiftPlacement), so an overnight 22:00-04:00 shift appears once; an overnight event
//     appears on both days, with the time label shown only where it starts and ends.
//   * An event can repeat. Recurrence is described by a start date plus an amount and a frequency,
//     rather than by one row per occurrence.
//   * An event never affects the schedule. It is not a shift: it never fills a slot, never appears in
//     an availability slot, and cannot be offered for. scripts/verify-events.mjs pins that.
//
// Everything here is pure so the recurrence arithmetic can be exercised directly - it is the part most
// easily wrong and least easily noticed (an event simply failing to appear on one Tuesday).
import { rankOrderOf } from './rankEligibility';
import { displayDate, toDateKey } from './scheduleDate';
import { formatClock } from './shiftTime';

// --- small helpers ----------------------------------------------------------

const text = (value) => String(value ?? '').trim();
const pad = (value) => String(value).padStart(2, '0');

export const EVENT_DEFAULT_COLOR = '#64748b'; // slate-500: "otherwise default to gray"

export const eventFlag = (value) =>
  value === true || text(value).toUpperCase() === 'TRUE';

// A valid yyyy-mm-dd key, or null. Kept strict so a hand-typed "3/4/26" is reported as unusable rather
// than silently sorting as if it were a real date.
export const eventDateKey = (value) => {
  const raw = text(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
};

// The time-of-day of a datetime cell, in minutes past midnight, or null.
//
// Handles the two shapes the sheet actually produces: an ISO string from Apps Script's JSON
// ("2026-03-14T22:00:00.000Z", which arrives in UTC and would shift the hour if trusted) and a plain
// "yyyy-mm-dd HH:mm". UTC values are converted to LOCAL time, because a 22:00 event is 22:00 at the
// station, not 22:00 UTC.
export const eventMinutesOf = (value) => {
  const raw = text(value);
  if (!raw) return null;

  const named = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/.exec(raw);
  if (named) {
    const hours = Number(named[4]);
    const minutes = Number(named[5]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  // A date with no time: midnight, which is a real answer for an all-day style event.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 0;
  return null;
};

// Anchors everything that follows: a datetime cell resolves to a local date key AND local minutes, so
// an ISO instant and a plain "yyyy-mm-dd HH:mm" agree.
export const eventInstant = (value) => {
  const raw = text(value);
  if (!raw) return null;

  const isIso = /T\d{1,2}:\d{2}/.test(raw);
  if (isIso) {
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    return { dateKey: toDateKey(parsed), minutes: parsed.getHours() * 60 + parsed.getMinutes() };
  }

  const dateKey = eventDateKey(raw);
  if (!dateKey) return null;

  const minutes = eventMinutesOf(raw);
  // A value that carries a time but not a usable one is unusable. Silently reading "24:30" as midnight
  // would put the event on the right day at the wrong hour, which is worse than dropping it.
  if (minutes === null && /\d{1,2}:\d{2}/.test(raw)) return null;

  return { dateKey, minutes: minutes === null ? 0 : minutes };
};

// --- colour ------------------------------------------------------------------

// Normalises a hex colour, or null when the value is not usable. Mirrors
// utils/assignmentColor so an admin typing a colour gets the same treatment in both places.
export const normalizeEventColor = (value) => {
  const raw = text(value).toLowerCase();
  if (!raw) return null;
  const short = /^#([0-9a-f]{3})$/.exec(raw);
  if (short) {
    const [r, g, b] = short[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return /^#[0-9a-f]{6}$/.test(raw) ? raw : null;
};

export const eventColor = (value) => normalizeEventColor(value) || EVENT_DEFAULT_COLOR;

// --- normalisation ----------------------------------------------------------

// Sunday-first, matching Date.prototype.getDay() and the is_sunday..is_saturday columns.
export const EVENT_WEEKDAYS = [
  { key: 'is_sunday', index: 0, label: 'Sunday' },
  { key: 'is_monday', index: 1, label: 'Monday' },
  { key: 'is_tuesday', index: 2, label: 'Tuesday' },
  { key: 'is_wednesday', index: 3, label: 'Wednesday' },
  { key: 'is_thursday', index: 4, label: 'Thursday' },
  { key: 'is_friday', index: 5, label: 'Friday' },
  { key: 'is_saturday', index: 6, label: 'Saturday' },
];

export const EVENT_FREQUENCIES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

// --- date arithmetic on yyyy-mm-dd keys -------------------------------------
//
// Local-date math throughout: `new Date('2026-03-14')` would be parsed as UTC midnight and could land on
// the 13th west of Greenwich, so keys are split into parts and rebuilt as a local date.

const keyToDate = (key) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(key));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

const addDays = (key, days) => {
  const date = keyToDate(key);
  if (!date) return null;
  date.setDate(date.getDate() + days);
  return toDateKey(date);
};

const daysBetween = (laterKey, earlierKey) => {
  const later = keyToDate(laterKey);
  const earlier = keyToDate(earlierKey);
  if (!later || !earlier) return null;
  return Math.round((later - earlier) / 86400000);
};

const weekdayOf = (key) => {
  const date = keyToDate(key);
  return date ? date.getDay() : null;
};

const clockFromMinutes = (minutes) => {
  const value = Number(minutes);
  if (!Number.isFinite(value)) return '';
  const wrapped = ((value % 1440) + 1440) % 1440;
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
};

// A cap on generated occurrences per event per window. A month never needs more than a few dozen, so
// this only ever fires on pathological input and stops a runaway loop from freezing the tab.
const MAX_OCCURRENCES = 400;

// --- normalisation ----------------------------------------------------------

// One sheet row as the renderer needs it, or null when there is nothing drawable.
//
// A row with no id or no usable start is dropped rather than rendered as a mystery pill - the same
// treatment a training row with no date gets.
//
// **Idempotent**: an already-normalised event is passed straight through. That matters because the app
// normalises the payload once and then every calendar normalises again defensively - and re-parsing a
// normalised event returns null, because this function reads the sheet's raw column names
// (`is_recurring`, `date_from`) while a normalised event is camelCase (`isRecurring`, `startsAt`). That
// mismatch silently erased every event from every calendar, which is exactly the kind of failure the
// defensive normalisation was meant to prevent.
export const isNormalizedEvent = (value) =>
  !!value &&
  typeof value === 'object' &&
  'isRecurring' in value &&
  'startsAt' in value &&
  !('date_from' in value);

export const normalizeEvent = (row) => {
  if (!row) return null;
  if (isNormalizedEvent(row)) return row;

  const id = text(row.id);
  if (!id) return null;

  const isRecurring = eventFlag(row.is_recurring);
  const isAllDay = eventFlag(row.is_all_day);
  const startsAt = eventInstant(row.date_from);
  const endsAt = eventInstant(row.date_to);
  const recurringStart = eventDateKey(row.recurring_start);
  const recurringEnd = eventDateKey(row.recurring_end);

  // A recurring event takes only the TIMES from date_from/date_to; a single event takes the dates too.
  if (isRecurring ? !recurringStart : !startsAt) return null;

  const amount = parseInt(row.recurring_amount, 10);
  const rawFrequency = text(row.recurring_frequency).toLowerCase();
  const frequency = EVENT_FREQUENCIES.some((f) => f.value === rawFrequency) ? rawFrequency : 'daily';
  const dateOfMonth = parseInt(row.date_of_month, 10);

  return {
    id,
    title: text(row.title) || 'Event',
    color: eventColor(row.color),
    isRecurring,
    // An all-day event occupies whole days, so its times are ignored entirely rather than being treated
    // as midnight-to-midnight. That distinction is what keeps a three-day conference on all three days
    // instead of being collapsed by the "ends at midnight" rule.
    isAllDay,
    startsAt,
    endsAt,
    recurringStart,
    recurringEnd,
    frequency,
    amount: Number.isFinite(amount) && amount >= 1 ? amount : 1,
    weekdays: EVENT_WEEKDAYS.filter((day) => eventFlag(row[day.key])).map((day) => day.index),
    dateOfMonth: Number.isFinite(dateOfMonth) && dateOfMonth >= 1 && dateOfMonth <= 31 ? dateOfMonth : null,
    role_id: text(row.role_id),
    rank_id: text(row.rank_id),
    user_id: text(row.user_id),
    author_user_id: text(row.author_user_id),
  };
};

export const normalizeEventList = (rows) =>
  (Array.isArray(rows) ? rows : []).map(normalizeEvent).filter(Boolean);

// --- validation -------------------------------------------------------------

// Why a save should be refused, or '' when the values are usable.
//
// The backend enforces the same rules; this exists so the form can say what is wrong before a round
// trip, and so the recurrence combinations are pinned in one readable place. A recurring event with no
// day of the week, or a monthly one with no day of the month, would render NOTHING - the hardest kind of
// bug to notice - so both are refused rather than saved as a silent no-op.
export const eventValidation = (values = {}) => {
  if (!text(values.title)) return 'A title is required.';

  if (eventFlag(values.is_recurring)) {
    const start = eventDateKey(values.recurring_start);
    if (!start) return 'A start date is required for a recurring event.';

    const frequency = text(values.recurring_frequency).toLowerCase();
    if (!EVENT_FREQUENCIES.some((f) => f.value === frequency)) {
      return 'Choose how often this event repeats.';
    }

    const amount = parseInt(values.recurring_amount, 10);
    if (!Number.isFinite(amount) || amount < 1) {
      return 'Repeat every must be a whole number of 1 or more.';
    }

    if (frequency === 'weekly' && !EVENT_WEEKDAYS.some((day) => eventFlag(values[day.key]))) {
      return 'Tick at least one day of the week for a weekly event, or it would never appear.';
    }

    if (frequency === 'monthly') {
      const dayOfMonth = parseInt(values.date_of_month, 10);
      if (!Number.isFinite(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
        return 'Choose a day of the month between 1 and 31.';
      }
    }

    const end = eventDateKey(values.recurring_end);
    if (end && end < start) return 'The repeat cannot end before it starts.';
    return '';
  }

  const from = eventInstant(values.date_from);
  if (!from) return 'A start date and time is required.';

  // An all-day event has no times to order, so its dates are compared and read INCLUSIVELY: "Mar 1 to
  // Mar 3" is a valid three-day event. Its end date is optional, meaning a single day.
  if (eventFlag(values.is_all_day)) {
    const to = eventInstant(values.date_to);
    if (to && to.dateKey < from.dateKey) return 'The end has to be on or after the start date.';
    return '';
  }

  const to = eventInstant(values.date_to);
  if (!to) return 'An end date and time is required.';
  if (to.dateKey < from.dateKey || (to.dateKey === from.dateKey && to.minutes <= from.minutes)) {
    return 'The end has to be after the start.';
  }
  return '';
};

// --- ordering ---------------------------------------------------------------

// The date an event is "about", which is what a list should be ordered by.
//
// For a repeating event that is `recurring_start`, not `date_from`: the repeating event's date_from holds the
// anchor with the right TIMES but its date is only there to carry them (see eventFieldsFrom in Code.gs), so
// sorting by it would file "every Tuesday" under whichever day the form happened to be open.
export const eventAnchorKey = (event) => {
  if (!event) return '';
  if (event.isRecurring) return text(event.recurringStart);
  return event.startsAt ? text(event.startsAt.dateKey) : '';
};

// The clock time to break a same-day tie with, or null.
const eventAnchorMinutes = (event) => (event && event.startsAt ? event.startsAt.minutes : null);

// Ordering.
//
// The list an administrator reads runs alongside a calendar, so it reads forwards: earliest first by default.
// Undated events sort LAST in every direction - a row whose date is unreadable is not the earliest event - which
// is why the direction is a parameter of the comparison rather than a negation of it (negating would carry the
// undated rows to the top of "latest first").
export const EVENT_SORT_OPTIONS = [
  { value: 'date_asc', label: 'Date (earliest first)' },
  { value: 'date_desc', label: 'Date (latest first)' },
  { value: 'title_asc', label: 'Title (A–Z)' },
];

export const DEFAULT_EVENT_SORT = 'date_asc';

// A same-day tie is broken by start time, then title, then id, so the sheet's own row order can never change
// what the reader sees.
const compareAnchors = (a, b, direction = 1) => {
  const aKey = eventAnchorKey(a);
  const bKey = eventAnchorKey(b);
  if (aKey !== bKey) {
    if (!aKey) return 1;
    if (!bKey) return -1;
    return (aKey < bKey ? -1 : 1) * direction;
  }

  const aMinutes = eventAnchorMinutes(a);
  const bMinutes = eventAnchorMinutes(b);
  if (aMinutes !== bMinutes) {
    if (aMinutes === null) return 1;
    if (bMinutes === null) return -1;
    return aMinutes - bMinutes;
  }

  return (
    text(a.title).localeCompare(text(b.title)) ||
    (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0)
  );
};

const compareTitles = (a, b) =>
  text(a.title).localeCompare(text(b.title)) || compareAnchors(a, b, 1);

const EVENT_COMPARATORS = {
  date_asc: (a, b) => compareAnchors(a, b, 1),
  date_desc: (a, b) => compareAnchors(a, b, -1),
  title_asc: compareTitles,
};

// The list in the chosen order. An unknown sort falls back to the default rather than leaving the list as the
// sheet happened to return it.
export const sortEvents = (events, sort = DEFAULT_EVENT_SORT) => {
  const comparator = EVENT_COMPARATORS[sort] || EVENT_COMPARATORS[DEFAULT_EVENT_SORT];
  return [...(Array.isArray(events) ? events : [])].filter(Boolean).sort(comparator);
};

// The default order, kept as its own export because it is the one the calendars and the earliest tests rely on.
export const sortEventsChronologically = (events) => sortEvents(events, 'date_asc');

// How many events one page of the administration list holds.
export const EVENTS_PAGE_SIZE = 20;

// --- filtering and splitting ------------------------------------------------

// The fixed audience choices. Two buckets rather than one option per role, because the useful question when
// scanning a long list is "which of these are aimed at someone specific?".
export const EVENT_AUDIENCE_OPTIONS = [
  { value: '', label: 'All events' },
  { value: 'everyone', label: 'Everyone (untargeted)' },
  { value: 'targeted', label: 'Targeted' },
];

export const emptyEventFilters = () => ({ from: '', to: '', audience: '' });

export const eventFiltersActive = (filters = {}) =>
  Boolean(text(filters.from) || text(filters.to) || text(filters.audience));

// The events matching a filter set.
//
// Dated by the same anchor the ordering uses, so a date range and the order agree about when an event happens.
// An event with no readable anchor is EXCLUDED once a range is set: it cannot be shown to fall inside one.
export const filterEvents = (events, filters = {}) => {
  const from = text(filters.from);
  const to = text(filters.to);
  const audience = text(filters.audience);

  return (Array.isArray(events) ? events : []).filter((event) => {
    if (!event) return false;

    if (from || to) {
      const key = eventAnchorKey(event);
      if (!key) return false;
      if (from && key < from) return false;
      if (to && key > to) return false;
    }

    if (audience === 'everyone' && !eventShowsToEveryone(event)) return false;
    if (audience === 'targeted' && eventShowsToEveryone(event)) return false;

    return true;
  });
};

// The two lists the configuration screen shows: one-off events, and the repeating ones.
//
// Repeating events are split out because they are the minority and the ones most likely to need scrutiny (a
// repeat that lands on the wrong weekday is the mistake this feature invites), so the card holding them is where
// an administrator will look first.
export const splitEventsByRecurrence = (events) => {
  const oneOff = [];
  const recurring = [];

  (Array.isArray(events) ? events : []).filter(Boolean).forEach((event) => {
    (event.isRecurring ? recurring : oneOff).push(event);
  });

  return { oneOff, recurring };
};

// --- visibility -------------------------------------------------------------

// Whether one member should see one event.
//
// The three targeting columns are ANDed, exactly as announcements work: fill one and only that group
// sees it, fill two and both must match. The difference from announcements is the rank rule - an event
// targets a rank AND ABOVE, so it uses rank_order rather than equality.
//
// When a rank is set, a viewer whose own rank cannot be resolved (no rank assigned, or an unknown rank
// id) does NOT match. There is nothing to compare, and leaking the event to everybody is the worse
// failure of the two.
export const eventVisibleTo = (event, { roleId = '', rankId = '', userId = '', ranks = [] } = {}) => {
  if (!event) return false;

  const eventRole = text(event.role_id);
  if (eventRole && eventRole !== text(roleId)) return false;

  const eventUser = text(event.user_id);
  if (eventUser && eventUser !== text(userId)) return false;

  const eventRank = text(event.rank_id);
  if (eventRank) {
    const required = rankOrderOf(ranks, eventRank);
    const own = rankOrderOf(ranks, rankId);
    if (required === null || own === null || own < required) return false;
  }

  return true;
};

// True when nothing narrows the audience, i.e. every member sees it.
export const eventShowsToEveryone = (event) =>
  !event || (!text(event.role_id) && !text(event.rank_id) && !text(event.user_id));

// The audience in words, for the administration list. Mirrors announcementAudienceLabel, with "and
// above" added to a rank because that is what an event's rank target means.
export const eventVisibilityLabel = (event, { roles = [], ranks = [], users = [] } = {}) => {
  const nameOf = (list, id, key) => {
    const found = (Array.isArray(list) ? list : []).find((row) => String(row?.id) === String(id));
    return found ? text(found[key]) || `#${id}` : `#${id}`;
  };

  const parts = [];
  const role = text(event?.role_id);
  const rank = text(event?.rank_id);
  const user = text(event?.user_id);

  if (user) parts.push(`Only ${nameOf(users, user, 'name')}`);
  if (role) parts.push(`${parts.length ? 'and only ' : ''}${nameOf(roles, role, 'description')} role`);
  if (rank) parts.push(`${parts.length ? 'and only ' : ''}${nameOf(ranks, rank, 'description')} rank and above`);

  return parts.length ? parts.join(', ') : 'Everyone';
};

// --- occurrences ------------------------------------------------------------

// One span, in local date keys and minutes. `endKey` may be the following day for an overnight event.
//
// `endMinutes: 1440` is legal and means the END OF that day: an all-day event covers a whole day rather
// than stopping a minute short of it. Only timed events are clamped to 1439.
const buildOccurrence = (startKey, startMinutes, endMinutes, allDay = false) => {
  if (!startKey) return null;

  if (allDay) {
    // Exactly one whole day. A multi-day all-day span is built directly in singleOccurrence, which knows
    // the end date; this branch is for one occurrence of a repeating all-day event.
    return { startKey, startMinutes: 0, endKey: startKey, endMinutes: 1440, allDay: true };
  }

  const start = Number.isFinite(startMinutes) ? startMinutes : 0;
  let end = Number.isFinite(endMinutes) ? endMinutes : start;
  let endKey = startKey;

  if (end < start) {
    endKey = addDays(startKey, 1); // runs past midnight
  } else if (end === start) {
    // A zero-length event still has to occupy its start day, or it would never be drawn at all.
    if (start >= 1439) {
      endKey = addDays(startKey, 1);
      end = 0;
    } else {
      end = start + 1;
    }
  }

  return { startKey, startMinutes: start, endKey, endMinutes: end, allDay: false };
};

// A single event's one span, clamped so the end is genuinely after the start.
//
// An all-day event reads its dates INCLUSIVELY: "Mar 1 to Mar 3" is on all three days, matching how the
// rest of the app treats date ranges (a shift row's date_from/date_to, a template's effective and end
// dates). A timed event is different - see the midnight rule in eventSegment.
const singleOccurrence = (event) => {
  if (!event.startsAt) return null;
  const { dateKey, minutes } = event.startsAt;

  if (event.isAllDay) {
    const last = event.endsAt && event.endsAt.dateKey >= dateKey ? event.endsAt.dateKey : dateKey;
    return { startKey: dateKey, startMinutes: 0, endKey: last, endMinutes: 1440, allDay: true };
  }

  if (!event.endsAt) return buildOccurrence(dateKey, minutes, minutes);

  const before =
    event.endsAt.dateKey < dateKey ||
    (event.endsAt.dateKey === dateKey && event.endsAt.minutes <= minutes);

  return before
    ? buildOccurrence(dateKey, minutes, minutes)
    : {
        startKey: dateKey,
        startMinutes: minutes,
        endKey: event.endsAt.dateKey,
        endMinutes: event.endsAt.minutes,
        allDay: false,
      };
};

// Start dates of a repeating event that fall inside [fromKey, toKey], stepping `stepDays` each time.
//
// Jumps straight to the first candidate at or after the window rather than walking from the event's
// start: a daily event created three years ago would otherwise cost a thousand iterations per calendar
// render.
const steppedStarts = (firstKey, stepDays, fromKey, toKey) => {
  const out = [];
  if (!firstKey || !stepDays || stepDays < 1) return out;

  let key = firstKey;
  if (fromKey > key) {
    const gap = daysBetween(fromKey, key);
    if (gap === null) return out;
    key = addDays(key, Math.ceil(gap / stepDays) * stepDays);
  }

  for (let guard = 0; key && key <= toKey && guard < MAX_OCCURRENCES; guard++) {
    out.push(key);
    key = addDays(key, stepDays);
  }
  return out;
};

// Every occurrence of one event that overlaps [fromKey, toKey].
//
// A recurring event spans at most one day (its length comes only from the two time values), so looking
// back a single day is enough to catch an occurrence that began before the window and ran into it.
export const eventOccurrencesInWindow = (event, fromKey, toKey) => {
  if (!event || !fromKey || !toKey || toKey < fromKey) return [];

  if (!event.isRecurring) {
    const occurrence = singleOccurrence(event);
    if (!occurrence) return [];
    // Overlaps when it starts before the window ends and ends after the window starts.
    return occurrence.startKey <= toKey && occurrence.endKey >= fromKey ? [occurrence] : [];
  }

  const startMinutes = event.startsAt ? event.startsAt.minutes : 0;
  const endMinutes = event.endsAt ? event.endsAt.minutes : startMinutes;
  const limit = event.recurringEnd && event.recurringEnd < toKey ? event.recurringEnd : toKey;
  if (limit < event.recurringStart) return [];

  // One day of lookback, so an overnight occurrence that began the day before still reaches the window.
  const windowFrom = addDays(fromKey, -1) || fromKey;
  const candidates = [];

  if (event.frequency === 'weekly') {
    // Anchored per weekday: the first matching weekday on or after the start date, then every `amount`
    // weeks. Week-start conventions never come into it, so "every 2 weeks on Mon and Thu" is unambiguous.
    event.weekdays.forEach((weekday) => {
      const offset = (weekday - weekdayOf(event.recurringStart) + 7) % 7;
      const first = addDays(event.recurringStart, offset);
      steppedStarts(first, 7 * event.amount, windowFrom, limit).forEach((key) => candidates.push(key));
    });
  } else if (event.frequency === 'monthly') {
    if (event.dateOfMonth) {
      const anchor = keyToDate(event.recurringStart);
      for (let step = 0; anchor && step < MAX_OCCURRENCES; step++) {
        const month = new Date(anchor.getFullYear(), anchor.getMonth() + step * event.amount, 1);
        const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
        // A 31st simply does not exist in a 30-day month, so that month is skipped rather than clamped to
        // the 30th - clamping would quietly move a fixed-date event.
        if (event.dateOfMonth <= lastDay) {
          const key = toDateKey(new Date(month.getFullYear(), month.getMonth(), event.dateOfMonth));
          if (key > limit) break;
          if (key >= event.recurringStart && key >= windowFrom) candidates.push(key);
        }
        if (toDateKey(month) > limit) break;
      }
    }
  } else {
    steppedStarts(event.recurringStart, event.amount, windowFrom, limit).forEach((key) => candidates.push(key));
  }

  return candidates
    .map((key) => buildOccurrence(key, startMinutes, endMinutes, event.isAllDay))
    .filter(Boolean)
    .filter((occurrence) => occurrence.startKey <= toKey && occurrence.endKey >= fromKey)
    .sort((a, b) => (a.startKey < b.startKey ? -1 : a.startKey > b.startKey ? 1 : 0));
};

// --- per-day segments -------------------------------------------------------

// A midnight-to-midnight span reads as "All day" rather than a bare "12:00 AM →".
const occurrenceIsAllDay = (occurrence) =>
  occurrence.startMinutes === 0 && occurrence.endKey > occurrence.startKey && occurrence.endMinutes === 0;

// What one event shows on ONE day of its span, or null when it does not touch that day.
//
// An event occupies every day it spans, which is the visible difference from a shift. A TIMED span ending
// exactly at midnight does NOT draw on the following day: ending at 00:00 means it finished at the stroke
// of midnight, so the day it would have touched has no part of it. An ALL-DAY span is different - its end
// date is inclusive, so it does draw on it.
const eventSegment = (event, occurrence, dateKey) => {
  if (dateKey < occurrence.startKey || dateKey > occurrence.endKey) return null;

  const isLastDay = dateKey === occurrence.endKey;
  if (!occurrence.allDay && isLastDay && occurrence.endMinutes === 0 && occurrence.endKey !== occurrence.startKey) {
    return null;
  }

  const startsOnDay = dateKey === occurrence.startKey;
  const endsOnDay = isLastDay;

  return {
    eventId: event.id,
    title: event.title,
    color: event.color,
    dateKey,
    startsOnDay,
    endsOnDay,
    continuesBefore: !startsOnDay,
    continuesAfter: !endsOnDay,
    startMinutes: startsOnDay ? occurrence.startMinutes : 0,
    // The part of the day the event covers, clamped for the intersection maths. 1440 means the whole day.
    endMinutes: endsOnDay ? occurrence.endMinutes : 1440,
    occurrenceStartMinutes: occurrence.startMinutes,
    occurrenceEndMinutes: occurrence.endMinutes,
    allDay: occurrence.allDay || occurrenceIsAllDay(occurrence),
  };
};

// Every visible event's segments for a whole window, keyed by date.
//
// Built in ONE pass per event for the window rather than per day: the calendars ask for a month at a
// time, so this is a month of recurrence arithmetic instead of a month times the day count.
export const eventSegmentsByDay = (events, fromKey, toKey, viewer = {}) => {
  const byDay = new Map();

  (Array.isArray(events) ? events : []).forEach((event) => {
    if (!event || !eventVisibleTo(event, viewer)) return;

    eventOccurrencesInWindow(event, fromKey, toKey).forEach((occurrence) => {
      // Start at the window edge when the occurrence began earlier, so the first visible day still gets
      // its continuation segment.
      let key = occurrence.startKey < fromKey ? fromKey : occurrence.startKey;

      for (let guard = 0; key && guard < MAX_OCCURRENCES; guard++) {
        if (key > toKey || key > occurrence.endKey) break;
        const segment = eventSegment(event, occurrence, key);
        if (segment) {
          if (!byDay.has(key)) byDay.set(key, []);
          byDay.get(key).push(segment);
        }
        key = addDays(key, 1);
      }
    });
  });

  // Earliest first, then by title, so the order is stable between renders.
  byDay.forEach((segments) => {
    segments.sort((a, b) =>
      a.startMinutes !== b.startMinutes
        ? a.startMinutes - b.startMinutes
        : String(a.title).localeCompare(String(b.title))
    );
  });

  return byDay;
};

// The segments for one day, for callers that want a single day rather than a map.
export const eventSegmentsForDay = (events, dateKey, viewer = {}) =>
  eventSegmentsByDay(events, dateKey, dateKey, viewer).get(dateKey) || [];

// --- labels -----------------------------------------------------------------

// The time text for one day of an event. Only the day it starts and the day it ends carry a clock, which
// is how a calendar reads: the middle days say "All day" rather than repeating the whole window.
export const eventSegmentTimeLabel = (segment, timeFormat = '12') => {
  if (!segment) return '';
  if (segment.allDay) return 'All day';

  const clock = (minutes) => formatClock(clockFromMinutes(minutes), timeFormat);

  if (segment.startsOnDay && segment.endsOnDay) {
    return `${clock(segment.startMinutes)} – ${clock(segment.endMinutes)}`;
  }
  if (segment.startsOnDay) return `${clock(segment.startMinutes)} →`;
  if (segment.endsOnDay) return `→ ${clock(segment.endMinutes)}`;
  return 'All day';
};

// The title as a calendar draws a multi-day span: ellipses where it continues either side.
export const eventSegmentTitle = (segment) =>
  `${segment?.continuesBefore ? '… ' : ''}${text(segment?.title)}${segment?.continuesAfter ? ' …' : ''}`;

// The shared look for an event pill, so every calendar draws events the same way.
//
// Shifts are SOLID pills with white text, so an event must never be drawn that way - it is "hollow": a
// thin border and a tinted wash in the event's own colour, with the text in that colour too. That is the
// treatment the pending and declined shift states use, which is what makes an event read as information
// rather than as something to act on.
//
// The wash is the colour plus an alpha suffix (`#RRGGBB` + `33` is 20%). One value works on both themes -
// it tints on white and washes over the dark navy - so no per-theme branching is needed, and 8-digit hex
// is supported by every browser that can run this PWA.
export const EVENT_PILL_CLASS =
  'rounded-md border overflow-hidden text-[10px] leading-tight font-medium';

export const eventPillStyle = (color) => {
  const resolved = eventColor(color);
  return { borderColor: resolved, color: resolved, backgroundColor: `${resolved}33` };
};

// What one event pill shows.
//
// The times appear only when the event has any: an all-day event occupies whole days, so printing
// "All day" on every one of them adds nothing the pill's position does not already say (the tooltip
// spells out the range). A span that continues from an earlier or later day gets an arrow - "5:30 PM →"
// or "→ 9:30 PM" - rather than a window that would be read as the wrong day's.
export const eventSegmentLines = (segment, timeFormat = '12') => ({
  title: eventSegmentTitle(segment),
  time: segment && !segment.allDay ? eventSegmentTimeLabel(segment, timeFormat) : '',
});

const ordinal = (day) => {
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`;
  return `${day}${['th', 'st', 'nd', 'rd'][day % 10] || 'th'}`;
};

const weekdayNames = EVENT_WEEKDAYS.map((day) => day.label.slice(0, 3));

// How a repeating event repeats, in words, for the administration list.
export const eventRecurrenceLabel = (event) => {
  if (!event) return '';
  if (!event.isRecurring) return 'Does not repeat';

  const every = event.amount === 1 ? 'Every' : `Every ${event.amount}`;
  const until = event.recurringEnd ? ` until ${displayDate(event.recurringEnd)}` : '';

  if (event.frequency === 'weekly') {
    const days = event.weekdays.slice().sort().map((index) => weekdayNames[index]).join(', ');
    return `${every} week${event.amount === 1 ? '' : 's'} on ${days}${until}`;
  }
  if (event.frequency === 'monthly') {
    return `${every} month${event.amount === 1 ? '' : 's'} on the ${ordinal(event.dateOfMonth || 1)}${until}`;
  }
  return `${every} day${event.amount === 1 ? '' : 's'}${until}`;
};

// The time window alone, with no date.
//
// A repeating event takes only the TIMES from date_from/date_to - the repeat decides the days - so printing
// date_from's date beside them is actively misleading: it names a day the event will never appear on. This is
// what a repeating event should be described with.
export const eventTimesLabel = (event, timeFormat = '12') => {
  if (!event || !event.startsAt) return '';
  if (event.isAllDay) return 'All day';

  const clock = (minutes) => formatClock(clockFromMinutes(minutes), timeFormat);
  const start = event.startsAt.minutes;
  const end = event.endsAt ? event.endsAt.minutes : start;

  // An end at or before the start means it runs past midnight.
  return end > start ? `${clock(start)} – ${clock(end)}` : `${clock(start)} – ${clock(end)} (next day)`;
};

// The first occurrence of a repeating event from `fromKey` onward, or null.
//
// The search horizon is deliberately generous: a yearly-ish gap between the anchor and the first matching
// weekday is impossible (a week at most), but a monthly repeat can be a month away and a bounded repeat may
// have simply finished.
export const eventNextOccurrence = (event, fromKey) => {
  if (!event || !event.isRecurring || !fromKey) return null;
  const horizon = addDays(fromKey, 400);
  if (!horizon) return null;
  return eventOccurrencesInWindow(event, fromKey, horizon)[0] || null;
};

// "Next: Tue, Sep 29 at 5:30 PM", or why there is no next one.
//
// This exists because of a real confusion: a weekly event anchored on a Thursday and set to Tuesdays does not
// appear until the FOLLOWING Tuesday, so an administrator who created it looking at the anchor date finds
// nothing and concludes it did not save. Naming the first day it actually lands on answers that directly.
export const eventNextOccurrenceLabel = (event, { fromKey, timeFormat = '12', prefix = 'Next: ' } = {}) => {
  if (!event || !event.isRecurring) return '';

  const occurrence = eventNextOccurrence(event, fromKey);
  if (!occurrence) return 'No upcoming occurrences';

  // An occurrence that began before today and runs into it is happening now, not "next".
  if (occurrence.startKey < fromKey) return 'Happening now';

  const when = displayDate(occurrence.startKey);
  if (!when) return '';
  if (occurrence.allDay) return `${prefix}${when} (all day)`;

  const clock = formatClock(clockFromMinutes(occurrence.startMinutes), timeFormat);
  return `${prefix}${when} at ${clock}`;
};

// When a NON-repeating event runs: the date and its times. Meaningless for a repeating event, which has no
// single date - use eventRecurrenceLabel + eventTimesLabel for those.
export const eventWindowLabel = (event, timeFormat = '12') => {
  if (!event || !event.startsAt) return '';
  const clock = (minutes) => formatClock(clockFromMinutes(minutes), timeFormat);

  // An all-day event is described by its dates alone; printing a clock would invent a time it does not have.
  if (event.isAllDay) {
    const from = displayDate(event.startsAt.dateKey);
    if (!event.endsAt || event.endsAt.dateKey <= event.startsAt.dateKey) return `${from} (all day)`;
    return `${from} – ${displayDate(event.endsAt.dateKey)} (all day)`;
  }

  const from = `${displayDate(event.startsAt.dateKey)} at ${clock(event.startsAt.minutes)}`;
  if (!event.endsAt) return from;
  const sameDay = event.endsAt.dateKey === event.startsAt.dateKey;
  return sameDay
    ? `${from} – ${clock(event.endsAt.minutes)}`
    : `${from} – ${displayDate(event.endsAt.dateKey)} at ${clock(event.endsAt.minutes)}`;
};
