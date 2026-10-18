// Verification test for hydrant CSV import and reconciliation.
//
//   npm run verify:hydrant-import
//   or: node scripts/verify-hydrant-import.mjs

import {
  parseCleanNumber,
  parseHydrantTestDate,
  prepareHydrantImportPlan,
} from '../src/utils/hydrantCsvImport.js';
import { getHydrantNfpaClass } from '../src/utils/preIncidentPlans.js';

let failures = 0;
const check = (desc, actual, expected) => {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson === expectedJson) {
    console.log(`ok   ${desc}`);
  } else {
    console.error(`FAIL ${desc}\n  expected: ${expectedJson}\n  received: ${actualJson}`);
    failures++;
  }
};

console.log('--- Number and Date Cleaning ---');
check('parseCleanNumber with commas', parseCleanNumber('1,007.100000000'), 1007.1);
check('parseCleanNumber 20psi flow', parseCleanNumber('2,129.046000000'), 2129);
check('parseCleanNumber empty', parseCleanNumber(''), null);
check('parseHydrantTestDate with timestamp', parseHydrantTestDate('12/31/2024 00:00:00'), '2024-12-31');
check('parseHydrantTestDate with time', parseHydrantTestDate('01/16/2025 13:36:48'), '2025-01-16');

console.log('\n--- NFPA 291 Classifications ---');
check('Class AA (1500+ GPM)', getHydrantNfpaClass(2129).shortClass, 'Class AA');
check('Class A (1000-1499 GPM)', getHydrantNfpaClass(1464).shortClass, 'Class A');
check('Class B (500-999 GPM)', getHydrantNfpaClass(750).shortClass, 'Class B');
check('Class C (<500 GPM)', getHydrantNfpaClass(450).shortClass, 'Class C');
check('Unknown flow', getHydrantNfpaClass(0).shortClass, 'Unrated');

console.log('\n--- User CSV Sample Import & Reconciliation ---');
const userCsv = `
"Agency Name (dAgency.03)","Hydrant ID","Hydrant Location","Hydrant Section Or District","Hydrant Test Date","Hydrant Test Static Pressure","Hydrant Test Residual Pressure","Hydrant Test Pitot Pressure","Hydrant Test Calculated Gpm","Hydrant Test Calculated Gpm At 20Psi","Hydrant Test Tested By"
"Bolivia FD","HYD-337","4455 E Ocean Hwy","1","12/31/2024 00:00:00","62","52","40","1,007.100000000","2,129.046000000","Myles R Cooper"
"Bolivia FD","HYD-338","E Ocean Hwy","1","12/31/2024 00:00:00","60","52","42","1,007.100000000","2,401.687000000","Myles R Cooper"
"Bolivia FD","HYD-339","E Ocean Hwy","1","12/31/2024 00:00:00","60","55","42","1,007.100000000","3,095.574000000","Myles R Cooper"
"Bolivia FD","HYD-340","E Ocean Hwy","1","01/16/2025 13:36:48","68","50","40","1,007.100000000","1,464.296000000","Myles R Cooper"
"Bolivia FD","HYD-341","E Ocean Hwy","1","01/16/2025 13:38:30","70","55","40","1,007.100000000","1,822.712000000","Myles R Cooper"
"Bolivia FD","HYD-342","E Ocean Hwy","1","01/16/2025 13:39:51","70","60","45","1,007.100000000","2,401.687000000","Myles R Cooper"
"Bolivia FD","HYD-343","4855 E Ocean Hwy","1","01/16/2025 13:40:36","65","55","42","1,007.100000000","2,129.046000000","Myles R Cooper"
`.trim();

// Mock existing hydrants (suppose HYD-337 was already saved from a preplan)
const mockExisting = [
  {
    id: 'HYD-337',
    hydrant_id: 'HYD-337',
    address: '4455 E Ocean Hwy',
    latitude: 33.95,
    longitude: -78.15,
    status: 'in-service',
  },
];

const plan = prepareHydrantImportPlan(userCsv, mockExisting);
check('total rows parsed', plan.totalRows, 7);
check('valid rows count', plan.validRowsCount, 7);
check('unique hydrants count', plan.uniqueHydrantsCount, 7);
check('new hydrants count', plan.newCount, 6);
check('existing hydrants to update count', plan.updateCount, 1);
check('skipped rows count', plan.skippedRows.length, 0);

const hyd337 = plan.hydrants.find((h) => h.id === 'HYD-337');
check('HYD-337 marked isExisting', hyd337.isExisting, true);
check('HYD-337 preserves latitude', hyd337.latitude, 33.95);
check('HYD-337 updated flow @ 20psi', hyd337.calculated_gpm_20psi, 2129);
check('HYD-337 rated flow integer', hyd337.flow, 2129);
check('HYD-337 static pressure', hyd337.static_pressure_psi, 62);
check('HYD-337 residual pressure', hyd337.residual_pressure_psi, 52);
check('HYD-337 pitot pressure', hyd337.pitot_pressure_psi, 40);
check('HYD-337 tested by', hyd337.tested_by, 'Myles R Cooper');
check('HYD-337 NFPA class', hyd337.nfpaClass.shortClass, 'Class AA');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

