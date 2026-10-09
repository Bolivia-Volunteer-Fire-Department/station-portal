// WHAT MAY BE UPLOADED AS A PROFILE PICTURE, and what a link to one has to look like.
//
// THESE NUMBERS ARE THE CLIENT'S COPY OF storage.rules#avatars. They are duplicated there because rules cannot import
// JavaScript, which means the two have to agree, and the way they stay honest is that scripts/verify-avatars.mjs
// asserts the client refuses exactly what the rule refuses - the same arrangement scripts/verify-storage-rules.mjs
// keeps for certification scans.
//
// WHERE THEY DISAGREE, THE CLIENT'S COPY IS THE STRICTER OF THE TWO. That is the safe direction: refusing an upload the
// bucket would have accepted costs somebody a slightly different photo, where the other way round costs them a
// permission error they cannot read.
//
// WHY THE CAP SITS SO FAR ABOVE WHAT A PICTURE NEEDS. A real avatar is 20-60 KB once the browser has downscaled it
// (services/avatarStorage.js). 512 KB IS A GUARD, NOT A TARGET: it is the number that stops a phone photo, an unedited
// screenshot or a bad client from putting megabytes behind a 20px circle, without ever being the reason a legitimate
// upload fails. Storage is billed by the byte and fetched by every member who scrolls past a message, so this guard is
// what keeps a station's faces cheap.
export const AVATAR_MAX_BYTES = 512 * 1024;

// THREE TYPES, and `svg` is not among them for the reason it is not among the scan types either: an SVG is a picture
// that can carry script. HEIC is absent for the opposite reason to the scan list - an iPhone screenshot is a PNG, and
// the browser downscales whatever it is given before it uploads, so nothing arrives in a format nobody can display.
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// What a file picker should offer, which is deliberately the SHORT list: opening on "all files" invites a 4 MB HEIC
// that the rule then refuses, and the refusal arrives after the wait.
export const AVATAR_ACCEPT = 'image/jpeg,image/png,image/webp';

// THE LONGEST EDGE, IN PIXELS, AFTER DOWNSCALING. A profile picture is drawn at 20-24px in the chat and 40-64px in the
// places that show it larger; 256 leaves room for a high-density screen and a future layout without storing a photo
// that is never displayed. Quality is the other half of the size: 0.82 is where a face stops looking soft.
export const AVATAR_MAX_EDGE = 256;
export const AVATAR_QUALITY = 0.82;

// The rule allows this many characters in the stored URL (`privateText('avatar_url', 512)` in firestore.rules). A
// Storage download URL is around 150 characters, so this is headroom rather than a constraint.
export const AVATAR_URL_MAX = 512;

// The development bucket serves plain http on a loopback address, and so does the emulator. Kept as one pattern so the
// client's answer to "is this a real link?" and the rule's answer cannot drift apart by a typo.
const LOCAL_LINK = /^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/;

// Why this file cannot be a profile picture, or '' when it can.
//
// A SENTENCE RATHER THAN A BOOLEAN, because the caller's job is to put it on screen: "That picture is 4.2 MB; the limit
// is 512 KB" is something a member can act on - they pick a smaller one - where `false` is something they can only
// stare at. The same shape as the certification upload's checks, for the same reason.
export const avatarUploadProblem = ({ size = 0, type = '' } = {}) => {
  const kind = String(type || '').toLowerCase();
  if (!AVATAR_TYPES.includes(kind)) {
    return `A picture has to be a JPEG, a PNG or a WebP - that one is ${kind || 'not a type this browser named'}.`;
  }
  const bytes = Number(size) || 0;
  if (bytes > AVATAR_MAX_BYTES) {
    const shown = bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
    return `That picture is ${shown}; the limit is ${Math.round(AVATAR_MAX_BYTES / 1024)} KB.`;
  }
  return '';
};

// Why this LINK cannot be stored, or '' when it can. The mirror of the two `matches` clauses on the member's own-row
// write in firestore.rules, and it exists so that a link the database would refuse is refused here first, in words.
export const avatarUrlProblem = (url) => {
  const clean = String(url || '').trim();
  if (!clean) return 'There is no picture link to save.';
  if (clean.length > AVATAR_URL_MAX) return 'That picture link is too long to store.';
  if (!/^https:\/\//.test(clean) && !LOCAL_LINK.test(clean)) {
    return 'A picture link has to be an https address.';
  }
  return '';
};
