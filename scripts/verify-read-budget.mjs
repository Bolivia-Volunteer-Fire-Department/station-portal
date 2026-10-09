// The sign-in payload's READ BUDGET: which collections it reads, and the rule that it reads each of them once.
//
// WHY THIS EXISTS. Firestore bills per document, so the cost of a screen is the number of documents it pulls - and the
// payloads are the expensive ones because they read whole collections. A load that reads `users` twice costs 33 members'
// worth of documents twice over, and an administrator's load did exactly that: the member half read `users`,
// `assignments` and `schedule_templates`, and the admin half read the same three again for its own sections, plus the
// caller's own document twice (once for the audience keys, once for the role flags) and the role document again even
// though the whole `roles` collection was already in hand.
//
// A duplicate read is invisible in a diff and invisible at runtime - the screen looks identical, only the bill is
// different - so it is pinned here rather than left to whoever reads the file next. What is asserted:
//
//   1. the member payload READS NOTHING STATION-WIDE ITSELF: it is handed the collections (fetchAdminPayload reads them
//      once for both halves), so `rowsOf(collection(...))` must not appear in its body at all;
//   2. the admin payload does not re-read what the shared wave already brought back, and reads the caller's own document
//      at most once;
//   3. ACROSS THE TWO, no collection is read twice - which is the invariant the two rules above exist to keep.
//
// The inventory below is printed, not asserted: it is the review, so a change in it is visible in the output rather than
// hidden behind a passing test. Counts are DOCUMENTS, which is what is billed: `rowsFor` returns only matching rows, so
// a member's own clock history costs their entries and not the station's.
//
// Run with: npm run verify:read-budget
import { readFileSync, readdirSync } from 'node:fs';
// The backfill's pure plan, exercised here beside the readers whose scans it replaces.
import { signatureCountPlan } from './normalize-training-signature-counts.mjs';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${
      ok ? '' : ` (expected ${JSON.stringify(expected)})`
    }`
  );
};
const checkIs = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` -> ${detail}`}`);
};

const source = readFileSync('src/services/firestorePayload.js', 'utf8');

// One `const NAME = ...` / `export const NAME = ...` body, up to the next declaration at column 0.
const bodyIn = (text, name) => {
  const match = new RegExp(`(?:^|\\n)(?:export )?const ${name} = ([\\s\\S]*?)(?=\\n(?:export )?const |\\n*$)`).exec(text);
  return match ? match[1] : '';
};
const bodyOf = (name) => bodyIn(source, name);

const wholeCollectionReads = (text) =>
  [...text.matchAll(/rowsOf\(collection\(db, '([a-z_]+)'\)\)/g)].map((match) => match[1]);

const memberBody = bodyOf('fetchMemberPayload');
const adminBody = bodyOf('fetchAdminPayload');
const stationBody = bodyOf('readStationRows');

console.log('--- the payloads, as read ---');
checkIs('the member payload was found', memberBody.length > 0);
checkIs('the admin payload was found', adminBody.length > 0);
checkIs('the shared station wave was found', stationBody.length > 0);

// 1. The member payload reads none of the SHARED collections itself. What it does read is its OWN: `on_duty` (who is at the
// station now), the member's own certifications and the catalogue they are named from (the dashboard's notice), and the station
// settings. Everything else - the directory, the badge index, the schedule, the templates, the assignments, the claims, the
// offers, training - is read by the screen that draws it, which is the pass this list exists to keep.
check(
  'the member payload re-reads no shared collection',
  wholeCollectionReads(memberBody).filter((name) => wholeCollectionReads(stationBody).includes(name)),
  []
);
checkIs(
  'it takes what the caller already read instead',
  /stationRows \|\| \(await readStationRows\(db\)\)/.test(memberBody)
);
// THE CLOCK HISTORY IS NOT READ HERE AT ALL, which is the whole point of moving it to its own screen: it is the one
// per-member table with no ceiling, and it was only here so the dashboard could answer "am I clocked in".
checkIs('the member payload does not read the clock history', !/rowsFor\('timeclock'/.test(memberBody));
// THE ACTIVE ANNOUNCEMENT BOUND IS ON BOTH HALVES OF THE PATH, and this is the invariant that keeps the saving real: the
// payload's READ and the live LISTENER. A read bounded to "in force" beside a listener watching the whole collection would
// pay for all of it a moment after sign-in - the snapshot REPLACES what the read put in state - so either half alone is a
// narrowing that costs complexity and saves nothing. Asserted here, together, because that failure looks like success.
checkIs('the payload reads announcements through the active bound', /activeAudienceRows\('announcements'/.test(memberBody));
// ...and the bound only works because the SAVE PATH materializes the column it filters on: a query over a field nothing
// writes matches nothing, silently.
const writesSource = readFileSync('src/services/firestoreWrites.js', 'utf8');
checkIs('which the save path writes, from the app\u2019s own date parser', /extra\.live_until = parseSheetDateKey/.test(writesSource));
checkIs(
  'for announcements specifically',
  /liveUntilFrom: 'end_date'/.test(readFileSync('src/services/firestoreRouting.js', 'utf8'))
);
// NO READ ACTION DEFINED TWICE. A duplicate key in an object literal does not fail - the LAST one wins - so a reader added
// above an existing one is silently not the reader that runs. That is exactly how a windowed clock-history reader gets
// written, reviewed and then quietly bypassed, with the window still "passing" a check that only asks for rows.
const readerKeys = [...readFileSync('src/services/firestoreReads.js', 'utf8').matchAll(/^  ([A-Z][A-Z0-9_]*):/gm)].map(
  (match) => match[1]
);
check(
  'no read action is defined twice in the reader table',
  [...new Set(readerKeys.filter((key, index) => readerKeys.indexOf(key) !== index))],
  []
);
// THE WINDOWED CLOCK QUERY MUST BE SERVABLE BY A DECLARED INDEX. Equality on one field plus a range on another needs a
// composite index, and THE EMULATOR IGNORES INDEX REQUIREMENTS - it answers any query - while PRODUCTION refuses with
// failed-precondition. That gap is exactly how Clock History loaded nothing in the field while this suite was green: the
// reader asked for (user_id ==, time_in range) with no orderBy, the implied ascending scan matched no declared index
// (firestore.indexes.json declares user_id ASC, time_in DESC), and no check here could see it. So the checks below pin the
// shape: the reader names the range field in its own order, and the index file declares that exact pair. A query shape
// that changes without the index, or an index dropped without the reader, now fails here rather than in the field.
//
// THE MEMBER SCOPING IS NOT PINNED LITERALLY ANY MORE, and that is a consequence of the officer's read rather than a
// loosening: `user_id` is now a CONDITIONAL filter, so the literal line it used to be has stopped existing. Pinning it
// would have made the fix that lets Clock Management show other members' entries impossible to make. What is checked
// instead is the property - the range and the order the index serves, and the member narrowing still being present.
const readsSourceForClockIndex = readFileSync('src/services/firestoreReads.js', 'utf8');
const declaredIndexes = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')).indexes;
const declaredIndex = (collectionGroup, first, second, secondOrder) =>
  declaredIndexes.some(
    (index) =>
      index.collectionGroup === collectionGroup &&
      index.fields.length === 2 &&
      index.fields[0].fieldPath === first &&
      index.fields[0].order === 'ASCENDING' &&
      index.fields[1].fieldPath === second &&
      index.fields[1].order === secondOrder
  );
// THE ORDER BY AND THE RANGE ARE WHAT MAKE IT SERVABLE, and the `user_id` filter is deliberately NOT pinned here any more.
// It used to be matched literally, which was right while the read was member-only and wrong the moment an officer's was
// added: the filter is now conditional (a member's read scopes by `user_id` in the QUERY; an officer's does not), so the
// literal line no longer exists to match. What still matters is the shape that the declared index serves - a range on
// `time_in` ordered by `time_in` - and that the member's narrowing filter is still THERE, conditionally, because a read
// that quietly lost it would hand a member the whole station's history.
const clockQueryBlock = /collection\(firestore\(\), 'timeclock'\),([\s\S]*?)\)\s*\)\s*;/.exec(readsSourceForClockIndex)?.[1] || '';
checkIs(
  'the windowed clock query orders by the range field',
  /where\('time_in', '>=', from \|\| '0000-01-01'\)/.test(clockQueryBlock) &&
    /orderBy\('time_in', 'desc'\)/.test(clockQueryBlock),
  clockQueryBlock.trim()
);
// ...and the member narrowing is conditional rather than gone. The conditional spread is what an officer's read turns
// off, so its ABSENCE is the bug this whole change was about; a plain literal here would have been pinned out by the very
// fix that made the admin screen work.
checkIs(
  'and a member\'s read is still scoped by user_id, conditionally',
  /managesAll \? \[\] : \[where\('user_id', '==', uid\)\]/.test(clockQueryBlock),
  'the reader no longer narrows a member\'s read to their own rows'
);
// THE UPPER BOUND MUST BE EXCLUSIVE, AND THIS IS THE ASSERTION THAT WAS MISSING. `time_in` is a datetime and `to` is
// a bare date key, so Firestore's TEXT comparison drops every entry stamped on the last day of the window - which, on a
// screen that asks for "the last twelve months, up to today", is the entry the member had just clocked in. A member saw
// a successful write and an empty row, and the row before it was still there. Nothing caught it because the seeded
// entry sits mid-window and because an assertion phrased over the rows that DID come back cannot notice one that did
// not. So the operator is pinned here, and verify:firestore-reads proves the boundary day end-to-end against the
// emulator. `<=` on a bare date is the exact regression.
checkIs(
  'and bounds the end of the window EXCLUSIVE, so an entry on the last day is not dropped',
  /where\('time_in', '<', to \? nextDateKey\(to\) : '9999-12-31'\)/.test(readsSourceForClockIndex) &&
    !/where\('time_in', '<=', to \|\| '9999-12-31'\)/.test(readsSourceForClockIndex),
  readsSourceForClockIndex.match(/where\('time_in'[^)]*\)[^\n]*/)?.[0]
);
checkIs(
  'the exclusive bound comes from the shared day helper rather than a bound built in place',
  /import \{[^}]*nextDateKey[^}]*\} from '\.\.\/utils\/scheduleDate\.js'/.test(readsSourceForClockIndex)
);
checkIs(
  'and the index it needs is declared for production',
  declaredIndex('timeclock', 'user_id', 'time_in', 'DESCENDING'),
  JSON.stringify(declaredIndexes.filter((index) => index.collectionGroup === 'timeclock'))
);
// THE ONE UNBOUNDED COLLECTION IS NOT IN THE SIGN-IN WAVE AT ALL. `schedule` holds every shift the station has ever
// scheduled, so it is read per MONTH by the screen that draws it (GET_SCHEDULE, through App#loadScheduleWindow) and never as
// part of a sign-in. Shifting the check to the reader is the point: the wave no longer has a window to get wrong, and the
// window is asserted where it now lives.
checkIs('the sign-in wave does not read the schedule at all', !/'schedule'/.test(stationBody));
checkIs(
  'and the windowed reader that does is a range query',
  /rowsInRange\('schedule', 'date_from', window\.from, window\.to\)/.test(readFileSync('src/services/firestorePayload.js', 'utf8'))
);
// THE SIGN-IN WAVE IS DOWN TO THE MENU'S OWN DATA. `roles` is the permission set every screen is gated on, and `ranks` labels
// people; everything else that used to ride here - the schedule, the directory, the templates, the assignments, the shift
// definitions, the claims, the offers, the training lists - is read by the screen that draws it. That makes this list the shape
// to DEFEND: a collection appearing here again means something has crept back into the sign-in.
check('with the wave reading nothing else whole', wholeCollectionReads(stationBody).sort(), ['ranks', 'roles']);
// THE SIGN-IN WAVE NO LONGER READS THE DIRECTORY AT ALL, and this is the invariant the whole pass rests on: a member who signs
// in to clock in needed their own name and the names of whoever was on duty, and it used to cost one document per member of the
// station to get them. The on-duty names are read BY ID (usersByIds - one document per person actually on shift), and the
// screens that LIST people read the directory through the shared in-flight read when they open (GET_ROSTER).
checkIs('the sign-in wave does not read the user directory at all', !/readUsersOnce\(\)/.test(stationBody) && !wholeCollectionReads(stationBody).includes('users'));
const readsSourceForRoster = readFileSync('src/services/firestoreReads.js', 'utf8');
checkIs(
  'while the screens that list people do, through the shared read - and the badge index with them',
  /GET_ROSTER: async \(\) => \{[\s\S]*?certification_badges/.test(readsSourceForRoster) &&
    /readUsersOnce\(\)/.test(readsSourceForRoster)
);
checkIs('and the on-duty names are read one document at a time', /usersByIds\(onDutyRows/.test(memberBody) && /getDoc\(doc\(firestore\(\), 'users', id\)\)/.test(source));
// The App-side half - that OPENING a screen is what fetches the directory, and that a member who only clocks in never does - is
// asserted with the other App.jsx checks below, where that file has been read.
checkIs(
  'and the four readers that want it share ONE read when they do',
  /readUsersOnce\(\)/.test(readFileSync('src/services/firestorePayload.js', 'utf8')) && /usersInFlight/.test(source)
);

// ...and the same invariant across the refresh readers, which is where most of those four live.
const readsSource = readFileSync('src/services/firestoreReads.js', 'utf8');
// The reader the history moved TO, and that it now serves a range: this is the check that would catch the window being
// dropped in a later edit, which would quietly restore the read the payload stopped making.
checkIs('the clock-history reader serves a range', /where\('time_in', '>=', from/.test(readsSource));
// THE PRE-LOGIN READ IS ONE DOCUMENT, and this is the guard on the only read the app makes with no session: every extra
// collection it asks for is a request the rules refuse to a caller with no identity. The login screen's announcements used
// to be one of them, and the whole placement is gone rather than fixed (utils/announcements#ANNOUNCEMENT_LOCATIONS).
//
// It is the LAST entry in the reader table, so its body ends at the table's own closing brace - and the "did we find it"
// check comes first, because the check after it is a negative one and a negative check against an empty string passes.
const preLoginBody = (readsSource.match(/GET_INITIAL_DATA:[\s\S]*?\n\};/) || [''])[0];
checkIs('the pre-login read was located in the reader table', preLoginBody.length > 0);
checkIs('the pre-login read asks for the public settings', /'settings', 'public'/.test(preLoginBody));
checkIs('and for no collection at all', !/rowsOf\(|rowsFor\(|audienceRows\(|rowsInRange\(/.test(preLoginBody));
check(
  'the users collection is read in exactly one place in the whole app',
  [...`${source}\n${readsSource}`.matchAll(/rowsOf\(collection\((?:db|firestore\(\)), 'users'\)/g)].length,
  1
);
// THREE, and the third is the name fix: the admin Users section (joined to the private half), the shared read itself,
// and the `directory` section - the PUBLIC rows the tabs that draw a member's name read, which had to be one of these
// because the join the Users section performs is refused to an officer without can_edit_users.
check('which the payload projects off in exactly three places', [...source.matchAll(/readUsersOnce\(\)/g)].length, 3);
// DOWN FROM THREE, and the one that left is the point of this pass: the sign-in wave used to read the directory so it could
// project a roster, and now it reads no directory at all - the dashboard names only whoever is on duty, one document per
// person, by id (usersByIds). What is left is the admin Users section and the shared read itself.
//
// AND THE REFRESH READERS IN THREE, UP FROM TWO, because the roster is a read of its own again: the screens that LIST people
// ask for it when they open (GET_ROSTER), so the action has the caller it never had. The runner leaderboard went the other way,
// to a bounded query.
// CHAT IS THE FOURTH, and it is the same reason: `chatKeysFor` needs the caller's own role and rank to build their
// audience keys, and it goes through the shared in-flight read rather than reading the directory a third way. The count is
// pinned so that a fifth one - a read that is genuinely a duplicate - is visible here rather than in the bill.
check('and the refresh readers in four', [...readsSource.matchAll(/readUsersOnce\(\)/g)].length, 4);
// THE RULE THAT MAKES SHARING SAFE, asserted because it is one character away from being wrong: the entry is dropped
// whether the read SUCCEEDS or FAILS. Releasing only on success would keep a failed read in place, and every later
// caller in that window would be handed the same failure.
checkIs('and dropped the moment it settles, either way', /usersInFlight\.then\(release, release\)/.test(source));

// 2. The admin payload does not re-read the shared wave, and reads the caller's document at most once.
const adminReReads = wholeCollectionReads(adminBody).filter((name) =>
  wholeCollectionReads(stationBody).includes(name)
);
check('the admin payload re-reads none of the shared collections', adminReReads, []);
check(
  'and reads the caller’s own document at most once',
  [...adminBody.matchAll(/getDoc\(doc\(db, 'users'/g)].length,
  1
);
check('it does not read the role document again either', /getDoc\(doc\(db, 'roles'/.test(adminBody), false);

// 3. Across both, no collection is read twice.
const byFlow = [...wholeCollectionReads(stationBody), ...wholeCollectionReads(memberBody), ...wholeCollectionReads(adminBody)];
const duplicates = byFlow.filter((name, index) => byFlow.indexOf(name) !== index);
check('no collection is read twice in one sign-in', [...new Set(duplicates)], []);

// 3c. LIVE READS: the few collections where a listener is cheaper than re-reading. The rule for what qualifies lives in
// services/liveReads.js; what is pinned here is what makes the difference between a listener that saves reads and one that
// costs them.
const liveSource = readFileSync('src/services/liveReads.js', 'utf8');
// THE ANNOUNCEMENT BOUND IS ON THE LISTENER TOO, and it has to be asserted beside the read that shares its column: a
// payload bounded to "in force" beside a listener watching the whole collection pays for everything a moment after
// sign-in, because the snapshot REPLACES what the read put in state. Either half alone is a narrowing that costs
// complexity and saves nothing - which is why the two are checked together, four lines apart in this harness.
checkIs('the announcements listener carries the same active bound as the read', /where\('live_until', '>=', toDateKey/.test(liveSource));

// SHIFT OFFERS ARE NARROWED TO THE STATUSES A CALENDAR USES, on both sides - and that narrowing is only safe because the
// save path always writes the column it filters on. This is the difference from the announcements' dates, where a blank end
// date is meaningful and a materialized column was needed; an offer with no `status` would not be actionable in the UI
// either, so filtering on it cannot hide something a member needed. The write is asserted beside the read because the read
// depends on it. (Placed here, with the other source-text invariants, rather than beside the payload checks above: that
// block runs BEFORE `readsSource` is declared, and a const read above its own declaration is a crash, not a failure.)
const payloadSource = readFileSync('src/services/firestorePayload.js', 'utf8');
checkIs(
  'the member offers read is bounded to the calendar statuses',
  /OFFER_STATUSES_ON_A_CALENDAR = \['pending', 'declined'\]/.test(payloadSource) &&
    /where\('status', 'in', OFFER_STATUSES_ON_A_CALENDAR\)/.test(payloadSource)
);
checkIs('the officer offers read is bounded to the pending ones', /pendingOffers\(firestore\(\)\)/.test(readsSource));
// POSITIONAL, not a character budget. This check used to allow a fixed 400-character window between `setDoc(created, {`
// and `status: 'pending'`, and the window closed on it when explanatory comments were added to `makeOffer` - the write
// was correct and now more correct, and the check went red saying it was missing. What it means to assert is that the
// object being written carries the field, so it reads to the END OF THAT OBJECT rather than counting characters.
const offerWriteAt = writesSource.indexOf('setDoc(created, {');
const offerWrite = offerWriteAt < 0 ? '' : writesSource.slice(offerWriteAt, writesSource.indexOf('});', offerWriteAt));
checkIs(
  'and every offer the app creates carries the status that filter needs',
  /status: 'pending'/.test(offerWrite),
  'the offers read is bounded to `status`, so an offer written without one is an offer nobody sees'
);
const liveCollections = [...liveSource.matchAll(/collection\(db, '([a-z_]+)'\)/g)].map((match) => match[1]);
check('the live collections are the small and audience ones', [...new Set(liveCollections)].sort(), [
  'announcements',
  'events',
  'on_duty',
]);
// A listener's first snapshot is a read of everything it matches, paid on every attach - so the one collection that grows
// without limit must never be on this list, however often it is read.
checkIs('and `schedule` is not among them, however often it is read', !liveCollections.includes('schedule'));
checkIs('with the station settings one document, not a collection', /watch\(doc\(db, 'settings', 'public'\)/.test(liveSource));
// The teardown has to be real, and it has to survive the one case that is easy to miss: the audience listeners attach after
// their keys are read, so an unsubscribe can arrive first and must still be obeyed.
checkIs(
  'and one call tears the whole session down',
  /return \(\) => \{\n    cancelled = true;\n    stops\.forEach/.test(liveSource)
);

// (The App-side half of the live-reads invariant is asserted with the other App.jsx checks further down, where that file has
// been read: a `const` referenced above its own declaration is a ReferenceError, and this harness found that out the loud
// way rather than by review.)

// 3d. THE LEADERBOARD IS A QUERY, not a scan. It used to read the whole `users` collection on every play - the most repeated
// screen in the app - and the claim that replaced it is that a bounded query plus one count answer the same question.
const scoreSource = readFileSync('scripts/normalize-runner-scores.mjs', 'utf8');
const mapSource = readFileSync('scripts/migration-map.mjs', 'utf8');
checkIs(
  'the leaderboard is a bounded query rather than a scan',
  /where\('runner_score', '>', 0\)[\s\S]{0,200}?orderBy\('runner_score', 'desc'\)[\s\S]{0,100}?limit\(RUNNER_LEADERBOARD_LIMIT\)/.test(readsSource) &&
    /getCountFromServer\(scored\(\)\)/.test(readsSource)
);
// A text score is not `> 0`, so the filter cannot see it and its owner leaves the board: the column has to be TYPED wherever a
// value is written, and the migration is the only other writer there has ever been.
checkIs('with the column typed by the migration', /NUMERIC_COLUMNS = new Set\(\[[\s\S]{0,1400}?'runner_score',/.test(mapSource));
checkIs('and a repair for scores a migration left as text', /export const scoreToStore/.test(scoreSource));

// 4. A scoped refresh may only name sections that EXIST, in both halves of the wire: the section readers the payload
// module defines, and the setters App has for them. A typo in either direction is invisible at runtime - App filters an
// unknown name out and reloads the whole payload - so it looks like a slow screen rather than a broken one, and this is
// the only place it can be seen.
const sectionNames = [
  ...source
    .slice(source.indexOf('const ADMIN_SECTIONS = {'))
    .matchAll(/\n  ([a-zA-Z]+): async \(/g),
].map((match) => match[1]);
// Certifications is intentionally not a direct collection reader: fetchAdminSections obtains it through the
// permission-checked callable so the server can scope the query to active member IDs.
sectionNames.push('certificationRecords');
checkIs('the section readers were found', sectionNames.length >= 8, `only found ${sectionNames.join(', ')}`);

const appSource = readFileSync('src/App.jsx', 'utf8');
const approvalSections = /approvals:\s*\[([^\]]*)\]/.exec(appSource)?.[1] || '';
checkIs(
  'Pending Approvals loads its complete row context without Schedule Management first',
  ['scheduleOffers', 'directory', 'schedule', 'scheduleTemplates', 'assignments'].every((section) =>
    new RegExp(`['\"]${section}['\"]`).test(approvalSections)
  ),
  approvalSections
);

// THE ADMINISTRATION WAVE IS NOT READ AT SIGN-IN. It used to be: six shared reads - the roster, the user directory, every
// assignment, every schedule template, the offers, the certifications - spent on every administrator sign-in, including the
// ones that only clock in, which is most of them. The trigger is a React effect, so what has to be true is that the SIGN-IN
// PATH cannot reach it and only the module's opening can, which is what these two patterns together assert.
check(
  'the administration wave waits for the module to be opened',
  /!authToken \|\| !adminModuleOpened\) return;/.test(appSource) &&
    /if \(activeTab === 'admin' && canAdminister && adminSubTab\) setAdminModuleOpened\(true\)/.test(appSource),
  true
);
// ...and OPENING ADMINISTRATION IS FREE NOW: the menu page reads only the offers its badge counts
// (and only for a role that may act on them), so a member who opens the module and changes their
// mind has paid one small filtered read, not a tab's worth.
check(
  'the menu page reads only the offers its badge needs',
  /'': allowedAdminTabs\(currentUserRole\)\.includes\('approvals'\) \? \['scheduleOffers'\] : \[\]/.test(appSource),
  true
);
// ...and the module has to SAY it is loading rather than drawing from props that are still empty, or the first moment of
// every visit reports a station with no users, no shifts and no assignments.
check(
  'and the module draws a loading state instead of its empty lists',
  /if \(loading\) \{/.test(readFileSync('src/components/admin/AdminPanel.jsx', 'utf8')),
  true
);
// ...AND THE CREW DIRECTORY IS NOT READ AT SIGN-IN EITHER, which is the second half of the same pass: it is a document per
// member, and it is fetched the first time a screen that LISTS people is opened - the calendar's pill names, or anything in the
// Administration module that names somebody. A member who only clocks in triggers neither.
checkIs(
  'the crew directory waits for a screen that lists people',
  /if \(activeTab !== 'schedule' && activeTab !== 'admin'\) return;/.test(appSource) && /fetchRoster\(authToken\)/.test(appSource)
);
// THE ROSTER IS READ A PAGE AT A TIME NOW (functions/rosterPage.js), so the reuse is per PAGE AND PER SEARCH: the marker
// names the read the rows in hand answer, and returning to the tab buys nothing until that changes. A read per KEYSTROKE is
// what the box being a form is for - committing on submit, not on every change.
checkIs(
  'the roster module reuses its page for the same account and search',
  /const key = `\$\{authToken\}\|\$\{rosterSearch\}`/.test(appSource) &&
    /if \(rosterLoadedFor === key\) return undefined;/.test(appSource) &&
    /\}, \[authToken, activeTab, canViewRoster, rosterSearch, rosterLoadedFor\]\);/.test(appSource)
);
checkIs(
  'and a second page is one read, appended rather than replaced',
  /fetchRosterModule\(token, \{ search, cursor \}\)/.test(appSource) && /append: true/.test(appSource)
);
checkIs(
  'roster-backed admin changes invalidate the page in hand',
  /const rosterSections = \['users', 'certificationSetup', 'certificationRecords'\]/.test(appSource) &&
    /setRosterModuleCache\(null\)/.test(appSource) &&
    /setRosterLoadedFor\(''\)/.test(appSource)
);
// THE CLOCK HISTORY OPENS ON THE PAY PERIOD, WHICH IS NOW A SETTING (utils/payPeriod), AND THAT IS A READ DECISION AS MUCH
// AS A DISPLAY ONE.
//
// `timeclock` is the only collection that grows on its own - every clock-in and clock-out, by every member, forever - and
// the scope is per SESSION, so whatever this window is, every officer pays it on every visit. It opened on twelve months
// once: ~29,000 reads for one officer's first look at a station of forty clocking in twice a day. The window is now the
// station's own period, ending today, and the "load older" step is one more period - so what an officer reconciles is what
// is paid for, and nothing is out of reach (the table says what it holds and offers the rest).
checkIs(
  'the clock history opens on the CONFIGURED pay period, one period per "load older"',
  /const payPeriod = payPeriodConfig\(systemSettings\)/.test(appSource) &&
    /const logsWindow = payPeriodWindow\(payPeriod, stationTodayKey\(\)\)/.test(appSource) &&
    /loadLogs\(logsWindow\.from, logsWindow\.to\)/.test(appSource) &&
    /loadLogs\(payPeriodWindow\(payPeriod, fromKey\)\.from, fromKey\)/.test(appSource)
);
// ...AND NOTHING IS HIDDEN BY IT: each half says what it holds and offers the rest - the officer's table and the member's
// own history. A smaller window with no way to see further back is a cut, not a budget.
checkIs(
  'and both halves say what they hold and how to go further back',
  /entries back to \{loadedFrom\}/.test(readFileSync('src/components/admin/AdminClockManagementTab.jsx', 'utf8')) &&
    /entries back to \$\{loadedFrom\}/.test(readFileSync('src/components/MyClockHistory.jsx', 'utf8'))
);
// ...AND THE EVENTS LISTENER FOLLOWS THE SCREEN RATHER THAN THE SESSION, which is the one live read that does. The sign-in
// subscription names exactly three handlers - on-duty, announcements and settings - and something on the dashboard draws every
// one of them. Events are watched by an effect that only runs while a calendar screen is open, which is the same "a module's
// resources when the module is accessed" rule applied to a STREAM: a listener nobody reads is the same waste as a read nobody
// reads, and it is the one that is invisible in a document count.
checkIs(
  'the sign-in listener watches three collections, and events is not one of them',
  /onDuty: setOnDutyUsers,\s*\n\s*announcements: setAnnouncements,\s*\n\s*systemSettings: setSystemSettings,/.test(appSource)
);
// Whitespace-TOLERANT on purpose. This said `/const wantsEvents = activeTab === 'schedule' \|\|/`, which is a statement about
// how one line was wrapped: adding the Administration > Member Availability tab made the expression run onto a second
// line, the regex stopped matching, and this failed for a formatting reason while saying something about reads. The claim
// worth making is WHICH SCREENS read the events, so that is what it asserts.
const wantsEventsClause = /const wantsEvents =([\s\S]*?);/.exec(appSource)?.[1] || '';
checkIs(
  'while the calendar screens attach the events one themselves',
  /handlers: \{ events: \(rows\) => setEvents\(normalizeEventList\(rows\)\) \}/.test(appSource) &&
    /activeTab === 'schedule'/.test(wantsEventsClause) &&
    /activeTab === 'availability'/.test(wantsEventsClause) &&
    // The officer's screens count too - the board, and Administration > Member Availability, which draws a member's month
    // grid and so needs the same list. Dropping this one is a regression the other check here will not see.
    /onMemberAvailabilityTab/.test(wantsEventsClause),
  `wantsEvents is: ${wantsEventsClause.replace(/\s+/g, ' ').trim()}`
);

// THE DETAIL THAT DECIDES WHETHER THE LIVE READS COST ANYTHING: the effect is keyed on the member's ID, not on the auth
// token. A token refreshes hourly, and re-attaching on each one would pay a fresh initial snapshot - a read of every document
// the listener matches - for no new data at all. Firestore re-authenticates its own streams when the token changes, so the
// effect has no business watching it.
checkIs(
  'App attaches the live reads for the signed-in member',
  /useEffect\(\(\) => \{[\s\S]{0,1400}?subscribeLive\(\{[\s\S]{0,1400}?\}, \[currentUser\?\.id\]\)/.test(appSource)
);
checkIs('and re-attaches on the member, never on the token', !/\], \[currentUser\?\.id, authToken\]\)/.test(appSource));
const setterBlock = /const ADMIN_SECTION_SETTERS = \{([\s\S]*?)\n  \};/.exec(appSource);
checkIs('App has a setter block for them', Boolean(setterBlock));
// A SETTER IS EITHER A BARE `setFoo` OR A FUNCTION THAT UNWRAPS. `schedule` is the second kind: its section answers
// with the rows AND the window they came in, so a bare setter would put the envelope into the array.
const setters = setterBlock
  ? [...setterBlock[1].matchAll(/\n    ([a-zA-Z]+): (?:set|\(payload\) =>)/g)].map((match) => match[1])
  : [];
check('every section the payload can read has somewhere to land', sectionNames.filter((name) => !setters.includes(name)), []);
check('and App does not hold a section the payload cannot refresh', setters.filter((name) => !sectionNames.includes(name)), []);

// THE BOARD'S TAB HAS TO READ THE SCHEDULE ITSELF, and forgetting to is invisible: the tab also reads the templates, so
// the month still drew - as a month of EMPTY SLOTS that looked exactly like nobody being rostered. It was missing from
// this list, which is why the names were lost. The schedule also has to unwrap its envelope, or the array holds an
// object instead of a month.
const tabSections = /const sectionsForTab = \{([\s\S]*?)\n    \};/.exec(appSource);
checkIs('App has a per-tab section map', Boolean(tabSections));
const sectionListFor = (tab) => {
  // The key may be quoted ('system-log'), because a dash is not a bare object key. Both shapes are accepted.
  const match = tabSections ? new RegExp(`${tab}'?: \\[([^\\]]*)\\]`).exec(tabSections[1]) : null;
  return match ? match[1] : '';
};
const scheduleTabList = tabSections ? /schedule: \[([^\]]*)\]/.exec(tabSections[1]) : null;
checkIs('and the schedule board reads the schedule rows, not just its templates', Boolean(scheduleTabList) && scheduleTabList[1].includes("'schedule'"));
// EVERY TAB THAT NAMES A MEMBER ALSO READS THE DIRECTORY, and this is the same failure as the board's line above,
// one level up: the tab's own rows arrive by a route of their own, so nothing about the screen looks broken when the
// names come out blank - they render as "Unnamed member" and the tab is otherwise complete. The directory is the
// public users collection, which every officer may read; the `users` section joins users_private and is refused to
// anybody without can_edit_users, which is why a tab cannot use it just to label a row.
const NAME_DRAWING_TABS = [
  'schedule', 'assignments', 'clock', 'certifications', 'availability', 'approvals',
  'announcements', 'events', 'training',
  // DOCUMENTS WAS MISSING FROM THIS LIST, and that is why the gap it describes went unnoticed until somebody
  // tried to use the screen: the tab names members in three places - the signature report, the verification
  // panel and the back-fill panel - and the back-fill panel's member list is not a label but its only control.
  // With no directory it renders EMPTY rather than wrong, so the tab looks complete and one dropdown simply has
  // nothing in it. A tab belongs here the moment it renders a member's name, which is the rule this list is.
  'documents',
];
check(
  'every tab that draws member names reads the directory',
  NAME_DRAWING_TABS.filter((tab) => !sectionListFor(tab).includes("'directory'")),
  []
);
// AND A TAB THAT OFFERS SHIFTS HAS TO READ THE SHIFT DEFINITIONS, which is the same class of bug one level down: the
// availability tab's assign menu lists the day's shifts, and a slot cannot be drawn without a template to expand and the
// assignment that names it. It had only the directory - so the menu opened EMPTY on a month that plainly had shifts, and
// nothing about the screen looked broken. The month's ROWS are read by the tab itself instead (its own WINDOWED read,
// asked for once a month when the list opens, so a chip can name who is already rostered), so only the definitions belong
// in this list.
checkIs(
  'the availability tab reads the shift definitions it offers',
  sectionListFor('availability').includes("'scheduleTemplates'") &&
    sectionListFor('availability').includes("'assignments'"),
  sectionListFor('availability')
);
checkIs(
  'and does not pull a whole schedule to show one month of it',
  !sectionListFor('availability').includes("'schedule'"),
  sectionListFor('availability')
);
// THE REFRESH AFTER AN AVAILABILITY SAVE IS BOUNDED BY THE WINDOW ON SCREEN. An unnamed range is the WHOLE
// `availability_months` collection - one document per member per month, which only ever grows - and the tab used to ask for
// exactly that after every save. It already holds the window it is showing (`loadedFrom`/`loadedTo`, the scope the officer
// loaded with onLoadMonth), so that is the range the re-read names: the months a save could have changed.
checkIs(
  'the availability refresh is bounded by the window on screen',
  /onDataChanged\?\.\(token, \{ from: loadedFrom, to: loadedTo \}\)/.test(
    readFileSync('src/components/admin/AdminAvailabilityTab.jsx', 'utf8')
  )
);
checkIs(
  'and its section setter unwraps the rows from the window they came in',
  /schedule: \(payload\) => \{[\s\S]{0,400}?payload\?\.schedule/.test(appSource)
);

const scopedCalls = [...appSource.matchAll(/ADMIN_SECTION_SETTERS\[(\w+)\]/g)].length;
checkIs('the scoped path is wired to those setters', scopedCalls >= 2, `found ${scopedCalls}`);

const tabFiles = readdirSync('src/components/admin').filter((file) => file.endsWith('.jsx'));
const namedScopes = [];
for (const file of tabFiles) {
  const text = readFileSync(`src/components/admin/${file}`, 'utf8');
  for (const match of text.matchAll(/onDataChanged\??\.?\('([a-zA-Z]+)'\)/g)) {
    namedScopes.push({ file, name: match[1] });
  }
}
check('every tab asks for a section that exists', namedScopes.filter((call) => !sectionNames.includes(call.name)), []);
checkIs(
  'and the tabs that do name one are scoped at all',
  namedScopes.length >= 15,
  `only ${namedScopes.length} scoped call sites: ${namedScopes.map((call) => call.file).join(', ')}`
);

console.log('\n--- what a load reads whole ---');
console.log(`  shared wave (both payloads): ${[...new Set(wholeCollectionReads(stationBody))].join(', ')}`);
console.log(`  member payload alone:        ${[...new Set(wholeCollectionReads(memberBody))].join(', ')}`);
console.log(`  admin payload alone:         ${[...new Set(wholeCollectionReads(adminBody))].join(', ')}`);
console.log('  filtered to the caller (per matching row, not per collection): schedule_offers (pending + declined');
console.log('  only - an approved offer filled its shift, so no pill is drawn from it), training_signatures, certifications,');
console.log('  user_settings, settings/public, users/{uid}');
console.log('  read when its own screen opens (NOT at sign-in): the clock history, over a range - it is the one per-member');
console.log('  table with no ceiling (a five-year member has thousands of entries), and the dashboard question it used to');
console.log('  answer at sign-in ("am I clocked in") is answered by the on-duty row, which the clock transaction writes.');
console.log('\n  cost = the documents those collections hold. `schedule` is the one that grows without limit - every shift the');
console.log('  station has ever scheduled - and it is NOT read at sign-in at all: a calendar or the board asks for the month it');
console.log('  is showing (GET_SCHEDULE, windowed by App#loadScheduleWindow), so a sign-in costs the same at three months old as');
console.log('  at thirty. `users` is next: four readers want it, and they share ONE in-flight read (readUsersOnce),');
console.log('  so a wave costs one collection read rather than one per reader. Nothing else is read whole on a repeat any more: the');
console.log('  runner leaderboard - the most repeated screen in the app - used to scan `users` on every play and is a bounded query');
console.log('  now (25 rows plus one count), the watched collections bill per CHANGE rather than per visit - and `events` is not');
console.log('  watched at sign-in at all: its read and its listener follow the calendar screens that draw it. `schedule` is read a');
console.log('  month at a time, and the clock history only when its own screen opens.');

// ---------------------------------------------------------------------------
// THE READERS THAT USED TO SCAN A GROWING COLLECTION.
// ---------------------------------------------------------------------------
// Two append-only collections were read WHOLE to answer a question that needs one number or one member's rows, on a
// screen's own open - so the cost grew with the station's AGE rather than its size:
//
//   * `certifications` - the Roster module counted each member's live certifications by reading every record ever
//     recorded, including departed members'. It now reads only the ACTIVE members' rows, in batches of thirty (the `in`
//     ceiling), which is what readAdminCertificationRecords already did.
//   * `training_signatures` - the Training module counted signatures by scanning the whole collection. The count is now
//     a COUNTER on each training (`signature_count`), kept by a trigger as signatures are added and removed, so the field
//     rides on a row the screen already reads.
//
// This is the shape to DEFEND: a reader that answers a per-member question must NAME the members, and a reader that needs
// a count must read a STORED one - never scan the children.
const functionsSource = readFileSync('functions/index.js', 'utf8');

// 1. The Roster module names the members it reads certifications for.
const rosterBody = (functionsSource.match(/exports\.readRosterModule[\s\S]*?\n\}\);/) || [''])[0];
checkIs('the Roster module was located', rosterBody.length > 0);
checkIs(
  'and reads certifications only for the active members, in batches',
  /collection\('certifications'\)\.where\('user_id', 'in', batch\)/.test(rosterBody)
);
checkIs('never the whole collection', !/db\.collection\('certifications'\)\.get\(\)/.test(rosterBody));
// AND NEVER THE WHOLE ROSTER EITHER, which is what this callable used to read to draw ten names: `users` and
// `users_private` are one document per member, so both halves grew with the station. The page's candidates are read by
// query, their private halves BY DOCUMENT (getAll over the candidates' own refs), and the certification columns by the
// page's ids.
//
// THE QUERIES LIVE IN A `read` THE CALLABLE HANDS TO functions/rosterPage.js, because the read has to look at MORE THAN
// ONE CHUNK to fill a page - a candidate who has left eats the spare - and that loop is a decision, so it belongs where a
// harness can drive it. The two chains are still written out in full below and still bounded by the limit the module
// asks for, which is what these assertions are here to keep true.
checkIs(
  'and it reads a page rather than the roster',
  /namePrefixRange\(search\)/.test(rosterBody) &&
    /scanRosterPage\(\{/.test(rosterBody) &&
    /scanLimit: ROSTER_SCAN_LIMIT/.test(rosterBody) &&
    /roster_page: \{/.test(rosterBody)
);
checkIs(
  'a chunk of candidates is a query bounded by the limit the module asked for',
  /orderBy\('name'\)\.limit\(limit\)/.test(rosterBody) && !/db\.collection\('users'\)\.orderBy\('name'\)\.get\(\)/.test(rosterBody)
);
checkIs(
  'never the whole users or users_private collections',
  !/collection\('users'\)\.get\(\)/.test(rosterBody) && !/collection\('users_private'\)\.get\(\)/.test(rosterBody)
);
checkIs(
  'the private halves by document, for the candidates only',
  /db\.getAll\(\.\.\.chunkRows\.map\(\(candidate\) => db\.collection\('users_private'\)\.doc\(candidate\.id\)\)\)/.test(rosterBody)
);

// 2. The training count is a stored counter, kept by a trigger on both directions.
checkIs(
  'the training count is kept as an incrementing counter, on add and on remove',
  /onDocumentCreated\('training_signatures\/\{signatureId\}'[\s\S]{0,400}?adjustTrainingSignatureCount\(row\.training_id, 1\)/.test(functionsSource) &&
    /onDocumentDeleted\('training_signatures\/\{signatureId\}'[\s\S]{0,400}?adjustTrainingSignatureCount\(row\.training_id, -1\)/.test(functionsSource)
);
checkIs(
  'which is an atomic increment rather than a read-modify-write',
  /update\(\{ signature_count: FieldValue\.increment\(delta\) \}\)/.test(functionsSource)
);
// The count callable no longer scans signatures: it is a compatibility shim that reads the stored field.
checkIs(
  'and the count callable no longer scans the signatures',
  !/collection\('training_signatures'\)\.select\('training_id'\)/.test(functionsSource)
);

// 3. The app's own training reader reads the stored field and does NOT call the callable.
checkIs(
  'the app reads the stored count rather than calling the count callable',
  !/readTrainingSignatureCounts/.test(readFileSync('src/services/firestoreReads.js', 'utf8'))
);

// 4. The client readers name the member rather than reading everyone's rows.
checkIs(
  'GET_CERTIFICATIONS stays scoped to the member',
  /GET_CERTIFICATIONS: async \(uid\) => \{[\s\S]{0,200}?rowsFor\('certifications', 'user_id', uid\)/.test(readsSource)
);
checkIs(
  'and the reader table reads no collection of certifications whole',
  !/rowsOf\(collection\(firestore\(\), 'certifications'\)\)/.test(readsSource)
);

// 5. A push resolves its audience by QUERY, not by scanning the directory.
checkIs(
  'an offer push reads only the approver roles rather than the whole directory',
  /const offerAudience = async[\s\S]{0,2000}?where\('role_id', 'in', batch\)/.test(functionsSource)
);
checkIs(
  'and an announcement push gathers only the accounts its audience names',
  /const accountsForAudience = async[\s\S]{0,2000}?where\('role_id', 'in', batch\)/.test(functionsSource)
);

// 6. The backfill seeds the counter, and its plan is correct.
const backfill = signatureCountPlan(
  [{ training_id: 't1' }, { training_id: 't1' }, { training_id: 't2' }, { training_id: 'gone' }],
  [{ id: 't1', signature_count: 1 }, { id: 't2' }, { id: 't3', signature_count: 5 }]
);
check('the backfill counts signatures per training', backfill.counts, { t1: 2, t2: 1, gone: 1 });
check('writes the count every training should hold, zeros included', backfill.plan, { t1: 2, t2: 1, t3: 0 });
// A MISSING count is a change too: a training signed before the counter existed reads as 0 without it, so the backfill has
// to seed it - and a stored count with no signatures behind it (t3) has to be brought back down.
check('and names every training whose stored count disagrees, a missing one included', backfill.change, ['t1', 't2', 't3']);
check('reporting a signature whose training is gone rather than dropping it', backfill.orphaned, ['gone']);

// ---------------------------------------------------------------------------
// THE COMPOSITE INDEXES ARE EXACTLY THE ONES A QUERY NEEDS.
// ---------------------------------------------------------------------------
// A composite index is required only when a query combines fields in a way single-field indexes cannot serve: an equality
// with a range/orderBy on another field, an `array-contains(-any)`/`in` with another filter, or an orderBy on more than one
// field. Plain equality filters need none (Firestore merges single-field indexes), which is why the board's two-equality
// slot check declares nothing. Every query that DOES need one is listed here with it - and the file is pinned to exactly
// these, because an unused composite is write amplification and storage on every write to its collection. The emulator
// ignores index requirements entirely, so a missing one fails only in production, which is what makes this a harness.
const INDEXES = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')).indexes;
// AND THE ORDER, WHEN THE CALLER NAMES ONE. Comparing field paths alone is how `(user_id, time_in)` passed everything while
// the query that uses it needed ASCENDING and the file declared DESCENDING: the paths match, the index cannot serve the
// scan, and production refuses it. An `arrayConfig` field has no order to compare, so `null` means "whatever is declared".
const hasIndex = (collection, fieldPaths, orders = null) =>
  INDEXES.some(
    (index) =>
      index.collectionGroup === collection &&
      index.fields.length === fieldPaths.length &&
      index.fields.every((field, position) => field.fieldPath === fieldPaths[position]) &&
      (!orders ||
        index.fields.every(
          (field, position) => !orders[position] || (field.order || 'CONTAINS') === orders[position]
        ))
  );

checkIs('schedule by member then date, for the report range', hasIndex('schedule', ['user_id', 'date_from'], [null, 'ASCENDING']));
checkIs('timeclock by member then newest-first, for the clock history', hasIndex('timeclock', ['user_id', 'time_in'], [null, 'DESCENDING']));
checkIs('schedule_offers by member then status, for the member’s offers', hasIndex('schedule_offers', ['user_id', 'status'], [null, 'ASCENDING']));
checkIs('announcements by audience then in-force, for the live bound', hasIndex('announcements', ['audience_keys', 'live_until'], [null, 'ASCENDING']));
checkIs('checklist items by document then audience, for the detail read', hasIndex('document_checklist_items', ['document_id', 'audience_keys'], [null, null]));
// CHAT'S TWO, and both are the FILTER-THEN-ORDER shape the five above do not have: the audience filter matches on many
// values (`array-contains-any`), so Firestore cannot merge single-field indexes, and the second field is what the query
// orders by rather than another filter.
checkIs('rooms by audience then the station\'s own order', hasIndex('chat_conversations', ['audience_keys', 'sort_order'], [null, 'ASCENDING']));
checkIs('and a conversation\'s window by audience then newest-first', hasIndex('messages', ['audience_keys', 'created_at'], [null, 'DESCENDING']));
// AND NOTHING ELSE. Seven, and no index names a field nothing filters - so a re-add is caught rather than quietly paid for.
check('and no more than the seven a query needs', INDEXES.length, 7);
const indexedFields = INDEXES.flatMap((index) => index.fields.map((field) => field.fieldPath));
// ---------------------------------------------------------------------------
// AND EVERY OTHER QUERY IN THE CODEBASE IS SERVED BY ONE OF THE FIVE.
// ---------------------------------------------------------------------------
// The pins above are the queries somebody remembered to write down. This walks the code and finds the rest, because both
// failures this file records arrived the same way: a query nobody re-checked, refused by production while the whole suite
// passed. The emulator answers ANY query, so nothing else here can see it.
//
// The rule implemented is Firestore's, and no more than Firestore's:
//   * equality filters (`==`) alone need NO composite, however many there are - single-field indexes are merged;
//   * add ONE filter that is not a plain `==` - a range, an `orderBy`, an `in`, an `array-contains` - and a composite IS
//     required: the equality fields first, then that field;
//   * and that field's direction is its own `orderBy`, or ASCENDING when the order is implied. GETTING THIS WRONG IS THE
//     FAILURE THIS EXISTS FOR: the Clocked-vs-scheduled report ranged over `time_in` with the order left implied, asked
//     for an ASCENDING scan, and the declared `(user_id ASC, time_in DESC)` index could not serve it.
//
// It reads the two ways queries are written here - the chained admin API on the server, the modular `query(...)` form in
// src/services - and it COUNTS EVERY FILTER CALL IT DID NOT READ, so a query style it cannot parse fails the suite
// instead of passing quietly. That count is the difference between a scanner and a guess.
// The collection a `collection(...)` call names, taken from its LAST argument.
//
// THE LAST ONE, NOT THE FIRST, and chat is why: a subcollection is addressed as a path -
// `collection(db, 'chat_conversations', room, 'messages')` - where the name Firestore would index is the final segment,
// and the earlier ones are parents that carry no filters of their own. Before this the scanner read such a call as
// nameless, which is the safe direction (it reported the query as unserved rather than silently passing it) but also a
// false alarm the moment a module used a subcollection.
//
// A name that is a variable is returned as that variable: firestorePayload's audience helpers take a collection as a
// parameter, and its filters still have to be read.
const collectionNameIn = (callText) => {
  const literal = /'([A-Za-z_]+)'\s*\)\s*$/.exec(callText);
  if (literal) return literal[1];
  const variable = /([A-Za-z_$][\w$]*)\s*\)\s*$/.exec(callText);
  return variable ? variable[1] : '';
};

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\w/])\/\/[^\n]*/g, '$1');
// A filter call, chained (`.where(...)`) or modular (`where(...)`), which is the whole difference between the two APIs.
// For `where` the last captured group is the OPERATOR; for `orderBy` it is the DIRECTION, and both travel together in `op`.
const FILTER_CALL = /(?:\.|\b)(where|orderBy)\(\s*'([A-Za-z_]+)'\s*(?:,\s*'([^']+)')?/g;
const filterCallsIn = (text) => {
  const calls = [];
  FILTER_CALL.lastIndex = 0;
  let match;
  while ((match = FILTER_CALL.exec(text))) {
    calls.push({
      at: match.index,
      kind: match[1],
      field: match[2],
      op: match[1] === 'where' ? match[3] : /desc/i.test(match[3] || '') ? 'DESCENDING' : 'ASCENDING'
    });
  }
  return calls;
};
// The text inside the parentheses opening at `openIndex`, and where that call ends, so a `where(...)` can be stepped over
// whole rather than guessed at from its first argument.
const balancedFrom = (source, openIndex) => {
  let depth = 0;
  for (let position = openIndex; position < source.length; position += 1) {
    if (source[position] === '(') depth += 1;
    else if (source[position] === ')') {
      depth -= 1;
      if (depth === 0) return { text: source.slice(openIndex + 1, position), end: position };
    }
  }
  return { text: '', end: source.length };
};

const QUERY_FILES = [
  'functions/index.js',
  ...readdirSync('src/services')
    .filter((name) => name.endsWith('.js') && !name.includes('.test.'))
    .map((name) => `src/services/${name}`),
];
const scanned = [];
const unread = [];
for (const file of QUERY_FILES) {
  const source = stripComments(readFileSync(file, 'utf8'));
  const claimed = new Set();
  // A QUERY IS A COLLECTION CALL PLUS THE FILTERS THAT FOLLOW IT, written either way: chained (`.where(...)`, the admin API
  // the Cloud Functions use) or as arguments (`query(collection(db, 'x'), where(...), orderBy(...))`, the modular form the
  // client uses). Read together, one rule covers both - and it does not matter whether the call sits in an assignment, in a
  // `Promise.all` array, or behind a `return`, which is where the first version of this missed half the queries.
  const assignments = [...source.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)].map((found) => ({
    name: found[1],
    at: found.index
  }));
  // A `query(...)` CALL IS READ WHOLE, filters and all, because its filters are a LIST rather than a chain: they can be
  // spread out of a condition - `...(managesAll ? [] : [where('user_id', '==', uid)])` on the Clock History read - which no
  // character-by-character walk can follow, and the collection itself is only one of the arguments.
  const modularSpans = [];
  const modular = /\bquery\(/g;
  let match;
  while ((match = modular.exec(source))) {
    const args = balancedFrom(source, match.index + match[0].length - 1);
    // THE COLLECTION CALL IS READ WITH THE SAME BALANCE RULE AS EVERYTHING ELSE, because its own arguments contain
    // parentheses: `collection(firestore(), 'schedule_offers')` is what half this codebase writes, and a `[^()]*`
    // shortcut reads that as no collection at all - which reports a codebase full of served queries as unserved.
    const callAt = args.text.search(/collection(?:Group)?\(/);
    const name =
      callAt === -1
        ? ''
        : collectionNameIn(
            args.text.slice(callAt, balancedFrom(args.text, callAt + args.text.slice(callAt).indexOf('(')).end + 1)
          );
    const filters = filterCallsIn(args.text);
    filters.forEach((call) => claimed.add(match.index + match[0].length + call.at));
    modularSpans.push({ start: match.index, end: args.end, filters });
    scanned.push({ file, collection: name, at: match.index, name: '', filters });
  }
  // A `collectionGroup` QUERY IS A COLLECTION QUERY HERE: it is the same indexing question, and the name that matters is
  // the group - which is how the chat fan-out's cleanup finds every member's inbox row for a deleted room.
  const collections = /collection(?:Group)?\(/g;
  while ((match = collections.exec(source))) {
    // one already read above as part of a `query(...)`, so walking it again would only add a half-read copy of it
    if (modularSpans.some((span) => match.index > span.start && match.index < span.end)) continue;
    // The call's OWN end, so a nested `firestore()` in its arguments is stepped over rather than ending it early.
    const call = balancedFrom(source, match.index + match[0].length - 1);
    const filters = [];
    let cursor = call.end + 1;
    for (;;) {
      // STEP OVER WHATEVER SEPARATES THE FILTERS - a `.`, a `,`, and any whitespace or comments between them, which is
      // wider than it looks: a chain broken by a three-line comment leaves thirty characters of whitespace to cross. `;`
      // is deliberately NOT skipped, because it ends a statement and the next query's first filter is not this query's.
      const separator = /^[\s.,\])}{]*/.exec(source.slice(cursor, cursor + 96))[0];
      const start = cursor + separator.length;
      const head = /^(where|orderBy)\(/.exec(source.slice(start, start + 9));
      if (!head) break;
      const args = balancedFrom(source, start + head[0].length - 1);
      const call = filterCallsIn(source.slice(start, args.end + 1));
      if (call.length !== 1) break;
      filters.push(call[0]);
      // CLAIM THE POSITION THE WHOLE-FILE SCAN BELOW WILL REPORT, which begins one character earlier for a chained call:
      // the `.` in `.where(` is part of that match, and it was consumed here as the separator.
      claimed.add((source[start - 1] === '.' ? start - 1 : start) + call[0].at);
      cursor = args.end + 1;
    }
    // THE NAME THE QUERY IS BOUND TO, so the scope filter below can find it: the nearest assignment before it, which makes a
    // chain built inside `const clockRead = ... (ids) => { const base = db.collection(...) }` known as `base` - the name that
    // continuation actually uses. A collection named by a variable (firestorePayload's audience helpers take the collection
    // as a parameter) is recorded as that variable, so its filters are still read and its shape still judged.
    const owner = assignments.filter((entry) => entry.at < match.index).pop();
    scanned.push({ file, collection: collectionNameIn(source.slice(match.index, call.end + 1)), at: match.index, name: owner ? owner.name : '', filters });
  }
  // THE TWO CONTINUATION SHAPES THIS CODEBASE USES, and both are load-bearing: a scope filter is added to a read that a
  // member and an officer share, either as `ids ? base.where('user_id', 'in', ids) : base` or by reassigning -
  // `if (report.scope === 'mine') source = source.where('user_id', '==', caller.uid)`. It belongs to the nearest PRECEDING
  // query bound to that name, because `base` names two different collections in runReport and attaching a filter to the
  // wrong one is how a scanner reports a confident wrong answer.
  const continuation = /([A-Za-z_$][\w$]*)\s*\.where\(\s*'user_id'\s*,\s*'(in|==)'/g;
  while ((match = continuation.exec(source))) {
    claimed.add(match.index + match[0].indexOf('.where'));
    const owner = scanned
      .filter((query) => query.file === file && query.name === match[1] && query.at < match.index)
      .pop();
    if (!owner) unread.push(`${file}: ${match[0]}`);
    else owner.filters.push({ kind: 'where', field: 'user_id', op: match[2] });
  }
  // Anything the scan did not read is REPORTED, never ignored: a filter this parser cannot see is a query whose index
  // requirement nobody is checking, and passing quietly is the failure mode this whole section exists to prevent.
  for (const call of filterCallsIn(source)) {
    if (!claimed.has(call.at)) unread.push(`${file}: ${source.slice(call.at, call.at + 48).split('\n')[0]}`);
  }
}

// The index Firestore would require to serve a query - or null, when single-field indexes can.
//
// PLACEMENT IS THE PART THAT IS EASY TO GET WRONG: `in` and `array-contains` count as equalities for the ORDER of the index
// (they ask for a set of values on one field), so they go before the range, and `time_in` before `user_id` is not the same
// index as `user_id` before `time_in`.
const EQUALITY_ORDERED = new Set(['==', 'in', 'array-contains', 'array-contains-any']);
const requiredFor = (query) => {
  const filters = query.filters;
  // equalities alone need nothing at all: Firestore merges single-field indexes to serve them
  if (!filters.some((filter) => filter.kind === 'orderBy' || filter.op !== '==')) return null;
  const first = [];
  const last = [];
  for (const filter of filters) {
    if (filter.kind === 'where' && EQUALITY_ORDERED.has(filter.op)) first.push(filter.field);
    else if (!last.includes(filter.field)) last.push(filter.field);
  }
  const fields = [...new Set(first), ...last];
  if (fields.length < 2) return null;
  const final = fields[fields.length - 1];
  const ordered = [...filters].reverse().find((filter) => filter.field === final && filter.kind === 'orderBy');
  return { fields, direction: ordered ? ordered.op : 'ASCENDING' };
};
const servedBy = (query, required) =>
  INDEXES.some(
    (index) =>
      index.collectionGroup === query.collection &&
      index.fields.length === required.fields.length &&
      index.fields.every((field, position) => field.fieldPath === required.fields[position]) &&
      // an `arrayConfig` field carries no order at all, so there is nothing for a direction to disagree with
      (!index.fields[index.fields.length - 1].order ||
        index.fields[index.fields.length - 1].order === required.direction)
  );
const needing = scanned.map((query) => ({ query, required: requiredFor(query) })).filter((entry) => entry.required);
// `check`, not `checkIs`, and the difference is the whole point: `checkIs` takes a CONDITION, and an array passed to it is
// truthy whether it is empty or not - so a check written that way reports ok forever. This one compares, and prints the
// queries it could not serve.
check(
  'every query that needs a composite index has one that can serve it, order included',
  needing
    .filter(({ query, required }) => !servedBy(query, required))
    .map(({ query, required }) => `${query.file} ${query.collection} (${required.fields.join(', ')}) ${required.direction}`),
  []
);
check(
  'and every filter call in the codebase was read, so an unknown query shape cannot slip past',
  unread,
  []
);
// AND THE SCANNER IS LOOKING AT SOMETHING. A parser that stopped finding queries would satisfy both checks above by finding
// nothing at all, which is the quietest possible way for this to stop protecting anything.
check('and the scan found queries that need an index at all', needing.length >= 2, true);

check(
  'and no index names a field no query ever filters',
  // `created_at` was on this list until chat arrived: nothing ordered by it, so an index naming it was an index nobody was
  // paying for. A conversation's window orders by it (newest first), which is exactly the change this list is for - a
  // field stops being wasted the moment a query asks for it, and the list is where that is recorded.
  ['is_open', 'audience_roles', 'date_to', 'signed_at', 'end_date'].filter((field) => indexedFields.includes(field)),
  []
);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
