// Uploads and views certification scan files (PDFs and images) in cloud storage.
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import { firebaseStorage, storageConfigured } from './firebase.js';
import {
  CERTIFICATION_PHOTO_MAX_EDGE,
  CERTIFICATION_PHOTO_QUALITY,
} from '../utils/certificationFiles.js';

// Let components check if storage is enabled without importing Firebase directly.
export { storageConfigured };

// Builds storage path: certifications/{userId}/{recordId}/{fileId}
export const certificationStoragePath = ({ userId, recordId, fileId }) =>
  `certifications/${userId}/${recordId}/${fileId}`;

// Resizes large photos before uploading so they do not waste space.
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

// Uploads a certification file and reports upload progress.
export const uploadCertificationFile = async ({ userId, recordId, file, onProgress }) => {
  const prepared = String(file.type || '').startsWith('image/') ? await prepareImage(file) : file;
  const fileId = crypto.randomUUID();
  const storagePath = certificationStoragePath({ userId, recordId, fileId });

  const task = uploadBytesResumable(storageRef(firebaseStorage(), storagePath), prepared, {
    contentType: prepared.type,
    // Cache privately for one day so re-opening does not redownload.
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

  // Return file metadata for the backend database record.
  return { fileId, storagePath, name: file.name, size: prepared.size || file.size, contentType: prepared.type };
};

// Generates a download URL and opens the file in a new tab.
export const openCertificationFile = async (storagePath) => {
  const url = await getDownloadURL(storageRef(firebaseStorage(), storagePath));
  window.open(url, '_blank', 'noopener,noreferrer');
};

// Deletes an uploaded file if something went wrong saving its record.
export const discardCertificationUpload = async (storagePath) => {
  if (!storagePath) return;
  try {
    await deleteObject(storageRef(firebaseStorage(), storagePath));
  } catch {
    // Ignore error if file is already gone.
  }
};
