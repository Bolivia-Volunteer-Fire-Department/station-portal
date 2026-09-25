import React from 'react';
import {
  EVENT_PILL_CLASS,
  eventPillStyle,
  eventSegmentLines,
  eventSegmentTimeLabel,
  eventSegmentTitle,
} from '../utils/events';

// One event, on one day of one calendar.
//
// Shared by every calendar so the treatment cannot drift between them, and deliberately a plain <div>
// rather than a button: an event is not a shift, so it must not look markable, offerable or draggable.
// scripts/verify-events.mjs asserts that the availability grid's event block contains no <button> at all.
//
// The title carries the continuation marks for a multi-day span; the second line is the times, and is
// omitted entirely for an all-day event (see eventSegmentLines).
export default function EventPill({ segment, timeFormat = '12', className = '' }) {
  if (!segment) return null;

  const { title, time } = eventSegmentLines(segment, timeFormat);

  return (
    <div
      title={`${eventSegmentTitle(segment)} · ${eventSegmentTimeLabel(segment, timeFormat)}`}
      className={`px-1 py-0.5 ${EVENT_PILL_CLASS} ${className}`.trim()}
      style={eventPillStyle(segment.color)}
    >
      <span className="block truncate">{title}</span>
      {time && <span className="block truncate text-[9px] font-normal opacity-90">{time}</span>}
    </div>
  );
}
