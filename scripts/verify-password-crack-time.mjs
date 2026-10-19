import { estimatePasswordCrackTime, BRUTE_FORCE_TABLE_2026, getCrackTimeTier } from '../src/utils/passwordCrackTime.js';

let failures = 0;
function check(description, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (pass) {
    console.log(`ok   ${description}`);
  } else {
    console.error(`FAIL ${description}\n     expected: ${JSON.stringify(expected)}\n     actual:   ${JSON.stringify(actual)}`);
    failures += 1;
  }
}

console.log('--- Brute force table verification against 2026 16x RTX 5090 benchmark ---');

// Verify every row in the table matches expected values from reference image
check('row 4 matches', BRUTE_FORCE_TABLE_2026[4], ['Instantly', 'Instantly', 'Instantly', 'Instantly', 'Instantly']);
check('row 5 matches', BRUTE_FORCE_TABLE_2026[5], ['Instantly', 'Instantly', '46 mins', '2 hours', '3 hours']);
check('row 6 matches', BRUTE_FORCE_TABLE_2026[6], ['Instantly', '37 mins', '2 days', '5 days', '1 week']);
check('row 7 matches', BRUTE_FORCE_TABLE_2026[7], ['Instantly', '16 hours', '3 months', '10 months', '2 years']);
check('row 8 matches', BRUTE_FORCE_TABLE_2026[8], ['Instantly', '2 weeks', '12 years', '50 years', '132 years']);
check('row 9 matches', BRUTE_FORCE_TABLE_2026[9], ['2 hours', '1 year', '636 years', '3k years', '9k years']);
check('row 10 matches', BRUTE_FORCE_TABLE_2026[10], ['20 hours', '32 years', '33k years', '191k years', '645k years']);
check('row 11 matches', BRUTE_FORCE_TABLE_2026[11], ['1 week', '839 years', '1m years', '11m years', '45m years']);
check('row 12 matches', BRUTE_FORCE_TABLE_2026[12], ['3 months', '21k years', '89m years', '737m years', '3bn years']);
check('row 13 matches', BRUTE_FORCE_TABLE_2026[13], ['2 years', '567k years', '4bn years', '45bn years', '221bn years']);
check('row 14 matches', BRUTE_FORCE_TABLE_2026[14], ['23 years', '14m years', '241bn years', '2tn years', '15tn years']);
check('row 15 matches', BRUTE_FORCE_TABLE_2026[15], ['229 years', '383m years', '12tn years', '175tn years', '1qd years']);
check('row 16 matches', BRUTE_FORCE_TABLE_2026[16], ['2k years', '9bn years', '653tn years', '10qd years', '75qd years']);
check('row 17 matches', BRUTE_FORCE_TABLE_2026[17], ['22k years', '259bn years', '33qd years', '675qd years', '5qn years']);
check('row 18 matches', BRUTE_FORCE_TABLE_2026[18], ['228k years', '6tn years', '1qn years', '41qn years', '372qn years']);

console.log('\n--- Category and character class breakdown tests ---');
const numSample = estimatePasswordCrackTime('123456');
check('numbers only category', numSample.categoryLabel, 'Numbers Only');
check('numbers only crack time', numSample.crackTime, 'Instantly');
check('numbers only tier', numSample.tier, 1);

const lowerSample = estimatePasswordCrackTime('abcdef');
check('lowercase category', lowerSample.categoryLabel, 'Lowercase Letters');
check('lowercase crack time', lowerSample.crackTime, '37 mins');
check('lowercase tier', lowerSample.tier, 2);

const upperLowerSample = estimatePasswordCrackTime('Abcdef');
check('upper and lower category', upperLowerSample.categoryLabel, 'Upper & Lowercase Letters');
check('upper and lower crack time', upperLowerSample.crackTime, '2 days');
check('upper and lower tier', upperLowerSample.tier, 2);

const numUpperLowerSample = estimatePasswordCrackTime('Abc123');
check('numbers, upper & lower category', numUpperLowerSample.categoryLabel, 'Numbers, Upper & Lowercase');
check('numbers, upper & lower crack time', numUpperLowerSample.crackTime, '5 days');
check('numbers, upper & lower tier', numUpperLowerSample.tier, 2);

const fullSample = estimatePasswordCrackTime('Abc123!');
check('all four classes category', fullSample.categoryLabel, 'Numbers, Upper & Lowercase, Symbols');
check('all four classes crack time', fullSample.crackTime, '2 years');
check('all four classes tier', fullSample.tier, 3);

const longStrongSample = estimatePasswordCrackTime('FireHouse#2026!Strong');
check('long strong password crack time', longStrongSample.crackTime, '> 1,000qn years');
check('long strong password tier', longStrongSample.tier, 5);

const emptySample = estimatePasswordCrackTime('');
check('empty password charCount', emptySample.charCount, 0);

console.log('\n--- System setting strength policy tests ---');
import {
  PASSWORD_MIN_STRENGTH_KEY,
  PASSWORD_STRENGTH_LEVELS,
  getRequiredPasswordStrength,
  checkPasswordStrengthPolicy,
} from '../src/utils/passwordCrackTime.js';
import { passwordChangeProblem } from '../src/utils/passwordPolicy.js';
import { PUBLIC_SETTING_KEYS, settingSide } from '../src/utils/systemSettings.js';

check('PASSWORD_MIN_STRENGTH_KEY is in PUBLIC_SETTING_KEYS', PUBLIC_SETTING_KEYS.includes(PASSWORD_MIN_STRENGTH_KEY), true);
check('PASSWORD_MIN_STRENGTH_KEY routes to public settings document', settingSide(PASSWORD_MIN_STRENGTH_KEY), 'public');
check('default policy is none', getRequiredPasswordStrength([]).id, 'none');
check('object policy resolution', getRequiredPasswordStrength({ [PASSWORD_MIN_STRENGTH_KEY]: 'moderate' }).id, 'moderate');
check('array policy resolution', getRequiredPasswordStrength([{ key: PASSWORD_MIN_STRENGTH_KEY, value: 'strong' }]).id, 'strong');
check('unknown policy falls back to none', getRequiredPasswordStrength({ [PASSWORD_MIN_STRENGTH_KEY]: 'invalid_level' }).id, 'none');

// When policy is none:
const noPolicyCheck = checkPasswordStrengthPolicy('123456', [{ key: PASSWORD_MIN_STRENGTH_KEY, value: 'none' }]);
check('none policy allows any password', noPolicyCheck.ok, true);

// When policy is moderate (Tier 3+):
const weakUnderModerate = checkPasswordStrengthPolicy('12345678', [{ key: PASSWORD_MIN_STRENGTH_KEY, value: 'moderate' }]);
check('moderate policy rejects numbers-only password', weakUnderModerate.ok, false);

const moderateUnderModerate = checkPasswordStrengthPolicy('Password123!', [{ key: PASSWORD_MIN_STRENGTH_KEY, value: 'moderate' }]);
check('moderate policy accepts strong password', moderateUnderModerate.ok, true);

// Test passwordChangeProblem integration:
check(
  'passwordChangeProblem rejects weak password when moderate policy is set',
  passwordChangeProblem({
    newPassword: 'password',
    confirmPassword: 'password',
    systemSettings: [{ key: PASSWORD_MIN_STRENGTH_KEY, value: 'moderate' }],
  }).includes('does not meet the station security policy'),
  true
);

check(
  'passwordChangeProblem accepts strong password when moderate policy is set',
  passwordChangeProblem({
    newPassword: 'MyStrongPassword123!',
    confirmPassword: 'MyStrongPassword123!',
    systemSettings: [{ key: PASSWORD_MIN_STRENGTH_KEY, value: 'moderate' }],
  }),
  ''
);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

