// Verification test for the training CSV import parser and session grouper.
//
//   npm run verify:training-import
//   or: node scripts/verify-training-import.mjs

import {
  parseCsv,
  normalizePersonName,
  nameVariants,
  matchUser,
  parseImportDate,
  mapCategory,
  parseImportDuration,
  prepareTrainingImportPlan,
} from '../src/utils/trainingCsvImport.js';

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

console.log('--- CSV Parsing ---');
const sampleCsv = `
"Attendee Full Name","Activity/Training Category","Activity/Training Total Hours","Activity/Training Start Actual Date"
"Abby Hall","Company Training","2.50","12/18/2025"
"Cody  w Keeter","Company Training","2","11/13/2025"
"Cameron Rave","Rescue Training, Advanced","4","01/14/2025"
`.trim();

const parsed = parseCsv(sampleCsv);
check('parsed 3 rows', parsed.length, 3);
check('row 1 attendee', parsed[0]['Attendee Full Name'], 'Abby Hall');
check('row 1 hours', parsed[0]['Activity/Training Total Hours'], '2.50');
check('row 3 category with comma inside quotes', parsed[2]['Activity/Training Category'], 'Rescue Training, Advanced');

console.log('\n--- Name Normalization & Matching ---');
check('normalize name strips punctuation and spaces', normalizePersonName('  Smith,   John M. '), 'smith john m');
check('name variants includes first last', nameVariants('Adam M Lancaster').includes('adam lancaster'), true);

const mockUsers = [
  { id: 'u1', name: 'Abby Hall' },
  { id: 'u2', name: 'Adam Lancaster' },
  { id: 'u3', name: 'Cameron Rave' },
  { id: 'u4', name: 'Cody Keeter' },
];

check('exact name match', matchUser('Abby Hall', mockUsers)?.id, 'u1');
check('middle initial in CSV matches user without middle initial', matchUser('Adam M Lancaster', mockUsers)?.id, 'u2');
check('extra spaces in CSV name matches user', matchUser('Cody  w Keeter', mockUsers)?.id, 'u4');
check('unknown name returns null', matchUser('Unknown Person', mockUsers), null);

console.log('\n--- Date & Duration Parsing ---');
check('MM/DD/YYYY to YYYY-MM-DD', parseImportDate('12/09/2025')?.dateKey, '2025-12-09');
check('single-digit M/D/YYYY', parseImportDate('1/4/2025')?.dateKey, '2025-01-04');
check('already ISO date', parseImportDate('2025-06-16')?.dateKey, '2025-06-16');
check('invalid date returns null', parseImportDate('not a date'), null);
check('duration float', parseImportDuration('2.50'), 2.5);
check('duration integer', parseImportDuration('3'), 3);
check('missing duration defaults to 0', parseImportDuration(''), 0);

console.log('\n--- Category Mapping ---');
const company = mapCategory('Company Training');
check('company training flag', company.flags.is_company_training, true);
check('company training hazmat flag false', company.flags.is_hazmat, false);

const hazmat = mapCategory('Hazmat Training');
check('hazmat flag', hazmat.flags.is_hazmat, true);

const firePrev = mapCategory('Community Relations/ Fire Prevention');
check('fire prevention flag', firePrev.flags.is_fire_prevention, true);

const custom = mapCategory('Dept Fundraising events');
check('custom category preserves title', custom.title, 'Dept Fundraising events');
check('custom category all flags false', Object.values(custom.flags).every((f) => f === false), true);

console.log('\n--- Full Import Plan & Grouping ---');
const testDataset = `
"Activity/Training Agency Name","Attendee Full Name","Activity/Training Category","Activity/Training Total Hours","Activity/Training Start Actual Date"
"Bolivia FD","","","",""
"Bolivia FD","","Company Training","4","05/30/2025"
"Bolivia FD","Abby Hall","Company Training","3","02/03/2026"
"Bolivia FD","Adam M Lancaster","Company Training","3","02/03/2026"
"Bolivia FD","Cameron Rave","Company Training","3","02/03/2026"
"Bolivia FD","Abby Hall","Company Training","2","11/13/2025"
"Bolivia FD","Cody  w Keeter","Company Training","2","11/13/2025"
"Bolivia FD","Unregistered Volunteer","Company Training","2","11/13/2025"
"Bolivia FD","Cameron Rave","Company Training","1",""
`.trim();

const plan = prepareTrainingImportPlan(testDataset, mockUsers);
check('total rows parsed', plan.totalRows, 9);
check('skipped rows count (missing attendee or missing date)', plan.skippedRows.length, 3);
check('valid attendee rows count', plan.validRowsCount, 6);
// The 6 valid attendee rows should group into 2 unique sessions:
// 1) 2026-02-03, Company Training, 3 hrs (Abby, Adam, Cameron)
// 2) 2025-11-13, Company Training, 2 hrs (Abby, Cody, Unregistered Volunteer)
check('unique sessions count', plan.sessions.length, 2);
check('session 1 date_key', plan.sessions[0].date_key, '2026-02-03');
check('session 1 attendees count', plan.sessions[0].attendees.length, 3);
check('session 1 signature_count (matched users)', plan.sessions[0].signature_count, 3);
check('unmatched attendee detected', plan.unmatchedAttendees, ['Unregistered Volunteer']);
check('matched attendees count', plan.matchedCount, 4);
check('total signatures to create', plan.totalSignatures, 5); // Abby, Adam, Cameron for session 1; Abby, Cody for session 2

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
