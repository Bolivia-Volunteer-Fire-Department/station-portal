// What counts as a read, for the one decision that still needs to know: api.js sends reads to the reader dispatcher and
// everything else to the writers.
//
// WHAT USED TO BE HERE, AND WHERE IT WENT. This module also held a request coalescer (`createReadCoalescer` / `readKey`)
// that shared an in-flight Apps Script read between callers asking the same question at the same moment. It existed
// because Apps Script runs ONE execution at a time behind a script lock, so two callers meant two executions of the same
// answer - paid in seconds of queue, not in reads.
//
// Both halves of that problem went away with the move to Firestore: reads no longer take a lock, and the request layer it
// keyed on (`appScriptFetch`, since renamed `dispatchRequest` when the sheet left that path) no longer carries them - a read now goes straight to the reader dispatcher, so there is
// nothing left for a key of [action, token, payload] to coalesce. The DISCIPLINE was still worth keeping, so it moved to
// where the duplicate reads actually are: one shared IN-FLIGHT read of a collection, in firestorePayload.js#readUsersOnce,
// under the same rule - share only while the read is in flight, and drop the entry the moment it settles, so nothing is
// ever served stale and a read after a write always sees the write.
//
// Pure and dependency-free, so scripts/verify-refresh-wiring.mjs can exercise the rule without a browser.
export const isReadAction = (action) => /^(?:ADMIN_)?GET_|^PING$/.test(String(action ?? ''));
