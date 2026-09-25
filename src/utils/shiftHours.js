// Measures how much of a clock entry's time falls within any defined shift
// window, rounded to the nearest half hour.
//
// Shift windows repeat weekly based on the day of week the shift STARTS on
// (e.g. a shift starting at 20:00 on Friday runs 20:00 Fri until 04:00 Sat).
// When end_time is on/before start_time the shift wraps past midnight (equal
// start/end is treated as the full 24h window). Overlapping shifts are merged
// per day so overlapping coverage is only counted once.

const DAY_KEYS = [
  'is_sunday',
  'is_monday',
  'is_tuesday',
  'is_wednesday',
  'is_thursday',
  'is_friday',
  'is_saturday',
];

const MS_PER_DAY = 86400000;
const MS_PER_MIN = 60000;

function isTruthy(value) {
  return value === true || String(value).trim().toUpperCase() === 'TRUE';
}

// Parses "HH:MM[:SS]" or "H:MM AM/PM" into minutes since midnight (null if unparseable)
function toMinutesOfDay(value) {
  if (value === undefined || value === null) return null;
  const match = String(value).trim().match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (match[4]) {
    const isPM = String(match[4]).toUpperCase() === 'PM';
    if (isPM && hours < 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;
  }
  return hours * 60 + minute;
}

export function computeShiftBreakdown(log, shifts = []) {
  if (!shifts.length || !log || !log.time_in) return [];

  const start = new Date(log.time_in);
  // Active entries (no clock-out yet) are measured up to "now"
  const end = log.time_out ? new Date(log.time_out) : new Date();
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return [];

  const shiftModels = shifts
    .map((s) => ({
      startMin: toMinutesOfDay(s.start_time),
      endMin: toMinutesOfDay(s.end_time),
      shift: s,
    }))
    .filter((s) => s.startMin !== null && s.endMin !== null);

  if (!shiftModels.length) return [];

  const dayFloor = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const firstDay = dayFloor(start);
  const lastDay = dayFloor(end);
  const maxDays = 372; // safety cap for very long active entries

  // Per-shift accumulated overlap minutes (keyed by shift id)
  const minutesByShift = new Map();

  // Iterate one day before the clock-in so an overnight shift that began the
  // previous day still has its early-morning tail counted.
  for (
    let day = new Date(firstDay.getTime() - MS_PER_DAY), offset = 0;
    day <= lastDay && offset < maxDays;
    day = new Date(day.getTime() + MS_PER_DAY), offset++
  ) {
    const dowKey = DAY_KEYS[day.getDay()];

    for (const s of shiftModels) {
      // The shift runs on this calendar day only if the day-of-week flag for
      // its START day is checked.
      if (!isTruthy(s.shift[dowKey])) continue;

      // end on/before start wraps to the next day (equal start/end = 24h window)
      const wraps = s.endMin <= s.startMin;
      const ws = day.getTime() + s.startMin * MS_PER_MIN;
      const we = day.getTime() + (wraps ? MS_PER_DAY : 0) + s.endMin * MS_PER_MIN;

      const overlapMs = Math.max(0, Math.min(end.getTime(), we) - Math.max(start.getTime(), ws));
      if (overlapMs <= 0) continue;

      const key = String(s.shift.id ?? s.shift.description ?? s.shift.start_time);
      minutesByShift.set(key, (minutesByShift.get(key) || 0) + overlapMs / MS_PER_MIN);
    }
  }

  const results = [];
  for (const s of shiftModels) {
    const key = String(s.shift.id ?? s.shift.description ?? s.shift.start_time);
    const minutes = minutesByShift.get(key) || 0;
    if (minutes <= 0) continue;

    // Round to the nearest half hour (0.5 increments, half-way rounds up)
    const hours = Math.max(0, Math.round((minutes / 60) * 2) / 2);
    if (hours <= 0) continue;

    results.push({
      id: s.shift.id,
      description: s.shift.description || 'Shift',
      startMin: s.startMin,
      hours,
    });
  }

  // Present shifts in the order they begin (stable for ties)
  results.sort((a, b) => a.startMin - b.startMin || String(a.id).localeCompare(String(b.id)));
  return results;
}

// Formats a single shift's hours: "3.5 hrs", "1 hr"
export function formatShiftHours(hours) {
  return `${hours} ${hours === 1 ? 'hr' : 'hrs'}`;
}

// Formats a breakdown for display: "3.5 hrs (Day Shift), 1 hr (Night Shift)"
export function formatShiftBreakdown(breakdown = []) {
  return breakdown.map((b) => `${formatShiftHours(b.hours)} (${b.description})`).join(', ');
}