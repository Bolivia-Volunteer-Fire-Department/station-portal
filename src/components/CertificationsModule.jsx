import React, { useEffect, useState } from 'react';
import { BadgeCheck, CalendarDays, AlertTriangle } from 'lucide-react';
import RankIcon from './RankIcon';
import CenteredContent from './CenteredContent';
import { fetchCertifications } from '../services/api';
import {
  certificationStateLabel,
  certificationStateBadge,
  certificationCountdown,
} from '../utils/certifications';

// The member's own certifications. Read-only on purpose: this is the member's side of a record their
// supervisors keep, and "who says I am certified" is not a question a form on this page should be able to
// answer. Dates and status only.
//
// It reads on open rather than carrying the rows in the bootstrap: this is the only screen that shows the full
// set, and what the bootstrap does carry (the sign-in notice) is a subset of it.
export default function CertificationsModule({ token }) {
  const [certifications, setCertifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let canceled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchCertifications(token);
        if (canceled) return;
        if (!response?.success) {
          setError(response?.message || 'Could not load your certifications.');
          return;
        }
        setCertifications(response.certifications || []);
      } catch (err) {
        if (!canceled) setError(err.message || 'Could not load your certifications.');
      } finally {
        if (!canceled) setLoading(false);
      }
    };

    if (token) load();
    else setLoading(false);

    return () => {
      canceled = true;
    };
  }, [token]);

  const current = certifications.filter((row) => row.state === 'active' || row.state === 'expiring');
  const attention = certifications.filter((row) => row.state === 'expiring' || row.state === 'expired');

  return (
    <CenteredContent className="space-y-6">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        <div className="flex items-center gap-3 p-6 border-b border-slate-200 dark:border-slate-700">
          <div className="p-2.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-red-500">
            <BadgeCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Certifications</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {loading
                ? 'Loading your certifications…'
                : error
                  ? error
                  : certifications.length === 0
                    ? 'Nothing has been recorded for you yet.'
                    : `${current.length} current${
                        attention.length > 0 ? `, ${attention.length} needing attention` : ''
                      } — recorded by the station, so ask an administrator if something is missing or wrong.`}
            </p>
          </div>
        </div>

        {certifications.length === 0 ? (
          <p className="p-6 text-sm text-slate-500 dark:text-slate-400">
            Your certifications will appear here once an administrator records them.
          </p>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-700/70">
            {certifications.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center gap-3 px-6 py-4">
                <RankIcon
                  name={row.icon}
                  className="w-5 h-5 shrink-0 text-slate-500 dark:text-slate-300"
                />

                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900 dark:text-white">{row.name || 'Certification'}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    <CalendarDays className="mr-1 inline-block w-3 h-3 align-[-2px]" />
                    {row.effective_date ? `Effective ${row.effective_date}` : 'No effective date'}
                    {row.end_date ? ` · Ends ${row.end_date}` : ' · No end date'}
                    {row.state === 'expiring' || row.state === 'expired'
                      ? ` · ${certificationCountdown(row.days_until_end)}`
                      : ''}
                  </p>
                </div>

                <span
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${certificationStateBadge(
                    row.state
                  )}`}
                >
                  {certificationStateLabel(row.state)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {attention.length > 0 && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800/80 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 w-4 h-4 shrink-0" />
          <p>
            {attention.length === 1
              ? `One certification needs attention: ${attention[0].name}.`
              : `${attention.length} certifications need attention.`}{' '}
            Speak to an administrator about renewing {attention.length === 1 ? 'it' : 'them'}.
          </p>
        </div>
      )}
    </CenteredContent>
  );
}
