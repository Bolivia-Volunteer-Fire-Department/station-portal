import React, { useMemo, useEffect, useRef, useState, useId } from 'react';
import { Save, Loader2, Pencil, Trash2, Plus, AlertCircle, X, ArrowUpDown, Download, MapPin } from 'lucide-react';
import { adminSaveTimeclockEntry, adminDeleteTimeclockEntry } from '../../services/api';
import { formatStationTime } from '../../utils/timeFormat';
import { computeShiftBreakdown, formatShiftBreakdown } from '../../utils/shiftHours';
import { CLOCK_LOG_SORT_OPTIONS, filterAndSortClockLogs } from '../../utils/clockLogs';
import RankIcon from '../RankIcon';

// Shows a hover/focus popover with the reverse-geocoded address for a clock in/out time,
// falling back to the raw GPS coordinates when no address was resolved.
function AddressPopover({ label, address, lat, lon, children }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const popoverId = useId();

  // Close on outside tap/click or Escape (also makes the popover dismissible on touch devices)
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const hasCoords =
    lat !== undefined && lat !== null && lat !== '' &&
    lon !== undefined && lon !== null && lon !== '';
  const coords = hasCoords ? `${lat}, ${lon}` : '';

  return (
    <div
      ref={wrapperRef}
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {/* Invisible hover bridge keeps the popover open while moving from the timestamp down into it */}
      <span aria-hidden="true" className="absolute inset-x-0 top-full h-1" />
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-describedby={open ? popoverId : undefined}
        onFocus={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 font-mono text-left underline decoration-dotted decoration-slate-400 dark:decoration-slate-500 hover:decoration-solid"
      >
        {children}
        <MapPin className="w-3 h-3 text-slate-400 dark:text-slate-500 shrink-0" />
      </button>
      {open && (
        <div
          id={popoverId}
          role="tooltip"
          className="absolute z-20 top-full left-0 mt-1 w-60 p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl text-xs font-sans normal-case"
        >
          <p className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200 mb-1">
            <MapPin className="w-3.5 h-3.5 text-red-500 shrink-0" /> {label}
          </p>
          <p className="text-slate-600 dark:text-slate-300 break-words">
            {address || (hasCoords ? <span className="font-mono">{coords}</span> : 'No location recorded.')}
          </p>
        </div>
      )}
    </div>
  );
}

const EMPTY_FORM = { id: '', user_id: '', time_in: '', time_out: '' };

// Converts a sheet timestamp ("yyyy-MM-dd HH:mm:ss" or Date) into a <input type="datetime-local"> value
function toDatetimeLocalValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Converts a <input type="datetime-local"> value back into the sheet's "yyyy-MM-dd HH:mm:ss" format
function fromDatetimeLocalValue(value) {
  if (!value) return '';
  const [datePart, timePart] = value.split('T');
  return `${datePart} ${timePart}:00`;
}

function isTruthy(value) {
  return value === true || String(value).trim().toUpperCase() === 'TRUE';
}

function computeDurationHours(log) {
  if (log.calc_hours !== undefined && log.calc_hours !== '') {
    const hrs = parseFloat(log.calc_hours);
    if (!isNaN(hrs)) return hrs.toFixed(2);
  }
  if (log.time_in && log.time_out) {
    const start = new Date(log.time_in);
    const end = new Date(log.time_out);
    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
      return Math.max(0, (end - start) / 3600000).toFixed(2);
    }
  }
  return '--';
}

export default function AdminClockManagementTab({ token, users, ranks, logs = [], timeFormat = '12', onDataChanged, shifts = [] }) {
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState(null);

  const [filterUserId, setFilterUserId] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortBy, setSortBy] = useState('time_in_desc');

  const isEditing = !!formData.id;
  const resetForm = () => setFormData(EMPTY_FORM);

  const userById = (userId) => users.find((u) => String(u.id) === String(userId));
  const rankFor = (userId) => {
    const user = userById(userId);
    return user ? ranks.find((r) => String(r.id) === String(user.rank_id)) : undefined;
  };

  const handleEdit = (log) => {
    setError(null);
    setFormData({
      id: log.id,
      user_id: String(log.user_id ?? ''),
      time_in: toDatetimeLocalValue(log.time_in),
      time_out: toDatetimeLocalValue(log.time_out),
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await adminSaveTimeclockEntry(
        {
          id: formData.id,
          user_id: formData.user_id,
          time_in: fromDatetimeLocalValue(formData.time_in),
          time_out: formData.time_out ? fromDatetimeLocalValue(formData.time_out) : '',
        },
        token
      );
      if (!result?.success) throw new Error(result?.message || 'Failed to save timeclock entry.');
      await onDataChanged?.();
      resetForm();
    } catch (err) {
      setError(err.message || 'Failed to save timeclock entry.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (log) => {
    if (!window.confirm('Delete this timeclock entry? This cannot be undone.')) return;
    setDeletingId(log.id);
    setError(null);
    try {
      const result = await adminDeleteTimeclockEntry(log.id, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to delete entry.');
      await onDataChanged?.();
      if (String(formData.id) === String(log.id)) resetForm();
    } catch (err) {
      setError(err.message || 'Failed to delete entry.');
    } finally {
      setDeletingId(null);
    }
  };

  const filteredSortedLogs = useMemo(
    () =>
      filterAndSortClockLogs(
        logs,
        { userId: filterUserId, status: filterStatus, sortBy },
        { users }
      ),
    [logs, users, filterUserId, filterStatus, sortBy]
  );

  const escapeCsvValue = (value) => {
    const str = String(value ?? '');
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const handleExportCsv = () => {
    const headers = ['Member', 'Rank', 'Time In', 'Time Out', 'Duration (hrs)', 'Shift Time', 'Manual', 'Clock-In Address', 'Clock-Out Address'];
    const rows = filteredSortedLogs.map((log) => {
      const user = userById(log.user_id);
      const rank = rankFor(log.user_id);
      return [
        user?.name || log.user_id,
        rank?.description || '',
        log.time_in || '',
        log.time_out || '',
        computeDurationHours(log),
        shifts.length && log.time_in ? formatShiftBreakdown(computeShiftBreakdown(log, shifts)) : '',
        isTruthy(log.is_manual) ? 'Yes' : 'No',
        log.calc_address || '',
        log.calc_address_out || '',
      ];
    });

    const csvContent = [headers, ...rows]
      .map((row) => row.map(escapeCsvValue).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `timeclock-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Add / Edit Entry Card */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
              {isEditing ? `Edit Entry #${formData.id}` : 'Add New Timeclock Entry'}
            </h3>
            {isEditing && (
              <button type="button" onClick={resetForm} className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1 text-sm">
                <X className="w-4 h-4" /> Cancel
              </button>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Member</label>
              <select
                required
                value={formData.user_id}
                onChange={(e) => setFormData({ ...formData, user_id: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="">-- Select Member --</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Time In</label>
              <input
                type="datetime-local"
                required
                value={formData.time_in}
                onChange={(e) => setFormData({ ...formData, time_in: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                Time Out <span className="text-slate-500">(leave blank if still on duty)</span>
              </label>
              <input
                type="datetime-local"
                value={formData.time_out}
                onChange={(e) => setFormData({ ...formData, time_out: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400">
            Entries added or edited here are automatically marked as manual.
          </p>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : isEditing ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {isEditing ? 'Save Changes' : 'Add Entry'}
            </button>
          </div>
        </form>
      </div>

      {/* Filter & Sort Controls */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1.5">Filter by Member</label>
            <select
              value={filterUserId}
              onChange={(e) => setFilterUserId(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <option value="">All Members</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1.5">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <option value="all">All Entries</option>
              <option value="active">Active (Clocked In)</option>
              <option value="completed">Completed</option>
            </select>
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1.5">
              <ArrowUpDown className="w-3.5 h-3.5" /> Sort By
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              {/* The same option list the member view uses, so the two cannot drift apart. */}
              {CLOCK_LOG_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Entries Table */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-x-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Timeclock Entries {filteredSortedLogs.length > 0 && `(${filteredSortedLogs.length})`}
          </h3>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filteredSortedLogs.length === 0}
            className="flex items-center gap-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-medium text-sm px-4 py-2 rounded-xl transition disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-100 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 uppercase text-xs">
            <tr>
              <th className="px-4 py-3">Member</th>
              <th className="px-4 py-3">Rank</th>
              <th className="px-4 py-3">Time In</th>
              <th className="px-4 py-3">Time Out</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Shift Time</th>
              <th className="px-4 py-3">Manual</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700/70">
            {filteredSortedLogs.map((log) => {
              const user = userById(log.user_id);
              const rank = rankFor(log.user_id);
              return (
                <tr key={log.id} className="text-slate-700 dark:text-slate-200">
                  <td className="px-4 py-3 font-medium">{user?.name || log.user_id}</td>
                  <td className="px-4 py-3">
                    {rank ? (
                      <div className="flex items-center gap-1.5" style={{ color: rank.color || undefined }}>
                        <RankIcon name={rank.icon} className="w-4 h-4" />
                        <span>{rank.description}</span>
                      </div>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono">
                    {log.time_in ? (
                      <AddressPopover
                        label="Clock-In Address"
                        address={log.calc_address}
                        lat={log.gps_lat}
                        lon={log.gps_lon}
                      >
                        {`${new Date(log.time_in).toLocaleDateString('en-US', { timeZone: 'America/New_York' })} ${formatStationTime(log.time_in, timeFormat, false)}`}
                      </AddressPopover>
                    ) : '--'}
                  </td>
                  <td className="px-4 py-3 font-mono">
                    {log.time_out ? (
                      <AddressPopover
                        label="Clock-Out Address"
                        address={log.calc_address_out}
                        lat={log.gps_lat_out}
                        lon={log.gps_lon_out}
                      >
                        {`${new Date(log.time_out).toLocaleDateString('en-US', { timeZone: 'America/New_York' })} ${formatStationTime(log.time_out, timeFormat, false)}`}
                      </AddressPopover>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-600 border border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800 font-sans">Active</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{computeDurationHours(log)} hrs</td>
                  <td className="px-4 py-3">{shifts.length && log.time_in ? formatShiftBreakdown(computeShiftBreakdown(log, shifts)) || '0 hrs' : '—'}</td>
                  <td className="px-4 py-3">{isTruthy(log.is_manual) ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => handleEdit(log)} className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(log)}
                        disabled={deletingId === log.id}
                        className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
                      >
                        {deletingId === log.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredSortedLogs.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-500">No timeclock entries found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
