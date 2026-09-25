// Shared date helpers for schedule views. Dates travel from Google Sheets as
// either Date cells (JSON-serialized by Apps Script as UTC ISO strings, e.g.
// "2025-09-01T04:00:00.000Z") or plain text ("MM/DD/YYYY" US locale or
// "yyyy-MM-dd"); both normalize to a "yyyy-MM-dd" station-timezone key
// (America/New_York) so date ranges compare cleanly as strings.
const pad = (n) => String(n).padStart(2, '0');

export const toDateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export function parseSheetDateKey(value) {
  if (value === undefined || value === null) return null;

  // A live Date object (built in the client rather than parsed from the API) is read
  // with its OWN calendar date, matching toDateKey(). Values that travel over the API
  // always arrive as text or ISO strings and take the station-timezone path below.
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : toDateKey(value);
  }

  const s = String(value).trim();
  if (s === '') return null;

  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (isoMatch) {
    const instant = new Date(s);
    if (isNaN(instant.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(instant);
    const y = parts.find((p) => p.type === 'year')?.value;
    const mo = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    return y && mo && d ? `${y}-${mo}-${d}` : null;
  }

  const mdyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdyMatch) return `${mdyMatch[3]}-${pad(mdyMatch[1])}-${pad(mdyMatch[2])}`;

  const ymdMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymdMatch) return `${ymdMatch[1]}-${pad(ymdMatch[2])}-${pad(ymdMatch[3])}`;

  return null;
}
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export function displayDate(dateKey) {
  if (!dateKey || typeof dateKey !== 'string') return '';
  
  const dateParts = dateKey.split('-');
  if (dateParts.length < 3) return '';
  
  const [y, m, d] = dateParts.map(Number);
  // Validate the parsed values
  if (isNaN(y) || isNaN(m) || isNaN(d) || m < 1 || m > 12 || d < 1) return '';
  
  const date = new Date(y, m - 1, d);
  if (isNaN(date.getTime())) return '';
  
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthStr = MONTHS[date.getMonth()];
  // Defensive check for invalid month index
  if (!monthStr) return '';
  
  // Index the weekday by the date's own day - interpolating the array itself
  // rendered "Sun,Mon,Tue,Wed,Thu,Fri,Sat" in front of every date.
  return `${DOW[date.getDay()]}, ${monthStr.slice(0, 3)} ${date.getDate()}`;
}