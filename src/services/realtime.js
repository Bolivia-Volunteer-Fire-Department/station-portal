// Manages online presence (green dots) and live typing indicators using Firebase Realtime Database.
import { onDisconnect, onValue, ref, remove, serverTimestamp, set } from 'firebase/database';
import { firebaseDatabase, realtimeConfigured } from './firebase';
import { PRESENCE_HEARTBEAT_MS, presenceDue } from '../utils/presence';

// Path for a user's presence: presence/{uid}
export const presencePath = (uid) => `presence/${String(uid || '')}`;

// Path for typing indicators in a chat room: typing/{conversationId}
export const typingPath = (conversationId) => `typing/${String(conversationId || '')}`;

// Helper to log errors quietly to the console without interrupting user flow.
const quietly = (error) => console.info('[realtime] presence or typing could not be updated:', error && error.message);

// Listens to online status for all users in real-time.
export const subscribePresence = ({ onChange } = {}) => {
  if (!realtimeConfigured()) return () => {};
  try {
    return onValue(ref(firebaseDatabase(), 'presence'), (snapshot) => onChange?.(snapshot.val() || {}), quietly);
  } catch (error) {
    quietly(error);
    return () => {};
  }
};

// Listens to who is currently typing in a specific conversation.
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

// Publishes that the current user is active and sets an automatic cleanup if they disconnect.
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

// Removes the current user's presence when they sign out or close the app.
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

// Periodically sends a heartbeat so the server knows the user is still connected.
export const startPresenceHeartbeat = ({ uid, every = PRESENCE_HEARTBEAT_MS } = {}) => {
  const id = String(uid || '');
  if (!realtimeConfigured() || !id) return () => {};

  let at = 0;
  const beat = async () => {
    if (!presenceDue({ at, now: Date.now(), every })) return;
    at = Date.now();
    await publishPresence(id);
  };

  void beat();
  const timer = setInterval(() => void beat(), Math.max(5000, Math.round(every / 2)));

  return () => {
    clearInterval(timer);
    void clearPresence(id);
  };
};

// Records that a user has started typing in a conversation.
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

// Clears the typing status when the user stops typing or sends a message.
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