// Verifies DATA FRESHNESS: how old the app says something is, when a returning tab is worth a read, and whether the sentinel
// that says "the schedule changed" is wired end to end.
//
// WHY THIS FILE EXISTS. The failure it is written against has no error and no symptom: a member has the schedule open, somebody
// else moves a shift, and the screen keeps showing them the old answer - confidently, with no hint that anything is missing.
// They find out by refreshing the whole app, which means the app taught them not to trust it. Three judgements keep that from
// happening, and each is worth asking directly rather than trusting a screen to have made it well:
//
//   * WHEN IS "UPDATED X AGO" WORTH SAYING - and when does it become a prompt rather than a note.
//   * WHEN COMING BACK TO THE TAB IS WORTH A RE-READ, which must be neither "every flick of the tabs" nor "never".
//   * WHETHER A SENTINEL CHANGE IS A CHANGE AT ALL, which is subtle in exactly one place: an unwritten sentinel is version 0,
//     so the first real bump is 0 -> 1, and a screen that treated 0 as something it had already seen would ignore it.
//
// AND THE TWO HALVES HAVE TO AGREE ON THE PATH. The server bumps a document and the client watches one; if they are spelled
// differently the sentinel never fires and NOTHING reports it. The last section asserts the two strings match.
//
// Run with: npm run verify:freshness
import { readFileSync } from 'node:fs';
import {
  FRESHNESS_STALE_MS,
  RETURN_REFRESH_MIN_HIDDEN_MS,
  SCHEDULE_SENTINEL_PATH,
  freshnessLabelFor,
  isStale,
  sentinelChanged,
  shouldRefreshOnReturn,
} from '../src/utils/freshness.js';

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

const NOW = 1_800_000_000_000;
const ago = (ms) => NOW - ms;

console.log('\n--- how old is what is on screen ---');
// NOTHING READ YET SAYS NOTHING: an empty label, rather than a claim that the data is current. A screen that has not loaded is
// not fresh, it is silent - and "Updated 0 minutes ago" would be a lie told by a screen that has not asked for anything.
check('a screen that has read nothing says nothing', freshnessLabelFor({ atMs: 0, nowMs: NOW }), '');
check('just read', freshnessLabelFor({ atMs: ago(0), nowMs: NOW }), 'Updated just now');
check('half a minute is still just now', freshnessLabelFor({ atMs: ago(30 * 1000), nowMs: NOW }), 'Updated just now');
check('a minute', freshnessLabelFor({ atMs: ago(60 * 1000), nowMs: NOW }), 'Updated 1 minute ago');
check('four minutes', freshnessLabelFor({ atMs: ago(4 * 60 * 1000), nowMs: NOW }), 'Updated 4 minutes ago');
check('an hour', freshnessLabelFor({ atMs: ago(60 * 60 * 1000), nowMs: NOW }), 'Updated 1 hour ago');
check('and a day', freshnessLabelFor({ atMs: ago(25 * 60 * 60 * 1000), nowMs: NOW }), 'Updated 1 day ago');
// A CLOCK THAT DISAGREES: a read that appears to have happened in the future reads as "just now" rather than as a negative age,
// because the member's screen being wrong about the time is not something the label should shout about.
check('a read from the future reads as just now', freshnessLabelFor({ atMs: NOW + 60_000, nowMs: NOW }), 'Updated just now');

console.log('\n--- and when it is stale enough to say so ---');
check('freshly read is not stale', isStale({ atMs: ago(60_000), nowMs: NOW }), false);
check('at the threshold it is', isStale({ atMs: ago(FRESHNESS_STALE_MS), nowMs: NOW }), true);
check('well past it', isStale({ atMs: ago(FRESHNESS_STALE_MS * 3), nowMs: NOW }), true);
// NOTHING READ IS STALE, which is the honest answer: nothing loaded is the oldest a screen can be.
check('nothing read at all is stale', isStale({ atMs: 0, nowMs: NOW }), true);

console.log('\n--- coming back to the tab ---');
// BOTH HALVES ARE NEEDED, and each rules out a read the other would allow on its own.
check('a quick flick away and back is not worth a read', shouldRefreshOnReturn({ hiddenMs: 10_000, atMs: ago(10 * 60 * 1000), nowMs: NOW }), false);
check('and neither is a long absence with data barely changed', shouldRefreshOnReturn({ hiddenMs: 30 * 60 * 1000, atMs: ago(60 * 1000), nowMs: NOW }), false);
// THE CASE THAT ACTUALLY HAPPENED: away long enough for somebody else to have edited the schedule, looking at data old enough to
// be worth re-reading.
check('away for a while, looking at old data', shouldRefreshOnReturn({ hiddenMs: RETURN_REFRESH_MIN_HIDDEN_MS, atMs: ago(FRESHNESS_STALE_MS), nowMs: NOW }), true);
check('and a screen that never loaded anything', shouldRefreshOnReturn({ hiddenMs: 10 * 60 * 1000, atMs: 0, nowMs: NOW }), true);
check('a tab that was never hidden', shouldRefreshOnReturn({ hiddenMs: 0, atMs: ago(60 * 60 * 1000), nowMs: NOW }), false);

console.log('\n--- the sentinel, and the first bump that must not be swallowed ---');
// THE SUBTLE ONE. The sentinel does not exist until the first schedule write, so a screen can legitimately observe version 0 -
// and if it treats that as "a version I have seen", the next change (0 -> 1) looks like something it already acted on.
check('nothing seen yet is not a change', sentinelChanged({ version: 0, seen: null }), false);
check('so the FIRST bump after that is one', sentinelChanged({ version: 1, seen: 0 }), true);
check('the same version is not a change', sentinelChanged({ version: 3, seen: 3 }), false);
check('a later bump is', sentinelChanged({ version: 4, seen: 3 }), true);
check('and the default shape is not a change', sentinelChanged({}), false);

// ---------------------------------------------------------------------------------------------------
console.log('\n--- the two halves agree on the document ---');
// A SERVER BUMPING ONE DOCUMENT WHILE CLIENTS WATCH ANOTHER IS A SENTINEL THAT NEVER FIRES, with no symptom and no error - the
// failure this module's own comment promises to guard, asserted rather than hoped for.
const serverSource = readFileSync('functions/index.js', 'utf8');
checkIs("the server bumps a sentinel when the schedule changes", /exports\.onShiftWritten = onDocumentWritten\('shifts\/\{shiftId\}'/.test(serverSource));
checkIs(
  'and it bumps the document this module names',
  serverSource.includes(`'${SCHEDULE_SENTINEL_PATH}'`),
  `looking for ${SCHEDULE_SENTINEL_PATH} in functions/index.js`
);
checkIs('the bump is a COUNT, so two edits in one second still differ', /FieldValue\.increment\(1\)/.test(serverSource));
checkIs('and the bump is a server write, in a trigger rather than a client', /exports\.onShiftWritten/.test(serverSource));
// THE CLIENT'S HALF, WHICH NOW EXISTS: the subscription that watches the sentinel, and the App wiring that re-reads the
// schedule window when it changes. Asserted rather than assumed, because this is the half that made the whole arrangement
// worth building - and because "a `watch` in liveReads with nothing mounting it" is a listener held for nobody, which is the
// note this check carried while the client half was still missing.
const readsSource = readFileSync('src/services/liveReads.js', 'utf8');
const appSource = readFileSync('src/App.jsx', 'utf8');
checkIs('the client watches the sentinel document', readsSource.includes(`'live', 'schedule'`));
checkIs('and the app subscribes to it', /scheduleVersion: \(row\) => \{/.test(appSource));
checkIs('re-reading the window the screens last asked for', /loadScheduleWindow\(from, to\)/.test(appSource) && /scheduleSentinel\.current\.from = from/.test(appSource));
// THE FIRST LOOK MUST BE RECORDED EVEN WHEN IT IS NOT A CHANGE, which is the one place this can go quietly wrong: a handler
// that only wrote the version when it differed would leave `seen` null forever and swallow the first real bump.
checkIs('and records the version it saw either way', /scheduleSentinel\.current\.version = version;\s*\n\s*if \(!changed\) return;/.test(appSource));
checkIs('the sentinel ref is declared above the loader that writes it', appSource.indexOf('const scheduleSentinel = useRef') < appSource.indexOf('scheduleSentinel.current.from = from'));
// COMING BACK TO THE TAB, wired to the decision asserted above rather than to a second opinion about when it is worth a read.
checkIs('leaving the tab records when it was hidden', /scheduleSentinel\.current\.hiddenAt = Date\.now\(\)/.test(appSource));
checkIs('and coming back asks the decision, not a guess', /shouldRefreshOnReturn\(\{ hiddenMs, atMs: scheduleSentinel\.current\.at \}\)/.test(appSource));
checkIs('reads the window the screens last asked for, like the sentinel', /void scheduleReloadRef\.current\?\.\(from, to\)/.test(appSource));
// THE LOADER IS READ THROUGH A REF, because a plain `const` rebuilt every render would have to be a dependency - and that would
// re-register this listener on every render for nothing. Asserted so nobody "simplifies" it back into a dependency array.
checkIs('and the loader is held in a ref rather than a dependency', /const scheduleReloadRef = useRef\(null\)/.test(appSource));
// WHEN THE WINDOW LANDED, which is the only moment "updated" means anything - set after the await, not before it, because a read
// still in flight is not data on screen.
checkIs('the read time is recorded when the window lands', /scheduleSentinel\.current\.at = Date\.now\(\);\s*\n\s*setScheduleLoadedAt/.test(appSource));
checkIs('and it is kept in state too, for the line a screen draws', /const \[scheduleLoadedAt, setScheduleLoadedAt\] = useState\(0\)/.test(appSource));
// THE LINE ITSELF: rendered above the calendar from the same state, with the manual read beside it.
const freshnessSource = readFileSync('src/components/ScheduleFreshness.jsx', 'utf8');
checkIs('the freshness line is rendered above the schedule', /<ScheduleFreshness atMs=\{scheduleLoadedAt\} onRefresh=\{refreshSchedule\} \/>/.test(appSource));
checkIs('and the Refresh button re-reads the window on screen', /const refreshSchedule = \(\) => \{/.test(appSource) && /scheduleReloadRef\.current\?\.\(from, to\)/.test(appSource));
// IT SAYS NOTHING WHEN NOTHING HAS BEEN READ. The label answers with an empty string for that case and the component renders
// nothing for the empty string - a claim of freshness from a screen that has not asked for anything is the one thing this line
// must never make (asserted in both halves, because either could get it wrong on its own).
checkIs('a screen that has read nothing renders no line', /if \(!label\) return null;/.test(freshnessSource));
checkIs('and the label turns amber only when the decision says so', /isStale\(\{ atMs, nowMs: now \}\)/.test(freshnessSource));
checkIs('the button says what it does, like every other icon control', /aria-label="Refresh the schedule"/.test(freshnessSource) && /title="Refresh the schedule"/.test(freshnessSource));

console.log(`\n${failures ? `${failures} CHECK(S) FAILED` : 'ALL CHECKS PASSED'}\n`);
process.exit(failures ? 1 : 0);