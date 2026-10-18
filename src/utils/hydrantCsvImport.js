// Hydrant CSV import and reconciliation.
//
// Translates municipal/district hydrant flow test and inspection CSVs into Fire Clock's
// shared hydrants collection ('hydrants/{id}'), matching against existing preplan hydrants.

import { parseCsv } from './trainingCsvImport.js';
import { normalizeHydrant, getHydrantNfpaClass } from './preIncidentPlans.js';

const text = (val) => String(val ?? '').trim();

// Parses a numeric pressure or flow value, removing commas and decimals if needed.
export const parseCleanNumber = (val) => {
  const cleaned = text(val).replace(/,/g, '');
  if (!cleaned) return null;
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? Math.round(num * 10) / 10 : null;
};

// Formats a test date string from MM/DD/YYYY HH:MM:SS or similar to YYYY-MM-DD
export const parseHydrantTestDate = (raw) => {
  const str = text(raw);
  if (!str) return '';

  // Extract date part before any time
  const datePart = str.split(' ')[0].split('T')[0];

  // If already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return datePart;
  }

  // MM/DD/YYYY
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(datePart);
  if (mdy) {
    const m = String(mdy[1]).padStart(2, '0');
    const d = String(mdy[2]).padStart(2, '0');
    const y = mdy[3];
    return `${y}-${m}-${d}`;
  }

  return datePart;
};

// Prepares a complete hydrant import plan from CSV text and existing hydrants.
export const prepareHydrantImportPlan = (csvText, existingHydrants = []) => {
  const rows = parseCsv(csvText);

  const existingMap = new Map();
  (Array.isArray(existingHydrants) ? existingHydrants : []).forEach((h) => {
    const norm = normalizeHydrant(h);
    const key = text(norm.id || norm.hydrant_id).toLowerCase();
    if (key) {
      existingMap.set(key, norm);
    }
  });

  const skippedRows = [];
  const candidateHydrants = [];

  // Match headers tolerantly
  let idCol = 'Hydrant ID';
  let locCol = 'Hydrant Location';
  let distCol = 'Hydrant Section Or District';
  let dateCol = 'Hydrant Test Date';
  let staticCol = 'Hydrant Test Static Pressure';
  let residualCol = 'Hydrant Test Residual Pressure';
  let pitotCol = 'Hydrant Test Pitot Pressure';
  let gpmCol = 'Hydrant Test Calculated Gpm';
  let flow20Col = 'Hydrant Test Calculated Gpm At 20Psi';
  let testerCol = 'Hydrant Test Tested By';
  let agencyCol = 'Agency Name (dAgency.03)';

  if (rows.length > 0) {
    const sample = rows[0];
    const keys = Object.keys(sample);
    const findKey = (pattern) => keys.find((k) => pattern.test(k));

    idCol = findKey(/hydrant\s*id|hydrant\s*number|tag/i) || idCol;
    locCol = findKey(/location|address|street/i) || locCol;
    distCol = findKey(/section|district|zone/i) || distCol;
    dateCol = findKey(/test\s*date|inspection\s*date|date/i) || dateCol;
    staticCol = findKey(/static/i) || staticCol;
    residualCol = findKey(/residual/i) || residualCol;
    pitotCol = findKey(/pitot/i) || pitotCol;
    gpmCol = findKey(/calculated\s*gpm$|test\s*gpm/i) || gpmCol;
    flow20Col = findKey(/20\s*psi|flow|rated/i) || flow20Col;
    testerCol = findKey(/tested\s*by|inspector|tester/i) || testerCol;
    agencyCol = findKey(/agency/i) || agencyCol;
  }

  rows.forEach((row, idx) => {
    const hydrantId = text(row[idCol]);
    const address = text(row[locCol]);
    const district = text(row[distCol]);
    const testDate = parseHydrantTestDate(row[dateCol]);
    const staticPsi = parseCleanNumber(row[staticCol]);
    const residualPsi = parseCleanNumber(row[residualCol]);
    const pitotPsi = parseCleanNumber(row[pitotCol]);
    const calculatedGpm = parseCleanNumber(row[gpmCol]);
    const flowAt20 = parseCleanNumber(row[flow20Col]);
    const testedBy = text(row[testerCol]);
    const agencyName = text(row[agencyCol]);

    if (!hydrantId) {
      skippedRows.push({
        rowIndex: idx + 2,
        reason: 'Missing Hydrant ID',
        data: row,
      });
      return;
    }

    const flowGpm = flowAt20 ?? calculatedGpm;
    const nfpaClass = getHydrantNfpaClass(flowGpm);

    candidateHydrants.push({
      rowIndex: idx + 2,
      id: hydrantId,
      hydrant_id: hydrantId,
      address,
      district,
      last_tested_date: testDate,
      static_pressure_psi: staticPsi,
      residual_pressure_psi: residualPsi,
      pitot_pressure_psi: pitotPsi,
      calculated_gpm: calculatedGpm,
      calculated_gpm_20psi: flowAt20,
      flow: flowGpm ? Math.round(flowGpm) : null,
      tested_by: testedBy,
      agency_name: agencyName,
      nfpaClass,
    });
  });

  // Deduplicate in case CSV contains multiple test rows for the same hydrant
  // Newer test date wins
  const groupedById = new Map();

  candidateHydrants.forEach((cand) => {
    const key = cand.id.toLowerCase();
    const existingCand = groupedById.get(key);

    if (!existingCand) {
      groupedById.set(key, cand);
    } else {
      // If candidate has a newer test date, update with latest test results
      if (cand.last_tested_date >= existingCand.last_tested_date) {
        groupedById.set(key, {
          ...existingCand,
          ...cand,
          address: cand.address || existingCand.address,
        });
      }
    }
  });

  const uniqueHydrants = [...groupedById.values()];
  let newCount = 0;
  let updateCount = 0;

  const hydrantsToSave = uniqueHydrants.map((cand) => {
    const key = cand.id.toLowerCase();
    const existing = existingMap.get(key);

    if (existing) {
      updateCount++;
      return {
        ...existing,
        ...cand,
        // Preserve existing coordinates, status, and type if present
        latitude: existing.latitude ?? null,
        longitude: existing.longitude ?? null,
        status: existing.status || 'in-service',
        type: existing.type || 'dry',
        notes: existing.notes || cand.notes || '',
        isExisting: true,
      };
    } else {
      newCount++;
      return {
        ...cand,
        status: 'in-service',
        type: 'dry',
        isExisting: false,
      };
    }
  });

  return {
    totalRows: rows.length,
    validRowsCount: candidateHydrants.length,
    uniqueHydrantsCount: hydrantsToSave.length,
    newCount,
    updateCount,
    skippedRows,
    hydrants: hydrantsToSave,
  };
};

