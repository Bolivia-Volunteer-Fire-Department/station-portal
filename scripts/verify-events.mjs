/**
 * Verifies the Events engine (utils/events).
 *
 * Events are the one feature whose bugs are almost invisible: an event that fails to appear on the third
 * Tuesday looks exactly like an event nobody created. So the recurrence arithmetic is pinned here rather
 * than left to be noticed in the calendar.
 *
 * The other thing worth protecting is the boundary with shifts. An event is decoration: it must never
 * change what is covered, what is open, or who may be offered a shift. The last section asserts that the
 * engine exposes nothing the schedule logic could mistake for a shift.
 *
 * Run with: npm run verify:events
 */
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToString } from 'react-dom/server';
import {
  EVENT_DEFAULT_COLOR,
  EVENT_FREQUENCIES,
  EVENT_WEEKDAYS,
  eventColor,
  eventFlag,
  eventInstant,
  eventOccurrencesInWindow,
  eventNextOccurrenceLabel,
  eventRecurrenceLabel,
  eventSegmentTimeLabel,
  eventSegmentTitle,
  eventSegmentsByDay,
  eventShowsToEveryone,
  eventTimesLabel,
  eventValidation,
  eventVisibilityLabel,
  eventVisibleTo,
  eventWindowLabel,
  normalizeEvent,
  normalizeEventColor,
  normalizeEventList,
  isNormalizedEvent,
  eventSegmentLines,
  eventPillStyle,
  eventAnchorKey,
  sortEvents,
  sortEventsChronologically,
  splitEventsByRecurrence,
  filterEvents,
  emptyEventFilters,
  eventFiltersActive,
  EVENT_SORT_OPTIONS,
  DEFAULT_EVENT_SORT,
  EVENTS_PAGE_SIZE,
} from '../src/utils/events.js';
import { clampPage, pageRangeLabel, pageSlice, totalPages } from '../src/utils/pagination.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${
      ok ? '' : ` (expected ${JSON.stringify(expected)})`
    }`
  );
};

const keysOf = (map) => [...map.keys()].sort();
const titlesOn = (map, key) => (map.get(key) || []).map((segment) => segment.title);

// A single, non-recurring event: 2026-03-14 (a Saturday) 08:00 to 17:00.
const single = (overrides = {}) =>
  normalizeEvent({
    id: '1',
    title: 'Training',
    date_from: '2026-03-14 08:00',
    date_to: '2026-03-14 17:00',
    is_recurring: 'FALSE',
    ...overrides,
  });

// A recurring event. Only the TIMES come from date_from/date_to.
const recurring = (overrides = {}) =>
  normalizeEvent({
    id: '2',
    title: 'Drill',
    date_from: '2026-03-14 09:00',
    date_to: '2026-03-14 11:00',
    is_recurring: 'TRUE',
    recurring_start: '2026-03-01',
    recurring_amount: '1',
    recurring_frequency: 'daily',
    ...overrides,
  });

console.log('--- parsing date/time cells ---');
// The sheet produces both shapes. An ISO instant is UTC and must be read in local time, or a 22:00 event
// would move by the offset.
check('a plain local datetime', eventInstant('2026-03-14 22:00'), { dateKey: '2026-03-14', minutes: 1320 });
check('an ISO instant is read locally', eventInstant('2026-03-14T22:00:00'), {
  dateKey: '2026-03-14',
  minutes: 1320,
});
check('a date with no time is midnight', eventInstant('2026-03-14'), { dateKey: '2026-03-14', minutes: 0 });
check('a bad value is null', eventInstant('next tuesday'), null);
check('an empty value is null', eventInstant(''), null);
check('a 24:00-ish hour is not a time', eventInstant('2026-03-14 24:30'), null);

console.log('\n--- colors ---');
check('a short hex expands', normalizeEventColor('#abc'), '#aabbcc');
check('case is normalised', normalizeEventColor('#AABBCC'), '#aabbcc');
check('a bad value falls back to gray', eventColor('cornflowerblue'), EVENT_DEFAULT_COLOR);
check('a blank value falls back to gray', eventColor(''), EVENT_DEFAULT_COLOR);
check('a good value is kept', eventColor('#123456'), '#123456');

console.log('\n--- flags ---');
check('TRUE text is a flag', eventFlag('TRUE'), true);
check('a padded lowercase true is a flag', eventFlag(' true '), true);
check('FALSE text is not', eventFlag('FALSE'), false);
check('missing is not', eventFlag(undefined), false);

console.log('\n--- normalisation ---');
check('a row with no id is dropped', normalizeEvent({ title: 'x' }), null);
check('a single event with no start is dropped', normalizeEvent({ id: '1', title: 'x' }), null);
check('a recurring event needs only a start DATE', normalizeEvent({
  id: '1',
  title: 'x',
  is_recurring: 'TRUE',
  recurring_start: '2026-03-01',
}).isRecurring, true);
check('a missing title reads as Event', normalizeEvent({
  id: '1',
  title: '   ',
  date_from: '2026-03-01 10:00',
  date_to: '2026-03-01 11:00',
}).title, 'Event');
check('a bad frequency falls back to daily', recurring({ recurring_frequency: 'hourly' }).frequency, 'daily');
check('a zero amount is floored to 1', recurring({ recurring_amount: '0' }).amount, 1);
check('weekday flags become indexes', recurring({ is_tuesday: 'TRUE', is_thursday: 'TRUE' }).weekdays, [2, 4]);
check('a list drops unusable rows', normalizeEventList([null, { id: '' }, { id: '9', title: 'ok', date_from: '2026-03-01' }]).length, 1);

console.log('\n--- a single event occupies every day it spans ---');
// This is the visible difference from a shift, which draws on its start day only.
const multiDay = single({ date_from: '2026-03-01 08:00', date_to: '2026-03-03 17:00' });
const multiMap = eventSegmentsByDay([multiDay], '2026-02-25', '2026-03-10');
check('it appears on all three days', keysOf(multiMap), ['2026-03-01', '2026-03-02', '2026-03-03']);
check('the first day starts it', multiMap.get('2026-03-01')[0].startsOnDay, true);
check('the middle day continues it', multiMap.get('2026-03-02')[0].continuesBefore, true);
check('and continues onward', multiMap.get('2026-03-02')[0].continuesAfter, true);
check('the last day ends it', multiMap.get('2026-03-03')[0].endsOnDay, true);
check('the first day shows its start', eventSegmentTimeLabel(multiMap.get('2026-03-01')[0]), '8:00 AM →');
check('the middle day says All day', eventSegmentTimeLabel(multiMap.get('2026-03-02')[0]), 'All day');
check('the last day shows its end', eventSegmentTimeLabel(multiMap.get('2026-03-03')[0]), '→ 5:00 PM');
check('the title carries continuation marks', eventSegmentTitle(multiMap.get('2026-03-02')[0]), '… Training …');
check('a one-day event has no marks', eventSegmentTitle(multiMap.get('2026-03-01')[0]), 'Training …');

console.log('\n--- an overnight event is on both days ---');
const overnight = single({ date_from: '2026-03-06 22:00', date_to: '2026-03-07 04:00' });
const nightMap = eventSegmentsByDay([overnight], '2026-03-01', '2026-03-10');
check('it is on the start day', keysOf(nightMap), ['2026-03-06', '2026-03-07']);
check('the evening says it starts', eventSegmentTimeLabel(nightMap.get('2026-03-06')[0]), '10:00 PM →');
check('the morning says it ends', eventSegmentTimeLabel(nightMap.get('2026-03-07')[0]), '→ 4:00 AM');

console.log('\n--- ending at midnight does not reach the next day ---');
// Ending at 00:00 means it finished at the stroke of midnight, so the next day has no part of it.
const toMidnight = single({ date_from: '2026-03-06 22:00', date_to: '2026-03-07 00:00' });
check('it stops on the start day', keysOf(eventSegmentsByDay([toMidnight], '2026-03-01', '2026-03-10')), ['2026-03-06']);
// A full midnight-to-midnight span is the same shape, and reads as "All day".
const allDay = single({ date_from: '2026-03-06 00:00', date_to: '2026-03-07 00:00' });
const allDayMap = eventSegmentsByDay([allDay], '2026-03-01', '2026-03-10');
check('a 24-hour event covers one day', keysOf(allDayMap), ['2026-03-06']);
check('and reads as All day', eventSegmentTimeLabel(allDayMap.get('2026-03-06')[0]), 'All day');

console.log('\n--- is_all_day ignores the times entirely ---');
// An explicit all-day flag is not the same as a midnight-to-midnight span: the dates are read
// INCLUSIVELY, so a three-day conference stays on all three days.
const allDayFlagged = (overrides) => normalizeEvent({
  id: '5',
  title: 'Conference',
  is_all_day: 'TRUE',
  date_from: '2026-03-01 09:00',
  date_to: '2026-03-03 16:00',
  ...overrides,
});

check('the flag is read', allDayFlagged().isAllDay, true);
check('a missing flag is not all-day', single().isAllDay, false);
// The times say 09:00 and 16:00, but an all-day event covers the whole day regardless.
const flaggedMap = eventSegmentsByDay([allDayFlagged()], '2026-02-25', '2026-03-10');
check('it covers all three days inclusively', keysOf(flaggedMap), ['2026-03-01', '2026-03-02', '2026-03-03']);
check('the first day reads All day', eventSegmentTimeLabel(flaggedMap.get('2026-03-01')[0]), 'All day');
check('the middle day reads All day', eventSegmentTimeLabel(flaggedMap.get('2026-03-02')[0]), 'All day');
// The end date being inclusive is the whole point: a timed event ending at 16:00 on the 3rd would also be
// on the 3rd, but one ending at 00:00 would not. All-day does not have that hole.
check('the last day is included', flaggedMap.get('2026-03-03')[0].endsOnDay, true);
check('the last day reads All day', eventSegmentTimeLabel(flaggedMap.get('2026-03-03')[0]), 'All day');
check('a single all-day event covers one day', keysOf(eventSegmentsByDay(
  [allDayFlagged({ date_to: '' })], '2026-02-25', '2026-03-10'
)), ['2026-03-01']);
check('an all-day end before the start yields one day', keysOf(eventSegmentsByDay(
  [allDayFlagged({ date_to: '2026-02-20 00:00' })], '2026-02-25', '2026-03-10'
)), ['2026-03-01']);
// A repeating all-day event covers one whole day per occurrence, not a span.
const recurringAllDay = normalizeEvent({
  id: '6',
  title: 'Standby',
  is_all_day: 'TRUE',
  is_recurring: 'TRUE',
  recurring_start: '2026-03-01',
  recurring_amount: '2',
  recurring_frequency: 'daily',
  date_from: '2026-03-01 07:00',
  date_to: '2026-03-01 19:00',
});
check('a repeating all-day event covers each occurrence day', keysOf(eventSegmentsByDay(
  [recurringAllDay], '2026-03-01', '2026-03-07'
)), ['2026-03-01', '2026-03-03', '2026-03-05', '2026-03-07']);
check('and each reads All day', eventSegmentTimeLabel(
  eventSegmentsByDay([recurringAllDay], '2026-03-01', '2026-03-07').get('2026-03-03')[0]
), 'All day');
check('an all-day window label names the dates only', eventWindowLabel(allDayFlagged()), 'Sun, Mar 1 – Tue, Mar 3 (all day)');
check('a one-day all-day window label', eventWindowLabel(allDayFlagged({ date_to: '' })), 'Sun, Mar 1 (all day)');
// The times must not leak into validation for an all-day event.
check('an all-day event needs no end time', eventValidation({
  title: 'Holiday', is_all_day: 'TRUE', date_from: '2026-03-01', date_to: '2026-03-03',
}), '');
check('an all-day event may have no end date at all', eventValidation({
  title: 'Holiday', is_all_day: 'TRUE', date_from: '2026-03-01',
}), '');
check('an all-day end before the start is refused', eventValidation({
  title: 'Holiday', is_all_day: 'TRUE', date_from: '2026-03-03', date_to: '2026-03-01',
}), 'The end has to be on or after the start date.');
check('an all-day event still needs a start', eventValidation({
  title: 'Holiday', is_all_day: 'TRUE', date_from: '',
}), 'A start date and time is required.');

console.log('\n--- daily recurrence ---');
const dailyKeys = (amount, from, to, start = '2026-03-01') =>
  keysOf(eventSegmentsByDay([recurring({ recurring_amount: String(amount), recurring_start: start })], from, to));

check('every day', dailyKeys(1, '2026-03-01', '2026-03-05'), [
  '2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05',
]);
// The example from the request: amount 2, daily, means every OTHER day.
check('every other day', dailyKeys(2, '2026-03-01', '2026-03-07'), [
  '2026-03-01', '2026-03-03', '2026-03-05', '2026-03-07',
]);
check('every third day', dailyKeys(3, '2026-03-01', '2026-03-09'), [
  '2026-03-01', '2026-03-04', '2026-03-07',
]);
// The window is not the anchor: a recurrence part-way through its cycle must still land correctly.
check('the pattern is anchored at the start date', dailyKeys(2, '2026-03-02', '2026-03-06'), [
  '2026-03-03', '2026-03-05',
]);
// A daily event created years ago must still cost nothing extra and skip nothing.
check('a distant start date still lands correctly', dailyKeys(1, '2026-03-01', '2026-03-07', '2020-01-01').length, 7);
check('an indefinite recurrence has no end', recurring().recurringEnd, null);

console.log('\n--- recurring end date ---');
// The end date is INCLUSIVE: an event ending on the 5th still runs on the 5th.
check('the end date is inclusive', keysOf(eventSegmentsByDay(
  [recurring({ recurring_end: '2026-03-05' })], '2026-03-01', '2026-03-10'
)), ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05']);
check('a shorter end date bounds the window', keysOf(eventSegmentsByDay(
  [recurring({ recurring_end: '2026-03-03', title: 'Drill' })],
  '2026-03-01',
  '2026-03-10'
)), ['2026-03-01', '2026-03-02', '2026-03-03']);
check('an end before the start yields nothing', eventSegmentsByDay(
  [recurring({ recurring_end: '2026-02-01' })],
  '2026-03-01',
  '2026-03-10'
).size, 0);

console.log('\n--- weekly recurrence ---');
const weekly = (overrides) => recurring({ recurring_frequency: 'weekly', ...overrides });

// 2026-03-01 is a Sunday, so the first Monday is the 2nd and the first Thursday is the 5th.
check('weekly on Tuesday', keysOf(eventSegmentsByDay(
  [weekly({ recurring_amount: '1', is_tuesday: 'TRUE' })], '2026-03-01', '2026-03-31'
)), ['2026-03-03', '2026-03-10', '2026-03-17', '2026-03-24', '2026-03-31']);
check('every 2 weeks on Mon and Thu', keysOf(eventSegmentsByDay(
  [weekly({ recurring_amount: '2', is_monday: 'TRUE', is_thursday: 'TRUE' })], '2026-03-01', '2026-03-31'
)), ['2026-03-02', '2026-03-05', '2026-03-16', '2026-03-19', '2026-03-30']);
check('a weekly event with no days ticks nothing', eventSegmentsByDay(
  [weekly({ recurring_amount: '1' })], '2026-03-01', '2026-03-31'
).size, 0);

console.log('\n--- monthly recurrence ---');
const monthly = (overrides) => recurring({ recurring_frequency: 'monthly', ...overrides });

check('monthly on the 15th', keysOf(eventSegmentsByDay(
  [monthly({ recurring_amount: '1', date_of_month: '15' })], '2026-03-01', '2026-04-30'
)), ['2026-03-15', '2026-04-15']);
check('every 2 months on the 15th', keysOf(eventSegmentsByDay(
  [monthly({ recurring_amount: '2', date_of_month: '15' })], '2026-03-01', '2026-07-31'
)), ['2026-03-15', '2026-05-15', '2026-07-15']);
// April has 30 days, so a 31st is skipped rather than clamped to the 30th.
check('the 31st skips months without one', keysOf(eventSegmentsByDay(
  [monthly({ recurring_amount: '1', date_of_month: '31' })], '2026-03-01', '2026-06-30'
)), ['2026-03-31', '2026-05-31']);
check('a monthly event with no day of month ticks nothing', eventSegmentsByDay(
  [monthly({ recurring_amount: '1' })], '2026-03-01', '2026-04-30'
).size, 0);

console.log('\n--- visibility ---');
const ranks = [
  { id: '10', description: 'Firefighter', rank_order: '1' },
  { id: '20', description: 'Driver', rank_order: '2' },
  { id: '30', description: 'Officer', rank_order: '3' },
];
const everyone = single();
check('an untargeted event is for everyone', eventShowsToEveryone(everyone), true);
check('and visible to a member with no rank', eventVisibleTo(everyone, { userId: '5', ranks }), true);

// Rank targets mean "this rank AND ABOVE", which is the difference from announcements.
const officerPlus = single({ rank_id: '30' });
check('an Officer sees a rank-3 event', eventVisibleTo(officerPlus, { rankId: '30', ranks }), true);
check('a rank above the target still sees it', eventVisibleTo(
  single({ rank_id: '10' }), { rankId: '30', ranks }
), true);
check('a lower rank does not', eventVisibleTo(officerPlus, { rankId: '10', ranks }), false);
check('a member with no rank does not match a rank target', eventVisibleTo(officerPlus, { rankId: '', ranks }), false);
check('an unknown rank target matches nobody', eventVisibleTo(
  single({ rank_id: '999' }), { rankId: '30', ranks }
), false);

// The three columns are ANDed, so filling two narrows rather than widens.
const both = single({ rank_id: '10', role_id: '7' });
check('both targets must match - role only', eventVisibleTo(both, { roleId: '7', rankId: '30', ranks }), true);
check('both targets must match - wrong role', eventVisibleTo(both, { roleId: '8', rankId: '30', ranks }), false);
check('one member only', eventVisibleTo(single({ user_id: '5' }), { userId: '5', ranks }), true);
check('and not another member', eventVisibleTo(single({ user_id: '5' }), { userId: '6', ranks }), false);

check('the audience label for everyone', eventVisibilityLabel(everyone, { ranks }), 'Everyone');
check('for a rank, with and above', eventVisibilityLabel(
  single({ rank_id: '20' }), { ranks }
), 'Driver rank and above');
check('for a combination', eventVisibilityLabel(
  single({ rank_id: '20', role_id: '7' }), { roles: [{ id: '7', description: 'Member' }], ranks }
), 'Member role, and only Driver rank and above');

// A hidden event must not leak into the map at all.
check('a filtered-out event draws nothing', eventSegmentsByDay(
  [officerPlus], '2026-03-01', '2026-03-31', { rankId: '10', ranks }
).size, 0);

console.log('\n--- validation ---');
const validSingle = {
  title: 'Training',
  date_from: '2026-03-14 08:00',
  date_to: '2026-03-14 17:00',
};
check('a good single event passes', eventValidation(validSingle), '');
check('a title is required', eventValidation({ ...validSingle, title: '  ' }), 'A title is required.');
check('a start is required', eventValidation({ ...validSingle, date_from: '' }), 'A start date and time is required.');
check('an end is required', eventValidation({ ...validSingle, date_to: '' }), 'An end date and time is required.');
check('the end must be after the start', eventValidation({
  ...validSingle, date_to: '2026-03-14 07:00',
}), 'The end has to be after the start.');
check('an equal end is refused', eventValidation({
  ...validSingle, date_to: '2026-03-14 08:00',
}), 'The end has to be after the start.');

const validRecurring = {
  title: 'Drill',
  is_recurring: 'TRUE',
  recurring_start: '2026-03-01',
  recurring_amount: '1',
  recurring_frequency: 'daily',
};
check('a good daily event passes', eventValidation(validRecurring), '');
check('a recurring event needs a start date', eventValidation({
  ...validRecurring, recurring_start: '',
}), 'A start date is required for a recurring event.');
check('a frequency must be chosen', eventValidation({
  ...validRecurring, recurring_frequency: 'hourly',
}), 'Choose how often this event repeats.');
// 0 would mean "never", and a non-numeric amount would silently become 1.
check('an amount below 1 is refused', eventValidation({
  ...validRecurring, recurring_amount: '0',
}), 'Repeat every must be a whole number of 1 or more.');
check('a non-numeric amount is refused', eventValidation({
  ...validRecurring, recurring_amount: 'weekly',
}), 'Repeat every must be a whole number of 1 or more.');
// A weekly event with no day ticked would render NOTHING, which is the hardest kind of bug to spot.
check('a weekly event needs at least one day', eventValidation({
  ...validRecurring, recurring_frequency: 'weekly',
}), 'Tick at least one day of the week for a weekly event, or it would never appear.');
check('a ticked day satisfies it', eventValidation({
  ...validRecurring, recurring_frequency: 'weekly', is_monday: 'TRUE',
}), '');
check('a monthly event needs a day of month', eventValidation({
  ...validRecurring, recurring_frequency: 'monthly',
}), 'Choose a day of the month between 1 and 31.');
check('a day of 32 is refused', eventValidation({
  ...validRecurring, recurring_frequency: 'monthly', date_of_month: '32',
}), 'Choose a day of the month between 1 and 31.');
check('the repeat cannot end before it starts', eventValidation({
  ...validRecurring, recurring_end: '2026-02-01',
}), 'The repeat cannot end before it starts.');
check('a single event ignores the recurrence fields', eventValidation({
  ...validSingle, recurring_amount: '0', recurring_frequency: 'nonsense',
}), '');

console.log('\n--- labels ---');
check('a single event window', eventWindowLabel(single()), 'Sat, Mar 14 at 8:00 AM – 5:00 PM');
check('a repeating daily event', eventRecurrenceLabel(recurring()), 'Every day');
check('every other day', eventRecurrenceLabel(recurring({ recurring_amount: '2' })), 'Every 2 days');
check('weekly with days', eventRecurrenceLabel(weekly({
  recurring_amount: '2', is_monday: 'TRUE', is_thursday: 'TRUE', recurring_end: '2026-06-30',
})), 'Every 2 weeks on Mon, Thu until Tue, Jun 30');
check('monthly with an ordinal', eventRecurrenceLabel(monthly({
  recurring_amount: '1', date_of_month: '15',
})), 'Every month on the 15th');
check('the 11th is not the 11st', eventRecurrenceLabel(monthly({
  recurring_amount: '1', date_of_month: '11',
})), 'Every month on the 11th');
check('the 1st is the 1st', eventRecurrenceLabel(monthly({
  recurring_amount: '1', date_of_month: '1',
})), 'Every month on the 1st');
check('a single event does not repeat', eventRecurrenceLabel(single()), 'Does not repeat');

console.log('\n--- an event is never a shift ---');
// Events are decoration. Nothing here may be usable by the schedule logic, or an event could change what
// is covered, what is open, or who may be offered a shift - the one way this feature could do real harm.
const eventSource = readFileSync('src/utils/events.js', 'utf8');
check('the engine does not import the shift placement rule', /from '\.\/shiftPlacement'/.test(eventSource), false);
check('the engine does not import availability', /from '\.\/availability'/.test(eventSource), false);
check('the engine does not import the offer logic', /from '\.\/shiftOfferRow'/.test(eventSource), false);
check('the engine exports nothing shift-shaped', /export const event(Slot|Coverage|Offer)/i.test(eventSource), false);
// A shift is placed by its start day; an event occupies every day it spans. The two rules must not merge.
const placementSource = readFileSync('src/utils/shiftPlacement.js', 'utf8');
check('the shift placement rule knows nothing about events', /event/i.test(placementSource), false);
console.log('\n--- the backend enforces the same rules ---');
// The client rules are convenience; the server is the control. These read Code.gs directly, because a rule
// that only exists in the browser is not a rule.
const codeSource = readFileSync('src/services/Code.gs', 'utf8');
const caseOf = (name) => {
  const start = codeSource.indexOf(`case "${name}"`);
  if (start === -1) return '';
  const end = codeSource.indexOf('\n      case "', start + 1);
  return codeSource.slice(start, end === -1 ? undefined : end);
};

['GET_EVENTS', 'ADMIN_GET_EVENTS', 'ADMIN_SAVE_EVENT', 'ADMIN_DELETE_EVENT'].forEach((name) => {
  check(`the ${name} action exists`, codeSource.includes(`case "${name}"`), true);
});
['ADMIN_GET_EVENTS', 'ADMIN_SAVE_EVENT', 'ADMIN_DELETE_EVENT'].forEach((name) => {
  check(`${name} requires can_create_events`, /can_create_events/.test(caseOf(name)), true);
});
// Reading is open to any signed-in member - a calendar nobody can see is pointless - but never anonymous.
check('GET_EVENTS requires a session', /getAuthContext/.test(caseOf('GET_EVENTS')), true);
check('and does not demand a permission', /can_create_events/.test(caseOf('GET_EVENTS')), false);
check('the member read is audience-filtered', /eventsForViewer\(/.test(caseOf('GET_EVENTS')), true);
check('the admin read is unfiltered', /getSheetData\(ss, "events"\)/.test(caseOf('ADMIN_GET_EVENTS')), true);
// The author cannot be forged or reassigned.
check('the author is stamped from the session on create', /eventFields\.author_user_id = authEventSave\.userId/.test(codeSource), true);
check('and dropped on update', /delete eventFields\.author_user_id/.test(codeSource), true);
check('the save action validates before writing', /eventValidationError\(eventFields\)/.test(caseOf('ADMIN_SAVE_EVENT')), true);
check('the rank rule needs rank orders, not ids', /rank_order/.test(codeSource.slice(codeSource.indexOf('function eventsForViewer'), codeSource.indexOf('function eventsForViewer') + 900)), true);

console.log('\n--- the client sends what the backend expects ---');
const apiSource = readFileSync('src/services/api.js', 'utf8');
['fetchEvents', 'adminFetchEvents', 'adminSaveEvent', 'adminDeleteEvent'].forEach((name) => {
  check(`api.js exports ${name}`, new RegExp(`export const ${name} =`).test(apiSource), true);
});
// The weekday flags are enumerated from the catalogue rather than listed by hand - the mistake that broke
// the notification preferences. Scoped to the events payload: api.js also saves shift templates, which
// legitimately name their own weekday columns.
check('the weekday fields are derived, not hand-written', /eventWeekdayFields/.test(apiSource) && /EVENT_WEEKDAYS\.forEach/.test(apiSource), true);
const saveEventBlock = apiSource.slice(
  apiSource.indexOf('export const adminSaveEvent'),
  apiSource.indexOf('export const adminDeleteEvent')
);
check('the events payload was found', saveEventBlock.length > 100, true);
check('and names no weekday column by hand', /is_(sun|mon|tues|wednes|thurs|fri|satur)day/.test(saveEventBlock), false);

console.log('\n--- the calendar draws events, and they are not shifts ---');
const calendarSource = readFileSync('src/components/ScheduleCalendar.jsx', 'utf8');
// Counts real `<ViewToggle` JSX tags. The trailing whitespace matters: a plain /<ViewToggle/ also matches a
// renamed `<ViewToggleLEGACY`, which made the "the board uses the shared toggle" assertion pass when the board
// had been reverted to its own markup. Found by bite-testing that exact change.
const viewToggleCalls = (source) => (String(source).match(/<ViewToggle[\s\n]/g) || []).length;
// The shared event pill, read once here because assertions across the whole file refer to it. Comments are
// stripped before any markup search: a comment that merely *mentions* "<button>" would otherwise match.
const pillSource = readFileSync('src/components/EventPill.jsx', 'utf8');
const pillCode = pillSource.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
// Every other source this file reads, declared together HERE rather than next to the section that uses it.
// Twice now an insert has pushed a declaration below its first use, which reads as `undefined` (not a TDZ
// error, because the bundler emits `var`) and makes a correct assertion fail for the wrong reason.
const availabilitySource = readFileSync('src/components/AvailabilityCalendar.jsx', 'utf8');
const boardSource = readFileSync('src/components/admin/AdminScheduleManagementTab.jsx', 'utf8');
const printSource = readFileSync('src/utils/printSchedule.js', 'utf8');
const viewToggleSource = readFileSync('src/components/ViewToggle.jsx', 'utf8');
const viewToggleCode = viewToggleSource.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
check('the calendar takes an events prop', /events = \[\]/.test(calendarSource), true);
check('it groups them by day', /eventSegmentsByDay\(/.test(calendarSource), true);
// The pills must be drawn, and drawn ABOVE the shift pills, so an event is never mistaken for a shift.
// Anchored on the pill loop itself: the day cell also calls dayAssignments.map() for its tooltip, which
// comes first and would make this pass for the wrong reason.
check('it renders an event pill', /<EventPill/.test(calendarSource), true);
check('events are drawn before the shifts', calendarSource.indexOf('eventSegmentsByDate.get(key)') < calendarSource.indexOf('dayAssignments.map((a) => {'), true);
// The hide toggle is a view choice, not a setting: nothing about it may be persisted.
check('the events switch exists', /noun="events"/.test(calendarSource), true);
// The switch defaults ON, and the verb follows the STATE rather than being fixed: while the events are shown
// the button reads "Hide events", and it flips to "Show events" when they are hidden. A button still reading
// "Show events" while it is showing them reads as a promise it has already kept.
check('the switch defaults to showing', /const \[showEvents, setShowEvents\] = useState\(true\)/.test(calendarSource), true);
check('and passes showEvents straight through', /enabled=\{showEvents\}/.test(calendarSource), true);
check('so no label inverts it', /enabled=\{!showEvents\}/.test(calendarSource), false);
// Both view toggles share one container on My Schedule, rather than two separate rows.
check('the two view toggles share a container', /canViewFullSchedule \|\| events\.length > 0/.test(calendarSource), true);
check(
  'and are laid out side by side',
  /flex flex-wrap items-center gap-3[\s\S]{0,900}noun="everyone"[\s\S]{0,900}noun="events"/.test(calendarSource),
  true
);
// Both are the shared chip, so neither can drift into a different treatment - which is what the request was
// about. The board and the availability grid use the same component, checked further down once their sources
// are read.
check('and both use the shared view toggle', viewToggleCalls(calendarSource), 2);
check('and it is shown only when there are events', /events\.length > 0 && \(/.test(calendarSource), true);
check('and it is not persisted', /localStorage[\s\S]{0,200}showEvents/.test(calendarSource), false);
// An event must not be offerable: the offer machinery keys off assignments, and events must not reach it.
check('events are not turned into offerable rows', /events?[\s\S]{0,80}isOpen: true/.test(calendarSource), false);

console.log('\n--- the app feeds the calendar ---');
const appSource = readFileSync('src/App.jsx', 'utf8');
check('App fetches events', /fetchEvents\(/.test(appSource), true);
check('App holds them in state', /const \[events, setEvents\]/.test(appSource), true);
check('App normalises what it stores', /setEvents\(normalizeEventList\(data\.events\)\)/.test(appSource), true);
check('and passes them to the schedule calendar', /events=\{events\}/.test(appSource), true);
check('with the viewer audience', /eventAudience=\{announcementAudience\}/.test(appSource), true);
// The calendar normalises as well, so it is right whichever caller hands it rows.
check('the calendar normalises defensively', /useMemo\(\(\) => normalizeEventList\(events\)/.test(calendarSource), true);

console.log('\n--- rendered: the pills actually appear ---');
// The engine can be perfect and still show nothing if a raw sheet row reaches it, which is exactly what
// happened: the engine reads isAllDay/startsAt, and a raw row has is_all_day/date_from. So the rendering is
// exercised here rather than assumed, in the CURRENT month, because the calendar opens on today's.
const { default: ScheduleCalendar } = await import('../src/components/ScheduleCalendar.jsx');
const { default: AdminEventsTab } = await import('../src/components/admin/AdminEventsTab.jsx');

const now = new Date();
const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const monthDay = (n) => `${monthKey}-${String(n).padStart(2, '0')}`;

// Deliberately RAW rows, shaped like the sheet, to prove the component copes without being pre-normalised.
// The rendered toggle text, with React's SSR separators removed.
//
// `{enabled ? 'Hide' : 'Show'} {noun}` renders as `Hide<!-- --> <!-- -->events`, so the label never appears as
// one string in the HTML. Stripping the markers (and NOT the tags - chipTagFor needs those) is what makes
// "Hide events" findable.
const plain = (html) => String(html).replace(/<!--[\s\S]*?-->/g, '');

const renderedCalendar = renderToString(
  React.createElement(ScheduleCalendar, {
    currentUser: { id: '1', name: 'Member 1', rank_id: '10' },
    ranks: [{ id: '10', description: 'Firefighter', rank_order: '1' }],
    token: 'T',
    events: [
      { id: '3', title: 'Conference', is_all_day: 'TRUE', date_from: `${monthDay(2)} 09:00`, date_to: `${monthDay(4)} 16:00` },
    ],
    eventAudience: { roleId: '', rankId: '10', userId: '1', ranks: [] },
    timeFormat: '12',
  })
);

check('the calendar renders', renderedCalendar.length > 500, true);
check('and shows the event pill', renderedCalendar.includes('Conference'), true);
// A three-day span has continuation marks, which is what makes it read as one event rather than three.
check('with continuation marks', renderedCalendar.includes('…'), true);
// Events are shown by default, so the button offers the opposite: "Hide events".
check('and the events switch', plain(renderedCalendar).includes('Hide events'), true);
// A hidden event must not be drawn at all, and the toggle must still be there to bring it back.
const hiddenCalendar = renderToString(
  React.createElement(ScheduleCalendar, {
    currentUser: { id: '1', name: 'Member 1', rank_id: '10' },
    ranks: [{ id: '10', description: 'Firefighter', rank_order: '1' }],
    token: 'T',
    events: [{ id: '3', title: 'Conference', is_all_day: 'TRUE', date_from: monthDay(2), date_to: monthDay(4) }],
    eventAudience: { roleId: '', rankId: '10', userId: '1', ranks: [] },
  })
);
// (The toggle is a controlled child, so this only proves the pill is present by default; the hidden state
// needs a click, which SSR cannot do. The source assertion above covers `showEvents`.)
check('an all-day single-date event still renders', hiddenCalendar.includes('Conference'), true);

// THE APP'S ACTUAL PATH, and the test whose absence let a total failure ship.
//
// App.jsx stores `normalizeEventList(data.events)`, and every calendar then normalises again defensively.
// Re-parsing an already-normalised event used to return null - the function reads the sheet's raw column
// names while a normalised event is camelCase - so EVERY event was erased on every calendar, while both
// halves passed their own tests: the raw-row render above, and the normaliser's own unit tests.
const weekdayKeys = [
  'is_sunday', 'is_monday', 'is_tuesday', 'is_wednesday', 'is_thursday', 'is_friday', 'is_saturday',
];
const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
const weeklyRow = {
  id: '42',
  title: 'Weekly training',
  is_recurring: 'TRUE',
  date_from: `${monthDay(1)} 17:30`,
  date_to: `${monthDay(1)} 21:30`,
  recurring_start: monthDay(1),
  recurring_frequency: 'weekly',
  recurring_amount: '1',
  [weekdayKeys[firstOfMonth.getDay()]]: 'TRUE',
};

check('normalising an event twice keeps it', normalizeEventList(normalizeEventList([weeklyRow])).length, 1);
check(
  'and a normalised event is recognised',
  isNormalizedEvent(normalizeEventList([weeklyRow])[0]),
  true
);
check('while a raw row is not', isNormalizedEvent(weeklyRow), false);

const normalizedCalendar = renderToString(
  React.createElement(ScheduleCalendar, {
    currentUser: { id: '1', name: 'Member 1', rank_id: '10' },
    ranks: [{ id: '10', description: 'Firefighter', rank_order: '1' }],
    token: 'T',
    // Exactly what App.jsx hands the calendar: already normalised.
    events: normalizeEventList([weeklyRow]),
    eventAudience: { roleId: '', rankId: '10', userId: '1', ranks: [] },
    timeFormat: '12',
  })
);
check('a pre-normalised weekly event still renders', normalizedCalendar.includes('Weekly training'), true);

// The pill's OWN contents, from its title span to the end of the pill.
//
// Asserted this way because the pill's tooltip carries the times too - a whole-page search for "5:30 PM –
// 9:30 PM" passes even with the pill's time line removed, which is a false pass this caught.
const pillBody = (html, label) => {
  const at = html.indexOf(`>${label}<`);
  return at === -1 ? '' : html.slice(at, html.indexOf('</div>', at));
};

const pillText12 = pillBody(normalizedCalendar, 'Weekly training');
check('the pill body was found', pillText12.length > 5, true);
check('and shows the times on the pill itself', pillText12.includes('5:30 PM – 9:30 PM'), true);
// The same event read in 24-hour format, from the member's own preference.
const twentyFourHourCalendar = renderToString(
  React.createElement(ScheduleCalendar, {
    currentUser: { id: '1', name: 'Member 1', rank_id: '10' },
    ranks: [{ id: '10', description: 'Firefighter', rank_order: '1' }],
    token: 'T',
    events: normalizeEventList([weeklyRow]),
    eventAudience: { roleId: '', rankId: '10', userId: '1', ranks: [] },
    timeFormat: '24',
  })
);
check('and honors a 24-hour preference', pillBody(twentyFourHourCalendar, 'Weekly training').includes('17:30 – 21:30'), true);
// An all-day event has no time to show, so the pill carries its title alone. The tooltip legitimately still
// says "All day", which is why this too is asserted on the pill rather than the page.
const allDayCalendar = renderToString(
  React.createElement(ScheduleCalendar, {
    currentUser: { id: '1', name: 'Member 1', rank_id: '10' },
    ranks: [{ id: '10', description: 'Firefighter', rank_order: '1' }],
    token: 'T',
    events: normalizeEventList([
      { id: '9', title: 'Muster', is_all_day: 'TRUE', date_from: monthDay(3), date_to: monthDay(3) },
    ]),
    eventAudience: { roleId: '', rankId: '10', userId: '1', ranks: [] },
    timeFormat: '12',
  })
);
check('an all-day event shows its title', allDayCalendar.includes('Muster'), true);
const allDayPill = pillBody(allDayCalendar, 'Muster');
check('the all-day pill was found', allDayPill.length > 5, true);
check('and carries no clock on it', /\d{1,2}:\d{2}/.test(allDayPill), false);

console.log('\n--- sorting, filtering and the two cards ---');
// A minimal event shape to sort and filter with. Declared here rather than further down because the two
// sections below both use it.
const anchorEvent = (over = {}) => ({
  id: '1', title: 'X', isRecurring: false, startsAt: { dateKey: '2026-03-10', minutes: 600 }, ...over,
});
// Sorting. The direction is a parameter of the comparison, so "latest first" must NOT carry the undated rows to
// the top - the trap that reversing a comparator would spring.
const sortable = [
  anchorEvent({ id: 'mid', title: 'Mid', startsAt: { dateKey: '2026-03-10', minutes: 600 } }),
  anchorEvent({ id: 'early', title: 'Early', startsAt: { dateKey: '2026-01-05', minutes: 600 } }),
  anchorEvent({ id: 'undated', title: 'Zundated', startsAt: null }),
  anchorEvent({ id: 'late', title: 'Alate', startsAt: { dateKey: '2026-05-01', minutes: 600 } }),
];
check('the default sort is earliest first', DEFAULT_EVENT_SORT, 'date_asc');
check('and that is what the default gives', sortEvents(sortable).map((e) => e.id), ['early', 'mid', 'late', 'undated']);
check('latest first reverses the dates', sortEvents(sortable, 'date_desc').map((e) => e.id), ['late', 'mid', 'early', 'undated']);
check('but the undated row still sorts last', sortEvents(sortable, 'date_desc').at(-1).id, 'undated');
check('title order is alphabetical', sortEvents(sortable, 'title_asc').map((e) => e.title), ['Alate', 'Early', 'Mid', 'Zundated']);
check('an unknown sort falls back to the default', sortEvents(sortable, 'nonsense').map((e) => e.id), ['early', 'mid', 'late', 'undated']);
check('every sort mode is offered in the UI', EVENT_SORT_OPTIONS.map((o) => o.value), ['date_asc', 'date_desc', 'title_asc']);

// Filtering. A date range uses the same anchor the ordering does, so the two agree about when an event happens.
const filterable = [
  anchorEvent({ id: 'jan', startsAt: { dateKey: '2026-01-05', minutes: 600 } }),
  anchorEvent({ id: 'mar', startsAt: { dateKey: '2026-03-10', minutes: 600 } }),
  anchorEvent({ id: 'may', startsAt: { dateKey: '2026-05-01', minutes: 600 } }),
  anchorEvent({ id: 'undated', startsAt: null }),
];
const idsOf = (list) => list.map((e) => e.id);
check('no filters matches everything', idsOf(filterEvents(filterable, emptyEventFilters())), ['jan', 'mar', 'may', 'undated']);
check('a start date excludes what is before it', idsOf(filterEvents(filterable, { from: '2026-03-01' })), ['mar', 'may']);
check('an end date excludes what is after it', idsOf(filterEvents(filterable, { to: '2026-03-31' })), ['jan', 'mar']);
check('and both ends together are a range', idsOf(filterEvents(filterable, { from: '2026-02-01', to: '2026-04-01' })), ['mar']);
// An event with no readable date cannot be shown to fall inside a range, so it is excluded rather than included
// on the assumption it might.
check('an undated event is excluded once a range is set', idsOf(filterEvents(filterable, { from: '2026-01-01' })), ['jan', 'mar', 'may']);
check('the default filters are all empty', Object.values(emptyEventFilters()).every((v) => v === ''), true);
check('and are reported as inactive', eventFiltersActive(emptyEventFilters()), false);
check('until one is set', eventFiltersActive({ from: '2026-01-01' }), true);
check('the sort is not a filter', eventFiltersActive({ audience: '' }), false);

// The audience filter, which is the one that speaks to targeting.
const targetedFixture = anchorEvent({ id: 'targeted', role_id: '1', startsAt: { dateKey: '2026-03-10', minutes: 600 } });
const untargetedFixture = anchorEvent({ id: 'everyone', startsAt: { dateKey: '2026-03-10', minutes: 600 } });
check('targeted events are found', idsOf(filterEvents([targetedFixture, untargetedFixture], { audience: 'targeted' })), ['targeted']);
check('and untargeted ones are found', idsOf(filterEvents([targetedFixture, untargetedFixture], { audience: 'everyone' })), ['everyone']);

// The split. Both lists are drawn by the same card component, so the split is the only thing that decides which
// event appears where.
const split = splitEventsByRecurrence([
  recurring({ id: 'r1' }),
  single({ id: 's1' }),
  single({ id: 's2' }),
]);
check('one-off events are separated', split.oneOff.map((e) => e.id), ['s1', 's2']);
check('and repeating ones are separated', split.recurring.map((e) => e.id), ['r1']);
check('a null list splits into two empty lists', splitEventsByRecurrence(null), { oneOff: [], recurring: [] });

// Wiring: the two cards are rendered, paged independently, and share one row component rather than duplicating
// the markup - a copy is how these calendars drifted apart earlier in this feature. (Asserted further down, where
// the tab's source is read.)

console.log('\n--- the administration list: chronological, one page at a time ---');
// The list an administrator reads against a calendar: earliest first, undated last, and paged so a station
// with a weekly training does not scroll forever. (anchorEvent is declared with the sorting section above.)
check('an event is anchored on its start date', eventAnchorKey(anchorEvent()), '2026-03-10');
// A repeating event is anchored on the REPEAT's start, not date_from: that column holds the anchor only to
// carry the times, so sorting by it would file "every Tuesday" under the day the form was open.
check(
  'a repeating event is anchored on its repeat',
  eventAnchorKey(
    anchorEvent({ isRecurring: true, recurringStart: '2026-01-06', startsAt: { dateKey: '2026-03-10', minutes: 600 } })
  ),
  '2026-01-06'
);
check('an event with no date is anchored on nothing', eventAnchorKey({ id: '9', title: 'X' }), '');
check('and nothing is not an error', eventAnchorKey(null), '');

const ordered = sortEventsChronologically([
  anchorEvent({ id: 'c', title: 'March', startsAt: { dateKey: '2026-03-10', minutes: 600 } }),
  anchorEvent({ id: 'a', title: 'January', startsAt: { dateKey: '2026-01-05', minutes: 600 } }),
  anchorEvent({ id: 'b', title: 'February', startsAt: { dateKey: '2026-02-02', minutes: 600 } }),
]);
check('the list reads earliest first', ordered.map((e) => e.title), ['January', 'February', 'March']);

const withUndated = sortEventsChronologically([
  anchorEvent({ id: 'x', title: 'No date', startsAt: null }),
  anchorEvent({ id: 'y', title: 'Dated', startsAt: { dateKey: '2026-01-05', minutes: 600 } }),
]);
check('an undated event sorts last, not first', withUndated.map((e) => e.title), ['Dated', 'No date']);

const sameDay = sortEventsChronologically([
  anchorEvent({ id: 'late', title: 'Evening', startsAt: { dateKey: '2026-03-10', minutes: 1080 } }),
  anchorEvent({ id: 'early', title: 'Morning', startsAt: { dateKey: '2026-03-10', minutes: 480 } }),
]);
check('the same day is ordered by time', sameDay.map((e) => e.title), ['Morning', 'Evening']);

const tie = sortEventsChronologically([
  anchorEvent({ id: 'z', title: 'Bravo' }),
  anchorEvent({ id: 'y', title: 'Alpha' }),
]);
check('a dead heat falls back to the title', tie.map((e) => e.title), ['Alpha', 'Bravo']);
// Stable means the sheet's row order cannot change the reading: the same two events in either order sort the
// same way. Without the id tiebreak two identical rows could swap places between renders.
check(
  'and two identical rows keep a fixed order',
  sortEventsChronologically([anchorEvent({ id: '2' }), anchorEvent({ id: '1' })]).map((e) => e.id),
  ['1', '2']
);

const originalOrder = [anchorEvent({ id: 'b' }), anchorEvent({ id: 'a' })];
sortEventsChronologically(originalOrder);
check('sorting does not mutate its input', originalOrder.map((e) => e.id), ['b', 'a']);
check('and a null list is empty rather than a crash', sortEventsChronologically(null), []);

// Paging. The arithmetic is shared with the System Log (utils/pagination), so these pin the EVENTS side of
// that contract: the page size, the guard on an out-of-range page, and the range label.
check('the events list pages by twenty', EVENTS_PAGE_SIZE, 20);
check('an empty list still has one page', totalPages(0, EVENTS_PAGE_SIZE), 1);
check('and forty rows have two', totalPages(40, EVENTS_PAGE_SIZE), 2);
check('a page past the end clamps to the last one', clampPage(9, 40, EVENTS_PAGE_SIZE), 2);
check('a page below one clamps to the first', clampPage(0, 40, EVENTS_PAGE_SIZE), 1);
check('the range says which rows are on screen', pageRangeLabel(45, 2, EVENTS_PAGE_SIZE), '21–40 of 45');
// The clamp is what stops a delete from leaving an empty table: page 2 of a list that is now one page long
// must show the rows that DO exist rather than nothing.
const rowsForPaging = Array.from({ length: 25 }, (unused, index) => index + 1);
check('an out-of-range page returns the last rows, not none', pageSlice(rowsForPaging, 5, EVENTS_PAGE_SIZE), [21, 22, 23, 24, 25]);
check('and page one is the first twenty', pageSlice(rowsForPaging, 1, EVENTS_PAGE_SIZE).length, 20);

const eventsListSource = readFileSync('src/components/admin/AdminEventsTab.jsx', 'utf8');
check('the tab orders its rows chronologically', /sortEvents\(rows, sort\)/.test(eventsListSource), true);
check(
  'and the cards render their own page, not every row',
  /visible=\{oneOffVisible\}/.test(eventsListSource) &&
    /visible=\{recurringVisible\}/.test(eventsListSource) &&
    /visible\.map\(/.test(eventsListSource),
  true
);
check('the pager is hidden on a single page', /pageCount > 1 &&/.test(eventsListSource), true);
check(
  'and shows the range and the page number',
  /\{pageRangeLabel\(/.test(eventsListSource) && /Page \{page\} of \{pageCount\}/.test(eventsListSource),
  true
);

// The two cards: one-off events and repeating ones, drawn by one shared shell and one shared row.
check('the one-off card is rendered', /title="One-off events"/.test(eventsListSource), true);
check('the repeating card is rendered', /title="Repeating events"/.test(eventsListSource), true);
check(
  'the rows are rendered by one shared component',
  /function EventRow\(/.test(eventsListSource) && /function EventListCard\(/.test(eventsListSource),
  true
);
// One delete control in the file means the row markup exists once: a second copy is how the calendars drifted.
check('and the row markup exists only once', (eventsListSource.match(/title="Delete"/g) || []).length, 1);
// Two page numbers, because the two lists are independent: paging the long list must not move the short one.
check(
  'each card owns its page',
  /const \[oneOffPage, setOneOffPage\]/.test(eventsListSource) &&
    /const \[recurringPage, setRecurringPage\]/.test(eventsListSource),
  true
);
check('both are clamped to their own list', (eventsListSource.match(/clampPage\((oneOffPage|recurringPage), /g) || []).length, 2);
check('the shared card pages its own rows', (eventsListSource.match(/pageRangeLabel\(rows\.length, page, EVENTS_PAGE_SIZE\)/g) || []).length, 1);
// A filter change must not leave you on a page the new result does not have, and should start you at the
// beginning of a result you have not seen. The clamp handles the first, updateFilters the second.
check('changing a filter returns to the first page', /setFilters\(next\);\s*\n\s*setOneOffPage\(1\);\s*\n\s*setRecurringPage\(1\);/.test(eventsListSource), true);
// Four call sites: the three filter controls plus Clear filters. Sort is deliberately excluded - re-sorting keeps
// the same rows, so there is nothing to send you back to page one for.
check('every filter control uses it', (eventsListSource.match(/updateFilters\(/g) || []).length, 4);

console.log('\n--- one shared view toggle ---');
// All four view toggles ("Show everyone" and the three "Show events") render through ViewToggle, so they are
// identical by construction rather than by three people keeping three copies in step.
check('the toggle is a button', /<button/.test(viewToggleCode), true);
// The verb follows the STATE, derived in this one place: "Show events" while hidden, "Hide events" while shown.
// A call site passes the noun only, so it cannot pair the wrong verb with the wrong state.
check('the verb follows the state', /\{enabled \? 'Hide' : 'Show'\} \{noun\}/.test(viewToggleCode), true);
check('and the tooltip is unchanged by it', /title=\{description\}/.test(viewToggleCode), true);
check('no call site hard-codes a verb', viewToggleCalls(calendarSource) + viewToggleCalls(availabilitySource) + viewToggleCalls(boardSource), 4);
['src/components/ScheduleCalendar.jsx', 'src/components/AvailabilityCalendar.jsx', 'src/components/admin/AdminScheduleManagementTab.jsx'].forEach((file) => {
  check(`${file} passes a noun, not a label`, /noun="(events|everyone)"/.test(readFileSync(file, 'utf8')), true);
});
check('with a pressed state for assistive tech', /aria-pressed=\{enabled\}/.test(viewToggleCode), true);
check('it flips the value it was given', /onChange\(!enabled\)/.test(viewToggleCode), true);
check('a pressed toggle is filled', /bg-slate-200 dark:bg-slate-600/.test(viewToggleCode), true);
check('and an unpressed one is outlined', /border-slate-200 dark:border-slate-700/.test(viewToggleCode), true);
check('the description becomes the tooltip', /title=\{description\}/.test(viewToggleCode), true);
check('an icon is optional', /\{Icon && <Icon/.test(viewToggleCode), true);
// Every screen that offers a view toggle uses this component, so the three are identical by construction.
check('the availability grid uses it too', viewToggleCalls(availabilitySource), 1);
check('and so does the board', viewToggleCalls(boardSource), 1);
check('and My Schedule uses it twice', viewToggleCalls(calendarSource), 2);
// Settings keep the switch, because those persist. A pressed chip would read as a temporary filter.
check('preference switches are left alone', /<ToggleSwitch/.test(readFileSync('src/components/UserSettings.jsx', 'utf8')), true);
// The rendered controls must carry the pressed state, not just the source. Rendered with the crew permission so
// BOTH toggles appear - that is the pairing the request was about. "Show everyone" starts OFF and "Show events"
// starts ON, so both states are represented: that is the assertion, not merely "a chip appeared".
const renderedWithCrew = renderToString(
  React.createElement(ScheduleCalendar, {
    currentUser: { id: '1', name: 'Member 1', rank_id: '10' },
    ranks: [{ id: '10', description: 'Firefighter', rank_order: '1' }],
    token: 'T',
    canViewFullSchedule: true,
    events: normalizeEventList([weeklyRow]),
    eventAudience: { roleId: '', rankId: '10', userId: '1', ranks: [] },
    timeFormat: '12',
  })
);
check('the rendered events toggle is pressed by default', /aria-pressed="true"/.test(renderedCalendar), true);
// The two toggles start in OPPOSITE states (everyone off, events on), so their verbs must differ - and this is
// what proves the verb follows the state rather than being a fixed string: "Show everyone" beside
// "Hide events".
check('the rendered everyone toggle reads Show while hidden', plain(renderedWithCrew).includes('Show everyone'), true);
check('and the rendered events toggle reads Hide while shown', plain(renderedWithCrew).includes('Hide events'), true);
check('both rendered toggles are chips', (renderedWithCrew.match(/aria-pressed="/g) || []).length, 2);

// Each chip's OWN attributes, taken from its opening <button> tag.
//
// A window of characters before the label is the wrong tool: these chips carry an inline SVG (400+ characters),
// and a budget that happened to fit the small icon failed on the large one. Slicing the tag is exact.
const chipTagFor = (html, label) => {
  const at = plain(html).indexOf(label);
  if (at === -1) return '';
  const start = plain(html).lastIndexOf('<button', at);
  return start === -1 ? '' : plain(html).slice(start, at);
};
check('the events chip is pressed', /aria-pressed="true"/.test(chipTagFor(renderedWithCrew, 'Hide events')), true);
check('and the everyone chip is not', /aria-pressed="false"/.test(chipTagFor(renderedWithCrew, 'Show everyone')), true);
check('both chips offer their description as a tooltip', /title="Include every member/.test(chipTagFor(renderedWithCrew, 'Show everyone')), true);


// The times line comes from one helper, so "show the times unless there are none" is decided in one place.
const timedSegment = { allDay: false, startsOnDay: true, endsOnDay: true, startMinutes: 1050, endMinutes: 1290 };
check('a timed segment carries its window', eventSegmentLines(timedSegment, '12').time, '5:30 PM – 9:30 PM');
check('and in 24-hour', eventSegmentLines(timedSegment, '24').time, '17:30 – 21:30');
check('an all-day segment carries no time', eventSegmentLines({ allDay: true }, '12').time, '');
check('a span continuing onward arrow-tails', eventSegmentLines({ ...timedSegment, endsOnDay: false, continuesAfter: true }, '12').time, '5:30 PM →');
check('and one continuing from before arrow-heads', eventSegmentLines({ ...timedSegment, startsOnDay: false, continuesBefore: true }, '12').time, '→ 9:30 PM');
check('the title still carries the marks', eventSegmentLines({ ...timedSegment, title: 'Conference', continuesAfter: true }, '12').title, 'Conference …');
check('and a null segment is empty rather than a crash', eventSegmentLines(null, '12').time, '');

// The pill must adopt the color without being a solid block: shifts are solid with white text, so an event
// is drawn as a tinted, outlined chip instead. This is the difference that keeps the two apart at a glance.
const bluePill = eventPillStyle('#227dc3');
check('the pill borders itself in its color', bluePill.borderColor, '#227dc3');
check('and writes in it', bluePill.color, '#227dc3');
check('with a translucent wash', bluePill.backgroundColor, '#227dc333');
check('the wash is not opaque', /^#[0-9a-f]{6}[0-9a-f]{2}$/.test(bluePill.backgroundColor) && bluePill.backgroundColor.slice(-2) !== 'ff', true);
const greyPill = eventPillStyle('');
check('a blank color falls back to the default grey', greyPill.color, EVENT_DEFAULT_COLOR);
check('and still washes', greyPill.backgroundColor, `${EVENT_DEFAULT_COLOR}33`);
// A solid pill would mean white text on a saturated fill - the shift treatment, which events must not take.
check('the pill never writes white', /text-white/.test(pillCode), false);
check('the pill is a div when nothing happens on a tap', /if \(!onClick\) return <div/.test(pillCode), true);
// My Schedule DOES want a tap, and a tap target should be a button for a keyboard and a screen reader - so
// the pill becomes one only when it is handed a handler.
check('and a button when it is', /<button[\s\S]{0,120}?onClick=\{onClick\}/.test(pillCode), true);
// It takes its color from the shared helper rather than hard-coding a fill, which is what keeps the wash
// translucent on both themes and identical across the three calendars.
check('and takes the shared treatment', /eventPillStyle\(segment\.color\)/.test(pillCode), true);

const renderedTab = renderToString(
  React.createElement(AdminEventsTab, {
    token: 'T',
    roles: [{ id: '1', description: 'Member' }],
    ranks: [{ id: '10', description: 'Firefighter', rank_order: '1' }],
    users: [{ id: '1', name: 'Member 1' }],
  })
);
check('the events tab renders', renderedTab.length > 500, true);
check('with the add card', renderedTab.includes('New Event'), true);
// The filter and sort bar. Its own count line is the one thing that proves the bar rendered with data bound to
// it, and it is readable before any rows arrive.
['From', 'To', 'Shows to', 'Sort by'].forEach((label) => {
  check(`the filter bar has ${label}`, renderedTab.includes(label), true);
});
check('and says how much it is showing', renderedTab.includes('Showing'), true);
check('and offers to clear the filters', renderedTab.includes('Clear filters'), true);
// The cards carry their own headings, and both are hidden until rows load - the tab fetches in an effect, which
// SSR does not run, so what renders here is the loading state rather than the two cards or the empty state. The
// cards themselves are asserted from source below.
check('and the loading state stands in until the rows arrive', renderedTab.includes('Loading events'), true);
check('and no raw guide markers leak', renderedTab.includes('[!'), false);


console.log('\n--- every other calendar draws them too ---');

// The availability grid backs BOTH My Availability and the administrator's single-member view, so one
// integration covers two screens.
check('the availability grid takes events', /events = \[\]/.test(availabilitySource), true);
check('and groups them by day', /eventSegmentsByDay\(/.test(availabilitySource), true);
check('it normalises defensively', /normalizeEventList\(events\)/.test(availabilitySource), true);
check('it has an events switch', /noun="events"/.test(availabilitySource), true);
// An event must not become something a member can tick: the slots are buttons and the events are not.
const availabilityEventBlock = availabilitySource.slice(
  availabilitySource.indexOf('eventSegmentsByDate.get(dateKey)'),
  availabilitySource.indexOf('daySlots.map((slot)')
);
check('the availability event block was found', availabilityEventBlock.length > 50, true);
// An event must not become something a member can tick: the slots are buttons, the events are not. Here the
// shared pill is handed no handler, so it stays the <div> it is by default - no tap, no button.
check('the availability event block renders the shared pill', /<EventPill/.test(availabilityEventBlock), true);
check('and never hands it a handler', /onClick/.test(availabilityEventBlock), false);
// One shared pill for every calendar: none of them hand-rolls its own event markup, which is exactly how the
// treatment would otherwise drift apart.
[['ScheduleCalendar', calendarSource], ['AvailabilityCalendar', availabilitySource], ['the board', boardSource]].forEach(
  ([name, source]) => {
    check(`${name} does not hand-roll an event pill`, /backgroundColor: segment\.color/.test(source), false);
  }
);

check('the board takes events', /events = \[\]/.test(boardSource), true);
check('and groups them by day', /eventSegmentsByDay\(/.test(boardSource), true);
check('it normalises defensively', /normalizeEventList\(events\)/.test(boardSource), true);
check('the board uses the shared events toggle', /noun="events"/.test(boardSource), true);
// The board draws the whole crew, so it must not audience-filter: an event aimed at one rank still belongs
// on the board an administrator builds from. Sliced to the board's own event memo, so a match elsewhere in
// the file cannot pass this.
const boardEventBlock = boardSource.slice(
  boardSource.indexOf('const eventSegmentsByDate = useMemo'),
  boardSource.indexOf('const slotOccupant = (slot)')
);
check('the board event memo was found', boardEventBlock.length > 100, true);
check('the board does not audience-filter', /eventSegmentsByDay\(/.test(boardEventBlock) && !/eventAudience/.test(boardEventBlock), true);

check('printing takes events', /events = \[\]/.test(printSource), true);
check('and normalises them', /normalizeEventList\(events\)/.test(printSource), true);

console.log('\n--- printed events ---');
const { printLinesForDate } = await import('../src/utils/printSchedule.js');
const printDay = '2026-03-10';

check('an event prints on a day with no shift', printLinesForDate({
  dateKey: printDay,
  events: [{ id: '7', title: 'Training', date_from: `${printDay} 08:00`, date_to: `${printDay} 10:00` }],
  todayKey: '2026-03-01',
}).map((line) => line.text), ['Training · 8:00 AM – 10:00 AM']);

// Events come before the shifts, matching the order every calendar draws them in.
const mixedLines = printLinesForDate({
  dateKey: printDay,
  mode: 'admin',
  schedule: [{ id: '1', date_from: printDay, date_to: printDay, schedule_template_id: '', assignment_id: '9', user_id: '2', start_time: '12:00', end_time: '18:00' }],
  users: [{ id: '2', name: 'Member 1' }],
  events: [{ id: '7', title: 'Training', date_from: `${printDay} 08:00`, date_to: `${printDay} 10:00` }],
  todayKey: '2026-03-01',
});
check('a shift still prints', mixedLines.some((line) => line.text.includes('Member 1')), true);
check('and the event precedes it', mixedLines[0].text.startsWith('Training'), true);

// An all-day event prints without inventing a clock: "All day" is the cell's word, not the sheet's, and a
// one-day event has no continuation mark.
check('an all-day event prints without a clock', printLinesForDate({
  dateKey: printDay,
  events: [{ id: '8', title: 'Holiday', is_all_day: 'TRUE', date_from: printDay, date_to: printDay }],
  todayKey: '2026-03-01',
}).map((line) => line.text), ['Holiday']);

// A multi-day span prints on every day it covers, the same rule the calendars use.
const spanDays = ['2026-03-10', '2026-03-11', '2026-03-12'].map((day) =>
  printLinesForDate({
    dateKey: day,
    events: [{ id: '8', title: 'Conference', is_all_day: 'TRUE', date_from: '2026-03-10', date_to: '2026-03-12' }],
    todayKey: '2026-03-01',
  }).length
);
check('a span prints on all three days', spanDays, [1, 1, 1]);

// An event must carry none of the shift machinery: no member name, no "Open".
check('an event is never labelled Open', printLinesForDate({
  dateKey: printDay,
  mode: 'admin',
  events: [{ id: '7', title: 'Training', date_from: `${printDay} 08:00`, date_to: `${printDay} 10:00` }],
  todayKey: '2026-03-01',
}).every((line) => !line.text.includes('Open')), true);

console.log('\n--- the app feeds the other screens ---');
check('App passes events to My Availability', /events=\{events\}[\s\S]{0,120}eventAudience=\{announcementAudience\}/.test(
  readFileSync('src/App.jsx', 'utf8')
), true);
check('App passes events to the admin module', /events=\{events\}[\s\S]{0,200}offers=\{adminOffers\}/.test(
  readFileSync('src/App.jsx', 'utf8')
), true);
check('the admin module forwards them to the board', /events=\{events\}[\s\S]{0,300}<AdminAvailabilityTab|events=\{events\}[\s\S]{0,200}timeFormat=\{timeFormat\}/.test(
  readFileSync('src/components/admin/AdminPanel.jsx', 'utf8')
), true);

console.log('\n--- rendered: the availability grid shows them ---');
const { default: AvailabilityCalendar } = await import('../src/components/AvailabilityCalendar.jsx');
const renderedAvailability = renderToString(
  React.createElement(AvailabilityCalendar, {
    member: { id: '1', name: 'Member 1', rank_id: '10' },
    ranks: [{ id: '10', description: 'Firefighter', rank_order: '1' }],
    // RAW rows again, shaped like the sheet, to prove the grid copes like the others do.
    events: [
      { id: '3', title: 'Conference', is_all_day: 'TRUE', date_from: `${monthDay(2)} 09:00`, date_to: `${monthDay(4)} 16:00` },
    ],
    eventAudience: { roleId: '', rankId: '10', userId: '1', ranks: [] },
    timeFormat: '12',
  })
);
check('the availability grid renders', renderedAvailability.length > 500, true);
check('and shows the event', renderedAvailability.includes('Conference'), true);
check('and the events switch', plain(renderedAvailability).includes('Hide events'), true);


console.log('\n--- rendered: the All Members list shows them per day ---');
// The roster is a list of who is available per shift, not a calendar, so events go on the DATE heading: an
// event belongs to the day, and repeating it down every shift would bury the names the view exists to show.
const rosterSource = readFileSync('src/components/admin/AdminAvailabilityRoster.jsx', 'utf8');
check('the roster takes events', /events = \[\]/.test(rosterSource), true);
check('and normalises them', /normalizeEventList\(events\)/.test(rosterSource), true);
check('it does not audience-filter', /eventSegmentsByDay\([\s\S]{0,200}\{ ranks \}/.test(rosterSource) && !/eventAudience/.test(rosterSource), true);
check('the calendar tab forwards events to it', /<AdminAvailabilityRoster[\s\S]{0,600}events=\{events\}/.test(
  readFileSync('src/components/admin/AdminAvailabilityTab.jsx', 'utf8')
), true);

const { default: AdminAvailabilityRoster } = await import('../src/components/admin/AdminAvailabilityRoster.jsx');
// The list only has date groups where a shift template runs, so the fixture needs one that falls in the
// current month - otherwise the day (and its event line) would not exist to render.
const rosterWeekday = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
][new Date(now.getFullYear(), now.getMonth(), 2).getDay()];

const renderedRoster = renderToString(
  React.createElement(AdminAvailabilityRoster, {
    scheduleTemplates: [
      { id: 'T1', day_of_week: rosterWeekday, start_time: '08:00', end_time: '18:00', assignment_id: '9' },
    ],
    assignments: [{ id: '9', description: 'Firefighter 3' }],
    ranks: [{ id: '10', description: 'Firefighter', rank_order: '1' }],
    users: [],
    availability: [],
    // RAW rows again, as the sheet would supply them.
    events: [
      { id: '3', title: 'Conference', is_all_day: 'TRUE', date_from: monthDay(2), date_to: monthDay(2) },
    ],
    timeFormat: '12',
  })
);

// React's SSR inserts comment markers between static text and an interpolated value, so "1 event this month"
// is really "1<!-- --> event<!-- --> this month" in the HTML. Strip tags and markers before matching text.
const plainHtml = (html) => String(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' ');

const rosterText = plainHtml(renderedRoster);
check('the roster renders', renderedRoster.length > 500, true);
check('it shows the shift', rosterText.includes('Firefighter 3'), true);
check('and the day\'s event', rosterText.includes('Conference'), true);
check('and counts the month\'s events', rosterText.includes('1 event this month'), true);
// An event must stay visually distinct from a shift: a colored DOT rather than a shift pill. The default gray
// proves the dot rendered with the event's resolved color.
check('the event shows as a colored dot', renderedRoster.includes('background-color:#64748b'), true);

console.log('\n--- a repeating event is described by its TIMES, not a phantom date ---');
// This pins a real confusion. The administration list printed date_from's date beside the recurrence, so an
// event anchored on Thursday Sep 24 and set to repeat on Tuesdays read as "Every week on Tue · Thu, Sep 24" -
// a day it will never appear on. It appears on the following Tuesday, which is why it looked unsaved.
const anchoredThursdayRow = {
  id: '9',
  title: 'Training',
  is_recurring: 'TRUE',
  date_from: '2026-09-24 17:30',
  date_to: '2026-09-24 21:30',
  recurring_start: '2026-09-24',
  recurring_amount: '1',
  recurring_frequency: 'weekly',
  is_tuesday: 'TRUE',
};
const anchoredThursday = normalizeEvent(anchoredThursdayRow);

check('the recurrence names the chosen day', eventRecurrenceLabel(anchoredThursday), 'Every week on Tue');
check('the time label is times only', eventTimesLabel(anchoredThursday), '5:30 PM – 9:30 PM');
check('and mentions no date at all', /Sep|Thu/.test(eventTimesLabel(anchoredThursday)), false);
// The anchor is not the first occurrence. This is the sentence that would have prevented the confusion.
check('the next occurrence is the following Tuesday', eventNextOccurrenceLabel(anchoredThursday, { fromKey: '2026-09-01' }), 'Next: Tue, Sep 29 at 5:30 PM');
check('and the anchor date is genuinely not where it lands', keysOf(eventSegmentsByDay([anchoredThursday], '2026-09-01', '2026-09-30', {})), ['2026-09-29']);
// An anchor that already falls on the chosen weekday lands on that very day, so the two only diverge sometimes.
// Built from the raw row, not the normalised one: normalising twice would drop the `is_recurring` flag, since
// the normalised shape is camelCase and the sheet columns are not.
check('an anchor on the chosen weekday lands that day', eventNextOccurrenceLabel(
  normalizeEvent({ ...anchoredThursdayRow, recurring_start: '2026-09-22' }), { fromKey: '2026-09-01' }
), 'Next: Tue, Sep 22 at 5:30 PM');
check('a repeat that has already ended says so', eventNextOccurrenceLabel(
  normalizeEvent({ id: '9', title: 'x', is_recurring: 'TRUE', recurring_start: '2026-09-24', recurring_end: '2026-09-01', recurring_amount: '1', recurring_frequency: 'weekly', is_tuesday: 'TRUE' }),
  { fromKey: '2026-09-01' }
), 'No upcoming occurrences');
check('a single event has no next-occurrence line', eventNextOccurrenceLabel(single(), { fromKey: '2026-03-01' }), '');
check('an all-day repeat reads as all day', eventNextOccurrenceLabel(recurringAllDay, { fromKey: '2026-03-01' }), 'Next: Sun, Mar 1 (all day)');
// The prefix is an option so the form can say "First appears: Tue, Sep 29" from the same rule.
check('the prefix can be dropped', eventNextOccurrenceLabel(anchoredThursday, { fromKey: '2026-09-01', prefix: '' }), 'Tue, Sep 29 at 5:30 PM');
check('an overnight repeat says so', eventTimesLabel(normalizeEvent({
  id: '9', title: 'x', is_recurring: 'TRUE', recurring_start: '2026-09-01',
  date_from: '2026-09-01 22:00', date_to: '2026-09-01 04:00',
  recurring_amount: '1', recurring_frequency: 'daily',
})), '10:00 PM – 4:00 AM (next day)');

console.log('\n--- the stored dates stop lying too ---');
// The client sends whatever day the form was open on, so the backend stamps the repeat's anchor onto the date
// columns: they exist only to carry the times, and left alone they read as a day the event never happens on.
check('the backend stamps the anchor onto the date columns', /fields\.date_from = anchor \+ eventTimeSuffix\(fields\.date_from\)/.test(codeSource), true);
check('and the same for the end', /fields\.date_to = anchor \+ eventTimeSuffix\(fields\.date_to\)/.test(codeSource), true);
// Matched by pattern rather than sliced, because the two input shapes differ ("... HH:mm" and "...THH:mm").
check('the time is matched, not sliced', /function eventTimeSuffix/.test(codeSource), true);
check('and nothing slices the datetime at a fixed offset', /date_from[^\n]*\.slice\(10\)/.test(codeSource), false);

console.log('\n--- the admin list shows the new lines ---');
const eventsTabSource = readFileSync('src/components/admin/AdminEventsTab.jsx', 'utf8');
check('the list uses the times-only label for repeats', /eventTimesLabel\(event, timeFormat\)/.test(eventsTabSource), true);
check('and shows the next occurrence', /eventNextOccurrenceLabel\(event, \{ fromKey: todayKey\(\), timeFormat \}\)/.test(eventsTabSource), true);
// And the form says when it will first appear, which is where the mistake is actually made.
check('the form previews the first appearance', /First appears: \{recurringNextLabel\}/.test(eventsTabSource), true);
check('computed from the live form', /normalizeEvent\(\{ \.\.\.form, id: 'preview' \}\)/.test(eventsTabSource), true);

// No render check for that line: the add/edit card is collapsed by default and SSR cannot open it, so a
// rendered assertion would only ever prove the collapsed card has no preview. The two source assertions
// above are the ones that matter - they prove the label is computed from the form and bound into the JSX.

const renderedTabWithRepeat = renderToString(
  React.createElement(AdminEventsTab, {
    token: 'T',
    roles: [],
    ranks: [],
    users: [],
    timeFormat: '12',
  })
);
check('the tab still renders with the new lines', renderedTabWithRepeat.includes('New Event'), true);



console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
