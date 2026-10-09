// Verifies PRESENCE AND TYPING: who counts as online, who counts as typing, when a member announces themselves, and when a
// stamp stops being believed.
//
// WHY THIS FILE EXISTS. Presence is the one feature in the app whose failure mode is a plausible-looking screen. A green dot
// that is wrong does not throw, does not log and does not look broken - it looks exactly like a green dot that is right, and
// somebody drives to the station believing a colleague is there. Every case below is a way that dot could lie:
//
//   * the phone that lost signal, whose node is still in the tree (a stamp, expired);
//   * the tab that was killed, whose node was never removed (the same, plus the disconnect handler services/realtime.js
//     registers - which is why the age window AND the removal are both built, rather than one of them);
//   * a stamp from the future, from a client clock that disagrees with the server's;
//   * a node holding something that is not a stamp at all;
//   * and the typing indicator that outlives the sentence, or reports the member reading it.
//
// WHAT IS NOT HERE: the socket, the connection and the writes. Those are services/realtime.js, and this suite runs no
// emulator. What may be WRITTEN where is a rules question, and the only honest way to ask it is against the real thing -
// see scripts/verify-presence-rules.mjs.
//
// Run with: npm run verify:presence
import { readFileSync } from 'node:fs';
import {
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_STALE_MS,
  TYPING_STALE_MS,
  TYPING_THROTTLE_MS,
  isPresent,
  onlineCountOf,
  onlineIds,
  presenceDue,
  stampMillis,
  typingActionFor,
  typingExpiresIn,
  typingIdsIn,
  typingLabelFor,
} from '../src/utils/presence.js';

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

const NOW = 1_800_000_000_000; // a fixed moment, so nothing below depends on when it runs
const ago = (ms) => NOW - ms;

// ---------------------------------------------------------------------------------------------------
console.log('\n--- the numbers themselves ---');
// THE WINDOW MUST BE LONGER THAN THE HEARTBEAT, and comfortably: a heartbeat slower than the window has every member
// flickering offline between their own updates, which is the classic way this feature gets built wrong.
checkIs(
  'the window is long enough for a heartbeat to be missed',
  PRESENCE_STALE_MS >= PRESENCE_HEARTBEAT_MS * 2,
  `${PRESENCE_STALE_MS} vs ${PRESENCE_HEARTBEAT_MS}`
);
checkIs('typing expires far sooner than presence', TYPING_STALE_MS < PRESENCE_STALE_MS / 10);
checkIs('and the throttle is shorter than the typing window', TYPING_THROTTLE_MS < TYPING_STALE_MS);

// ---------------------------------------------------------------------------------------------------
console.log('\n--- a stamp, and whether it is still good ---');
check('a stamp just written', isPresent({ at: ago(0), now: NOW }), true);
check('a stamp a minute old', isPresent({ at: ago(60_000), now: NOW }), true);
check('a stamp older than the window', isPresent({ at: ago(PRESENCE_STALE_MS + 1), now: NOW }), false);
check('a stamp exactly at the edge still counts', isPresent({ at: ago(PRESENCE_STALE_MS), now: NOW }), true);
// A CLOCK THAT DISAGREES. Two seconds ahead is kept, and an hour ahead is not - the first is two computers arguing, the
// second is a broken client claiming to have been here later.
check('a stamp slightly in the future is kept', isPresent({ at: NOW + 2000, now: NOW }), true);
check('a stamp wildly in the future is not', isPresent({ at: NOW + 60 * 60 * 1000, now: NOW }), false);
// NOTHING THAT IS NOT A STAMP COUNTS AS ONE. A rule on the database pins what may be STORED (see database.rules.json) and
// this pins what is BELIEVED, which is the half that survives a hand-written client.
check('null is not a stamp', stampMillis(null), 0);
check('a string that is not a number is not a stamp', stampMillis('later'), 0);
check('zero is not a stamp', stampMillis(0), 0);
check('a negative number is not a stamp', stampMillis(-1), 0);
check(
  'and none of them is present',
  [isPresent({ at: null, now: NOW }), isPresent({ at: 'soon', now: NOW }), isPresent({ at: 0, now: NOW })],
  [false, false, false]
);
// A NUMBER THAT ARRIVED AS A STRING is still a number: Realtime Database hands back JSON, and a stamp that has been through
// a string is not a different fact.
check('a numeric string is a stamp', stampMillis(String(ago(1000))), ago(1000));

console.log('\n--- who is online ---');
const tree = { ana: { at: ago(10_000) }, ben: { at: ago(10_000) }, cass: { at: ago(PRESENCE_STALE_MS + 5_000) }, dee: null };
check('a stale stamp is not online', onlineIds({ presence: tree, now: NOW }), ['ana', 'ben']);
check('an empty node is not online', onlineIds({ presence: { dee: {} }, now: NOW }), []);
check('and neither is the member asking', onlineIds({ presence: tree, now: NOW, viewerId: 'ana' }), ['ben']);
check('an empty tree has nobody online', onlineIds({ presence: {}, now: NOW }), []);
check('and no tree at all is not an error', onlineIds({ now: NOW }), []);
check('a count of the members of a conversation', onlineCountOf({ ids: ['ana', 'ben', 'cass'], presence: tree, now: NOW }), 2);
check('a count of nobody in it', onlineCountOf({ ids: ['cass'], presence: tree, now: NOW }), 0);
// A STATION ROOM'S AUDIENCE IS A ROLE, NOT A LIST OF PEOPLE, so a room has no ids to count - and asking is not an error.
check('and a conversation with no member list counts nobody', onlineCountOf({ presence: tree, now: NOW }), 0);

console.log('\n--- who is typing ---');
const typing = { ana: { at: ago(1000) }, ben: { at: ago(TYPING_STALE_MS + 1) }, cass: { at: NOW + 500 } };
check('recent stamps only', typingIdsIn({ typing, now: NOW }), ['ana', 'cass']);
check('and never yourself', typingIdsIn({ typing, now: NOW, viewerId: 'ana' }), ['cass']);
check('nobody typing is an empty answer', typingIdsIn({ typing: {}, now: NOW }), []);
check('one name', typingLabelFor({ names: ['Ana'] }), 'Ana is typing…');
check('two names', typingLabelFor({ names: ['Ana', 'Ben'] }), 'Ana and Ben are typing…');
check('and three is a number rather than a list', typingLabelFor({ names: ['Ana', 'Ben', 'Cass'] }), '3 people are typing…');
check('nobody typing says nothing at all', typingLabelFor({ names: [] }), '');
check('and a nameless member does not become an empty sentence', typingLabelFor({ names: ['', '  '] }), '');
// WHEN THE INDICATOR ON SCREEN STOPS BEING TRUE: nothing fires an event for a stamp ageing out, so the screen sets one timer
// for this moment rather than polling every second.
check('the shortest-lived stamp decides when to re-check', typingExpiresIn({ typing, now: NOW }), TYPING_STALE_MS - 1000);
check('nobody typing means no timer', typingExpiresIn({ typing: {}, now: NOW }), 0);
check(
  'and a stamp already gone is not negative',
  typingExpiresIn({ typing: { ana: { at: ago(TYPING_STALE_MS + 1) } }, now: NOW }),
  0
);

// ---------------------------------------------------------------------------------------------------
console.log('\n--- the throttling, which is what keeps this affordable ---');
// ANNOUNCE ONCE, THEN ONCE EVERY FEW SECONDS, AND TAKE IT BACK WHEN THE BOX EMPTIES. Every keystroke writing a stamp is a
// write per letter, which is the cost this feature would otherwise carry.
check('the first keystroke announces', typingActionFor({ draft: 'h', lastSentAt: 0, now: NOW }), 'announce');
check('the next one does not', typingActionFor({ draft: 'he', lastSentAt: NOW - 500, now: NOW }), '');
check('and once the throttle has passed it does', typingActionFor({ draft: 'hel', lastSentAt: NOW - TYPING_THROTTLE_MS, now: NOW }), 'announce');
check('an empty box takes it back', typingActionFor({ draft: '', lastSentAt: NOW - 1000, now: NOW }), 'clear');
check('whitespace is an empty box', typingActionFor({ draft: '   ', lastSentAt: NOW - 1000, now: NOW }), 'clear');
// AND AN EMPTY BOX THAT WAS NEVER ANNOUNCED COSTS NOTHING: the composer clears its draft after every send, and a write to
// retract something that was never said is a write per message for nobody.
check('and an empty box that said nothing writes nothing', typingActionFor({ draft: '', lastSentAt: 0, now: NOW }), '');

console.log('\n--- the heartbeat ---');
check('with no stamp at all, publish', presenceDue({ at: 0, now: NOW }), true);
check('straight after publishing, do not', presenceDue({ at: NOW - 1000, now: NOW }), false);
check('after the interval, publish again', presenceDue({ at: NOW - PRESENCE_HEARTBEAT_MS, now: NOW }), true);
// A STAMP IN THE FUTURE DOES NOT WEDGE THE HEARTBEAT: it is still ahead of the interval, so nothing is due, and the moment
// the clock catches up the scheduled check publishes again. Without this, a client two minutes fast would never beat again.
check('and a stamp from the future is simply not due yet', presenceDue({ at: NOW + 120_000, now: NOW }), false);

// ---------------------------------------------------------------------------------------------------
console.log('\n--- the database rules, as text ---');
// A RULE FILE NOBODY CHECKS IS A RULE FILE THAT DRIFTS. The database is the one part of the app whose rules CANNOT consult
// Firestore for a permission (see the note at the top of database.rules.json), so what it can promise is small - and it is
// asserted here so that "small" never quietly becomes "open". scripts/verify-presence-rules.mjs goes further and runs these
// against the emulator, as real members; this half catches the edit that opens the tree before anybody runs that.
const rules = JSON.parse(readFileSync('database.rules.json', 'utf8')).rules;
checkIs('the tree is closed by default', rules['.read'] === false && rules['.write'] === false);
checkIs('presence is readable by a signed-in member', rules.presence['.read'] === 'auth != null');
checkIs('and writable only on your own node', rules.presence.$uid['.write'] === 'auth != null && auth.uid === $uid');
checkIs(
  'typing is the same shape, under a conversation',
  rules.typing.$uid === undefined && rules.typing.$conversationId.$uid['.write'] === 'auth != null && auth.uid === $uid'
);
// THE NODE HOLDS A TIMESTAMP AND NOTHING ELSE, and a DELETION is allowed - because the write that matters most is the one
// the disconnect handler makes when a tab closes, and a validation rule that demanded a stamp would refuse exactly that.
checkIs(
  'a presence node may only hold a timestamp',
  /hasChildren\(\['at'\]\)/.test(rules.presence.$uid['.validate']) &&
    /newData.child\('at'\).isNumber\(\)/.test(rules.presence.$uid['.validate'])
);
checkIs('and removing it is always allowed', /!newData.exists\(\) \|\|/.test(rules.presence.$uid['.validate']));
checkIs('the same for typing', /!newData.exists\(\) \|\|/.test(rules.typing.$conversationId.$uid['.validate']));

// AND THE CONFIG THAT MAKES ANY OF IT DEPLOYABLE: rules with no `database` block in firebase.json are rules that are never
// uploaded - a failure with no symptom at all until the first write is refused in production.
const firebaseConfig = JSON.parse(readFileSync('firebase.json', 'utf8'));
checkIs(
  'the rules are wired into firebase.json',
  Boolean(firebaseConfig.database) && firebaseConfig.database.rules === 'database.rules.json'
);
checkIs(
  'and the emulator has a port, so the rules can be tested',
  Boolean(firebaseConfig.emulators && firebaseConfig.emulators.database && firebaseConfig.emulators.database.port)
);

// ---------------------------------------------------------------------------------------------------
console.log('\n--- the wiring: the socket, the host and the panel ---');
// THE SERVICE AND ITS GUARANTEES, asserted as source because the alternative is an emulator run for every one of them (see
// verify-presence-rules for the rules half). Three claims here are load-bearing rather than cosmetic:
//
//   * ARM THE DISCONNECT BEFORE THE WRITE. A tab that dies between the two leaves a stamp on the server nothing will ever
//     remove - the stale green dot this whole design exists to prevent.
//   * A BUILD WITH NO DATABASE IS A NO-OP, NOT A CRASH. Chat must lose a dot and nothing else.
//   * PRESENCE MAKES NO NOISE. Chat's sounds are about messages and about people JOINING a conversation, not about somebody
//     opening a tab - a station where a tone plays every time a colleague looks at their phone is a station that turns the
//     sound off.
const realtimeSource = readFileSync('src/services/realtime.js', 'utf8');
const hostSource = readFileSync('src/components/Chat/ChatHost.jsx', 'utf8');
const panelSource = readFileSync('src/components/Chat/ChatPanel.jsx', 'utf8');
const firebaseSource = readFileSync('src/services/firebase.js', 'utf8');
const envExample = readFileSync('.env.example', 'utf8');

for (const name of ['subscribePresence', 'subscribeTyping', 'publishPresence', 'clearPresence', 'startPresenceHeartbeat', 'publishTyping', 'clearTyping']) {
  checkIs(`the ${name} function is exported`, new RegExp(`export const ${name} =`).test(realtimeSource));
}
checkIs('the disconnect is armed BEFORE every write', /onDisconnect\(node\)\.remove\(\);\s*await set\(node/.test(realtimeSource));
checkIs('and it is armed in both publishes', (realtimeSource.match(/onDisconnect\(node\)\.remove\(\)/g) || []).length === 2);
checkIs('every function checks the database is configured first', (realtimeSource.match(/realtimeConfigured\(\)/g) || []).length >= 7);
checkIs('and every subscriber returns an unsubscribe even when it does nothing', /realtimeConfigured\(\)\) return \(\) => \{\};/.test(realtimeSource));
// THE PATHS ARE THE CONTRACT WITH THE RULES FILE, which is written against exactly these strings.
checkIs('the presence path is the one the rules allow', /`presence\/\$\{String\(uid \|\| ''\)\}`/.test(realtimeSource));
checkIs('and so is the typing path', /`typing\/\$\{String\(conversationId \|\| ''\)\}`/.test(realtimeSource));
checkIs('the database is configured from the environment, with an emulator branch', /VITE_FIREBASE_DATABASE_URL/.test(firebaseSource) && /connectDatabaseEmulator\(/.test(firebaseSource) && /connectDatabaseEmulator\(databaseInstance, '127\.0\.0\.1', 9000\)/.test(firebaseSource));
checkIs('and the environment sample says where the value comes from', /VITE_FIREBASE_DATABASE_URL=/.test(envExample));
checkIs('and says that leaving it empty is supported', /Leaving it empty is a supported state/.test(envExample));

checkIs('the host publishes its own presence', /startPresenceHeartbeat\(\{ uid: userId \}\)/.test(hostSource));
checkIs('and watches everybody else\'s', /subscribePresence\(\{ onChange: setPresence \}\)/.test(hostSource));
checkIs('and listens to typing for the open conversation only', /subscribeTyping\(\{ conversationId: activeRoomId, onChange: setTyping \}\)/.test(hostSource));
checkIs('and publishes typing through the throttling decision', /typingActionFor\(\{ draft, lastSentAt: typingRef\.current \}\)/.test(hostSource));
// THE STALENESS CLOCK. A stamp expires on its own and nothing fires an event to say so, so the panel is re-rendered on a
// slow timer for presence and at exactly the moment the last typing stamp dies.
checkIs('the host re-renders when stamps age out', /setInterval\(\(\) => setNowMs\(Date\.now\(\)\)/.test(hostSource) && /typingExpiresIn\(\{ typing, now: Date\.now\(\), viewerId: userId \}\)/.test(hostSource));

checkIs('the panel says who is online', /onlineCountOf\(\{ ids: activeMembers, presence, now \}\)/.test(panelSource));
checkIs('and who is typing, above the composer', /typingIdsIn\(\{ typing, now, viewerId: mine \}\)/.test(panelSource) && /aria-live="polite"/.test(panelSource));
checkIs('and the picker shows a dot per member', /isPresent\(\{ at: presence\[person\.id\]/.test(panelSource) && /presence=\{presence\}/.test(panelSource));
// NO SOUND ANYWHERE IN THIS FEATURE, asserted rather than intended: an online dot that made a noise would be the first
// thing anybody asked to turn off.
checkIs('presence and typing are silent', !/sounds?/i.test(realtimeSource) || !/playSound/.test(realtimeSource));
checkIs('and the pure module imports no sound rules', !/from '\.\/soundRules'|from '\.\/chatSounds'|from '\.\/uiSounds'/.test(readFileSync('src/utils/presence.js', 'utf8')));

console.log(`\n${failures ? `${failures} CHECK(S) FAILED` : 'ALL CHECKS PASSED'}\n`);
process.exit(failures ? 1 : 0);