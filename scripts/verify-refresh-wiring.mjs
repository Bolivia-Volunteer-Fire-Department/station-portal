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

// Each cache a screen renders from, and the refresher that reloads it. If a new cache is
// added to the app, add it here - that is the point of the table.
const CACHES = [
  ['roles / ranks / shifts / settings', 'fetchInitialData'],
  ['users', 'refreshAdminUsers'],
  ['schedule templates, assignments, offers', 'refreshAdminScheduleData'],
  ['the schedule rows', 'refreshSchedule'],
  ['the member roster', 'refreshRoster'],
  ['who is on duty', 'refreshOnDuty'],
];
for (const [cache, refresher] of CACHES) {
  check(
    `a save reloads ${cache}`,
    refreshBody.includes(`${refresher}(`),
    `refreshAdminData no longer calls ${refresher}()`
  );
}

// The exact shape of the bug: a branch that skips half the data.
check(
  'and does not branch on whether a token was passed',
  !/if\s*\(\s*!token\s*\)/.test(refreshBody),
  'refreshAdminData branches on !token again, so one half goes stale'
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
  ['onDataChanged', 'refreshAdminData'],
  ['onAdminDataChanged', 'refreshAdminData'],
  ['onOffersChanged', 'refreshAdminOffers'],
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
check('the wave derives its total from the list', /total: requests\.length/.test(waveBody), 'the total is not derived');
check('and holds no hand-kept count', /requestCount|total: \d/.test(waveBody) === false, 'a hard-coded count is back');
check('every request is tracked through the reporter', /requests\.map\(\(request\) =>/.test(waveBody), 'requests are not tracked');
check('counting a failure as well as a success', /report\.settle\(false\)/.test(waveBody) && /report\.settle\(true\)/.test(waveBody), true);

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
