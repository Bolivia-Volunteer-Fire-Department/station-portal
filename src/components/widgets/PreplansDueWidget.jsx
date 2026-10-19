import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Building2,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Clock,
  Compass,
  ChevronRight,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import { fetchPreIncidentPlans } from '../../services/api';
import {
  cachedPreIncidentPlans,
  getPreplanInspectionDue,
  normalizePreIncidentPlan,
} from '../../utils/preIncidentPlans';

export default function PreplansDueWidget({
  token,
  currentUser = null,
  onNavigate = null,
  onNavigateToMap = null,
}) {
  const [plans, setPlans] = useState(() => cachedPreIncidentPlans());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const now = useMemo(() => new Date(), []);
  const currentMonthName = useMemo(() => {
    return now.toLocaleString('default', { month: 'long', year: 'numeric' });
  }, [now]);

  const loadPlans = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetchPreIncidentPlans(token);
      if (Array.isArray(res?.preIncidentPlans)) {
        setPlans(res.preIncidentPlans.map((p) => normalizePreIncidentPlan(p)));
      }
    } catch (err) {
      setError(err?.message || 'Failed to check preplan inspections');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  // Compute inspection status and filter for plans due this month or overdue
  const duePreplans = useMemo(() => {
    return plans
      .map((plan) => {
        const dueInfo = getPreplanInspectionDue(plan, now);
        return {
          plan,
          ...dueInfo,
        };
      })
      .filter((item) => item.isDueThisMonth || item.isOverdue)
      .sort((a, b) => {
        // Most overdue first, then due soonest
        if (a.isOverdue && !b.isOverdue) return -1;
        if (!a.isOverdue && b.isOverdue) return 1;
        return a.daysRemaining - b.daysRemaining;
      });
  }, [plans, now]);

  const overdueCount = useMemo(() => {
    return duePreplans.filter((p) => p.isOverdue).length;
  }, [duePreplans]);

  const dueThisMonthCount = useMemo(() => {
    return duePreplans.filter((p) => !p.isOverdue && p.isDueThisMonth).length;
  }, [duePreplans]);

  const handleOpenPlan = (plan) => {
    if (typeof onNavigateToMap === 'function') {
      onNavigateToMap(plan);
    } else if (typeof onNavigate === 'function') {
      onNavigate('district-map');
    }
  };

  return (
    <div className="flex h-full max-h-[500px] flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-xl transition-all dark:border-slate-700 dark:bg-slate-800">
      <div>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-700">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Preplans Due for Inspection
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {currentMonthName} &amp; Overdue · Annual 365-day cycle
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {overdueCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-bold text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
                <AlertCircle className="h-3 w-3 text-red-600 dark:text-red-400" />
                {overdueCount} Overdue
              </span>
            ) : null}

            {dueThisMonthCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-300">
                <Clock className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                {dueThisMonthCount} Due
              </span>
            ) : overdueCount === 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300">
                <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                All Current
              </span>
            ) : null}
          </div>
        </div>

        {/* Content list */}
        <div className="mt-3.5 space-y-2.5 overflow-y-auto max-h-[340px] pr-1">
          {loading && plans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
              <p className="mt-2 text-xs">Checking annual inspection cycles…</p>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </div>
          ) : duePreplans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <p className="mt-3 text-xs font-semibold text-slate-800 dark:text-slate-200">
                All pre-incident plans are up to date
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 max-w-xs">
                No preplans in the district are overdue or require annual inspection during {currentMonthName}.
              </p>
            </div>
          ) : (
            duePreplans.map(({ plan, latestInspection, nextDueDateString, daysRemaining, isOverdue }) => {
              const fullAddress = [plan.address1, plan.city].filter(Boolean).join(', ');

              return (
                <div
                  key={plan.id || plan.occupancy_id}
                  onClick={() => handleOpenPlan(plan)}
                  className={`group flex cursor-pointer items-center justify-between rounded-xl border p-3 transition hover:shadow-sm ${
                    isOverdue
                      ? 'border-red-200 bg-red-50/40 hover:border-red-300 hover:bg-red-50/80 dark:border-red-900/40 dark:bg-red-950/20 dark:hover:border-red-800 dark:hover:bg-red-950/50'
                      : 'border-slate-200 bg-slate-50/60 hover:border-blue-300 hover:bg-blue-50/30 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-blue-700 dark:hover:bg-slate-700/50'
                  }`}
                >
                  <div className="min-w-0 flex-1 pr-3">
                    <div className="flex items-center gap-2">
                      <h4 className="truncate text-xs font-bold text-slate-900 group-hover:text-blue-600 dark:text-white dark:group-hover:text-blue-400">
                        {plan.occupancy_name || 'Unnamed Preplan'}
                      </h4>
                      {plan.occupancy_type ? (
                        <span className="hidden sm:inline-block rounded-md bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {plan.occupancy_type}
                        </span>
                      ) : null}
                    </div>

                    {fullAddress ? (
                      <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                        {fullAddress}
                      </p>
                    ) : null}

                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
                      <span className="text-slate-500 dark:text-slate-400">
                        Last inspected:{' '}
                        <strong className="text-slate-700 dark:text-slate-300">
                          {latestInspection?.inspection_date || 'Never (Initial due)'}
                        </strong>
                      </span>
                      <span>&middot;</span>
                      <span
                        className={`font-semibold ${
                          isOverdue
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {isOverdue
                          ? `Overdue by ${Math.abs(daysRemaining)} day${Math.abs(daysRemaining) === 1 ? '' : 's'} (due ${nextDueDateString})`
                          : `Due ${nextDueDateString} (${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left)`}
                      </span>
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                    <span className="hidden sm:inline-block text-[11px]">View</span>
                    <Compass className="h-4 w-4" />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
        <span>
          {plans.length} total preplan{plans.length === 1 ? '' : 's'} on record
        </span>
        <button
          type="button"
          onClick={() => {
            if (typeof onNavigate === 'function') onNavigate('district-map');
          }}
          className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          <span>Open District Map</span>
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

