// Uploads and manages pre-incident plan files (building diagrams, aerial photos, floor plans, PDFs).
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import { firebaseStorage, storageConfigured } from './firebase.js';

export { storageConfigured };

// Storage path: pre_incident_plans/{planId}/{fileId}
export const preplanStoragePath = ({ planId, fileId }) =>
  `pre_incident_plans/${planId}/${fileId}`;

/**
 * Uploads a file for a Pre-Incident Plan (building diagram, floor plan, PDF, or photo).
 * If Firebase Storage is configured, uploads directly to Cloud Storage.
 * If Storage is not configured or errors, converts to a Data URL as fallback.
 */
export const uploadPreplanFile = async ({ planId, file, onProgress }) => {
  const fileId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `pip_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  if (!storageConfigured()) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve({
          fileId,
          name: file.name,
          size: file.size,
          contentType: file.type || 'application/octet-stream',
          dataUrl: reader.result,
          uploadedAt: new Date().toISOString(),
        });
      };
      reader.onerror = () => reject(new Error('Failed to read file locally.'));
      reader.readAsDataURL(file);
    });
  }

  try {
    const path = preplanStoragePath({ planId, fileId });
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
    console.warn('[preplanFileStorage] Cloud Storage upload error, falling back to local data URL:', storageErr);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve({
          fileId,
          name: file.name,
          size: file.size,
          contentType: file.type || 'application/octet-stream',
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
 * Opens a pre-incident plan file (PDF, diagram, image) in a new browser tab.
 */
export const openPreplanFile = async (fileObj) => {
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
      alert('Could not open file from storage.');
    }
  }
};

/**
 * Deletes an uploaded file from cloud storage.
 */
export const discardPreplanFile = async (storagePath) => {
  if (!storagePath || !storageConfigured()) return;
  try {
    await deleteObject(storageRef(firebaseStorage(), storagePath));
  } catch {
    // Ignore error if already deleted
  }
};

