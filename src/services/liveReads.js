// Sets up real-time Firestore listeners for data that changes frequently (chat, on-duty status, announcements).
import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { firestore } from './firebase.js';
import { CHAT_PAGE_SIZE } from '../utils/chat.js';
import { audienceKeysFor, settingRows, usersByIds } from './firestorePayload.js';
import { toDateKey } from '../utils/scheduleDate.js';

// Converts a Firestore snapshot into an array of plain JavaScript objects with IDs.
const rowsFrom = (snapshot) => snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }));

// Formats on-duty personnel rows, backfilling names or ranks if missing.
const onDutyFrom = async (snapshot) => {
  const rows = rowsFrom(snapshot);
  const missing = rows.filter((r) => !r.name || r.rank_id === undefined);
  let byId = {};
  if (missing.length > 0) {
    try {
      byId = Object.fromEntries((await usersByIds(missing.map((row) => row.id))).map((user) => [user.id, user]));
    } catch (err) {
      console.warn('[liveReads] failed to backfill users for on_duty listener:', err);
    }
  }
  return rows.map((row) => {
    const member = byId[row.id] || {};
    return {
      ...row,
      name: row.name || member.name || '',
      rank_id: row.rank_id !== undefined && row.rank_id !== '' ? row.rank_id : (member.rank_id ?? ''),
      user_id: row.id,
    };
  });
};

// Extracts plain data from a document snapshot, returning an empty object if missing.
const snapshotData = (snapshot) => (snapshot && typeof snapshot.data === 'function' ? snapshot.data() || {} : {});

// Checks whether a target is a single document or a collection query.
export const isDocumentTarget = (target) => Boolean(target && target.type === 'document');

// Attaches a real-time listener to a document or query with automatic error handling and fallback reads.
const watch = (target, shape, handler, onError) => {
  const isDocument = isDocumentTarget(target);
  const readOnce = () => (isDocument ? getDoc(target) : getDocs(target));
  const refreshOnce = () => {
    readOnce()
      .then((snapshot) => Promise.resolve(shape(snapshot)).then(handler))
      .catch((error) => {
        if (onError) onError(error);
      });
  };
  const fail = (error) => {
    if (onError) onError(error);
    refreshOnce();
  };
  const onNext = (snapshot) => {
    Promise.resolve(shape(snapshot)).then(handler).catch(fail);
  };
  return isDocument
    ? onSnapshot(target, onNext, fail)
    : onSnapshot(target, { includeMetadataChanges: false }, onNext, fail);
};

// Subscribes to chat inbox rooms and the active conversation's recent messages.
export const subscribeChat = ({ userId, roleId = '', rankId = '', conversationId = '', handlers = {}, onError } = {}) => {
  const id = String(userId || '').trim();
  const room = String(conversationId || '').trim();
  if (!id) return () => {};

  const db = firestore();
  const stops = [];

  if (handlers.inbox) {
    stops.push(watch(collection(db, 'chat_inbox', id, 'rooms'), rowsFrom, handlers.inbox, onError));
  }

  if (room && handlers.messages) {
    const keys = audienceKeysFor({ userId: id, roleId, rankId });
    stops.push(
      watch(
        query(
          collection(db, 'chat_conversations', room, 'messages'),
          where('audience_keys', 'array-contains-any', keys),
          orderBy('created_at', 'desc'),
          limit(CHAT_PAGE_SIZE)
        ),
        rowsFrom,
        handlers.messages,
        onError
      )
    );
  }

  return () => stops.forEach((stop) => stop());
};

// Subscribes to read receipts in a direct message conversation.
export const subscribeChatReceipts = ({ conversationId, onChange } = {}) => {
  const room = String(conversationId || '').trim();
  if (!room) return () => {};
  const db = firestore();
  return watch(doc(db, 'chat_receipts', room), snapshotData, onChange, () => {});
};

// Subscribes to live app updates for on-duty users, settings, schedule version, announcements, and events.
export const subscribeLive = ({ userId, handlers = {}, onError } = {}) => {
  const id = String(userId || '').trim();
  if (!id) return () => {};
  const db = firestore();
  const stops = [];
  let cancelled = false;

  if (handlers.onDuty) stops.push(watch(collection(db, 'on_duty'), onDutyFrom, handlers.onDuty, onError));
  if (handlers.systemSettings) {
    stops.push(watch(doc(db, 'settings', 'public'), settingRows, handlers.systemSettings, onError));
  }
  if (handlers.scheduleVersion) {
    stops.push(watch(doc(db, 'live', 'schedule'), snapshotData, handlers.scheduleVersion, onError));
  }
  if (handlers.workOrders) {
    stops.push(watch(collection(db, 'work_orders'), rowsFrom, handlers.workOrders, onError));
  }

  if (handlers.announcements || handlers.events) {
    void getDoc(doc(db, 'users', id))
      .then((snapshot) => {
        const me = snapshot.data() || {};
        const keys = audienceKeysFor({ userId: id, roleId: String(me.role_id || ''), rankId: String(me.rank_id || '') });
        if (cancelled) return;
        if (handlers.announcements) {
          const audienceQuery = () =>
            query(collection(db, 'announcements'), where('audience_keys', 'array-contains-any', keys));
          const watchAnnouncements = (target, fellBack = false) =>
            watch(target, rowsFrom, handlers.announcements, (error) => {
              if (fellBack) {
                if (onError) onError(error);
                return;
              }
              console.warn(
                '[firestore] announcements: the live listener could not use the "in force" bound, so it is watching the ' +
                  `collection unfiltered. The composite index for \`audience_keys\` + \`live_until\` is the likely cause.`,
                error
              );
              if (cancelled) return;
              stops.push(watchAnnouncements(audienceQuery(), true));
            });

          stops.push(
            watchAnnouncements(
              query(
                collection(db, 'announcements'),
                where('audience_keys', 'array-contains-any', keys),
                where('live_until', '>=', toDateKey(new Date()))
              )
            )
          );
        }
        if (handlers.events) {
          stops.push(
            watch(query(collection(db, 'events'), where('audience_keys', 'array-contains-any', keys)), rowsFrom, handlers.events, onError)
          );
        }
      })
      .catch((error) => {
        if (onError && !cancelled) onError(error);
      });
  }

  return () => {
    cancelled = true;
    stops.forEach((stop) => stop());
  };
};
