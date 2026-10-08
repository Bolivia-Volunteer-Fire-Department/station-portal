import React, { useEffect, useState } from 'react';
import { BadgeCheck, CalendarDays, AlertTriangle, FileText, Loader2 } from 'lucide-react';
import RankIcon from './RankIcon';
import CenteredContent from './CenteredContent';
import { fetchCertifications, fetchMyCertificationFiles } from '../services/api';
import { openCertificationFile } from '../services/certificationFileStorage';
import {
  certificationStateLabel,
  certificationStateBadge,
  certificationCountdown,
} from '../utils/certifications';

// The member's own certifications. Read-only on purpose: this is the member's side of a record their
// supervisors keep, and "who says I am certified" is not a question a form on this page should be able to
// answer. Dates, status, and - where an officer attached one - the scan itself, which a member may open and
// may not change.
//
// It reads on open rather than carrying the rows in the bootstrap: this is the only screen that shows the full
// set, and what the bootstrap does carry (the sign-in notice) is a subset of it. The ATTACHED SCANS are a second
// small read in the same wave, because the button that opens one is drawn per row.
export default function CertificationsModule({ token }) {
  const [certifications, setCertifications] = useState([]);
  // Keyed by the record's own id, because a record has at most one scan: see the one-file-per-record rule in
  // functions/index.js#saveCertificationFile.
  const [files, setFiles] = useState({});
  const [openingId, setOpeningId] = useState('');
  const [openError, setOpenError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let canceled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [response, fileResponse] = await Promise.all([
          fetchCertifications(token),
          fetchMyCertificationFiles(token),
        ]);
        if (canceled) return;
        if (!response?.success) {
          setError(response?.message || 'Could not load your certifications.');
          return;
        }
        setCertifications(response.certifications || []);
        // A failed file read must not empty the page: the certifications are what this screen is for, so the worst
        // case is a missing button rather than a missing list.
        const rows = fileResponse?.success ? fileResponse.files || [] : [];
        setFiles(Object.fromEntries(rows.map((file) => [String(file.certification_id || ''), file])));
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

  // Opening a scan asks the bucket for a short-lived URL (see services/certificationFileStorage): the rules hand one
  // over only if this member may read the file at all, so a refusal here is the server saying no rather than a broken
  // link - which is worth saying differently on screen.
  const openFile = async (recordId) => {
    const file = files[recordId];
    if (!file) return;
    setOpeningId(recordId);
    setOpenError(null);
    try {
      await openCertificationFile(file.storage_path);
    } catch (err) {
      setOpenError(err?.message || 'That scan could not be opened.');
    } finally {
      setOpeningId('');
    }
  };

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

        {openError && (
          <p className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-800 dark:border-amber-800/80 dark:bg-amber-950/40 dark:text-amber-200">
            {openError}
          </p>
        )}

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

                {files[row.id] && (
                  <button
                    type="button"
                    onClick={() => openFile(row.id)}
                    disabled={openingId === row.id}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    {openingId === row.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <FileText className="h-3.5 w-3.5" />
                    )}
                    View upload
                  </button>
                )}

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
