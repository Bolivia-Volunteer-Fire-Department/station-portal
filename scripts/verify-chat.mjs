// The chat module's decisions, asked directly: utils/chat.js on the client, functions/chat.js on the server, and the one
// place the two have to agree.
//
// WHY THIS FILE EXISTS. Chat is the first module in the app whose data arrives on a STREAM, and the two ways it can go
// wrong are both invisible in a screenshot:
//
//   1. A MERGE THAT ONLY APPENDS. A listener does not deliver a page, it delivers a change - an edit arrives as the same
//      document again, a removal arrives as that document with its body gone. If the merge appends rather than replaces,
//      the same message is drawn twice with the old text, and nothing anywhere reports a problem.
//   2. AN UNREAD COUNT KEPT AS A NUMBER. The whole affordability of the fan-out rests on the inbox NOT carrying a
//      per-member unread figure: it carries a count of everything ever posted, and the client subtracts its own read
//      mark (utils/chat.js#unreadCountFor). If somebody ever "simplifies" that into a stored unread field, the fan-out
//      has to read every member's read position on every message - the cost this design exists to avoid.
//
// The third thing asserted here is the AGREEMENT between the two halves: the client and the callable hold the same body
// limit and the same preview width, the rules hold the same room-name limit, and the indexes the queries need are
// declared. Those are three places one number is written down, which is exactly the kind of thing that drifts.
//
// WHAT IS NOT HERE, deliberately: anything that needs Firestore. The rules themselves are exercised against the emulator
// by verify-rules.mjs, which signs in as the demo station's member and officer and asserts what each may read and write.
// Run with: npm run verify:chat
import { readFileSync } from 'node:fs';
import {
  CHAT_BODY_MAX,
  CHAT_OFFLINE_MESSAGE,
  CHAT_PAGE_SIZE,
  CHAT_PREVIEW_MAX,
  CHAT_THREAD_PREFIX as CLIENT_THREAD_PREFIX,
  CHAT_THREAD_MEMBERS_MAX as CLIENT_THREAD_MAX,
  canDeleteChatMessage,
  canEditChatMessage,
  chatBodyProblem,
  chatDeletedNotice,
  chatMillis,
  CHAT_DELIVERY_STATES,
  deliveryStateFor,
  chatPermissionsFrom,
  chatMessageRow,
  reactionMapOf,
  chatPreviewOf,
  chatSendProblem,
  chatThreadTitle,
  isChatThread as isThread,
  mergeChatMessages,
  oldestChatCursor,
  sortChatRooms,
  totalUnread,
  unreadCountFor,
} from '../src/utils/chat.js';
import { CHAT_EMOJI_GROUPS, CHAT_REACTION_EMOJI as CLIENT_REACTION_EMOJI, nextEmojiRecents } from '../src/utils/chatEmoji.js';
import {
  GIF_MIN_WIDTH,
  KLIPY_MEDIA_SUFFIX,
  gifAltFrom,
  gifAspectRatio,
  gifAssetFor,
  gifResultsFrom,
  gifUrlProblem,
} from '../src/utils/chatGifs.js';
import {
  CHAT_BODY_MAX as SERVER_BODY_MAX,
  CHAT_NAME_MAX as SERVER_NAME_MAX,
  CHAT_PREVIEW_MAX as SERVER_PREVIEW_MAX,
  CHAT_THREAD_MEMBERS_MAX,
  CHAT_THREAD_PREFIX as SERVER_THREAD_PREFIX,
  chatConversationFields,
  chatInboxFields,
  chatMemberProblem,
  chatGifFields,
  chatGifProblem,
  CHAT_GIF_HOST_SUFFIX as SERVER_GIF_SUFFIX,
  chatMessageDoc,
  chatParticipantPatch,
  chatParticipantProblem,
  chatPermissionForAction,
  chatPreviewOf as serverPreviewOf,
  chatPushPreferenceFor,
  chatPushRecipients,
  chatPushSummary,
  CHAT_PUSH_PREFERENCES,
  chatReactionProblem,
  chatReactionToggled,
  CHAT_REACTION_EMOJI,
  CHAT_REACTION_MAX,
  chatReachablePeople,
  chatRecipientsFor,
  chatRemovalPatch,
  chatRoomProblem,
  chatThreadDoc,
  chatThreadIdFor,
  chatThreadProblem,
  chatWriteProblem,
  isChatThread as isServerThread,
} from '../functions/chat.js';

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
// For a plain yes/no read, where there is no "actual" worth printing.
const checkIs = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` -> ${detail}`}`);
};

const source = (path) => readFileSync(path, 'utf8');
const indexSource = source('functions/index.js');
const rulesSource = source('firestore.rules');
const routingSource = source('src/services/firestoreRouting.js');
// The trusted half of chat: the decisions the callables make, which is where the private-conversation rules live.
const serverSource = source('functions/chat.js');
const readSource = source('src/services/firestoreReads.js');
const liveSource = source('src/services/liveReads.js');
const indexes = JSON.parse(source('firestore.indexes.json'));
const panelSource = source('src/components/Chat/ChatPanel.jsx');
const hostSource = source('src/components/Chat/ChatHost.jsx');
const appSource = source('src/App.jsx');
// ---------------------------------------------------------------------------------------------------
console.log('\n--- the body, and what may be said in one ---');
check('a message may be written', chatBodyProblem('Engine 2 is back in service'), '');
check('an empty one may not', chatBodyProblem(''), 'Write something first.');
check('nor one that is only spaces', chatBodyProblem('   \n  '), 'Write something first.');
check('nor one that is only invisible characters at the end', chatBodyProblem('\u00a0'), 'Write something first.');
check('and a long one is refused', chatBodyProblem('x'.repeat(CHAT_BODY_MAX + 1)), `That is ${CHAT_BODY_MAX + 1} characters — the limit is ${CHAT_BODY_MAX}.`);
check('exactly at the limit is allowed', chatBodyProblem('x'.repeat(CHAT_BODY_MAX)), '');
// WHY THE TRAILING SPACES ARE CHECKED: a browser's textarea keeps them, and a message that is "empty" only after the
// server trims it is a message the composer was happy to send and the callable refused.
check('the tail is trimmed but the head is left alone', chatBodyProblem('  hello  '), '');
check('the server says the same thing about an empty body', chatWriteProblem(''), 'A message cannot be empty.');
check('and about a long one', chatWriteProblem('x'.repeat(SERVER_BODY_MAX + 1)).startsWith('A message cannot be longer'), true);

console.log('\n--- the preview one line of a room list shows ---');
check('short text is kept', chatPreviewOf('On our way'), 'On our way');
check('newlines collapse into one line', chatPreviewOf('On our way\nback now'), 'On our way back now');
check('long text is trimmed with an ellipsis', chatPreviewOf('y'.repeat(CHAT_PREVIEW_MAX + 20)).length, CHAT_PREVIEW_MAX);
check('and the trim is visible', chatPreviewOf('y'.repeat(CHAT_PREVIEW_MAX + 20)).endsWith('…'), true);
check('nothing is nothing', chatPreviewOf(''), '');
// THE SERVER TRIMS THE PREVIEW TOO - it is what gets stored on the conversation - so the two must agree exactly.
check('the server trims it identically', serverPreviewOf('y'.repeat(CHAT_PREVIEW_MAX + 20)), chatPreviewOf('y'.repeat(CHAT_PREVIEW_MAX + 20)));

// ---------------------------------------------------------------------------------------------------
console.log('\n--- the merge: what makes a stream and a page agree ---');
const streamed = [
  { id: 'm1', created_at: 100, body: 'first', author_id: 'u1' },
  { id: 'm2', created_at: 200, body: 'second', author_id: 'u2' },
];
// THE EDIT. A listener delivers the same document again with a new body, and an appending merge would draw the old text
// beside the new one.
const edited = mergeChatMessages(streamed, [{ id: 'm2', created_at: 200, body: 'second, corrected', edited_at: 300 }]);
check('an edit replaces rather than appends', edited.length, 2);
check('and the new text is the one kept', edited[1].body, 'second, corrected');
check('and it is marked as edited', edited[1].edited_ms, 300);
// THE REMOVAL. The body is gone on the server; the row keeps its place.
// A SNAPSHOT CARRIES THE WHOLE DOCUMENT, which is why `author_id` is here: a partial row is not what a listener
// delivers, and modelling one makes the notice fall back to "a moderator" - which is what this check caught.
const removed = mergeChatMessages(edited, [
  { id: 'm1', created_at: 100, author_id: 'u1', deleted_at: 400, deleted_by: 'u1', body: '' },
]);
check('a removal keeps the message in place', removed.length, 2);
check('with its text gone', removed[0].body, '');
check('and nothing but the record that it was removed', chatDeletedNotice(removed[0]), 'Deleted by author');

// A NEW MESSAGE AT THE FRONT OF THE WINDOW, and the ORDER is the point: the listener delivers newest-first (that is how
// the query reads), while the panel draws bottom-up.
const merged = mergeChatMessages(streamed, [{ id: 'm3', created_at: 300, body: 'third' }]);
check('a new message lands at the end', merged.map((row) => row.id), ['m1', 'm2', 'm3']);
check('an older page lands at the front', mergeChatMessages(merged, [{ id: 'm0', created_at: 50, body: 'older' }]).map((row) => row.id), ['m0', 'm1', 'm2', 'm3']);
// A PLACEHOLDER HAS NO ID, and dropping it is what stops the same message being drawn twice: the callable's answer is
// drawn at once, and the listener's echo of the same write carries the id.
check('a row with no id is dropped', mergeChatMessages([], [{ created_at: 1, body: 'no id' }]).length, 0);
check('and a Firestore document object is understood', mergeChatMessages([], [{ id: 'm9', data: () => ({ created_at: 5, body: 'from a snapshot' }) }]).length, 1);
check('two messages at the same millisecond are ordered by id', mergeChatMessages([], [{ id: 'b', created_at: 7 }, { id: 'a', created_at: 7 }]).map((row) => row.id), ['a', 'b']);
check('and the cursor is the oldest row in hand', chatMillis(oldestChatCursor(merged)), 100);
check('which is null for an empty window', oldestChatCursor([]), null);

console.log('\n--- a removal says who removed it ---');
check('by the author', chatDeletedNotice({ id: 'm', deleted_at: 1, deleted_by: 'u1', author_id: 'u1' }), 'Deleted by author');
check('by an officer, named', chatDeletedNotice({ id: 'm', deleted_at: 1, deleted_by: 'u9', deleted_by_name: 'Jane Smith', author_id: 'u1' }), 'Deleted by Jane Smith');
check('or named as a moderator when the name is missing', chatDeletedNotice({ id: 'm', deleted_at: 1, deleted_by: 'u9', author_id: 'u1' }), 'Deleted by a moderator');
check('and a message that is not removed has no notice', chatDeletedNotice({ id: 'm', body: 'here' }), '');
check('a removed message shows no body even if one is stored', chatMessageRow({ id: 'm', body: 'leak', deleted_at: 1 }).body, '');

// ---------------------------------------------------------------------------------------------------
console.log('\n--- unread: subtraction, not a stored number ---');
check('nothing read yet counts them all', unreadCountFor({ count: 5, read_count: 0 }), 5);
check('a read mark below the count leaves the rest', unreadCountFor({ count: 5, read_count: 3 }), 2);
check('a mark level with the count is nothing', unreadCountFor({ count: 5, read_count: 5 }), 0);
// A MARK AHEAD OF THE COUNT IS NOT A NEGATIVE BADGE. It happens when a member reads a room and then the newest messages
// are removed, or when a stale client writes a mark it computed before a fan-out landed.
check('a mark ahead of the count is still nothing', unreadCountFor({ count: 2, read_count: 9 }), 0);
check('a room nobody has spoken in is quiet', unreadCountFor(undefined), 0);
check('and a muted room never counts', unreadCountFor({ count: 9, read_count: 1, muted: true }), 0);
check('the badge is the sum across rooms', totalUnread([{ count: 3 }, { count: 1, read_count: 1 }, { count: 4, read_count: 1, muted: true }]), 3);
check('and it is zero for a member with no rooms yet', totalUnread([]), 0);

console.log('\n--- the rooms, in the order the station put them in ---');
const shuffled = sortChatRooms([
  { id: 'c', name: 'General', sort_order: 20 },
  { id: 'a', name: 'Officers', sort_order: 10 },
  { id: 'b', name: 'New room', sort_order: 20 },
  { id: 'd', name: 'Unordered' },
]);
// 'General' and 'New room' share an order, so the NAME decides - which is the half of the rule my first pass got wrong.
check('by order, then by name', shuffled.map((room) => room.id), ['a', 'c', 'b', 'd']);
check('a room with no order sorts last', shuffled[3].sort_order, 999);
check('and an empty list is an empty list', sortChatRooms(undefined), []);

// ---------------------------------------------------------------------------------------------------
console.log('\n--- who may edit and remove what ---');
const flags = { editOwn: true, deleteOwn: true, editOthers: false, deleteOthers: false };
const mineMessage = { id: 'm', author_id: 'me', body: 'mine' };
const otherMessage = { id: 'm', author_id: 'someone-else', body: 'theirs' };
check('a member may edit their own', canEditChatMessage({ flags, message: mineMessage, viewerId: 'me' }), true);
check('and may not edit somebody else\'s', canEditChatMessage({ flags, message: otherMessage, viewerId: 'me' }), false);
check('nor remove it', canDeleteChatMessage({ flags, message: otherMessage, viewerId: 'me' }), false);
const moderator = { editOwn: false, deleteOwn: false, editOthers: true, deleteOthers: true };
check('a moderator may edit yours', canEditChatMessage({ flags: moderator, message: otherMessage, viewerId: 'me' }), true);
check('and remove it', canDeleteChatMessage({ flags: moderator, message: otherMessage, viewerId: 'me' }), true);
// THE FOUR FLAGS ARE FOUR, and this is the pair that proves it: an officer given the ability to remove a message has not
// thereby been given the ability to rewrite it.
check('editing others does not imply removing them', canDeleteChatMessage({ flags: { editOthers: true }, message: otherMessage, viewerId: 'me' }), false);
check('editing your own does not imply editing others', canEditChatMessage({ flags: { editOwn: true }, message: otherMessage, viewerId: 'me' }), false);
// A REMOVED MESSAGE IS NOBODY'S TO TOUCH, moderator included: rewriting one would put text back under a "removed"
// heading, and the flag that allows editing is not an undo.
check('nobody edits a removed message', canEditChatMessage({ flags: moderator, message: { ...otherMessage, deleted_at: 1 }, viewerId: 'me' }), false);
check('and nobody removes it twice', canDeleteChatMessage({ flags: moderator, message: { ...otherMessage, deleted_at: 1 }, viewerId: 'me' }), false);
check('a row with no id is not editable', canEditChatMessage({ flags: moderator, message: { author_id: 'me' }, viewerId: 'me' }), false);
check('and a signed-out viewer owns nothing', canEditChatMessage({ flags, message: mineMessage, viewerId: '' }), false);

console.log('\n--- the six permissions, as the screen asks them ---');
const role = {
  can_use_chat: true,
  can_edit_own_chat_messages: true,
  can_delete_others_chat_messages: true,
};
const parsed = chatPermissionsFrom(role);
check('the module opens', parsed.useChat, true);
check('managing rooms is separate from using chat', parsed.manageRooms, false);
check('the two that were granted are on', [parsed.editOwn, parsed.deleteOthers], [true, true]);
check('and the two that were not are off', [parsed.editOthers, parsed.deleteOwn], [false, false]);
check('an administrator has all six', Object.values(chatPermissionsFrom({ is_admin: true })).every(Boolean), true);
check('and a member with no chat permission has none', Object.values(chatPermissionsFrom({ can_use_chat: false })).some(Boolean), false);

console.log('\n--- the permission each ACTION needs, decided in one place ---');
check('editing your own', chatPermissionForAction({ action: 'edit', mine: true }), 'can_edit_own_chat_messages');
check('editing somebody else\'s', chatPermissionForAction({ action: 'edit', mine: false }), 'can_edit_others_chat_messages');
check('removing your own', chatPermissionForAction({ action: 'delete', mine: true }), 'can_delete_own_chat_messages');
check('removing somebody else\'s', chatPermissionForAction({ action: 'delete', mine: false }), 'can_delete_others_chat_messages');
check('and anything else needs only chat itself', chatPermissionForAction({ action: 'send', mine: true }), 'can_use_chat');

// ---------------------------------------------------------------------------------------------------
console.log('\n--- the row a message is stored as ---');
const conversation = { id: 'general', audience_keys: ['*', 'role:officer'] };
const stored = chatMessageDoc({
  conversation,
  author: { id: 'u1', name: 'Bo Diaz' },
  body: 'Engine 2 back in service  ',
  at: '2026-10-08 14:02:00',
  serverTimestamp: 'SERVER',
});
check('the conversation is on it', stored.conversation_id, 'general');
check('the author is on it', [stored.author_id, stored.author_name], ['u1', 'Bo Diaz']);
check('the tail of the body is trimmed', stored.body, 'Engine 2 back in service');
// THE PROOF, STAMPED FROM THE CONVERSATION RATHER THAN FROM THE CALLER: this is what makes a listener provable - and
// what a client is therefore never allowed to write.
check('the audience proof travels with it', stored.audience_keys, ['*', 'role:officer']);
check('and the time is the server\'s', [stored.created_at, stored.created_stamp], ['SERVER', '2026-10-08 14:02:00']);
check('a message from a caller cannot choose its own audience', chatMessageDoc({ conversation, author: { id: 'u1' }, body: 'x', at: '', serverTimestamp: 'S' }).audience_keys, ['*', 'role:officer']);
// Removing it empties the body and records who did it - the caller's id, never one from the request.
const removal = chatRemovalPatch({ actor: { id: 'u9', name: 'Jane Smith' }, at: '2026-10-08 15:00:00', serverTimestamp: 'S' });
check('a removal empties the body', removal.body, '');
check('and names who did it', [removal.deleted_by, removal.deleted_by_name], ['u9', 'Jane Smith']);

console.log('\n--- what the fan-out writes ---');
const inbox = chatInboxFields({ conversation: { id: 'general' }, message: { ...stored, id: 'm1' } });
check('the room it belongs to', inbox.conversation_id, 'general');
check('when it was said', inbox.last_at, 'SERVER');
check('and who said it', [inbox.last_author_id, inbox.last_author_name], ['u1', 'Bo Diaz']);
// NOTHING ABOUT HOW MUCH OF IT IS UNREAD, which is the point: that would be a per-member number the fan-out cannot know
// without reading every member's read position.
check('and NO unread number, deliberately', Object.keys(inbox).filter((key) => key.includes('unread') || key === 'read_count'), []);
const conversationFields = chatConversationFields({ message: { ...stored, id: 'm1' }, preview: 'Engine 2 back in service' });
check('the room records its own last line', conversationFields.last_preview, 'Engine 2 back in service');
check('and which message it was', conversationFields.last_message_id, 'm1');

console.log('\n--- who a message reaches ---');
const directory = [
  { id: 'u1', role_id: 'officer', rank_id: 'captain' },
  { id: 'u2', role_id: 'firefighter', rank_id: 'firefighter' },
  { id: 'u3', role_id: 'officer', rank_id: 'lieutenant' },
];
check('everyone reaches everyone', chatRecipientsFor({ audienceKeys: ['*'], users: directory }), ['u1', 'u2', 'u3']);
check('a role reaches that role', chatRecipientsFor({ audienceKeys: ['role:officer'], users: directory }), ['u1', 'u3']);
check('a rank reaches that rank', chatRecipientsFor({ audienceKeys: ['rank:captain'], users: directory }), ['u1']);
check('a member reaches that member', chatRecipientsFor({ audienceKeys: ['user:u2'], users: directory }), ['u2']);
// ONE ROW PER MEMBER, however many keys they match: a fan-out that wrote the same inbox twice would double every count.
check('two matching keys still reach one member once', chatRecipientsFor({ audienceKeys: ['role:officer', 'rank:captain'], users: directory }), ['u1', 'u3']);
check('an explicit member list reaches exactly those', chatRecipientsFor({ memberIds: ['u2', 'u3'], users: directory }), ['u2', 'u3']);
// AN EMPTY AUDIENCE REACHES NOBODY, which is the safe direction: a bug here leaves a badge unlit rather than handing
// somebody a room they were never granted.
check('an audience of nothing reaches nobody', chatRecipientsFor({ audienceKeys: [], users: directory }), []);
check('and neither does a key nobody holds', chatRecipientsFor({ audienceKeys: ['role:chief'], users: directory }), []);

console.log('\n--- whether the caller is in the conversation at all ---');
const room = { id: 'general', audience_keys: ['*'] };
const officers = { id: 'officers', audience_keys: ['role:officer'] };
check('everyone is in an open room', chatMemberProblem({ conversation: room, member: { id: 'u2' }, keys: ['role:firefighter'] }), '');
check('an officer is in the officers room', chatMemberProblem({ conversation: officers, member: { id: 'u1' }, keys: ['role:officer'] }), '');
check('a firefighter is not', chatMemberProblem({ conversation: officers, member: { id: 'u2' }, keys: ['role:firefighter'] }), 'You are not part of that conversation.');
check('a named member is in', chatMemberProblem({ conversation: { audience_keys: ['user:u2'] }, member: { id: 'u2' }, keys: [] }), '');
check('a missing room is refused', chatMemberProblem({ conversation: null, member: { id: 'u1' } }), 'That conversation does not exist.');
check('and a signed-out caller is refused', chatMemberProblem({ conversation: room, member: {} }), 'Sign in first.');
// A ROOM WITH NO AUDIENCE IS REACHED BY NOBODY, which mirrors the fan-out rather than contradicting it.
check('a room with no audience refuses everybody', chatMemberProblem({ conversation: { audience_keys: [] }, member: { id: 'u1' }, keys: ['role:officer'] }), 'You are not part of that conversation.');

console.log('\n--- the send button, and when it is greyed out ---');
// OFFLINE IS REFUSED, NOT QUEUED - see the note on chatSendProblem. The composer disables the button on this sentence, so
// what is asserted here is that the sentence exists and that it takes precedence over every other reason.
check('a message can be sent while online', chatSendProblem({ body: 'On our way', offline: false }), '');
check('an empty one cannot', chatSendProblem({ body: '', offline: false }), 'Write something first.');
check('and being offline stops it whatever is typed', chatSendProblem({ body: 'On our way', offline: true }), CHAT_OFFLINE_MESSAGE);
check('even an empty box', chatSendProblem({ body: '', offline: true }), CHAT_OFFLINE_MESSAGE);
check('the sentence says what to do about it', /offline/i.test(CHAT_OFFLINE_MESSAGE) && /cannot be sent/.test(CHAT_OFFLINE_MESSAGE), true);
// THE COMPOSER READS IT, in all three places that matter: the button's disabled state, the hint beside it, and the guard
// inside submit - a button that looked disabled but still sent on Enter would be the worst of both.
checkIs('the composer disables the button on it', /disabled=\{Boolean\(problem\) \|\| busy\}/.test(panelSource));
// THE CALL NOW CARRIES `hasGif`, and the check follows it rather than pinning the old string: what matters is that the
// guard is still there and still refuses before anything is sent - not the exact argument list, which grows every time the
// composer learns something new (the lesson from the alignment check earlier in this file).
checkIs('and refuses the keyboard path too', /if \(chatSendProblem\(\{ body: draft, offline, hasGif: Boolean\(pendingGif\) \}\) \|\| busy\) return;/.test(panelSource));
checkIs('showing the sentence while offline even with an empty box', /\{\(offline \|\| draft\) && problem &&/.test(panelSource));
checkIs('and it is the app\'s own offline state that reaches it', /offline=\{offline\}/.test(hostSource) && /offline=\{offline\}/.test(appSource));

// ---------------------------------------------------------------------------------------------------
console.log('\n--- the two halves AGREE, which is the thing that drifts ---');
// THE SAME LIMIT IN THREE PLACES: the composer, the callable, and the rule that validates a room's name. A limit that
// differs by one character is a message the composer accepts and the server refuses - or a room name the rules allow and
// the tab cannot save.
check('the body limit is the same on both sides', CHAT_BODY_MAX, SERVER_BODY_MAX);
check('and the preview width', CHAT_PREVIEW_MAX, SERVER_PREVIEW_MAX);
checkIs(
  "the room-name limit the rules enforce is the server's own",
  rulesSource.includes('size() <= 60') && SERVER_NAME_MAX === 60,
  `server says ${SERVER_NAME_MAX}`
);
check('the room rules refuse a nameless room', chatRoomProblem({ name: '', audience_keys: ['*'] }), 'A room needs a name.');
check('and a room nobody can see', chatRoomProblem({ name: 'General', audience_keys: [] }), 'A room needs somebody who can see it.');

console.log('\n--- the emoji picker ---');
check('pressing one puts it first', nextEmojiRecents(['🔥', '👍'], '🚒')[0], '🚒');
check('pressing it again does not duplicate it', nextEmojiRecents(['🔥', '👍'], '🔥'), ['🔥', '👍']);
check('the list never grows past the cap', nextEmojiRecents(Array.from({ length: 30 }, (_, index) => `e${index}`), '🚒').length, 12);
check('and an empty press leaves the list alone', nextEmojiRecents(['🔥'], ''), ['🔥']);
check('the groups are grouped', CHAT_EMOJI_GROUPS.every((group) => group.label && group.emoji.length), true);

// ---------------------------------------------------------------------------------------------------
console.log('\n--- the wiring: what carries the decisions above into production ---');
// THE RULES. Each of these is a sentence in the file rather than a shape a test could infer, so they are asserted as
// sentences: the audience proof is checked with the same hasAny the query uses, no client writes a message, and a member
// may write only their own read mark.
checkIs('a message read is proved by its audience keys', /resource\.data\.get\('audience_keys', \[\]\)\.hasAny\(viewerKeys\(\)\)/.test(rulesSource));
checkIs('and by membership for a private conversation', /resource\.data\.get\('member_ids', \[\]\)\.hasAny\(\[uid\(\)\]\)/.test(rulesSource));
checkIs('no client writes a message', /allow create, update, delete: if false;/.test(rulesSource));
checkIs('a room is validated before it is saved', /request\.resource\.data\.get\('audience_keys', \[\]\) is list/.test(rulesSource));
checkIs('a member may write their own read mark', /affectedKeys\(\)\.hasOnly\(\['read_count', 'muted'\]\)/.test(rulesSource));
checkIs('and only on their own row', /match \/chat_inbox\/\{memberId\}\/rooms\/\{conversationId\}/.test(rulesSource));
checkIs('the messages are a subcollection of the conversation', /match \/chat_conversations\/\{conversationId\}/.test(rulesSource) && /match \/messages\/\{messageId\}/.test(rulesSource));

// THE FUNCTIONS. Each asserted by name, because a callable that was never exported is a client that fails at the first
// message with no hint why.
for (const name of ['sendChatMessage', 'editChatMessage', 'deleteChatMessage']) {
  checkIs(`the ${name} callable is exported`, new RegExp(`exports\\.${name} = onCall`).test(indexSource));
}
checkIs('the fan-out is a trigger on a new message', /exports\.onChatMessageCreated = onDocumentCreated\(/.test(indexSource) && indexSource.includes('chat_conversations/{conversationId}/messages/{messageId}'));
checkIs('the fan-out INCREMENTS the count rather than reading it', /count: FieldValue\.increment\(1\)/.test(indexSource));
checkIs('a deleted room takes its messages with it', /exports\.onChatConversationDeleted = onDocumentDeleted\(/.test(indexSource) && /db\.recursiveDelete\(/.test(indexSource));
checkIs('the fan-out skips a member who cannot use chat', /chatMayUseChat\(roles, byId\[uid\]\)/.test(indexSource));
// EVERY CHAT CALLABLE ASKS THE CHAT PERMISSION FIRST - asserted one by one rather than by counting how many times the call
// appears, because a count is a number somebody has to remember to update when they add a callable, and what matters is
// that the NEW one asks too. (Adding the thread opener and the picker's list is what broke the count.)
for (const name of ['sendChatMessage', 'editChatMessage', 'deleteChatMessage', 'openChatThread', 'getChatPeople']) {
  const from = indexSource.indexOf(`exports.${name} = onCall`);
  checkIs(
    `${name} checks can_use_chat`,
    from >= 0 && /requirePermission\([^)]*'can_use_chat'/.test(indexSource.slice(from, from + 900))
  );
}
// THE FOUR MESSAGE PERMISSIONS ARE ASKED ON THE SERVER, not only in the UI: a client that hid the button could still
// send the request, so the check that matters is the one the callable makes.
checkIs('and the pair that governs the act on that message', (indexSource.match(/chatPermissionForAction\(\{ action: '(edit|delete)', mine:/g) || []).length === 2);
checkIs('with a refusal when it is not granted', /if \(!\(await callerMay\(uid, flag\)\)\)/.test(indexSource));

// THE ROUTES AND THE CLIENT READS. A route that is not declared is a feature switched off - and since the sheet backend
// went, null means the call FAILS (see services/firestoreRouting.js), so a missing declaration is not a fallback.
checkIs('the chat feature is declared in the router', /\n  chat: \{/.test(routingSource));
for (const action of ['SEND_CHAT_MESSAGE', 'EDIT_CHAT_MESSAGE', 'DELETE_CHAT_MESSAGE', 'SAVE_CHAT_ROOM', 'ADMIN_DELETE_CHAT_ROOM', 'SET_CHAT_READ']) {
  checkIs(`the ${action} route is dispatched`, new RegExp(`\\n  ${action}: `).test(routingSource));
}
checkIs('the room list is a READER', /GET_CHAT_ROOMS: async \(uid\)/.test(readSource));
checkIs('the older pages are a READER too', /GET_CHAT_MESSAGES: async \(_uid, body\)/.test(readSource));

// THE LISTENERS, AND THE WINDOW - the one number that keeps an open conversation from re-reading its whole history.
checkIs('the conversation listener is windowed to one page', /limit\(CHAT_PAGE_SIZE\)/.test(liveSource));
checkIs('and the window is taken from the NEWEST messages', /orderBy\('created_at', 'desc'\)/.test(liveSource));
checkIs('and it asks for the same audience keys the rules check', /where\('audience_keys', 'array-contains-any', keys\)/.test(liveSource));
checkIs('the inbox listener is one collection on the member\'s own document', /collection\(db, 'chat_inbox', id, 'rooms'\)/.test(liveSource));
checkIs('and it is detached when the session ends', /return \(\) => stops\.forEach\(\(stop\) => stop\(\)\);/.test(liveSource));

// THE INDEXES. Every query above needs one, and a missing one is a runtime failure rather than a slow query - Firestore
// refuses a listener it cannot serve. Declared here so the next environment gets them with the deploy.
const indexFor = (collection, fields) =>
  indexes.indexes.some(
    (entry) =>
      entry.collectionGroup === collection &&
      fields.every(([field, kind]) =>
        entry.fields.some((declared) => declared.fieldPath === field && (kind ? declared.arrayConfig === kind : Boolean(declared.order)))
      )
  );
checkIs('the rooms query has its index', indexFor('chat_conversations', [['audience_keys', 'CONTAINS'], ['sort_order']]));
checkIs('and the message window has its own', indexFor('messages', [['audience_keys', 'CONTAINS'], ['created_at']]));
checkIs('the fan-out\'s cleanup is covered by a field override', indexes.fieldOverrides.some((entry) => entry.collectionGroup === 'rooms' && entry.fieldPath === 'conversation_id'));

// =====================================================================================================================
// PRIVATE CONVERSATIONS
// =====================================================================================================================
// The claims in this section are the ones that would be invisible if they were wrong: an id that is not stable merges two
// different pairs of people into one conversation (or splits one pair in two), and a member who should not be reachable
// either ends up in a thread they cannot open, or the person who tried is told nothing.
console.log('\n--- a private conversation ---');
// THE ID IS DERIVED FROM THE MEMBERS, sorted, so the same two people always find the same conversation - whichever of them
// presses "message" first, and whichever order they were picked in.
check('two members produce one id', chatThreadIdFor(['b', 'a']), chatThreadIdFor(['a', 'b']));
check('and it is stable', chatThreadIdFor(['a', 'b']), `${CLIENT_THREAD_PREFIX}a_b`);
check('the order they were picked in cannot matter', chatThreadIdFor(['b', 'a', 'c']), `${SERVER_THREAD_PREFIX}a_b_c`);
check('repeats are collapsed, not doubled', chatThreadIdFor(['a', 'a', 'b']), `${SERVER_THREAD_PREFIX}a_b`);
// ONE MEMBER IS NOT A CONVERSATION, and the id has to refuse it rather than mint a name nobody can find again.
check('one member is not a conversation', chatThreadIdFor(['a']), '');
check('nor is nobody', chatThreadIdFor([]), '');
check('nor an id that would merge with another', chatThreadIdFor(['a.b', 'c']), '');
// The client and the server must agree on the prefix: an id the server never mints is a thread the client never finds.
check('the client and the server agree on the prefix', CLIENT_THREAD_PREFIX, SERVER_THREAD_PREFIX);
check('and on how many members one may hold', CLIENT_THREAD_MAX, CHAT_THREAD_MEMBERS_MAX);

// WHO MAY BE IN ONE. `can_use_chat` arrives resolved, because it is a role lookup rather than a fact about the person.
const me = { id: 'a', name: 'Ana' };
const chatty = { id: 'b', name: 'Ben', can_use_chat: true };
check('two members who may chat', chatThreadProblem({ member: me, members: [chatty] }), '');
check('signing in first is required', chatThreadProblem({ members: [chatty] }), 'Sign in first.');
check('somebody else is required', chatThreadProblem({ member: me, members: [] }), 'Choose at least one other member.');
check('yourself does not count as somebody else', chatThreadProblem({ member: me, members: [{ ...me, can_use_chat: true }] }), 'Choose at least one other member.');
check('a member who cannot chat is not messaged', chatThreadProblem({ member: me, members: [{ id: 'b', name: 'Ben', can_use_chat: false }] }), 'Ben cannot use chat.');
check('nor is a member who has left', chatThreadProblem({ member: me, memberIds: ['gone'], members: [] }), 'One of those members is no longer in the station.');
check('a member who left is named even when others were found', chatThreadProblem({ member: me, memberIds: ['b', 'gone'], members: [chatty] }), 'One of those members is no longer in the station.');
check('a member whose id cannot form a thread is named', chatThreadProblem({ member: me, members: [{ id: 'a.b', name: 'Odd', can_use_chat: true }] }), 'Odd cannot be messaged.');
check('and too many members is refused', chatThreadProblem({ member: me, members: Array.from({ length: CHAT_THREAD_MEMBERS_MAX }, (_, index) => ({ id: `u${index}`, name: `U${index}`, can_use_chat: true })) }).startsWith('A private conversation holds up to'), true);

// THE DOCUMENT. The audience keys ARE the members - which is what makes the room list, the badges and the message rules
// work without any of them knowing this is a private conversation.
const thread = chatThreadDoc({
  memberIds: ['b', 'a'],
  memberNames: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Ben' }],
  creator: me,
  now: '2026-01-01 09:00:00',
});
check('the audience is the members', thread.audience_keys, ['user:a', 'user:b']);
check('and the members are sorted beside them', thread.member_ids, ['a', 'b']);
check('with their names in the same order', thread.member_names, ['Ana', 'Ben']);
check('a thread is marked as one', [thread.kind, isThread(thread), isServerThread(thread)], ['private', true, true]);
check('and carries NO name of its own', thread.name, '');
check('a room is not a thread', [isThread({ id: 'r', name: 'General' }), isServerThread({ id: 'r' })], [false, false]);
// WHAT THE MEMBER SEES IT CALLED, which is the one thing the server cannot work out: it does not know who is reading.
check('a room shows its own name', chatThreadTitle({ room: { name: 'Officers' }, viewerId: 'a' }), 'Officers');
check('a thread is titled with the other member', chatThreadTitle({ room: thread, viewerId: 'a' }), 'Ben');
check('and from the other end', chatThreadTitle({ room: thread, viewerId: 'b' }), 'Ana');
check('a group thread lists the others', chatThreadTitle({ room: { member_ids: ['a', 'b', 'c'], member_names: ['Ana', 'Ben', 'Cass'] }, viewerId: 'a' }), 'Ben, Cass');
check('and a thread nobody is named in still has a title', chatThreadTitle({ room: { member_ids: ['a'] }, viewerId: 'a' }), 'Private conversation');

// THE LIST: rooms first, each kind ordered by what it has.
console.log('\n--- the room list, with both kinds in it ---');
const listed = sortChatRooms([
  { id: 'dm_1', kind: 'private', member_ids: ['a', 'b'], member_names: ['Ana', 'Ben'], last_at: '2026-01-02 10:00:00' },
  { id: 'general', name: 'General', sort_order: 1 },
  { id: 'dm_2', kind: 'private', member_ids: ['a', 'c'], member_names: ['Ana', 'Cass'], last_at: '2026-01-03 10:00:00' },
]);
check('rooms come first, then private conversations', listed.map((room) => room.id), ['general', 'dm_2', 'dm_1']);
check('and the newer conversation is above the older one', listed[1].last_at > listed[2].last_at, true);
check('an unordered room still sorts by name', sortChatRooms([{ id: 'b', name: 'Bravo' }, { id: 'a', name: 'Alpha' }]).map((room) => room.name), ['Alpha', 'Bravo']);

// WHO THE PICKER OFFERS. The claim that matters is that this list and the thread opener give the same answer - a list that
// offers somebody the server refuses is a button that fails, and one that hides somebody the server allows is a
// conversation nobody knows they could have had.
console.log('\n--- who may be messaged ---');
const pickerDirectory = [
  { id: 'a', name: 'Ana', role_id: 'captain' },
  { id: 'b', name: 'Ben', role_id: 'firefighter' },
  { id: 'c', name: 'Cass', role_id: 'cadet' },
  { id: 'd', name: 'Dee', role_id: 'retired' },
];
const pickerRoles = [
  { id: 'captain', can_use_chat: true },
  { id: 'firefighter', can_use_chat: true },
  { id: 'cadet', can_use_chat: false },
  { id: 'retired', can_use_chat: false },
];
check(
  'you are offered everybody whose role grants chat, and not yourself',
  chatReachablePeople({ viewerId: 'a', users: pickerDirectory, roles: pickerRoles }).map((person) => person.name),
  ['Ben']
);
check(
  'and a role without chat is not offered at all',
  chatReachablePeople({ viewerId: 'a', users: pickerDirectory, roles: pickerRoles }).some((person) => person.id === 'c'),
  false
);
check(
  'a member with no role is not offered',
  chatReachablePeople({ viewerId: 'a', users: [{ id: 'e', name: 'Eve' }], roles: pickerRoles }).length,
  0
);
check(
  'the list is sorted by name, so the picker is not in whatever order the database returned',
  chatReachablePeople({ viewerId: 'a', users: [{ id: 'z', name: 'Zoe', role_id: 'captain' }, { id: 'b', name: 'Ben', role_id: 'captain' }], roles: pickerRoles }).map((person) => person.name),
  ['Ben', 'Zoe']
);
// THE AGREEMENT: whoever the picker offers, the opener accepts - asked through the same pair of functions the two callers use.
const pickerOffered = chatReachablePeople({ viewerId: 'a', users: pickerDirectory, roles: pickerRoles });
check(
  'everything offered is accepted by the thread opener',
  pickerOffered.map((person) => chatThreadProblem({ member: { id: 'a', name: 'Ana' }, memberIds: [person.id], members: [{ ...person, can_use_chat: true }] })),
  pickerOffered.map(() => '')
);
check(
  'and everybody left out is refused by it',
  ['c', 'd'].map((id) =>
    chatThreadProblem({
      member: { id: 'a', name: 'Ana' },
      memberIds: [id],
      members: [{ id, name: 'Somebody', can_use_chat: false }],
    })
  ),
  ['Somebody cannot use chat.', 'Somebody cannot use chat.']
);

// THE PICKER, asserted where it can be got wrong quietly: a panel that offered rows the server refuses, a room row that
// read `name` off a conversation that has none (every thread drawn as a blank line), or a list built from whatever the
// browser happens to know rather than from the server's answer.
console.log('\n--- the picker, and the panel that draws it ---');
for (const name of ['openChatThread', 'getChatPeople']) {
  checkIs(`the ${name} callable is exported`, new RegExp(`exports\\.${name} = onCall`).test(indexSource));
}
checkIs('the picker asks the server, rather than deciding for itself', /getChatPeople/.test(indexSource) && /fetchChatPeople/.test(hostSource));
checkIs('the people are fetched when the picker opens, not with the panel', /if \(picking\) onLoadPeople\?\.\(\)/.test(panelSource));
checkIs('the panel titles a conversation through chatThreadTitle', /labelFor\(room\)/.test(panelSource) && /labelFor\(activeRoom\)/.test(panelSource));
checkIs('and a room row is handed a title rather than reading room.name', /title=\{labelFor\(room\)\}/.test(panelSource) && !/\{room\.name\}/.test(panelSource));
checkIs('the cap the picker enforces is the server\'s own', /CHAT_THREAD_MEMBERS_MAX/.test(panelSource) && /CHAT_THREAD_MEMBERS_MAX/.test(serverSource));
checkIs('starting a conversation goes through the same door as opening one', /await loadRooms\(\);\s*openRoom\(id\);/.test(hostSource));
checkIs('both new actions are gated with chat, like the rest', /'OPEN_CHAT_THREAD'/.test(routingSource) && /'LIST_CHAT_PEOPLE'/.test(routingSource));
checkIs('and both are routed as callables', /OPEN_CHAT_THREAD: async/.test(routingSource) && /LIST_CHAT_PEOPLE: async/.test(routingSource));
// THE PICKER'S LIST COSTS THE PEOPLE WHO CAN BE MESSAGED, NOT THE SIZE OF THE STATION. It used to read the whole `users`
// collection and then decide who mattered, which bills for every member of the station to answer a question about a few of
// them - so the roles are read first and the member query is narrowed by them.
const pickerBody = indexSource.slice(indexSource.indexOf('exports.getChatPeople = onCall'), indexSource.indexOf('exports.editChatMessage'));
checkIs('the picker narrows its member read by the roles that grant chat', /where\('role_id', 'in'/.test(pickerBody));
checkIs('and does not read the whole users collection', !/collection\('users'\)\.get\(\)/.test(pickerBody));
// `in` takes thirty values at most, and a slice would silently drop a role's members - so it walks them in chunks.
checkIs('walking the roles in chunks rather than slicing them', /for \(let at = 0; at < chatty\.length; at \+= 30\)/.test(pickerBody));

// CHAT'S PUSH NOTIFICATIONS: which switch governs a message, what the phone says, and who is not notified. The switch itself
// is read by functions/index.js#deliverPush, so what is asserted here is the KEY it is asked about and the words it carries.
console.log('\n--- the push a message makes ---');
check('a station room uses the room switch', chatPushPreferenceFor({ id: 'general', name: 'General' }), 'notify_chat_rooms');
check('a private conversation uses its own', chatPushPreferenceFor({ id: 'dm_a_b', kind: 'private' }), 'notify_chat_direct');
checkIs('and the two are different switches', CHAT_PUSH_PREFERENCES.private !== CHAT_PUSH_PREFERENCES.room);
// THE KEYS ARE THE CONTRACT BETWEEN THE TWO HALVES: the switch is OFFERED by utils/notificationPrefs.js and ASKED ABOUT by
// functions/chat.js, so a key spelled differently in one of them is a switch a member can turn off that nothing ever reads -
// a broken promise with no symptom at all.
//
// READ AS SOURCE rather than imported, and that is not laziness: notificationPrefs.js imports `./rankEligibility` WITHOUT the
// extension (fine for Vite, which resolves it, and fatal for a plain Node harness), which is why its own verifier is built
// through `vite build --ssr` while this one is not. The keys are strings, so the assertion costs nothing by being textual.
const prefsSource = source('src/utils/notificationPrefs.js');
for (const key of Object.values(CHAT_PUSH_PREFERENCES)) {
  checkIs(`the ${key} switch is offered to members`, new RegExp(`key: '${key}'`).test(prefsSource));
  checkIs(`and ${key} is marked as a chat switch`, new RegExp(`key: '${key}'[\\s\\S]{0,700}?chatOnly: true`).test(prefsSource));
}
checkIs(
  'and the member-facing filter takes the chat permission',
  /visibleNotificationTypes = \(canApproveShifts, canUseChat/.test(prefsSource)
);
// WHAT THE PHONE SAYS. A thread has no name, so the author leads and the message follows; a room is named, so the room leads
// and the author labels the message.
check('a thread leads with who wants you', chatPushSummary({ conversation: { kind: 'private' }, message: { author_name: 'Ana', body: 'Can you cover me?' }, preview: 'Can you cover me?' }), { title: 'Ana', body: 'Can you cover me?' });
check('a room leads with the room', chatPushSummary({ conversation: { name: 'Officers' }, message: { author_name: 'Ben', body: 'Truck 2 is back' }, preview: 'Truck 2 is back' }), { title: 'Officers', body: 'Ben: Truck 2 is back' });
check('an unnamed author still says somebody', chatPushSummary({ conversation: {}, message: { body: 'Hello' }, preview: 'Hello' }), { title: 'Somebody', body: 'Hello' });
check('and a message with nothing in it is not blank', chatPushSummary({ conversation: {}, message: { author_name: 'Ana' } }), { title: 'Ana', body: 'Sent a message' });
checkIs('a long message is trimmed to what a notification shows', chatPushSummary({ conversation: {}, message: { author_name: 'Ana' }, preview: 'x'.repeat(400) }).body.length <= CHAT_PREVIEW_MAX);
// WHO IS NOT NOTIFIED: the author. The inbox row keeps them (see the fan-out) but a phone must not buzz for your own message.
check('the author is left out of the push', chatPushRecipients({ recipients: ['a', 'b', 'c'], authorId: 'b' }), ['a', 'c']);
check('everybody but the author is notified', chatPushRecipients({ recipients: ['a'], authorId: 'b' }), ['a']);
check('and a message to nobody notifies nobody', chatPushRecipients({ recipients: ['a'], authorId: 'a' }), []);

// ---------------------------------------------------------------------------------------------------
console.log('\n--- who is in a conversation, and who may change it ---');
// A THREAD, AND ITS MEMBERS. The three fields are the whole record of who is in it, and they are the thing that must never be
// written two-at-a-time: `member_ids` decides what the room list shows, `audience_keys` is the proof every rule checks, and a
// conversation whose two halves disagree is listed for one member and unreadable for another.
const group = { kind: 'private', member_ids: ['a', 'b'], member_names: ['Ana', 'Ben'] };
const cass = { id: 'c', name: 'Cass', can_use_chat: true };
check(
  'adding somebody writes all three fields together',
  Object.keys(chatParticipantPatch({ conversation: group, add: ['c'], members: [cass] })).sort(),
  ['audience_keys', 'member_ids', 'member_names']
);
check(
  'and they stay sorted, as the thread id was built from them',
  chatParticipantPatch({ conversation: group, add: ['c'], members: [cass] }),
  { member_ids: ['a', 'b', 'c'], member_names: ['Ana', 'Ben', 'Cass'], audience_keys: ['user:a', 'user:b', 'user:c'] }
);
// SORTED EVEN WHEN THE ADDED PERSON SORTS FIRST, which is where a list grown by appending would look right and be wrong.
check(
  'an added member who sorts first still lands in order',
  chatParticipantPatch({ conversation: group, add: ['0'], members: [{ id: '0', name: 'Zed' }] }).member_ids,
  ['0', 'a', 'b']
);
check(
  'and their name travels with their id',
  chatParticipantPatch({ conversation: group, add: ['0'], members: [{ id: '0', name: 'Zed' }] }).member_names,
  ['Zed', 'Ana', 'Ben']
);
// LEAVING IS A REMOVAL OF YOURSELF, so the same function serves it - and the names of the people who stayed come from what the
// conversation already stored rather than from a directory read.
check(
  'removing somebody keeps the names of the people who stayed',
  chatParticipantPatch({ conversation: group, remove: ['a'], members: [] }),
  { member_ids: ['b'], member_names: ['Ben'], audience_keys: ['user:b'] }
);
check(
  'adding and removing at once does both',
  chatParticipantPatch({ conversation: group, add: ['c'], remove: ['a'], members: [cass] }).member_ids,
  ['b', 'c']
);
// THE PRIVACY BEHAVIOUR, ASSERTED RATHER THAN ASSUMED: nothing here rewrites a message, so history belongs to the audience it
// was sent to. A member added today reads from today; a member removed stops seeing anything new. Both fall out of those three
// fields being the ONLY things the patch returns - which is why this is the check that keeps it that way.
check(
  'a membership change touches the conversation and nothing else',
  Object.keys(chatParticipantPatch({ conversation: group, add: ['c'], remove: ['a'], members: [cass] })).sort(),
  ['audience_keys', 'member_ids', 'member_names']
);

console.log('\n--- what a membership change is refused for ---');
// `me` is the fixture declared further up (Ana), reused here rather than declared again - and `asks` fixes the conversation and
// the directory so each case below reads as the one thing it is about.
const asks = (over) => chatParticipantProblem({ conversation: group, member: me, members: [cass], ...over });
// A STATION ROOM IS NOT A CONVERSATION ANYBODY CAN EDIT. Its audience is a role an officer sets, and being "removed from" a room
// is a sentence this app should never be able to say.
checkIs('a station room is refused, by name', /station room/.test(asks({ conversation: { name: 'General' }, add: ['c'] })));
check('signing in first is required', chatParticipantProblem({ conversation: group, add: ['c'] }), 'Sign in first.');
check('a conversation that is not there', chatParticipantProblem({ member: me, add: ['c'] }), 'That conversation does not exist.');
check('somebody who is not in it cannot change it', chatParticipantProblem({ conversation: group, member: { id: 'z' }, add: ['c'], members: [cass] }), 'You are not part of that conversation.');
check('adding a member of the station who can chat', asks({ add: ['c'] }), '');
check('adding somebody who cannot chat', asks({ add: ['c'], members: [{ id: 'c', name: 'Cass', can_use_chat: false }] }), 'Cass cannot use chat.');
check('adding somebody who has left the station', asks({ add: ['gone'], members: [] }), 'One of those members is no longer in the station.');
// NO-OPS ARE NOT ERRORS: a screen that has gone stale should not be told off about a fact that no longer differs.
check('adding somebody who is already in it', asks({ add: ['b'] }), '');
check('removing somebody who is not in it', asks({ remove: ['z'] }), '');
// THE FLOOR IS TWO, so the last removal is refused rather than performed - and the sentence says what leaving means, because
// the member trying it is about to ask why not.
checkIs('the last removal is refused', /needs two people/.test(asks({ remove: ['b'] })));
check('leaving a conversation of three', chatParticipantProblem({ conversation: { kind: 'private', member_ids: ['a', 'b', 'c'] }, member: me, remove: ['a'], members: [] }), '');
checkIs('and the cap still holds', /up to/.test(asks({ add: Array.from({ length: 30 }, (_, at) => `u${at}`), members: [] })));

// THE MEMBERS LIST, which is where removing somebody else lives. Asserted as WIRING rather than behaviour: the pure rules for
// adding and removing are covered above, and the view itself is RENDERED by verify-chat-render - what these keep in step is
// that the button opens the right view, that a removal goes through the same callable adding and leaving do, and that the list
// is built from the conversation row rather than from another read.
checkIs('the conversation offers who is in it', /setPickingFor\('members'\)/.test(panelSource));
checkIs('removing somebody calls the same operation as adding and leaving', /onChangeParticipants\?\.\(\{ conversationId: activeRoomId, remove: \[id\] \}\)/.test(panelSource));
checkIs('and the members list costs no read', /activeRoom\?\.member_names\?\.\[at\]/.test(panelSource));
checkIs('the picker draws a remove control per member', /onRemove\(person\.id\)/.test(panelSource));
// WHICH CONVERSATION THE LIST IS SHOWING is a real question now that the list and the conversation are on screen together,
// and it used to be hard-coded `false` - correct while the two could never be seen at once, and a list you have to match
// against the heading by eye as soon as they can.
checkIs('the list marks the conversation you are reading', /active=\{String\(activeRoom\?\.id \|\| ''\) === String\(room\.id\)\}/.test(panelSource));
// THE TWO-PANE LAYOUT IS ABOUT THE PANEL BEING WIDE, NOT THE WINDOW: every `md:` in these classes is behind `fullScreen`,
// because the docked panel is 24rem at any window size and a list column beside a conversation would leave neither usable.
checkIs('the list column is only a column at full width', /fullScreen \? 'md:w-72 md:flex-none md:border-r/.test(panelSource));
checkIs('and the conversation pane is only side-by-side at full width', /showConversation \? 'flex' : fullScreen \? 'hidden md:flex' : 'hidden'/.test(panelSource));
// BOTH PANES ASK TO GROW, WHICH IS THE FIX FOR ALMOST INVISIBLE BUG. A pane that does not is sized by its widest content -
// the message box, a `rows={1}` textarea - so the conversation drew in a narrow column with the rest of the row empty, and
// the bubbles aligned to each other instead of to the pane. Asserted as the GROW, because that is the property that was
// missing: `md:shrink-0` was there all along and did nothing about it.
checkIs('both panes fill the space they are given', (panelSource.match(/flex min-h-0 flex-1 flex-col/g) || []).length, 2);
checkIs('and the fixed column cancels the growth rather than only the shrinking', /md:w-72 md:flex-none/.test(panelSource));
// THE METADATA LINE HUGS ITS BUBBLE. It is aligned by the list item beside it - right for your own message, left for anybody
// else's - and a row that stretched across the panel would strand the controls at one edge and the time at the other, with the
// message in the middle of the gap. That is not a hypothetical: `w-full` was on this row, and it looked exactly like that.
checkIs('a message\'s metadata line does not stretch across the panel', !/mt-0\.5 flex w-full/.test(panelSource));
// THE ALIGNMENT SIDE, which moved when the face arrived. The ROW now does two jobs - placing the picture at the left for
// somebody else and nothing at all for you - and the alignment by author moved inside it, onto the column that holds the
// bubble, its reactions and its metadata. Asserted as the two decisions rather than as the whole class string, because the
// old check pinned `flex flex-col` and every word around it, so a change to the LAYOUT read as a change to the RULE.
checkIs('and it is aligned by the side the message is on', /\$\{mine \? 'items-end' : 'items-start'\}/.test(panelSource));
checkIs('with your own message kept to the right of the row', /\$\{mine \? 'justify-end'/.test(panelSource));
// The time is the LAST thing on that line, with nothing to its right and nothing pushing it: `ml-auto` only means something in a
// row that has spare width, and this row deliberately has none.
checkIs('the time ends the line rather than being pushed away from it', /\{when && <span className="shrink-0">/.test(panelSource));
checkIs('and offers a way back to adding from there', /onAddPeople=\{\(\) => \{/.test(panelSource) && /Add people/.test(panelSource));
// THE PICKER IS EXPORTED FOR THE RENDER HARNESS, which is the only check that actually runs this view. Asserted so nobody
// tidies the export away without noticing what depends on it.
checkIs('the picker is exported so it can be rendered', /export function ChatPeoplePicker\(/.test(panelSource) && /ChatPeoplePicker/.test(readFileSync('scripts/verify-chat-render.mjs', 'utf8')));

// A MESSAGE THE CALLABLE HAS JUST RETURNED: its `created_at` is the server's sentinel, not a time, so it parses as zero - and
// zero used to sort it to the TOP of the conversation, which is the bug this pins. It belongs at the END (it is the newest
// thing there is), and the listener's echo with the resolved timestamp must leave it exactly where it is.
check(
  'a message with no resolved timestamp yet goes to the END, not the beginning',
  mergeChatMessages(
    [{ id: 'm1', author_id: 'u2', body: 'Older', created_at: '2026-01-01 09:00:00' }],
    [{ id: 'm9', author_id: 'u1', body: 'Just sent', created_at: null }]
  ).map((row) => row.id),
  ['m1', 'm9']
);
check(
  'and when the echo resolves it, it stays at the end',
  mergeChatMessages(
    [{ id: 'm9', author_id: 'u1', body: 'Just sent', created_at: null }],
    [{ id: 'm9', author_id: 'u1', body: 'Just sent', created_at: '2026-01-01 09:05:00' }]
  ).map((row) => row.id),
  ['m9']
);
// TWO OF THEM KEEP A STABLE, ARBITRARY ORDER rather than the two of them swapping places under the member's cursor.
check(
  'two unresolved messages keep a stable order',
  mergeChatMessages([], [
    { id: 'b', body: 'x', created_at: null },
    { id: 'a', body: 'y', created_at: null },
  ]).map((row) => row.id),
  ['a', 'b']
);

// WHAT A MESSAGE HAS DONE: sending, sent, seen. Three words that are not a preference - they are what this design can honestly
// know (see utils/chat.js#deliveryStateFor, which explains why "delivered" is absent rather than forgotten).
console.log('\n--- what a message has done ---');
const CONVO = { kind: 'private', member_ids: ['a', 'b'], member_names: ['Ana', 'Ben'] };
const sentRow = { id: 'm1', author_id: 'a', created_at: '2026-01-01 09:00:00' };
check('a message whose timestamp has not resolved is SENDING', deliveryStateFor({ message: { id: 'm1', author_id: 'a', created_at: null }, conversation: CONVO, viewerId: 'a' }), 'sending');
check('and one the server has is SENT', deliveryStateFor({ message: sentRow, conversation: CONVO, viewerId: 'a', readAt: {} }), 'sent');
check('until the other member reads up to it', deliveryStateFor({ message: sentRow, conversation: CONVO, viewerId: 'a', readAt: { b: chatMillis('2026-01-01 09:00:00') } }), 'seen');
check('a read EARLIER than the message does not count', deliveryStateFor({ message: sentRow, conversation: CONVO, viewerId: 'a', readAt: { b: chatMillis('2026-01-01 08:59:00') } }), 'sent');
check('and the AUTHOR reading it does not either', deliveryStateFor({ message: sentRow, conversation: CONVO, viewerId: 'a', readAt: { a: chatMillis('2026-01-01 09:30:00') } }), 'sent');
// A CONVERSATION WITH NOBODY ELSE IN IT has nobody to be seen by, so it stops at SENT rather than claiming a receipt it can
// never receive.
check('a conversation of one is never seen', deliveryStateFor({ message: sentRow, conversation: { member_ids: ['a'] }, viewerId: 'a', readAt: { a: 99 } }), 'sent');
check('and a room with no member list is whatever the server said', deliveryStateFor({ message: sentRow, conversation: { name: 'General' }, viewerId: 'a' }), 'sent');
check('a row with no id has no state at all', deliveryStateFor({ message: { body: 'x' }, conversation: CONVO, viewerId: 'a' }), '');

// EMOJI REACTIONS: a map on the message, a curated set, and a toggle. The set is the picker's own "Reactions" group, because a
// reaction the server refuses and the picker offers is a button that fails - and that is asserted rather than assumed.
console.log('\n--- emoji reactions ---');
const REACTIONS_GROUP = CHAT_EMOJI_GROUPS.find((group) => group.label === 'Reactions');
// THE SERVER'S REACTION LIST AND THE PICKER'S MUST BE THE SAME SET, and "the picker's" means EVERY GROUP the picker draws -
// this compared against the Reactions group alone, which was the same thing while the server's list held only those sixteen.
// It now holds every emoji the picker offers, so the comparison is against the flattened groups: two lists that must agree,
// sorted because their ORDER is about how the picker groups them and this is about membership.
check(
  'the server offers exactly the picker\'s reaction set',
  [...CHAT_REACTION_EMOJI].sort(),
  [...CHAT_EMOJI_GROUPS.flatMap((group) => group.emoji)].sort()
);
check('a tap adds the member', chatReactionToggled({ reactions: {}, emoji: '👍', memberId: 'a' }), { '👍': ['a'] });
check('a second tap takes them out', chatReactionToggled({ reactions: { '👍': ['a'] }, emoji: '👍', memberId: 'a' }), {});
check('somebody else keeping it leaves the pill standing', chatReactionToggled({ reactions: { '👍': ['a', 'b'] }, emoji: '👍', memberId: 'a' }), { '👍': ['b'] });
check('and a second member joins the first', chatReactionToggled({ reactions: { '👍': ['a'] }, emoji: '👍', memberId: 'b' }), { '👍': ['a', 'b'] });
// AN EMPTY LIST IS DROPPED, not kept: a ghost key still counts towards the cap and would draw a pill with nobody behind it.
check('an emoji nobody is behind is removed, not emptied', chatReactionToggled({ reactions: { '👍': ['a'], '🔥': [] }, emoji: '🔥', memberId: 'b' }), { '👍': ['a'], '🔥': ['b'] });
check('and a stray empty list is cleared on the way through', chatReactionToggled({ reactions: { '🔥': [] }, emoji: '', memberId: '' }), {});
// THE CAPS: eight distinct reactions, and a station's worth of members behind one of them.
const eight = Object.fromEntries(CHAT_REACTION_EMOJI.slice(0, CHAT_REACTION_MAX).map((emoji, at) => [emoji, [`u${at}`]]));
check('a ninth distinct reaction is refused', chatReactionToggled({ reactions: eight, emoji: CHAT_REACTION_EMOJI[CHAT_REACTION_MAX], memberId: 'z' }), eight);
check('but joining one of the eight is not', chatReactionToggled({ reactions: eight, emoji: CHAT_REACTION_EMOJI[0], memberId: 'z' })[CHAT_REACTION_EMOJI[0]].length, 2);

console.log('\n--- what a reaction is refused for ---');
const reactable = { id: 'm1', conversation_id: 'general', audience_keys: ['role:captain'], member_ids: [] };
const reacts = (over) => chatReactionProblem({ message: reactable, member: { id: 'a', name: 'Ana' }, emoji: '👍', keys: ['role:captain'], ...over });
check('a member of the room may react', reacts({}), '');
check('signing in first is required', chatReactionProblem({ message: reactable, emoji: '👍' }), 'Sign in first.');
check('a message that is not there', reacts({ message: null }), 'That message is not there any more.');
check('a message that was removed', reacts({ message: { ...reactable, deleted_at: '2026-01-01 09:00:00' } }), 'A removed message cannot be reacted to.');
check('an emoji that is not one of the set', reacts({ emoji: '🦄' }), 'That is not one of the reactions.');
check('and something that is not an emoji at all', reacts({ emoji: 'DELETE' }), 'That is not one of the reactions.');
// THE TWO WAYS INTO A CONVERSATION: named on the row, or reached by the caller's own keys - which is how a station room works,
// since a room has no member list to be on.
check('somebody named on the row may react', reacts({ message: { ...reactable, member_ids: ['a'] }, keys: [] }), '');
check('somebody the audience does not reach may not', reacts({ keys: ['role:firefighter'] }), 'You are not part of that conversation.');
check('and a message with no audience at all is refused rather than open', reacts({ message: { ...reactable, audience_keys: [] } }), 'You are not part of that conversation.');
check('a message with no conversation is not reactable', reacts({ message: { ...reactable, conversation_id: '' } }), 'That message is not in a conversation.');

// WHAT A MESSAGE ROW CARRIES, which is where a shaped row bites: `chatMessageRow` PICKS its fields, so a map added to a message
// on the server is invisible to the screen until it is named there. Reactions were being written, stored, and silently dropped
// on the way - the feature would have looked like "the server does not save reactions" - so this is asserted rather than assumed.
console.log('\n--- what a message row carries through ---');
check('a row keeps its reactions', chatMessageRow({ id: 'm1', reactions: { '👍': ['a'] } }).reactions, { '👍': ['a'] });
check('a message with no reactions has an empty map', chatMessageRow({ id: 'm1' }).reactions, {});
// AND THE SAME FOR EVERY OTHER FIELD A MESSAGE GAINS ON THE SERVER. This function picks its fields, so it has swallowed two
// things already (reactions, then the author's rank) and both looked like a broken feature rather than like a missing name here.
// The check is deliberately about the FIELD surviving, not about the value: what matters is that a row carrying it still has it.
check('a row keeps the author\'s rank', chatMessageRow({ id: 'm1', author_rank_id: 'captain' }).author_rank_id, 'captain');
check('and a row without one shapes to an empty string rather than undefined', chatMessageRow({ id: 'm1' }).author_rank_id, '');
check('a row keeps the author\'s picture', chatMessageRow({ id: 'm1', author_avatar_url: 'https://example.test/a.png' }).author_avatar_url, 'https://example.test/a.png');
check('and a row without one shapes to an empty string', chatMessageRow({ id: 'm1' }).author_avatar_url, '');
check(
  'a message carries the author\'s picture',
  chatMessageDoc({
    conversation: { id: 'general' },
    author: { id: 'a', name: 'Ana', avatar_url: 'https://example.test/a.png' },
    body: 'Hello',
    at: 'now',
    serverTimestamp: null,
  }).author_avatar_url,
  'https://example.test/a.png'
);

check('an emoji nobody is behind is dropped on the way in', reactionMapOf({ '👍': ['a'], '🔥': [] }), { '👍': ['a'] });
check('and so is an entry that is not a list of ids', reactionMapOf({ '👍': ['a'], '🔥': 'b' }), { '👍': ['a'] });
check('nothing at all shapes to nothing', reactionMapOf(null), {});
// AND THEY SURVIVE THE MESSAGE BEING REMOVED: the words are emptied because they are gone, but a reaction was somebody's answer
// to them - taking the message back does not take back what people made of it.
check(
  'a removed message keeps what people made of it',
  chatMessageRow({ id: 'm1', deleted_at: '2026-01-01 09:00:00', reactions: { '👍': ['a'] } }).reactions,
  { '👍': ['a'] }
);
// THE UI, asserted where it can go quietly wrong: the pill toggles, and it says which state it is in without colour.
checkIs('each bubble draws its reactions as pills', /reactionRows\.map\(\(\[emoji, count, mineReacted\]\)/.test(panelSource));
checkIs('a pill says whether it is yours without relying on colour', /aria-pressed=\{mineReacted\}/.test(panelSource));
// REACTING IS NOT EDITING, so the control for it sits OUTSIDE the block that appears only for messages a member may change -
// which is a position rather than an intention, and the position is what is asserted.
//
// IT NOW SITS BEFORE THAT BLOCK RATHER THAN AFTER IT, because the line's order from the right is "the time, the tick, the
// pencil, the bin" - and a smiley between the tick and the time pushed the receipt away from the timestamp it belongs with.
// So the assertion changed from "after the controls" to what it was always really about: not INSIDE them, and not between the
// two things that belong together.
checkIs(
  'the react control is outside the edit and delete controls, not inside them',
  panelSource.indexOf('aria-label="React to this message"') < panelSource.indexOf('aria-label="Remove this message"')
);
// THE POPOVER IT OPENS HAS TO BE ANCHORED. `absolute` measures from the nearest POSITIONED ancestor rather than from the
// button, so a picker inside a plain flex row is drawn against the PAGE: "just above the button" becomes "just above the
// top of the document", which is to say off-screen and invisible. That is what "reacting to my own message does nothing"
// was, and `relative` on the wrapper is the whole of the fix - so it is asserted, since nothing else can see it.
checkIs(
  'the react popover hangs off a positioned box of its own',
  /className="relative flex shrink-0 items-center"[\s\S]{0,1200}?<EmojiPicker/.test(panelSource)
);
checkIs('and the picker grows from the side the message is on', /align=\{mine \? 'right' : 'left'\}/.test(panelSource));
checkIs('and the bubble is given it by the panel', /onReact=\{onReact\}/.test(panelSource));

// THE AUTHOR'S RANK RIDES THE ROW, like their name, so drawing thirty messages is not thirty directory lookups. The ID is what
// travels and the icon is drawn from it, because the icon belongs to the rank: a station that repaints "Officer" repaints it in
// a message list too.
console.log('\n--- the rank beside an author ---');
check(
  'a message carries the author\'s rank',
  chatMessageDoc({
    conversation: { id: 'general', audience_keys: ['role:captain'] },
    author: { id: 'a', name: 'Ana', rank_id: 'captain' },
    body: 'Hello',
    at: '2026-01-01 09:00:00',
    serverTimestamp: null,
  }).author_rank_id,
  'captain'
);
check(
  'and a member with no rank carries an empty one rather than nothing',
  chatMessageDoc({ conversation: { id: 'general' }, author: { id: 'a', name: 'Ana' }, body: 'Hello', at: 'now', serverTimestamp: null }).author_rank_id,
  ''
);

// ---------------------------------------------------------------------------------------------------
// THE PICTURE ON A MESSAGE. The fixtures below are NOT invented: the numbers are copied from a real KLIPY trending
// response, because the whole point of this code is which of the twenty assets it picks, and made-up sizes would have let
// it pass while storing a megabyte.
console.log('\n--- the picture on a message ---');
const KLIPY_ITEM = {
  title: "Friends Joey: Yeah Baby! It's Friday!",
  file: {
    hd: {
      gif: { url: 'https://static.klipy.com/ii/39f2/c7/d9/XKufQP6s.gif', width: 498, height: 249, size: 1050083 },
      webp: { url: 'https://static.klipy.com/ii/39f2/c7/d9/zGNkmMep.webp', width: 498, height: 249, size: 29692 },
      jpg: { url: 'https://static.klipy.com/ii/39f2/c7/d9/jQrUep2k.jpg', width: 498, height: 249, size: 10157 },
      mp4: { url: 'https://static.klipy.com/ii/39f2/c7/d9/vp32Bz4c.mp4', width: 640, height: 320, size: 193725 },
    },
    md: {
      gif: { url: 'https://static.klipy.com/ii/39f2/c7/d9/cPab6CUZ.gif', width: 640, height: 320, size: 153776 },
      webp: { url: 'https://static.klipy.com/ii/39f2/c7/d9/PNSwkzzA.webp', width: 640, height: 320, size: 349674 },
    },
    sm: {
      gif: { url: 'https://static.klipy.com/ii/39f2/c7/d9/TOC8l9zN.gif', width: 220, height: 110, size: 20432 },
      webp: { url: 'https://static.klipy.com/ii/39f2/c7/d9/SDBtGAqY.webp', width: 220, height: 110, size: 55824 },
    },
  },
};
const chosen = gifAssetFor(KLIPY_ITEM);
// 29 KB, WHICH IS THE 1 MB GIF AT THE SAME SIZE - a 35x saving on the file every member of the station downloads, chosen
// because it is the smallest thing wide enough to see rather than because it is the format somebody assumed.
check('the smallest asset wide enough to read is the one stored', chosen.url, 'https://static.klipy.com/ii/39f2/c7/d9/zGNkmMep.webp');
check('and its size travels with it, so the bubble can reserve the space', [chosen.width, chosen.height], [498, 249]);
check('a thumbnail is never chosen, however small the file', chosen.width >= GIF_MIN_WIDTH, true);
// THE FALLBACK IS THE GIF OF THE SAME SIZE, for the browsers that cannot animate a webp.
check('with the gif of the same size kept for a browser that cannot show webp', chosen.fallbackUrl, 'https://static.klipy.com/ii/39f2/c7/d9/XKufQP6s.gif');
// AND WHEN THE GIF IS THE SMALLER FILE, THE GIF IS WHAT IS STORED - the check that says "by size" rather than "webp
// always": the 640x320 gif is 150 KB against a 342 KB webp of the same size.
const mdOnly = gifAssetFor({ title: 'x', file: { md: KLIPY_ITEM.file.md } });
check('and the format loses to the file size when they disagree', mdOnly.url, 'https://static.klipy.com/ii/39f2/c7/d9/cPab6CUZ.gif');
check('with no fallback needed, because the picture already is a gif', mdOnly.fallbackUrl, '');
check('an item with nothing usable is null rather than a broken message', gifAssetFor({ file: { sm: {} } }), null);
check('a still jpg is not a gif somebody asked for', gifAssetFor({ file: { md: { jpg: KLIPY_ITEM.file.hd.jpg } } }), null);

// THE ALT TEXT. KLIPY's own title, tidied, because it is written for a person and it is the whole content of a message
// whose whole content is a picture.
check('the description is tidied', gifAltFrom('  Joey:  Yeah   Baby!  '), 'Joey: Yeah Baby!');
check('and capped, because a title is not a paragraph', gifAltFrom('x'.repeat(500)).length, 200);

// THE LINK RULE, on both sides of the wire. The server's copy is the one that decides; the client's exists so somebody
// reads a sentence instead of a permission error. Asserted together, and asserted to AGREE, because rules and JavaScript
// cannot share a constant and a pair that drifts is a feature that half-works.
const GOOD = 'https://static.klipy.com/ii/39f2/c7/d9/zGNkmMep.webp';
check('a klipy link is accepted by both', [gifUrlProblem(GOOD), chatGifProblem({ url: GOOD, width: 498, height: 249, alt: 'x' })], ['', '']);
check('the two copies name the same host', KLIPY_MEDIA_SUFFIX, SERVER_GIF_SUFFIX);
check('another host is refused by both', [
  gifUrlProblem('https://example.test/a.webp') !== '',
  chatGifProblem({ url: 'https://example.test/a.webp', width: 10, height: 10 }) !== '',
], [true, true]);
// A HOST THAT MERELY ENDS WITH THE SAME LETTERS IS NOT THE SAME HOST, which is the mistake an `includes` check would make.
check('a lookalike host is refused', gifUrlProblem('https://notklipy.com/a.webp'), 'Pictures have to come from KLIPY.');
check('and so is a klipy subdomain of somebody else', gifUrlProblem('https://static.klipy.com.evil.test/a.webp') !== '', true);
check('plain http is refused', gifUrlProblem('http://static.klipy.com/a.webp') !== '', true);
check('and so is something that is not a url at all', gifUrlProblem('not a url') !== '', true);
// The dimensions are required by the server, because a picture with no size is one the reader's screen cannot make room
// for - and the client always sends them.
check('the server insists on a size', chatGifProblem({ url: GOOD }) !== '', true);
check('and refuses an absurd one', chatGifProblem({ url: GOOD, width: 99999, height: 10 }) !== '', true);
check('a message with no picture is not a problem', chatGifProblem({}), '');
check('the fields written are the five a reader needs, and no more', Object.keys(chatGifFields({ url: GOOD, width: 498, height: 249, alt: 'hi', id: 1, slug: 'x' })), [
  'gif_url',
  'gif_fallback_url',
  'gif_width',
  'gif_height',
  'gif_alt',
]);

// ON THE ROW, both when there is a picture and when there is not: a fourth field swallowed by the shaper would be one too
// many, and the empty case matters because most messages are text.
const gifMessage = chatMessageDoc({
  conversation: { id: 'general' },
  author: { id: 'a', name: 'Ana' },
  body: '',
  gif: { url: GOOD, fallback_url: '', width: 498, height: 249, alt: 'Joey' },
  at: 'now',
  serverTimestamp: null,
});
check('a message carries the picture', [gifMessage.gif_url, gifMessage.gif_width, gifMessage.gif_alt], [GOOD, 498, 'Joey']);
check('and the row the screen reads is shaped from it', [chatMessageRow(gifMessage).gif_url, chatMessageRow(gifMessage).gif_height], [GOOD, 249]);
check('a message with no picture shapes to empties rather than undefined', [chatMessageRow({ id: 'm1' }).gif_url, chatMessageRow({ id: 'm1' }).gif_width], ['', 0]);
// A PICTURE AND NOTHING ELSE IS A MESSAGE. `allowEmpty` is what makes that true without weakening the rule for text.
check('an empty message is still refused', chatWriteProblem(''), 'A message cannot be empty.');
check('but not when it is a picture', chatWriteProblem('', { allowEmpty: true }), '');
check('and the aspect ratio is written the way CSS wants it', gifAspectRatio({ width: 498, height: 249 }), '498 / 249');

// ---------------------------------------------------------------------------------------------------
// A REAL SEARCH RESPONSE, reduced to two items, with the shape the API actually sends: `data.data` for the results and
// `current_page` / `per_page` / `has_next` beside it, inside `data` (confirmed against the live API, not from the docs).
console.log('\n--- what a search comes back as ---');
const PAGE = {
  result: true,
  data: {
    data: [
      { id: 3099789675423802, slug: 'friends-joey-53', title: 'Friends Joey: Yeah Baby!', file: KLIPY_ITEM.file },
      { id: 11, slug: 'nothing-usable', title: 'Nothing here', file: { sm: { gif: { url: 'https://static.klipy.com/a.gif', width: 100, height: 50, size: 9 } } } },
    ],
    current_page: 2,
    per_page: 24,
    has_next: true,
  },
};
const results = gifResultsFrom(PAGE);
// THE RESULT WITH NOTHING WIDE ENOUGH IS DROPPED rather than drawn as a blurred tile - and, more importantly, it is not
// silently stored as a message: a 100px file blown up in a bubble is worse than the picture not being offered at all.
check('a result is only kept when there is something to draw', results.gifs.length, 1);
check('the paging is read from the response', [results.page, results.hasNext], [2, true]);
check('the id is a string, like every other id in this app', typeof results.gifs[0].id, 'string');
// TWO FILES FOR ONE RESULT, AND THEY ARE NOT THE SAME ONE: the grid draws the tile and the message stores the FULL-size
// choice. Sending the tile is the mistake that puts a 220px blur in front of the whole station.
check('the grid gets the small file and the message gets the big one', results.gifs[0].previewUrl !== results.gifs[0].asset.url, true);
check('the tile is the smallest thing worth drawing', results.gifs[0].width >= 120 && results.gifs[0].asset.width >= 300, true);
check('and the message would store the 29 KB webp, not the megabyte gif', results.gifs[0].asset.bytes, 29692);
check('a response with no results is an empty page rather than a crash', gifResultsFrom({ result: true, data: {} }).gifs, []);

// THE WIRING, read as source because it is about strings that must not drift. Three of them, and each has bitten somebody:
// the key lives in the PATH (KLIPY's design, and the reason there is no Cloud Function), the placeholder and the mark are
// KLIPY's TERMS, and the picture is passed as its own argument so a caption stays a caption.
const gifServiceSource = readFileSync(new URL('../src/services/gifSearch.js', import.meta.url), 'utf8');
const gifPickerSource = readFileSync(new URL('../src/components/Chat/GifPicker.jsx', import.meta.url), 'utf8');
checkIs('the key travels in the api path, as the API requires', /KLIPY_API_BASE}\/\$\{encodeURIComponent\(key\)\}/.test(gifServiceSource));
checkIs('and is read from the web config rather than hard-coded', /import\.meta\.env/.test(gifServiceSource) && /VITE_KLIPY_API_KEY/.test(gifServiceSource));
checkIs('nothing about the member is sent to KLIPY', !/customer_id|user_id/.test(gifServiceSource));
checkIs('the search box carries the wording KLIPY asks for', /placeholder="Search KLIPY"/.test(gifPickerSource));
checkIs('and their mark is shown', /Powered by KLIPY/.test(gifPickerSource));
checkIs('the picture is sent as its own argument, not as text', /onSend\?\.\(body, pendingGif \|\| undefined\)/.test(panelSource));
checkIs('and a message that is only a picture is allowed to be sent', /hasGif: Boolean\(pendingGif\)/.test(panelSource));

// ---------------------------------------------------------------------------------------------------
// THE REACTION LIST, IN TWO PACKAGES, AND THIS IS THE CHECK THAT KEEPS THEM TOGETHER.
//
// The picker beside a message must offer exactly what the server accepts, and the two lists cannot share a constant: one is
// in the site's build, the other in the Cloud Function. This bug has already happened once - the picker drew the composer's
// whole emoji list, so tapping a face came back as "That is not one of the reactions." and read as nothing happening at all.
console.log('\n--- the reactions a message can carry ---');
check('the picker offers exactly what the server accepts', CLIENT_REACTION_EMOJI, CHAT_REACTION_EMOJI);
checkIs('and the reaction picker is told to offer only those', /only=\{CHAT_REACTION_EMOJI\}/.test(panelSource));
// THE COMPOSER IS NOT NARROWED. A message can contain any emoji, so the two lists being equal is about REACTIONS only - and
// this asserts the picker still has the wider list for everything else.
check('the composer still offers every group', CHAT_EMOJI_GROUPS.length > 1, true);
check('and the reaction list is everything the picker draws', CLIENT_REACTION_EMOJI.length, CHAT_EMOJI_GROUPS.flatMap((group) => group.emoji).length);
checkIs('including the faces and the station emoji', CHAT_EMOJI_GROUPS[1].emoji.every((emoji) => CLIENT_REACTION_EMOJI.includes(emoji)));

// A REFUSAL MUST BE SHOWN, NOT SWALLOWED - the bug that made reactions look broken for a day, and the reason it was invisible:
// `routeWrite` answers a refused callable with `{ success: false, message }` instead of rejecting, so code that checks only for
// a `message` treats the explanation as data. Asserted as source because it is about which field is read first.
checkIs(
  'a refused reaction is thrown rather than merged as a row',
  /if \(!result\?\.success\) throw new Error\(result\?\.message/.test(source('src/components/Chat/ChatHost.jsx'))
);
// AND THE CONTROL IS NOT OFFERED WHERE IT CANNOT WORK: the server refuses a reaction on a removed message, so the smiley is
// not drawn beside one. A control whose only outcome is a refusal is worse than no control.
checkIs('a removed message offers no reaction control', /onReact && !notice/.test(panelSource));

// THE LISTENER THAT WATCHES A DOCUMENT MUST NOT PASS OPTIONS, and this is the check for a bug that made three features look
// broken at once while the collection listeners beside them worked perfectly. `onSnapshot(ref, options, next, error)` is the
// QUERY signature; with a document reference in the first slot the SDK refuses the whole call - "Expected type 'Query', but it
// was: a custom aa object" - and nothing is ever attached, so the settings row, the schedule sentinel and a conversation's
// receipts were all dead, silently. Asserted as source, because attaching a real listener needs the emulator.
checkIs(
  'a document listener is attached without query options',
  /isDocument\s*\?\s*onSnapshot\(target, onNext, fail\)/.test(source('src/services/liveReads.js'))
);
checkIs(
  'and its one-shot fallback reads one document rather than a collection',
  /isDocument \? getDoc\(target\) : getDocs\(target\)/.test(source('src/services/liveReads.js'))
);
// AND A FAILED CALL IS NOT SHOWN AS A BARE CODE: "internal [0]" tells a member nothing, and it hides a deploy problem behind a
// shrug. The message names what to try while keeping the original text for whoever is debugging.
checkIs(
  'an unreachable callable says so rather than showing a code',
  /That did not reach the server/.test(source('src/components/Chat/ChatHost.jsx'))
);

// ANYTHING A CLIENT WATCHES MUST HAVE A RULE, and this is the check for a listener that reported "Missing or insufficient
// permissions" when the real fault was a missing paragraph in firestore.rules. The schedule's sentinel is the case that bit:
// the client watches `live/schedule`, the rules had no `live` block, and the catch-all at the bottom of the file refused the
// read. A pair like this cannot be type-checked or built into agreement, so it is asserted as text - the same arrangement the
// storage and avatar limits use.
//
// It lives in this harness because `source()` is defined here, not because it is about chat; the freshness logic itself has
// its own checks in verify-freshness.mjs.
checkIs(
  'the sentinel a client watches has a rule that allows reading it',
  /'live', 'schedule'/.test(source('src/services/liveReads.js')) && /match \/live\/\{docId\}/.test(source('firestore.rules'))
);

// AND THE LABELS SURVIVE, because sixty-four emoji in one flat grid is a list nobody can scan - and narrowing the picker once
// already cost this list its shape. `REACTIONS_GROUP` is the first group; the others are asserted by the flat comparison above.
checkIs('and the picker still groups them under a label', Array.isArray(REACTIONS_GROUP?.emoji) && REACTIONS_GROUP.emoji.length > 0);

console.log(`\n${failures ? `${failures} CHECK(S) FAILED` : 'ALL CHECKS PASSED'}\n`);
process.exit(failures ? 1 : 0);





