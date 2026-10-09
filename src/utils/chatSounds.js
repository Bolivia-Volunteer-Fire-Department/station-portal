// WHICH CHAT SOUND A MOMENT MAKES - and, more often than not, that it makes none.
//
// Pure decisions, beside the app's other sound rules (utils/soundRules.js) and for the same reason: the interesting part
// is the judgement, not the Audio element, and a judgement can be exercised without a browser. scripts/verify-chat-sounds.mjs
// asks these directly. utils/uiSounds plays what they choose, and it owns the member's own sound switch - a member who has
// turned the app's sounds off hears none of these either, which is the point of putting chat's six in the one engine.
//
// THE SIX MOMENTS, and the two rules that run through all of them:
//
//   * A MUTED ROOM IS SILENT. Muting a room already stops it counting towards the badge (see utils/chat.js#unreadCountFor);
//     it stops its sounds too. "Quiet" that still goes off is not quiet.
//   * YOUR OWN MESSAGE IS NOT AN EVENT. The sender's own message plays the send sound once, where it was sent - and every
//     later path that sees it again (the badge growing, the listener echoing it) stays quiet, which is why the author is
//     part of the question rather than an afterthought.
export const CHAT_SOUNDS = {
  open: 'chat_open',
  close: 'chat_close',
  enter: 'chat_enter',
  exit: 'chat_exit',
  notify: 'chat_notify',
  send: 'chat_send',
};

const ids = (list) => (Array.isArray(list) ? list.map((id) => String(id || '')).filter(Boolean) : []);

// OPENING, CLOSING, AND MOVING BETWEEN CONVERSATIONS.
//
// MOVING IS ONE SOUND, NOT TWO, and the file names are what makes that worth stating: going from one room to another is
// not "leaving a conversation and joining one" - it is arriving somewhere, which is `chat_open`. A close is a
// conversation being put away, which is why closing the panel with a room open is NOT a close (the conversation is still
// open behind it) and going back to the room list is.
export const chatNavigationSound = ({ from, to } = {}) => {
  const was = String(from || '');
  const now = String(to || '');
  if (now && now !== was) return CHAT_SOUNDS.open;
  if (!now && was) return CHAT_SOUNDS.close;
  return '';
};

// A MESSAGE, from either end of it.
//
// `focused` means the conversation is the one on screen: its messages arrive in front of the member, so they get the same
// sound as sending one - the conversation's own tone. A message that arrives while the member is somewhere else gets the
// notification tone instead, because it is asking for attention rather than confirming something visible.
export const chatMessageSound = ({ mine, focused, muted } = {}) => {
  if (muted) return '';
  if (mine) return CHAT_SOUNDS.send;
  return focused ? CHAT_SOUNDS.send : CHAT_SOUNDS.notify;
};

// A BADGE GROWING SOMEWHERE THE MEMBER IS NOT LOOKING - the other half of the rule above, driven by the inbox rather
// than by the messages (a conversation nobody has open is exactly the one whose messages are not in hand).
//
// IT NEEDS THE AUTHOR, and that is not decoration: the fan-out gives the sender a row too, so their own message grows
// their own badge the moment after they send it. Without the author, switching rooms straight after sending would ring
// the notification tone for your own sentence.
export const chatBadgeSound = ({ unreadBefore, unreadAfter, focused, muted, authorId, viewerId } = {}) => {
  if (muted || focused) return '';
  if (String(authorId || '') && String(authorId) === String(viewerId || '')) return '';
  return Number(unreadAfter) > Number(unreadBefore) ? CHAT_SOUNDS.notify : '';
};

// WHO IS IN THE CONVERSATION. "Even you" and "even if it is not you" both come to the same thing here: the sound is about
// the room changing, so it does not care who moved.
//
// A JOIN OUTRANKS A LEAVE. Both in one change means somebody was added and somebody else removed, and of the two the
// room growing is the one worth hearing; two tones played over each other would be neither.
export const chatParticipantSound = ({ previous, next } = {}) => {
  const before = new Set(ids(previous));
  const after = new Set(ids(next));
  if ([...after].some((id) => !before.has(id))) return CHAT_SOUNDS.enter;
  if ([...before].some((id) => !after.has(id))) return CHAT_SOUNDS.exit;
  return '';
};