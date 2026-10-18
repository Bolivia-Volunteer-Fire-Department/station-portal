// Uploads and manages form submission attachment files (pictures, diagrams, scans, PDFs).
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import { firebaseStorage, storageConfigured } from './firebase.js';

export { storageConfigured };

export const formFileStoragePath = ({ formId = 'general', fileId }) =>
  `form_submissions/${formId}/${fileId}`;

export const formatFileSize = (bytes) => {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

export const validateFormFile = (file) => {
  if (!file) return 'Please choose a file.';
  const type = String(file.type || '').trim().toLowerCase();
  const name = String(file.name || '').trim().toLowerCase();
  const isImage = type.startsWith('image/');
  const isPdf = type === 'application/pdf' || name.endsWith('.pdf');

  if (type === 'image/heic' || type === 'image/heif' || name.endsWith('.heic') || name.endsWith('.heif')) {
    return 'Photos from an iPhone are often HEIC, which cannot be viewed in standard web browsers. Please use JPEG or PNG.';
  }
  if (!isImage && !isPdf) {
    return 'Only pictures (JPEG, PNG, WebP) and PDF documents are accepted.';
  }
  if (!(file.size > 0)) return 'That file is empty.';
  if (file.size > 25 * 1024 * 1024) {
    return `File size is ${formatFileSize(file.size)}, and the limit is 25 MB.`;
  }
  return null;
};

/**
 * Uploads an attachment file for a form field.
 * If Firebase Storage is configured, uploads directly to Cloud Storage.
 * If Storage is not configured, converts to a Data URL so it is fully usable locally and offline.
 */
export const uploadFormFile = async ({ formId = 'general', file, onProgress }) => {
  const problem = validateFormFile(file);
  if (problem) throw new Error(problem);

  const fileId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `file_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  if (!storageConfigured()) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve({
          fileId,
          name: file.name,
          size: file.size,
          contentType: file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream'),
          dataUrl: reader.result,
          uploadedAt: new Date().toISOString(),
        });
      };
      reader.onerror = () => reject(new Error('Failed to read file locally.'));
      reader.readAsDataURL(file);
    });
  }

  try {
    const path = formFileStoragePath({ formId, fileId });
    const task = uploadBytesResumable(storageRef(firebaseStorage(), path), file, {
      contentType: file.type || 'application/octet-stream',
      cacheControl: 'private, max-age=86400',
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

    const downloadUrl = await getDownloadURL(storageRef(firebaseStorage(), path)).catch(() => '');

    return {
      fileId,
      storagePath: path,
      downloadUrl,
      name: file.name,
      size: file.size,
      contentType: file.type || 'application/octet-stream',
      uploadedAt: new Date().toISOString(),
    };
  } catch (storageErr) {
    console.warn('[formFileStorage] Cloud Storage upload error, falling back to local data URL:', storageErr);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve({
          fileId,
          name: file.name,
          size: file.size,
          contentType: file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream'),
          dataUrl: reader.result,
          uploadedAt: new Date().toISOString(),
          fallbackLocal: true,
        });
      };
      reader.onerror = () => reject(storageErr);
      reader.readAsDataURL(file);
    });
  }
};

/**
 * Opens an uploaded attachment file (PDF, scan, photo) in a new browser tab.
 */
export const openFormFile = async (fileObj) => {
  if (!fileObj) return;

  if (fileObj.dataUrl) {
    const w = window.open();
    if (w) {
      w.document.write(
        `<!DOCTYPE html><html><head><title>${fileObj.name || 'File Preview'}</title></head><body style="margin:0;background:#1e293b;display:flex;align-items:center;justify-content:center;height:100vh;"><iframe src="${fileObj.dataUrl}" style="border:0;width:100%;height:100%;" allowfullscreen></iframe></body></html>`
      );
      w.document.close();
    }
    return;
  }

  if (fileObj.downloadUrl) {
    window.open(fileObj.downloadUrl, '_blank', 'noopener,noreferrer');
    return;
  }

  if (fileObj.storagePath) {
    try {
      const url = await getDownloadURL(storageRef(firebaseStorage(), fileObj.storagePath));
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.warn('Could not retrieve file download URL:', err);
    }
  }
};

/**
 * Discards an uploaded file from cloud storage if a form response or draft is removed.
 */
export const discardFormFile = async (storagePath) => {
  if (!storagePath || !storageConfigured()) return;
  try {
    await deleteObject(storageRef(firebaseStorage(), storagePath));
  } catch {
    // Ignore error if already deleted
  }
};

