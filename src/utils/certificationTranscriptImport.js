// Certification Transcript (PDF & CSV) parser and import planner.
//
// Supports:
//   1. NC OSFM "Certification Transcript Summary" PDF files (single or multi-page, one or multiple files)
//   2. Tabular CSV certification exports (Member, Certification, Effective Date, End Date, IFSAC / Notes)
//
// Uses the native Web DecompressionStream API (available in all modern browsers and Node 18+)
// to inflate FlateDecode PDF streams without requiring heavy external PDF dependencies.

import { parseCsv, normalizePersonName } from './trainingCsvImport.js';
import { parseSheetDateKey } from './scheduleDate.js';

const text = (val) => String(val ?? '').trim();

// Common first-name nicknames to help match official state transcript names (e.g. "Michael Bryce Sullivan")
// against station roster names (e.g. "Mike Sullivan" or "Bryce Sullivan").
const NICKNAME_GROUPS = [
  ['michael', 'mike', 'mick'],
  ['william', 'will', 'bill', 'billy', 'liam'],
  ['robert', 'rob', 'bob', 'bobby'],
  ['richard', 'rick', 'rich', 'dick'],
  ['james', 'jim', 'jimmy', 'jamie'],
  ['john', 'johnny', 'jon', 'jack'],
  ['joseph', 'joe', 'joey'],
  ['THOMAS', 'tom', 'tommy'],
  ['charles', 'charlie', 'chuck'],
  ['christopher', 'chris'],
  ['daniel', 'dan', 'danny'],
  ['matthew', 'matt'],
  ['ANTHONY', 'tony'],
  ['donald', 'don', 'donnie'],
  ['steven', 'stephen', 'steve'],
  ['andrew', 'andy', 'drew'],
  ['kenneth', 'ken', 'kenny'],
  ['joshua', 'josh'],
  ['kevin', 'kev'],
  ['timothy', 'tim', 'timmy'],
  ['ronald', 'ron', 'ronnie'],
  ['edward', 'ed', 'eddie', 'ted'],
  ['jeffrey', 'jeff'],
  ['gregory', 'greg'],
  ['benjamin', 'ben', 'benny'],
  ['samuel', 'sam', 'sammy'],
  ['alexander', 'alex'],
  ['nicholas', 'nick'],
  ['jonathan', 'jon'],
  ['david', 'dave', 'davy'],
  ['patrick', 'pat'],
  ['jacob', 'jake'],
  ['zachary', 'zach', 'zack'],
  ['nathan', 'nathaniel', 'nate'],
  ['phillip', 'philip', 'phil'],
  ['RAYMOND', 'ray'],
  ['lawrence', 'larry'],
  ['gerald', 'jerry'],
  ['bradley', 'brad'],
  ['douglas', 'doug'],
].map((group) => group.map((n) => n.toLowerCase()));

const areFirstNamesEquivalent = (a, b) => {
  if (!a || !b) return false;
  if (a === b) return true;
  return NICKNAME_GROUPS.some((group) => group.includes(a) && group.includes(b));
};

// Strips trailing NFPA standard and edition suffixes from an OSFM certification title
// so stations can optionally create clean certification names.
// Examples:
//   "Driver Operator Aerials NFPA 1002 2017 edition" -> "Driver Operator Aerials"
//   "Chief 101- 2020 Edition" -> "Chief 101"
//   "Technical Rescuer Vehicle NFPA 2013 Ed." -> "Technical Rescuer Vehicle"
export const cleanCertificationTitle = (rawTitle) => {
  const raw = text(rawTitle);
  if (!raw) return '';
  return raw
    .replace(/\s+NFPA\s+(?:\d+\s+)?(?:\d{4}\s*)?(?:edition|ed\.?)?.*$/i, '')
    .replace(/\s*[-–—]?\s*\b(?:19|20)\d{2}\s+(?:edition|ed\.?)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
};

// Normalizes a certification name for fuzzy comparison against Certification Setup.
export const normalizeCertificationTitle = (title) => {
  const cleaned = cleanCertificationTitle(title)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\biii\b/g, '3')
    .replace(/\bii\b/g, '2')
    .replace(/\bi\b/g, '1')
    .replace(/\biv\b/g, '4')
    .replace(/\bfire\s+fighter\b/g, 'firefighter')
    .replace(/\bhazardous\s+materials\b/g, 'hazmat')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned;
};

// Matches a transcript certification title against the station's Certification Setup list.
export const matchCertificationSetup = (rawTitle, setupList = []) => {
  const raw = text(rawTitle);
  if (!raw || !Array.isArray(setupList) || setupList.length === 0) return null;

  const rawLower = raw.toLowerCase();
  const cleanLower = cleanCertificationTitle(raw).toLowerCase();
  const normTarget = normalizeCertificationTitle(raw);

  // 1. Exact case-insensitive match on raw or cleaned title
  for (const item of setupList) {
    const itemName = text(item.name).toLowerCase();
    if (itemName && (itemName === rawLower || itemName === cleanLower)) {
      return item;
    }
  }

  // 2. Normalized title match (handles Roman numerals I/II vs 1/2, NFPA edition suffixes, etc.)
  for (const item of setupList) {
    const itemNorm = normalizeCertificationTitle(item.name);
    if (itemNorm && itemNorm === normTarget) {
      return item;
    }
  }

  // 3. Common fire-service alias equivalents
  const compactTarget = normTarget.replace(/\band\b/g, '').replace(/\s+/g, ' ').trim();
  for (const item of setupList) {
    const itemNorm = normalizeCertificationTitle(item.name);
    const compactItem = itemNorm.replace(/\band\b/g, '').replace(/\s+/g, ' ').trim();
    if (compactItem && compactItem === compactTarget) {
      return item;
    }
  }

  return null;
};

// Matches a member name from a transcript or CSV against the station roster.
export const matchTranscriptMember = (rawMemberName, users = []) => {
  const raw = text(rawMemberName);
  if (!raw || !Array.isArray(users) || users.length === 0) return null;

  const norm = normalizePersonName(raw);
  if (!norm) return null;

  const parts = norm.split(' ').filter(Boolean);

  // 1. Exact normalized full name match
  for (const user of users) {
    const userNorm = normalizePersonName(user.name);
    if (userNorm === norm) return user;
    if (user.first_name || user.last_name) {
      const full = normalizePersonName(`${user.first_name || ''} ${user.last_name || ''}`);
      if (full === norm) return user;
    }
  }

  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts[parts.length - 1];
    const middleParts = parts.slice(1, -1);

    // 2. First + Last exact match (ignoring middle name/initial on either side)
    for (const user of users) {
      const uParts = normalizePersonName(user.name).split(' ').filter(Boolean);
      if (uParts.length >= 2) {
        const uFirst = uParts[0];
        const uLast = uParts[uParts.length - 1];
        if (uFirst === first && uLast === last) return user;
        // Also check "Last, First" order
        if (uFirst === last && uLast === first) return user;
      }
    }

    // 3. Nickname + Last match (e.g. "Michael Bryce Sullivan" -> "Mike Sullivan")
    for (const user of users) {
      const uParts = normalizePersonName(user.name).split(' ').filter(Boolean);
      if (uParts.length >= 2) {
        const uFirst = uParts[0];
        const uLast = uParts[uParts.length - 1];
        if (uLast === last && areFirstNamesEquivalent(first, uFirst)) {
          return user;
        }
      }
    }

    // 4. Middle name + Last name match (e.g. "Michael Bryce Sullivan" -> "Bryce Sullivan")
    if (middleParts.length > 0) {
      for (const mid of middleParts) {
        if (mid.length < 2) continue;
        for (const user of users) {
          const uParts = normalizePersonName(user.name).split(' ').filter(Boolean);
          if (uParts.length >= 2) {
            const uFirst = uParts[0];
            const uLast = uParts[uParts.length - 1];
            if (uLast === last && (uFirst === mid || areFirstNamesEquivalent(mid, uFirst))) {
              return user;
            }
          }
        }
      }
    }
  }

  return null;
};

// Formats MM/DD/YYYY or YYYY-MM-DD into YYYY-MM-DD.
export const normalizeTranscriptDate = (rawDate) => {
  const val = text(rawDate);
  if (!val || val === '-') return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;

  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(val);
  if (mdy) {
    const m = String(mdy[1]).padStart(2, '0');
    const d = String(mdy[2]).padStart(2, '0');
    const y = mdy[3];
    return `${y}-${m}-${d}`;
  }

  return parseSheetDateKey(val) || '';
};

// Decompresses a PDF FlateDecode stream using the Web DecompressionStream API.
const inflatePdfStreamBytes = async (bytes) => {
  if (!bytes || bytes.length === 0) return null;

  if (typeof DecompressionStream !== 'undefined') {
    for (const format of ['deflate', 'deflate-raw']) {
      try {
        const input =
          format === 'deflate-raw' && bytes.length > 6
            ? bytes.subarray(2, bytes.length - 4)
            : bytes;
        const ds = new DecompressionStream(format);
        const writer = ds.writable.getWriter();
        writer.write(input).catch(() => {});
        writer.close().catch(() => {});

        const chunks = [];
        const reader = ds.readable.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) chunks.push(value);
        }
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        if (totalLength > 0) {
          const out = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            out.set(chunk, offset);
            offset += chunk.length;
          }
          let str = '';
          for (let i = 0; i < out.length; i++) {
            str += String.fromCharCode(out[i]);
          }
          return str;
        }
      } catch {
        // Try next format
      }
    }
  }

  return null;
};

// Unescapes a PDF literal string `(...)` into raw byte values (0..255).
const unescapePdfLiteralBytes = (literalContent) => {
  const bytes = [];
  for (let i = 0; i < literalContent.length; i++) {
    const ch = literalContent[i];
    if (ch !== '\\') {
      bytes.push(ch.charCodeAt(0) & 0xff);
      continue;
    }
    i++;
    if (i >= literalContent.length) break;
    const next = literalContent[i];
    if (next === 'n') bytes.push(10);
    else if (next === 'r') bytes.push(13);
    else if (next === 't') bytes.push(9);
    else if (next === 'b') bytes.push(8);
    else if (next === 'f') bytes.push(12);
    else if (next === '(') bytes.push(40);
    else if (next === ')') bytes.push(41);
    else if (next === '\\') bytes.push(92);
    else if (next >= '0' && next <= '7') {
      let oct = next;
      if (i + 1 < literalContent.length && literalContent[i + 1] >= '0' && literalContent[i + 1] <= '7') {
        oct += literalContent[++i];
        if (i + 1 < literalContent.length && literalContent[i + 1] >= '0' && literalContent[i + 1] <= '7') {
          oct += literalContent[++i];
        }
      }
      bytes.push(parseInt(oct, 8) & 0xff);
    } else if (next === '\r' || next === '\n') {
      // Line continuation backslash
      if (next === '\r' && literalContent[i + 1] === '\n') i++;
    } else {
      bytes.push(next.charCodeAt(0) & 0xff);
    }
  }
  return bytes;
};

// Decodes a byte array from a PDF string operand using the extracted CMap or ASCII fallback.
const decodePdfStringBytes = (bytes, cmap) => {
  if (!bytes || bytes.length === 0) return '';

  // Check if this is 16-bit big-endian CID text (typical in OSFM iText/Jasper CIDFont PDFs)
  let zeroEvenBytes = 0;
  const pairCount = Math.floor(bytes.length / 2);
  if (bytes.length % 2 === 0 && pairCount > 0) {
    for (let i = 0; i < bytes.length; i += 2) {
      if (bytes[i] === 0) zeroEvenBytes++;
    }
  }

  if (bytes.length % 2 === 0 && pairCount > 0 && zeroEvenBytes >= Math.ceil(pairCount * 0.6)) {
    let result = '';
    for (let i = 0; i < bytes.length; i += 2) {
      const cid = (bytes[i] << 8) | bytes[i + 1];
      if (cmap.has(cid)) {
        result += cmap.get(cid);
      } else if (cid + 29 >= 32 && cid + 29 <= 126) {
        // Standard TrueType glyph-index-to-ASCII offset (+29) used in OSFM Helvetica/Arial subsets
        result += String.fromCharCode(cid + 29);
      }
    }
    return result;
  }

  // Plain 1-byte ASCII/Latin1 string
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    const code = bytes[i];
    if (code >= 32 && code <= 126) {
      result += String.fromCharCode(code);
    }
  }
  return result;
};

// Extracts text tokens inside a single `(...)` or `<...>` or `[...]` TJ/Tj operand.
const decodePdfTextOperand = (operand, cmap) => {
  let out = '';
  let i = 0;
  while (i < operand.length) {
    const ch = operand[i];
    if (ch === '(') {
      let depth = 1;
      i++;
      let literal = '';
      while (i < operand.length && depth > 0) {
        const c = operand[i];
        if (c === '\\') {
          literal += c;
          i++;
          if (i < operand.length) {
            literal += operand[i];
            i++;
          }
          continue;
        }
        if (c === '(') depth++;
        else if (c === ')') {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
        literal += c;
        i++;
      }
      const bytes = unescapePdfLiteralBytes(literal);
      out += decodePdfStringBytes(bytes, cmap);
    } else if (ch === '<' && operand[i + 1] !== '<') {
      i++;
      let hex = '';
      while (i < operand.length && operand[i] !== '>') {
        if (/[0-9a-fA-F]/.test(operand[i])) hex += operand[i];
        i++;
      }
      i++;
      if (hex.length % 2 === 1) hex += '0';
      const bytes = [];
      for (let j = 0; j < hex.length; j += 2) {
        bytes.push(parseInt(hex.slice(j, j + 2), 16));
      }
      out += decodePdfStringBytes(bytes, cmap);
    } else {
      i++;
    }
  }
  return out;
};

// Extracts positioned text items from a PDF ArrayBuffer or Uint8Array.
export const extractPdfTextItems = async (buffer) => {
  const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let raw = '';
  const CHUNK = 32768;
  for (let i = 0; i < uint8.length; i += CHUNK) {
    raw += String.fromCharCode.apply(null, uint8.subarray(i, Math.min(i + CHUNK, uint8.length)));
  }

  // Decompress all streams in the PDF
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  const decompressedStreams = [];
  let match;
  while ((match = streamRegex.exec(raw)) !== null) {
    const body = match[1];
    const bytes = new Uint8Array(body.length);
    for (let i = 0; i < body.length; i++) {
      bytes[i] = body.charCodeAt(i) & 0xff;
    }
    const inflated = await inflatePdfStreamBytes(bytes);
    if (inflated) {
      decompressedStreams.push(inflated);
    } else if (body.includes('BT') && body.includes('ET')) {
      decompressedStreams.push(body);
    }
  }

  // Pass 1: Collect ToUnicode CMap mappings across all streams
  const cmap = new Map();
  for (const s of decompressedStreams) {
    if (s.includes('beginbfrange')) {
      const rangeBlocks = s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g);
      for (const block of rangeBlocks) {
        const rangeEntries = block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g);
        for (const r of rangeEntries) {
          const start = parseInt(r[1], 16);
          const end = parseInt(r[2], 16);
          const dst = parseInt(r[3], 16);
          for (let c = start; c <= end; c++) {
            cmap.set(c, String.fromCharCode(dst + (c - start)));
          }
        }
      }
    }
    if (s.includes('beginbfchar')) {
      const charBlocks = s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g);
      for (const block of charBlocks) {
        const charEntries = block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g);
        for (const c of charEntries) {
          cmap.set(parseInt(c[1], 16), String.fromCharCode(parseInt(c[2], 16)));
        }
      }
    }
  }

  // Pass 2: Extract positioned text blocks from each content stream
  const pages = [];
  decompressedStreams.forEach((s, streamIndex) => {
    if (!s.includes('BT') || !s.includes('ET')) return;
    const pageItems = [];
    const btBlocks = s.matchAll(/BT([\s\S]*?)ET/g);
    for (const block of btBlocks) {
      const content = block[1];
      let x = 0;
      let y = 0;

      const tmMatch = /([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+Tm/.exec(
        content
      );
      if (tmMatch) {
        x = parseFloat(tmMatch[5]);
        y = parseFloat(tmMatch[6]);
      } else {
        const tdMatch = /([0-9.-]+)\s+([0-9.-]+)\s+T[dD]/.exec(content);
        if (tdMatch) {
          x = parseFloat(tdMatch[1]);
          y = parseFloat(tdMatch[2]);
        }
      }

      // Extract all Tj or TJ operations in this BT..ET block
      const tjRegex = /(\[(?:\\.|[^\]])*\]|\((?:\\.|[^\\)])*\)|<[0-9a-fA-F\s]+>)\s*T[jJ]/g;
      let tj;
      let combinedText = '';
      while ((tj = tjRegex.exec(content)) !== null) {
        combinedText += decodePdfTextOperand(tj[1], cmap);
      }

      const cleaned = combinedText.replace(/\s+/g, ' ').trim();
      if (cleaned) {
        pageItems.push({ streamIndex, x, y, text: cleaned });
      }
    }

    if (pageItems.length > 0) {
      pages.push(pageItems);
    }
  });

  return pages;
};

// Parses an NC OSFM "Certification Transcript Summary" PDF buffer into structured member & certification records.
export const parseCertificationTranscriptPdf = async (buffer, fileName = 'transcript.pdf') => {
  const pages = await extractPdfTextItems(buffer);
  if (!pages.length) {
    return {
      fileName,
      memberName: '',
      createdDate: '',
      certifications: [],
      error: 'Could not extract readable text from this PDF file.',
    };
  }

  let memberName = '';
  let createdDate = '';
  const certifications = [];

  for (const pageItems of pages) {
    // Group items on this page into horizontal rows (within 2.5pt vertical tolerance)
    const sorted = [...pageItems].sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const item of sorted) {
      const existingRow = rows.find((r) => Math.abs(r.y - item.y) < 2.5);
      if (existingRow) {
        existingRow.items.push(item);
        existingRow.items.sort((a, b) => a.x - b.x);
      } else {
        rows.push({ y: item.y, items: [item] });
      }
    }

    // Identify header & member name on the page if not yet found
    const headerRowIndex = rows.findIndex((r) =>
      r.items.some((item) => /Certification Transcript Summary/i.test(item.text))
    );

    if (headerRowIndex !== -1 && !memberName) {
      // In NC OSFM transcripts, the row immediately below "Certification Transcript Summary"
      // at x ~ 181 is the member's full name (e.g. "Michael Bryce Sullivan").
      for (let i = headerRowIndex + 1; i < Math.min(rows.length, headerRowIndex + 4); i++) {
        const candidateText = rows[i].items.map((it) => it.text).join(' ').trim();
        if (
          candidateText &&
          !/^Created:/i.test(candidateText) &&
          !/^Page\s+\d+/i.test(candidateText) &&
          !/\d/.test(candidateText)
        ) {
          memberName = candidateText;
          break;
        }
      }
    }

    // Parse certification entries and metadata rows
    let pendingCertTitle = null;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowText = row.items.map((it) => it.text).join(' ').trim();
      if (!rowText) continue;

      // Footer checks
      const createdMatch = /Created:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(rowText);
      if (createdMatch) {
        createdDate = normalizeTranscriptDate(createdMatch[1]) || createdMatch[1];
        continue;
      }
      if (/^Page\s+\d+\s+of\s+\d+$/i.test(rowText)) {
        continue;
      }
      if (/Certification Transcript Summary/i.test(rowText)) {
        continue;
      }

      // Check if this row has IFSAC / Certification Date details
      const ifsacMatch = /IFSAC:\s*([^\s|]+)/i.exec(rowText);
      const certDateMatch = /Certification Date:\s*(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|-)/i.exec(rowText);

      if (ifsacMatch || certDateMatch) {
        if (pendingCertTitle) {
          const ifsacRaw = ifsacMatch ? text(ifsacMatch[1]) : '';
          const ifsacNumber = ifsacRaw && ifsacRaw !== '-' ? ifsacRaw : '';
          const rawDate = certDateMatch ? text(certDateMatch[1]) : '';
          const effectiveDate = normalizeTranscriptDate(rawDate);

          certifications.push({
            rawTitle: pendingCertTitle,
            cleanTitle: cleanCertificationTitle(pendingCertTitle),
            ifsacNumber,
            rawDate,
            effectiveDate,
            notes: ifsacNumber ? `IFSAC: ${ifsacNumber}` : '',
          });
          pendingCertTitle = null;
        }
        continue;
      }

      // In NC OSFM transcripts, certification titles start near the left margin (x ~ 31),
      // whereas the address block at the top starts around x ~ 181.
      const firstX = row.items[0]?.x ?? 0;
      if (firstX < 60) {
        pendingCertTitle = rowText;
      }
    }
  }

  return {
    fileName,
    memberName,
    createdDate,
    certifications,
    error: certifications.length === 0 ? 'No certification entries were found in this transcript PDF.' : '',
  };
};

// Parses a CSV string containing certification rows into the same transcript structure.
export const parseCertificationCsv = (csvText, fileName = 'certifications.csv') => {
  const rows = parseCsv(csvText);
  if (!rows.length) {
    return [
      {
        fileName,
        memberName: '',
        createdDate: '',
        certifications: [],
        error: 'No valid rows found in CSV file.',
      },
    ];
  }

  const sample = rows[0];
  const keys = Object.keys(sample);
  const findKey = (pattern) => keys.find((k) => pattern.test(k));

  const memberCol = findKey(/member|name|user|personnel|firefighter/i) || keys[0];
  const certCol = findKey(/certification|cert|title|course|qualification/i) || keys[1];
  const effectiveCol = findKey(/effective|cert.*date|start|date|issued/i);
  const endCol = findKey(/end|expir|lapsed|until/i);
  const notesCol = findKey(/note|ifsac|number|comment/i);

  const byMember = new Map();

  rows.forEach((row) => {
    const memberName = text(row[memberCol]);
    const rawTitle = text(row[certCol]);
    if (!rawTitle) return;

    const key = memberName || 'Unknown Member';
    if (!byMember.has(key)) {
      byMember.set(key, {
        fileName,
        memberName: key,
        createdDate: '',
        certifications: [],
        error: '',
      });
    }

    const rawDate = effectiveCol ? text(row[effectiveCol]) : '';
    const rawEndDate = endCol ? text(row[endCol]) : '';
    const rawNotes = notesCol ? text(row[notesCol]) : '';

    byMember.get(key).certifications.push({
      rawTitle,
      cleanTitle: cleanCertificationTitle(rawTitle),
      ifsacNumber: '',
      rawDate,
      effectiveDate: normalizeTranscriptDate(rawDate),
      endDate: normalizeTranscriptDate(rawEndDate),
      notes: rawNotes,
    });
  });

  return [...byMember.values()];
};

// Builds a unified import plan across one or more parsed transcripts, resolving:
//   - Member mapping (auto-matched against `users`, overridable via `memberOverrides`)
//   - Certification type mapping (auto-matched against `setup`, overridable via `certOverrides`,
//     supporting `__create__` to create new Certification Setup types or `__skip__` to ignore)
//   - Duplicate detection against `existingRecords`
export const buildCertificationImportPlan = ({
  transcripts = [],
  users = [],
  setup = [],
  existingRecords = [],
  memberOverrides = {},
  certOverrides = {},
  stripEditionOnCreate = true,
  skipExisting = true,
}) => {
  const setupById = new Map((Array.isArray(setup) ? setup : []).map((t) => [String(t.id), t]));

  // Index existing records by `user_id:::certification_id`
  const existingMap = new Map();
  (Array.isArray(existingRecords) ? existingRecords : []).forEach((rec) => {
    if (!rec?.user_id || !rec?.certification_id) return;
    const key = `${rec.user_id}:::${rec.certification_id}`;
    existingMap.set(key, rec);
  });

  // Collect unique raw certification titles across all uploaded transcripts
  const uniqueCertTitles = new Map();
  for (const t of transcripts) {
    for (const c of t.certifications || []) {
      if (!uniqueCertTitles.has(c.rawTitle)) {
        const autoMatchedSetup = matchCertificationSetup(c.rawTitle, setup);
        const override = certOverrides[c.rawTitle];
        const action =
          override !== undefined
            ? override
            : autoMatchedSetup
              ? String(autoMatchedSetup.id)
              : '__create__';

        const newTypeName = stripEditionOnCreate ? c.cleanTitle || c.rawTitle : c.rawTitle;

        uniqueCertTitles.set(c.rawTitle, {
          rawTitle: c.rawTitle,
          cleanTitle: c.cleanTitle || c.rawTitle,
          autoMatchedSetup,
          action, // setup.id | '__create__' | '__skip__'
          resolvedSetup: setupById.get(String(action)) || null,
          newTypeName,
        });
      }
    }
  }

  // Resolve members and individual certification rows
  const resolvedTranscripts = transcripts.map((t, index) => {
    const memberKey = `${t.fileName}:::${t.memberName || index}`;
    const autoMatchedUser = matchTranscriptMember(t.memberName, users);
    const overrideUserId = memberOverrides[memberKey];

    let resolvedUser = null;
    let isMemberSkipped = false;
    if (overrideUserId === '__skip__') {
      isMemberSkipped = true;
    } else if (overrideUserId) {
      resolvedUser = users.find((u) => String(u.id) === String(overrideUserId)) || null;
    } else {
      resolvedUser = autoMatchedUser;
    }

    const items = (t.certifications || []).map((cert, certIdx) => {
      const certMapping = uniqueCertTitles.get(cert.rawTitle);
      const action = certMapping?.action || '__create__';
      const isCertSkipped = action === '__skip__';
      const resolvedSetup = certMapping?.resolvedSetup || null;

      const existingRecord =
        resolvedUser && resolvedSetup
          ? existingMap.get(`${resolvedUser.id}:::${resolvedSetup.id}`) || null
          : null;

      const isDuplicate = Boolean(existingRecord);

      let status = 'ready'; // 'ready' | 'create_type' | 'duplicate_skipped' | 'duplicate_update' | 'skipped' | 'unmatched_member'
      if (isMemberSkipped || isCertSkipped) {
        status = 'skipped';
      } else if (!resolvedUser) {
        status = 'unmatched_member';
      } else if (isDuplicate) {
        status = skipExisting ? 'duplicate_skipped' : 'duplicate_update';
      } else if (action === '__create__') {
        status = 'create_type';
      }

      return {
        id: `${memberKey}:::${certIdx}`,
        ...cert,
        action,
        resolvedSetup,
        newTypeName: certMapping?.newTypeName || cert.cleanTitle || cert.rawTitle,
        existingRecord,
        isDuplicate,
        status,
      };
    });

    return {
      ...t,
      memberKey,
      autoMatchedUser,
      resolvedUser,
      isMemberSkipped,
      items,
    };
  });

  const allItems = resolvedTranscripts.flatMap((t) =>
    t.items.map((item) => ({
      ...item,
      memberKey: t.memberKey,
      memberName: t.memberName,
      user: t.resolvedUser,
      fileName: t.fileName,
    }))
  );

  const typesToCreate = new Map();
  for (const item of allItems) {
    if (item.status === 'create_type' && item.newTypeName) {
      const normKey = item.newTypeName.toLowerCase();
      if (!typesToCreate.has(normKey)) {
        typesToCreate.set(normKey, item.newTypeName);
      }
    }
  }

  const actionableItems = allItems.filter(
    (item) =>
      item.status === 'ready' ||
      item.status === 'create_type' ||
      item.status === 'duplicate_update'
  );

  return {
    transcripts: resolvedTranscripts,
    uniqueCertifications: [...uniqueCertTitles.values()],
    allItems,
    actionableItems,
    typesToCreate: [...typesToCreate.values()],
    counts: {
      totalExtracted: allItems.length,
      readyToImport: actionableItems.length,
      newTypesCount: typesToCreate.size,
      duplicateSkippedCount: allItems.filter((i) => i.status === 'duplicate_skipped').length,
      manualSkippedCount: allItems.filter((i) => i.status === 'skipped').length,
      unmatchedMemberItemsCount: allItems.filter((i) => i.status === 'unmatched_member').length,
    },
  };
};

