// Uploads and manages work order attachment files (photos of damage, repair receipts, etc.).
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import { firebaseStorage, storageConfigured } from './firebase.js';

export { storageConfigured };

// Storage path: work_orders/{workOrderId}/{fileId}
export const workOrderStoragePath = ({ workOrderId, fileId }) =>
  `work_orders/${workOrderId}/${fileId}`;

/**
 * Uploads an attachment file for a work order.
 * If Firebase Storage is configured, uploads directly to Cloud Storage.
 * If Storage is not configured, converts to a Data URL so it is fully usable locally.
 */
export const uploadWorkOrderFile = async ({ workOrderId, file, onProgress }) => {
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
    const path = workOrderStoragePath({ workOrderId, fileId });
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
    console.warn('[workOrderFileStorage] Cloud Storage upload error, falling back to local data URL:', storageErr);
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
 * Opens a work order attachment file (PDF, scan, image) in a new browser tab.
 */
export const openWorkOrderFile = async (fileObj) => {
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
 * Deletes an uploaded file from cloud storage if a work order draft is cancelled.
 */
export const discardWorkOrderFile = async (storagePath) => {
  if (!storagePath || !storageConfigured()) return;
  try {
    await deleteObject(storageRef(firebaseStorage(), storagePath));
  } catch {
    // Ignore error if already deleted
  }
};

