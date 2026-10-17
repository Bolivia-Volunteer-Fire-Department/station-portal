import React, { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import '../print.css';
import { stationLogoUrl } from '../utils/assets';
import Markdown from './Markdown';
import {
  documentUpdatedLabel,
  isAssessment,
  isChecklist,
} from '../utils/documents';
import { checklistSections } from '../utils/checklists';

/**
 * Printer-friendly document sheet with department letterhead.
 *
 * Renders into <body> through createPortal so print.css can hide the rest of the application
 * and display only this sheet on paper. Automatically triggers window.print() once mounted,
 * and calls onDone when the print dialog closes.
 */
export default function PrintableDocument({
  document: doc,
  departmentName = '',
  logoUrl = '',
  timeFormat = '12',
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

  const sections = useMemo(() => {
    if (!doc || !isChecklist(doc) || !Array.isArray(doc.items)) return [];
    return checklistSections(doc.items);
  }, [doc]);

  if (!doc || typeof document === 'undefined') return null;

  const resolvedLogo = logoUrl || stationLogoUrl();

  const typeLabel = isChecklist(doc)
    ? 'Checklist'
    : isAssessment(doc)
    ? 'Assessment'
    : 'Policy & Document';

  const printedDate = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

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
              {doc.title}
            </h1>
            <div className="text-xs font-semibold text-slate-600 mt-0.5">
              {doc.folder || 'Unfiled'} &middot; {typeLabel}
            </div>
          </div>
        </div>

        <div className="text-right text-xs shrink-0">
          {doc.content_revision > 0 && (
            <div className="font-mono font-bold text-xs">Rev: {doc.content_revision}</div>
          )}
          {documentUpdatedLabel(doc, timeFormat) ? (
            <div className="text-slate-600">{documentUpdatedLabel(doc, timeFormat)}</div>
          ) : null}
          <div className="text-slate-500 text-[11px] mt-0.5">Printed: {printedDate}</div>
        </div>
      </header>

      {/* Metadata strip */}
      {(doc.effective_date || doc.end_date || doc.is_sign_required) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-black/25 bg-slate-50 px-3 py-2 mb-4 text-[11px]">
          <div className="flex items-center gap-4">
            {doc.effective_date && (
              <div>
                <span className="font-bold uppercase text-[9px] text-slate-500 mr-1.5">Effective:</span>
                <span className="font-semibold text-black">{doc.effective_date}</span>
              </div>
            )}
            {doc.end_date && (
              <div>
                <span className="font-bold uppercase text-[9px] text-slate-500 mr-1.5">Expires:</span>
                <span className="font-semibold text-black">{doc.end_date}</span>
              </div>
            )}
            <div>
              <span className="font-bold uppercase text-[9px] text-slate-500 mr-1.5">Classification:</span>
              <span className="font-semibold text-black">{typeLabel}</span>
            </div>
          </div>
          {doc.is_sign_required && (
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-900 border border-amber-300 bg-amber-50 px-2 py-0.5 rounded">
              Acknowledgement Required
            </div>
          )}
        </div>
      )}

      {/* Document Content */}
      {doc.content ? (
        <div className="select-text prose-sm text-black mb-6">
          <Markdown markdown={doc.content} />
        </div>
      ) : null}

      {/* Checklist items if document is a checklist */}
      {isChecklist(doc) && sections.length > 0 && (
        <div className="mt-4 space-y-4">
          {sections.map((group) => (
            <div key={group.section} className="break-inside-avoid">
              <div className="font-bold text-xs uppercase tracking-wider text-slate-800 border-b border-black/40 pb-1 mb-2">
                {group.section}
              </div>
              <table className="w-full border-collapse text-xs">
                <tbody>
                  {group.items.map((item, idx) => (
                    <tr key={item.id || idx} className="border-b border-black/10 py-1.5 break-inside-avoid">
                      <td className="w-6 py-1.5 align-top">
                        <div className="w-3.5 h-3.5 border border-black rounded-sm mt-0.5" />
                      </td>
                      <td className="py-1.5 pr-2 align-top font-medium text-black">
                        {item.label}
                        {item.notes && <div className="text-[10px] text-slate-600 mt-0.5">{item.notes}</div>}
                      </td>
                      <td className="w-40 py-1.5 align-top text-right text-[10px] text-slate-500 font-mono">
                        Initials: [ &nbsp; &nbsp; &nbsp; &nbsp; ] &nbsp; Date: [ &nbsp; &nbsp; &nbsp; &nbsp; ]
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* Sign-off / Acknowledgement block if required */}
      {doc.is_sign_required && (
        <div className="mt-8 pt-4 border-t-2 border-black break-inside-avoid">
          <div className="text-xs font-bold uppercase tracking-wider text-black mb-1">
            Member Acknowledgement & Sign-Off
          </div>
          <p className="text-[11px] text-slate-600 mb-6">
            By signing below, I certify that I have read, understand, and agree to comply with all policies and guidelines outlined in this document.
          </p>
          <div className="grid grid-cols-2 gap-8 pt-2">
            <div className="border-t border-black pt-1">
              <span className="text-[10px] uppercase font-bold text-slate-600">Member Printed Name & Signature</span>
            </div>
            <div className="border-t border-black pt-1">
              <span className="text-[10px] uppercase font-bold text-slate-600">Date</span>
            </div>
          </div>
          {doc.requires_verification && (
            <div className="grid grid-cols-2 gap-8 pt-8 mt-2">
              <div className="border-t border-black pt-1">
                <span className="text-[10px] uppercase font-bold text-slate-600">Officer / Verifier Signature</span>
              </div>
              <div className="border-t border-black pt-1">
                <span className="text-[10px] uppercase font-bold text-slate-600">Date</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Page Footer */}
      <footer className="mt-8 pt-3 border-t border-black/20 flex items-center justify-between text-[10px] text-slate-500">
        <span>{departmentName || 'Fire Department'} &middot; {doc.title}</span>
        <span>StationSync Document Record</span>
      </footer>
    </div>,
    document.body
  );
}

