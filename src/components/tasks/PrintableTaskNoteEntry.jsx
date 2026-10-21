import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import '../../print.css';
import { departmentLogoUrl, stationLogoUrl } from '../../utils/assets';
import Markdown from '../Markdown';
import { formatPhoneNumber, parseSignatureValue } from '../../utils/formDefinition';
import { formatFileSize } from '../../services/formFileStorage';
import { KIND_META, STATUS_META } from '../../utils/tasksAndNotes';
import { BadgeCheck, CheckSquare, Square, Paperclip, Stamp } from 'lucide-react';

/**
 * Printable task or note document with official department letterhead.
 * Renders into <body> via createPortal so print.css displays only this sheet on paper.
 * Automatically invokes window.print() once mounted, and cleans up on afterprint.
 */
export default function PrintableTaskNoteEntry({
  entry,
  template,
  title,
  entryDate,
  entryTime,
  apparatusName = '',
  answers = {},
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

  if (typeof document === 'undefined') return null;

  const resolvedLogo = logoUrl ? departmentLogoUrl(logoUrl) : stationLogoUrl();
  const entryTitle = title || entry?.title || template?.name || 'Task / Note Record';
  const entryKind = entry?.kind || template?.kind || 'task';
  const kindMeta = KIND_META[entryKind] || KIND_META.task;
  const isSigned = entry?.status === 'signed';
  const statusMeta = STATUS_META[isSigned ? 'signed' : 'editable'];

  const formattedDate = entryDate
    ? new Date(`${entryDate}T00:00:00`).toLocaleDateString(undefined, {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : entry?.entry_date || '—';

  const printedDate = new Date().toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  const signedDateLabel = entry?.signed_at
    ? new Date(entry.signed_at).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  // Layout items from template or entry
  const layoutItems = Array.isArray(template?.layout) && template.layout.length > 0
    ? template.layout
    : Object.keys(answers).map((key) => ({
        id: key,
        data_name: key,
        caption: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        field_type: typeof answers[key] === 'boolean' ? 'checkbox' : 'text',
        col_span: 3,
      }));

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
              {entryTitle}
            </h1>
            <div className="text-xs font-semibold text-slate-600 mt-0.5">
              Official Department {kindMeta.label} Record
            </div>
          </div>
        </div>

        <div className="text-right text-xs shrink-0">
          <div className="font-mono font-bold text-xs">ID: {entry?.id ? entry.id.slice(0, 12) : 'NEW'}</div>
          <div className="text-slate-700 font-medium">Record Date: {formattedDate} {entryTime || ''}</div>
          <div className="text-slate-500 text-[11px] mt-0.5">Printed: {printedDate}</div>
        </div>
      </header>

      {/* Metadata Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 border border-black/30 bg-slate-50 px-3.5 py-2 mb-4 text-[11px]">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <div>
            <span className="font-bold uppercase text-[9px] text-slate-500 mr-1.5">Submitted By:</span>
            <span className="font-bold text-black">
              {entry?.submitted_by_name || 'Member'}
              {entry?.submitted_by_rank ? ` (${entry.submitted_by_rank})` : ''}
            </span>
          </div>

          <div>
            <span className="font-bold uppercase text-[9px] text-slate-500 mr-1.5">Type:</span>
            <span className="font-semibold text-black">{kindMeta.label}</span>
          </div>

          {apparatusName && (
            <div>
              <span className="font-bold uppercase text-[9px] text-slate-500 mr-1.5">Apparatus:</span>
              <span className="font-bold text-black">{apparatusName}</span>
            </div>
          )}
        </div>

        <div className="text-[10px] font-bold uppercase tracking-wider text-black border border-black/40 bg-white px-2.5 py-0.5 rounded">
          {isSigned ? 'Signed & Locked' : 'Draft / Editable'}
        </div>
      </div>

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

          if (item.field_type === 'checkbox') {
            const isChecked = Boolean(val);
            return (
              <div
                key={item.id || idx}
                className={`${spanClass(item.col_span || 3)} print-form-item border border-slate-300 rounded p-2.5 bg-white flex items-start gap-2.5`}
              >
                <span className="mt-0.5 shrink-0 text-black">
                  {isChecked ? (
                    <CheckSquare className="w-4 h-4 text-black" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-400" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-black">
                    {item.caption || item.placeholder || fieldId}
                  </div>
                  {item.instructions && (
                    <p className="text-[10px] text-slate-500 italic mt-0.5">{item.instructions}</p>
                  )}
                </div>
              </div>
            );
          }

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
                className={`${spanClass(item.col_span || 3)} print-form-item border border-slate-300 rounded p-2.5 bg-white`}
              >
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  {item.caption}
                </div>
                {item.instructions && (
                  <p className="text-[10px] text-slate-500 italic mb-1.5">{item.instructions}</p>
                )}
                {stamp?.stamped ? (
                  <div className="flex items-center gap-2.5 py-1">
                    <Stamp className="h-5 w-5 text-black shrink-0" />
                    <div>
                      <div className="font-bold text-[11px] uppercase tracking-wide text-black">
                        Digitally Stamped &amp; Verified
                      </div>
                      <div className="text-xs font-semibold text-black">
                        {stamp.name || entry?.submitted_by_name || 'Member'}
                        {stamp.rank ? ` (${stamp.rank})` : ''}
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

          if (item.field_type === 'file') {
            const files = Array.isArray(val) ? val : val ? [val] : [];
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
                {files.length === 0 ? (
                  <span className="text-[11px] italic text-slate-400">No files attached</span>
                ) : (
                  <ul className="space-y-1 mt-1">
                    {files.map((file, fileIdx) => (
                      <li
                        key={fileIdx}
                        className="flex items-center gap-1.5 text-[11px] text-black font-mono border-b border-slate-100 pb-1"
                      >
                        <Paperclip className="h-3 w-3 text-slate-500 shrink-0" />
                        <span className="font-semibold">{file.name || 'Attachment'}</span>
                        {file.size && (
                          <span className="text-slate-500 text-[10px]">
                            ({formatFileSize(file.size)})
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          }

          if (item.field_type === 'multiselect') {
            const selectedList = Array.isArray(val) ? val : val ? [val] : [];
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
                <div className="flex flex-wrap gap-1 mt-1">
                  {selectedList.length === 0 ? (
                    <span className="text-[11px] italic text-slate-400">None selected</span>
                  ) : (
                    selectedList.map((entryVal, sIdx) => (
                      <span
                        key={sIdx}
                        className="border border-black/40 rounded px-1.5 py-0.5 text-[10px] font-bold bg-slate-50 text-black"
                      >
                        {String(entryVal)}
                      </span>
                    ))
                  )}
                </div>
              </div>
            );
          }

          // Standard text, textarea, number, phone, email, date, time, select, radio
          const displayVal = (() => {
            if (val === undefined || val === null || val === '') {
              return <span className="text-slate-400 italic">No response provided</span>;
            }
            if (item.field_type === 'phone') {
              return formatPhoneNumber(String(val));
            }
            return String(val);
          })();

          return (
            <div
              key={item.id || idx}
              className={`${spanClass(item.col_span || 3)} print-form-item border border-slate-300 rounded p-2.5 bg-white`}
            >
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-0.5">
                {item.caption}
              </div>
              {item.instructions && (
                <p className="text-[10px] text-slate-500 italic mb-1">{item.instructions}</p>
              )}
              <div className="text-xs font-semibold text-black whitespace-pre-wrap mt-0.5">
                {displayVal}
              </div>
            </div>
          );
        })}
      </div>

      {/* Official Electronic Verification Stamp */}
      {isSigned && (
        <div className="print-form-item border-2 border-black rounded p-3.5 bg-slate-50/70 mt-6">
          <div className="flex items-center justify-between border-b border-black/30 pb-2 mb-3">
            <div className="flex items-center gap-2">
              <BadgeCheck className="w-5 h-5 text-black" />
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-black">
                  Official Electronic Stamp &amp; Certification
                </h3>
                <div className="text-[10px] text-slate-600">
                  {departmentName || 'StationSync Fire Operations'} &bull; Finalized Record
                </div>
              </div>
            </div>
            <div className="text-right">
              <span className="inline-block border border-black px-2 py-0.5 text-[9px] font-black uppercase tracking-widest bg-white text-black">
                ELECTRONICALLY STAMPED
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 items-center text-xs">
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-500">Certified By:</div>
              <div className="text-sm font-black text-black mt-0.5">
                {entry?.signed_by_name || entry?.submitted_by_name || 'Member'}
              </div>
              {entry?.signed_by_rank && (
                <div className="text-xs font-semibold text-slate-700">{entry.signed_by_rank}</div>
              )}
              {signedDateLabel && (
                <div className="text-[11px] text-slate-700 mt-1">
                  Stamped: <span className="font-semibold text-black">{signedDateLabel}</span>
                </div>
              )}
            </div>

            <div className="flex flex-col justify-end items-end">
              {/* Official Electronic Stamp Box */}
              <div className="border-2 border-dashed border-black/80 rounded px-3 py-2 text-center bg-white min-w-52 shadow-2xs">
                <div className="flex items-center justify-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-black mb-0.5">
                  <Stamp className="h-3.5 w-3.5 text-black" />
                  <span>Electronic Stamp</span>
                </div>
                <div className="text-xs font-black text-black font-mono tracking-tight uppercase">
                  {entry?.signed_by_name || 'MEMBER'}
                </div>
                {entry?.signed_by_rank && (
                  <div className="text-[10px] font-semibold text-slate-700 font-mono">
                    {entry.signed_by_rank}
                  </div>
                )}
                <div className="text-[9px] text-slate-600 font-mono mt-0.5">
                  {signedDateLabel || formattedDate}
                </div>
                <div className="text-[8px] text-slate-500 uppercase tracking-tighter mt-1 border-t border-slate-200 pt-0.5">
                  StationSync System Authenticated
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-8 pt-3 border-t border-black/20 text-[10px] text-slate-500 flex justify-between items-center">
        <div>Fire Clock Operations &bull; {kindMeta.label} Management</div>
        <div>Page 1 of 1</div>
      </footer>
    </div>,
    document.body
  );
}

