import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, ChevronLeft, ChevronRight, Filter, Info, Loader2, RefreshCw, RotateCcw, ScrollText,
} from 'lucide-react';
import { adminFetchSystemLog } from '../../services/api';
import { unnamedLabel } from '../../utils/displayLabel';
import {
  DEFAULT_LOG_SORT,
  LOG_ACTION_TONE_CLASSES,
  LOG_PAGE_SIZE,
  LOG_SORT_OPTIONS,
  SYSTEM_LOG_API_VERSION,
  clampLogPage,
  emptyLogFilters,
  formatLogTimestamp,
  logActionTone,
  logPageRangeLabel,
  logQueryParams,
  normalizeLogRows,
  totalLogPages,
} from '../../utils/systemLog';

// The System Log.
//
// Lazy by construction: this component is only mounted while the tab is open, so the log is fetched
// the first time somebody looks at it and never as part of the sign-in or admin refresh waves. The
// log is the largest table in the app, so nothing here may load on a screen nobody asked for.
//
// Every filter, sort or page change is ONE request, because the filtering and paging happen on the
// server - there is no full copy here to page through. That is why each change shows the spinner
// rather than appearing instant.
export default function AdminSystemLogTab({ token, users = [], timeFormat = '12' }) {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({
    page: 1,
    page_size: LOG_PAGE_SIZE,
    total: 0,
    total_pages: 1,
    sort: DEFAULT_LOG_SORT,
  });
  const [facets, setFacets] = useState({ actions: [], members: [] });
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState(DEFAULT_LOG_SORT);
  const [filters, setFilters] = useState(emptyLogFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  // Set when the deployed script answers with a different contract version. Kept separate from
  // `error`: the page may still be usable, it is the deployment that is behind.
  const [staleBackend, setStaleBackend] = useState(false);
  // Bumped by Refresh so an identical query can still be re-requested.
  const [reloadCount, setReloadCount] = useState(0);

  const query = useMemo(() => logQueryParams({ page, sort, filters }), [page, sort, filters]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    adminFetchSystemLog(query, token)
      .then((result) => {
        if (cancelled) return;
        if (!result?.success) throw new Error(result?.message || 'Failed to load the system log.');

        // A different contract version means the deployed script predates this build. Reported rather
        // than thrown: the rows that did arrive are still worth showing.
        setStaleBackend(Number(result.api) !== SYSTEM_LOG_API_VERSION);

        setRows(normalizeLogRows(result.rows));
        setMeta({
          page: Number(result.page) || 1,
          page_size: Number(result.page_size) || LOG_PAGE_SIZE,
          total: Number(result.total) || 0,
          total_pages: Number(result.total_pages) || 1,
          sort: result.sort || DEFAULT_LOG_SORT,
        });
        setFacets({
          actions: Array.isArray(result.actions) ? result.actions : [],
          members: Array.isArray(result.members) ? result.members : [],
        });
        // The server clamps the page, so trust its answer over what was asked for - otherwise the
        // pager could show a page number the table is not displaying.
        setPage(Number(result.page) || 1);
        setLoadedOnce(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || 'Failed to load the system log.');
        setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [query, token, reloadCount]);

  const memberName = (userId) => users.find((user) => String(user.id) === String(userId))?.name || '';
  // Ids in the log that are not member records (a failed sign-in is recorded against the typed
  // username) are shown as-is rather than hidden, so the dropdown can always reach every row.
  const memberLabel = (userId) => memberName(userId) || userId;

  const isFiltered = Boolean(filters.from || filters.to || filters.action || filters.member);
  const pages = totalLogPages(meta.total, meta.page_size);
  const rangeLabel = logPageRangeLabel(meta.total, meta.page, meta.page_size);

  const goToPage = (next) => setPage(clampLogPage(next, meta.total, meta.page_size));
  const setFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    // A filter change resets to page one: page 8 of the old result may not exist in the new one.
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <ScrollText className="w-4 h-4 text-red-500 shrink-0" />
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">System Log</h3>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {rangeLabel}
            {isFiltered ? ' (filtered)' : ''}
          </span>
          <button
            type="button"
            onClick={() => setReloadCount((n) => n + 1)}
            disabled={loading}
            title="Fetch this page again"
            className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:text-white"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </button>
        </div>

        {/* Filters. Each change is one request (page resets to 1), so the select is controlled by
            state rather than applied by a button. */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1" htmlFor="log-from">From date</label>
            <input
              id="log-from"
              type="date"
              value={filters.from}
              onChange={(e) => setFilter('from', e.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500/40"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1" htmlFor="log-to">To date</label>
            <input
              id="log-to"
              type="date"
              value={filters.to}
              onChange={(e) => setFilter('to', e.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500/40"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1" htmlFor="log-action">Action</label>
            <select
              id="log-action"
              value={filters.action}
              onChange={(e) => setFilter('action', e.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500/40"
            >
              <option value="">All actions</option>
              {facets.actions.map((action) => (
                <option key={action} value={action}>{action}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1" htmlFor="log-member">Member</label>
            <select
              id="log-member"
              value={filters.member}
              onChange={(e) => setFilter('member', e.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500/40"
            >
              <option value="">All members</option>
              {facets.members.map((userId) => (
                <option key={userId} value={userId}>{memberLabel(userId)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1" htmlFor="log-sort">Sort by</label>
            <select
              id="log-sort"
              value={sort}
              onChange={(e) => { setSort(e.target.value); setPage(1); }}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500/40"
            >
              {LOG_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>

        {isFiltered && (
          <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Filters applied — the count above is of matching entries, not the whole log.
            </span>
            <button
              type="button"
              onClick={() => { setFilters(emptyLogFilters()); setPage(1); }}
              className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Clear filters
            </button>
          </div>
        )}

        {error && (
          <div className="m-4 p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Named explicitly, because the symptom of a stale deployment is an empty table - which looks
            like an empty log rather than something to fix. */}
        {staleBackend && (
          <div className="m-4 p-3 rounded-xl flex items-start gap-2 text-sm font-medium bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800/80">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              The deployed Apps Script is older than this version of the app, so the filters cannot be
              applied and the table may be incomplete. Deploy the current <code className="font-mono text-[11px]">Code.gs</code> as
              a new version, then reload.
            </span>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-100 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 uppercase text-xs">
              <tr>
                <th className="px-4 py-3 whitespace-nowrap">Timestamp</th>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/70">
              {/* The spinner replaces the table only on the FIRST load. Afterwards the previous page
                  stays put and fades while the next one arrives, so paging does not blank the tab. */}
              {loading && !loadedOnce && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-red-500" />
                    Loading the system log…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && !error && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                    {isFiltered ? 'No log entries match these filters.' : 'The system log is empty.'}
                  </td>
                </tr>
              )}
              {rows.map((row, index) => {
                const name = memberName(row.user_id);
                return (
                  <tr
                    key={row.id || `row-${index}`}
                    /* Faded while a new page loads, so stale rows are never mistaken for the ones
                       that were just requested. */
                    className={`align-top ${loading ? 'opacity-50' : ''}`}
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600 dark:text-slate-300">
                      {formatLogTimestamp(row.timestamp, timeFormat)}
                    </td>
                    <td
                      className="px-4 py-3 text-slate-700 dark:text-slate-200"
                      title={name || undefined}
                    >
                      {name || unnamedLabel('member')}
                    </td>
                    <td className="px-4 py-3">
                      {row.action ? (
                        <span
                          className={`inline-block rounded-lg border px-2 py-0.5 font-mono text-[11px] ${LOG_ACTION_TONE_CLASSES[logActionTone(row.action)]}`}
                        >
                          {row.action}
                        </span>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 break-words text-slate-600 dark:text-slate-300">
                      {row.details || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-t border-slate-200 dark:border-slate-700">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Page {meta.page} of {pages}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => goToPage(meta.page - 1)}
              disabled={loading || meta.page <= 1}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent dark:text-slate-300 dark:hover:bg-slate-700/60"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Previous
            </button>
            <button
              type="button"
              onClick={() => goToPage(meta.page + 1)}
              disabled={loading || meta.page >= pages}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent dark:text-slate-300 dark:hover:bg-slate-700/60"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="p-3 rounded-xl flex items-start gap-2 text-xs bg-slate-50 text-slate-500 border border-slate-200 dark:bg-slate-900/50 dark:text-slate-400 dark:border-slate-700">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          Read-only. The log is fetched one page at a time, so changing a filter, the sort or the page
          makes a single request rather than holding the whole sheet in the browser.
        </span>
      </div>
    </div>
  );
}
