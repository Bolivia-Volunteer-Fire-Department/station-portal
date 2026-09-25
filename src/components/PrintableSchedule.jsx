import React, { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import '../print.css';
import { stationLogoUrl } from '../utils/assets';
import {
  PRINT_WEEKDAYS,
  printHeader,
  printMonth,
  printShiftCount,
} from '../utils/printSchedule';

/**
 * A printer-friendly calendar of a month's shifts.
 *
 * Mounted only while a print is being prepared. It renders into <body> through a portal so the print
 * stylesheet can hide the app by hiding its siblings, and it calls window.print() itself once laid out -
 * the caller only has to mount it, which keeps the two screens that offer printing from each having to
 * know how printing works.
 *
 * onDone is called once the browser has finished with the print dialog, whether the member printed or
 * cancelled, so the sheet never lingers in the DOM.
 */
export default function PrintableSchedule({
  mode = 'member',
  departmentName = '',
  // The month being printed. Both are required: the sheet has no sensible default month, and a missing
  // one is a ReferenceError at render rather than at build, so the verifier asserts this contract.
  year,
  month,
  member = null,
  schedule = [],
  scheduleTemplates = [],
  assignments = [],
  users = [],
  ranks = [],
  // Non-shift entries, printed alongside the shifts so the sheet matches the screen.
  events = [],
  memberName = '',
  onDone,
}) {
  const weeks = useMemo(
    () =>
      printMonth({
        year,
        month,
        mode,
        member,
        schedule,
        scheduleTemplates,
        assignments,
        users,
        ranks,
        events,
      }),
    [year, month, mode, member, schedule, scheduleTemplates, assignments, users, ranks, events]
  );

  const header = useMemo(
    () => printHeader({ mode, departmentName, memberName, year, month }),
    [mode, departmentName, memberName, year, month]
  );

  const shiftCount = printShiftCount(weeks);
  const isEmpty = shiftCount === 0;

  useEffect(() => {
    // afterprint fires for both printing and cancelling in every current browser. The timeout is a
    // safety net for a browser that never fires it, so a failed print cannot leave the app hidden.
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
      {/* Header: the station's own patch, then who and what this is. */}
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

      {isEmpty ? (
        <p className="mt-6 text-sm">
          No shifts are scheduled in {header.monthLabel}.
        </p>
      ) : (
        <>
          {/* Weekday headings, Monday first to match the schedule grid. */}
          <div className="mt-4 grid grid-cols-7 border border-black">
            {PRINT_WEEKDAYS.map((label) => (
              <div
                key={label}
                className="border-b border-black bg-slate-200 px-1.5 py-1 text-center text-[11px] font-bold uppercase tracking-wide"
              >
                {label}
              </div>
            ))}
          </div>

          {weeks.map((week, weekIndex) => (
            <div key={`week-${weekIndex}`} className="print-week grid grid-cols-7 border-x border-b border-black">
              {week.map((cell) => (
                <div
                  key={cell.key}
                  className={`min-h-[6rem] border-r border-black/40 p-1.5 last:border-r-0 ${
                    cell.outside ? 'bg-slate-50' : ''
                  }`}
                >
                  {!cell.outside && (
                    <>
                      <div className="text-[11px] font-bold">{cell.dayOfMonth}</div>
                      <div className="mt-0.5 space-y-0.5">
                        {cell.lines.map((line, lineIndex) => (
                          <div key={`${line.key}-${lineIndex}`} className="flex items-start gap-1 text-[9px] leading-tight">
                            <span
                              className="mt-[3px] h-2 w-2 shrink-0 rounded-[2px] border border-black/30"
                              style={{ backgroundColor: line.color }}
                            />
                            <span>{line.text}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          ))}

          <div className="mt-3 flex items-center justify-between text-[10px]">
            <div>
              {shiftCount} shift{shiftCount === 1 ? '' : 's'} in {header.monthLabel}.
              {mode === 'admin' ? ' Lines marked Open are not yet filled.' : ''}
            </div>
            <div>{header.departmentName}</div>
          </div>
        </>
      )}
    </div>,
    document.body
  );
}
