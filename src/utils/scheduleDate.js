// Shared date helpers for schedule views. Dates travel from Google Sheets as
// either Date cells (JSON-serialized by Apps Script as UTC ISO strings, e.g.
// "2025-09-01T04:00:00.000Z") or plain text ("MM/DD/YYYY" US locale or
// "yyyy-MM-dd"); both normalize to a "yyyy-MM-dd" station-timezone key
// (America/New_York) so date ranges compare cleanly as strings.
const pad = (n) => String(n).padStart(2, '0');

export const toDateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

// The STATION's today, as a 'yyyy-MM-dd' key. Every "is this in force today?" comparison in the app is made
// against this rather than against the device's local date, so a document that expires "today" expires on the
// station's today for every member, whatever timezone they are standing in.
export const stationTodayKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const at = (type) => parts.find((part) => part.type === type).value;
  return `${at('year')}-${at('month')}-${at('day')}`;
};

// The day AFTER a 'yyyy-MM-dd' key, for an EXCLUSIVE upper bound on a window.
//
// A window's `to` names a DAY, and the column being ranged is usually a DATETIME ("yyyy-MM-dd HH:mm:ss") which
// sorts as text. That makes an inclusive `<= '2026-03-31'` drop every entry ON the 31st: the space that follows the
// date sorts before the end of the string, so '2026-03-31 07:30:00' > '2026-03-31'. A migrated ISO value
// ('2026-03-31T04:00:00.000Z') sorts past it too, since 'T' > ' '. Bounding with `<` the START of the following day
// admits both, and keeps the bound a day rather than a moment - which is what a date field means.
//
// UTC arithmetic throughout, deliberately: this is a calendar key, and running it through the device's zone is how a
// window's edge lands on the wrong day for whoever is standing somewhere else.
export const nextDateKey = (key) => {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? '').trim());
  if (!parts) return '';
  const next = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]) + 1));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
};

// A 'yyyy-MM-dd' key that many whole months before another one, defaulting to the STATION's today.
//
// The clock history opens on "the last twelve months", and that end has to be measured on the same clock the entries
// are stamped on. The device's own date is the wrong one to ask (see stationTodayKey), and the arithmetic is done in
// UTC so a phone in another zone cannot shift the start of the window.
export const dateKeyMonthsBack = (months, fromKey = stationTodayKey()) => {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fromKey ?? '').trim());
  if (!parts) return '';
  const shifted = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1 - Number(months || 0), Number(parts[3])));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
};

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