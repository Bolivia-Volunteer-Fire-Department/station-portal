// Sharing one in-flight READ between callers that ask for it at the same moment.
//
// Why this exists: at an administrator's sign-in the app fires its member wave (schedule, availability, roster,
// offers, training, announcements, events) and its admin wave (the initial payload, users, templates/assignments/
// offers, schedule, roster, on-duty, training, announcements, events) at the same instant. Six of those are the
// SAME read fetched twice - two GET_SCHEDULEs in flight against a backend that runs one execution at a time behind
// a script lock. Every execution costs about a second before it reads anything, so the duplicates were pure queue:
// the second copy of each call sat behind the first for no new data, and the last calls in the queue were the ones
// that ran out of the client's 60s patience.
//
// The rule is deliberately narrow: only actions that read, and only while an identical request is actually in
// flight. Nothing is cached across time - the entry is dropped the moment the request settles, so a read after a
// write still sees the write. A write never joins anything, which is what keeps this from ever making a save
// look applied when it was not.
//
// Pure and dependency-free, so it can be exercised without a browser - see scripts/verify-refresh-wiring.mjs.

// GET_* and ADMIN_GET_* are the read actions; PING is a read too. No write action contains "GET_" (they are
// ADMIN_SAVE_*, ADMIN_DELETE_*, UPDATE_*, CLOCK_*, SUBMIT_* and so on), which is what makes this safe as a rule
// rather than a hand-maintained list that a new action would silently fall outside of.
export const isReadAction = (action) => /^(?:ADMIN_)?GET_|^PING$/.test(String(action ?? ''));

// Two requests are the same read when the action, the session and the payload all match.
//
// The OPTIONS are deliberately not part of the key. Every read that can be asked for twice today (the initial
// payload, the schedule, the roster) passes the same `retryOnNetworkError`, so two callers always mean the same
// request. If that ever stops being true, the flags belong in the key: a caller that asked for a retry and joined
// one that did not would be quietly denied the retry it asked for.
export const readKey = (body) =>
  JSON.stringify([
    String(body?.action ?? ''),
    String(body?.token ?? body?.payload?.token ?? ''),
    body?.payload ?? null,
  ]);

export const createReadCoalescer = () => {
  const inFlight = new Map();
  return {
    // The promise already running for this key, or null when this caller should do the work itself.
    join: (key) => inFlight.get(key) || null,
    // Publishes a promise to later callers and drops it when it settles - so the entry can never outlive the
    // request it stands for, and a failure is shared rather than cached.
    hold: (key, promise) => {
      const release = () => inFlight.delete(key);
      promise.then(release, release);
      inFlight.set(key, promise);
      return promise;
    },
    size: () => inFlight.size,
  };
};
