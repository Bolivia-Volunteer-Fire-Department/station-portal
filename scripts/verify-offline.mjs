// The offline rule: what refuses when the device has no connection, and what does not.
//
// WHY THIS DESERVES A HARNESS. Two of the claims here are the kind that fail silently:
//
//   1. CLOCKING IN AND OUT MUST NOT QUEUE. Firestore queues an offline write and applies it later, stamped with the DEVICE's
//      clock - so a clock-in written in a dead spot and applied four hours on is a record saying somebody arrived at the
//      wrong time, and it is the record the station uses to say who was on duty. That refusal has to exist, and it has to
//      exist in the WRITER rather than in the screen, because the screen is not the only way in.
//   2. NOTHING ELSE MAY REFUSE. The opposite mistake is a guard that spreads: a station with patchy coverage would stop
//      accepting the notes and availability edits that queue perfectly safely, and nobody would connect the two.
//
// The third claim is about the cache itself: persistence is ON for the browser, where it is what makes a dead spot a gap in
// the signal rather than a screen that cannot load - and OFF for the harnesses, because the persistent cache is IndexedDB
// and IndexedDB does not exist in Node, so an unconditional one would make every emulator harness fail to start.
//
// Pure: no browser, no emulator, no Firebase. `navigator.onLine` is stubbed for the duration and put back afterwards,
// including the case where the global did not exist at all.
//
// Run with: npm run verify:offline
import { readFileSync } from 'node:fs';
import { OFFLINE_CLOCK_MESSAGE, OFFLINE_WRITE_MESSAGE, isOffline } from '../src/utils/connectivity.js';
import { failureFor } from '../src/services/firestoreRouting.js';

let failures = 0;
let cases = 0;
const check = (label, actual, expected) => {
  cases++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`
  );
};
const checkIs = (label, condition, detail) => {
  cases++;
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` -> ${detail}`}`);
};

// Stubbing the device's answer, and putting the global back exactly as it was - Node has its own `navigator`, so deleting it
// is not a restore.
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const setOnline = (value) => {
  if (value === null) {
    if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
    else delete globalThis.navigator;
    return;
  }
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: value }, configurable: true, writable: true });
};

console.log('--- what the device says ---');
setOnline(false);
check('a device with no connection is offline', isOffline(), true);
setOnline(true);
check('one with a connection is not', isOffline(), false);
// The failure mode that matters: a browser too old to have the property, and a Node harness, both get "try it".
setOnline(undefined);
check('a device that cannot say is treated as online', isOffline(), false);
setOnline(null);
check('and a runtime with no navigator at all likewise', isOffline(), false);

console.log('\n--- and what a failed write says about it ---');
setOnline(false);
const offlineClock = failureFor(new Error('offline'));
check('a refused clock action keeps the clock sentence', offlineClock.message, OFFLINE_CLOCK_MESSAGE);
check('and is a refusal rather than a crash', offlineClock.code, 'REFUSED');
// Any other write that dies while the device has no connection: Firestore's own words are about a transport, which is true
// of a read and misleading for a write that has not been saved.
const offlineWrite = failureFor(
  Object.assign(new Error('Failed to get document because the client is offline'), { code: 'unavailable' })
);
check('another write that could not land says nothing was saved', offlineWrite.message, OFFLINE_WRITE_MESSAGE);
check('with a code of its own, so a screen can tell the two apart', offlineWrite.code, 'OFFLINE');
setOnline(true);
// THE SAME ERROR, ONLINE: the device is not the reason, so the device must not be blamed - an unreachable backend while the
// member HAS a connection would otherwise send them off to fix their wifi.
const onlineWrite = failureFor(Object.assign(new Error('Deadline exceeded'), { code: 'unavailable' }));
checkIs('while the same failure with a connection blames nobody', onlineWrite.code === 'FIRESTORE_ERROR');
check('and keeps Firestore’s own message', onlineWrite.message, 'Deadline exceeded');
// The other sentinels still win over the general case, so a member offline AND already clocked in hears the first thing.
check('a known refusal still speaks first', failureFor(new Error('already-clocked-in')).message, 'You are already clocked in.');
setOnline(null);


console.log('\n--- the pieces that make it true ---');
const firebaseSource = readFileSync('src/services/firebase.js', 'utf8');
const writesSource = readFileSync('src/services/firestoreWrites.js', 'utf8');
const routingSource = readFileSync('src/services/firestoreRouting.js', 'utf8');
const appSource = readFileSync('src/App.jsx', 'utf8');
const cardSource = readFileSync('src/components/ClockCard.jsx', 'utf8');

checkIs('the cache is a persistent one in the browser', /persistentLocalCache\(\{ tabManager: persistentMultipleTabManager\(\) \}\)/.test(firebaseSource));
checkIs('the database is initialised, not merely fetched', /initializeFirestore\(firebaseApp\(\)/.test(firebaseSource));
// One tab taking the database away from another is the real failure of the single-tab manager, and this portal is used in
// two tabs at once (the calendar in one, the clock in the other).
checkIs('with the multi-tab manager rather than the single-tab one', !/persistentSingleTabManager/.test(firebaseSource));
checkIs(
  'and the harnesses get the in-memory cache, because Node has no IndexedDB',
  /usingEmulator\s*\?\s*memoryLocalCache\(\)/.test(firebaseSource)
);
// A browser that refuses IndexedDB - private mode, storage switched off, an embedded webview - must start the app anyway:
// losing the offline gap is a degradation, and an app that will not load is not.
checkIs(
  'and a browser that refuses the persistent cache still starts, from memory',
  /try \{\n    return persistentLocalCache\(/.test(firebaseSource) && /return memoryLocalCache\(\);/.test(firebaseSource)
);
checkIs('the old unconditional getFirestore is gone', !/getFirestore\(/.test(firebaseSource));

check(
  'the clock writers refuse rather than queue, on both doors',
  (writesSource.match(/^  refuseOffline\(\);$/gm) || []).length,
  2
);
checkIs(
  'with the guard defined once, in the writer, before anything is attempted',
  /const refuseOffline = \(\) => \{\n  if \(isOffline\(\)\) throw new Error\('offline'\);\n\};/.test(writesSource)
);
checkIs('and the refusal is a name the routing already knows', /offline: OFFLINE_CLOCK_MESSAGE/.test(routingSource));
checkIs(
  'every routed write is translated, not only the clock',
  /if \(isOffline\(\)\) return fail\(OFFLINE_WRITE_MESSAGE, 'OFFLINE'\)/.test(routingSource)
);

// The ORDER inside the handler is the point of this check: a GPS permission prompt shown before the refusal is exactly what
// the guard was written to avoid.
const handler = appSource.slice(appSource.indexOf('const handleClockAction = async'));
const guardAt = handler.indexOf('isOffline()');
const gpsAt = handler.indexOf('getCurrentCoordinates()');
checkIs('the refusal is checked before the GPS prompt, not after', guardAt > -1 && gpsAt > -1 && guardAt < gpsAt);
checkIs('and the buttons are not offered either', /disabled=\{loading \|\| offline\}/.test(cardSource));
checkIs('with the reason on screen', /OFFLINE_CLOCK_MESSAGE/.test(cardSource));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} (${cases} cases)`);
process.exit(failures === 0 ? 0 : 1);
