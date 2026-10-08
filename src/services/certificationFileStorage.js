// Uploading and opening a certification scan.
//
// THE BYTES GO STRAIGHT TO THE BUCKET from here - one request, with progress - and storage.rules decides whether they
// may. The ROW is written by a callable afterwards (functions/index.js#saveCertificationFile), because the two
// documents it has to check against each other - the record and the file - are not something a rule can read together.
// So attaching a file is two steps, and the order is deliberate: a failure between them leaves an object with no row,
// which is invisible and harmless, where the other order would leave a row pointing at nothing.
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import { firebaseStorage, storageConfigured } from './firebase.js';
import {
  CERTIFICATION_PHOTO_MAX_EDGE,
  CERTIFICATION_PHOTO_QUALITY,
} from '../utils/certificationFiles.js';

// Re-exported so a SCREEN never has to reach into services/firebase for it: a component asks the service it already
// imports whether an upload could work at all, rather than offering a button that would fail at the first byte.
export { storageConfigured };

// The member's uid and the record id are IN THE PATH, which is what lets storage.rules answer "may this browser read
// it?" with a string comparison instead of another two document reads. The file id is random and generated here; the
// server derives the path from it rather than trusting a path sent up from a browser.
export const certificationStoragePath = ({ userId, recordId, fileId }) =>
  `certifications/${userId}/${recordId}/${fileId}`;

// Downscale a photo before it leaves the browser, which is the common case in a fire station: somebody photographs a
// card with their phone. A PDF is passed through untouched - it is already the right shape, and re-encoding one in a
// browser is a good way to lose its text. Every failure path returns the original file: a resize that cannot happen
// must never be the reason an attachment cannot be made.
const prepareImage = (file) =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      const longest = Math.max(image.width, image.height) || 0;
      if (!longest || longest <= CERTIFICATION_PHOTO_MAX_EDGE) {
        resolve(file);
        return;
      }
      const scale = CERTIFICATION_PHOTO_MAX_EDGE / longest;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const context = canvas.getContext('2d');
      if (!context) {
        resolve(file);
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => resolve(blob ? new File([blob], file.name, { type: 'image/jpeg' }) : file),
        'image/jpeg',
        CERTIFICATION_PHOTO_QUALITY
      );
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };

    image.src = url;
  });

// Upload one file, reporting progress as a fraction, and answer what the recording call needs to know about it.
export const uploadCertificationFile = async ({ userId, recordId, file, onProgress }) => {
  const prepared = String(file.type || '').startsWith('image/') ? await prepareImage(file) : file;
  const fileId = crypto.randomUUID();
  const storagePath = certificationStoragePath({ userId, recordId, fileId });

  const task = uploadBytesResumable(storageRef(firebaseStorage(), storagePath), prepared, {
    contentType: prepared.type,
    // Cached privately for a day: a second look at the same scan costs no bandwidth, and no shared cache anywhere
    // gets to hold a copy of somebody's ID.
    cacheControl: 'private, max-age=86400',
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

  // The ORIGINAL name, deliberately: it is what the officer will read on the record, and a uuid is worse than useless
  // in a list. The size is the prepared file's, because that is what was actually stored.
  return { fileId, storagePath, name: file.name, size: prepared.size || file.size, contentType: prepared.type };
};

// Open a scan: a URL is minted now and never stored. `getDownloadURL` asks the bucket for the object's token URL, which
// the rules only hand over to a browser that may read the file at all - so the permission check and the URL come from
// the same place, and no secret link has to be written into a document to make a link work later.
export const openCertificationFile = async (storagePath) => {
  const url = await getDownloadURL(storageRef(firebaseStorage(), storagePath));
  window.open(url, '_blank', 'noopener,noreferrer');
};

// Throw away an upload that never got recorded - the server refused it, or the second step failed. Best-effort by
// design: the alternative to an orphaned object is a row pointing at nothing, and this is the lesser of the two.
export const discardCertificationUpload = async (storagePath) => {
  if (!storagePath) return;
  try {
    await deleteObject(storageRef(firebaseStorage(), storagePath));
  } catch {
    // Either it is not there or it is not this browser's to remove; neither is worth a message on screen.
  }
};
