import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import '../print.css';
import { stationLogoUrl } from '../utils/assets';
import { certificationStateLabel } from '../utils/certifications';

export default function PrintableCertifications({ rows = [], departmentName = '', onDone }) {
  useEffect(() => {
    const finish = () => onDone?.();
    window.addEventListener('afterprint', finish);
    const printTimer = window.setTimeout(() => window.print(), 60);
    const safetyTimer = window.setTimeout(finish, 30000);
    return () => {
      window.removeEventListener('afterprint', finish);
      window.clearTimeout(printTimer);
      window.clearTimeout(safetyTimer);
    };
  }, [onDone]);

  return createPortal(
    <div className="print-sheet text-black">
      <header className="flex items-center gap-4 border-b-2 border-black pb-3">
        <img src={stationLogoUrl()} alt="" className="h-16 w-16 shrink-0" />
        <div className="flex-1">
          <div className="text-xl font-bold leading-tight">{departmentName}</div>
          <div className="text-base font-semibold">Certification records</div>
          <div className="text-sm">{rows.length} record{rows.length === 1 ? '' : 's'}</div>
        </div>
        <div className="text-right text-xs">Generated {new Date().toLocaleString()}</div>
      </header>

      <table className="mt-3 w-full border-collapse text-left text-[11px]">
        <thead>
          <tr className="border-y border-black">
            {['Member', 'Member status', 'Certification', 'Effective', 'Ends', 'Status', 'Notes'].map((column) => (
              <th key={column} className="px-1.5 py-1 text-[10px] font-bold uppercase tracking-wide">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="print-certification-row border-b border-black/20 align-top">
              <td className="px-1.5 py-1.5">{row.member_name}</td>
              <td className="px-1.5 py-1.5">{row.member_status === 'inactive' ? 'Inactive' : 'Active'}</td>
              <td className="px-1.5 py-1.5">{row.name || 'Unknown certification'}</td>
              <td className="px-1.5 py-1.5">{row.effective_date || '-'}</td>
              <td className="px-1.5 py-1.5">{row.end_date || (row.is_renewable ? '-' : 'No end date')}</td>
              <td className="px-1.5 py-1.5">{certificationStateLabel(row.state)}</td>
              <td className="px-1.5 py-1.5">{row.notes || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>,
    document.body
  );
}