import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import '../../print.css';
import { departmentLogoUrl, stationLogoUrl } from '../../utils/assets';
import Markdown from '../Markdown';
import { formatPhoneNumber, parseSignatureValue } from '../../utils/formDefinition';
import { BadgeCheck } from 'lucide-react';

/**
 * Printable form submission document with department letterhead.
 * Renders into <body> via createPortal so print.css displays only this sheet on paper.
 * Automatically invokes window.print() once mounted, and cleans up on afterprint.
 */
export default function PrintableFormSubmission({
  submission,
  form,
  departmentName = '',
  logoUrl = '',
  onDone,
}) {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const finish = () => onDone?.();
    window.addEventListener('afterprint', finish);
    const printTimer = window.setTimeout(() => window.print(), 100);
    const safetyTimer = window.setTimeout(finish, 30000);
    return () => {
      window.removeEventListener('afterprint', finish);
      window.clearTimeout(printTimer);
      window.clearTimeout(safetyTimer);
    };
  }, [onDone]);

  if (!submission || typeof document === 'undefined') return null;

  const resolvedLogo = logoUrl ? departmentLogoUrl(logoUrl) : stationLogoUrl();
  const formTitle = form?.name || submission.form_template_name || 'Department Form Submission';
  const formDesc = form?.description || '';
  const answers = submission.data || {};

  const submittedDateLabel = submission.submitted_at
    ? new Date(submission.submitted_at).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : submission.date_key || '—';

  const updatedDateLabel = submission.updated_at
    ? new Date(submission.updated_at).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  const printedDate = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  // Collect layout items or build dynamic items from answers if layout is unavailable
  const layoutItems = Array.isArray(form?.layout) && form.layout.length > 0
    ? form.layout
    : Object.keys(answers).map((key) => ({
        id: key,
        data_name: key,
        caption: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        field_type: typeof answers[key] === 'boolean' ? 'checkbox' : 'text',
        col_span: 3,
      }));

  const knownNames = new Set(layoutItems.map((item) => item.data_name).filter(Boolean));
  const unmappedAnswers = Object.entries(answers).filter(([k]) => !knownNames.has(k));

  const spanClass = (span) => {
    switch (span) {
      case 1:
        return 'col-span-1';
      case 2:
        return 'col-span-2';
      case 3:
      default:
        return 'col-span-3';
    }
  };

  return createPortal(
    <div className="print-sheet text-black text-xs font-sans leading-relaxed select-text">
      {/* Letterhead Header */}
      <header className="flex items-center justify-between border-b-2 border-black pb-3 mb-4">
        <div className="flex items-center gap-4">
          <img src={resolvedLogo} alt="" className="h-16 w-16 shrink-0 object-contain" />
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-slate-700">
              {departmentName || 'Fire Department'}
            </div>
            <h1 className="text-xl font-extrabold uppercase tracking-tight text-black leading-tight">
              {formTitle}
            </h1>
            <div className="text-xs font-semibold text-slate-600 mt-0.5">
              Official Department Form Record
            </div>
          </div>
        </div>

        <div className="text-right text-xs shrink-0">
          <div className="font-mono font-bold text-xs">ID: {submission.id || 'NEW'}</div>
          <div className="text-slate-600">Submitted: {submittedDateLabel}</div>
          {updatedDateLabel && (
            <div className="text-slate-500 text-[11px]">Updated: {updatedDateLabel}</div>
          )}
          <div className="text-slate-500 text-[11px] mt-0.5">Printed: {printedDate}</div>
        </div>
      </header>

      {/* Metadata strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 border border-black/30 bg-slate-50 px-3.5 py-2 mb-4 text-[11px]">
        <div className="flex items-center gap-5">
          <div>
            <span className="font-bold uppercase text-[9px] text-slate-500 mr-1.5">Submitted By:</span>
            <span className="font-bold text-black">{submission.submitted_by_name || 'Member'}</span>
          </div>
          <div>
            <span className="font-bold uppercase text-[9px] text-slate-500 mr-1.5">Date Completed:</span>
            <span className="font-semibold text-black">{submittedDateLabel}</span>
          </div>
        </div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-700 border border-slate-300 bg-white px-2 py-0.5 rounded">
          {submission?.locked
            ? `Locked by ${submission.locked_by_name || 'Admin'}${submission.locked_readable_time ? ` on ${submission.locked_readable_time}` : ''}`
            : form?.allow_editing_after_submission
            ? 'Editable Submission'
            : 'Locked Submission'}
        </div>
      </div>

      {formDesc && (
        <p className="text-xs text-slate-600 italic mb-4">
          {formDesc}
        </p>
      )}

      {/* Form Fields & Responses */}
      <div className="grid grid-cols-3 gap-3.5 mb-6">
        {layoutItems.map((item, idx) => {
          if (item.field_type === 'markdown') {
            return (
              <div
                key={item.id || idx}
                className={`${spanClass(item.col_span || 3)} print-form-item my-1 p-2 border border-slate-200 bg-slate-50/50 rounded`}
              >
                <Markdown markdown={item.markdown_content || ''} />
              </div>
            );
          }

          if (item.field_type === 'divider') {
            return (
              <div
                key={item.id || idx}
                className={`${spanClass(item.col_span || 3)} print-form-item pt-3 pb-1 border-b-2 border-black/80`}
              >
                {item.caption ? (
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-black">
                    {item.caption}
                  </h4>
                ) : null}
              </div>
            );
          }

          const fieldId = item.data_name || `field_${idx}`;
          const val = answers[fieldId];

          if (item.field_type === 'signature') {
            const sig = parseSignatureValue(val);
            return (
              <div
                key={item.id || idx}
                className={`${spanClass(item.col_span || 3)} print-form-item border border-slate-300 rounded p-2.5 bg-white`}
              >
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  {item.caption}
                </div>
                {item.instructions && (
                  <p className="text-[10px] text-slate-500 italic mb-1.5">{item.instructions}</p>
                )}
                <div className="mt-1">
                  {sig.image ? (
                    <div className="space-y-1">
                      <img
                        src={sig.image}
                        alt={item.caption || 'Signature'}
                        className="max-h-20 max-w-full object-contain"
                        style={{ filter: 'none' }}
                      />
                      {sig.readable_time && (
                        <div className="text-[10px] text-slate-600 border-t border-slate-200 pt-1">
                          Signed on: <strong className="text-black">{sig.readable_time}</strong>
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-[11px] italic text-slate-400">No signature recorded</span>
                  )}
                </div>
              </div>
            );
          }

          if (item.field_type === 'signature_stamp') {
            const stamp =
              typeof val === 'object' && val !== null
                ? val
                : val
                ? { stamped: true, name: String(val) }
                : null;
            return (
              <div
                key={item.id || idx}
                className={`${spanClass(item.col_span || 3)} print-form-item border border-slate-400 rounded p-2.5 bg-slate-50/60`}
              >
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  {item.caption}
                </div>
                {item.instructions && (
                  <p className="text-[10px] text-slate-500 italic mb-1.5">{item.instructions}</p>
                )}
                {stamp?.stamped ? (
                  <div className="flex items-center gap-2.5 py-1">
                    <BadgeCheck className="h-5 w-5 text-black shrink-0" />
                    <div>
                      <div className="font-bold text-[11px] uppercase tracking-wide text-black">
                        Digitally Stamped & Verified
                      </div>
                      <div className="text-xs font-semibold text-black">
                        {stamp.name || submission.submitted_by_name || 'Member'}
                      </div>
                      <div className="text-[10px] text-slate-600">
                        {stamp.readable_time || (stamp.timestamp ? new Date(stamp.timestamp).toLocaleString() : '')}
                      </div>
                    </div>
                  </div>
                ) : (
                  <span className="text-[11px] italic text-slate-400">No digital stamp recorded</span>
                )}
              </div>
            );
          }

          if (item.field_type === 'checkbox') {
            return (
              <div
                key={item.id || idx}
                className={`${spanClass(item.col_span || 1)} print-form-item border border-slate-300 rounded p-2.5 bg-white`}
              >
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                  {item.caption}
                </div>
                {item.instructions && (
                  <p className="text-[10px] text-slate-500 italic mt-0.5">{item.instructions}</p>
                )}
                <div className="mt-1.5 text-xs font-semibold text-black">
                  {val === true ? '[✓] Yes' : '[ ] No'}
                </div>
              </div>
            );
          }

          if (item.field_type === 'tel') {
            return (
              <div
                key={item.id || idx}
                className={`${spanClass(item.col_span || 1)} print-form-item border border-slate-300 rounded p-2.5 bg-white`}
              >
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                  {item.caption}
                </div>
                {item.instructions && (
                  <p className="text-[10px] text-slate-500 italic mt-0.5">{item.instructions}</p>
                )}
                <div className="mt-1 text-xs font-semibold text-black">
                  {val ? formatPhoneNumber(String(val)) : '—'}
                </div>
              </div>
            );
          }

          return (
            <div
              key={item.id || idx}
              className={`${spanClass(item.col_span || 1)} print-form-item border border-slate-300 rounded p-2.5 bg-white`}
            >
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                {item.caption}
              </div>
              {item.instructions && (
                <p className="text-[10px] text-slate-500 italic mt-0.5">{item.instructions}</p>
              )}
              <div className="mt-1 text-xs font-semibold text-black whitespace-pre-wrap">
                {val !== undefined && val !== null && String(val).trim() !== '' ? String(val) : '—'}
              </div>
            </div>
          );
        })}

        {/* Any extra fields captured in data not declared in template layout */}
        {unmappedAnswers.length > 0 && (
          <div className="col-span-3 print-form-item pt-2 border-t border-slate-300">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-700 mb-2">
              Additional Recorded Responses
            </h4>
            <div className="grid grid-cols-2 gap-2.5">
              {unmappedAnswers.map(([key, value]) => (
                <div key={key} className="border border-slate-200 rounded p-2 bg-slate-50/50">
                  <div className="text-[9px] font-bold uppercase text-slate-500">
                    {key.replace(/_/g, ' ')}
                  </div>
                  <div className="text-xs font-semibold text-black mt-0.5">
                    {typeof value === 'object' ? JSON.stringify(value) : String(value || '—')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-black/40 pt-2 text-[10px] text-slate-600 flex justify-between items-center print-form-item">
        <span>Department Record &bull; Confidential and Proprietary</span>
        <span>Page 1 of 1</span>
      </footer>
    </div>,
    document.body
  );
}

