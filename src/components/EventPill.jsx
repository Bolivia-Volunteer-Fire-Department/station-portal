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
// Shared by every calendar so the treatment cannot drift between them.
//
// It renders a <div> unless it is given an onClick, in which case it becomes a <button> - because a button
// is what a tappable thing should be for a keyboard or a screen reader. In the availability grid it has no
// handler and stays a div: an event is not a shift there, so it must not look markable. My Schedule passes a
// handler so the reader can open its details.
//
// The title carries the continuation marks for a multi-day span; the second line is the times, and is
// omitted entirely for an all-day event (see eventSegmentLines).
export default function EventPill({ segment, timeFormat = '12', className = '', onClick }) {
  if (!segment) return null;

  const { title, time } = eventSegmentLines(segment, timeFormat);
  const label = `${eventSegmentTitle(segment)} · ${eventSegmentTimeLabel(segment, timeFormat)}`;
  const shared = {
    title: onClick ? `${label} — click for details` : label,
    className: `px-1 py-0.5 ${EVENT_PILL_CLASS} ${className}`.trim(),
    style: eventPillStyle(segment.color),
  };
  const body = (
    <>
      <span className="block truncate">{title}</span>
      {time && <span className="block truncate text-[9px] font-normal opacity-90">{time}</span>}
    </>
  );

  if (!onClick) return <div {...shared}>{body}</div>;

  // `block self-stretch text-left` reproduces what the browser gave the div for free: a button is otherwise
  // inline-block (shrinking to its text) and centres its label. The hover only ever appears on the tappable
  // copy, which is how a member can tell at a glance which things respond to a tap.
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${shared.className} block self-stretch text-left transition hover:brightness-105`}
      title={shared.title}
      style={shared.style}
    >
      {body}
    </button>
  );
}
