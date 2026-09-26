/**
 * Verifies that an identical READ is sent once, not twice, when two parts of the app ask at the same moment.
 *
 * What this exists for: at an administrator's sign-in the app fires its member wave and its admin wave at once,
 * and six reads are in both (schedule, roster, on-duty, training, announcements, events). Each one is a separate
 * Apps Script execution, and the backend runs them one at a time behind a script lock - so the duplicate copy of
 * each call was pure queue: the same data, fetched again, behind the first. With ~1-3s of startup per execution
 * that is what pushed the last calls in the queue past the client's 60-second patience, and a call that gives up is
 * data the screen never gets (no shifts on the calendar, a 12-hour clock for a member who chose 24).
 *
 * The behaviour is asserted by driving the REAL api module against a stubbed fetch and counting the requests, which
 * is the only way to show that two callers really share one. What it deliberately does not do is cache anything:
 * the entry is dropped the moment a request settles, so a read that follows a write still sees the write, and a
 * failure is shared rather than remembered.
 *
 * Run with: npm run verify:read-coalescing
 */
import { readFileSync } from 'node:fs';
import { fetchUserSchedule, fetchRoster, adminSaveUser, fetchInitialData } from '../src/services/api.js';
import { createReadCoalescer, isReadAction, readKey } from '../src/utils/readCoalescing.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`
  );
};
const checkIs = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` -> ${detail}`}`);
};

// The requests the stubbed backend was asked for, in order.
const calls = [];
const resetCalls = () => {
  calls.length = 0;
};

// Answers after a delay, because coalescing is about requests that are IN FLIGHT together: a stub that answered
// instantly would let each call finish before the next began, and the test would pass without the feature.
const stubFetch = (delayMs = 5) => {
  globalThis.fetch = (url, options) => {
    calls.push(JSON.parse(options.body));
    return new Promise((resolve) => {
      const finish = () =>
        resolve({ json: async () => ({ success: true, schedule: [], roster: [], events: [] }) });
      if (delayMs <= 0) finish();
      else setTimeout(finish, delayMs);
    });
  };
};

// Driven from an async main() rather than at the top level: the vite-ssr build this runs through does not accept
// top-level await, and the stubs need real turns of the event loop.
const main = async () => {
  console.log('\n--- two callers, one request ---');
  stubFetch();
  resetCalls();
  // The exact shape the two waves produce: the member wave and the admin wave both ask for the schedule.
  const [first, second] = await Promise.all([fetchUserSchedule('t1'), fetchUserSchedule('t1')]);
  check('both callers were answered', [first?.success, second?.success], [true, true]);
  check('and the backend was asked once', calls.length, 1);
  check('with the action that was requested', calls[0].action, 'GET_SCHEDULE');

  console.log('\n--- but only for a read ---');
  resetCalls();
  // Two saves must never share a request: one caller would be told its write had been applied when only the
  // other's had run.
  await Promise.all([adminSaveUser({ id: 'u1', name: 'A' }, 't1'), adminSaveUser({ id: 'u1', name: 'A' }, 't1')]);
  check('two identical saves are two requests', calls.length, 2);
  checkIs('and they are not reads at all', calls.every((body) => !isReadAction(body.action)));

  console.log('\n--- and only while the first is in flight ---');
  resetCalls();
  await fetchUserSchedule('t1');
  await fetchUserSchedule('t1');
  check('a read after the first settled is sent again', calls.length, 2);

  console.log('\n--- nothing is remembered when a request fails ---');
  // `appScriptFetch` retries a read ONCE on a raw network failure, so this stub fails the first two attempts: the
  // call must fail outright, and the coalescer must not remember that failure for the next caller.
  let failuresLeft = 2;
  globalThis.fetch = (url, options) => {
    calls.push(JSON.parse(options.body));
    if (failuresLeft > 0) {
      failuresLeft -= 1;
      return Promise.reject(new Error('network down'));
    }
    return Promise.resolve({ json: async () => ({ success: true, schedule: [] }) });
  };
  resetCalls();
  const failed = await fetchUserSchedule('t1').catch(() => 'threw');
  check('the call fails when both of its attempts fail', failed, 'threw');
  check('after retrying once on the network error', calls.length, 2);
  const afterFailure = await fetchUserSchedule('t1').catch(() => 'threw');
  check('and the next caller is not served that failure', afterFailure?.success, true);
  check('so it was sent again rather than remembered', calls.length, 3);
  console.log('\n--- different keys are different reads ---');
  stubFetch(20);
  resetCalls();
  await Promise.all([
    fetchUserSchedule('t1'),
    fetchUserSchedule('t2'),
    fetchRoster('t1'),
    // No token: the public payload is its own request, and must never be served a session's answer.
    fetchInitialData(),
    fetchInitialData()
  ]);
  check('a different session, or a different action, is its own request', calls.length, 4);
  check(
    'and the public payload is still shared between its two callers',
    calls.filter((body) => body.action === 'GET_INITIAL_DATA').length,
    1
  );

  console.log('\n--- the rule itself ---');
  checkIs('a read action is recognised', isReadAction('ADMIN_GET_SCHEDULE_TEMPLATES'));
  checkIs('a write action is not', !isReadAction('ADMIN_SAVE_SCHEDULE_TEMPLATE'));
  checkIs('a missing action is not a read', !isReadAction(undefined));
  check(
    'and the key separates sessions',
    readKey({ action: 'GET_ROSTER', token: 'a' }) === readKey({ action: 'GET_ROSTER', token: 'b' }),
    false
  );
  check('a fresh pool holds nothing', createReadCoalescer().size(), 0);

  // The in-flight map has to be empty again once everything has settled, or the app would keep serving yesterday's
  // data out of it. Waited out rather than inspected: the release runs when the request settles.
  await new Promise((resolve) => setTimeout(resolve, 60));
  const apiSource = readFileSync('src/services/api.js', 'utf8');
  checkIs('the api module uses the shared coalescer', /readCoalescing/.test(apiSource));
  checkIs(
    'and holds a read only through it',
    /readsInFlight\.hold\(key, appScriptRequest\(body, options\)\)/.test(apiSource),
    'the wiring in api.js has moved'
  );

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
};

main();
