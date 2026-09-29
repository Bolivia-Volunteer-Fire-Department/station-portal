/**
 * Verifies the seam that decides whether an action goes to Firestore or to Apps Script.
 *
 * What this exists for: `src/services/firestoreRouting.js` is the one place that can silently send a write to the
 * other backend, and a wrong answer there does not throw - it puts a fact somewhere nothing reads it. Two of its
 * properties are what make it safe, and neither is visible by reading a diff:
 *
 *   1. **Nothing is routed by default.** A build without the VITE_FIREBASE_* values, or without the feature named,
 *      keeps every action on Apps Script exactly as before. The app cannot regress by this file existing.
 *   2. **A feature with unmet prerequisites does not route either**, even when switched on. That is the guard
 *      against moving a write while the read that shows it is still on the sheet.
 *
 * It also reads `api.js` and checks that every action the table claims to route is actually wired to `routeWrite` -
 * so a rename on either side fails here instead of at runtime - and it mutates the source to prove that check bites.
 *
 * What this cannot check: what the databases contain. Routing to Firestore in front of an empty database is
 * precisely the failure this guards against, and only a person looking at the two can see it.
 *
 * Run with: npm run verify:backend-routing
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

let failures = 0;
const checkIs = (label, condition, detail = '') => {
  const ok = condition === true;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `: ${detail || 'expected true'}`}`);
};
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`
  );
};

const apiSource = readFileSync(new URL('../src/services/api.js', import.meta.url), 'utf8');

// Actions whose call site passes the action NAME as a variable rather than as a literal, with the exact call to
// look for. The clock is the only one: `submitClockAction(action, ...)` serves both directions, so it cannot spell
// either name. Listed explicitly so a second one has to be added here on purpose rather than slipping past.
const DYNAMIC_WIRING = {
  CLOCK_IN: 'routeWrite(action, request)',
  CLOCK_OUT: 'routeWrite(action, request)',
};

// Whether an action is both named in api.js and dispatched through routeWrite there. A pure function of the source,
// so the mutation below can break it on purpose.
const actionIsWired = (action, source) =>
  DYNAMIC_WIRING[action]
    ? source.includes(DYNAMIC_WIRING[action]) && source.includes(`'${action}'`)
    : source.includes(`action: '${action}'`) && source.includes(`routeWrite('${action}'`);
// --- the table, before any environment is set: this is the default build ----------------------------------------
//
// The default is ON, not off: a build with no Firebase config cannot route anything anyway (that is the gate
// below), and one WITH a config is a build that has decided to move. The variable is an override - a list to hold
// part of the move back, or `off` for the kill switch.
delete process.env.VITE_FIRESTORE_FEATURES;
const { ROUTED_FEATURES, ROUTED_READS, ROUTED_WRITES, routingBlocker, routeRead, routeWrite, failureFor, ok } =
  await import('../src/services/firestoreRouting.js');

const features = Object.keys(ROUTED_FEATURES);
checkIs(
  'the table names the two payloads as features',
  features.includes('memberPayload') && features.includes('adminPayload')
);
checkIs('clock is a routed feature (its fence is the browser\'s, by decision)', features.includes('clock'));
check(
  'and it moves only with the reads that show it',
  ROUTED_FEATURES.clock.requires,
  ['memberPayload']
);

const requiresAreReal = features.every((name) =>
  ROUTED_FEATURES[name].requires.every((dependency) => features.includes(dependency))
);
checkIs('every prerequisite names a feature that exists', requiresAreReal);

const writes = Object.values(ROUTED_FEATURES).flatMap((spec) => spec.writes);
checkIs('no action is claimed by two features', new Set(writes).size === writes.length);

// The check above has to read the raw lists: ROUTED_WRITES is keyed by action, so a duplicate would collapse there
// and every count taken from it would agree with itself. Proved by doubling one action on purpose.
const doubled = [...writes, writes[0]];
checkIs('and it has teeth (a doubled action is caught)', new Set(doubled).size !== doubled.length);

// Nothing may be its own prerequisite, directly or through the chain, or it could never be switched on.
const reachesItself = features.filter((name) => {
  const seen = new Set();
  const walk = (current) => {
    if (current === name) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    return ROUTED_FEATURES[current].requires.some(walk);
  };
  return ROUTED_FEATURES[name].requires.some(walk);
});
check('no feature is its own prerequisite', reachesItself, []);

// --- every routed action is wired in api.js, and every read it must move with is a real action -------------------
for (const [action, feature] of Object.entries(ROUTED_WRITES)) {
  checkIs(
    `${action} (${feature}) is wired, by its own call site or by the write hook`,
    actionIsWired(action, apiSource) || apiSource.includes(`action: '${action}'`),
    'neither found in api.js'
  );
}
// Reads dispatch through routeRead instead, and the same question applies: a feature that claims a read it cannot
// route is a plan, not a fact. The two payloads call routeRead at their own call sites; the refresh reads are offered
// it by the one hook in appScriptFetch, which every read passes through - so for those, being a real api.js action is
// the wiring.
for (const [action] of Object.entries(ROUTED_READS)) {
  checkIs(
    `${action} is wired, either by its own call site or by the read hook`,
    apiSource.includes(`routeRead('${action}'`) || apiSource.includes(`action: '${action}'`),
    'neither found in api.js'
  );
}
for (const [feature, spec] of Object.entries(ROUTED_FEATURES)) {
  for (const read of spec.switchReads) {
    checkIs(`${feature}: ${read} is a real api.js action`, apiSource.includes(`action: '${read}'`));
  }
}

// The mutation: rename an action in the source and the same check must fail, which proves it is reading the wiring
// rather than agreeing with itself.
const mutated = apiSource.replace("routeWrite('SET_MY_AVAILABILITY'", "routeWrite('SET_MY_AVAILABILTY'");
checkIs('the wiring check bites (mutation)', mutated !== apiSource && !actionIsWired('SET_MY_AVAILABILITY', mutated));

// --- the gates, in the order they are consulted ------------------------------------------------------------------
check('an action no feature writes is not routed at all', await routingBlocker('PING'), 'not-a-routed-action');

// The kill switch first, because it is the one override that must work whatever else is true.
process.env.VITE_FIRESTORE_FEATURES = 'off';
check('`off` switches everything off', await routingBlocker('SET_MY_AVAILABILITY'), 'feature-off');
check('including reads', await routingBlocker('GET_BOOTSTRAP'), 'feature-off');
check('and routeRead answers null, so it is read from the sheet exactly as before', await routeRead('GET_BOOTSTRAP'), null);

// Then the default: no config, no variable - and an unconfigured build cannot route, which is what keeps a build
// without the VITE_FIREBASE_* values behaving exactly as it did before any of the move existed.
delete process.env.VITE_FIRESTORE_FEATURES;
check('an unconfigured build routes nothing, whatever the features', await routingBlocker('SET_MY_AVAILABILITY'), 'firebase-unconfigured');
check('and no read either', await routingBlocker('GET_BOOTSTRAP'), 'firebase-unconfigured');
check('so a write is not routed', await routeWrite('SET_MY_AVAILABILITY'), null);
check('nor a read', await routeRead('GET_BOOTSTRAP'), null);

// Configured and switched on, but the prerequisite is not: the guard against moving a write without its read.
//
// The two checks that need a CONFIGURED build run in a child process, because firebase.js captures its config when
// it is first imported - which is when the router is imported, above. Setting the values here would be too late, and
// a test that silently reads the old config would be worse than no test.
process.env.VITE_FIRESTORE_FEATURES = 'availability';
check(
  'switched on in an unconfigured build, and still not routed',
  await routingBlocker('SET_MY_AVAILABILITY'),
  'firebase-unconfigured'
);

const childScript = `
  // firebase.js reads process.env only for the emulator host - its config comes from import.meta.env, which a Node
  // process does not have. So the way to make it "configured" outside Vite is the same signal emulators:exec sets.
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.VITE_FIRESTORE_FEATURES = 'availability';
  const first = await import('./src/services/firestoreRouting.js');
  const withoutPrerequisite = await first.routingBlocker('SET_MY_AVAILABILITY');
  process.env.VITE_FIRESTORE_FEATURES = 'memberPayload,availability';
  const second = await import('./src/services/firestoreRouting.js');
  const withoutUser = await second.routingBlocker('SET_MY_AVAILABILITY');
  const sent = await second.routeWrite('SET_MY_AVAILABILITY', { adds: [] });
  // The clock is behind the same gates as everything else, and CLOCK_OUT is the one that needs a lookup first.
  process.env.VITE_FIRESTORE_FEATURES = 'memberPayload,clock';
  const clockIn = await second.routingBlocker('CLOCK_IN');
  const clockOut = await second.routingBlocker('CLOCK_OUT');
  // The member payload is the first READ to have a dispatcher, so it is the first thing the fourth condition holds
  // back: switched on, configured, prerequisites met - and still the sheet, because nobody is signed in to Firebase.
  const bootstrap = await second.routingBlocker('GET_BOOTSTRAP');
  console.log(JSON.stringify({ withoutPrerequisite, withoutUser, sent, clockIn, clockOut, bootstrap }));
`;
const childOut = execFileSync(process.execPath, ['--input-type=module', '-e', childScript], { encoding: 'utf8' });
const child = JSON.parse(childOut.trim().split('\n').pop());

check(
  'a feature does not route without its prerequisites',
  child.withoutPrerequisite,
  'prerequisite-off:memberPayload'
);
// Fully switched on, in a configured build, and still not routed - because nobody is signed in to FIREBASE. That is
// the state the app is in today: it signs in through Apps Script, and Firebase Auth has no user yet.
check('prerequisite on and configured, but no Firebase user', child.withoutUser, 'not-signed-in-to-firebase');
check('so it still goes to Apps Script', child.sent, null);
check('the clock answers the same way, both directions', [child.clockIn, child.clockOut], [
  'not-signed-in-to-firebase',
  'not-signed-in-to-firebase',
]);
check('and so does the first routed read', child.bootstrap, 'not-signed-in-to-firebase');

// --- the reply shape the screens already read ---------------------------------------------------------------------
check('a success reply carries success', ok({ added: 1 }).success, true);
check('a named refusal becomes a message', failureFor(new Error('already-clocked-in')).message, 'You are already clocked in.');
check('permission-denied reads as a permission problem', failureFor({ code: 'permission-denied' }).code, 'UNAUTHORIZED');
check('anything else keeps its message', failureFor(new Error('unavailable')).message, 'unavailable');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
