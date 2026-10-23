// Uploads and optimizes images inserted into Markdown documents (SOPs, Notes, Announcements).
import { getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import { firebaseStorage, storageConfigured } from './firebase.js';

export { storageConfigured };

const MAX_IMAGE_EDGE = 1600;
const JPEG_QUALITY = 0.85;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export const markdownImageStoragePath = (fileId) => `markdown_images/${fileId}`;

const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.readAsDataURL(file);
  });

/**
 * Downscales oversized images on an off-screen canvas so phone photos and high-DPI screenshots
 * load quickly inside documents.
 */
const compressMarkdownImage = (file) =>
  new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof Image === 'undefined') {
      resolve(file);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const longest = Math.max(img.width, img.height) || 0;
      const isPng = String(file.type || '').toLowerCase() === 'image/png';
      // Keep crisp small PNG screenshots untouched
      if (longest <= MAX_IMAGE_EDGE && file.size <= 1.2 * 1024 * 1024) {
        resolve(file);
        return;
      }

      const scale = longest > MAX_IMAGE_EDGE ? MAX_IMAGE_EDGE / longest : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const outType = isPng && file.size <= 2.5 * 1024 * 1024 ? 'image/png' : 'image/jpeg';
      const ext = outType === 'image/png' ? 'png' : 'jpg';
      const baseName = String(file.name || 'image').replace(/\.[^.]+$/, '');

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          resolve(new File([blob], `${baseName}.${ext}`, { type: outType }));
        },
        outType,
        outType === 'image/jpeg' ? JPEG_QUALITY : undefined
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    img.src = objectUrl;
  });

/**
 * Uploads an image for use inside a Markdown document and returns `{ url, alt }`.
 */
export const uploadMarkdownImage = async ({ file, onProgress } = {}) => {
  if (!file) throw new Error('Choose an image file first.');
  const mime = String(file.type || '').toLowerCase();
  if (!mime.startsWith('image/') || mime === 'image/svg+xml') {
    throw new Error('Please choose a PNG, JPEG, WebP, or GIF image.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('Image must be 10 MB or smaller.');
  }

  const prepared = await compressMarkdownImage(file);
  const defaultAlt = String(file.name || 'Screenshot')
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim();

  const ext = String(prepared.type || '').includes('png')
    ? 'png'
    : String(prepared.type || '').includes('webp')
      ? 'webp'
      : String(prepared.type || '').includes('gif')
        ? 'gif'
        : 'jpg';
  const fileId =
    (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`) + `.${ext}`;

  if (!storageConfigured()) {
    const dataUrl = await fileToDataUrl(prepared);
    return { url: dataUrl, alt: defaultAlt };
  }

  try {
    const path = markdownImageStoragePath(fileId);
    const task = uploadBytesResumable(storageRef(firebaseStorage(), path), prepared, {
      contentType: String(prepared.type || 'image/jpeg').toLowerCase(),
      cacheControl: 'public, max-age=31536000',
    });

    await new Promise((resolve, reject) => {
      task.on(
        'state_changed',
        (snapshot) => {
          if (onProgress && snapshot.totalBytes) {
            onProgress(snapshot.bytesTransferred / snapshot.totalBytes);
          }
        },
        reject,
        resolve
      );
    });

    const downloadUrl = await getDownloadURL(storageRef(firebaseStorage(), path));
    return { url: downloadUrl, alt: defaultAlt, storagePath: path };
  } catch (err) {
    console.warn('[markdownImageStorage] Cloud Storage upload failed, using inline Data URL fallback:', err);
    const dataUrl = await fileToDataUrl(prepared);
    return { url: dataUrl, alt: defaultAlt };
  }
};

