// Uploading a member's profile picture.
//
// THE BYTES GO STRAIGHT FROM THE BROWSER TO THE BUCKET - one request, with progress - and storage.rules#avatars decides
// whether they may: the member's uid is in the path, so permission is a string comparison rather than another document
// read. The LINK that comes back is written to the member's roster row through the normal write path
// (services/api#saveMemberAvatarUrl), because a rule cannot know what URL a Storage object will turn out to have.
//
// SO IT IS TWO STEPS, IN THIS ORDER, and the order is deliberate. A failure between them leaves a picture in the bucket
// that no row points at, which is invisible and costs a few kilobytes; the other order would leave a row pointing at
// nothing, which is a broken image beside somebody's name in every conversation in the station.
//
// A NOTE ON FAILING HALFWAY, because this path is STABLE (`avatars/{uid}`) rather than random like a certification
// scan's. A second upload overwrites the first, so the row's stored link and the bytes it points at only ever disagree
// about the STRING - the picture a reader sees comes from the same object either way. A failed row write therefore costs
// the member a "could not save" message and nothing else, and retrying fixes it without uploading anything again.
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import { firebaseStorage, storageConfigured } from './firebase.js';
import { AVATAR_MAX_EDGE, AVATAR_QUALITY, avatarUploadProblem } from '../utils/avatars.js';

// Re-exported so a SCREEN never has to reach into services/firebase for it: a component asks the service it already
// imports whether an upload could work at all, rather than offering a button that would fail at the first byte.
export { storageConfigured };

// avatars/{member uid} - ONE object per member, named only by their uid. Not a random file id the way a scan is: a
// picture is REPLACED rather than accumulated, so overwriting is the operation and the path has to be stable enough for
// a rule to name it.
export const avatarStoragePath = (userId) => `avatars/${String(userId || '').trim()}`;

// Downscale in the browser before a byte leaves it. A profile picture is drawn at 20-24px in a conversation, so a 3 MB
// photo from a phone is almost entirely waste - and it is waste that would be stored, billed, and then re-downloaded by
// every member who scrolls past a message.
//
// A PNG STAYS A PNG and everything else becomes a JPEG, which is not a detail: re-encoding a PNG that has transparency
// in it to JPEG is how a cut-out face acquires a black square behind it.
//
// EVERY FAILURE PATH RETURNS THE ORIGINAL FILE. A resize that cannot happen - a browser without a canvas, an image
// format it will not decode - must never be the reason somebody cannot set a picture. The upload's own checks then run
// against whatever is actually being sent, so the fallback cannot smuggle a 3 MB file past the guard.
const prepareImage = (file) =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      const longest = Math.max(image.width, image.height) || 0;
      if (!longest || longest <= AVATAR_MAX_EDGE) {
        resolve(file);
        return;
      }
      const scale = AVATAR_MAX_EDGE / longest;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const context = canvas.getContext('2d');
      if (!context) {
        resolve(file);
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const keepPng = String(file.type || '') === 'image/png';
      canvas.toBlob(
        (blob) =>
          resolve(
            blob
              ? new File([blob], keepPng ? file.name : `${String(file.name || 'picture').replace(/\.[^.]+$/, '')}.jpg`, {
                  type: keepPng ? 'image/png' : 'image/jpeg',
                })
              : file
          ),
        keepPng ? 'image/png' : 'image/jpeg',
        AVATAR_QUALITY
      );
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };

    image.src = url;
  });

// Upload one picture and answer the link it can be reached by.
//
// THE CHECKS RUN TWICE, ON DIFFERENT THINGS, and both are needed: once on the file somebody chose, so a 4 MB photo is
// refused before the browser spends a minute downscaling it; and once on what is actually being sent, because that is
// what storage.rules measures. The first refusal is the one a member reads.
export const uploadAvatar = async ({ userId, file, onProgress } = {}) => {
  const uid = String(userId || '').trim();
  if (!uid) throw new Error('You are not signed in.');
  if (!file) throw new Error('Choose a picture first.');

  const chosenProblem = avatarUploadProblem({ size: file.size, type: file.type });
  if (chosenProblem) throw new Error(chosenProblem);

  const prepared = String(file.type || '').startsWith('image/') ? await prepareImage(file) : file;
  const preparedProblem = avatarUploadProblem({ size: prepared.size, type: prepared.type });
  if (preparedProblem) throw new Error(preparedProblem);

  const storagePath = avatarStoragePath(uid);
  const task = uploadBytesResumable(storageRef(firebaseStorage(), storagePath), prepared, {
    // LOWER-CASED DELIBERATELY: the rule matches this string case-sensitively, and a browser is free to hand back
    // `IMAGE/JPEG`. Sending what the rule compares against is cheaper than teaching the rule to ignore case.
    contentType: String(prepared.type || '').toLowerCase(),
    // PRIVATE, AND ONLY AN HOUR - much shorter than a certification scan's day. This is one small file read by everybody,
    // so an hour saves the bandwidth; the brevity is what stops a replaced picture from lingering in somebody's browser
    // and appearing beside a message written after it was changed.
    cacheControl: 'private, max-age=3600',
  });

  await new Promise((resolve, reject) => {
    task.on(
      'state_changed',
      (snapshot) => {
        if (onProgress && snapshot.totalBytes) onProgress(snapshot.bytesTransferred / snapshot.totalBytes);
      },
      reject,
      resolve
    );
  });

  // MINTED FROM THE OBJECT rather than assembled, because the URL carries the bucket's own access token. Asking for it
  // here - rather than at render time, in the chat - is what makes "uploaded but cannot be linked" a failure now instead
  // of a broken image in every conversation later.
  const url = await getDownloadURL(storageRef(firebaseStorage(), storagePath));
  return { storagePath, url, size: prepared.size || file.size, contentType: String(prepared.type || '').toLowerCase() };
};

// Take the picture down, and answer whether it went. Best-effort: the caller clears the row either way, because a member
// whose file will not delete should still end up without a face beside their name.
export const removeAvatar = async (userId) => {
  try {
    await deleteObject(storageRef(firebaseStorage(), avatarStoragePath(userId)));
    return true;
  } catch {
    // Not there, or not this browser's to remove. Neither is worth a message on screen.
    return false;
  }
};
