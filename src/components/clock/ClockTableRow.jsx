import React from 'react';
import { MapPin, Clock } from 'lucide-react';
import { formatStationTime } from '../../utils/timeFormat';
import { computeShiftBreakdown, formatShiftBreakdown } from '../../utils/shiftHours';
import { unnamedLabel } from '../../utils/displayLabel';

export default function ClockTableRow({ log, showUserColumn = false, timeFormat = '12', shifts = [] }) {
  const formattedHours = log.calc_hours 
    ? typeof log.calc_hours === 'number' 
      ? log.calc_hours.toFixed(2) 
      : log.calc_hours
    : '--';

  const breakdown = computeShiftBreakdown(log, shifts);
  const shiftTimeDisplay =
    log.time_in && shifts.length > 0
      ? breakdown.length > 0
        ? formatShiftBreakdown(breakdown)
        : '0 hrs'
      : '--';

  const formatTimestamp = (isoString) => {
    if (!isoString) return '--';
    const date = new Date(isoString);
    const datePart = date.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
    const timePart = formatStationTime(date, timeFormat, false); // No seconds in table view
    return `${datePart} ${timePart}`;
  };

  const renderLocation = (address, lat, lon) => {
    if (address) {
      return (
        <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
          <MapPin className="w-3.5 h-3.5 text-red-500 shrink-0" />
          <span className="truncate max-w-[180px]">{address}</span>
        </div>
      );
    }
    if (lat && lon) {
      return (
        <span className="text-xs text-slate-500 font-mono">
          {lat}, {lon}
        </span>
      );
    }
    return <span className="text-xs text-slate-500">No Location</span>;
  };

  return (
    <tr className="border-b border-slate-200 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
      {showUserColumn && (
        <td className="px-4 py-3 text-sm font-medium text-slate-900 dark:text-white">
          {log.user_name || unnamedLabel('member')}
        </td>
      )}
      <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-200 font-mono">
        {formatTimestamp(log.time_in)}
      </td>
      <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-200 font-mono">
        {log.time_out ? (
          formatTimestamp(log.time_out)
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-600 border border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800 font-sans">
            Active Entry
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-sm font-semibold text-slate-900 dark:text-white">
        <div className="flex items-center gap-1.5">
          <Clock className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          <span>{formattedHours} hrs</span>
        </div>
      </td>
      <td className="px-4 py-3 text-sm font-medium text-slate-900 dark:text-white break-words leading-snug">
        {shiftTimeDisplay}
      </td>
      <td className="px-4 py-3 text-sm">
        {renderLocation(log.calc_address, log.gps_lat, log.gps_lon)}
      </td>
      <td className="px-4 py-3 text-sm">
        {log.time_out 
          ? renderLocation(log.calc_address_out, log.gps_lat_out, log.gps_lon_out)
          : <span className="text-xs text-slate-500">--</span>
        }
      </td>
    </tr>
  );
}