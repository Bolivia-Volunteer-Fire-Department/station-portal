// Uploads and manages member profile pictures in cloud storage.
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import { firebaseStorage, storageConfigured } from './firebase.js';
import { AVATAR_MAX_EDGE, AVATAR_QUALITY, avatarUploadProblem } from '../utils/avatars.js';

// Let components check if storage is enabled without importing Firebase directly.
export { storageConfigured };

// Each user's picture is stored at avatars/{userId}.
export const avatarStoragePath = (userId) => `avatars/${String(userId || '').trim()}`;

// Resizes large pictures down to fit avatar dimensions before uploading.
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

// Uploads an avatar image and returns its download link.
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
    // Use lower-case MIME type to match storage rule checks.
    contentType: String(prepared.type || '').toLowerCase(),
    // Cache for 1 hour so avatar updates show up reasonably quickly.
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

  // Get the download URL with access token.
  const url = await getDownloadURL(storageRef(firebaseStorage(), storagePath));
  return { storagePath, url, size: prepared.size || file.size, contentType: String(prepared.type || '').toLowerCase() };
};

// Deletes a member's profile picture from cloud storage.
export const removeAvatar = async (userId) => {
  try {
    await deleteObject(storageRef(firebaseStorage(), avatarStoragePath(userId)));
    return true;
  } catch {
    // Ignore error if picture was already missing.
    return false;
  }
};
