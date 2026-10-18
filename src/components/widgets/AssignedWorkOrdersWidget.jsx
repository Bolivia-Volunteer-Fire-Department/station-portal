import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Wrench,
  Clock,
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  Loader2,
  CheckCircle2,
  Truck,
  ShieldAlert,
  Building2,
} from 'lucide-react';
import { fetchWorkOrders } from '../../services/api';
import {
  getStatusMeta,
  getPriorityMeta,
  getCategoryMeta,
  isActiveWorkOrder,
  normalizeWorkOrder,
} from '../../utils/workOrders';

export default function AssignedWorkOrdersWidget({
  token,
  currentUser = null,
  onNavigate = null,
  workOrders: workOrdersProp = null,
}) {
  const currentUserId = String(currentUser?.id || '');
  const [fetchedWorkOrders, setFetchedWorkOrders] = useState([]);
  const [loading, setLoading] = useState(!Array.isArray(workOrdersProp));

  const myAssignedFromProps = useMemo(() => {
    if (!Array.isArray(workOrdersProp) || !currentUserId) return null;
    return workOrdersProp
      .map((row) => normalizeWorkOrder(row, currentUser))
      .filter((wo) => String(wo.assigned_to_id) === currentUserId && isActiveWorkOrder(wo))
      .sort((a, b) => {
        const pA = a.priority === 'urgent' ? 4 : a.priority === 'high' ? 3 : a.priority === 'medium' ? 2 : 1;
        const pB = b.priority === 'urgent' ? 4 : b.priority === 'high' ? 3 : b.priority === 'medium' ? 2 : 1;
        if (pB !== pA) return pB - pA;
        return new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0);
      });
  }, [workOrdersProp, currentUserId, currentUser]);

  const loadAssigned = useCallback(async () => {
    if (Array.isArray(workOrdersProp)) {
      setLoading(false);
      return;
    }
    if (!token || !currentUserId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetchWorkOrders(token);
      if (res?.workOrders) {
        const myAssigned = res.workOrders
          .map((row) => normalizeWorkOrder(row, currentUser))
          .filter((wo) => String(wo.assigned_to_id) === currentUserId && isActiveWorkOrder(wo))
          .sort((a, b) => {
            // Sort urgent first, then by date
            const pA = a.priority === 'urgent' ? 4 : a.priority === 'high' ? 3 : a.priority === 'medium' ? 2 : 1;
            const pB = b.priority === 'urgent' ? 4 : b.priority === 'high' ? 3 : b.priority === 'medium' ? 2 : 1;
            if (pB !== pA) return pB - pA;
            return new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0);
          });
        setFetchedWorkOrders(myAssigned);
      }
    } catch (err) {
      console.warn('Failed to load assigned work orders:', err);
    } finally {
      setLoading(false);
    }
  }, [token, currentUserId, currentUser, workOrdersProp]);

  useEffect(() => {
    if (!Array.isArray(workOrdersProp)) {
      loadAssigned();
    }
  }, [loadAssigned, workOrdersProp]);

  const workOrders = myAssignedFromProps !== null ? myAssignedFromProps : fetchedWorkOrders;

  const handleOpenWorkOrder = (wo) => {
    if (onNavigate) {
      onNavigate('admin', 'work-orders', {
        initialWorkOrderId: wo.id,
        initialWorkOrder: wo,
      });
    }
  };

  return (
    <div className="h-full max-h-[500px] flex flex-col justify-between overflow-hidden bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-xl">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700/60">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 flex items-center justify-center font-bold">
            <Wrench className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Assigned Work Orders
            </h3>
            <p className="text-[11px] text-slate-400">
              Tickets assigned to you for maintenance & repairs
            </p>
          </div>
        </div>

        <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-bold rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
          {workOrders.length}
        </span>
      </div>

      {/* Content */}
      <div className="overflow-y-auto min-h-0 flex-1 pr-0.5">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin text-red-600" />
            <span className="ml-2 text-xs">Loading work orders...</span>
          </div>
        ) : workOrders.length === 0 ? (
          <div className="py-8 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              No pending work orders
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              You currently have no active work orders assigned to you.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700/40 mt-1 pr-0.5">
            {workOrders.map((wo) => {
              const statusMeta = getStatusMeta(wo.status);
              const priorityMeta = getPriorityMeta(wo.priority);
              const isUrgent = wo.priority === 'urgent';

              return (
                <button
                  type="button"
                  key={wo.id}
                  onClick={() => handleOpenWorkOrder(wo)}
                  className="w-full text-left py-2.5 px-2 first:pt-2 last:pb-1 flex items-start justify-between gap-3 text-xs rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/40 transition cursor-pointer group"
                  title="Open work order in Administrator view"
                >
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-[10px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-700/60 px-1.5 py-0.5 rounded">
                        {wo.ticket_number}
                      </span>

                      {isUrgent && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-red-700 bg-red-100 dark:bg-red-950/70 dark:text-red-400 px-1.5 py-0.5 rounded">
                          <AlertTriangle className="w-3 h-3" />
                          Urgent
                        </span>
                      )}

                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          statusMeta.value === 'in_progress'
                            ? 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-400'
                            : statusMeta.value === 'scheduled'
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-400'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400'
                        }`}
                      >
                        {statusMeta.label}
                      </span>
                    </div>

                    <p className="font-semibold text-slate-900 dark:text-white truncate group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors">
                      {wo.title}
                    </p>

                    <div className="flex items-center gap-2 text-[11px] text-slate-400">
                      {wo.category === 'apparatus' && wo.apparatus_name && (
                        <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                          <Truck className="w-3 h-3 text-red-500" />
                          {wo.apparatus_name}
                        </span>
                      )}
                      {wo.category === 'equipment' && wo.equipment_name && (
                        <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                          <ShieldAlert className="w-3 h-3 text-amber-500" />
                          {wo.equipment_name}
                        </span>
                      )}
                      {wo.category === 'station' && wo.station_location && (
                        <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                          <Building2 className="w-3 h-3 text-blue-500" />
                          {wo.station_location}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0 self-center pl-1 text-slate-300 dark:text-slate-600 group-hover:text-red-500 dark:group-hover:text-red-400 group-hover:translate-x-0.5 transition">
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer link to Work Orders */}
      <div className="shrink-0 pt-3 border-t border-slate-100 dark:border-slate-700/60 mt-2">
        <button
          type="button"
          onClick={() => onNavigate?.('admin', 'work-orders')}
          className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition py-1"
        >
          <span>View All Work Orders</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
