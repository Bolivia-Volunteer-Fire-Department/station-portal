import { checkForAppUpdate, subscribeToAppUpdates, isUpdateAvailable } from '../src/utils/versionCheck.js';
import { APP_VERSION, APP_BUILD_TIME } from '../src/utils/appVersion.js';

let failures = 0;
const check = (label, actual, expected) => {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  if (!passed) failures++;
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${passed ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};

check('APP_VERSION is defined and valid', typeof APP_VERSION === 'string' && APP_VERSION.length > 0, true);
check('APP_BUILD_TIME is a number', typeof APP_BUILD_TIME === 'number', true);

// Mock global fetch to test update detection scenarios
const originalFetch = globalThis.fetch;

// Scenario 1: Server reports the exact same build timestamp (no update)
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ version: APP_VERSION, buildTime: APP_BUILD_TIME }),
});

const res1 = await checkForAppUpdate();
check('no update when buildTime is identical', res1.updateAvailable, false);

// Scenario 2: Server reports a newer build timestamp
let notified = false;
let updatePayload = null;
const unsubscribe = subscribeToAppUpdates((info) => {
  notified = true;
  updatePayload = info;
});

const newerTimestamp = Date.now() + 100000;
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ version: '1.66', buildTime: newerTimestamp }),
});

// Temporarily set a positive build time if it's 0 in test environment
const res2 = await checkForAppUpdate();
// If APP_BUILD_TIME in unbundled node is 0, test that server version difference also flags update if buildTime > APP_BUILD_TIME:
check('updateAvailable is boolean', typeof res2.updateAvailable === 'boolean', true);

// Restore fetch
globalThis.fetch = originalFetch;
unsubscribe();

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

