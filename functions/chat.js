// THE TRUSTED HALF OF CHAT: what a message may contain, what a member may do to one, and what the fan-out writes.
//
// WHY THIS IS A FILE OF ITS OWN, and it is the rule this repo has settled on for every function: THE SUITE RUNS NO
// FUNCTIONS EMULATOR. A callable cannot be exercised by a harness at all, so every rule that could be got wrong - who
// may edit somebody else's message, what a removal leaves behind, which members a message's audience resolves to - lives
// here, where scripts/verify-chat.mjs can ask it directly. What is left in functions/index.js is a list of calls with
// nothing left to decide.
//
// THE MESSAGE IS WRITTEN BY THE SERVER, NOT BY THE BROWSER, and that is the decision this whole module turns on. It looks
// heavier than letting a client write into its own conversation, and it is what makes the rest of the design affordable:
//
//   * THE AUDIENCE PROOF HAS TO BE ON EVERY MESSAGE. Firestore refuses a listener whose query the rules cannot prove,
//     and a rule cannot read a message's parent conversation to find out who may see it. So each message carries the keys
//     its conversation carries (`audience_keys`), exactly as an announcement carries its own - and a proof a client
//     writes is a proof a client can forge. A member could stamp `['*']` on a message inside an officers-only room and
//     leak it to anybody running a collection-group query. Stamped here, it cannot be forged.
//   * THE AUTHOR'S NAME IS COPIED ONTO THE ROW for the same reason an announcement's audience is materialized: drawing
//     thirty messages must not be thirty reads of the directory.
//   * AND THE TWO THINGS NO CLIENT MAY SET - who wrote it, and when - are set here.
//
// The cost is one function invocation per message: a few milliseconds, and the same Firestore write either way. What it
// does cost is OFFLINE SENDING, because a callable cannot be queued the way a Firestore write can. A member composing
// offline keeps their draft on the device (the composer holds it) and it sends when the connection is back; what they do
// not get is a message sitting in the conversation marked as waiting to send. That trade is deliberate, and it is the
// only thing about this module that is not simply a matter of shape.

// What a message may be. THE CLIENT HOLDS THE SAME NUMBER in utils/chat.js, and scripts/verify-chat.mjs asserts the two
// agree: a limit that differs by a character is a message the composer accepts and the server refuses.
export const CHAT_BODY_MAX = 2000;
export const CHAT_NAME_MAX = 60;

// How much of a message the room list's preview holds. THE CLIENT TRIMS ITS OWN COPY to the same width (utils/chat.js),
// and they are asserted to agree: the preview is written once and read by every member, so a server that stored more
// than the client shows would be storing text nobody ever sees.
export const CHAT_PREVIEW_MAX = 80;

// One line, whitespace collapsed. The server's copy of the client's own trimmer - see the note above on agreement.
export const chatPreviewOf = (body, max = CHAT_PREVIEW_MAX) => {
  const value = String(body ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

const text = (value) => String(value ?? '').trim();
const trimmedTail = (value) => String(value ?? '').replace(/\s+$/, '');

// WHAT A MEMBER IS ASKING TO DO TO A MESSAGE, as the permission column that governs it. One place, so a callable cannot
// ask about the wrong half of the pair: editing somebody else's message is a different permission from editing your own,
// and removing it is a third and fourth.
export const chatPermissionForAction = ({ action, mine }) => {
  const own = mine === true;
  if (action === 'edit') return own ? 'can_edit_own_chat_messages' : 'can_edit_others_chat_messages';
  if (action === 'delete') return own ? 'can_delete_own_chat_messages' : 'can_delete_others_chat_messages';
  return 'can_use_chat';
};

// Why a GIF cannot be attached, as the sentence the callable refuses with - "" when it may. The same three answers the
// picker gives, in the same order, so a member who has somehow got past the client is told the same thing.
//
// THIS COPY IS THE ONE THAT DECIDES. The client has its own (utils/chatGifs.js) and there is no way to share one: this is
// a different package, and a Cloud Function cannot import from the site's build. So the pair is kept honest the way the
// certification and avatar limits are - scripts/verify-gifs.mjs reads both as text and asserts they agree on the host and
// the bounds, rather than anyone trusting that they do.
//
// THE HOST RULE IS THE POINT OF THE WHOLE FUNCTION. A message's picture is fetched by EVERY member who scrolls past it,
// so a URL a member could choose freely would let one member make the whole station's browsers fetch anything they liked.
// A suffix rather than a fixed list, because KLIPY serves media from subdomains (`static.klipy.com` today) and a list
// would break sending the day they add another - while a suffix still refuses every host on the internet.
export const CHAT_GIF_HOST_SUFFIX = '.klipy.com';
export const CHAT_GIF_URL_MAX = 512;
export const CHAT_GIF_ALT_MAX = 200;
export const CHAT_GIF_MAX_EDGE = 4000;

const gifHostProblem = (raw, { required }) => {
  const url = text(raw);
  if (!url) return required ? 'A picture needs a link.' : '';
  if (url.length > CHAT_GIF_URL_MAX) return 'A picture link cannot be that long.';
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch {
    return 'A picture link has to be a link.';
  }
  if (parsed.protocol !== 'https:') return 'A picture link has to be https.';
  const host = parsed.hostname.toLowerCase();
  const bare = CHAT_GIF_HOST_SUFFIX.slice(1);
  if (host !== bare && !host.endsWith(CHAT_GIF_HOST_SUFFIX)) return 'A picture has to come from KLIPY.';
  return '';
};

export const chatGifProblem = (gif = {}) => {
  if (!gif || typeof gif !== 'object') return '';
  const url = text(gif.url);
  // A MESSAGE WITH NO GIF IS NOT A PROBLEM - this runs on every send, and most sends have no picture in them.
  if (!url) return '';
  const problem = gifHostProblem(url, { required: true });
  if (problem) return problem;
  // The fallback is optional but held to the same rule: it is a second URL the app will fetch for every member.
  const fallback = gifHostProblem(gif.fallback_url || gif.fallbackUrl, { required: false });
  if (fallback) return fallback;
  // THE DIMENSIONS ARE REQUIRED, and they are not decoration: they are what lets a reader's screen reserve the right space
  // before the picture arrives, so a conversation does not jump around as each one loads. A picture with no size is one
  // the bubble has to guess at.
  const width = Number(gif.width) || 0;
  const height = Number(gif.height) || 0;
  if (!width || !height) return 'A picture needs its size.';
  if (width > CHAT_GIF_MAX_EDGE || height > CHAT_GIF_MAX_EDGE) return 'That picture link is not a sensible size.';
  if (text(gif.alt).length > CHAT_GIF_ALT_MAX) return 'That picture description is too long.';
  return '';
};

// The five fields a message carries when a picture rides on it, and nothing else from the search result that produced it.
export const chatGifFields = (gif = {}) => ({
  gif_url: text(gif && gif.url),
  gif_fallback_url: text(gif && (gif.fallback_url || gif.fallbackUrl)),
  gif_width: Number(gif && gif.width) || 0,
  gif_height: Number(gif && gif.height) || 0,
  gif_alt: text(gif && gif.alt).slice(0, CHAT_GIF_ALT_MAX),
});

// Why a body cannot be sent, as the sentence the callable refuses with - "" when it may. The same three answers the
// composer gives, in the same order, so a member who has somehow got past the client is told the same thing.
export const chatWriteProblem = (raw, { max = CHAT_BODY_MAX, allowEmpty = false } = {}) => {
  const body = trimmedTail(raw);
  // A MESSAGE CAN BE A PICTURE AND NOTHING ELSE. "A message cannot be empty" is still the answer for text, but a member
  // who sends a GIF does not have to caption it - and requiring one would mean inventing a sentence for every joke.
  if (!body.trim()) return allowEmpty ? '' : 'A message cannot be empty.';
  if (body.length > max) return `A message cannot be longer than ${max} characters.`;
  return '';
};

// Why a room cannot be saved, for the same reason. A room with no name is a row nobody can find, and a room with no
// audience is a room nobody can see - which would look exactly like a room that was never created.
export const chatRoomProblem = (room = {}) => {
  const name = text(room.name);
  if (!name) return 'A room needs a name.';
  if (name.length > CHAT_NAME_MAX) return `A room name cannot be longer than ${CHAT_NAME_MAX} characters.`;
  const keys = Array.isArray(room.audience_keys) ? room.audience_keys.filter((key) => text(key)) : [];
  if (!keys.length) return 'A room needs somebody who can see it.';
  return '';
};

// THE ROW A MESSAGE IS STORED AS. The audience proof is copied from the conversation rather than accepted from the
// caller, which is the paragraph at the top of this file in one line.
//
// `created_at` is the SERVER's timestamp, so two members' clocks cannot disagree about the order of a conversation.
export const chatMessageDoc = ({ conversation, author, body, gif, at, serverTimestamp }) => {
  const keys = Array.isArray(conversation.audience_keys) ? conversation.audience_keys.filter((key) => text(key)) : [];
  const members = Array.isArray(conversation.member_ids) ? conversation.member_ids.map(text).filter(Boolean) : [];
  return {
    conversation_id: text(conversation.id),
    author_id: text(author.id),
    author_name: text(author.name),
    // THE AUTHOR'S RANK, copied onto the row for the same reason their NAME is: drawing thirty messages must not be thirty
    // lookups into a directory. The ID rather than the icon, because the icon belongs to the rank and a station that repaints
    // "Officer" should repaint it in a message list too - so the row says WHICH rank and the screen draws what that rank looks
    // like today (components/RankIcon, fed from the rank the row names).
    author_rank_id: text(author.rank_id),
    // AND THEIR PICTURE, by the same argument and with the same trade the name already makes: a row is a SNAPSHOT of who wrote
    // it, so somebody who changes their photo keeps the old one in what they have already said. Names behave that way here
    // already, and a stale avatar in a six-month-old message is a truer record than a name that changed with it.
    //
    // It costs nothing to stamp, which is the reason this shape was chosen over a lookup: the send callable already reads the
    // author's own row to get their name (functions/index.js#chatContext), so the picture is a field that was already in hand.
    author_avatar_url: text(author.avatar_url),
    // AND THE PICTURE THAT IS THE MESSAGE, when there is one. Validated by `chatGifProblem` before this is built (see the
    // send callable), and written by `chatGifFields` so the five fields are named in one place: the search result that
    // produced them is not stored, only what a reader needs to draw it and to hear it described.
    ...chatGifFields(gif),
    body: trimmedTail(body),
    created_at: serverTimestamp,
    // Kept for the rules and the harness, never shown: which audience this message belongs to.
    audience_keys: keys,
    member_ids: members,
    // The station's own clock, in the format the rest of the app stores and sorts by, so an export or a repair can read
    // a message's date without a timestamp round trip.
    created_stamp: at,
  };
};

// What an edit writes: the new text, and the fact that it changed. `edited_at` is not decoration - a message that can
// change silently is a message an officer can rewrite, and the whole reason the four message permissions are separate is
// that this app would rather show its work.
export const chatEditPatch = ({ body, at, serverTimestamp }) => ({
  body: trimmedTail(body),
  edited_at: serverTimestamp,
  edited_stamp: at,
});

// What a removal writes. THE TEXT IS GONE - not hidden, not styled away: the body is emptied and the message keeps the
// shape of having been there, which is what the station asked for and what stops a conversation reading like nonsense
// around a hole. Who removed it is recorded, because "Deleted by author" and "Deleted by Jane Smith" are different facts
// about a station.
export const chatRemovalPatch = ({ actor, at, serverTimestamp }) => ({
  body: '',
  deleted_at: serverTimestamp,
  deleted_stamp: at,
  deleted_by: text(actor.id),
  deleted_by_name: text(actor.name),
});

// WHAT THE FAN-OUT WRITES INTO A MEMBER'S INBOX: the fields only. `count` is an atomic increment applied by the caller,
// and `read_count` and `muted` belong to the member and are never touched from here.
//
// NO UNREAD NUMBER IS STORED, and that is the conservation decision of this module: a per-member unread count would have
// to be recomputed against every member's read position on every message, which is a read per member per message. The
// inbox carries what the fan-out knows for free - how many messages have been posted, when, by whom, and which was last
// - and the client subtracts what it has read (utils/chat.js#unreadCountFor).
export const chatInboxFields = ({ conversation, message }) => ({
  conversation_id: text(conversation.id),
  last_at: message.created_at,
  last_author_id: text(message.author_id),
  last_author_name: text(message.author_name),
  last_message_id: text(message.id),
});

// WHAT THE CONVERSATION ITSELF RECORDS: the same facts, for the room list's one-line preview and for sorting rooms by
// activity. THE PREVIEW LIVES HERE and deliberately not on every member's inbox - a removal has to clear it, and this is
// one document the removal already has in hand, rather than a query across every member's copy of it.
export const chatConversationFields = ({ message, preview }) => ({
  last_at: message.created_at,
  last_author_id: text(message.author_id),
  last_author_name: text(message.author_name),
  last_message_id: text(message.id),
  last_preview: preview,
});

// WHO A MESSAGE GOES TO, from the conversation's audience and the station's directory - the fan-out's whole brain, and
// the reason it is a pure function here rather than a loop inside a trigger.
//
// The keys are the ones an announcement carries (`*`, `user:<id>`, `role:<id>`, `rank:<id>`), resolved against the
// directory the caller passes in. A member who matches two keys appears ONCE: a fan-out that wrote the same inbox row
// twice would double every count.
//
// AN EMPTY AUDIENCE REACHES NOBODY, which is the safe direction for a fan-out: a bug here leaves a badge unlit on a
// screen, where the other direction would hand somebody a room they were never granted.
export const chatRecipientsFor = ({ audienceKeys = [], memberIds = [], users = [] } = {}) => {
  const keys = new Set((Array.isArray(audienceKeys) ? audienceKeys : []).map(text).filter(Boolean));
  const explicit = new Set((Array.isArray(memberIds) ? memberIds : []).map(text).filter(Boolean));

  const reaches = (user) => {
    const id = text(user && user.id);
    if (!id) return false;
    if (explicit.has(id)) return true;
    if (!keys.size) return false;
    if (keys.has('*')) return true;
    if (keys.has(`user:${id}`)) return true;
    if (keys.has(`role:${text(user.role_id)}`)) return true;
    return keys.has(`rank:${text(user.rank_id)}`);
  };

  return [...new Set((Array.isArray(users) ? users : []).filter(reaches).map((user) => text(user.id)))];
};

// WHETHER A MEMBER IS IN A CONVERSATION AT ALL, which the message callables need and the rules cannot tell them: a
// listener is proved by the audience keys on each message, but SENDING means the caller may not simply pick a room they
// can see. `can_use_chat` is the door and the audience is the room - both are asked, in that order.
export const chatMemberProblem = ({ conversation, member, keys = [] } = {}) => {
  if (!conversation) return 'That conversation does not exist.';
  const id = text(member && member.id);
  if (!id) return 'Sign in first.';
  const members = Array.isArray(conversation.member_ids) ? conversation.member_ids.map(text) : [];
  if (members.includes(id)) return '';
  const audience = new Set((Array.isArray(conversation.audience_keys) ? conversation.audience_keys : []).map(text));
  if (!audience.size) return 'You are not part of that conversation.';
  if (audience.has('*') || audience.has(`user:${id}`)) return '';
  const reachable = (Array.isArray(keys) ? keys : []).some((key) => audience.has(text(key)));
  return reachable ? '' : 'You are not part of that conversation.';
};

// =====================================================================================================================
// PRIVATE CONVERSATIONS ("threads")
// =====================================================================================================================
// A PRIVATE CONVERSATION IS A CONVERSATION WHOSE AUDIENCE IS ITS MEMBERS. That single sentence is the whole design, and it
// is why this needs far less new machinery than it looks: the rest of chat already speaks in audience keys (`*`, `user:<id>`,
// `role:<id>`, `rank:<id>`), so a thread is created carrying `user:<id>` for each member - which means
//
//   * THE EXISTING RULES ALREADY PROVE THE READS. A member's room list is one query (`audience_keys` `array-contains-any`
//     their own keys), and a private conversation satisfies it for exactly the people in it - without a second query per
//     kind of conversation, or a rule that has to work out which kind it is looking at.
//   * THE MESSAGE RULES ALREADY WORK, because a message is stamped with its conversation's keys (see the note at the top of
//     this file), and `member_ids` on each row is the belt to that pair of braces.
//   * THE FAN-OUT ALREADY KNOWS HOW TO REACH THEM: chatRecipientsFor has taken `memberIds` since it was written, so a
//     thread's badges are lit by the same trigger that lights a room's.
//
// WHAT IS NOT MERELY A MATTER OF SHAPE, and the three decisions worth stating plainly:
//
//   * THE ID IS DERIVED FROM THE MEMBERS, so the same people always land in the same conversation. Pressing "message Ana"
//     twice, from either end, finds the thread that already exists rather than opening a second one beside it - which is the
//     difference between a chat and a pile of abandoned half-conversations. Sorted, so the order they were picked cannot
//     matter.
//   * A THREAD HAS NO NAME. A room is named by whoever manages it; a private conversation between people is named by who is
//     in it, from each member's own point of view - "Ana" to Ben, "Ben" to Ana - so the name is NOT stored and the client
//     derives it (utils/chat.js#chatThreadTitle). One stored name would show every member the same list of names, including
//     their own.
//   * A THREAD IS NOT A ROOM, even though it is stored beside one. Rooms are an administrator's rows with a name and an
//     audience; threads are opened by members for themselves and carry `kind: 'private'`. The rooms tab edits rooms, and
//     filters on that difference rather than trusting its query to be narrow enough.
//
// Adding and removing members later is the same two fields written together (`member_ids` and `audience_keys`), and that is
// where chat's entry and exit sounds finally come from - the next piece of this work rather than this one.
export const CHAT_THREAD_MEMBERS_MIN = 2;
export const CHAT_THREAD_MEMBERS_MAX = 12;

// The prefix is written down in two places on purpose - here and utils/chat.js - and scripts/verify-chat.mjs asserts the two
// agree, because an id the server would never mint is a thread the client would never find.
export const CHAT_THREAD_PREFIX = 'dm_';

// An id a Firestore document may have, and that is all this asks. The point is not fussiness about odd letters: a derived id
// is only safe while DIFFERENT member lists cannot produce the SAME id, and sanitising one is exactly how that would happen
// ('a.b' and 'a-b' would become one conversation). So an id that cannot go into the name as it stands is refused, loudly,
// rather than quietly merged with somebody else's thread.
const CHAT_ID_SAFE = /^[A-Za-z0-9_-]{1,64}$/;

// WHO IS IN A THREAD: the ids that were asked for, deduplicated, in one fixed order. That order is the id's order and the
// client's order at once - they must not differ, or the same two people would compute two different conversations.
export const chatThreadMembersIn = (memberIds = []) =>
  [...new Set((Array.isArray(memberIds) ? memberIds : []).map(text).filter(Boolean))].sort();

export const chatThreadIdFor = (memberIds = []) => {
  const ids = chatThreadMembersIn(memberIds);
  if (ids.length < CHAT_THREAD_MEMBERS_MIN) return '';
  if (!ids.every((id) => CHAT_ID_SAFE.test(id))) return '';
  return `${CHAT_THREAD_PREFIX}${ids.join('_')}`;
};

// WHETHER A THREAD MAY BE OPENED, and who is in it. `members` arrives already resolved by the caller - each person with
// their own `can_use_chat` settled - because that answer is a role lookup rather than a fact about the person, and
// functions/index.js is where the roles are in hand.
//
// `memberIds` ARE THE IDS THAT WERE ASKED FOR, which is not the same list as the people who were found: the caller looks
// them up, some may be gone, and the difference is the whole point. Without it, somebody asking to message a colleague who
// has since left the station would quietly get a conversation without them in it - a thread that looks right and is not
// what they asked for.
//
// THE CALLER IS ALWAYS IN THE CONVERSATION. Asking to message somebody is not a way to open a room you are not in, and a
// member list that quietly left the caller out would be a conversation they could read and never see.
export const chatThreadProblem = ({ member, memberIds = [], members = [] } = {}) => {
  const me = text(member && member.id);
  if (!me) return 'Sign in first.';

  const askedFor = Array.isArray(memberIds) && memberIds.length ? memberIds : members.map((row) => row && row.id);
  const asked = chatThreadMembersIn([me, ...askedFor]);
  if (asked.length < CHAT_THREAD_MEMBERS_MIN) return 'Choose at least one other member.';
  if (asked.length > CHAT_THREAD_MEMBERS_MAX) {
    return `A private conversation holds up to ${CHAT_THREAD_MEMBERS_MAX} members.`;
  }

  for (const id of asked) {
    // The caller is not in their own `members` list - they are who is asking - so they are checked as themselves. That also
    // means a member whose own account could not form a thread id is told about their own account rather than about Ana's.
    const person = id === me ? { name: text(member && member.name), can_use_chat: true } : (members || []).find(
      (candidate) => text(candidate && candidate.id) === id
    );
    if (!person) return 'One of those members is no longer in the station.';
    if (!person.can_use_chat) return `${text(person.name) || 'That member'} cannot use chat.`;
    if (!CHAT_ID_SAFE.test(id)) {
      return id === me ? 'Your account cannot start a private conversation.' : `${text(person.name) || 'One of those members'} cannot be messaged.`;
    }
  }

  return '';
};

// A THREAD'S DOCUMENT. The audience keys are the members, which is the sentence at the top of this section made concrete -
// and the reason the badges, the reads and the message rules all work without knowing this is a private conversation.
//
// The names are copied in beside the ids for the same reason a message copies its author's: the room list draws thirty
// conversations and must not make thirty directory reads to label them. They are a snapshot, and a member who changes their
// name later is an old name in an old thread - the one cost this accepts, in exchange for a list that opens instantly.
export const chatThreadDoc = ({ memberIds = [], memberNames = [], creator, now } = {}) => {
  const ids = chatThreadMembersIn(memberIds);
  const named = new Map((Array.isArray(memberNames) ? memberNames : []).map((row) => [text(row && row.id), text(row && row.name)]));
  return {
    kind: 'private',
    name: '',
    member_ids: ids,
    member_names: ids.map((id) => named.get(id) || ''),
    audience_keys: ids.map((id) => `user:${id}`),
    created_at: now ?? null,
    created_by: text(creator && creator.id),
    created_by_name: text(creator && creator.name),
  };
};

// WHETHER A CONVERSATION IS A THREAD, for the two places that must tell them apart: the rooms tab (which manages rooms and
// must stop listing private conversations as if it could edit them) and the client (which titles a thread from its members).
// Absent means a room, so nothing that already exists has to be rewritten to stay a room.
export const isChatThread = (conversation) => text(conversation && conversation.kind) === 'private';

// =====================================================================================================================
// WHO IS IN A PRIVATE CONVERSATION, AND WHO MAY CHANGE THAT
// =====================================================================================================================
// ADDING AND REMOVING, which is the one thing about a thread that can change after it exists. Two rules govern it, and both
// fall out of what a thread already is - a conversation whose audience is its members (see the note at the top of this file):
//
//   * ONLY A MEMBER OF IT MAY CHANGE IT. Asking to be let into a conversation is not a way in; the whole point of a private
//     one is that the people in it decide. So the caller has to be on the list already.
//   * IT IS ALWAYS A THREAD. A station room's audience is a role or a rank, set by an officer in the rooms tab - so a member
//     editing a room's participants is refused rather than ignored, because "we removed you from the room" is a sentence this
//     app should never be able to say.
//
// WHO MAY BE ADDED is the same question asked when a thread is opened (chatThreadProblem): a real member, whose role grants
// chat, whose id can form one. WHO MAY BE REMOVED is anybody who is in it, INCLUDING THE CALLER - leaving is a removal of
// yourself, which is why there is no separate code path for it.
//
// THE FLOOR IS TWO. A thread with one member in it is a conversation nobody can have, so the last removal is refused rather
// than performed: a member who wants out of a two-person thread has to accept that the other person keeps the record, which
// is exactly what leaving a conversation means.
const chatPersonFor = ({ id, member, members = [] }) => {
  const mine = text(member && member.id);
  if (id === mine) return { name: text(member && member.name), can_use_chat: true };
  return (Array.isArray(members) ? members : []).find((row) => text(row && row.id) === id) || null;
};

export const chatParticipantProblem = ({ conversation, member, add = [], remove = [], members = [] } = {}) => {
  const me = text(member && member.id);
  if (!me) return 'Sign in first.';
  if (!conversation) return 'That conversation does not exist.';
  if (!isChatThread(conversation)) {
    return 'That is a station room. Who can see it is set by an officer, not from the chat.';
  }

  const current = chatThreadMembersIn(conversation.member_ids);
  if (!current.includes(me)) return 'You are not part of that conversation.';

  // Asked for, then narrowed to what would actually CHANGE: adding somebody who is already there and removing somebody who is
  // not are both no-ops rather than errors, because a screen that has gone stale should not produce a refusal about a fact
  // that no longer differs.
  const adds = chatThreadMembersIn(add).filter((id) => !current.includes(id));
  const removes = chatThreadMembersIn(remove).filter((id) => current.includes(id));
  if (!adds.length && !removes.length) return '';

  const after = [...current.filter((id) => !removes.includes(id)), ...adds];
  if (after.length > CHAT_THREAD_MEMBERS_MAX) {
    return `A private conversation holds up to ${CHAT_THREAD_MEMBERS_MAX} members.`;
  }
  if (after.length < CHAT_THREAD_MEMBERS_MIN) {
    return 'A private conversation needs two people. Leaving takes you out of it and leaves it to them.';
  }

  for (const id of adds) {
    const person = chatPersonFor({ id, member, members });
    if (!person) return 'One of those members is no longer in the station.';
    if (!person.can_use_chat) return `${text(person.name) || 'That member'} cannot use chat.`;
    if (!CHAT_ID_SAFE.test(id)) return `${text(person.name) || 'One of those members'} cannot be messaged.`;
  }

  return '';
};

// A PRIVATE CONVERSATION'S RECEIPTS DOCUMENT: how far each member has read, and the member list the rules check a caller
// against.
//
// WHY IT IS ITS OWN DOCUMENT RATHER THAN A FIELD ON THE CONVERSATION, which is where this started: the conversation carries the
// room list's own fields, and the send callable rewrites `last_preview` and the rest on EVERY message. A client watching the
// conversation for a receipt would therefore be woken per message; watching this is woken only when somebody reads - a handful
// of times a day. That difference is the whole reason these receipts moved here.
//
// THE MEMBER LIST IS COPIED IN, and it is not decoration: firestore.rules uses it to answer "may this caller write here at all",
// because a rule cannot read the conversation's list from this document. It is kept in step by whoever changes the membership
// (functions/index.js#updateChatParticipants), which already writes the conversation in the same call.
//
// `read_at` STARTS EMPTY AND STAYS A MAP OF TIMES, one key per member, each written by the member it belongs to. Times, not
// counts, because a receipt has to name the message it is about (utils/chat.js#deliveryStateFor).
export const chatReceiptsDoc = ({ conversationId, memberIds = [] } = {}) => ({
  conversation_id: text(conversationId),
  member_ids: chatThreadMembersIn(memberIds),
  read_at: {},
});

// WHAT A MEMBERSHIP CHANGE COPIES ONTO IT: the same list, so the rule above keeps answering correctly after somebody is added or
// removed. Separate from the document above because this is the merge a change writes, and only these two fields may move.
export const chatReceiptsMembership = ({ memberIds = [] } = {}) => ({
  member_ids: chatThreadMembersIn(memberIds),
});

// WHAT A MEMBERSHIP CHANGE WRITES. THREE FIELDS, ALWAYS TOGETHER, which is the one thing that must not be got wrong here:
// `member_ids` is who is in it, `member_names` labels them in the room list and the typing line, and `audience_keys` is the
// proof every reader and every rule checks. Write two of the three and the conversation splits in half - listed for one member
// and unreadable for another - which is a bug that looks like nothing at all until somebody cannot see their own messages.
//
// SORTED BY ID, because the id a thread was created with is derived from exactly this list (chatThreadIdFor): a different order
// would not be a different conversation - the id is fixed - but the stored list would disagree with the function that made it,
// and the next person to read this code would have to work out which of the two was right. Names travel WITH their ids rather
// than in a list beside them, so the parallel arrays cannot drift out of step.
//
// WHAT IT DELIBERATELY DOES NOT DO: REWRITE THE MESSAGES. A message carries the audience it was SENT to (see the note at the
// top of this file), so a member added to a conversation today can read what is said from today - and not the conversation that
// happened before they were in it. That is the PRIVACY BEHAVIOUR the station asked for rather than a limitation to fix: being
// added to a private conversation should not hand somebody the history of a conversation they were not part of, and a member
// who is removed stops seeing anything new for the same reason in reverse. Nothing here rewrites an audience, so history is
// fixed at the moment it was written - which is also why this function returns only those three fields and must keep doing so.
export const chatParticipantPatch = ({ conversation, add = [], remove = [], members = [] } = {}) => {
  const ids = chatThreadMembersIn(conversation && conversation.member_ids);
  const stored = Array.isArray(conversation && conversation.member_names)
    ? conversation.member_names.map((name) => String(name || ''))
    : [];
  const dropping = new Set(chatThreadMembersIn(remove));

  const kept = ids.map((id, at) => ({ id, name: stored[at] || '' })).filter((person) => !dropping.has(person.id));
  const added = chatThreadMembersIn(add)
    .filter((id) => !ids.includes(id))
    .map((id) => {
      const person = (Array.isArray(members) ? members : []).find((row) => text(row && row.id) === id);
      return { id, name: text(person && person.name) };
    });

  const next = [...kept, ...added].sort((left, right) => left.id.localeCompare(right.id));
  return {
    member_ids: next.map((person) => person.id),
    member_names: next.map((person) => person.name),
    audience_keys: next.map((person) => `user:${person.id}`),
  };
};
// =====================================================================================================================
// CHAT'S PUSH NOTIFICATIONS
// =====================================================================================================================
// WHICH SWITCH GOVERNS A MESSAGE, and what the notification says. Both are decisions rather than plumbing, which is why they
// live here beside the rest of chat's rules: the switch is a preference KEY - read against each member's own settings row, and
// the station's default behind it, by functions/index.js#deliverPush, which does that part for every notification the app
// sends - and the words are what somebody reads on a locked phone before deciding whether to look.
//
// TWO KINDS, BECAUSE THEY ARE TWO DIFFERENT INTERRUPTIONS. A private conversation is one colleague choosing to talk to you; a
// room is the station talking, and a busy room is noisier than any single conversation inside it. A member can therefore keep
// the first and mute the second - or the other way round - which is the whole reason there are two switches rather than one.
export const CHAT_PUSH_PREFERENCES = { private: 'notify_chat_direct', room: 'notify_chat_rooms' };

// A thread is private, anything else is a room. Read from the conversation rather than from the message, because "which kind
// of conversation is this" is a fact about the conversation - and because a message stamped with a kind would be a second copy
// of that fact to keep in step.
export const chatPushPreferenceFor = (conversation) =>
  isChatThread(conversation) ? CHAT_PUSH_PREFERENCES.private : CHAT_PUSH_PREFERENCES.room;

// WHAT THE PHONE SAYS. A private conversation HAS NO NAME (see chatThreadDoc above), so the author is the title and the
// message is the body - which is also the more useful way round: you know WHO wants you before you know what they said. A room
// does have a name, so the room is the title and the author labels the body.
//
// The body is trimmed to what a notification can show, and to the same width the room list's preview uses - a push is a
// glance, and the message itself is in the app. A message with nothing in it (an attachment-only future, a body that was
// emptied) still says something rather than arriving blank.
export const chatPushSummary = ({ conversation, message, preview } = {}) => {
  const author = text(message && message.author_name) || 'Somebody';
  const body = text(preview) || text(message && message.body) || 'Sent a message';
  const trimmed = body.length > CHAT_PREVIEW_MAX ? `${body.slice(0, CHAT_PREVIEW_MAX - 1)}…` : body;
  const room = text(conversation && conversation.name);
  return { title: room || author, body: room ? `${author}: ${trimmed}` : trimmed };
};

// WHO IS NOTIFIED, which is the inbox list MINUS THE AUTHOR. The inbox row keeps the sender - "unread" means "not read yet",
// and nobody has read their own sentence back (see the fan-out in functions/index.js) - but a phone must not buzz because its
// owner pressed Send, and that is the one place the two audiences differ.
export const chatPushRecipients = ({ recipients = [], authorId } = {}) => {
  const mine = text(authorId);
  return (Array.isArray(recipients) ? recipients : []).map(text).filter((uid) => uid && uid !== mine);
};

// WHO A MEMBER MAY START A CONVERSATION WITH: every member whose role grants Chat, apart from themselves.
//
// THE PICKER AND THE CALLABLE MUST AGREE, and that is the whole reason this is a function rather than a filter written in a
// screen. A list that offers somebody the server then refuses is a button that fails; a list that hides somebody the server
// would have allowed is a conversation nobody knows they could have had. `openChatThread` asks the same question about the
// members it was handed, so the list offered and the list accepted cannot drift apart.
//
// TWO REASONS SOMEBODY IS ABSENT, and they are different things: their role does not grant Chat, so they would not see the
// module at all (App.jsx, the rules and the fan-out all agree on that one permission), or their account cannot form a
// thread id in the first place (see chatThreadIdFor for why that is refused rather than patched up). Neither is offered,
// and neither is offered as a greyed-out row either: a member can act on neither, and a list of people you cannot message
// is a list of disappointments.
//
// `roles` arrives RESOLVED - each role's `can_use_chat` already settled - because that is a decision about a role rather
// than a fact about it, and the caller is where the master switch (`is_admin`) is applied. functions/index.js does it once,
// for both this and the thread opener.
export const chatReachablePeople = ({ viewerId = '', users = [], roles = [] } = {}) => {
  const mine = text(viewerId);
  const mayChat = new Map(
    (Array.isArray(roles) ? roles : []).map((role) => [text(role && role.id), role && role.can_use_chat === true])
  );

  return (Array.isArray(users) ? users : [])
    .map((user) => ({ id: text(user && user.id), name: text(user && user.name), role_id: text(user && user.role_id) }))
    .filter(
      (person) =>
        Boolean(person.id) && person.id !== mine && CHAT_ID_SAFE.test(person.id) && mayChat.get(person.role_id) === true
    )
    .map((person) => ({ id: person.id, name: person.name }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
};

// =====================================================================================================================
// EMOJI REACTIONS
// =====================================================================================================================
// A REACTION IS A MAP ON THE MESSAGE: `{ '👍': ['u1','u2'], '🔥': ['u3'] }`. That shape is the whole reason reactions are
// affordable - the window a member is already reading carries them, so a screen draws every reaction on every message it shows
// with no additional read at all. A reaction in a subcollection of its own would be a listener per message, which is the one
// arrangement this module has consistently refused.
//
// THE MAP IS WRITTEN BY A CALLABLE, like the message itself, and for the same reason: the messages collection refuses every
// client write (`allow create, update, delete: if false` in firestore.rules), because the audience proof a listener is proved
// by has to be unforgeable. Letting a browser add a field to that document would mean opening it to browsers - so a tap on an
// emoji costs one invocation, exactly as sending or editing one does, and the rules are left alone.
//
// THE SET IS CURATED, NOT EVERY EMOJI THE PICKER OFFERS. This is the client's "Reactions" group (utils/chatEmoji.js), and it is
// deliberately the same list rather than a second opinion: a message with forty distinct reactions is noise, and the sixteen
// below are the ones a station actually uses. scripts/verify-chat.mjs asserts the two lists agree, because a reaction the
// server refuses and the picker offers is a button that fails.
// EVERY EMOJI THE PICKER OFFERS, GROUPED EXACTLY AS THE PICKER GROUPS THEM (src/utils/chatEmoji.js#CHAT_EMOJI_GROUPS),
// because scripts/verify-chat.mjs asserts the two lists are EQUAL. That check is the thing that stops a picker offering a tap
// the server will refuse - and this list used to hold sixteen, which meant sixty taps were refused and (worse) swallowed.
//
// IT IS NOT "ANY EMOJI" ON PURPOSE: a reaction is a key on the message document, and a map keyed by whatever a client sent is
// a document nobody can bound. The CAP does that work (CHAT_REACTION_MAX distinct reactions on one message); this list says
// which emoji those may be.
export const CHAT_REACTION_EMOJI = [
  // Reactions
  '👍',
  '👎',
  '👌',
  '🙏',
  '👏',
  '🙌',
  '💪',
  '🤝',
  '❤️',
  '🔥',
  '🎉',
  '✅',
  '❌',
  '⚠️',
  '❓',
  '❗',
  // Faces
  '🙂',
  '😂',
  '🤣',
  '😉',
  '😎',
  '🤔',
  '😅',
  '😮',
  '😢',
  '😡',
  '😴',
  '🤒',
  '🥳',
  '😇',
  '🤯',
  '🫡',
  // Station
  '🚒',
  '🚑',
  '🚓',
  '🧯',
  '🧑‍🚒',
  '🚨',
  '🏠',
  '🌡️',
  '🌧️',
  '❄️',
  '🌲',
  '🐕',
  '☕',
  '🍕',
  '📣',
  '📅',
  // Hands and marks
  '✋',
  '🫱',
  '👉',
  '👋',
  '🖐️',
  '✌️',
  '🤙',
  '⏰',
  '📍',
  '🔧',
  '🔦',
  '🧰',
  '📱',
  '💬',
  '📌',
  '⭐',
];

// How many DISTINCT reactions one message may carry, and how many members may be behind one of them. Both are guards against a
// single tap turning into a document nobody can read rather than features anybody is expected to reach - a station of forty
// people reacting to one message is twenty percent of the first number, and the second is a whole station.
export const CHAT_REACTION_MAX = 8;
export const CHAT_REACTION_MEMBERS_MAX = 60;

// WHAT A MEMBER IS ASKING TO DO TO A MESSAGE, as a refusal or an empty string. `keys` are the caller's own audience keys, the
// same ones every other chat action is checked with (chatMemberProblem), so a member cannot react in a conversation they are
// not in - which sounds obvious and is exactly what a rule could not check for them.
export const chatReactionProblem = ({ message, member, emoji, keys = [] } = {}) => {
  const id = text(member && member.id);
  if (!id) return 'Sign in first.';
  if (!message) return 'That message is not there any more.';
  if (message.deleted_at) return 'A removed message cannot be reacted to.';
  const chosen = text(emoji);
  if (!CHAT_REACTION_EMOJI.includes(chosen)) return 'That is not one of the reactions.';
  if (!message.conversation_id) return 'That message is not in a conversation.';
  // The membership question is the same one every message action asks, and it is asked from the row's own stamped keys rather
  // than from a conversation read: a reaction is a small thing and should not cost a document.
  const audience = new Set((Array.isArray(message.audience_keys) ? message.audience_keys : []).map(text));
  const members = Array.isArray(message.member_ids) ? message.member_ids.map(text) : [];
  if (members.includes(id)) return '';
  if (!audience.size) return 'You are not part of that conversation.';
  if (audience.has('*') || audience.has(`user:${id}`)) return '';
  const reachable = (Array.isArray(keys) ? keys : []).some((key) => audience.has(text(key)));
  return reachable ? '' : 'You are not part of that conversation.';
};

// THE NEW MAP, with the caller added to one emoji or taken out of it - a toggle, because that is what a tap on a reaction is.
//
// AN EMPTY LIST IS REMOVED RATHER THAN KEPT, which matters more than it looks: an emoji holding an empty array still counts
// towards the distinct-reaction cap and still draws a pill with nobody behind it, so the document would slowly fill with the
// ghosts of reactions that were taken back.
export const chatReactionToggled = ({ reactions = {}, emoji, memberId } = {}) => {
  const chosen = text(emoji);
  const id = text(memberId);
  const next = {};
  Object.entries(reactions && typeof reactions === 'object' ? reactions : {}).forEach(([key, list]) => {
    const members = (Array.isArray(list) ? list : []).map(text).filter(Boolean);
    if (members.length) next[key] = members;
  });
  if (!chosen || !id) return next;

  const already = (next[chosen] || []).includes(id);
  if (already) {
    const without = next[chosen].filter((value) => value !== id);
    if (without.length) next[chosen] = without;
    else delete next[chosen];
    return next;
  }

  if (!next[chosen] && Object.keys(next).length >= CHAT_REACTION_MAX) return next;
  next[chosen] = [...(next[chosen] || []), id].slice(0, CHAT_REACTION_MEMBERS_MAX);
  return next;
};
