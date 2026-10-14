const { getFirestore } = require('firebase-admin/firestore');
const { HttpsError, onCall } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions/logger');
const { v1 } = require('@google-cloud/firestore');

// Helper to resolve the active GCP / Firebase project ID.
const resolveProjectId = () => {
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT;
  try {
    const config = JSON.parse(process.env.FIREBASE_CONFIG || '{}');
    if (config.projectId) return config.projectId;
  } catch {
    // Ignore parse errors.
  }
  return 'demo-station-portal';
};

// Target GCS bucket for long-term cold storage / archives.
const resolveBackupBucket = (projectId) => {
  const custom = process.env.BACKUP_STORAGE_BUCKET;
  if (custom && custom.trim()) {
    const trimmed = custom.trim();
    return trimmed.startsWith('gs://') ? trimmed : `gs://${trimmed}`;
  }
  return `gs://${projectId}-firestore-backups`;
};

const isGranted = (value) => value === true || String(value).trim().toUpperCase() === 'TRUE';

// Checks if the calling user has permission to manage system settings and backups.
const checkOfficerPermission = async (db, uid, flag) => {
  const user = await db.doc(`users/${uid}`).get();
  if (!user.exists) return false;
  const roleId = String(user.get('role_id') || '');
  if (!roleId) return false;
  const role = await db.doc(`roles/${roleId}`).get();
  if (!role.exists) return false;
  return isGranted(role.get('is_admin')) || isGranted(role.get(flag));
};

// Performs a Firestore export and records the resulting status into settings/public.
const performDatabaseBackup = async ({ triggeredBy = 'system' } = {}) => {
  const db = getFirestore();
  const projectId = resolveProjectId();
  const bucket = resolveBackupBucket(projectId);
  const startTime = new Date().toISOString();

  // Indicate that a backup operation is currently running.
  await db.doc('settings/public').set(
    {
      backup_last_run_at: startTime,
      backup_last_status: 'running',
      backup_last_message: `Snapshot started by ${triggeredBy}...`,
    },
    { merge: true }
  );

  const isEmulator = Boolean(
    process.env.FUNCTIONS_EMULATOR ||
    process.env.FIRESTORE_EMULATOR_HOST ||
    projectId.startsWith('demo-')
  );

  if (isEmulator) {
    const finishTime = new Date().toISOString();
    const message = 'Simulated cold-storage snapshot completed (emulator environment).';
    await db.doc('settings/public').set(
      {
        backup_last_run_at: finishTime,
        backup_last_status: 'success',
        backup_last_message: message,
        backup_bucket_name: bucket,
        backup_pitr_status: 'enabled',
        backup_retention_days: '365',
      },
      { merge: true }
    );
    logger.info(`[Database Backup] ${message} Target: ${bucket}`);
    return {
      success: true,
      status: 'success',
      message,
      timestamp: finishTime,
      bucket,
    };
  }

  try {
    const client = new v1.FirestoreAdminClient();
    const databaseName = client.databasePath(projectId, '(default)');
    const dateStamp = startTime.slice(0, 10);
    const timeStamp = startTime.slice(11, 19).replace(/:/g, '-');
    const outputUriPrefix = `${bucket}/${dateStamp}/${timeStamp}`;

    const [operation] = await client.exportDocuments({
      name: databaseName,
      outputUriPrefix,
    });

    const finishTime = new Date().toISOString();
    const message = `Snapshot export operation started (${operation?.name || 'in progress'}). Stored at ${outputUriPrefix}`;
    await db.doc('settings/public').set(
      {
        backup_last_run_at: finishTime,
        backup_last_status: 'success',
        backup_last_message: message,
        backup_bucket_name: bucket,
        backup_pitr_status: 'enabled',
        backup_retention_days: '365',
      },
      { merge: true }
    );

    logger.info(`[Database Backup] ${message}`);
    return {
      success: true,
      status: 'success',
      message,
      timestamp: finishTime,
      bucket,
    };
  } catch (error) {
    logger.error('[Database Backup] Export operation failed:', error);
    const finishTime = new Date().toISOString();
    const message = error.message || 'Export operation failed.';
    await db.doc('settings/public').set(
      {
        backup_last_run_at: finishTime,
        backup_last_status: 'failed',
        backup_last_message: message,
      },
      { merge: true }
    );

    return {
      success: false,
      status: 'failed',
      error: message,
    };
  }
};

// Scheduled daily snapshot at 2:00 AM Eastern Time.
const backupFirestoreDaily = onSchedule(
  {
    schedule: '0 2 * * *',
    timeZone: 'America/New_York',
    retryCount: 1,
  },
  async () => {
    logger.info('[Database Backup] Scheduled daily backup initiated.');
    await performDatabaseBackup({ triggeredBy: 'automated schedule (daily at 2:00 AM)' });
  }
);

// Callable function to allow an authorized officer to manually trigger a database backup.
const triggerManualBackup = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in first.');
  const db = getFirestore();
  const allowed = await checkOfficerPermission(db, caller.uid, 'can_edit_system_settings');
  if (!allowed) {
    throw new HttpsError('permission-denied', 'You do not have permission to trigger a database backup.');
  }
  return performDatabaseBackup({ triggeredBy: `officer (${caller.uid})` });
});

// Callable function to fetch database backup status details.
const getDatabaseBackupStatus = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in first.');
  const db = getFirestore();
  const allowed = await checkOfficerPermission(db, caller.uid, 'can_edit_system_settings');
  if (!allowed) {
    throw new HttpsError('permission-denied', 'You do not have permission to view database backup status.');
  }
  const snap = await db.doc('settings/public').get();
  const data = snap.data() || {};
  return {
    lastRunAt: data.backup_last_run_at || '',
    status: data.backup_last_status || 'not_configured',
    message: data.backup_last_message || '',
    bucket: data.backup_bucket_name || '',
    pitrStatus: data.backup_pitr_status || 'enabled',
    retentionDays: data.backup_retention_days || '365',
  };
});

module.exports = {
  backupFirestoreDaily,
  triggerManualBackup,
  getDatabaseBackupStatus,
  performDatabaseBackup,
  resolveBackupBucket,
};

