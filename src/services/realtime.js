// PRESENCE AND TYPING: the connection, the disconnect handlers, and the two listeners. Nothing here decides anything - see
// utils/presence.js for the windows, what counts as a stamp, and when a member should announce themselves.
//
// WHY THIS IS OPTIONAL TO THE APP, and the rule every function here obeys: A BUILD WITHOUT A CONFIGURED DATABASE IS A NO-OP,
// NOT A CRASH. Chat is Firestore's - rooms, messages, badges - and this database holds two facts that expire. A build whose
// VITE_FIREBASE_DATABASE_URL is empty (a developer's, a fork's, an older deployment's) must lose the green dot and nothing
// else, so every function below returns early rather than throwing, and every subscriber returns an unsubscribe function
// whether it subscribed or not. That last part matters more than it reads: a caller that had to check whether presence
// existed would get it wrong once, in one place, and that place would be a crash on somebody's phone.
//
// WHY THE DISCONNECT IS REGISTERED BEFORE EVERY WRITE. `onDisconnect` is a promise the SERVER holds: it runs the cleanup when
// the socket dies, whether the tab was closed, the phone lost signal or the battery went. It must be armed BEFORE the stamp
// is written, because a tab that dies in between the two leaves a stamp on the server that nothing will ever remove - which
// is exactly the stale green dot this whole design exists to prevent. So: arm, then write. That order, in both publishes.
import { onDisconnect, onValue, ref, remove, serverTimestamp, set } from 'firebase/database';
import { firebaseDatabase, realtimeConfigured } from './firebase';
import { PRESENCE_HEARTBEAT_MS, presenceDue } from '../utils/presence';

// The paths, one place each, because they are the contract with database.rules.json: `presence/{uid}` and
// `typing/{conversationId}/{uid}`. A rule file is written against exactly those strings.
export const presencePath = (uid) => `presence/${String(uid || '')}`;
export const typingPath = (conversationId) => `typing/${String(conversationId || '')}`;

// A FAILED PRESENCE WRITE IS NOT WORTH TELLING ANYBODY ABOUT. Presence is a nicety, and a chat that shows an error because a
// dot could not be drawn has traded something that matters for something that does not. It goes to the console, where an
// engineer looks, and no further.
const quietly = (error) => console.info('[realtime] presence or typing could not be updated:', error && error.message);

// WHO IS ONLINE. One listener on the whole tree, which is why this is affordable: Realtime Database sends a single node to
// everybody listening to it, where asking Firestore the same question is a document per member.
export const subscribePresence = ({ onChange } = {}) => {
  if (!realtimeConfigured()) return () => {};
  try {
    return onValue(ref(firebaseDatabase(), 'presence'), (snapshot) => onChange?.(snapshot.val() || {}), quietly);
  } catch (error) {
    quietly(error);
    return () => {};
  }
};

// WHO IS TYPING IN ONE CONVERSATION, and only that one: the tree is keyed by conversation, so a member with one chat open
// listens to one node rather than to a tree that grows with the whole station's typing.
export const subscribeTyping = ({ conversationId, onChange } = {}) => {
  const id = String(conversationId || '');
  if (!realtimeConfigured() || !id) return () => {};
  try {
    return onValue(ref(firebaseDatabase(), typingPath(id)), (snapshot) => onChange?.(snapshot.val() || {}), quietly);
  } catch (error) {
    quietly(error);
    return () => {};
  }
};

// PUBLISHING THAT SOMEBODY IS HERE. Called on the way in and on every heartbeat. The disconnect arming is idempotent, so
// doing it again per heartbeat costs nothing and removes the chance of any write happening without it.
export const publishPresence = async (uid) => {
  const id = String(uid || '');
  if (!realtimeConfigured() || !id) return false;
  try {
    const node = ref(firebaseDatabase(), presencePath(id));
    await onDisconnect(node).remove();
    await set(node, { at: serverTimestamp() });
    return true;
  } catch (error) {
    quietly(error);
    return false;
  }
};

// LEAVING, which is the graceful half of the same story the disconnect handles for the ungraceful one. Called when the
// member signs out or the app unmounts - deliberately not per render: presence is a run of heartbeats, not a per-frame fact.
export const clearPresence = async (uid) => {
  const id = String(uid || '');
  if (!realtimeConfigured() || !id) return false;
  try {
    await remove(ref(firebaseDatabase(), presencePath(id)));
    return true;
  } catch (error) {
    quietly(error);
    return false;
  }
};

// THE HEARTBEAT: a timer around the decision in utils/presence.js#presenceDue. The first beat is IMMEDIATE, because a member
// who has just signed in is here now - waiting half a minute to say so would leave them invisible for exactly the window in
// which they are most likely to be looked for.
//
// Returns the stop function, which clears the timer AND removes the node: the two things "stop being present" means.
export const startPresenceHeartbeat = ({ uid, every = PRESENCE_HEARTBEAT_MS } = {}) => {
  const id = String(uid || '');
  if (!realtimeConfigured() || !id) return () => {};

  // The stamp THIS CLIENT last published, remembered locally and never read back from the server: the only question is
  // whether this client has said anything recently, and a round trip to ask that would be the opposite of the point.
  let at = 0;
  const beat = async () => {
    if (!presenceDue({ at, now: Date.now(), every })) return;
    // Set BEFORE the await, not after: a slow write must not let the next beat start a second one on top of it.
    at = Date.now();
    await publishPresence(id);
  };

  void beat();
  // Twice per interval, so a beat cannot be missed to a slow frame or a sleeping tab without the stamp going stale: the
  // decision above still decides, and this only decides how often it is asked.
  const timer = setInterval(() => void beat(), Math.max(5000, Math.round(every / 2)));

  return () => {
    clearInterval(timer);
    void clearPresence(id);
  };
};

// SAYING SOMEBODY IS TYPING, and taking it back. Two functions rather than one with a flag, because they are different acts
// under different rules (see the validation in database.rules.json): one writes a stamp, the other removes the node.
export const publishTyping = async ({ conversationId, uid } = {}) => {
  const id = String(conversationId || '');
  const member = String(uid || '');
  if (!realtimeConfigured() || !id || !member) return false;
  try {
    const node = ref(firebaseDatabase(), `${typingPath(id)}/${member}`);
    await onDisconnect(node).remove();
    await set(node, { at: serverTimestamp() });
    return true;
  } catch (error) {
    quietly(error);
    return false;
  }
};

export const clearTyping = async ({ conversationId, uid } = {}) => {
  const id = String(conversationId || '');
  const member = String(uid || '');
  if (!realtimeConfigured() || !id || !member) return false;
  try {
    await remove(ref(firebaseDatabase(), `${typingPath(id)}/${member}`));
    return true;
  } catch (error) {
    quietly(error);
    return false;
  }
};