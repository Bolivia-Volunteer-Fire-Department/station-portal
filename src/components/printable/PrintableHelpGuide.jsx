import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import '../../print.css';
import { stationSyncLoopsUrl } from '../../utils/assets';
import Markdown from '../Markdown';

/**
 * StationSync-branded printer sheet for Member and Administration Help Guides.
 *
 * Renders into <body> through createPortal so print.css hides the interactive app shell
 * and prints only the formatted guide. Automatically triggers window.print() on mount
 * and invokes onDone when printing completes.
 */
export default function PrintableHelpGuide({
  guide,
  scope = 'member',
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

  if (!guide || typeof document === 'undefined') return null;

  const isAdminScope = scope === 'admin';
  const categoryLabel = isAdminScope ? 'Administration Guide' : 'Member Help Guide';
  const numberPrefix = /^(\d{2})-/.exec(guide.slug || '')?.[1] || '';

  const printedDate = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return createPortal(
    <div className="print-sheet print-help-guide text-black text-xs font-sans leading-relaxed select-text">
      {/* Table wrapper with repeating tfoot spacer so multi-page body text never collides with the fixed page footer */}
      <table className="w-full border-collapse">
        <tbody>
          <tr>
            <td className="p-0 align-top">
              {/* StationSync Branded Header Banner */}
              <header className="mb-6 overflow-hidden rounded-xl border border-slate-300">
                <div className="bg-slate-900 px-5 py-4 text-white flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="flex items-center gap-2.5 shrink-0">
                      <img
                        src={stationSyncLoopsUrl()}
                        alt="StationSync"
                        className="h-9 w-9 shrink-0 object-contain"
                      />
                      <span className="text-xl font-extrabold tracking-tight leading-none text-white flex items-center">
                        Station<span className="text-red-500">Sync</span>
                      </span>
                    </div>
                    <div className="h-6 w-px bg-slate-700 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold uppercase tracking-widest text-slate-300 truncate">
                        {categoryLabel}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    {numberPrefix && (
                      <div className="inline-block rounded bg-slate-800 border border-slate-700 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-200 mb-0.5">
                        Section {numberPrefix}
                      </div>
                    )}
                    <div className="text-[10px] text-slate-400">Printed {printedDate}</div>
                  </div>
                </div>

                {/* Brand gradient bar */}
                <div className="h-1 bg-gradient-to-r from-red-600 via-amber-500 to-sky-500" />

                {/* Guide Title Bar */}
                <div className="bg-slate-50 px-5 py-3.5 border-t border-slate-200 flex items-baseline justify-between gap-4">
                  <h1 className="text-xl font-extrabold tracking-tight text-slate-900 leading-snug">
                    {guide.title}
                  </h1>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 shrink-0">
                    Reference Manual
                  </span>
                </div>
              </header>

              {/* Guide Markdown Content */}
              <div className="print-help-guide-body px-1">
                <Markdown markdown={guide.markdown || ''} />
              </div>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td className="p-0">
              <div className="print-page-footer-spacer" aria-hidden="true" />
            </td>
          </tr>
        </tfoot>
      </table>

      {/* Fixed StationSync Branded Footer pinned to the bottom of every printed page */}
      <footer className="print-page-footer pt-2.5 border-t border-slate-300 flex items-center justify-between text-[10px] text-slate-500">
        <div className="flex items-center gap-2">
          <img
            src={stationSyncLoopsUrl()}
            alt=""
            className="h-4 w-auto object-contain"
          />
          <span className="font-semibold text-slate-700">StationSync</span>
          <span>&middot;</span>
          <span>{categoryLabel}</span>
        </div>
        <div>
          <span>{guide.title}</span>
        </div>
      </footer>
    </div>,
    document.body
  );
}
