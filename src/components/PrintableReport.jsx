import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import '../print.css';
import { stationLogoUrl } from '../utils/assets';
import { reportGroupLabel, reportMeasureColumns } from '../utils/reportExport';
import { REPORT_MEASURE_LABELS, REPORT_GROUPINGS } from '../utils/reportParameters';
import ReportChart from './ReportChart';

// The chart is drawn at a fixed size: the sheet is display:none on screen, where a responsive container would be zero wide.
const PRINT_CHART_WIDTH = 680;

export default function PrintableReport({ result, departmentName = '', onDone }) {
  useEffect(() => {
    const finish = () => onDone?.();
    window.addEventListener('afterprint', finish);
    // A beat longer than the other sheets, so the chart has been laid out before the dialog opens.
    const printTimer = window.setTimeout(() => window.print(), 250);
    const safetyTimer = window.setTimeout(finish, 30000);
    return () => {
      window.removeEventListener('afterprint', finish);
      window.clearTimeout(printTimer);
      window.clearTimeout(safetyTimer);
    };
  }, [onDone]);

  const unit = result.report.unit || 'Shifts';
  // THE PRINTED SHEET NESTS THE SAME WAY THE SCREEN DOES, off the same `levels` the engine returns, so a two-level report
  // does not print as a flat list with "2026-01 · Ana" in one column.
  const groupingLevels = [].concat(result.report.group_by || []).filter(Boolean);
  const availableGroupings = REPORT_GROUPINGS[result.report.dataset] || [];
  const groupColumns = groupingLevels.length
    ? groupingLevels.map((level) => availableGroupings.find(([value]) => value === level)?.[1] || reportGroupLabel(level))
    : ['Group'];
  const measureColumns = reportMeasureColumns(result);
  const totalColumns = groupColumns.length + Math.max(measureColumns.length, 1);
  const hasChart = result.report.visualization !== 'table';

  return createPortal(
    <div className="print-sheet text-black">
      <header className="flex items-center gap-4 border-b-2 border-black pb-3">
        <img src={stationLogoUrl()} alt="" className="h-16 w-16 shrink-0" />
        <div className="flex-1">
          <div className="text-xl font-bold leading-tight">{departmentName}</div>
          <div className="text-base font-semibold">{result.report.name}</div>
          <div className="text-sm">{result.range.from} to {result.range.to}</div>
        </div>
        <div className="text-right text-xs">Generated {new Date().toLocaleString()}</div>
      </header>

      {result.parameters?.length > 0 && (
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-b border-black/30 pb-2 text-[11px]">
          {result.parameters.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[9px] font-bold uppercase tracking-wide">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {hasChart && (
        <div className="mt-4 flex justify-center break-inside-avoid">
          <ReportChart result={result} width={PRINT_CHART_WIDTH} />
        </div>
      )}

      <table className="mt-3 w-full border-collapse text-left text-[11px]">
        <thead>
          <tr className="border-y border-black">
            {groupColumns.map((label, index) => (
              <th key={`${label}-${index}`} className="px-1.5 py-1 text-left text-[10px] font-bold uppercase tracking-wide">{label}</th>
            ))}
            {measureColumns.length
              ? measureColumns.map((key) => (
                  <th key={key} className="px-1.5 py-1 text-right text-[10px] font-bold uppercase tracking-wide">{REPORT_MEASURE_LABELS[key] || key}</th>
                ))
              : <th className="px-1.5 py-1 text-right text-[10px] font-bold uppercase tracking-wide">{unit}</th>}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, rowIndex) => {
            const parts = row.levels && row.levels.length ? row.levels : [row.label];
            const above = rowIndex > 0 ? result.rows[rowIndex - 1] : null;
            const previous = above ? (above.levels && above.levels.length ? above.levels : [above.label]) : [];
            // A heading is drawn when the value at that level CHANGES, exactly as on the screen.
            const headings = parts
              .slice(0, -1)
              .map((value, depth) => (previous[depth] === value ? null : { value, depth }))
              .filter(Boolean);
            return (
              <React.Fragment key={row.key}>
                {headings.map((heading) => (
                  <tr key={`${row.key}-heading-${heading.depth}`} className="break-inside-avoid border-b border-black/10">
                    <td
                      colSpan={totalColumns}
                      className="px-1.5 py-1 font-bold"
                      style={{ paddingLeft: `${heading.depth * 0.9 + 0.375}rem` }}
                    >
                      {heading.value}
                    </td>
                  </tr>
                ))}
                <tr className="break-inside-avoid border-b border-black/20 align-top">
                  <td
                    colSpan={groupColumns.length}
                    className="px-1.5 py-1.5"
                    style={{ paddingLeft: `${(parts.length - 1) * 0.9 + 0.375}rem` }}
                  >
                    {parts[parts.length - 1]}
                  </td>
                  {measureColumns.length
                    ? measureColumns.map((key) => (
                        <td key={key} className="px-1.5 py-1.5 text-right tabular-nums">{row.values?.[key] ?? ''}</td>
                      ))
                    : <td className="px-1.5 py-1.5 text-right tabular-nums">{row.value}</td>}
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>,
    document.body
  );
}
