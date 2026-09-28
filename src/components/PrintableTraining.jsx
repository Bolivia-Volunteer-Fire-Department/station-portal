import React, { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import '../print.css';
import { stationLogoUrl } from '../utils/assets';
import {
  PRINT_TRAINING_COLUMNS,
  printTrainingDetail,
  printTrainingFilterSummary,
  printTrainingHeader,
  printTrainingList,
  printTrainingTotals,
} from '../utils/printTraining';

/**
 * Printer-friendly training sheets.
 *
 * Two of them, from one component, because they share the header, the stylesheet and the print
 * lifecycle, and differ only in the body:
 *
 *   mode="list"      what the filters currently show: the report's columns, plus who signed each
 *                    training. `rows` is therefore the ALREADY FILTERED list the table is showing - the
 *                    caller passing the full sheet would print something the screen never showed.
 *   mode="training"  one training's own record, in full.
 *
 * Mounted only while a print is being prepared. It renders into <body> through a portal so the print
 * stylesheet can hide the app by hiding its siblings, and it calls window.print() itself once laid out -
 * the caller only mounts it, exactly as PrintableSchedule does, so the two printing screens stay ignorant
 * of how printing works.
 *
 * onDone is called once the browser has finished with the print dialog, whether the reader printed or
 * canceled, so the sheet never lingers in the DOM.
 */
export default function PrintableTraining({
  mode = 'list',
  departmentName = '',
  memberName = '',
  // mode="list": the filtered, sorted rows the report is showing, and the filters that produced them.
  rows = [],
  filters = {},
  sort = '',
  // mode="training": the one training being printed.
  training = null,
  signatures = [],
  users = [],
  onDone,
}) {
  const list = useMemo(
    () => (mode === 'training' ? [] : printTrainingList({ rows, signatures, users })),
    [mode, rows, signatures, users]
  );

  const detail = useMemo(
    () => (mode === 'training' ? printTrainingDetail({ training, signatures, users }) : null),
    [mode, training, signatures, users]
  );

  const filterParts = useMemo(
    () => (mode === 'training' ? [] : printTrainingFilterSummary(filters, { users, sort })),
    [mode, filters, users, sort]
  );

  const totals = useMemo(() => printTrainingTotals(mode === 'training' ? [] : rows), [mode, rows]);

  const signatureTotal = list.reduce((sum, row) => sum + row.signedCount, 0);

  const header = useMemo(
    () =>
      printTrainingHeader({
        mode,
        departmentName,
        memberName,
        subtitle:
          mode === 'training'
            ? [detail?.title, detail?.fields?.[0]?.value].filter(Boolean).join(' · ')
            : filterParts.length
              ? `Filtered list · ${list.length} training${list.length === 1 ? '' : 's'}`
              : `All trainings · ${list.length} training${list.length === 1 ? '' : 's'}`,
      }),
    [mode, departmentName, memberName, detail, filterParts, list.length]
  );

  useEffect(() => {
    // afterprint fires for both printing and canceling in every current browser. The timeout is a safety
    // net for a browser that never fires it, so a failed print cannot leave the app hidden.
    const finish = () => onDone?.();
    window.addEventListener('afterprint', finish);
    const timer = window.setTimeout(() => window.print(), 60);
    const safety = window.setTimeout(finish, 30000);
    return () => {
      window.removeEventListener('afterprint', finish);
      window.clearTimeout(timer);
      window.clearTimeout(safety);
    };
  }, [onDone]);

  return createPortal(
    <div className="print-sheet text-black">
      {/* The station's own patch, then what this sheet is. */}
      <div className="flex items-center gap-4 border-b-2 border-black pb-3">
        <img src={stationLogoUrl()} alt="" className="w-16 h-16 shrink-0" />
        <div className="flex-1">
          <div className="text-xl font-bold leading-tight">{header.departmentName}</div>
          <div className="text-base font-semibold">{header.title}</div>
          <div className="text-sm">{header.subtitle}</div>
        </div>
        <div className="text-right text-xs">
          <div>{header.generated}</div>
          {header.printedBy && <div>{header.printedBy}</div>}
        </div>
      </div>

      {/* Which filters produced this list. A filtered printout that does not say so is a record that
          misleads, so this sits under the title rather than in a footnote. */}
      {filterParts.length > 0 && (
        <div className="mt-3 text-xs">
          <span className="font-bold uppercase tracking-wide">Filters: </span>
          {filterParts.map((part, index) => (
            <span key={part.label}>
              {index > 0 && <span> · </span>}
              <span className="font-semibold">{part.label}: </span>
              {part.value}
            </span>
          ))}
        </div>
      )}

      {/* The list: the report's own columns, then who signed each training underneath it.
          A training and its signatures are one <tbody> carrying `print-training-row`, so a page break
          cannot come between a record and the names that belong to it. */}
      {mode === 'list' && (
        <>
          <table className="mt-3 w-full border-collapse text-left text-[11px]">
            <thead>
              <tr className="border-y border-black">
                {PRINT_TRAINING_COLUMNS.map((label) => (
                  <th key={label} className="px-1.5 py-1 text-[10px] font-bold uppercase tracking-wide">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            {list.map((row) => (
              <tbody key={row.id} className="print-training-row">
                <tr className="border-b border-black/20 align-top">
                  <td className="whitespace-nowrap px-1.5 py-1.5">{row.date}</td>
                  <td className="px-1.5 py-1.5">
                    <div className="font-semibold">{row.title}</div>
                    {[row.when, ...row.badges].filter(Boolean).length > 0 && (
                      <div className="text-[10px] text-black/70">
                        {[row.when, ...row.badges].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td className="px-1.5 py-1.5">{row.location || '—'}</td>
                  <td className="px-1.5 py-1.5">{row.instructors || '—'}</td>
                  <td className="px-1.5 py-1.5">{row.signedCount}</td>
                  <td className="px-1.5 py-1.5">{row.external ? 'Yes' : ''}</td>
                </tr>
                <tr className="border-b border-black/40">
                  <td colSpan={PRINT_TRAINING_COLUMNS.length} className="px-1.5 pb-2 text-[10px] text-black/80">
                    {row.signers.length > 0
                      ? `Signed by: ${row.signers.join(', ')}`
                      : 'Nobody has signed this training yet.'}
                  </td>
                </tr>
              </tbody>
            ))}
          </table>

          <div className="mt-3 flex items-center justify-between text-[10px]">
            <div>
              {totals.count} training{totals.count === 1 ? '' : 's'} · {totals.hoursLabel} · {signatureTotal}{' '}
              signature{signatureTotal === 1 ? '' : 's'}.
            </div>
            <div>{header.departmentName}</div>
          </div>
        </>
      )}

      {/* One training's own record: everything it has. The fields grid mirrors the form; the categories
          are spelled out in full; the narrative prints as written (whitespace-pre-line, so its own
          paragraph breaks survive). */}
      {detail && (
        <>
          <div className="mt-4 grid grid-cols-3 gap-x-6 gap-y-3 border-t border-black pt-3 text-sm">
            {detail.fields.map((field) => (
              <div key={field.label}>
                <div className="text-[10px] font-bold uppercase tracking-wide text-black/60">{field.label}</div>
                <div>{field.value || '—'}</div>
              </div>
            ))}
            <div className="col-span-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-black/60">
                {detail.categories.length === 1 ? 'Category' : 'Categories'}
              </div>
              <div>{detail.categories.length > 0 ? detail.categories.join(' · ') : 'None recorded'}</div>
            </div>
          </div>

          {detail.locked && (
            <p className="mt-3 border border-black/40 bg-slate-100 px-2 py-1 text-xs font-semibold">
              Entered into an external system — locked, and its signatures cannot be changed in the app.
            </p>
          )}

          {detail.narrative && (
            <div className="mt-4 border-t border-black pt-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-black/60">Narrative</div>
              <p className="mt-1 whitespace-pre-line text-sm">{detail.narrative}</p>
            </div>
          )}

          {/* The signatures, which is what a training record is usually kept for. Three columns of
              names to a page rather than one long line. */}
          <div className="mt-4 border-t border-black pt-3">
            <div className="text-[10px] font-bold uppercase tracking-wide text-black/60">
              Signed by {detail.signedCount}
            </div>
            {detail.signers.length > 0 ? (
              <ol className="mt-2 grid grid-cols-3 gap-x-6 gap-y-1 text-sm">
                {detail.signers.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ol>
            ) : (
              <p className="mt-1 text-sm">Nobody has signed this training yet.</p>
            )}
          </div>
        </>
      )}
    </div>,
    document.body
  );
}
