import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import RankIcon from './RankIcon';
import { certificationCountdown } from '../utils/certifications';

// The sign-in notice: certifications that are about to run out, or that have.
//
// "Announcement-like" without being an announcement: it is not something an administrator wrote, and it should
// not be dismissible for everyone from the Announcements tab. It appears on the dashboard, for the member it is
// about, on every sign-in until the certification stops being a problem - and it can be put away for the
// session, which is what stops a warning from becoming wallpaper.
//
// Nothing renders when there is nothing to say, so a station with no warning windows configured never sees it.
export default function CertificationNotice({ alerts = [] }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || alerts.length === 0) return null;

  const expired = alerts.filter((row) => row.state === 'expired');

  return (
    <div className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 dark:border-amber-800/80 dark:bg-amber-950/40">
      <div className="flex items-start gap-3 p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
            {expired.length > 0
              ? 'A certification needs attention'
              : alerts.length === 1
                ? 'A certification expires soon'
                : 'Certifications expire soon'}
          </p>

          <ul className="mt-1.5 space-y-1">
            {alerts.map((row) => (
              <li
                key={row.id}
                className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200"
              >
                <RankIcon name={row.icon} className="h-4 w-4 shrink-0" />
                <span className="font-medium">{row.name || 'Certification'}</span>
                <span className="opacity-90">
                  {row.end_date ? `${row.end_date} · ${certificationCountdown(row.days_until_end)}` : ''}
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
            Ask an administrator to record the renewal — renewals are added as a new period, so your history
            stays.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="shrink-0 rounded-lg p-1.5 text-amber-700 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/60"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
