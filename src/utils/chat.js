// THE CHAT MODULE'S DECISIONS, where a harness can ask them (scripts/verify-chat.mjs).
//
// Chat is the first module in this app whose data arrives as a STREAM rather than as a screenful, and that changes what
// the risky parts are. There is no route to get wrong here; what there is instead is a set of small judgements that are
// invisible until they are wrong:
//
//   * what a message body may be, and what happens to one that is not that (the same limits the trusted half in
//     functions/chat.js enforces, which is why the two constants are asserted to agree rather than assumed to);
//   * HOW TWO LISTS OF MESSAGES BECOME ONE. A listener does not deliver a page, it delivers a change: a new message
//     arrives as one document, an edit arrives as the SAME document again, and a removal arrives as that document with
//     its body gone. A merge that only ever appends is a merge that never shows an edit - the bug that makes a chat feel
//     broken without anything being logged anywhere;
//   * how many messages are unread, which is arithmetic rather than a stored number (see the note on the inbox rows);
//   * WHO MAY EDIT OR REMOVE WHAT, which is four separate permissions in this station and the one place the UI and the
//     trusted half have to agree about them;
//   * the text a removed message shows, which says WHO removed it - the difference between "Deleted by author" and
//     "Deleted by Jane Smith" is the whole reason an officer's removal is worth having.
//
// Nothing here touches the network, React or Firestore, so all of it is asserted directly - the arrangement
// utils/runnerBoard.js and utils/runnerLevel.js already follow, and for the same reason: this repo's suite cannot run a
// browser, so a decision worth testing has to live somewhere a harness can reach it.
import { MASTER_PERMISSION_KEY, permissionGranted } from './permissions.js';

// HOW MANY MESSAGES ONE PAGE HOLDS. The number that matters most in this module: a listener's first snapshot bills every
// document it matches, so an unscoped listener on a conversation's messages would re-read the station's whole history
// every time anybody opened a chat. Thirty is what a phone screen holds and then some, and "load older" walks backwards
// thirty at a time.
export const CHAT_PAGE_SIZE = 30;

// What a message may be. Large enough for a paragraph, a radio call and a pasted address; small enough that a document
// stays a document. The trusted half holds the same number - see the note at the top of this file.
export const CHAT_BODY_MAX = 2000;

// How much of a message the room list shows before trimming it. Long enough to recognise the message, short enough that
// the list stays one line per room.
export const CHAT_PREVIEW_MAX = 80;

// Characters nobody can see at the end of a message are still characters, and they are how a message "with nothing in
// it" gets past a check that trims for display but not for storage.
export const normalizeChatBody = (raw) => String(raw ?? '').replace(/\s+$/, '');

// Whether a body may be sent, as a sentence for the composer - "" when it may. The composer shows this rather than a
// silently disabled button, because "why can I not send this" is a worse question than a one-line answer.
export const chatBodyProblem = (raw, { max = CHAT_BODY_MAX, hasGif = false } = {}) => {
  const body = normalizeChatBody(raw);
  // A PICTURE IS SOMETHING. "Write something first" is the right answer for a message that would be empty, and the wrong one
  // for a member who has chosen a GIF and does not want to caption it - that message is not empty, it is a picture. The
  // server makes the same allowance for the same reason (functions/chat.js#chatWriteProblem), and only when one is attached.
  if (!body.trim()) return hasGif ? '' : 'Write something first.';
  if (body.length > max) return `That is ${body.length} characters — the limit is ${max}.`;
  return '';
};

// WHY A MESSAGE CANNOT BE SENT YET, as one sentence - "" when it can.
//
// TWO REASONS, and they are different kinds of answer. An empty body is a mistake in front of the member and they can fix
// it in a second. Being offline is not their mistake and not fixable from that screen, so it says what will happen
// instead. The composer's send button is disabled on this sentence and shows it beside the button, so an offline member
// sees WHY rather than a button that silently does nothing.
//
// WHICH IS WHY THE SEND IS BLOCKED RATHER THAN QUEUED. Firestore queues an offline WRITE; a message is sent by a callable
// (the audience proof on it has to be stamped by the server), and a callable cannot be queued - so a message composed
// offline would sit in the box looking sent. Refusing it, and saying so, is the honest version.
export const CHAT_OFFLINE_MESSAGE =
  'You are offline, so messages cannot be sent. Your text stays here until you close this room.';

export const chatSendProblem = ({ body, offline, hasGif } = {}) => {
  if (offline) return CHAT_OFFLINE_MESSAGE;
  return chatBodyProblem(body, { hasGif });
};
export const chatPreviewOf = (body, max = CHAT_PREVIEW_MAX) => {
  const text = String(body ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

// A Firestore timestamp, a Date, a number or a string, as milliseconds - 0 when there is nothing usable. Every ordering
// in this module goes through it, because a stream really does deliver a document whose `created_at` is still unset for
// the instant between the write and its echo, and a comparison against a missing value throws.
export const chatMillis = (value) => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return 0;
};

// TWO LISTS OF MESSAGES AS ONE, OLDEST FIRST - what makes a stream and a page agree.
//
// `incoming` may be anything: one changed document from a listener, or a page of older ones from a read. The rules are:
// the same id is REPLACED rather than appended (an edit and a removal both arrive that way, and appending would draw the
// same message twice with the old text), a message with no id is dropped (a placeholder has no id until the write is
// echoed), and the result is ordered by time and then by id, so a page and a stream cannot disagree about which came
// first. Sorting here rather than trusting the query is the same decision the roster makes: one screen and its own
// refresh must not have two opinions about the order.
// AN UNRESOLVED TIMESTAMP MEANS "LATEST", NOT "EARLIEST", and that one word is the whole of a bug that looked like the panel
// drawing conversations upside down.
//
// A message the CALLABLE has just written comes back to the sender BEFORE the server has resolved its `created_at` - that field
// is a sentinel in the callable's response, and a sentinel parses as 0 (utils/chat.js#chatMillis). Zero is the earliest time
// there is, so sorting on it drew the member's own new message at the TOP of the conversation, and the scroll - which parks at
// the bottom, correctly - left it out of sight. The listener's echo arrives a moment later carrying the resolved timestamp and
// the message jumps to where it belongs, which is why this reads as a flicker at best and as "new messages appear at the top"
// at worst.
//
// The incoming rows are handed to this function LAST, so an unknown timestamp is treated as what it is in practice: newer than
// everything already in the window. Two of them compare equal and fall back to their ids - arbitrary, but stable, and never
// worse than putting a message somebody just sent at the beginning of the conversation.
const chatSortKey = (row) => row.created_ms || Number.POSITIVE_INFINITY;

export const mergeChatMessages = (existing = [], incoming = []) => {
  const byId = new Map();
  for (const raw of [...existing, ...incoming]) {
    const row = chatMessageRow(raw);
    if (!row.id) continue;
    byId.set(row.id, row);
  }
  return [...byId.values()].sort((left, right) => {
    const mine = chatSortKey(left);
    const theirs = chatSortKey(right);
    if (mine === theirs) return left.id.localeCompare(right.id);
    return mine - theirs;
  });
};

// The cursor "load older" walks back from: the oldest message in hand, as the value the query orders by. Sent back
// as-is (a Firestore timestamp stays a timestamp), so this returns the stored field rather than the milliseconds.
export const oldestChatCursor = (messages = []) => {
  const rows = (Array.isArray(messages) ? messages : []).map(chatMessageRow).filter((row) => row.id);
  if (!rows.length) return null;
  return rows.reduce((oldest, row) => (row.created_ms < oldest.created_ms ? row : oldest), rows[0]).created_at;
};

// HOW MANY MESSAGES ARE UNREAD, which is subtraction rather than a stored number.
//
// The station's own count lives on the member's own inbox row, beside the mark of how much of it they have read - see
// functions/chat.js#chatInboxPatch. Keeping a per-member unread NUMBER instead would mean the fan-out had to read every
// member's read position on every message, which is one read per member per message: the cost this whole arrangement
// exists to avoid. So the inbox carries what the fan-out knows for free (how many messages have been posted, when, and
// by whom) and the client subtracts what it has read. A missing row is zero of both, so a room nobody has spoken in is
// quiet.
export const unreadCountFor = (inboxRow) => {
  const row = inboxRow || {};
  if (row.muted) return 0;
  const count = Number(row.count) || 0;
  const read = Number(row.read_count) || 0;
  return Math.max(0, count - read);
};

// The number on the launcher: every unread message, across the rooms this member can see.
export const totalUnread = (inboxRows = []) =>
  (Array.isArray(inboxRows) ? inboxRows : []).reduce((sum, row) => sum + unreadCountFor(row), 0);

// Whether there is anything in this conversation to catch up on - the dot on a room row, where a member would rather
// have a marker than a number.
export const hasUnread = (inboxRow) => unreadCountFor(inboxRow) > 0;

// The rooms in the order the station put them in, with a room nobody has ordered yet last. Sorted here rather than
// trusted from the query for the roster's reason - and because a room created a moment ago has no `sort_order` at all
// until its save is echoed back.
// =====================================================================================================================
// PRIVATE CONVERSATIONS
// =====================================================================================================================
// A private conversation ("thread") is a conversation whose audience is its members. The server mints it - see the section
// at the top of functions/chat.js for why, and for why the id is derived from the members rather than generated. What the
// CLIENT needs from all that is two things, and both are here.
//
// The prefix is written down twice on purpose - here and functions/chat.js - and scripts/verify-chat.mjs asserts the two
// agree, because an id the server would never mint is a thread the client would never find.
export const CHAT_THREAD_PREFIX = 'dm_';

// How many members one may hold, INCLUDING whoever starts it. Written down twice on purpose - here and functions/chat.js -
// and asserted to agree, exactly like the body limit and the preview width above: the panel uses it to stop offering rows
// the server would refuse, and the server uses it to refuse them. A cap that differed by one would be a button that fails.
export const CHAT_THREAD_MEMBERS_MAX = 12;

// Absent means a room, so every conversation that already exists stays one without being rewritten.
export const isChatThread = (room) => String((room && room.kind) || '') === 'private';

// WHAT A CONVERSATION IS CALLED, from the point of view of whoever is looking at it.
//
// A room carries its name; a private conversation deliberately does not (functions/chat.js#chatThreadDoc says why: one
// stored name would show every member the same list of names, including their own). So a thread is titled with the OTHER
// members - "Ana" to Ben, "Ben and Cass to Ana" - which is the one thing the server cannot work out for itself, because it
// does not know who is reading.
export const chatThreadTitle = ({ room, viewerId } = {}) => {
  const named = String((room && room.name) || '').trim();
  if (named) return named;
  const ids = Array.isArray(room && room.member_ids) ? room.member_ids.map((id) => String(id || '')) : [];
  const names = Array.isArray(room && room.member_names) ? room.member_names.map((name) => String(name || '').trim()) : [];
  const mine = String(viewerId || '');
  const others = ids.map((id, index) => (id === mine ? '' : names[index])).filter(Boolean);
  return others.length ? others.join(', ') : 'Private conversation';
};

// WHAT A MEMBER'S OWN MESSAGE HAS DONE SO FAR, for the little state beside it: SENDING, SENT, or SEEN.
//
// THE THREE WORDS ARE NOT A PREFERENCE - THEY ARE WHAT THIS DESIGN CAN HONESTLY KNOW.
//
//   sending  the row exists but its timestamp has not resolved. That is exactly what the callable's response looks like before
//            the server has written it (see the note on mergeChatMessages for the same sentinel, which once sorted a just-sent
//            message to the top of the conversation), so "sending" is the state of a message the member has asked for and the
//            server has not yet confirmed.
//   sent     the server has it. Nothing more is known about it, and NOTHING CAN BE: "delivered" would mean a device
//            acknowledged the message, and nothing in this app tracks that. A tick that claimed it would be decoration.
//   seen     somebody else has read up to it. Read state is a TIME on the conversation (`read_at`, one entry per member,
//            written by that member for their own key), compared against the message's own timestamp.
//
// WHICH IS WHY SEEN IS COMPARED BY TIME AND NOT BY COUNT. The inbox row counts messages (utils/chat.js#unreadCountFor) - that
// is what a badge needs - but a count cannot say WHICH message somebody has reached, and a receipt has to name one.
//
// A GROUP IS SEEN WHEN ANYBODY HAS SEEN IT, because "seen" on a message with two recipients and one reader has to mean
// something, and the honest meaning is "somebody has read this far". Which member, and how many, is a richer question the same
// `read_at` map can answer later without another write.
export const CHAT_DELIVERY_STATES = { sending: 'sending', sent: 'sent', seen: 'seen' };

export const deliveryStateFor = ({ message, readAt = {}, viewerId = '', conversation = null } = {}) => {
  const row = chatMessageRow(message);
  if (!row.id) return '';
  if (!row.created_ms) return CHAT_DELIVERY_STATES.sending;

  const mine = String(viewerId || '');
  const others = (Array.isArray(conversation && conversation.member_ids) ? conversation.member_ids : [])
    .map((id) => String(id || ''))
    .filter((id) => id && id !== mine);
  // A CONVERSATION WITH NOBODY ELSE IN IT has nobody to be seen by, so "sent" is the whole truth - and it is what stops a
  // one-member conversation from claiming a receipt it could never get.
  if (!others.length) return CHAT_DELIVERY_STATES.sent;

  const seen = others.some((id) => Number((readAt || {})[id] || 0) >= row.created_ms);
  return seen ? CHAT_DELIVERY_STATES.seen : CHAT_DELIVERY_STATES.sent;
};

export const sortChatRooms = (rooms = []) =>
  (Array.isArray(rooms) ? rooms : [])
    .filter((room) => room && room.id)
    .map((room) => ({
      ...room,
      id: String(room.id),
      name: String(room.name || ''),
      sort_order: Number(room.sort_order ?? 999),
      archived: room.archived === true,
    }))
    .sort((left, right) => {
      const byOrder = left.sort_order - right.sort_order;
      if (byOrder) return byOrder;
      // A PRIVATE CONVERSATION HAS NO NAME TO FALL BACK ON, so within the same place in the list the two kinds are ordered
      // by the thing each of them actually has: a room by its name, a thread by when somebody last spoke in it. ROOMS COME
      // FIRST - they are the station's places, and a member's private conversations sit under them rather than mixed
      // through them.
      const leftThread = isChatThread(left);
      if (leftThread !== isChatThread(right)) return leftThread ? 1 : -1;
      if (leftThread) {
        return chatMillis(right.last_at) - chatMillis(left.last_at) || left.id.localeCompare(right.id);
      }
      return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
    });

// THE SIX PERMISSIONS, AS ONE OBJECT THE SCREEN CAN ASK. `manageRooms` is administration rather than chat - it opens a
// tab, and it deliberately does NOT give access to the conversations themselves: a station can have somebody who sets
// the rooms up without giving them a seat in every room.
//
// `is_admin` IS THE MASTER SWITCH, and it has to be applied HERE rather than left to each caller. `permissionGranted`
// reads one column and does not imply the master switch (App writes `isAdmin || can(...)` at each of its own call sites),
// so a mapping that only read columns would lock an administrator out of a module whose six columns their role may never
// have been given - which is exactly what the Roles editor shows as locked-on while `is_admin` is ticked.
//
// The four message flags are separate for a reason worth stating: editing and removing are different acts in this
// station, and doing either to somebody else's message is a further step again. Collapsing them into one "moderate"
// switch would hand an officer the ability to rewrite a colleague's words in order to remove them.
export const chatPermissionsFrom = (role) => {
  const admin = permissionGranted(role, MASTER_PERMISSION_KEY);
  const flag = (key) => admin || permissionGranted(role, key);
  return {
    useChat: flag('can_use_chat'),
    manageRooms: flag('can_manage_chat_rooms'),
    editOwn: flag('can_edit_own_chat_messages'),
    deleteOwn: flag('can_delete_own_chat_messages'),
    editOthers: flag('can_edit_others_chat_messages'),
    deleteOthers: flag('can_delete_others_chat_messages'),
  };
};

// Whether this member may change this message's text. A removed message is never editable, by anybody: rewriting the
// body of something the station has recorded as removed would put text back under a "removed" heading, and the flag that
// would allow it is a moderation permission rather than an undo.
export const canEditChatMessage = ({ flags = {}, message, viewerId } = {}) => {
  const row = chatMessageRow(message);
  if (!row.id || row.deleted) return false;
  const mine = Boolean(viewerId) && row.author_id === String(viewerId);
  return mine ? flags.editOwn === true : flags.editOthers === true;
};

// Whether this member may remove this message. Same shape, one difference that matters: a message that is already
// removed cannot be removed again, so the flag cannot be used to rewrite who removed it.
export const canDeleteChatMessage = ({ flags = {}, message, viewerId } = {}) => {
  const row = chatMessageRow(message);
  if (!row.id || row.deleted) return false;
  const mine = Boolean(viewerId) && row.author_id === String(viewerId);
  return mine ? flags.deleteOwn === true : flags.deleteOthers === true;
};

// A MESSAGE AS THE STREAM DELIVERS IT, made safe to draw: a stable id, a sortable time, the author's name as it was when
// they wrote (denormalized onto the row - a `users` read per message would be thirty reads to draw one screen), and the
// removed shape.
// A MESSAGE'S REACTIONS, shaped: `{ emoji: [memberId] }`, with empty lists and unusable entries dropped.
//
// Its own function because two things read it - the row shaper below, and anything that compares two rows - and because the
// DROPPING is the rule rather than a detail: an emoji whose list is empty is a pill with nobody behind it, and the server
// removes those on the way in (functions/chat.js#chatReactionToggled), so a reader that kept one would be drawing something the
// writer refuses to store.
export const reactionMapOf = (value) => {
  if (!value || typeof value !== 'object') return {};
  const out = {};
  Object.entries(value).forEach(([emoji, list]) => {
    const members = (Array.isArray(list) ? list : []).map((id) => String(id || '')).filter(Boolean);
    if (emoji && members.length) out[emoji] = members;
  });
  return out;
};

export const chatMessageRow = (value) => {
  const row = value && value.data ? { id: value.id, ...value.data() } : value || {};
  const deleted = chatMillis(row.deleted_at) > 0;
  return {
    id: String(row.id || ''),
    conversation_id: String(row.conversation_id || ''),
    author_id: String(row.author_id || ''),
    author_name: String(row.author_name || ''),
    // NAMED HERE OR IT DOES NOT ARRIVE - this function PICKS its fields, and `author_rank_id` is the third thing to be silently
    // swallowed by that (after `reactions`): the callable stamped it, the document stored it, and the screen never saw it,
    // which reads as "the rank icon does not work" rather than as a field missing from a shaper. Anything added to a message on
    // the server has to be added here too, and asserted (scripts/verify-chat.mjs does).
    author_rank_id: String(row.author_rank_id || ''),
    // THE THIRD FIELD THIS SHAPER HAS SWALLOWED, named here before it could bite: a picture stamped onto a message on the server
    // is invisible to every screen until it appears in this list. See the note on `reactions` above for the shape of that
    // failure - it reads as "the avatar does not work" and there is nothing in any log to say otherwise.
    author_avatar_url: String(row.author_avatar_url || ''),
    // THE PICTURE THAT IS THE MESSAGE. Five fields, and the FOURTH time this shaper has had to be told about a new one -
    // see the note on `reactions` above for the shape of that failure: the send function stamps it, the document stores
    // it, and every screen is blind to it until it is named here.
    //
    // The width and height travel with it because they are the whole reason a conversation does not jump: the bubble
    // reserves the right box before the picture arrives, and without numbers to do that with, every GIF would shove the
    // text above it up and down as it loaded.
    gif_url: String(row.gif_url || ''),
    gif_fallback_url: String(row.gif_fallback_url || ''),
    gif_width: Number(row.gif_width) || 0,
    gif_height: Number(row.gif_height) || 0,
    gif_alt: String(row.gif_alt || ''),
    body: deleted ? '' : String(row.body || ''),
    created_at: row.created_at || null,
    created_ms: chatMillis(row.created_at),
    edited_at: row.edited_at || null,
    edited_ms: chatMillis(row.edited_at),
    deleted_at: deleted ? row.deleted_at : null,
    deleted_ms: deleted ? chatMillis(row.deleted_at) : 0,
    deleted_by: deleted ? String(row.deleted_by || '') : '',
    deleted_by_name: deleted ? String(row.deleted_by_name || '') : '',
    deleted,
    // KEPT, and it took a bug to notice: this function PICKS its fields, so a map added to a message on the server is invisible
    // here until it is named - and reactions were being written, stored, and silently dropped on the way to the screen. What
    // people made of a message survives the message being removed: `body` is emptied because the words are gone, but a reaction
    // was somebody's answer to them, and it is not the remover's to take away.
    reactions: reactionMapOf(row.reactions),
  };
};

// THE TEXT A REMOVED MESSAGE SHOWS, which is the whole point of removing it this way: the conversation keeps its shape,
// and who removed it is on the record. Removing your own message says so; an officer's removal names them, because a
// message that disappeared under an officer's hand is a fact about the station rather than about the author.
export const chatDeletedNotice = (message) => {
  const row = chatMessageRow(message);
  if (!row.deleted) return '';
  if (!row.deleted_by || row.deleted_by === row.author_id) return 'Deleted by author';
  return `Deleted by ${row.deleted_by_name || 'a moderator'}`;
};
