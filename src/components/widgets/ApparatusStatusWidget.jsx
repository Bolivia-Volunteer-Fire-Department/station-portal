import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Truck,
  RotateCw,
  AlertTriangle,
  CheckCircle2,
  Wrench,
  ShieldAlert,
  ChevronRight,
  Layers,
} from 'lucide-react';
import { fetchApparatus } from '../../services/api';
import {
  apparatusStatusBadge,
  normalizeApparatusRecord,
  sortApparatusByIdentifier,
} from '../../utils/apparatus';
import { FRESHNESS_STALE_MS } from '../../utils/freshness';

const CACHE_KEY = 'fire_clock_cached_apparatus';
const CACHE_TS_KEY = 'fire_clock_cached_apparatus_at';

export default function ApparatusStatusWidget({ token, onNavigate }) {
  const [apparatusList, setApparatusList] = useState(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          return parsed.map(normalizeApparatusRecord).sort(sortApparatusByIdentifier);
        }
      }
    } catch {
      // Ignore cache error
    }
    return [];
  });

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadApparatus = useCallback(
    async (isManual = false) => {
      if (!token) return;

      // On automatic mount, check if cached data is still fresh (< 5 mins)
      if (!isManual) {
        try {
          const cachedAt = Number(localStorage.getItem(CACHE_TS_KEY)) || 0;
          if (cachedAt && Date.now() - cachedAt < FRESHNESS_STALE_MS) {
            return;
          }
        } catch {
          // Ignore cache error
        }
      }

      if (isManual) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const response = await fetchApparatus(token);
        if (response?.apparatus) {
          const normalized = response.apparatus
            .map(normalizeApparatusRecord)
            .sort(sortApparatusByIdentifier);
          setApparatusList(normalized);
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(normalized));
            localStorage.setItem(CACHE_TS_KEY, String(Date.now()));
          } catch {
            // Local storage may be full or blocked
          }
        }
      } catch (err) {
        console.warn('ApparatusStatusWidget failed to fetch apparatus fleet:', err);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token]
  );

  useEffect(() => {
    loadApparatus();
  }, [loadApparatus]);

  // Filter apparatus with show_on_widget checked, organized alphanumerically by unit identifier
  const widgetApparatus = useMemo(
    () => apparatusList.filter((item) => Boolean(item.show_on_widget)).sort(sortApparatusByIdentifier),
    [apparatusList]
  );

  const inServiceCount = useMemo(
    () => widgetApparatus.filter((item) => item.status === 'in_service').length,
    [widgetApparatus]
  );

  const getStatusHighlight = (status) => {
    const s = String(status || '').toLowerCase().trim();
    switch (s) {
      case 'in_service':
        return {
          container:
            'border-emerald-200 bg-emerald-50/40 hover:bg-emerald-50/70 dark:border-emerald-800/60 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/30',
          dot: 'bg-emerald-500',
          badge: 'bg-emerald-100/90 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
          icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />,
        };
      case 'out_of_service':
        return {
          container:
            'border-rose-300 bg-rose-50/50 hover:bg-rose-50/80 dark:border-rose-800/80 dark:bg-rose-950/30 dark:hover:bg-rose-950/40',
          dot: 'bg-rose-500',
          badge: 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300',
          icon: <ShieldAlert className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />,
        };
      case 'in_shop':
        return {
          container:
            'border-amber-300 bg-amber-50/40 hover:bg-amber-50/70 dark:border-amber-800/80 dark:bg-amber-950/25 dark:hover:bg-amber-950/35',
          dot: 'bg-amber-500',
          badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
          icon: <Wrench className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />,
        };
      case 'reserve':
        return {
          container:
            'border-sky-200 bg-sky-50/40 hover:bg-sky-50/70 dark:border-sky-800/60 dark:bg-sky-950/20 dark:hover:bg-sky-950/30',
          dot: 'bg-sky-500',
          badge: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300',
          icon: <Truck className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />,
        };
      case 'retired':
      default:
        return {
          container:
            'border-slate-200 bg-slate-50/40 hover:bg-slate-50/70 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:bg-slate-800/60',
          dot: 'bg-slate-400',
          badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
          icon: null,
        };
    }
  };

  return (
    <div className="h-full max-h-[500px] flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800 p-5 md:p-6 shadow-xl transition-all">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between mb-3.5 pb-2 border-b border-slate-100 dark:border-slate-700/60">
        <div className="flex items-center gap-2 text-slate-800 dark:text-slate-100 font-bold text-sm">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400">
            <Truck className="w-4 h-4" />
          </span>
          <span>Apparatus Fleet Status</span>
        </div>

        <div className="flex items-center gap-2">
          {widgetApparatus.length > 0 && (
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                inServiceCount === widgetApparatus.length
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  inServiceCount === widgetApparatus.length ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
              {inServiceCount} / {widgetApparatus.length} Ready
            </span>
          )}

          <button
            type="button"
            onClick={() => loadApparatus(true)}
            disabled={refreshing}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-700 transition"
            title="Refresh apparatus status"
          >
            <RotateCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-red-500' : ''}`} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="overflow-y-auto min-h-0 flex-1 pr-1">
        {loading && widgetApparatus.length === 0 ? (
          <div className="space-y-2.5 py-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-16 rounded-xl bg-slate-100 dark:bg-slate-700/50 animate-pulse"
              />
            ))}
          </div>
        ) : widgetApparatus.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-6 text-center">
            <Truck className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              No Apparatus Selected
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 max-w-xs mx-auto">
              In <strong className="text-slate-700 dark:text-slate-300">Administration &gt; Content &gt; Apparatus</strong>, check <em className="not-italic font-semibold text-slate-700 dark:text-slate-200">&ldquo;Show on Widget&rdquo;</em> on front-line vehicles to monitor them here.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {widgetApparatus.map((item) => {
              const highlight = getStatusHighlight(item.status);
              const badge = apparatusStatusBadge(item.status);
              const callsign = item.identifier || item.description;

              return (
                <div
                  key={item.id}
                  className={`flex items-center justify-between gap-3 p-3 rounded-xl border transition shadow-xs ${highlight.container}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Callsign Badge */}
                    <div className="flex flex-col items-center justify-center shrink-0 min-w-16 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xs">
                      <span className="text-xs font-extrabold tracking-tight text-slate-900 dark:text-white truncate uppercase">
                        {callsign}
                      </span>
                      {item.identifier && (
                        <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider truncate">
                          {item.type}
                        </span>
                      )}
                    </div>

                    {/* Description and Details */}
                    <div className="min-w-0">
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {item.description}
                      </h4>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        <span>{item.type}</span>
                        {item.station && (
                          <>
                            <span className="text-slate-300 dark:text-slate-600">•</span>
                            <span className="truncate">{item.station}</span>
                          </>
                        )}
                        {item.tank_capacity && (
                          <>
                            <span className="text-slate-300 dark:text-slate-600">•</span>
                            <span>{item.tank_capacity}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Status Highlight Badge */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold shadow-xs ${highlight.badge}`}
                    >
                      <span className={`h-2 w-2 rounded-full ${highlight.dot}`} />
                      <span>{badge.label}</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer link to member apparatus registry if user can navigate */}
      {onNavigate && (
        <div className="shrink-0 pt-3 mt-3 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-xs">
          <span className="text-[11px] text-slate-400">
            {widgetApparatus.length} unit{widgetApparatus.length === 1 ? '' : 's'} on watch
          </span>
          <button
            type="button"
            onClick={() => onNavigate('apparatus')}
            className="text-xs font-semibold text-red-600 dark:text-red-400 hover:text-red-500 flex items-center gap-0.5 transition"
          >
            <span>Apparatus Registry</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

