// Verifies the item detail popup on My Schedule: a click or tap on a shift pill or an event pill opens a
// read-only modal describing it (utils/scheduleItemDetails + components/ScheduleItemModal).
//
// The rows are built by pure functions on purpose, so what the popup SAYS is asserted here rather than the
// markup that says it - the calendar only decides which item was tapped. The two things that cannot be
// driven headlessly (a real click, a real tap) are covered by reading the wiring out of the component
// sources, the same way verify-announcements and verify-events do.
//
// Run with: npm run verify:item-details
import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { eventItemDetails, shiftItemDetails } from '../src/utils/scheduleItemDetails.js';
import { eventSegmentsByDay, normalizeEvent } from '../src/utils/events.js';
import ScheduleItemModal from '../src/components/ScheduleItemModal.jsx';
import EventPill from '../src/components/EventPill.jsx';
import ScheduleCalendar from '../src/components/ScheduleCalendar.jsx';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` -> ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`}`
  );
};

const rowValue = (details, label) => details.rows.find((row) => row.label === label)?.value;
const rowLabels = (details) => details.rows.map((row) => row.label);

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------
console.log('--- a shift of your own ---');
const mine = {
  key: 'row-1',
  isMine: true,
  isOpen: false,
  from: '2026-09-15',
  to: '2026-09-15',
  name: 'Matt',
  label: 'Engine 1',
  icon: 'truck',
  timeRange: '8:00 AM – 6:00 PM',
  timeLabel: 'Day Shift',
  color: '#dc2626',
};

const mineDetails = shiftItemDetails(mine, { timeFormat: '12' });
check('the title is what the pill shows', mineDetails.title, 'Engine 1');
check('the subtitle says whose shift it is', mineDetails.subtitle, 'Your shift');
check(
  'the rows are Date, Time, Assignment, Shown as, Status',
  rowLabels(mineDetails),
  ['Date', 'Time', 'Assignment', 'Shown as', 'Status']
);
check('the date carries the year', rowValue(mineDetails, 'Date'), 'Tue, Sep 15, 2026');
check('the time is the real window', rowValue(mineDetails, 'Time'), '8:00 AM – 6:00 PM');
check('the assignment is named', rowValue(mineDetails, 'Assignment'), 'Engine 1');
// The nickname and the window are different facts: the pill can read "Day Shift" and still run 8 to 6.
check('the nickname is spelled out separately', rowValue(mineDetails, 'Shown as'), 'Day Shift');
check('and the status is plain', rowValue(mineDetails, 'Status'), 'Scheduled');
check('the assignment icon rides along', mineDetails.rows[2].icon, 'truck');
check('the assignment colour rides along', mineDetails.color, '#dc2626');

console.log('--- somebody else, in the crew view ---');
const theirs = { ...mine, isMine: false, name: 'Ana', label: 'Rescue' };
const theirsDetails = shiftItemDetails(theirs, { crewMember: true });
check('the title becomes the member', theirsDetails.title, 'Ana');
check('the subtitle does not claim it is yours', theirsDetails.subtitle, 'Shift');
check('the member is named in a row', rowValue(theirsDetails, 'Member'), 'Ana');
check(
  'and the assignment, not the member, is the title in the personal view',
  shiftItemDetails(theirs, { crewMember: false }).title,
  'Rescue'
);

console.log('--- a multi-day posting ---');
check(
  'a span is written as a range',
  rowValue(shiftItemDetails({ ...mine, from: '2026-09-15', to: '2026-09-17' }), 'Date'),
  'Tue, Sep 15, 2026 – Thu, Sep 17, 2026'
);
check('one day is one date', rowValue(shiftItemDetails(mine), 'Date'), 'Tue, Sep 15, 2026');

console.log('--- the fallbacks, and never a crash ---');
const bare = shiftItemDetails({});
check('no assignment is not a blank title', bare.title, 'Scheduled');
check('no window', rowValue(bare, 'Time'), 'Not specified');
check('no dates', rowValue(bare, 'Date'), '—');
check('an empty object still has rows', bare.rows.length >= 4, true);
check('and undefined is safe', shiftItemDetails(undefined).rows.length >= 4, true);
check(
  'an open shift says so',
  shiftItemDetails({ ...mine, isMine: false, isOpen: true, name: 'Open' }).subtitle,
  'Open shift — nobody is assigned yet'
);
check(
  'a pending offer on it says that instead',
  shiftItemDetails({ ...mine, isOpen: true, name: 'Open' }, { offerState: 'pending' }).subtitle,
  'Open shift — your offer is awaiting approval'
);
check(
  'and a declined one invites another try',
  shiftItemDetails({ ...mine, isOpen: true, name: 'Open' }, { offerState: 'declined' }).subtitle,
  'Open shift — your offer was declined, so it is open to everyone again'
);

console.log('--- a nickname equal to the window is not repeated ---');
check(
  'no Shown as row when it adds nothing',
  rowLabels(shiftItemDetails({ ...mine, timeLabel: '8:00 AM – 6:00 PM' })),
  ['Date', 'Time', 'Assignment', 'Status']
);
check('and none when the template has no nickname', rowLabels(shiftItemDetails({ ...mine, timeLabel: '' })), [
  'Date',
  'Time',
  'Assignment',
  'Status',
]);

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
// Segments come from the real engine rather than being hand-built, so the popup is fed exactly what the
// calendar draws. Both halves are returned: the segment is the tapped day, the event is the row behind it, and
// the popup needs both (see the builder's note).
const segmentsFor = (row, fromKey, toKey, viewer = {}) => {
  const event = normalizeEvent(row);
  return { event, segments: eventSegmentsByDay([event], fromKey, toKey, viewer).get(fromKey) || [] };
};

console.log('--- a timed event ---');
const timed = segmentsFor(
  {
    id: 'e1',
    title: 'Training night',
    date_from: '2026-09-15 18:00',
    date_to: '2026-09-15 20:00',
    color: '#227dc3',
  },
  '2026-09-15',
  '2026-09-15'
);
check('the engine produced a segment', timed.segments.length, 1);
const timedDetails = eventItemDetails(timed.event, timed.segments[0], { timeFormat: '12', todayKey: '2026-09-15' });
check('the title is the event title', timedDetails.title, 'Training night');
check('the subtitle says it is an event', timedDetails.subtitle, 'Event');
check('the rows are Date, Time, Visible to', rowLabels(timedDetails), ['Date', 'Time', 'Visible to']);
check('the tapped day is the date', rowValue(timedDetails, 'Date'), 'Tue, Sep 15, 2026');
check('and the time is its window', rowValue(timedDetails, 'Time'), '6:00 PM – 8:00 PM');
check('an untargeted event is for everyone', rowValue(timedDetails, 'Visible to'), 'Everyone');
check('the event colour rides along', timedDetails.color, '#227dc3');
check('a one-off event says nothing about repeating', rowLabels(timedDetails).includes('Repeats'), false);
check('nor about a span', rowLabels(timedDetails).includes('Span'), false);

console.log('--- an all-day event, and one that runs over midnight ---');
const allDay = segmentsFor(
  { id: 'e2', title: 'Conference', is_all_day: 'TRUE', date_from: '2026-09-15', date_to: '2026-09-17' },
  '2026-09-16',
  '2026-09-16'
);
const allDayDetails = eventItemDetails(allDay.event, allDay.segments[0], { todayKey: '2026-09-16' });
// "All day" is the Time row rather than a second row saying Yes: one fact, said once.
check('an all-day event says so in its time', rowValue(allDayDetails, 'Time'), 'All day');
// The middle day of a three-day span: the reader tapped the 16th, and the popup still has to say which days
// the event covers.
check('the middle day is the date', rowValue(allDayDetails, 'Date'), 'Wed, Sep 16, 2026');
check('the whole span is spelled out', rowValue(allDayDetails, 'Span'), 'Tue, Sep 15, 2026 – Thu, Sep 17, 2026');
check('with no clock anywhere', allDayDetails.rows.some((row) => /AM|PM/.test(row.value)), false);

const overnight = segmentsFor(
  { id: 'e3', title: 'Night watch', date_from: '2026-09-15 22:00', date_to: '2026-09-16 02:00' },
  '2026-09-16',
  '2026-09-16'
);
const overnightDetails = eventItemDetails(overnight.event, overnight.segments[0], { todayKey: '2026-09-16' });
check('the second day of an overnight event', rowValue(overnightDetails, 'Date'), 'Wed, Sep 16, 2026');
check('shows only what is left of it', rowValue(overnightDetails, 'Time'), '→ 2:00 AM');
check('and names the day it started', rowValue(overnightDetails, 'Span').startsWith('Tue, Sep 15, 2026'), true);

console.log('--- a repeating event ---');
const weekly = segmentsFor(
  {
    id: 'e4',
    title: 'Drill',
    date_from: '2026-09-15 08:00',
    date_to: '2026-09-15 09:00',
    is_recurring: 'TRUE',
    recurring_start: '2026-09-01',
    recurring_frequency: 'weekly',
    is_tuesday: 'TRUE',
  },
  '2026-09-15',
  '2026-09-15'
);
const weeklyDetails = eventItemDetails(weekly.event, weekly.segments[0], { todayKey: '2026-09-14' });
check('the subtitle mentions repeating', weeklyDetails.subtitle, 'Event · repeats');
check('the rule is printed', rowValue(weeklyDetails, 'Repeats'), 'Every week on Tue');
// Anchored on 1 Sep and asked on the 14th, the first landing day is the 15th - which is the answer to "why is
// my new event not on the anchor date".
check('the next landing day is named', rowValue(weeklyDetails, 'Next'), 'Tue, Sep 15 at 8:00 AM');
check('and it needs no prefix of its own', /^Next/.test(rowValue(weeklyDetails, 'Next')), false);

console.log('--- who an event is for ---');
const targeted = segmentsFor(
  {
    id: 'e5',
    title: 'Officers',
    date_from: '2026-09-15 18:00',
    date_to: '2026-09-15 20:00',
    role_id: '2',
    rank_id: '10',
  },
  '2026-09-15',
  '2026-09-15'
);
const targetedDetails = eventItemDetails(targeted.event, targeted.segments[0], {
  todayKey: '2026-09-15',
  roles: [{ id: '2', description: 'Member' }],
  ranks: [{ id: '10', description: 'Lieutenant' }],
});
check(
  'roles and ranks are named, not numbered',
  rowValue(targetedDetails, 'Visible to'),
  'Member role, and only Lieutenant rank and above'
);
check(
  'an unresolvable id still prints something',
  eventItemDetails(targeted.event, targeted.segments[0], {}).rows.at(-1).value,
  '#2 role, and only #10 rank and above'
);
// A popup that is handed nothing still has to stand up: it is the one place an engineer will look when an
// event draws but says nothing.
check('no event at all still renders rows', eventItemDetails(undefined, undefined).rows.length, 3);
check('with a title rather than a blank', eventItemDetails(undefined, undefined).title, 'Event');
check('and an empty event is safe', eventItemDetails({}, { dateKey: '2026-09-15' }).rows.length, 3);

// ---------------------------------------------------------------------------
// Rendered: the popup itself
// ---------------------------------------------------------------------------
console.log('--- rendered: the popup ---');
const html = renderToString(
  React.createElement(ScheduleItemModal, { details: mineDetails, icon: 'shift', onClose: () => {} })
);
check('the title is drawn', html.includes('Engine 1'), true);
check('the subtitle is drawn', html.includes('Your shift'), true);
check('every row label is drawn', rowLabels(mineDetails).every((label) => html.includes(label)), true);
check(
  'and every row value',
  ['Tue, Sep 15, 2026', '8:00 AM – 6:00 PM', 'Day Shift', 'Scheduled'].every((value) => html.includes(value)),
  true
);
check('the assignment icon is drawn', html.includes('lucide-truck'), true);
// The colour is a dot, never a fill or a text colour: an assignment can be an arbitrary colour, and white text
// on an arbitrary fill - which the shift pills get away with because an admin picks from a palette - is exactly
// what this modal must avoid.
check('the colour is drawn as a dot', /class="h-3 w-3[^"]*" style="background-color:#dc2626"/.test(html), true);
check(
  'and never as a fill or text',
  html.replace(/background-color:#dc2626/g, '').includes('#dc2626'),
  false
);
// It reports, it does not act: the offer is still made from the pill itself, so nobody can be talked into
// offering for a shift by reading about it. The only controls are the two ways out.
check('the only controls are the two dismissals', (html.match(/<button/g) || []).length, 2);
check('and neither acts on the shift', /onConfirm|bg-red-600/.test(html), false);
check('and it is labelled Close', html.includes('Close'), true);
check('nothing is rendered without details', renderToString(React.createElement(ScheduleItemModal, { details: null })), '');
check(
  'an event popup keeps its own icon',
  renderToString(React.createElement(ScheduleItemModal, { details: timedDetails, icon: 'event' })).includes(
    'lucide-calendar-clock'
  ),
  true
);

console.log('--- rendered: the pill that opens it ---');
const segment = timed.segments[0];
const inertPill = renderToString(React.createElement(EventPill, { segment, timeFormat: '12' }));
check('an event pill with no handler is still a div', inertPill.startsWith('<div'), true);
check('and offers no tap', inertPill.includes('<button'), false);
const tappablePill = renderToString(
  React.createElement(EventPill, { segment, timeFormat: '12', onClick: () => {} })
);
check('with a handler it is a button', tappablePill.startsWith('<button'), true);
check('which says so in its tooltip', tappablePill.includes('click for details'), true);
// A button is inline-block and centres its label, unlike the div it replaces, so the shared class has to be
// corrected for it - otherwise every event pill on My Schedule would jump to the middle of its cell.
check('and keeps the pill layout', /block self-stretch text-left/.test(tappablePill), true);
check('the wash is unchanged', tappablePill.includes('background-color:#227dc333'), true);

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
console.log('--- wiring: what opens it ---');
const calendar = readFileSync('src/components/ScheduleCalendar.jsx', 'utf8');
const app = readFileSync('src/App.jsx', 'utf8');
const modal = readFileSync('src/components/ScheduleItemModal.jsx', 'utf8');

check('the calendar holds a detail target', /const \[detailTarget, setDetailTarget\] = useState\(null\)/.test(calendar), true);
check(
  'a filled shift pill opens it',
  /onClick=\{\(\) => setDetailTarget\(\{ kind: 'shift', item: a \}\)\}/.test(calendar),
  true
);
check(
  'and the detail list row below does too',
  (calendar.match(/setDetailTarget\(\{ kind: 'shift', item: a \}\)/g) || []).length,
  2
);
check(
  'an event pill opens it',
  /onClick=\{\(\) => setDetailTarget\(\{ kind: 'event', item: segment, event: eventFor\(segment\) \}\)\}/.test(calendar),
  true
);
check('and the row behind the tapped day is looked up', /const eventFor = \(segment\) =>/.test(calendar), true);
check('the modal is rendered from that target', /\{detailTarget && \(/.test(calendar), true);
check(
  'both kinds go through their builder',
  /eventItemDetails\(detailTarget\.event, detailTarget\.item/.test(calendar) &&
    /shiftItemDetails\(detailTarget\.item/.test(calendar),
  true
);
// The offer flow is untouched: an open pill still goes straight to the confirmation, which is the same detail
// layout plus the one action that pill has.
check('an open pill still opens the offer modal', /onClick=\{\(\) => openOfferModal\(a\)\}/.test(calendar), true);
check('the offer modal is still mounted', /<ShiftOfferModal/.test(calendar), true);
check('the calendar takes the role list for the audience line', /roles = \[\],/.test(calendar), true);
check('and App hands it over', /roles=\{roles\}/.test(app), true);
// A tap target has to be reachable by a keyboard, and the detail list row used to be a plain div.
check(
  'the detail list rows are buttons now',
  /className="w-full text-left flex items-center gap-3 p-3 rounded-xl/.test(calendar),
  true
);
check('and carry no block content', !/<button[\s\S]{0,900}?<p className="flex items-center/.test(calendar), true);
check('the modal centres on a backdrop', /fixed inset-0 z-\[60\] flex items-center justify-center/.test(modal), true);
check('which closes it', /onClick=\{onClose\}/.test(modal), true);
check('while clicks inside it do not', /onClick=\{\(e\) => e\.stopPropagation\(\)\}/.test(modal), true);
// The calendar still renders with everything omitted, which is what a caller that forgets a prop gets.
check(
  'the calendar renders with no props at all',
  renderToString(React.createElement(ScheduleCalendar, { currentUser: { id: 'u1' } })).length > 0,
  true
);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);



