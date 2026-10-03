// Whether this device has a network, and the sentences to say when it has not.
//
// WHY THIS IS A MODULE. Two places need the same answer and must not drift apart: the clock card, which should refuse
// BEFORE it asks for GPS (a permission prompt is a poor first answer to a request that cannot work), and the writers,
// which must refuse before Firestore QUEUES the write.
//
// THE TRUSTWORTHY-CLOCK RULE (the README, "Offline"). Firestore queues a write made with no connection and
// applies it when one returns, and every timestamp in that write is whatever the DEVICE said when the button was pressed.
// For most writes that is not merely acceptable but right: a note written on the way to the station should carry the time
// it was written. For CLOCKING IN AND OUT it is not, because that record is itself an assertion about when somebody was at
// the station - it is what the station uses to say who was on duty. A device with a wrong clock, or a queued write that
// lands four hours late, produces something that looks like a fact and is not one. So those two writes refuse instead of
// queueing.
//
// ABSENT MEANS ONLINE. A Node harness and an older browser both have no `navigator.onLine`, and a guard that refuses when
// it cannot tell would lock a member out of clocking in. The failure has to be "try it, and let the write speak".
//
// Pure and dependency-free on purpose - no React, so scripts/verify-offline.mjs can drive it. The online/offline listeners
// live in App.jsx, where the rendering is.
export const OFFLINE_CLOCK_MESSAGE =
  'You are offline, so clocking in and out is not available. Connect and try again.';

// For any other write that a device-offline failure stopped. It says "not saved" rather than "failed" because that is the
// part the member needs to know: nothing landed, so trying again is safe rather than a duplicate.
export const OFFLINE_WRITE_MESSAGE = 'You are offline, so that change was not saved. Connect and try again.';

export const isOffline = () => {
  if (typeof navigator === 'undefined' || !navigator) return false;
  return navigator.onLine === false;
};
