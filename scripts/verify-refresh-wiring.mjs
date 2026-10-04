/**
 * Audits the "did the screen refresh after a save?" wiring, statically.
 *
 * This is a SOURCE-LEVEL audit, not a behavioral test: it cannot prove a refresh actually
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
import { replaceRowsInRange, mergeSavedRow } from '../src/utils/savedRow.js';
import { runRefreshWave, REFRESH_OK, REFRESH_FAILED, REFRESH_EXPIRED } from '../src/utils/refreshWave.js';
import { isReadAction } from '../src/utils/readCoalescing.js';

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
  // The refresh after a save is SCOPED: the tab names the collection it changed, and App re-reads that one collection
  // rather than the whole payload. See refreshAdminCollections in App.jsx and verify-read-budget.
  ['onDataChanged', 'refreshAdminCollections'],
  ['onAdminDataChanged', 'refreshAdminCollections'],
  ['onLogsChanged', 'refreshLogs'],
  ['onAvailabilityChanged', 'refreshAvailability'],
]) {
  check(
    `${prop} is wired to ${fn}`,
    panelProps.includes(`${prop}={${fn}}`),
    'missing or pointing elsewhere'
  );
}
// Resolving an offer fills the shift, so this one save re-reads TWO collections - the offers table and the schedule row
// it just filled - and it is written as an arrow because of it.
check(
  'onOffersChanged is wired to the scoped refresh, naming both collections',
  /onOffersChanged=\{\(\) => refreshAdminCollections\(\['scheduleOffers', 'schedule'\]\)\}/.test(panelProps),
  'missing or pointing elsewhere'
);
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
// immediately": the write is one request, the wave behind it is nine, and doPost serializes them behind a
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
check('a failed request still counts toward the total', mixed.settled === 3, `settled ${mixed.settled}`);
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
// A wave of ONE - which is what every save now triggers, since the bootstrap answers the whole refresh in a
// single request - used to announce nothing at all until it was over: the button released, nothing happened for
// a second or three, and the screen updated itself. start() is the call that was missing, and these are the
// cases that make it safe to call.
const oneProgress = [];
const oneDone = [];
const oneTask = createWaveReporter({
  label: 'Refreshing views',
  total: 1,
  onProgress: (message) => oneProgress.push(message),
  onDone: (message) => oneDone.push(message),
});
oneTask.start();
check('a one-task wave says it has started', oneProgress, ['Refreshing views…']);
oneTask.settle();
check('and then reports that it is done', oneDone, ['Refreshing views — up to date']);

// Starting twice must not rewind a count the reader is watching, and a start after the first settle is a wave
// that has already begun.
const twiceProgress = [];
const startedTwice = createWaveReporter({
  label: 'Refreshing views',
  total: 2,
  onProgress: (message) => twiceProgress.push(message),
});
startedTwice.start();
startedTwice.start();
check('starting twice announces once', twiceProgress.length, 1);
startedTwice.settle();
check('and a start after the first settle is ignored', twiceProgress, [
  'Refreshing views…',
  'Refreshing views — 1 of 2 done…',
]);

// The call has to be made, or the reporter above is a capability nobody uses.
check('App starts the wave before the request goes out', /report\.start\(\)/.test(waveBody), true);

// The two certification tabs, named. Their calls used to read `onDataChanged?.()` - not the `void` form the rest
// of the panel uses - and so were invisible to the check above. That is how a screen quietly stops asking for a
// refresh without failing anything, which is the failure this whole file exists to catch. They now name their section
// too, which verify-read-budget checks against the sections that actually exist.
for (const [name, section] of [
  ['AdminCertificationsTab.jsx', 'certificationRecords'],
  ['AdminCertificationSetupTab.jsx', 'certificationSetup'],
]) {
  check(
    `${name} asks for its own section after saving`,
    new RegExp(`void onDataChanged\\?\\.\\('${section}'\\)`).test(read('src/components/admin/' + name)),
    true
  );
}

// EVERY OTHER TAB WHOSE WRITE LANDS IN A COLLECTION THE PAYLOAD DOES NOT CARRY, NAMED - the same story as the two
// above, generalised after the third time it bit.
//
// `schedule`, `users`, `assignments` and `schedule_templates` LEFT THE PAYLOAD when the app began loading lazily (they
// are the collections that grow with the station, or without limit - see firestorePayload). An unnamed refresh does not
// fail: it falls back to the whole payload, refreshes everything EXCEPT the collection that changed, and returns
// success. So the board showed the shift it had just saved, and lost it on the next month change, because the array
// still held the snapshot and the window still claimed the month was loaded.
//
// `sections` is a LIST because approving an offer writes a schedule row AND closes the offer. The unnamed form is
// asserted absent per file, because that is the call that silently does refresh-work without refreshing the write.
for (const [name, sections] of [
  // The board re-reads its own month after a save through `onNeedSchedule` (asserted in verify-admin-render), which is
  // the precise read of the month it changed; resolving an offer here fills an empty slot with a new schedule row, so
  // this tab names the section for the same reason.
  ['AdminPendingApprovalsTab.jsx', ['schedule', 'scheduleOffers']],
  // The roster left the payload with the schedule, and this tab's spinner used to refresh everything but `users`.
  ['AdminUsersTab.jsx', ['users']],
  // Already correct, and in the table so they stay that way: these name theirs, which is why they survived the
  // lazy-loading change that broke the schedule.
  ['AdminAssignmentsTab.jsx', ['assignments']],
  ['AdminScheduleTemplatesTab.jsx', ['scheduleTemplates']],
  ['AdminTrainingTab.jsx', ['trainings']],
]) {
  const source = read('src/components/admin/' + name);
  const unnamed = sections.filter(
    (section) => !new RegExp(`on(?:Admin)?DataChanged\\??\\.?\\([^)]*'${section}'`).test(source)
  );
  check(`${name} names every section it writes`, unnamed.length === 0, `unnamed: ${unnamed.join(', ')}`);
  check(
    `${name} never falls back to the unnamed refresh`,
    !/on(?:Admin)?DataChanged\??\.?\(\s*\)/.test(source),
    'a bare call refreshes the payload, which no longer carries the collections these tabs write'
  );
}

// A WINDOW READ REPLACES THE ROWS INSIDE ITS OWN RANGE - the half a merge cannot do, and the reason a deleted shift
// used to be drawn back. Behavioural, because utils/savedRow.js is dependency-free and loadable under Node.
const rangeKept = [
  { id: 'sept', date_from: '2026-09-30' },
  { id: 'stale', date_from: '2026-10-14' },
  { id: 'nov', date_from: '2026-11-02' },
];
const rangeAfter = replaceRowsInRange(rangeKept, [{ id: 'fresh', date_from: '2026-10-20' }], '2026-10-01', '2026-10-31');
check(
  'a window read replaces its own range and leaves the months outside it alone',
  rangeAfter.map((r) => r.id).sort().join(',') === 'fresh,nov,sept',
  `got ${rangeAfter.map((r) => r.id).sort().join(',')}`
);
// The deletion case, which is the whole reason it exists: the row is simply absent from the reply.
const rangeDeleted = replaceRowsInRange(rangeKept, [], '2026-10-01', '2026-10-31');
check(
  'and a shift missing from the reply is dropped rather than merged back',
  rangeDeleted.map((r) => r.id).sort().join(',') === 'nov,sept',
  `got ${rangeDeleted.map((r) => r.id).sort().join(',')}`
);
// A row whose date cannot be read is KEPT: this read cannot say it was deleted, and dropping it would lose a shift to
// a typo - the same rule the date repair follows.
const rangeUnreadable = replaceRowsInRange([{ id: 'odd', date_from: 'whenever' }], [], '2026-10-01', '2026-10-31');
check('an unreadable date is kept rather than swept away', rangeUnreadable.length === 1, 'it was dropped');
check('and an empty range is a no-op', replaceRowsInRange([], [], '', '').length === 0, 'it invented rows');
// THE RANGE APPLIES TO A NAMED COLUMN, because a clock entry's date is its `time_in` and nothing else. Comparing a
// datetime against a bare date bound would sort the last day's entries PAST the end of their own window - so the
// value is cut to the day, and a clock row on the window's final day survives.
const clockKept = [
  { id: 'first-day', time_in: '2026-10-01 06:30:00' },
  { id: 'last-day', time_in: '2026-10-31 22:15:00' },
  { id: 'outside', time_in: '2026-11-01 07:00:00' },
];
const clockAfter = replaceRowsInRange(
  clockKept,
  [{ id: 'last-day', time_in: '2026-10-31 22:15:00' }],
  '2026-10-01',
  '2026-10-31',
  'time_in'
);
check(
  'a clock entry on the last day of the window survives its own bound',
  clockAfter.some((r) => r.id === 'last-day'),
  `got ${clockAfter.map((r) => r.id).join(',')}`
);
check(
  'and one the reply no longer carries leaves, because the reply owns its range',
  !clockAfter.some((r) => r.id === 'first-day') && clockAfter.some((r) => r.id === 'outside'),
  `got ${clockAfter.map((r) => r.id).join(',')}`
);
check(
  'and a schedule row without the named column is kept, not silently dropped',
  replaceRowsInRange([{ id: 's1', date_from: '2026-10-05' }], [], '2026-10-01', '2026-10-31', 'time_in').length === 1,
  'the date_from fallback swept it away'
);

check('the reporter tolerates a nonsense total', createWaveReporter({ label: 'x', total: 0 }).settle() === undefined);

// The wave in App is wired to the reporter and to sonner.
check('App builds a reporter for the wave', /createWaveReporter\(\{/.test(waveBody), true);
check('with a unique toast id', /const waveId = nextWaveId\(\)/.test(waveBody), true);
check('reporting progress through a toast', /toast\.loading\(message, \{ id: waveId \}\)/.test(waveBody), true);
check('and completion through the same toast', /toast\.success\(message, \{ id: waveId, duration: \d+ \}\)/.test(waveBody), true);


//
// --- the retry wave itself -------------------------------------------------------------------
//
// Exercised rather than read, because the whole point of it is behavior under failure: a retry that runs in
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

// The REQUEST coalescer that used to be asserted here - a shared in-flight Apps Script read, keyed on
// [action, token, payload] - has been retired along with the layer it keyed on. Apps Script ran one execution at a time
// behind a script lock, so two callers asking the same question paid for the same answer twice; Firestore has no such
// queue, a read now goes straight to the reader dispatcher, and there is nothing left for that key to match.
//
// The discipline did not go away, though, and this is the note that says where it lives now: ONE SHARED IN-FLIGHT READ OF
// A COLLECTION (firestorePayload.js#readUsersOnce - six readers project off `users`, and Firestore bills per document).
// Its rule is asserted where it can be: the release-on-settle source check and the "read in exactly one place" count in
// `npm run verify:read-budget`, and the identity check in `npm run verify:firestore-reads` that proves two readers in the
// same moment are handed one read while a later one is handed a new one.
//
// The READ/WRITE SPLIT that coalescer relied on is still wired, and still worth asserting, because it is what sends a
// read to the dispatchers rather than to the writers:
const fetchLayerSource = read('src/services/api.js');
check('reads and writes take different doors', /if \(isReadAction\(action\)\)/.test(fetchLayerSource), 'the split is gone');
check(
  'and a read that is not answered is reported, not swallowed',
  /throw await notAnswered\(action\)/.test(fetchLayerSource)
);
check(
  'and the report asks the router WHY rather than blaming Firestore',
  /const blocker = await routingBlocker\(action\)/.test(fetchLayerSource) &&
    /VITE_FIRESTORE_FEATURES pins a list of routes/.test(fetchLayerSource)
);
check(
  'and nothing in the fetch layer reaches the sheet any more',
  // Matched with the call paren, because the comments in api.js deliberately still NAME the function they replaced -
  // a reader arriving at an empty region deserves to know what used to be there.
  !/appScriptRequest\(|SCRIPT_URL|await fetch\(/.test(fetchLayerSource),
  'the sheet transport is still there'
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

// THE OTHER HALF OF "my save did not take", and the half that looks identical from the screen.
//
// A save applies its own row to the list it is drawn from (so the officer sees the result without waiting for the
// refresh wave), and only THEN asks for the month to be re-read. The Ranks tab's order was not being SENT, and this is
// what made that so hard to see: the merge had no whitelist, so the number the officer typed DID appear in the table -
// for as long as it took the refresh wave to land Firestore's older value on top of it. The screen therefore showed the
// new order, then the old one, with no error anywhere, which reads as "the save was rejected" rather than "the save did
// not carry the field".
//
// So this asserts the two halves agree: whatever the save applied is what the list that draws it holds. It is the
// runtime counterpart to the payload comparison in scripts/verify-write-safety.mjs - that one proves the order is SENT,
// this proves it is not quietly dropped on the way in.
{
  const before = [{ id: 'k1', description: 'Officer', rank_order: '1' }];
  const after = mergeSavedRow(before, { id: 'k1', description: 'Officer', color: '#c3223b', rank_order: '3' });
  check('a saved rank carries its order into the list that draws it', after[0].rank_order === '3', `got ${JSON.stringify(after[0].rank_order)}`);
  check('and keeps the columns it did not send', after[0].description === 'Officer', `got ${JSON.stringify(after[0].description)}`);
  // The blank case, because a CLEARED order has to reach the list as a blank too - otherwise the officer's screen shows
  // the old number until the refresh lands, which is the same flicker with the opposite cause.
  const cleared = mergeSavedRow(after, { id: 'k1', rank_order: '' });
  // Strictly `=== ''`, and not "falsy" or "not the old number": a cleared order arriving as 0 is a real rank at the
  // bottom of the list, so a loose assertion here would pass on exactly the value that must never be written.
  check('and a cleared order reaches the list as a blank, not a zero', cleared[0].rank_order === '', `got ${JSON.stringify(cleared[0].rank_order)}`);
  check('and the clear still counts as a change, so the list is not left untouched', after !== cleared, 'the same array came back, so the table would not re-render');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
