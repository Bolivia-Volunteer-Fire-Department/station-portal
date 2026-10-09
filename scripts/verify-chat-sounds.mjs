// Verifies CHAT'S SIX SOUNDS: which moment plays which one, when it plays none, and that all six are real files wired into
// the app's one sound engine.
//
// WHY THIS IS ITS OWN FILE. The sounds are the easiest part of chat to get subtly wrong, because every mistake sounds like
// nothing: a tone that never fires, a tone that fires twice for one message, a room that was muted still ringing, your own
// sentence ringing back at you a moment after you sent it. None of that shows up in a screenshot and none of it throws.
//
// So the decisions live in utils/chatSounds.js (pure, no Audio, no React) and are asked directly here, and the wiring -
// which call site plays which decision - is asserted against the source, because that is where a decision goes to die.
//
// Run with: npm run verify:chat-sounds
import { readFileSync, statSync } from 'node:fs';
import { CHAT_SOUNDS, chatBadgeSound, chatMessageSound, chatNavigationSound, chatParticipantSound } from '../src/utils/chatSounds.js';
import { REQUIRED_SOUNDS, SOUND_VOLUME } from '../src/utils/soundRules.js';

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

const source = (path) => readFileSync(path, 'utf8');
const host = source('src/components/Chat/ChatHost.jsx');
const panel = source('src/components/Chat/ChatPanel.jsx');
const engine = source('src/utils/uiSounds.js');

// ---------------------------------------------------------------------------------------------------
console.log('\n--- the six files, and the contract they are part of ---');
const SIX = ['chat_open', 'chat_close', 'chat_enter', 'chat_exit', 'chat_notify', 'chat_send'];
check('the six are in the sound contract', SIX.filter((name) => REQUIRED_SOUNDS.includes(name)), SIX);
check('and the decisions name exactly those six', Object.values(CHAT_SOUNDS).sort(), [...SIX].sort());
for (const name of SIX) {
  // A FILE THAT IS ACTUALLY THERE. The engine imports each one, so a rename breaks the build - but a zero-byte placeholder
  // would build happily and play silence, and that is the failure worth catching here.
  const path = `src/assets/${name}.mp3`;
  const size = (() => {
    try {
      return statSync(path).size;
    } catch {
      return 0;
    }
  })();
  checkIs(`${name}.mp3 is a real file, not an empty placeholder`, size > 1024, `${size} bytes`);
  checkIs(`and the engine knows it`, new RegExp(`\\b${name}: `).test(engine));
}
// CHAT'S SOUNDS LIVE WITH THE APP'S, unlike the Firefighter Runner's, which keeps its own folder and its own volume. That
// is what puts them in the fetch-once engine, on the Debug page's mix sliders and under the member's sound switch.
checkIs('the chat folder holds no audio of its own', !/\.mp3/.test(host) && !/\.mp3/.test(panel));
// THE MIX, as a decision rather than a number: the one sound that means "somebody wants you" is the loudest of the six.
check(
  'the notification is the loudest of the six',
  SIX.reduce((loudest, name) => Math.max(loudest, SOUND_VOLUME[name] ?? SOUND_VOLUME.default), 0),
  SOUND_VOLUME.chat_notify
);
checkIs('and the busiest one is the quietest', (SOUND_VOLUME.chat_send ?? SOUND_VOLUME.default) < SOUND_VOLUME.chat_notify);

// ---------------------------------------------------------------------------------------------------
console.log('\n--- opening, closing, and moving between conversations ---');
check('opening one', chatNavigationSound({ from: '', to: 'general' }), 'chat_open');
check('moving to another is an arrival, not a close and an open', chatNavigationSound({ from: 'general', to: 'officers' }), 'chat_open');
check('closing one', chatNavigationSound({ from: 'general', to: '' }), 'chat_close');
check('and nothing moved is nothing played', chatNavigationSound({ from: 'general', to: 'general' }), '');
check('a panel that was never on a conversation', chatNavigationSound({}), '');

console.log('\n--- a message, from either end ---');
check('sending one', chatMessageSound({ mine: true, focused: true }), 'chat_send');
check('receiving one in the conversation on screen', chatMessageSound({ mine: false, focused: true }), 'chat_send');
check('receiving one while looking somewhere else', chatMessageSound({ mine: false, focused: false }), 'chat_notify');
check('a muted room is silent', chatMessageSound({ mine: false, focused: false, muted: true }), '');
check('even for your own message', chatMessageSound({ mine: true, focused: true, muted: true }), '');

console.log('\n--- the badge, for a conversation nobody has open ---');
const badge = (over) =>
  chatBadgeSound({ unreadBefore: 1, unreadAfter: 2, focused: false, muted: false, authorId: 'u2', viewerId: 'u1', ...over });
check('a badge growing plays the notification tone', badge({}), 'chat_notify');
check('a badge being read plays nothing', badge({ unreadAfter: 0 }), '');
check('a muted room plays nothing', badge({ muted: true }), '');
check('the conversation on screen plays nothing here', badge({ focused: true }), '');
// THE SENDER'S OWN MESSAGE GROWS THEIR OWN BADGE, because the fan-out gives the sender a row too - so without this the
// member would hear their own sentence ring a moment after sending it, any time they switched rooms.
check('and your own message never rings at you', badge({ authorId: 'u1' }), '');
check('a row with no author is treated as somebody else', badge({ authorId: '' }), 'chat_notify');

console.log('\n--- who is in the conversation ---');
check('somebody joining', chatParticipantSound({ previous: ['u1'], next: ['u1', 'u2'] }), 'chat_enter');
check('somebody leaving', chatParticipantSound({ previous: ['u1', 'u2'], next: ['u1'] }), 'chat_exit');
check('a join outranks a leave when both happen at once', chatParticipantSound({ previous: ['u1', 'u3'], next: ['u2', 'u3'] }), 'chat_enter');
check('nobody moving plays nothing', chatParticipantSound({ previous: ['u1'], next: ['u1'] }), '');
check('an unchanged empty list plays nothing', chatParticipantSound({ previous: [], next: [] }), '');
check('and a room whose audience is not a list plays nothing', chatParticipantSound({}), '');

// ---------------------------------------------------------------------------------------------------
console.log('\n--- the wiring: what makes the decisions above audible ---');
checkIs('the conversation opening and closing is wired', /sound\(chatNavigationSound\(/.test(host));
checkIs('sending plays the send tone the moment it lands', /sound\(chatMessageSound\(\{ mine: true/.test(host));
checkIs('a message from somebody else is decided by focus', /sound\(chatMessageSound\(\{ mine: false, focused, muted \}\)\)/.test(host));
checkIs('and only somebody else\'s message rings', /arrived\.filter\(\(row\) => String\(row\.author_id\) !== viewerId\)/.test(host));
checkIs('the badge path is wired', /sound\(tone\)/.test(host) && /chatBadgeSound\(\{/.test(host));
checkIs('and who is in the conversation', /sound\(chatParticipantSound\(\{/.test(host));
// ONE NOISE PER MESSAGE. The chat tone plays and the toast is quiet, because a toast sound underneath it would be the app
// saying "toast!" and then the chat saying "message".
checkIs('the arrival toast is quiet', /quietToast\.info\(/.test(host) && /export const quietToast/.test(source('src/utils/toast.js')));
// THE FIRST SNAPSHOT IS NOT THIRTY EVENTS. Opening a busy room must not play a burst of tones for messages that arrived
// days ago, so nothing rings until that room's window has settled.
checkIs(
  'the first window of a conversation is silent',
  /windowSettledRef\.current \? rows\.filter/.test(host) && /windowSettledRef\.current = false/.test(host)
);
// A SOUND IS NEVER PLAYED FROM INSIDE A STATE UPDATER: React may call one twice, and a tone played twice for one message
// is the sort of bug nobody can reproduce.
checkIs('no sound is played inside a state updater', !/setMessages\(\(current\) => \{[^}]*sound\(/.test(host));
checkIs('and every write to the list goes through the ref-backed helper', /applyMessages\(\(current\) => mergeChatMessages/.test(host));

console.log(`\n${failures ? `${failures} CHECK(S) FAILED` : 'ALL CHECKS PASSED'}\n`);
process.exit(failures ? 1 : 0);
