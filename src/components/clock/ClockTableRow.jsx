import React from 'react';
import { MapPin, Clock } from 'lucide-react';
import { formatStationTime } from '../../utils/timeFormat';
import { computeShiftBreakdown, formatShiftBreakdown } from '../../utils/shiftHours';
import { clockLogHours } from '../../utils/clockLogs';
import { unnamedLabel } from '../../utils/displayLabel';

export default function ClockTableRow({ log, showUserColumn = false, timeFormat = '12', shifts = [] }) {
  // THE DURATION COMES FROM THE SHARED RULE, not from `calc_hours` on its own.
  //
  // This cell used to read `log.calc_hours ? ... : '--'`, and `calc_hours` is a LEGACY SPREADSHEET COLUMN that nothing in
  // this app writes - not the clock-in transaction, not the officer's manual entry, not the migration's readers. So for
  // every entry the app itself created the column was blank, and the reported symptom was a Duration that "sometimes"
  // does not calculate: it did calculate for rows carried over from the sheet, and never for the ones the app wrote.
  //
  // `clockLogHours` is the rule the SAME SCREEN already uses a few lines away for its totals card, and it was right all
  // along: the stored number when it is usable, otherwise measured from `time_in` to `time_out`. That left the page
  // contradicting itself - the card summed 8.5 hrs while the row beside it said `--` - and sorting "longest duration
  // first" was ranking blanks. Administration > Clock Management never showed it, because that tab has always had the
  // fallback locally; using the shared helper makes the two screens agree by construction rather than by coincidence.
  //
  // An entry still clocked in has no end yet, and neither has a duration to state - that stays `--`, which is why the
  // totals skip it too (an unfinished shift is not zero hours, it is an unknown number).
  const hours = clockLogHours(log);
  const formattedHours = hours === null ? '--' : hours.toFixed(2);

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
          {/* The unit belongs to a NUMBER. A row with no hours reads "-- hrs" otherwise, which states a unit for a
              figure that is not there - and an entry still clocked in is the common case, not an edge. */}
          <span>{hours === null ? '--' : `${formattedHours} hrs`}</span>
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