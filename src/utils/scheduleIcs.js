import { nextDateKey } from './scheduleDate.js';

// The station's own clock. Shift times are wall-clock values with no zone of their own, so the calendar file names the zone
// rather than converting them - a member in another zone still sees the shift at the station's hour.
const STATION_TZ = 'America/New_York';

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${STATION_TZ}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'TZNAME:EDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'TZNAME:EST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

const pad = (value) => String(value).padStart(2, '0');
const compactDate = (dateKey) => dateKey.replaceAll('-', '');
const compactDateTime = (dateKey, minutes) => `${compactDate(dateKey)}T${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}00`;

const escapeText = (value) =>
  String(value ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Lines over 75 octets are folded onto a continuation line that starts with a space (RFC 5545 3.1).
const fold = (line) => {
  const bytes = new TextEncoder();
  if (bytes.encode(line).length <= 75) return line;
  const parts = [];
  let current = '';
  for (const char of line) {
    const limit = parts.length ? 74 : 75;
    if (bytes.encode(current + char).length > limit) {
      parts.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.join('\r\n ');
};

const utcStamp = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

// One event per day a shift covers: a row spanning several days draws the same window on each of them, and a calendar
// app has no way to say "daily 08:00-18:00 for these dates" more simply than that.
export const scheduleIcsEvents = (assignments) => {
  const events = [];
  (Array.isArray(assignments) ? assignments : []).forEach((shift) => {
    if (!shift.from || !shift.to || shift.from > shift.to) return;
    for (let day = shift.from; day <= shift.to; day = nextDateKey(day)) {
      events.push({ shift, day });
      if (!day) break;
    }
  });
  return events;
};

export const buildScheduleIcs = (assignments, { calendarName = 'My schedule', now = new Date() } = {}) => {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Fire Clock//Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    `X-WR-TIMEZONE:${STATION_TZ}`,
    ...VTIMEZONE,
  ];

  scheduleIcsEvents(assignments).forEach(({ shift, day }) => {
    const summary = escapeText(shift.label || 'Shift');
    const uid = `${String(shift.row?.id ?? shift.key)}-${day}@fire-clock`;
    const head = ['BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${utcStamp(now)}`, `SUMMARY:${summary}`];

    if (shift.startMin === null || shift.startMin === undefined) {
      // No time at all: an all-day entry. DTEND is exclusive, so it is the day after.
      lines.push(...head, `DTSTART;VALUE=DATE:${compactDate(day)}`, `DTEND;VALUE=DATE:${compactDate(nextDateKey(day))}`, 'END:VEVENT');
      return;
    }

    // An end at or before the start is the next morning (a 20:00-04:00 night shift). No end at all gets an hour.
    const endTotal =
      shift.endMin === null || shift.endMin === undefined
        ? shift.startMin + 60
        : shift.endMin <= shift.startMin
          ? shift.endMin + 1440
          : shift.endMin;
    const endDay = endTotal >= 1440 ? nextDateKey(day) : day;
    lines.push(
      ...head,
      `DTSTART;TZID=${STATION_TZ}:${compactDateTime(day, shift.startMin)}`,
      `DTEND;TZID=${STATION_TZ}:${compactDateTime(endDay, endTotal % 1440)}`,
      'END:VEVENT'
    );
  });

  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
};

export const downloadTextFile = (content, fileName, type) => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
