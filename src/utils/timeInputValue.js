// Converts a sheet time value into an <input type="time"> value ("HH:MM").
// Handles "HH:MM", "HH:MM:SS", "8:30 AM", Sheets Date instances, and the UTC
// ISO strings Apps Script produces when JSON-serializing a time-formatted cell
// (e.g. "1899-12-30T13:30:00.000Z") - those are converted back to the station's
// Eastern Time so the wall-clock time the user sees in the sheet is recovered.
export function toTimeInputValue(value) {
  if (value === undefined || value === null || value === '') return '';

  // Apps Script serializes Date cells as UTC ISO strings ("yyyy-MM-ddTHH:mm:ss.sssZ")
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value.trim())) {
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(date);
      const hour = parts.find((p) => p.type === 'hour')?.value.padStart(2, '0');
      const minute = parts.find((p) => p.type === 'minute')?.value.padStart(2, '0');
      if (hour !== undefined && minute !== undefined) return `${hour}:${minute}`;
    }
  }

  if (value instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  }

  // Any "HH:MM" (optionally with seconds and/or AM/PM) anywhere in the string,
  // e.g. "08:30", "8:30:00 AM", "12/30/1899 8:30 AM"
  const match = String(value).trim().match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (match) {
    let hours = parseInt(match[1], 10) % 24;
    const ampm = match[4];
    if (ampm) {
      const isPM = String(ampm).toUpperCase() === 'PM';
      if (isPM && hours < 12) hours += 12;
      if (!isPM && hours === 12) hours = 0;
    }
    return `${String(hours).padStart(2, '0')}:${match[2]}`;
  }
  return '';
}