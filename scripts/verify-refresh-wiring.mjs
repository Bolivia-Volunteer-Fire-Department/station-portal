/**
 * Audits the "did the screen refresh after a save?" wiring, statically.
 *
 * This is a SOURCE-LEVEL audit, not a behavioural test: it cannot prove a refresh actually
 * ran. What it does prove are the two invariants whose violation caused a real bug - an
 * assignment saved to the sheet but the table kept showing the old value:
 *
 *   1. `refreshAdminData` must reload every cache an admin screen reads. It used to branch
 *      on whether it was handed a token and reload only one half of the data, so a tab
 *      calling it token-less refreshed roles/ranks/settings and left users, templates and
 *      assignments stale (and vice versa).
 *   2. Every admin tab that WRITES must ask for a refresh. The write functions are derived
 *      from the API module, so a new tab that saves without refreshing fails this audit.
 *
 *   npm run verify:refresh-wiring
 */
import fs from 'node:fs';
import path from 'node:path';
import { runRefreshWave, REFRESH_OK, REFRESH_FAILED, REFRESH_EXPIRED } from '../src/utils/refreshWave.js';
import { createReadCoalescer, isReadAction, readKey } from '../src/utils/readCoalescing.js';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.resolve(root, rel), 'utf8');

let failures = 0;
const check = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` -> ${detail}`}`);
};

const extractFunction = (source, marker) => {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.includes(marker));
  if (start === -1) throw new Error(`Could not find "${marker}"`);
  const indent = lines[start].match(/^\s*/)[0];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === `${indent}};`) return lines.slice(start, i + 1).join('\n');
  }
  throw new Error(`Could not find the end of "${marker}"`);
};

// ---------------------------------------------------------------------------
// 1. One admin refresh that reloads everything
// ---------------------------------------------------------------------------
console.log('--- the admin refresh reloads every cache a screen reads ---');
const appSource = read('src/App.jsx');

// The refresh wave's own body, sliced once because more than one section asserts on it. Declared here for the
// same reason the source reads above are: an insert that pushed this below its first use reads as
// `undefined` rather than failing to compile, and makes a correct assertion report a false failure.
const waveBlock = appSource.slice(appSource.indexOf('const refreshAdminData = async'));
const waveBody = waveBlock.slice(0, waveBlock.indexOf('\n  };'));
const refreshBody = extractFunction(appSource, 'const refreshAdminData = async');

// Each cache a screen renders from, and the applier that fills it.
//
// The save wave is ONE request now (ADMIN_GET_BOOTSTRAP), so the audit follows the guarantee to where it still
// lives: the applier that turns the payload into state, and - below - the backend, where each field must be read by
// the same helper the individual action uses. That second half is the stronger claim, because it is the point at
// which the batch and the granular actions could drift apart.
const adminApplier = extractFunction(appSource, 'const applyAdminBootstrap =');
const memberApplier = extractFunction(appSource, 'const applyBootstrap =');
const appliers = `${memberApplier}\n${adminApplier}`;

const CACHES = [
  ['roles / ranks / shifts / settings', /setUserSettings\([\s\S]*setRoles\([\s\S]*setRanks\([\s\S]*setShifts\([\s\S]*setSystemSettings\(/],
  ['users', /setUsers\(/],
  ['schedule templates and assignments', /setScheduleTemplates\([\s\S]*setAssignments\(/],
  ['the offers table', /setAdminOffers\(/],
  ['the schedule rows', /setSchedule\(/],
  ['the member roster', /setRoster\(/],
  ['who is on duty', /setOnDutyUsers\(/],
  ['training and its signatures', /setTrainings\([\s\S]*setTrainingSignatures\(/],
  ['announcements', /setAnnouncements\(/],
  ['the login-screen announcements', /setLoginAnnouncements\(/],
  ['events', /setEvents\(/],
];
for (const [cache, pattern] of CACHES) {
  check(`a save reloads ${cache}`, pattern.test(appliers), `${cache} is no longer applied anywhere`);
}

check(
  'and the save goes through the batched action',
  /adminFetchBootstrap\(token\)/.test(refreshBody),
  'refreshAdminData no longer asks for the sign-in payload'
);
check(
  'applying what it returned',
  /applyAdminBootstrap\(data\)/.test(refreshBody),
  'the payload is fetched but never applied'
);

// The two halves of the branch, and what may appear in each: the public payload carries no session data, and the
// authenticated one carries the admin-scoped batch. This replaces the old "does not branch on !token" check - the
// branch exists because the PRE-LOGIN load has no token, and that is the only thing the tokenless half may fetch.
const preLoginBody = refreshBody.slice(refreshBody.indexOf('!data.success) return REFRESH_FAILED'));
check(
  'the tokenless half loads only the public payload',
  refreshBody.includes('fetchInitialData()') && !/adminFetchBootstrap/.test(preLoginBody.split('\n').slice(0, 3).join('\n')),
  'the pre-login branch is asking for authenticated data'
);
check(
  'with the token defaulting to the session token',
  refreshBody.includes('token = authToken'),
  'a caller that forgets the token would skip the admin-scoped half'
);
check(
  'and one failing request cannot sink the rest',
  refreshBody.includes('settle('),
  'a rejected request would abandon the whole refresh'
);

// The backend half: every field the batch returns must be built by the same helper as the action it replaces,
// or a save could refresh a screen from a different definition of the data than the tab that wrote it.
console.log('\n--- and the batch reads each field the same way its own action does ---');
const bootstrapGs = read('src/services/Code.gs');
// A `case "ACTION": {...}` block, from its case to the next case at the same indentation.
const caseBodyFor = (source, action) => {
  const start = source.indexOf(`case "${action}":`);
  if (start === -1) return '';
  const rest = source.slice(start + 1);
  const next = rest.search(/\n      case "/);
  return next === -1 ? rest : rest.slice(0, next);
};
const bootstrapSource = `${extractFunction(bootstrapGs, 'function memberBootstrapPayload(')}\n${extractFunction(
  bootstrapGs,
  'function adminBootstrapPayload('
)}`;

const SHARED_READS = [
  ['the schedule rows', 'GET_SCHEDULE', 'getSheetData(ss, "schedule")'],
  ['the member assignment projection', 'GET_SCHEDULE', 'memberAssignmentRows('],
  ['the member template projection', 'GET_SCHEDULE', 'memberScheduleTemplateRows('],
  ['availability', 'GET_AVAILABILITY', 'getSheetData(ss, "availability")'],
  ['the member roster', 'GET_ROSTER', 'rosterRowsFor('],
  ['who is on duty', 'GET_ON_DUTY', 'onDutyRowsFor('],
  ['the member\u2019s own offers', 'GET_SHIFT_OFFERS', 'offersForUser('],
  ['clock history', 'GET_TIMECLOCK_LOGS', 'getSheetData(ss, "timeclock")'],
  ['the training list', 'GET_TRAINING', 'trainingRowsForApp('],
  ['the member\u2019s signatures', 'GET_TRAINING', 'trainingSignaturesForUser('],
  ['the announcements', 'MY_ANNOUNCEMENTS', 'announcementRowsFor('],
  ['events', 'GET_EVENTS', 'eventsForViewer('],
  ['the user directory', 'ADMIN_GET_USERS', 'getSheetData(ss, "users")'],
  ['the schedule templates', 'ADMIN_GET_SCHEDULE_TEMPLATES', 'getSheetData(ss, "schedule_templates")'],
  ['the assignments', 'ADMIN_GET_SCHEDULE_TEMPLATES', 'getSheetData(ss, "assignments")'],
  ['the offers table', 'ADMIN_GET_SCHEDULE_OFFERS', 'normalizeOffer'],
];
for (const [cache, action, callee] of SHARED_READS) {
  check(
    `${cache}: the batch and ${action} use the same reader`,
    bootstrapSource.includes(callee) && caseBodyFor(bootstrapGs, action).includes(callee),
    `"${callee}" is in one place but not the other`
  );
}

// ---------------------------------------------------------------------------
// 2. Every writing tab asks for a refresh
// ---------------------------------------------------------------------------
console.log('\n--- every admin tab that saves asks the app to refresh ---');
const apiSource = read('src/services/api.js');
const writeFns = [...apiSource.matchAll(/export const (admin[A-Za-z]+)\s*=/g)]
  .map((match) => match[1])
  .filter((name) => /^admin(Save|Delete|Set|Send|Resolve|Bulk)/.test(name));
check('the API declares write functions to look for', writeFns.length >= 8, `${writeFns.length} found`);

const REFRESH_PROPS = [
  'onDataChanged',
  'onAdminDataChanged',
  'onOffersChanged',
  'onLogsChanged',
  'onAvailabilityChanged',
];

const adminDir = path.resolve(root, 'src/components/admin');
const tabs = fs
  .readdirSync(adminDir)
  .filter((file) => file.startsWith('Admin') && file.endsWith('.jsx'))
  .sort();

let writingTabs = 0;
for (const file of tabs) {
  const source = read(`src/components/admin/${file}`);
  const writes = writeFns.filter((fn) => source.includes(`${fn}(`));
  if (!writes.length) continue;

  writingTabs++;
  const refreshers = REFRESH_PROPS.filter((prop) => source.includes(prop));
  check(
    `${file} refreshes after saving`,
    refreshers.length > 0,
    `it calls ${writes.join(', ')} but no refresh callback`
  );
  console.log(`     ${file} -> ${refreshers.join(', ') || '(none)'}`);
}
check('the audit found the tabs that write', writingTabs >= 10, `${writingTabs} found`);

// ---------------------------------------------------------------------------
// 3. App actually supplies those callbacks
// ---------------------------------------------------------------------------
console.log('\n--- App wires the callbacks the tabs call ---');
const panelBlock = appSource.slice(appSource.indexOf('<AdminPanel'));
const panelProps = panelBlock.slice(0, panelBlock.indexOf('/>'));
for (const [prop, fn] of [
  ['onDataChanged', 'refreshAdminData'],
  ['onAdminDataChanged', 'refreshAdminData'],
  // The offers table travels in the sign-in payload, so a change to it reloads the same batch every other admin
  // save does - there is no second fetcher for it to drift from.
  ['onOffersChanged', 'refreshAdminData'],
  ['onLogsChanged', 'refreshLogs'],
  ['onAvailabilityChanged', 'refreshAvailability'],
]) {
  check(
    `${prop} is wired to ${fn}`,
    panelProps.includes(`${prop}={${fn}}`),
    'missing or pointing elsewhere'
  );
}
// A callback passed but not declared by AdminPanel would be silently dropped.
check(
  'AdminPanel forwards every refresh callback it is given',
  REFRESH_PROPS.filter((prop) => prop !== 'onOffersChanged').every((prop) =>
    read('src/components/admin/AdminPanel.jsx').includes(prop)
  ),
  'AdminPanel does not declare one of them'
);

// ---------------------------------------------------------------------------
// 4. No save WAITS on the fan-out.
//
// The same wave is why a save "takes a long time from the front end but lands on the sheet almost
// immediately": the write is one request, the wave behind it is nine, and doPost serialises them behind a
// script lock. Awaited, that held the Save button spinning over a sheet that was already written. So no tab
// may await the fan-out - while every tab must still START it.
console.log('\n--- no save waits on the nine-request refresh wave ---');
const tabFiles = fs.readdirSync(adminDir).filter((name) => name.endsWith('.jsx'));
const WAVE_PROPS = ['onDataChanged', 'onAdminDataChanged'];

// Which tabs receive a SINGLE-request callback as their onDataChanged. DERIVED from AdminPanel rather than
// listed here, so rewiring a tab to the fan-out automatically puts it back under the rule.
const panelSourceForRules = read('src/components/admin/AdminPanel.jsx');
const singleRequestTabs = [];
for (const match of panelSourceForRules.matchAll(/<Admin(\w+)Tab\b[\s\S]{0,1200}?\/>/g)) {
  const wiring = /onDataChanged=\{on(\w+)\}/.exec(match[0]);
  // The capture drops the `on` prefix, so it is added back before comparing against the fan-out names.
  if (wiring && !WAVE_PROPS.includes(`on${wiring[1]}`)) singleRequestTabs.push(`Admin${match[1]}Tab.jsx`);
}
check(
  'the single-request screens are identified',
  singleRequestTabs.length === 2,
  `found ${singleRequestTabs.length}: ${singleRequestTabs.join(', ')}`
);

const awaitedWave = [];
// `(?:\?\.)?` is the optional `?.` - written as a non-capturing group rather than `\?\.?`, which requires a
// LITERAL `?` and so silently matched only the `onDataChanged?.(...)` form. That is how a regression in the
// plain `onDataChanged()` form slipped past this very check when it was bite-tested.
const awaitPattern = /await\s+([A-Za-z_$][\w$]*)\s*(?:\?\.)?\(/g;
for (const name of tabFiles) {
  // A single-request screen may await its own refresh: one round trip, and it is what removes the row the
  // administrator just acted on. That is the distinction, not an exception to the rule.
  if (singleRequestTabs.includes(name)) continue;
  const source = read('src/components/admin/' + name);
  let match;
  while ((match = awaitPattern.exec(source)) !== null) {
    if (WAVE_PROPS.includes(match[1])) awaitedWave.push(`${name}: ${match[0]}`);
  }
}
check('no tab awaits the fan-out refresh', awaitedWave.length === 0, awaitedWave.join(', '));

// The screens whose callback is a SINGLE request may still await it: one round trip, and it is what removes
// the row the administrator just acted on. This is the distinction, not an exception to the rule.
check(
  'a single-request refresh may still be awaited',
  tabFiles.some((name) => /if \(result\?\.success\) await onDataChanged/.test(read('src/components/admin/' + name))) &&
    tabFiles.some((name) => /await onOffersChanged/.test(read('src/components/admin/' + name))),
  'neither of the single-request screens awaits its own refresh'
);

// "Do not wait" is not "do not refresh": every saving tab must still ask.
const tabsStartingRefresh = tabFiles.filter((name) =>
  /void on(DataChanged|AdminDataChanged)/.test(read('src/components/admin/' + name))
);
check('and the refresh is still started after saving', tabsStartingRefresh.length >= 8, `${tabsStartingRefresh.length} tabs`);

// ---------------------------------------------------------------------------
// 6. The script lock is taken for WRITES only.
//
// Apps Script runs executions concurrently, but doPost used to take a script lock before it even knew which
// action was asked for, so every request queued behind every other. With a ten-request refresh wave behind
// each save, that was the difference between a save settling in ~2s and in ~30s.
//
// Skipping the lock is only safe if the actions that skip it genuinely do not write, which is what this
// section checks: it reads each action's own body out of Code.gs and fails if a write call appears in one.
console.log('\n--- the script lock is taken for writes only ---');
const gsSource = read('src/services/Code.gs');

const listMatch = /var READ_ONLY_ACTIONS = \{([\s\S]*?)\n\};/.exec(gsSource);
check('the read-only action list exists', !!listMatch, 'READ_ONLY_ACTIONS is missing from Code.gs');
const readOnlyActions = [...(listMatch ? listMatch[1] : '').matchAll(/^\s{2}([A-Z_]+): true/gm)].map((m) => m[1]);
check('and covers the refresh wave', readOnlyActions.length >= 10, `${readOnlyActions.length} actions listed`);

check(
  'doPost gates the lock on the action',
  /const gate = acquireWriteLock\(lock, action\)/.test(gsSource),
  'the lock decision no longer goes through acquireWriteLock'
);
// A gate whose answer is ignored is not a gate. This is the rule that was broken before: a timed-out tryLock
// used to be discarded, so the write ran UNLOCKED and two of them could allocate the same id.
check(
  'and refuses a write it cannot serialise rather than running it unlocked',
  /if \(!gate\.ok\)[\s\S]{0,300}busyResponseData/.test(gsSource),
  'a failed lock acquisition is ignored again, so a write can run without the lock'
);
check(
  'and releases only what it took',
  /if \(locked\) lock\.releaseLock\(\)/.test(gsSource),
  'the release is unconditional, so a read-only request would release a lock it never held'
);

// The action's own block: from its `case` to the next case or default at the same indentation.
const actionBlock = (name) => {
  const start = gsSource.indexOf(`case "${name}":`);
  if (start === -1) return '';
  const rest = gsSource.slice(start + name.length + 8);
  const end = rest.search(/\n {6}(case "|default:)/);
  return end === -1 ? rest : rest.slice(0, end);
};

const WRITE_CALLS =
  /upsertSheetRowById|upsertUserSettingsColumns|bulkUpsertSheetRowsById|bulkDeleteSheetRowsById|setSystemSettingsBatch|ensureRowVersionColumn|appendRowByHeader|appendRow\(|deleteRow\(|deleteRows\(|insertSheet\(|setValue\(|setValues\(|logSystemEvent|createSession|bumpSessionEpoch|revokeSessionsForUser|clearStaleFcmTokens|retuneSessions|saveRunnerScore/;

const readOnlyOffenders = [];
readOnlyActions.forEach((name) => {
  const block = actionBlock(name);
  if (!block) {
    readOnlyOffenders.push(`${name}: no such case`);
    return;
  }
  const hit = WRITE_CALLS.exec(block);
  if (hit) readOnlyOffenders.push(`${name}: calls ${hit[0]}`);
});
// A NOTE on what this can and cannot see: it reads the DIRECT calls in the action's handler. A read-only
// action that reached a writing helper indirectly would pass, so each name in the list was also read by hand
// before it was added. What this check does is stop one being added carelessly.
// The condition is `length === 0`, NOT the array: `check` here takes a boolean, so passing the array would
// pass for any array at all - including one full of offenders. That mistake made this check vacuous until a
// bite test put a known writer (LOGIN) into the list and nothing failed.
check('every read-only action only reads', readOnlyOffenders.length === 0, readOnlyOffenders.join(', '));

// NEGATIVE CONTROL: the detector must find writes in an action that is KNOWN to write. Without this, the
// check above could pass by detecting nothing at all - an empty block, or a regex that no longer matches.
// LOGIN mints a session and logs an event, so it is a reliable writer to test against.
const controlHit = WRITE_CALLS.exec(actionBlock('LOGIN'));
check('and the write detector works on a known writer', !!controlHit, 'LOGIN was not detected as writing');
check('and that writer is not in the read-only list', !readOnlyActions.includes('LOGIN'));

// A read-only action that is not handled at all would silently skip the lock AND fail at the switch.
const unhandled = readOnlyActions.filter((name) => actionBlock(name).length < 20);
check('and every one is a real action', unhandled.length === 0, unhandled.join(', '));

// ---------------------------------------------------------------------------
// 7. A background wave reports itself, without getting in the way.
console.log('\n--- background waves report themselves ---');
const { createWaveReporter, nextWaveId, waveMessage, waveDoneMessage } = await import('../src/utils/activity.js');

check('a fresh wave invites nothing yet', waveMessage('Refreshing views', 0, 10), 'Refreshing views…');
check('and counts up as requests land', waveMessage('Refreshing views', 3, 10), 'Refreshing views — 3 of 10 done…');
check('finishing reads as up to date', waveDoneMessage('Refreshing views'), 'Refreshing views — up to date');

const progress = [];
const completions = [];
const reporter = createWaveReporter({
  label: 'Refreshing views',
  total: 3,
  onProgress: (message) => progress.push(message),
  onDone: (message, count, failed) => completions.push({ message, count, failed }),
});
reporter.settle();
reporter.settle();
// `check` here takes a CONDITION, so every comparison is explicit: passing a count as the second argument
// would pass for any non-zero number and fail for zero, which is how "does not announce completion early"
// reported a false failure the first time this was run.
check('it reports each request as it settles', progress.length === 2, `got ${progress.length}`);
check('and does not announce completion early', completions.length === 0, `got ${completions.length}`);
reporter.settle();
check('then announces completion once', completions.length === 1, `got ${completions.length}`);
// A promise that resolves twice (or a settle called by mistake) must not re-announce.
reporter.settle();
check('and stays quiet afterwards', completions.length === 1, `got ${completions.length}`);

// A FAILED request still has to count, or the wave never reaches its total.
//
// This is the bug that left a toast reading "9 of 10 done…" forever: the aborted request never called
// settle, so the wave could not finish and the failure was never mentioned. Two of these three fail.
const mixedProgress = [];
const mixedDone = [];
const mixed = createWaveReporter({
  label: 'Refreshing views',
  total: 3,
  onProgress: (message) => mixedProgress.push(message),
  onDone: (message, count, failed) => mixedDone.push({ message, count, failed }),
});
mixed.settle(true);
mixed.settle(false); // the aborted one
mixed.settle(true);
check('a failed request still counts towards the total', mixed.settled === 3, `settled ${mixed.settled}`);
check('and the wave finishes', mixedDone.length === 1, `got ${mixedDone.length}`);
check('reporting the failure rather than claiming to be current', mixedDone[0].failed === 1, JSON.stringify(mixedDone[0]));
check('and naming it', /1 could not be refreshed/.test(mixedDone[0].message), mixedDone[0].message);
check('with the failure counted, not hidden', waveDoneMessage('Refreshing views', 2), 'Refreshing views — 2 could not be refreshed');

// The wave's total is DERIVED from its request list.
//
// The first version hard-coded it (`token ? 10 : 1`) while the list held nine, so the toast stalled at
// "9 of 10 done…". A number that has to be kept in step with a list by hand is the defect; assert there is
// no number.
check('the wave derives its total from the task list', /total: tasks\.length/.test(waveBody), 'the total is not derived');
check('and holds no hand-kept count', /requestCount|total: \d/.test(waveBody) === false, 'a hard-coded count is back');
check('every task settles through the reporter', /onSettle: \(\{ status, pass \}\)/.test(waveBody), 'tasks are not reported');
// The defect this replaced: every refresher caught its own error and resolved, so the reporter's failure path was
// unreachable and a wave that had lost the schedule still toasted a success. The reporter is now handed the
// status the refresher reported, which is the only way it can tell the difference.
check(
  'counting a failure as well as a success',
  /report\.settle\(status === REFRESH_OK \|\| status === REFRESH_EXPIRED\)/.test(waveBody),
  'the reporter is not told the status'
);
check('and a retry is not counted as a second task', /if \(pass === 1\)/.test(waveBody), 'a retry would double-count');

// Stackable: two waves running at once must not share an id, or the second would replace the first.
const firstId = nextWaveId();
const secondId = nextWaveId();
check('concurrent waves get distinct ids', firstId !== secondId);
check('and the ids are namespaced', /^refresh-wave-\d+$/.test(firstId));
check('the reporter tolerates a nonsense total', createWaveReporter({ label: 'x', total: 0 }).settle() === undefined);

// The wave in App is wired to the reporter and to sonner.
check('App builds a reporter for the wave', /createWaveReporter\(\{/.test(waveBody), true);
check('with a unique toast id', /const waveId = nextWaveId\(\)/.test(waveBody), true);
check('reporting progress through a toast', /toast\.loading\(message, \{ id: waveId \}\)/.test(waveBody), true);
check('and completion through the same toast', /toast\.success\(message, \{ id: waveId, duration: \d+ \}\)/.test(waveBody), true);


//
// --- the retry wave itself -------------------------------------------------------------------
//
// Exercised rather than read, because the whole point of it is behaviour under failure: a retry that runs in
// parallel with its siblings rebuilds the queue that caused the failure, and a task retried twice is an app that
// hammers a backend already unwell.
console.log('\n--- a failed refresh gets one more chance ---');

const fakeSleep = async () => {};

const waveTask = (name, results) => {
  const state = { runs: 0 };
  return {
    state,
    task: {
      name,
      run: async () => {
        state.runs += 1;
        const outcome = results[Math.min(state.runs - 1, results.length - 1)];
        if (outcome instanceof Error) throw outcome;
        return outcome;
      },
    },
  };
};
const runsOf = (pair) => pair.state.runs;

const allOk = [waveTask('schedule', [REFRESH_OK]), waveTask('training', [REFRESH_OK])];
const healthy = await runRefreshWave(allOk.map((t) => t.task), { retryDelayMs: 0 });
check('nothing is retried when the wave is healthy', allOk.every((t) => runsOf(t) === 1), allOk.map(runsOf).join(','));
check('and nothing is reported missing', healthy.missing.length === 0, healthy.missing.join(','));
check('and nothing is reported recovered', healthy.recovered.length === 0, healthy.recovered.join(','));

const flaky = [waveTask('schedule', [REFRESH_FAILED, REFRESH_OK]), waveTask('training', [REFRESH_OK])];
const second = await runRefreshWave(flaky.map((t) => t.task), { retryDelayMs: 0 });
check('a failed task is tried again', flaky.map(runsOf).join(',') === '2,1', flaky.map(runsOf).join(','));
check('and reported as recovered', second.recovered.join(',') === 'schedule', second.recovered.join(','));
check('with nothing left missing', second.missing.length === 0, second.missing.join(','));

const hopeless = [waveTask('training', [REFRESH_FAILED, REFRESH_FAILED])];
const third = await runRefreshWave(hopeless.map((t) => t.task), { retryDelayMs: 0 });
check('a task that fails twice is retried exactly once', runsOf(hopeless[0]) === 2, String(runsOf(hopeless[0])));
check('and is reported missing by name', third.missing.join(',') === 'training', third.missing.join(','));

// A refused session is not a slow backend: retrying it is pointless, and the reauth prompt already handles it.
const refused = [waveTask('schedule', [REFRESH_EXPIRED])];
const fourth = await runRefreshWave(refused.map((t) => t.task), { retryDelayMs: 0 });
check('a refused session is not retried', runsOf(refused[0]) === 1, String(runsOf(refused[0])));
check('and is not reported as missing data', fourth.missing.length === 0, fourth.missing.join(','));
check('but is named as expired', fourth.expired.join(',') === 'schedule', fourth.expired.join(','));

// A refresher that throws is a failure with the same remedy as one that timed out.
const thrown = [waveTask('events', [new Error('boom'), REFRESH_OK])];
const fifth = await runRefreshWave(thrown.map((t) => t.task), { retryDelayMs: 0 });
check('a task that throws is retried', runsOf(thrown[0]) === 2, String(runsOf(thrown[0])));
check('and counted as recovered', fifth.recovered.join(',') === 'events', fifth.recovered.join(','));

// A refresher that forgets to report a status has not succeeded. Reading `undefined` as success is exactly how a
// lost fetch became a green toast, so the wave refuses to.
const unreported = [waveTask('announcements', [undefined, undefined])];
const sixth = await runRefreshWave(unreported.map((t) => t.task), { retryDelayMs: 0 });
check('a task that reports no status counts as failed', runsOf(unreported[0]) === 2, String(runsOf(unreported[0])));
check('and is reported missing', sixth.missing.join(',') === 'announcements', sixth.missing.join(','));

// Sequentially, after a pause: in parallel the retries would re-form the queue that caused the failure. Only the
// retry pass is measured - the first pass is meant to be concurrent.
let onRetry = 0;
let maxOnRetry = 0;
const overlapping = ['a', 'b', 'c'].map((name) => {
  let runs = 0;
  return {
    name,
    run: async () => {
      runs += 1;
      const isRetry = runs > 1;
      if (isRetry) {
        onRetry += 1;
        maxOnRetry = Math.max(maxOnRetry, onRetry);
      }
      await fakeSleep();
      if (isRetry) onRetry -= 1;
      return REFRESH_FAILED;
    },
  };
});
const sleeps = [];
await runRefreshWave(overlapping, {
  retryDelayMs: 25,
  sleep: async (ms) => {
    sleeps.push(ms);
  },
});
check('the retries never overlap each other', maxOnRetry === 1, String(maxOnRetry));
check('and each waits its turn', sleeps.length === 3 && sleeps.every((ms) => ms === 25), sleeps.join(','));

check('an empty wave is safe', (await runRefreshWave([])).missing.length === 0);
check('and so is a missing list', (await runRefreshWave(null)).missing.length === 0);

// --- one read, one execution ------------------------------------------------------------------
//
// The two waves overlap at an admin sign-in and six reads are fetched by both. Against a backend that runs one
// execution at a time that is pure queue - the duplicate of each call sat behind the original for no new data, and
// the last calls in the queue were the ones that ran out of the client's patience.
console.log('\n--- the same read is not sent twice at once ---');

check('GET_ actions are reads', isReadAction('GET_SCHEDULE'));
check('and so are the admin ones', isReadAction('ADMIN_GET_USERS'));
check('and the ping', isReadAction('PING'));
// Writes must never join anything: sharing a promise between two saves would make one of them look applied.
check('a save is not a read', !isReadAction('ADMIN_SAVE_USER'));
check('nor is a delete', !isReadAction('ADMIN_DELETE_USER'));
check('nor a settings update', !isReadAction('UPDATE_USER_SETTINGS'));
check('nor a clock action', !isReadAction('CLOCK_IN'));
check('nor a sign-in', !isReadAction('LOGIN'));
check('nor an empty action', !isReadAction(undefined));

const sameRead = readKey({ action: 'GET_SCHEDULE', token: 't1' });
check('an identical request has one key', sameRead === readKey({ action: 'GET_SCHEDULE', token: 't1' }));
check('another session is another read', sameRead !== readKey({ action: 'GET_SCHEDULE', token: 't2' }));
check('another action is another read', sameRead !== readKey({ action: 'GET_ROSTER', token: 't1' }));
check(
  'and a different payload is another read',
  sameRead !== readKey({ action: 'GET_SCHEDULE', token: 't1', payload: { month: 3 } })
);

const coalescer = createReadCoalescer();
const shared = coalescer.hold('k', new Promise(() => {}));
check('a read in flight can be joined', coalescer.join('k') === shared);
check('an unknown key cannot', coalescer.join('other') === null);
check('and it is held only while it is in flight', coalescer.size() === 1, String(coalescer.size()));

const settledRead = createReadCoalescer();
let resolveIt;
const pendingRead = new Promise((resolve) => {
  resolveIt = resolve;
});
settledRead.hold('k', pendingRead);
check('the entry exists while the request runs', settledRead.size() === 1, String(settledRead.size()));
resolveIt('data');
await pendingRead;
// One more turn, so the release handler attached with .then has run.
await Promise.resolve();
check('and is dropped the moment it settles', settledRead.size() === 0, String(settledRead.size()));
check('so a later read is never served a stale answer', settledRead.join('k') === null);

const failedRead = createReadCoalescer();
const boom = Promise.reject(new Error('nope'));
boom.catch(() => {});
failedRead.hold('k', boom);
await boom.catch(() => {});
await Promise.resolve();
check('a failed read is not left holding the key', failedRead.size() === 0, String(failedRead.size()));

// And the fetch layer is wired to it - with writes kept out, which is the part that must never drift.
const fetchLayerSource = read('src/services/api.js');
check('the fetch layer owns a coalescer', /createReadCoalescer\(\)/.test(fetchLayerSource), 'no coalescer in api.js');
check(
  'writes bypass it',
  /if \(!isReadAction\(body\?\.action\)\) return appScriptRequest\(body, options\);/.test(fetchLayerSource),
  'reads and writes are not separated'
);
check('an identical read in flight is joined', /readsInFlight\.join\(key\)/.test(fetchLayerSource), 'never joins');
check(
  'and held for the next caller',
  /readsInFlight\.hold\(key, appScriptRequest\(body, options\)\)/.test(fetchLayerSource),
  'never holds'
);
// Teeth: remove the read/write split and the check above must fail - a coalescer that takes writes would let two
// saves share one request, which is exactly the class of bug this guard exists for.
const unsplit = fetchLayerSource.replace(
  'if (!isReadAction(body?.action)) return appScriptRequest(body, options);',
  'if (!body?.action) return appScriptRequest(body, options);'
);
check('the mutation applied', unsplit !== fetchLayerSource);
check(
  'and the wiring check catches a coalescer that takes writes too',
  !/if \(!isReadAction\(body\?\.action\)\) return appScriptRequest\(body, options\);/.test(unsplit)
);

// Not waiting on the wave left the table holding pre-save values, so re-opening a form showed the old ones
// (the Users bug). The saved row is merged into app state instead - one applier, every collection.
console.log('\n--- a save applies its own row ---');
const savedRowSource = read('src/utils/savedRow.js');
check('the merge is shared, not per tab', savedRowSource.includes('export const mergeSavedRow'), 'utils/savedRow.js is missing');
check('and App registers a collection for it', (appSource.match(/merge: mergeSavedRow/g) || []).length >= 4, 'App registers too few collections');
check('App passes the applier to the panel', panelProps.includes('onRowSaved={applySavedRow}'), 'missing from the panel props');
check('the panel forwards it', read('src/components/admin/AdminPanel.jsx').includes('onRowSaved={onRowSaved}'), 'AdminPanel drops it');

for (const name of ['AdminRolesTab', 'AdminRanksTab', 'AdminAssignmentsTab', 'AdminScheduleTemplatesTab', 'AdminUsersTab']) {
  check(
    `${name} applies its saved row`,
    /onRowSaved\?\.\(/.test(read('src/components/admin/' + name + '.jsx')),
    'saves without applying the row locally'
  );
}

// The rule that matters for members: a save must never put a password into a list that holds none.
const userRowSource = read('src/utils/userRow.js');
check('a saved user can never carry a password', userRowSource.includes("omit: ['password']"), 'the omit list is gone');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
