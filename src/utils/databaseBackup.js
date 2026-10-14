// Helpers and formatting utilities for Firestore database backup and recovery status.

export const BACKUP_KEYS = {
  LAST_RUN: 'backup_last_run_at',
  STATUS: 'backup_last_status',
  MESSAGE: 'backup_last_message',
  BUCKET: 'backup_bucket_name',
  PITR: 'backup_pitr_status',
  RETENTION: 'backup_retention_days',
};

// Extracts backup configuration and status fields from system settings.
export const getBackupConfig = (systemSettings) => {
  const rows = Array.isArray(systemSettings) ? systemSettings : [];
  const get = (key) => {
    const row = rows.find((s) => String(s?.key ?? '').trim() === key);
    return row?.value || '';
  };

  return {
    lastRunAt: get(BACKUP_KEYS.LAST_RUN),
    status: get(BACKUP_KEYS.STATUS) || 'not_configured',
    message: get(BACKUP_KEYS.MESSAGE),
    bucket: get(BACKUP_KEYS.BUCKET),
    pitrStatus: get(BACKUP_KEYS.PITR) || 'enabled',
    retentionDays: get(BACKUP_KEYS.RETENTION) || '365',
  };
};

// Formats an ISO date string into a friendly, readable time for officers.
export const formatBackupDate = (isoString) => {
  if (!isoString) return 'Not yet run';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return String(isoString);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(date);
  } catch {
    return String(isoString);
  }
};

// Returns user-friendly status badge properties and explanatory copy.
export const backupStatusDetails = (status) => {
  switch (status) {
    case 'success':
      return {
        label: 'Active & Protected',
        variant: 'success',
        description: 'Latest database snapshot completed successfully and is securely archived.',
      };
    case 'running':
      return {
        label: 'Backup in Progress',
        variant: 'info',
        description: 'A snapshot export is currently running in the background.',
      };
    case 'failed':
      return {
        label: 'Attention Needed',
        variant: 'danger',
        description: 'The last backup attempt failed. Please check the error message below.',
      };
    case 'not_configured':
    default:
      return {
        label: 'Ready / Pending First Run',
        variant: 'warning',
        description: 'Automated daily snapshots run every night at 2:00 AM. You can also run a manual backup anytime.',
      };
  }
};

