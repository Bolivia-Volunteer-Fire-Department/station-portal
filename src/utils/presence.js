// WHO IS ONLINE, AND WHO IS TYPING - the decisions, with no socket in sight.
//
// WHY THE DECISIONS ARE SEPARATE FROM THE DATABASE, and it is the same split as utils/soundRules and utils/chatSounds:
// services/realtime.js owns the connection, the disconnection handlers and the timers, and everything it would otherwise
// have to THINK about lives here, where a harness can ask it directly. What is worth testing about presence is not the
// socket - it is the judgement: how long a stamp stays good, what counts as somebody typing, and how often a conversation
// is allowed to be told.
//
// WHY A TIMESTAMP RATHER THAN A BOOLEAN, which is the whole shape of this feature: an "online: true" flag is a claim that
// has to be taken back, and the one case that matters is the case where nobody is left to take it back - the phone that
// lost signal, the tab that was killed, the laptop that shut. So a member publishes WHEN THEY WERE LAST HERE, every client
// treats a stamp older than a window as gone, AND the connection's own disconnect removes the node (see
// services/realtime.js). Three things, one of which is a timer: any one of them fails and the others still answer.
//
// THESE NUMBERS ARE THE FEATURE. They are the difference between a green dot that means something and one that lies, so
// they live here, together, with their reasoning rather than scattered through the code that uses them.
//
// WHAT MAY BE WRITTEN WHERE IS NOT HERE. That is database.rules.json, and it is worth knowing two things about that file
// before reading it: it must be PURE JSON (Realtime Database rules take no comments, unlike firestore.rules, which is why
// the reasoning behind it lives in prose here and in scripts/verify-presence.mjs rather than beside the rules themselves),
// and a Realtime Database rule CANNOT consult Firestore - so it can ask whether you are signed in and whether the node is
// yours, but not whether your role grants `can_use_chat`. What that costs, honestly: presence and typing are readable by
// any signed-in member and writable only on their own node, which is what it is.
export const PRESENCE_STALE_MS = 90 * 1000;

// How often a signed-in member republishes their own stamp. A third of the window above, so two heartbeats can be lost - a
// phone going through a dead spot, a laptop asleep at the lock screen - before anybody sees them vanish.
export const PRESENCE_HEARTBEAT_MS = 30 * 1000;

// Typing is shorter-lived than presence on purpose. Presence is a fact about a person; typing is a fact about a moment, and
// a stale "Ana is typing…" sitting under a conversation that has moved on is worse than none at all.
export const TYPING_STALE_MS = 6 * 1000;

// HOW OFTEN A CONVERSATION MAY BE TOLD SOMEBODY IS TYPING. Every keystroke writing a stamp would be a write per letter; this
// is the number that keeps it at a handful per message, so it is the throttling half of the feature rather than decoration.
export const TYPING_THROTTLE_MS = 2500;

// A stamp from Realtime Database arrives as a NUMBER (milliseconds since 1970, which is what `serverTimestamp()` writes) -
// but it can also arrive as null, or as whatever a hand-written client put there. Anything that is not a usable number is
// treated as NO STAMP rather than as "now", because a broken clock is not a reason to believe somebody is present.
export const stampMillis = (value) => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

// HOW FAR AHEAD A STAMP MAY BE AND STILL BE BELIEVED.
//
// Two clocks never agree exactly, so some grace is needed - a member flickering offline because their phone is two seconds
// ahead is a bug nobody would ever diagnose. But an UNBOUNDED grace is a hole: a stamp written far in the future never
// expires, so a hand-written client could park itself permanently online, and presence would have no way to age it out. Two
// minutes is far more than any real clock disagreement and far less than anything worth lying about.
export const PRESENCE_FUTURE_GRACE_MS = 2 * 60 * 1000;

// WHETHER A STAMP IS STILL GOOD. `now` is passed in rather than read here, so a harness can ask about any moment it likes
// and a caller can ask about many stamps against one reading of the clock.
export const isPresent = ({ at, now = Date.now(), stale = PRESENCE_STALE_MS, grace = PRESENCE_FUTURE_GRACE_MS } = {}) => {
  const stamp = stampMillis(at);
  if (!stamp) return false;
  // A stamp from the future is tolerated to the grace above and refused beyond it - see the note on the constant.
  if (stamp - now > grace) return false;
  return now - stamp <= stale;
};

// WHO IS ONLINE, from one snapshot of the presence tree: the ids whose stamp is still good.
//
// THE TREE IS READ WHOLESALE rather than per member, which is the reason this feature is affordable: Realtime Database
// sends one node to every client listening to it, where asking Firestore the same question is a document per member.
export const onlineIds = ({ presence = {}, now = Date.now(), stale = PRESENCE_STALE_MS, viewerId = '' } = {}) => {
  const mine = String(viewerId || '');
  return Object.keys(presence || {})
    .filter((uid) => uid && uid !== mine && isPresent({ at: presence[uid] && presence[uid].at, now, stale }))
    .sort();
};

// How many of the people in a conversation are online. Asked with the ids to count, so a caller never has to know the shape
// of the presence tree to use it - and a station room, whose audience is a role rather than a list of people, simply has no
// ids to pass.
export const onlineCountOf = ({ ids = [], presence = {}, now = Date.now(), stale = PRESENCE_STALE_MS } = {}) =>
  (Array.isArray(ids) ? ids : []).filter((id) =>
    isPresent({ at: (presence || {})[String(id)] && (presence || {})[String(id)].at, now, stale })
  ).length;

// WHO IS TYPING HERE, excluding the member asking - the one thing a typing indicator must never tell somebody is that they
// are the one doing the typing.
export const typingIdsIn = ({ typing = {}, now = Date.now(), stale = TYPING_STALE_MS, viewerId = '' } = {}) => {
  const mine = String(viewerId || '');
  return Object.keys(typing || {})
    .filter((uid) => uid && uid !== mine && isPresent({ at: typing[uid] && typing[uid].at, now, stale }))
    .sort();
};

// WHAT TO SAY ABOUT IT. One name, two names, and after that a number - because a list of six names is not a sentence, and
// the sixth name adds nothing to "somebody is talking to you".
export const typingLabelFor = ({ names = [] } = {}) => {
  const people = (Array.isArray(names) ? names : []).map((name) => String(name || '').trim()).filter(Boolean);
  if (!people.length) return '';
  if (people.length === 1) return `${people[0]} is typing…`;
  if (people.length === 2) return `${people[0]} and ${people[1]} are typing…`;
  return `${people.length} people are typing…`;
};

// WHAT A TYPING BOX SHOULD DO NEXT: announce itself, stop announcing itself, or stay quiet.
//
//   'announce' - there is text in the box and the conversation has not been told recently
//   'clear'    - the box is empty, so anything said earlier has to be taken back
//   ''         - nothing has changed worth a write
//
// THE CLEAR IS THE HALF THAT GETS FORGOTTEN. An indicator that only expires on its own sits under the conversation for six
// seconds after somebody pressed Send, which reads as a broken app rather than a slow one. `lastSentAt` is the caller's
// memory of what it has ALREADY published, which is what keeps this a pure decision rather than one that needs the socket.
//
// AND THE DELETE GOES FIRST, before the annotation about the empty box: an empty draft published as a stamp would say the
// member is typing harder, not that they have stopped.
export const typingActionFor = ({ draft = '', lastSentAt = 0, now = Date.now(), throttle = TYPING_THROTTLE_MS } = {}) => {
  const body = String(draft ?? '').trim();
  const published = Number(lastSentAt) || 0;
  if (!body) return published ? 'clear' : '';
  if (!published) return 'announce';
  return now - published >= throttle ? 'announce' : '';
};

// WHETHER A MEMBER'S OWN PRESENCE IS DUE TO BE REPUBLISHED. The heartbeat, as a decision: no stamp at all means publish,
// and otherwise only once the interval above has passed. `at` is the member's own last stamp as THEY remember it, which is
// never read back from the server - the local fact is the one this needs, and a round trip to confirm it would be the
// opposite of the point.
export const presenceDue = ({ at = 0, now = Date.now(), every = PRESENCE_HEARTBEAT_MS } = {}) => {
  const stamp = stampMillis(at);
  if (!stamp) return true;
  return now - stamp >= every;
};

// WHETHER A CONVERSATION'S TYPING INDICATOR, ON SCREEN NOW, NEEDS TO BE RE-DRAWN. The stamps expire on their own - the
// last one stops counting six seconds after it was written - but nothing in Realtime Database fires an event to say so, so
// a client drawing "Ana is typing…" from a snapshot it took earlier would leave it there. This is the answer to "should I
// ask again", and it exists so that a screen can set ONE timer for the moment the last stamp dies rather than polling.
export const typingExpiresIn = ({ typing = {}, now = Date.now(), stale = TYPING_STALE_MS, viewerId = '' } = {}) => {
  const ids = typingIdsIn({ typing, now, stale, viewerId });
  if (!ids.length) return 0;
  const soonest = Math.min(...ids.map((uid) => stampMillis(typing[uid] && typing[uid].at) + stale));
  return Math.max(0, soonest - now);
};