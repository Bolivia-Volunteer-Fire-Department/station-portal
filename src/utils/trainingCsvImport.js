// Training CSV import and session grouping.
//
// Translates attendee-level training attendance records into Fire Clock's two-part model:
//
//   trainings/{id}            Grouped training sessions (by date, category/title, duration)
//   training_signatures/{id}  Per-member signature/attendance acknowledgments
//
// This pure module powers both:
//   1. The Admin UI import modal in the Training tab (runs client-side in the browser)
//   2. The CLI import script (scripts/import-trainings-csv.mjs)

import { parseSheetDateKey } from './scheduleDate.js';
import { TRAINING_FLAGS } from './training.js';

// Clean text helper.
const text = (val) => String(val ?? '').trim();

// Parses a CSV string into an array of row objects keyed by the header names.
// Handles quotes, commas inside quotes, escaped quotes (""), and varied line endings.
export const parseCsv = (csvText) => {
  if (!csvText || typeof csvText !== 'string') return [];

  const lines = [];
  let currentRow = [];
  let currentField = '';
  let insideQuotes = false;

  const chars = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const nextChar = chars[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        // Escaped quote
        currentField += '"';
        i++;
      } else {
        // Toggle quote mode
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      currentRow.push(currentField);
      currentField = '';
    } else if (char === '\n' && !insideQuotes) {
      currentRow.push(currentField);
      lines.push(currentRow);
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    lines.push(currentRow);
  }

  if (lines.length < 2) return [];

  // Normalize header names: trim and remove BOM
  const headers = lines[0].map((h) => text(h).replace(/^\uFEFF/, ''));

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const rawRow = lines[i];
    // Skip empty lines
    if (!rawRow || rawRow.every((val) => text(val) === '')) continue;

    const rowObj = {};
    headers.forEach((header, index) => {
      rowObj[header] = text(rawRow[index]);
    });
    rows.push(rowObj);
  }

  return rows;
};

// Normalizes a person's name for resilient matching.
// Strips extra punctuation, spaces, and handles middle initials/names.
export const normalizePersonName = (name) => {
  const cleaned = text(name)
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned;
};

// Returns candidate name variants for matching (e.g. "John Smith", "Smith John", without middle names).
export const nameVariants = (name) => {
  const norm = normalizePersonName(name);
  if (!norm) return [];

  const parts = norm.split(' ').filter(Boolean);
  const variants = new Set([norm]);

  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts[parts.length - 1];
    // "First Last" without middle initial
    variants.add(`${first} ${last}`);
    // "Last First"
    variants.add(`${last} ${first}`);
  }

  return [...variants];
};

// Matches an attendee name from the CSV against the station roster.
export const matchUser = (attendeeName, users = []) => {
  if (!attendeeName) return null;

  const attendeeVariants = nameVariants(attendeeName);
  const userList = Array.isArray(users) ? users : [];

  // 1. Exact match on normalized full name
  for (const user of userList) {
    const userNorm = normalizePersonName(user.name);
    if (attendeeVariants.includes(userNorm)) {
      return user;
    }
  }

  // 2. Match against user.first_name + user.last_name if separate
  for (const user of userList) {
    if (user.first_name || user.last_name) {
      const constructed = normalizePersonName(`${user.first_name || ''} ${user.last_name || ''}`);
      if (attendeeVariants.includes(constructed)) {
        return user;
      }
    }
  }

  // 3. Match without middle initials if 3 parts vs 2 parts
  const attendeeParts = normalizePersonName(attendeeName).split(' ').filter(Boolean);
  if (attendeeParts.length >= 2) {
    const attendeeFirst = attendeeParts[0];
    const attendeeLast = attendeeParts[attendeeParts.length - 1];

    for (const user of userList) {
      const userParts = normalizePersonName(user.name).split(' ').filter(Boolean);
      if (userParts.length >= 2) {
        const userFirst = userParts[0];
        const userLast = userParts[userParts.length - 1];
        if (attendeeFirst === userFirst && attendeeLast === userLast) {
          return user;
        }
      }
    }
  }

  return null;
};

// Formats / converts date input from CSV (MM/DD/YYYY, YYYY-MM-DD, etc.) to YYYY-MM-DD.
export const parseImportDate = (rawDate) => {
  const val = text(rawDate);
  if (!val) return null;

  // If already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    return { dateKey: val, displayDate: val };
  }

  // MM/DD/YYYY or M/D/YYYY
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(val);
  if (mdy) {
    const m = String(mdy[1]).padStart(2, '0');
    const d = String(mdy[2]).padStart(2, '0');
    const y = mdy[3];
    const dateKey = `${y}-${m}-${d}`;
    return { dateKey, displayDate: `${m}/${d}/${y}` };
  }

  // Fallback to scheduleDate helper if applicable
  const fallbackKey = parseSheetDateKey(val);
  if (fallbackKey) {
    return { dateKey: fallbackKey, displayDate: val };
  }

  return null;
};

// Maps a raw category string to Fire Clock category flags and title.
export const mapCategory = (rawCategory) => {
  const raw = text(rawCategory);
  const lower = raw.toLowerCase();

  const flags = {
    is_company_training: false,
    is_hazmat: false,
    is_ems: false,
    is_fire_prevention: false,
    is_multicompany: false,
    is_training_facility: false,
    is_officer_training: false,
    is_driver_training: false,
  };

  if (!raw) {
    return { title: 'General Training', flags };
  }

  if (lower.includes('company training') || lower === 'company') {
    flags.is_company_training = true;
  }
  if (lower.includes('hazmat')) {
    flags.is_hazmat = true;
  }
  if (lower.includes('ems') || lower.includes('medical')) {
    flags.is_ems = true;
  }
  if (lower.includes('fire prevention') || lower.includes('community relations')) {
    flags.is_fire_prevention = true;
  }
  if (lower.includes('multicompany') || lower.includes('multi-company')) {
    flags.is_multicompany = true;
  }
  if (lower.includes('facility')) {
    flags.is_training_facility = true;
  }
  if (lower.includes('officer')) {
    flags.is_officer_training = true;
  }
  if (lower.includes('driver')) {
    flags.is_driver_training = true;
  }

  return { title: raw, flags };
};

// Parses numeric duration hours (e.g. "2.50", "3", "0.5").
export const parseImportDuration = (rawDuration) => {
  const str = text(rawDuration);
  if (!str) return 0;
  const num = parseFloat(str);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num * 100) / 100;
};

// Prepares a complete import plan from CSV text and user roster.
//
// Groups identical attendee sessions (Date, Category/Title, Duration) into unique trainings,
// resolves attendees to user IDs, and flags any unmatched attendees or malformed rows.
export const prepareTrainingImportPlan = (csvText, users = [], manualUserMapping = {}) => {
  const rows = parseCsv(csvText);

  const skippedRows = [];
  const validAttendeeRows = [];
  const unmatchedAttendeeSet = new Set();
  const matchedUserMap = new Map();

  // Find column keys tolerantly
  let attendeeCol = 'Attendee Full Name';
  let categoryCol = 'Activity/Training Category';
  let hoursCol = 'Activity/Training Total Hours';
  let dateCol = 'Activity/Training Start Actual Date';

  if (rows.length > 0) {
    const sample = rows[0];
    const keys = Object.keys(sample);
    const findKey = (pattern) => keys.find((k) => pattern.test(k));

    attendeeCol = findKey(/attendee/i) || attendeeCol;
    categoryCol = findKey(/category/i) || categoryCol;
    hoursCol = findKey(/hours|duration/i) || hoursCol;
    dateCol = findKey(/date|start/i) || dateCol;
  }

  rows.forEach((row, idx) => {
    const attendeeName = text(row[attendeeCol]);
    const rawCategory = text(row[categoryCol]);
    const rawHours = text(row[hoursCol]);
    const rawDate = text(row[dateCol]);

    // Check for missing required data
    if (!attendeeName) {
      skippedRows.push({
        rowIndex: idx + 2,
        reason: 'Missing attendee name',
        data: row,
      });
      return;
    }

    const parsedDate = parseImportDate(rawDate);
    if (!parsedDate) {
      skippedRows.push({
        rowIndex: idx + 2,
        reason: `Missing or unreadable date ("${rawDate}")`,
        data: row,
      });
      return;
    }

    const duration = parseImportDuration(rawHours);

    // Member resolution
    let matchedUser = null;
    const manualId = manualUserMapping[attendeeName];

    if (manualId === '__skip__') {
      skippedRows.push({
        rowIndex: idx + 2,
        reason: `Skipped by administrator mapping: ${attendeeName}`,
        data: row,
      });
      return;
    }

    if (manualId) {
      matchedUser = users.find((u) => String(u.id) === String(manualId)) || null;
    }

    if (!matchedUser) {
      matchedUser = matchUser(attendeeName, users);
    }

    if (!matchedUser) {
      unmatchedAttendeeSet.add(attendeeName);
    } else {
      matchedUserMap.set(attendeeName, matchedUser);
    }

    const { title, flags } = mapCategory(rawCategory);

    validAttendeeRows.push({
      rowIndex: idx + 2,
      attendeeName,
      user: matchedUser,
      dateKey: parsedDate.dateKey,
      displayDate: parsedDate.displayDate,
      rawCategory,
      title,
      flags,
      duration,
    });
  });

  // Group attendee rows by unique session: dateKey + title + duration
  const sessionMap = new Map();

  validAttendeeRows.forEach((row) => {
    const sessionKey = `${row.dateKey}:::${row.title}:::${row.duration}`;

    if (!sessionMap.has(sessionKey)) {
      sessionMap.set(sessionKey, {
        date: row.displayDate,
        date_key: row.dateKey,
        title: row.title,
        duration: row.duration,
        ...row.flags,
        attendees: [],
      });
    }

    const session = sessionMap.get(sessionKey);
    // Add attendee (avoiding duplicates if the same attendee was recorded twice for the exact same session)
    if (!session.attendees.some((a) => a.attendeeName === row.attendeeName)) {
      session.attendees.push({
        attendeeName: row.attendeeName,
        user: row.user,
      });
    }
  });

  const sessions = [...sessionMap.values()].map((session, index) => ({
    ...session,
    id: `import-${session.date_key}-${index + 1}`,
    signature_count: session.attendees.filter((a) => a.user).length,
  }));

  // Total signatures to create for matched users
  const totalSignatures = sessions.reduce(
    (sum, s) => sum + s.attendees.filter((a) => a.user).length,
    0
  );

  return {
    totalRows: rows.length,
    validRowsCount: validAttendeeRows.length,
    skippedRows,
    unmatchedAttendees: [...unmatchedAttendeeSet].sort(),
    matchedCount: matchedUserMap.size,
    sessions,
    totalSignatures,
  };
};

