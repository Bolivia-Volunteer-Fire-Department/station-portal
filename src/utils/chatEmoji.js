// THE EMOJI A STATION SENDS, and the arithmetic behind the "recent" row.
//
// Kept in a plain module rather than inside the picker so scripts/verify-chat.mjs can ask about it: a harness that runs
// in plain Node cannot load a .jsx file, and the recents list is the one part of the picker with a rule to get wrong
// (no duplicates, newest first, never growing without end).
export const CHAT_EMOJI_GROUPS = [
  { label: 'Reactions', emoji: ['👍', '👎', '👌', '🙏', '👏', '🙌', '💪', '🤝', '❤️', '🔥', '🎉', '✅', '❌', '⚠️', '❓', '❗'] },
  { label: 'Faces', emoji: ['🙂', '😂', '🤣', '😉', '😎', '🤔', '😅', '😮', '😢', '😡', '😴', '🤒', '🥳', '😇', '🤯', '🫡'] },
  { label: 'Station', emoji: ['🚒', '🚑', '🚓', '🧯', '🧑‍🚒', '🚨', '🏠', '🌡️', '🌧️', '❄️', '🌲', '🐕', '☕', '🍕', '📣', '📅'] },
  { label: 'Hands and marks', emoji: ['✋', '🫱', '👉', '👋', '🖐️', '✌️', '🤙', '⏰', '📍', '🔧', '🔦', '🧰', '📱', '💬', '📌', '⭐'] },
];

// Which emoji this device has used, newest first. A device habit rather than data, so it never touches Firestore.
export const CHAT_EMOJI_RECENTS_KEY = 'fire-clock-chat-emoji-recents';
export const CHAT_EMOJI_RECENTS_MAX = 12;

// The next recents list: the pressed emoji first, no duplicates, and never longer than the cap.
export const nextEmojiRecents = (list, emoji, max = CHAT_EMOJI_RECENTS_MAX) => {
  const value = String(emoji || '');
  const current = Array.isArray(list) ? list.filter((entry) => typeof entry === 'string') : [];
  if (!value) return current.slice(0, max);
  return [value, ...current.filter((entry) => entry !== value)].slice(0, max);
};

// EVERY EMOJI THE PICKER OFFERS IS ONE A MESSAGE CAN CARRY AS A REACTION, and this is that promise in one line: the list is
// DERIVED from the groups above rather than written out again, so the two cannot drift.
//
// THE SERVER KEEPS ITS OWN COPY (functions/chat.js#CHAT_REACTION_EMOJI). It has to - a Cloud Function cannot import from the
// site's build - and scripts/verify-chat.mjs asserts the two are equal, which is the only thing that keeps a picker from
// offering a tap the server will refuse.
//
// IT WAS NARROWER FOR AN AFTERNOON, AND THAT WAS THE WRONG ANSWER. The first fix for "picking an emoji does nothing" was to
// narrow this to the sixteen the server accepted, which made the picker lose options to hide a bug. The real fault was two
// things at once: the list was narrower than what people expected to be able to react with, and a REFUSED reaction was being
// swallowed rather than shown (components/Chat/ChatHost.jsx). The list is now everything the picker draws.
export const CHAT_REACTION_EMOJI = CHAT_EMOJI_GROUPS.flatMap((group) => group.emoji);