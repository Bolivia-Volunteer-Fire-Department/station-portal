// Renders the chat components, because a whole class of bug only exists when they RUN.
//
// WHY THIS FILE EXISTS, in the shape it does. On the day it was written the chat host threw
// `Cannot access 'loadRooms' before initialization` on every render and took the module down with it - and EVERY OTHER CHECK
// IN THIS SUITE WAS GREEN. That is not a gap in those checks; it is the difference between two kinds of question:
//
//   * verify-chat.mjs asks what chat DECIDES (pure functions) and what its source SAYS (that it subscribes, that it refreshes
//     after a membership change). All of that was true - and true of code that could not run.
//   * This asks whether the components SURVIVE BEING RENDERED, which is the only thing that catches an evaluation-order bug:
//     a useCallback whose dependency array names something declared below it throws as the array is BUILT, which is during
//     render, not when the callback is called.
//
// RENDERED, NOT MOUNTED, and the difference matters: `renderToStaticMarkup` runs the component body - every hook in order,
// every dependency array, every useMemo initialiser - and does NOT run effects. So this catches render-time faults (dead
// zones, a destructure of undefined, a memo that throws) and cannot catch effect-time ones, which would need a DOM and a
// clock. Half a net is worth having when the first bug through it took a module offline.
//
// THE EARLY RETURN IS NOT AN ESCAPE: ChatHost returns null without `can_use_chat`, but REACT RUNS EVERY HOOK BEFORE THAT
// LINE - so rendering it with chat switched off still walks the whole hook chain, which is exactly what that bug needed.
//
// Built through Vite (`npm run verify:chat-render` runs the two steps) for the same reason verify-notification-prefs is: the
// app's modules import each other without file extensions, which plain Node refuses and Vite resolves.
//
// Run with: npm run verify:chat-render
import React, { useCallback, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ChatHost from '../src/components/Chat/ChatHost.jsx';
import ChatPanel, { ChatPeoplePicker } from '../src/components/Chat/ChatPanel.jsx';
import { chatMillis } from '../src/utils/chat.js';
import EmojiPicker from '../src/components/Chat/EmojiPicker.jsx';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`
  );
};

// Renders, and REPORTS rather than throwing: a harness that dies on its first case tells you about one bug, and this one is
// meant to list them - the point being that a component failing to render must not hide the next one's failure.
const attempt = (label, element) => {
  try {
    const html = renderToStaticMarkup(element);
    console.log(`ok   ${label}: rendered ${html.length} characters`);
    return { ok: true, html };
  } catch (error) {
    failures++;
    console.log(`FAIL ${label}: ${error && error.message}`);
    return { ok: false, html: '', error };
  }
};

// A RENDER THAT MUST FAIL, counted the other way round: it is a failure of THIS SUITE if the component renders happily. Used
// by the negative control at the bottom, which is the only thing that makes the rest of this file worth believing.
const expectRenderFailure = (label, element, reason) => {
  try {
    renderToStaticMarkup(element);
    failures++;
    console.log(`FAIL ${label}: it rendered, so this harness proves nothing about hooks`);
  } catch (error) {
    const message = String(error && error.message);
    const ok = reason.test(message);
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${message}`);
  }
};

const USER = { id: 'u1', name: 'Ana', role_id: 'captain', rank_id: 'captain' };
const ROOMS = [
  { id: 'general', name: 'General', sort_order: 1, last_preview: 'Truck 2 is back', last_author_name: 'Ben' },
  { id: 'dm_u1_u2', kind: 'private', member_ids: ['u1', 'u2'], member_names: ['Ana', 'Ben'], last_at: '2026-01-01 09:00:00' },
];
const MESSAGES = [
  { id: 'm1', author_id: 'u2', author_name: 'Ben', body: 'Can you cover my shift?', created_at: '2026-01-01 09:00:00' },
  { id: 'm2', author_id: 'u1', author_name: 'Ana', body: 'On my way', created_at: '2026-01-01 09:05:00' },
];
const PEOPLE = [
  { id: 'u2', name: 'Ben' },
  { id: 'u3', name: 'Cass' },
];

console.log('\n--- the chat host ---');
// CHAT SWITCHED OFF is the case a test is most likely to skip, and it matters most here: the hooks run before the early
// return, so this still walks the entire chain.
attempt('the host with chat switched off', React.createElement(ChatHost, {
  token: 'token',
  currentUser: USER,
  role: { id: 'captain' },
  timeFormat: '12',
  flags: {},
}));
attempt('the host with nobody signed in', React.createElement(ChatHost, {
  token: '',
  currentUser: null,
  flags: { useChat: true },
}));
attempt('the host with chat on and no conversation open', React.createElement(ChatHost, {
  token: 'token',
  currentUser: USER,
  role: { id: 'captain' },
  timeFormat: '12',
  offline: false,
  flags: { useChat: true },
}));
attempt('the host full-screen (the Chat module itself)', React.createElement(ChatHost, {
  token: 'token',
  currentUser: USER,
  role: { id: 'captain' },
  timeFormat: '12',
  fullScreen: true,
  flags: { useChat: true },
}));
attempt('the host while offline', React.createElement(ChatHost, {
  token: 'token',
  currentUser: USER,
  role: { id: 'captain' },
  timeFormat: '12',
  offline: true,
  flags: { useChat: true },
}));

console.log('\n--- the panel, in each of its states ---');
const panel = (over) =>
  React.createElement(ChatPanel, {
    rooms: ROOMS,
    inbox: { dm_u1_u2: { count: 3, read_count: 1, last_author_id: 'u2' } },
    activeRoomId: '',
    messages: [],
    flags: { useChat: true },
    currentUser: USER,
    timeFormat: '12',
    presence: { u2: { at: Date.now() }, u3: { at: 1 } },
    typing: { u2: { at: Date.now() } },
    people: PEOPLE,
    onLoadPeople: () => {},
    onStartThread: () => {},
    onChangeParticipants: () => {},
    onLeaveThread: () => {},
    ...over,
  });

attempt('the room list', panel({}));
attempt('a station room open', panel({ activeRoomId: 'general', messages: MESSAGES }));
// A PRIVATE CONVERSATION, which is the only kind that draws the online count, the typing line and the two membership controls
// - so it is the state most of the recent work lives in, and the one worth rendering most.
attempt('a private conversation open', panel({ activeRoomId: 'dm_u1_u2', messages: MESSAGES }));
attempt('a conversation with nothing in it yet', panel({ activeRoomId: 'dm_u1_u2', messages: [], hasOlder: true }));
attempt('a muted conversation', panel({ activeRoomId: 'dm_u1_u2', messages: MESSAGES, inbox: { dm_u1_u2: { count: 2, read_count: 2, muted: true } } }));
attempt('the panel while offline', panel({ activeRoomId: 'dm_u1_u2', messages: MESSAGES, offline: true }));
attempt('the panel with an error showing', panel({ activeRoomId: 'dm_u1_u2', messages: MESSAGES, error: 'Chat is having trouble staying connected.' }));
attempt('the panel full-screen', panel({ activeRoomId: 'dm_u1_u2', messages: MESSAGES, fullScreen: true }));
attempt('an empty station with no rooms at all', panel({ rooms: [] }));
attempt('a message that was removed', panel({
  activeRoomId: 'dm_u1_u2',
  messages: [{ id: 'm3', author_id: 'u2', author_name: 'Ben', body: '', deleted_at: '2026-01-01 10:00:00', deleted_by_name: 'Ben' }],
}));
attempt('the emoji picker on its own', React.createElement(EmojiPicker, { onPick: () => {}, onClose: () => {} }));

console.log('\n--- the picker, in both of its jobs ---');
// THE SAME COMPONENT, TWO QUESTIONS: who to start a conversation with, and who is in the one that is open. Both are rendered
// because the second is where the Remove control lives, and a component that only exists behind a button is a component
// nothing ever runs.
const picker = (over) =>
  React.createElement(ChatPeoplePicker, {
    people: PEOPLE,
    picked: [],
    filter: '',
    presence: { u2: { at: Date.now() } },
    now: Date.now(),
    onFilter: () => {},
    onToggle: () => {},
    onStart: () => {},
    onBack: () => {},
    ...over,
  });

attempt('choosing people to message', picker({ picked: ['u2'] }));
attempt('the picker while it is loading', picker({ people: [], loading: true }));
attempt('the picker with nobody it can offer', picker({ people: [] }));
attempt('the picker with a search that matches nobody', picker({ filter: 'zzz' }));
attempt('the picker mid-add, with a message from the server', picker({ picked: ['u2'], error: 'Cass cannot use chat.' }));
attempt('the members list of a conversation', picker({ currentMembers: [{ id: 'u2', name: 'Ben' }], onRemove: () => {}, onAddPeople: () => {} }));
attempt('a members list with nobody else in it', picker({ currentMembers: [], onRemove: () => {}, onAddPeople: () => {} }));
attempt('and the members list with a refusal showing', picker({ currentMembers: [{ id: 'u2', name: 'Ben' }], error: 'A private conversation needs two people.', onRemove: () => {}, onAddPeople: () => {} }));
attempt('a members list with a member whose name never loaded', picker({ currentMembers: [{ id: 'u9' }], onRemove: () => {}, onAddPeople: () => {} }));

// ---------------------------------------------------------------------------------------------------
console.log('\n--- and the check has teeth ---');
// THE NEGATIVE CONTROL, which is the only thing that makes the rest of this file worth reading: a component whose dependency
// array names a const declared BELOW it - the exact shape of the bug that took the chat host down - has to FAIL to render
// here. If this passes, the harness is not running the hook chain and every "ok" above means nothing at all.
const BrokenOrder = () => {
  const broken = useCallback(() => after(), [after]);
  const [after] = useState(() => 'declared later');
  return React.createElement('span', null, typeof broken, after);
};
expectRenderFailure(
  'a dependency array naming something declared below it is CAUGHT',
  React.createElement(BrokenOrder),
  /before initialization/
);

// ---------------------------------------------------------------------------------------------------
console.log('\n--- the conversation toolbar says what its buttons do ---');
// ASSERTED ON THE RENDERED HEADER, not on the source, because this is a claim about what a member can see: every icon-only
// button in the toolbar has to carry BOTH a label (for a screen reader) and a title (the tooltip on hover). The icons are the
// whole button, so neither can be inferred from the text - and a toolbar of four unlabelled squares is a toolbar somebody has
// to guess at.
// THE CONVERSATION ALONE, from the pane that holds it onwards.
//
// The panel draws the room list and the conversation into the SAME document at full width - the pane that is not showing
// is hidden with a class rather than unmounted, which is what keeps the list's scroll position across opening and closing
// a conversation. The cost of that is these checks: several of them ask which of two strings comes first ("the tick after
// the controls, before the time"), and with a list of room rows above the conversation, a row's own timestamp is
// `indexOf`'s first match and the answer is wrong about a message that is perfectly correct.
//
// Slicing from the conversation pane is what those checks meant all along, and it is why the pane carries `data-pane`.
const conversationOnly = (html) => {
  const at = String(html).indexOf('data-pane="conversation"');
  return at >= 0 ? String(html).slice(at) : String(html);
};
// `openConversation` still hands back the ELEMENT, as it always did: `silently` is what renders it, so anything that
// wants the sliced markup asks for it below (`ownHtml`) rather than here. Wrapping the element would have been wrapping
// something that is not yet a string - the first version of this did exactly that and produced `html: undefined`.
const openConversation = (over) => panel({ activeRoomId: 'dm_u1_u2', messages: MESSAGES, ...over });
// Renders a case that is being INSPECTED rather than counted: it still reports a failure if the case cannot render at all (a
// button nobody can look at is worth knowing about), but it does not add an "ok" line for every header a check peeks inside.
const silently = (element) => {
  try {
    return { html: renderToStaticMarkup(element) };
  } catch (error) {
    failures++;
    console.log(`FAIL a case could not be rendered for inspection: ${error && error.message}`);
    return { html: '' };
  }
};
// EVERY TOOLBAR THE PANEL DRAWS, not just the first one - and this used to take only the first, which was fine while the
// panel had a single header across the top. It now has two (the list's and the conversation's), so a helper that took the
// first was reading the list's title bar and calling it the conversation's toolbar, and the "a toolbar has buttons in it"
// check below failed for a reason that had nothing to do with buttons.
const headerOf = (element) => {
  const html = silently(element).html;
  return (html.match(/<header\b[\s\S]*?<\/header>/g) || []).join('');
};
const buttonsIn = (html) => html.match(/<button\b[^>]*>/g) || [];
const missing = (html) =>
  buttonsIn(html)
    .filter((tag) => !/\stitle="/.test(tag))
    .map((tag) => tag.slice(0, 120));

const conversationHeader = headerOf(openConversation({}));
check('the conversation toolbar has buttons in it', buttonsIn(conversationHeader).length > 0, true);
check('and every one of them explains itself on hover', missing(conversationHeader), []);
// THE SAME FOR THE LIST AND THE PICKER: a rule about the toolbar is worth having only if it holds wherever the toolbar is
// drawn, and the picker's own controls are the same kind of thing.
check('the room list header, too', missing(headerOf(panel({}))), []);
check('and the members list', missing(headerOf(picker({ currentMembers: [{ id: 'u2', name: 'Ben' }], onRemove: () => {}, onAddPeople: () => {} }))), []);
// THE CHECK HAS TEETH: a button without a title is caught by it, which is the only thing that makes the four above worth
// reading. This is the shape the toolbar was in before - labels but no titles.
check('a button without a title is caught', missing('<header><button type="button" aria-label="Mute"></button></header>').length, 1);

// ---------------------------------------------------------------------------------------------------
console.log('\n--- the back control, in both sizes ---');
// THE BUG THIS EXISTS FOR: the Chat module is the docked panel at full width, and opening a conversation there replaced the
// list with no way back to it. The control lives in the shared header, so it is present in BOTH renders - which is the
// assertion, rather than trusting that the condition on it stays right.
const hasBack = (element) => /Back to the conversations/.test(silently(element).html);
check('the docked panel offers a way back to the list', hasBack(openConversation({})), true);
check('and so does the Chat module at full width', hasBack(openConversation({ fullScreen: true })), true);
check('the list itself does not offer it (there is nothing behind it)', hasBack(panel({})), false);

// ---------------------------------------------------------------------------------------------------
console.log('\n--- the order a conversation is drawn in ---');
// THE COMPLAINT THIS EXISTS FOR: "new messages appear at the top of conversation windows". The fix is a property of the
// RENDERED list - the oldest message first, so the newest sits at the bottom where the scroll is parked - and asserting it on
// the markup is the only way to know which half was wrong: the DATA (a timestamp that did not parse, sorting a new message to
// zero) or the DRAWING (a reversed container).
const ordered = silently(openConversation({})).html;
const older = ordered.indexOf('Can you cover my shift?');
const newer = ordered.indexOf('On my way');
check('both messages are drawn', older >= 0 && newer >= 0, true);
check('and the older one comes FIRST, so the newest is at the bottom', older < newer, true);
// AND THE SENTINEL, which is what an unparsed timestamp looks like: a message whose `created_at` never resolved carries
// `created_ms: 0` and sorts above everything - the exact shape of "new messages at the top". Asserted here so the case is
// understood rather than rediscovered.
check('an unparsed timestamp sorts as zero', chatMillis({}) === 0 && chatMillis(null) === 0, true);
check('a station timestamp parses', chatMillis('2026-01-01 09:05:00') > 0, true);
check('and so does a Firestore timestamp', chatMillis({ toMillis: () => 1_800_000_000_000 }) === 1_800_000_000_000, true);

// ---------------------------------------------------------------------------------------------------
console.log('\n--- the metadata line under a message ---');
// THE COMPLAINT THIS EXISTS FOR: the timestamp was pushed sideways by the edit and delete controls - reserved space that is
// invisible until hover - so it moved whenever they appeared. The order is the fix: anything that can grow has to come BEFORE
// the thing that must not move, and the timestamp is pinned right by `ml-auto`. Asserted on the rendered markup, in order,
// because "on the right" is a claim about the DOM: the controls must appear before the time.
const own = conversationOnly(
  silently(openConversation({ messages: [MESSAGES[1]], flags: { useChat: true, editOwn: true, deleteOwn: true } })).html
);
const editAt = own.indexOf('Edit this message');
const timeMatch = own.match(/\d{1,2}:\d{2}/);
const timeAt = timeMatch ? own.indexOf(timeMatch[0]) : -1;
check('your own message offers an edit control', editAt >= 0, true);
check('and it is drawn BEFORE the time', timeAt >= 0 && editAt < timeAt, true);

// ---------------------------------------------------------------------------------------------------
console.log('\n--- the receipt beside your own message ---');
// WORKED OUT BY THE PANEL AND DRAWN BY THE BUBBLE, and asserted on the markup because the whole feature is a claim about what a
// member sees: three states that must not be confused for one another, and a position - between the edit control and the time.
//
// MESSAGES[1] IS ANA'S OWN, and the viewer in these renders is Ana, so this is the only case a receipt is drawn for.
const withReceipt = (over) =>
  conversationOnly(
    silently(panel({ activeRoomId: 'dm_u1_u2', messages: [MESSAGES[1]], flags: { useChat: true, editOwn: true }, ...over })).html
  );
const seen = withReceipt({ readAt: { u2: chatMillis('2026-01-01 09:06:00') } });
const sent = withReceipt({ readAt: {} });
const sending = withReceipt({ messages: [{ ...MESSAGES[1], created_at: null }] });
check('a message the other member has read shows SEEN', /aria-label="Seen"/.test(seen), true);
check('one they have not shows SENT', /aria-label="Sent"/.test(sent), true);
check('and one the server has not confirmed shows SENDING', /aria-label="Sending"/.test(sending), true);
// THE THREE STATES ARE MUTUALLY EXCLUSIVE, which is the thing a chain of `if`s gets wrong and a screenshot never shows.
check('only one of the three is ever drawn', [
  [seen, 'Sent'],
  [seen, 'Sending'],
  [sent, 'Seen'],
  [sending, 'Seen'],
].every(([html, other]) => !new RegExp(`aria-label="${other}"`).test(html)), true);
// AND WHERE IT SITS: after the edit control, before the time. That order is the request - a tick beside the buttons it belongs
// with, and a timestamp pinned right that never moves.
const receiptEditAt = seen.indexOf('Edit this message');
const seenAt = seen.indexOf('aria-label="Seen"');
const receiptTimeMatch = seen.match(/\d{1,2}:\d{2}/);
const receiptTimeAt = receiptTimeMatch ? seen.indexOf(receiptTimeMatch[0]) : -1;
check('the tick comes after the controls and before the time', receiptEditAt >= 0 && seenAt > receiptEditAt && receiptTimeAt > seenAt, true);
// A STATION ROOM GETS NO TICK AT ALL: there is no receipts document for one, and "seen by forty people" is not a receipt.
check(
  'a room message shows no receipt',
  /aria-label="Seen"/.test(silently(panel({ activeRoomId: 'general', messages: [{ ...MESSAGES[1], author_id: 'u1' }], readAt: { u2: Date.now() } })).html),
  false
);

// ---------------------------------------------------------------------------------------------------
console.log('\n--- the rank icon beside an author ---');
// THE ICON COMES FROM THE RANK THE ROW NAMES, so what is asserted is the LOOKUP and its two silences: an unknown rank draws
// nothing rather than a placeholder glyph, and your own message draws nothing because your own name is not shown beside it.
// THE NAMES ARE THE MAP'S OWN, lowercase kebab (`components/RankIcon`), because that is what the Ranks tab stores: a fixture
// with 'Shield' would have made this check pass while proving nothing, which is the same trap as a picker offering a reaction
// the server refuses.
const RANKS = [{ id: 'captain', icon: 'shield' }, { id: 'firefighter', icon: 'flame' }];
// SOMEBODY ELSE'S MESSAGE. Sliced to the conversation pane (see `conversationOnly`) because these checks compare the
// POSITION of two things on a message, and the room list above it has rows of its own - one of them titled "Ben" - so a
// whole-document search for "Ben" finds a list row rather than the message that names him.
const incoming = (over) =>
  conversationOnly(
    silently(panel({ activeRoomId: 'general', messages: [{ ...MESSAGES[0], author_rank_id: 'captain' }], ranks: RANKS, ...over })).html
  );
check('an author with a rank gets its icon', /lucide-shield/.test(incoming({})), true);
check('and the icon is drawn before their name', incoming({}).indexOf('lucide-shield') < incoming({}).indexOf('Ben'), true);
// A RANK THE SCREEN DOES NOT KNOW, and a message written before ranks were stamped: both silent, and both silent for the same
// reason - an icon nobody can look up is not a fact about the person, it is a gap.
check('an unknown rank draws nothing rather than a placeholder', /lucide-shield/.test(incoming({ ranks: [] })), false);
check('and neither does a message with no rank at all', /lucide-shield/.test(silently(panel({ activeRoomId: 'general', messages: [MESSAGES[0]], ranks: RANKS })).html), false);
// YOUR OWN NAME IS NOT SHOWN BESIDE YOUR OWN BUBBLE, so a badge for the person reading would be decoration.
check(
  'your own message shows no rank icon',
  /lucide-shield/.test(
    silently(panel({ activeRoomId: 'general', messages: [{ ...MESSAGES[1], author_rank_id: 'captain' }], ranks: RANKS })).html
  ),
  false
);

// ---------------------------------------------------------------------------------------------------
console.log('\n--- the author picture beside a name ---');
const AVATAR = 'https://example.test/ben.png';
const withAvatar = (over) =>
  conversationOnly(silently(panel({ activeRoomId: 'general', messages: [{ ...MESSAGES[0], author_avatar_url: AVATAR }], ...over })).html);
check('an author with a picture gets it', withAvatar({}).includes(AVATAR), true);
check('and it is drawn before their name', withAvatar({}).indexOf(AVATAR) < withAvatar({}).indexOf('Ben'), true);
// THE PICTURE BESIDE A NAME MUST NOT BE ANNOUNCED AS WELL AS THE NAME: `alt=""` is what makes a screen reader say "Ben" rather
// than "photo of Ben, Ben". Asserted on what renders, because a source that reads correctly and an attribute that is missing
// look the same in a diff.
check('the picture is decorative where the name is spoken', /alt=""[^>]*aria-hidden="true"/.test(withAvatar({})), true);
// LAZY, because a conversation somebody scrolls past must not fetch every avatar on the way down. This is a downloaded file per
// message, so the attribute is the difference between a scroll and a phone bill.
check('the picture is fetched lazily', /loading="lazy"/.test(withAvatar({})), true);
// AND IT HIDES ITSELF IF THE FILE IS GONE. NOT ASSERTED HERE, and deliberately not faked: React does not serialise event
// handlers into HTML, so no assertion on the rendered string can see this one. It is the single piece of the avatar drawn on
// trust, and it is called out in the summary rather than hidden behind a check that would pass either way.
check('no picture drawn when the message carries none', withAvatar({ messages: [MESSAGES[0]] }).includes(AVATAR), false);
check(
  'and none beside your own message',
  silently(panel({ activeRoomId: 'general', messages: [{ ...MESSAGES[1], author_avatar_url: AVATAR }] })).html.includes(AVATAR),
  false
);

// ---------------------------------------------------------------------------------------------------
console.log('\n--- the face beside the bubble ---');
// THE PICTURE BELONGS BESIDE THE BUBBLE, not in the 10px metadata line, and these checks exist because MOVING an image is
// exactly the kind of change that quietly loses one of its attributes. The three below are the ones that matter: it is
// decorative, it is lazy, and it is a 32px circle rather than the 20px smudge it used to be.
const body0 = String(MESSAGES[0].body || '');
check('the picture is drawn before the words it belongs to', withAvatar({}).indexOf(AVATAR) < withAvatar({}).indexOf(body0), true);
check('at the size a face is recognisable at', /h-8 w-8 shrink-0 rounded-full object-cover/.test(withAvatar({})), true);
// THE GUTTER IS HELD OPEN WHEN THERE IS NO PICTURE. Without this the whole conversation shifts sideways depending on who
// has set one - and since most members never will, the ragged version is the normal case rather than the exception.
check(
  'a message with no picture still leaves room for one',
  /h-8 w-8 shrink-0" aria-hidden="true"/.test(withAvatar({ messages: [MESSAGES[0]] })),
  true
);
// AND NEVER ON YOUR OWN MESSAGE, which means no picture AND no gap: your own bubble is not indented by a face that is never
// drawn. THE CHECK NAMES THE SPACER'S OWN CLASSES rather than looking for `aria-hidden`, and the first version of this line
// did exactly that and failed - because lucide icons carry `aria-hidden="true"` too, so it was matching the delivery
// checkmark inside your own bubble and would have gone on failing whatever the layout did.
check(
  'your own message indents nothing',
  /h-8 w-8 shrink-0" aria-hidden="true"/.test(
    silently(panel({ activeRoomId: 'general', messages: [{ ...MESSAGES[1], author_avatar_url: AVATAR }] })).html
  ),
  false
);
// A REGRESSION GUARD, and it is about a specific mistake: the old picture lived in the metadata line as `h-5 w-5`, and a
// half-move that left it there as well would show the same face twice on every message - which is the sort of thing nobody
// notices in a diff and everybody notices on screen.
check('the old 20px picture in the metadata line is gone', /h-5 w-5/.test(withAvatar({})), false);
// THE WIDTH LIMIT MOVED ONTO THE COLUMN THAT HOLDS THE BUBBLE, and it is still a limit on the ROW (85%), which is what
// bounds a message's width. Asserted both ways, because the interesting failure is the one that leaves the limit in two
// places: the bubble measuring 85% of a column that is itself 85% of the row is a conversation 28% narrower than before.
check('the row width limit is stated once', (withAvatar({}).match(/max-w-\[85%\]/g) || []).length, 1);
check('and the bubble no longer repeats it', /max-w-full rounded-2xl/.test(withAvatar({})), true);

// ---------------------------------------------------------------------------------------------------
console.log('\n--- the two panes at full width ---');
// THE POINT OF THE WHOLE CHANGE: at full width the conversations and the conversation you are reading are on screen
// together. Below the breakpoint - and in the docked panel at ANY width - it stays one view at a time, which is what the
// checks in the rest of this file have been asserting all along and must keep passing.
const wide = (over) =>
  silently(panel({ activeRoomId: 'dm_u1_u2', fullScreen: true, messages: MESSAGES, flags: { useChat: true }, ...over })).html;
const docked = (over) =>
  silently(panel({ activeRoomId: 'dm_u1_u2', messages: MESSAGES, flags: { useChat: true }, ...over })).html;
check('the conversation gets a pane of its own', /data-pane="conversation"/.test(wide({})), true);
check('and the list becomes a column beside it rather than a view', /md:w-72 md:flex-none md:border-r/.test(wide({})), true);
// THE PANES FILL THE ROW, which is the fix for a bug the class string itself made hard to see: a flex item defaults to
// `flex: 0 1 auto`, so a pane that never asks to grow is sized by its widest content - a `rows={1}` message box - and the
// conversation drew in a narrow column with the rest of the row empty.
//
// ASSERTED ON THE PANE ITSELF rather than by counting that class across the document, which is what the first version of
// this check did: it found three, because two other components in the file are laid out with the same words. A count over a
// whole document is only ever a check of the document - the same mistake the ordering checks above made about the room
// list. `data-pane` is what makes "the conversation pane, specifically" expressible.
check('the conversation pane asks to fill the space', /class="[^"]*flex min-h-0 flex-1 flex-col[^"]*" data-pane="conversation"/.test(wide({})), true);
check('and the fixed column cancels its own growth', /class="[^"]*md:w-72 md:flex-none[^"]*"/.test(wide({})), true);
// THE BACK CONTROL HAS NOTHING TO DO once the list is on screen, so it is hidden at the breakpoint - and only at the
// breakpoint, which is the part worth asserting: the same panel on a phone still needs it.
check('the way back is hidden once both panes are up', /md:hidden[\s\S]{0,200}Back to the conversations/.test(wide({})), true);
check('and is still there on a phone', !/md:hidden[\s\S]{0,200}Back to the conversations/.test(docked({})), true);
// THE DOCKED PANEL IS 24rem WIDE AT ANY SCREEN SIZE, so a list column beside a conversation would leave neither of them
// usable. This is the check that says the two-pane layout is about the PANEL being wide, not the window.
check('a docked panel is never two-paned, however wide the window is', /md:w-72/.test(docked({})), false);
// AND WITH NOTHING OPEN, the wide layout says what to do rather than showing an empty half - an empty pane reads as a
// loading failure. On a phone that placeholder is inside a hidden pane and is never seen.
check(
  'an empty wide layout says what to do',
  /Choose a conversation/.test(wide({ activeRoomId: '', messages: [] })),
  true
);

// ---------------------------------------------------------------------------------------------------
console.log('\n--- the picture on a message, as drawn ---');
const GIF = 'https://static.klipy.com/ii/39f2/c7/d9/zGNkmMep.webp';
const GIF_FALLBACK = 'https://static.klipy.com/ii/39f2/c7/d9/XKufQP6s.gif';
const withGif = (over) =>
  conversationOnly(
    silently(
      panel({
        activeRoomId: 'general',
        messages: [{ ...MESSAGES[0], gif_url: GIF, gif_fallback_url: GIF_FALLBACK, gif_width: 498, gif_height: 249, gif_alt: 'Joey cheers', ...over }],
      })
    ).html
  );
check('the picture is drawn', withGif({}).includes(GIF), true);
// THE RATIO IS IN THE MARKUP BEFORE THE PICTURE ARRIVES, which is the entire reason the width and height are stored: the
// box is the right shape from the first frame, so the conversation above it does not move as each picture loads.
check('with the shape it will be, so nothing jumps when it loads', /aspect-ratio:\s*498\s*\/\s*249/.test(withGif({})), true);
// `<picture>` IS THE RIGHT WAY ROUND ONLY IF THE WEBP IS THE `source` AND THE GIF IS THE `img`: a browser picks the first
// `source` it understands and falls back to the `img`, so putting them the other way round would give the modern file to
// nobody and the old one to everybody.
check('the modern file is offered first', withGif({}).indexOf('<source') < withGif({}).indexOf('<img'), true);
check('and the older one is what an old browser falls back to', /src="https:\/\/static\.klipy\.com[^"]*XKufQP6s\.gif"/.test(withGif({})), true);
// THE DESCRIPTION IS KLIPY'S OWN TITLE, because for a message that is a picture and nothing else it IS the content - and
// an image with no alt is one a screen reader reads as "image".
check('the picture says what it is', /alt="Joey cheers"/.test(withGif({})), true);
check('and with no description it still says something', /alt="Picture"/.test(withGif({ gif_alt: '' })), true);
// LAZY, for the same reason the avatars are: a conversation somebody scrolls past must not fetch every picture in it.
check('the picture is fetched lazily', /loading="lazy"/.test(withGif({})), true);
check('a message with no picture draws none', withGif({ gif_url: '', gif_fallback_url: '' }).includes(GIF), false);
// AND THE TEXT STILL RENDERS: a picture with a caption is the ordinary case, and one that swallowed the words would be a
// message that lost half of itself.
check('a caption under the picture survives', withGif({}).includes(String(MESSAGES[0].body || '').slice(0, 12)), true);

// AND THE METADATA LINE READS RIGHT TO LEFT: the time, the tick, the pencil, the bin. Asserted as an ORDER in the markup,
// because "on the right" is a claim about the DOM and this is the one thing about the line a screenshot cannot check.
console.log('\n--- the order along the bottom of a message ---');
const line = conversationOnly(
  silently(
    openConversation({
      messages: [MESSAGES[1]],
      flags: { useChat: true, editOwn: true, deleteOwn: true },
      readAt: { u2: chatMillis('2026-01-01 09:06:00') },
    })
  ).html
);
const lineTimeMatch = line.match(/\d{1,2}:\d{2}/);
const timeIndex = lineTimeMatch ? line.indexOf(lineTimeMatch[0]) : -1;
const seenIndex = line.indexOf('aria-label="Seen"');
const editIndex = line.indexOf('Edit this message');
const removeIndex = line.indexOf('Remove this message');
check('the timestamp is the rightmost thing on the line', timeIndex > seenIndex, true);
check('then the receipt', seenIndex > editIndex, true);
check('then the pencil', editIndex > removeIndex, true);
// AND THE SMILEY IS LEFT OF ALL OF IT, so it cannot push the two that belong together apart.
check('and the smiley sits before the controls rather than between them', line.indexOf('React to this message') < removeIndex, true);

// THE POPOVER THAT LOOKED BROKEN IS ASSERTED IN verify-chat.mjs, not here: it is a claim about a `relative` wrapper in the
// source, and this harness has no layout to look at. The checks below are the ones this harness can genuinely make.

console.log(`\n${failures ? `${failures} CHECK(S) FAILED` : 'ALL CHECKS PASSED'}\n`);
process.exit(failures ? 1 : 0);