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
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { firestore } from './firebase.js';
// The same key derivation and the same settings shaping the readers use, so a live row and a read row cannot drift apart.
import { audienceKeysFor, readUsersOnce, settingRows } from './firestorePayload.js';
// The date key the announcements listener bounds by, from the same helper the reader uses.
import { toDateKey } from '../utils/scheduleDate.js';

// A collection snapshot as the rows the readers return: the document id plus its data, which is what `rowsOf` builds. The
// shape matters more than it looks - the app hands both to the same setters, so a different key here is a screen that
// empties the moment a change arrives.
const rowsFrom = (snapshot) => snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));

// WHO IS ON DUTY, joined to a name and a rank - built EXACTLY as the reader builds it (firestoreReads.js#onDutyRows), for
// two reasons: the app hands a live row and a read row to the same setter, and `time_in` is a field a screen can reasonably
// want ("on duty since"), so the narrow three-field projection would quietly make live rows the poorer kind of row.
// The join reads `users` through the shared in-flight read, so a duty change costs one collection read and never a second
// one for a concurrent caller. The document id IS the member id here (`on_duty/{memberId}`), which is why the id is taken
// from the document and `user_id` is normalized to match it.
const onDutyFrom = async (snapshot) => {
  const users = await readUsersOnce();
  const byId = Object.fromEntries(users.map((user) => [user.id, user]));
  return rowsFrom(snapshot).map((row) => {
    const member = byId[row.id] || {};
    return { ...row, name: member.name || '', rank_id: member.rank_id ?? '', user_id: row.id };
  });
};

// One listener, with its failures routed to the caller instead of vanishing. `shape` may be async (the duty join is), and
// the handler is only ever called with the shape the app expects.
const watch = (target, shape, handler, onError) => {
  const fail = (error) => {
    if (onError) onError(error);
  };
  return onSnapshot(
    target,
    { includeMetadataChanges: false },
    (snapshot) => {
      Promise.resolve(shape(snapshot)).then(handler).catch(fail);
    },
    fail
  );
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

