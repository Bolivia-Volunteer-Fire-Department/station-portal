// LIVE READS: the few collections where a listener is cheaper than re-reading, and the rule that decides which.
//
// WHY A LISTENER CAN BE CHEAPER. A one-shot read bills every document it returns, every time it runs - so the dashboard's
// "who is on duty" costs the same on the tenth mount as on the first, whether or not anybody clocked in since. A listener
// bills the CHANGED documents after its first snapshot, so the mounts after the first pay nothing at all: the listener is
// already attached, and only changes since then are billed. For a small collection on a screen that is opened often, that is
// the difference between paying per look and paying per change.
//
// AND MEASURED, BECAUSE THE CONVENIENT STORY IS NOT TRUE. It is often said that an attached listener also makes a one-shot
// read of the same query cache-served - which would be a second saving, since the sign-in payload reads these same
// collections. In this SDK it does not: a `getDocs` of a watched collection still reports `fromCache=false` and goes to the
// SERVER, and scripts/verify-firestore-reads.mjs prints that on every run rather than leaving it to be assumed. So the
// saving here is the repeat MOUNT; the payload's own read is unchanged, and nobody should budget as if a listener had made
// the sign-in cheaper.
//
// WHAT QUALIFIES - four conditions, and every collection here meets all of them:
//
//   1. SMALL. A listener's first snapshot is a read of everything it matches, paid on every attach. `schedule` holds every
//      shift the station has ever scheduled, so it stays windowed and one-shot. This is why the answer is not "listen to
//      everything".
//   2. THE RULES MUST PROVE THE QUERY. Firestore refuses a listener whose query the rules cannot prove is allowed - and the
//      audience collections are read with `array-contains-any` on `audience_keys`, which is the SAME query, so if the read
//      works the listener works. `on_duty` is `allow read: if signedIn()`; `settings/public` is one document.
//   3. NOT THE MEMBER'S OWN EDITS. `user_settings` and `push_devices` are changed by the member, on the screen that reads
//      them, through a save that already applies its own row locally (utils/savedRow). A listener there would race the
//      optimistic update to say the same thing. They stay one-shot: one small read per sign-in.
//   4. IT IS WORTH KEEPING LIVE. `on_duty` changes when somebody clocks in or out, on the screen every member lands on, so
//      the connection buys something a member can see. If that stops being true, delete the subscription - a listener
//      nobody answers is a socket held open for nothing.
import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { firestore } from './firebase.js';
// How many messages a chat window holds - the number that keeps an open conversation from re-reading its whole history.
import { CHAT_PAGE_SIZE } from '../utils/chat.js';
// The same key derivation and the same settings shaping the readers use, so a live row and a read row cannot drift apart.
import { audienceKeysFor, settingRows, usersByIds } from './firestorePayload.js';
// The date key the announcements listener bounds by, from the same helper the reader uses.
import { toDateKey } from '../utils/scheduleDate.js';

// A collection snapshot as the rows the readers return: the document id plus its data, which is what `rowsOf` builds. The
// shape matters more than it looks - the app hands both to the same setters, so a different key here is a screen that
// empties the moment a change arrives.
//
// THE DOCUMENT ID GOES LAST, and that is not style: a migrated row still carries the sheet's own `id` column, so spreading
// the data over the key lets a stale copy win - the same bug `rowsOf` had. It stayed invisible here for a while because the
// fixtures did not carry that column, so the read rows and the live rows agreed in the emulator and disagreed in
// production, where every migrated announcement has one: the payload read drew the announcements correctly, the listener
// then REPLACED them with rows keyed by a dead sheet id, and the screen changed shape the moment a change arrived.
const rowsFrom = (snapshot) => snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }));

// WHO IS ON DUTY, joined to a name and a rank - built EXACTLY as the reader builds it (firestoreReads.js#onDutyRows), for
// two reasons: the app hands a live row and a read row to the same setter, and `time_in` is a field a screen can reasonably
// want ("on duty since"), so the narrow three-field projection would quietly make live rows the poorer kind of row.
// The join reads `users` through the shared in-flight read, so a duty change costs one collection read and never a second
// one for a concurrent caller. The document id IS the member id here (`on_duty/{memberId}`), which is why the id is taken
// from the document and `user_id` is normalized to match it.
const onDutyFrom = async (snapshot) => {
  // Names and rank IDs are materialized on `on_duty/{memberId}`, so the listener needs no secondary reads.
  // For backward compatibility or partially seeded fixtures, missing fields fall back to `usersByIds`.
  const rows = rowsFrom(snapshot);
  const missing = rows.filter((r) => !r.name || r.rank_id === undefined);
  let byId = {};
  if (missing.length > 0) {
    byId = Object.fromEntries((await usersByIds(missing.map((row) => row.id))).map((user) => [user.id, user]));
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

// One listener, with its failures routed to the caller instead of vanishing. `shape` may be async (the duty join is), and
// the handler is only ever called with the shape the app expects.
//
// THE FALLBACK IS A ONE-SHOT READ, and the reason it exists is a network that kills the stream: a channel that cannot
// stay open long-polls and dies, and when it does the screen freezes on the last snapshot with no error the user can
// see. A one-shot `getDocs` still works when streaming does not, so the data is refreshed the same way the screen's
// own read refreshes it, and the SDK's own reconnect keeps trying for the stream in the background - the next error
// simply refreshes again. Nothing here is load-bearing, so a failed fallback is just logged.
// A SINGLE DOCUMENT'S CONTENTS, for the one listener that watches a document rather than a collection: `{ ... }` when it is
// there and `{}` when it is not yet. The sentinel does not exist until the first schedule write, so "no document" is a real
// answer rather than a failure - and an empty object is what the caller's own decision (utils/freshness.js) expects to be asked
// about.
const snapshotData = (snapshot) => (snapshot && typeof snapshot.data === 'function' ? snapshot.data() || {} : {});

// WHETHER THIS IS A DOCUMENT OR A COLLECTION, and it decides how the listener is attached and how it is refreshed. The modular
// SDK marks both: a DocumentReference has `type: 'document'` and a Query has `type: 'query'`.
export const isDocumentTarget = (target) => Boolean(target && target.type === 'document');

const watch = (target, shape, handler, onError) => {
  // A DOCUMENT TAKES NO OPTIONS, AND THAT COST EVERY DOCUMENT LISTENER IN THE APP.
  //
  // `onSnapshot(ref, options, next, error)` is the QUERY signature. Handed a DocumentReference in the first slot, the SDK
  // dispatches on the target and expects `(ref, next, error)` - so the options object landed where a callback belonged and the
  // whole call was refused with `Expected type 'Query', but it was: a custom aa object`. Nothing attached, nothing threw
  // anywhere a screen could see, and the collection listeners beside it worked perfectly - which is why it looked like "the
  // schedule sentinel does nothing" and "the delivery ticks never move" rather than like one shared bug.
  //
  // The one-shot fallback below had the same fault in the other direction: `getDocs` on a document reference is also wrong.
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

// CHAT'S LISTENERS: the badge, and the conversation that is open. Two subscriptions, and no more.
//
// WHAT QUALIFIES HERE, against the four conditions at the top of this file:
//
//   1. SMALL. The inbox is one document per room PER MEMBER - a handful - and the conversation listener is WINDOWED to
//      the last CHAT_PAGE_SIZE messages. That window is the whole reason chat can be live at all: a listener's first
//      snapshot bills every document it matches, so an unscoped one on a conversation would re-read the station's entire
//      history every time anybody opened a chat. "Load older" fetches backwards on demand instead.
//   2. THE RULES CAN PROVE IT. A message carries its own audience keys - stamped by the sending callable, never by a
//      client - so the query and the rule are the SAME keys, exactly as they are for announcements. That is what makes
//      this listener legal rather than refused.
//   3. NOT THE MEMBER'S OWN EDITS. The one thing a member writes here is their read mark, and the inbox listener is what
//      shows it: the two agree by construction, since both are the same document.
//   4. WORTH KEEPING LIVE. A badge that only updates when you look at it is not a badge.
//
// THE CONVERSATION LISTENER IS DETACHED WHEN THE ROOM CLOSES, which is condition 4 taken seriously: a socket nobody is
// reading is a socket held open for nothing. The SDK's own cache means re-opening a room paints from memory before the
// stream says anything, so closing and reopening costs no reads.
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
        // NEWEST FIRST, as the query orders them: the window is taken from the tail of the conversation, and the panel
        // draws it bottom-up. Reversing here would mean the limit took the OLDEST thirty, which is the opposite of what
        // a chat window is for.
        rowsFrom,
        handlers.messages,
        onError
      )
    );
  }

  return () => stops.forEach((stop) => stop());
};

// A PRIVATE CONVERSATION'S RECEIPTS: how far each member has read, for the ticks beside a member's own messages.
//
// A DOCUMENT OF ITS OWN IS THE POINT, not a detail. The receipt could have lived on the conversation, where a client is already
// looking - but that document carries the room list's own fields, and the send callable rewrites them on EVERY message, so a
// listener on it would be woken per message for a fact that changes when somebody READS. This one is woken only when a
// receipt moves, which is a handful of times a day (see functions/chat.js#chatReceiptsDoc).
//
// ATTACHED ONLY WHILE A PRIVATE CONVERSATION IS OPEN, and only for one: a station room has no receipts document at all, so a
// caller that watches one is holding a listener on a document that cannot exist.
export const subscribeChatReceipts = ({ conversationId, onChange } = {}) => {
  const room = String(conversationId || '').trim();
  if (!room) return () => {};
  const db = firestore();
  return watch(doc(db, 'chat_receipts', room), snapshotData, onChange, () => {});
};

// Subscribing is ONE call for the whole signed-in session, because these pieces belong together: they attach together, they
// are torn down together, and a caller holding four unsubscribes would eventually hold three. Returns the teardown.
//
// `handlers` is keyed by what it delivers (onDuty, announcements, events, systemSettings), and a handler that is not given
// is not subscribed to at all - so a screen that only wants the duty list pays for one listener rather than four.
export const subscribeLive = ({ userId, handlers = {}, onError } = {}) => {
  const id = String(userId || '').trim();
  if (!id) return () => {};
  const db = firestore();
  const stops = [];
  // The audience listeners attach AFTER their keys are read, so a teardown can arrive first - and then must still be
  // obeyed. Without this flag a screen that unmounted during that read would leave a listener running behind it.
  let cancelled = false;

  if (handlers.onDuty) stops.push(watch(collection(db, 'on_duty'), onDutyFrom, handlers.onDuty, onError));
  if (handlers.systemSettings) {
    stops.push(watch(doc(db, 'settings', 'public'), settingRows, handlers.systemSettings, onError));
  }
  // THE SCHEDULE'S SENTINEL: one tiny document, bumped by a trigger whenever the schedule changes, so a screen can be told its
  // window is stale WITHOUT holding a listener on the window itself. See functions/index.js#onShiftWritten for the bump and
  // utils/freshness.js for what the caller decides to do about it.
  //
  // THIS IS THE LISTENER THE SCHEDULE CANNOT HAVE, expressed as the one it can. The note at the top of this file says why the
  // schedule stays windowed and one-shot: a listener's first snapshot bills every document it matches, and the schedule holds
  // every shift the station has ever written. A single document costs one read to attach and one per change, and says the thing
  // a listener was wanted for - "something moved, read the window again".
  if (handlers.scheduleVersion) {
    stops.push(watch(doc(db, 'live', 'schedule'), snapshotData, handlers.scheduleVersion, onError));
  }

  if (handlers.announcements || handlers.events) {
    // The caller's own keys, from their own document - the same read the reader does, for the same reason: a claim can be an
    // hour stale, and a role change has to start showing the right announcements without waiting for a re-sign-in.
    void getDoc(doc(db, 'users', id))
      .then((snapshot) => {
        const me = snapshot.data() || {};
        const keys = audienceKeysFor({ userId: id, roleId: String(me.role_id || ''), rankId: String(me.rank_id || '') });
        if (cancelled) return;
        if (handlers.announcements) {
          // NARROWED EXACTLY AS THE READ IS, and for a reason that is easy to miss: this snapshot REPLACES what the read
          // put in the app's state, so a payload bounded to "in force" beside a listener that is not would pay for the
          // whole collection a moment after sign-in, and the narrowing would be theatre. See activeAudienceRows for why the
          // bound is a materialized `live_until` rather than the `end_date` column itself.
          //
          // A listener cannot fall back the way a read can - it is a stream, and "no documents" is a legitimate state - so
          // its fallback is a RE-SUBSCRIBE. If the bounded query cannot run (a missing composite index is the likely
          // cause), the plain, unbounded one takes over and the console says why: a stream that quietly delivers nothing
          // would empty the sidebar, which is the one failure this whole arrangement exists to prevent.
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

