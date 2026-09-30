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

// 1. The member payload reads none of the SHARED collections itself. It does read a few of its own - `on_duty`,
// `certification_setup`, `trainings` and `certification_badges` are member-payload business and are all bounded by the
// station's size rather than by history - so the rule is about the shared ones, which is where the duplication was.
check(
  'the member payload re-reads no shared collection',
  wholeCollectionReads(memberBody).filter((name) => wholeCollectionReads(stationBody).includes(name)),
  []
);
checkIs(
  'it takes what the caller already read instead',
  /stationRows \|\| \(await readStationRows\(db, scheduleWindow\)\)/.test(memberBody)
);
// The window is the whole point of that parameter: `schedule` is the only collection here that grows without limit, so it
// is the only one read as a range - and a future edit that quietly turns it back into a whole-collection read would
// otherwise be invisible until somebody's bill arrived.
checkIs(
  'and the one unbounded collection is read as a window',
  /rowsInRange\('schedule', 'date_from', scheduleWindow\.from, scheduleWindow\.to\)/.test(stationBody)
);
check(
  'with every other collection still read whole',
  wholeCollectionReads(stationBody).sort(),
  ['assignments', 'ranks', 'roles', 'schedule_templates', 'shifts']
);
// `users` is now the one collection read through a SHARED in-flight read rather than directly, and the projection is the
// point: four readers read this collection - the station wave, the on-duty join, the notifications tab and the
// users directory - and Firestore bills per DOCUMENT, so each of them reading it whole was
// forty members read six times over.
checkIs(
  'and `users` is read through the shared read instead',
  /readUsersOnce\(\)/.test(stationBody) && !wholeCollectionReads(stationBody).includes('users')
);

// ...and the same invariant across the refresh readers, which is where most of those four live.
const readsSource = readFileSync('src/services/firestoreReads.js', 'utf8');
check(
  'the users collection is read in exactly one place in the whole app',
  [...`${source}\n${readsSource}`.matchAll(/rowsOf\(collection\((?:db|firestore\(\)), 'users'\)/g)].length,
  1
);
check('which the payload projects off in three places', [...source.matchAll(/readUsersOnce\(\)/g)].length, 3);
// Two, down from three: the roster projection used to be one of them, and retired with its `GET_ROSTER` action (nothing asked
// for it - the payload projects the roster off its own `users` read). The runner leaderboard left the same way, for a query.
check('and the refresh readers in two', [...readsSource.matchAll(/readUsersOnce\(\)/g)].length, 2);
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
checkIs('the section readers were found', sectionNames.length >= 8, `only found ${sectionNames.join(', ')}`);

const appSource = readFileSync('src/App.jsx', 'utf8');

// THE DETAIL THAT DECIDES WHETHER THE LIVE READS COST ANYTHING: the effect is keyed on the member's ID, not on the auth
// token. A token refreshes hourly, and re-attaching on each one would pay a fresh initial snapshot - a read of every document
// the listener matches - for no new data at all. Firestore re-authenticates its own streams when the token changes, so the
// effect has no business watching it.
checkIs(
  'App attaches the live reads for the signed-in member',
  /useEffect\(\(\) => \{[\s\S]{0,1400}?subscribeLive\(\{[\s\S]{0,1400}?\}, \[currentUser\?\.id\]\)/.test(appSource)
);
checkIs('and re-attaches on the member, never on the token', !/\], \[currentUser\?\.id, authToken\]\)/.test(appSource));
const setterBlock = /const ADMIN_SECTION_SETTERS = \{([\s\S]*?)\};/.exec(appSource);
checkIs('App has a setter block for them', Boolean(setterBlock));
const setters = setterBlock ? [...setterBlock[1].matchAll(/\n    ([a-zA-Z]+): set/g)].map((match) => match[1]) : [];
check('every section the payload can read has somewhere to land', sectionNames.filter((name) => !setters.includes(name)), []);
check('and App does not hold a section the payload cannot refresh', setters.filter((name) => !sectionNames.includes(name)), []);

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
console.log('  filtered to the caller (per matching row, not per collection): availability, timeclock, schedule_offers,');
console.log('  training_signatures, certifications, user_settings, settings/public, users/{uid}');
console.log('\n  cost = the documents those collections hold. `schedule` is the one that grows without limit - it holds every');
console.log('  shift the station has ever scheduled - so it is the read worth watching, and it is WINDOWED to three months');
console.log('  (utils/scheduleWindow). `users` is next: four readers want it, and they share ONE in-flight read (readUsersOnce),');
console.log('  so a wave costs one collection read rather than one per reader. Nothing else is read whole on a repeat any more: the');
console.log('  runner leaderboard - the most repeated screen in the app - used to scan `users` on every play and is a bounded query');
console.log('  now (25 rows plus one count), the four watched collections bill per CHANGE, and `schedule` is a three-month window.');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
