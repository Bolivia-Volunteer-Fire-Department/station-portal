// What a calendar item's detail modal shows.
//
// Pure functions, so the contents are verifiable without a browser: the modal is a dumb renderer and the
// calendar only decides WHICH item was tapped. Same split as the offer modal, which the layout here
// deliberately mirrors.
import { displayDate, toDateKey } from './scheduleDate';
import {
  eventNextOccurrenceLabel,
  eventRecurrenceLabel,
  eventSegmentTimeLabel,
  eventVisibilityLabel,
} from './events';

const text = (value) => String(value ?? '').trim();

// "Wed, Sep 24, 2026". displayDate drops the year because the pill it came from sits under a month
// heading; a modal has to stand on its own.
const dayLabel = (dateKey) => {
  const key = text(dateKey);
  const label = displayDate(key);
  if (!label) return '';
  const year = key.slice(0, 4);
  return /^\d{4}$/.test(year) ? `${label}, ${year}` : label;
};

// One date, or a span when the item runs over more than one day.
const rangeLabel = (fromKey, toKey) => {
  const from = dayLabel(fromKey);
  const to = dayLabel(toKey);
  if (!from) return '—';
  return !to || to === from ? from : `${from} – ${to}`;
};

// The status line under the title: what this shift IS, from the reader's point of view.
const shiftStatus = ({ isOpen, isMine, offerState }) => {
  if (isOpen) {
    if (offerState === 'pending') return 'Open shift — your offer is awaiting approval';
    if (offerState === 'declined') return 'Open shift — your offer was declined, so it is open to everyone again';
    return 'Open shift — nobody is assigned yet';
  }
  return isMine ? 'Your shift' : 'Shift';
};

// A shift, as the modal shows it.
//
// `crewMember` is only set in the "Show everyone" view: in the personal view the reader IS the member, so
// a row naming them would be noise.
export const shiftItemDetails = (assignment, { timeFormat = '12', crewMember = false, offerState = '' } = {}) => {
  const a = assignment || {};
  const isOpen = Boolean(a.isOpen);

  const rows = [
    { label: 'Date', value: rangeLabel(a.from, a.to) },
    { label: 'Time', value: text(a.timeRange) || 'Not specified' },
    // The assignment's own icon (Administration → Assignments), as the pill draws it.
    { label: 'Assignment', value: text(a.label) || 'Scheduled', icon: text(a.icon) },
  ];

  if (crewMember) {
    rows.push({ label: 'Member', value: text(a.name) || 'Open' });
  }

  // The nickname and the window are different facts: a pill reading "Day Shift" still has to be able to
  // tell you it runs 08:00–18:00.
  if (text(a.timeLabel) && text(a.timeLabel) !== text(a.timeRange)) {
    rows.push({ label: 'Shown as', value: a.timeLabel });
  }

  rows.push({
    label: 'Status',
    value: isOpen
      ? offerState === 'pending'
        ? 'Awaiting approval'
        : offerState === 'declined'
          ? 'Declined — you can offer again'
          : 'Open'
      : 'Scheduled',
  });

  return {
    kind: 'shift',
    title: crewMember ? text(a.name) || 'Open shift' : text(a.label) || 'Scheduled',
    subtitle: shiftStatus({ isOpen, isMine: Boolean(a.isMine), offerState }),
    rows,
    color: text(a.color),
  };
};

// An event, as the modal shows it.
//
// Two arguments on purpose. `segment` is the pill the reader actually pressed - one DAY of a span, carrying
// that day's slice of the times and nothing else (see eventSegmentsByDay). The facts that are not per-day -
// the title, the whole span, the repeat rule, the audience - only exist on the event row behind it. A
// segment alone cannot answer "does this repeat?", so it is not asked to.
//
// `todayKey` decides the "Next" row and defaults to the real today, so a caller that forgets it still gets a
// truthful answer instead of "No upcoming occurrences".
export const eventItemDetails = (event, segment, { timeFormat = '12', todayKey = toDateKey(new Date()), roles, ranks, users } = {}) => {
  const source = event || {};
  const spanFrom = text(source.startsAt?.dateKey);
  const spanTo = text(source.endsAt?.dateKey) || spanFrom;

  // The tapped day first, then the whole span when it covers more than that day - an event drawn across three
  // cells should say so in words too.
  const rows = [
    { label: 'Date', value: dayLabel(segment?.dateKey) || rangeLabel(spanFrom, spanTo) },
    // Covers both cases with no second row to read: the window for a timed event, "All day" for an all-day one
    // (see eventSegmentTimeLabel), and "→ 2:00 AM" for the tail of an overnight span.
    { label: 'Time', value: eventSegmentTimeLabel(segment, timeFormat) || 'All day' },
  ];

  if (spanFrom && spanTo && spanTo !== spanFrom) {
    rows.splice(1, 0, { label: 'Span', value: rangeLabel(spanFrom, spanTo) });
  }

  if (source.isRecurring) {
    rows.push({ label: 'Repeats', value: eventRecurrenceLabel(source) });
    // Empty prefix: the row's own label already says "Next".
    const next = eventNextOccurrenceLabel(source, { fromKey: todayKey, timeFormat, prefix: '' });
    if (text(next)) rows.push({ label: 'Next', value: next });
  }

  rows.push({ label: 'Visible to', value: eventVisibilityLabel(source, { roles, ranks, users }) });

  return {
    kind: 'event',
    title: text(source.title) || 'Event',
    subtitle: source.isRecurring ? 'Event · repeats' : 'Event',
    rows,
    // The segment's color is the event's, normalised, and is what the pill was drawn with.
    color: text(segment?.color) || text(source.color),
  };
};

