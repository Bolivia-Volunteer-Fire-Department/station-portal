import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Truck,
  Search,
  Filter,
  RotateCw,
  Loader2,
  Wrench,
  ArrowLeft,
  Droplets,
  MapPin,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Eye,
  Paperclip,
  Calendar,
  ClipboardCheck,
} from 'lucide-react';
import { fetchApparatus, fetchAssetTypes, fetchTaskNoteTemplates } from '../services/api';
import {
  APPARATUS_TYPES,
  APPARATUS_STATUSES,
  apparatusStatusBadge,
  evaluateServiceDue,
  normalizeApparatusRecord,
  sortApparatusByIdentifier,
  maintenanceTypeMeta,
  formatCurrency,
  formatFileSize,
} from '../utils/apparatus';
import { openApparatusMaintenanceFile } from '../services/apparatusFileStorage';
import { TASK_NOTE_KINDS, isTemplateActiveOn } from '../utils/tasksAndNotes';
import { stationTodayKey } from '../utils/scheduleDate';
import { toast } from '../utils/toast';
import ViewportModal from './ViewportModal';
import TaskNoteEntryModal from './tasks/TaskNoteEntryModal';

const CACHE_KEY = 'fire_clock_cached_apparatus';
const CACHE_TS_KEY = 'fire_clock_cached_apparatus_at';

export default function ApparatusModule({
  token,
  onBack,
  currentUser = null,
  _currentUser = null,
  departmentName = '',
  departmentLogoUrl = '',
}) {
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

  const [assetTypes, setAssetTypes] = useState([]);
  const [loading, setLoading] = useState(apparatusList.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Selected apparatus for read-only detail & maintenance inspection
  const [selectedApparatusId, setSelectedApparatusId] = useState(null);
  const [modalTab, setModalTab] = useState('details'); // 'details' | 'maintenance'

  // Daily checklist modal state
  const [checklistModalOpen, setChecklistModalOpen] = useState(false);
  const [activeChecklistTemplate, setActiveChecklistTemplate] = useState(null);
  const [activeChecklistEntry, setActiveChecklistEntry] = useState(null);
  const [taskNoteTemplates, setTaskNoteTemplates] = useState([]);

  const handleOpenChecklist = async (apparatus) => {
    try {
      let tpls = taskNoteTemplates;
      if (!tpls.length) {
        tpls = await fetchTaskNoteTemplates();
        setTaskNoteTemplates(tpls);
      }
      const today = stationTodayKey();
      const activeChecklistTpls = tpls.filter(
        (t) => t.kind === TASK_NOTE_KINDS.APPARATUS_CHECKLIST && isTemplateActiveOn(t, today)
      );

      // Prioritize specific apparatus match, then fleet-wide
      const matched =
        activeChecklistTpls.find((t) => t.apparatus_id === apparatus.id) ||
        activeChecklistTpls.find((t) => !t.apparatus_id) ||
        activeChecklistTpls[0];

      if (!matched) {
        toast.error('No active checklist template found. Please create one in Administration → Task Setup.');
        return;
      }

      setActiveChecklistTemplate(matched);
      setActiveChecklistEntry({
        id: '',
        template_id: matched.id,
        template_name: matched.name,
        kind: TASK_NOTE_KINDS.APPARATUS_CHECKLIST,
        title: `${apparatus.identifier || apparatus.description} Daily Checklist`,
        entry_date: today,
        apparatus_id: apparatus.id,
        apparatus_identifier: apparatus.identifier || apparatus.description,
        data: {},
      });
      setChecklistModalOpen(true);
    } catch (err) {
      toast.error(err.message || 'Failed to open apparatus checklist.');
    }
  };

  const loadData = useCallback(
    async (isManual = false) => {
      if (isManual) {
        setRefreshing(true);
      } else if (apparatusList.length === 0) {
        setLoading(true);
      }

      try {
        const [response, typesRes] = await Promise.all([
          fetchApparatus(token),
          fetchAssetTypes(token).catch(() => null),
        ]);

        if (response?.apparatus) {
          const normalized = response.apparatus
            .map(normalizeApparatusRecord)
            .sort(sortApparatusByIdentifier);
          setApparatusList(normalized);
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(normalized));
            localStorage.setItem(CACHE_TS_KEY, String(Date.now()));
          } catch {
            // Ignore localStorage quota errors
          }
        }

        if (typesRes?.assetTypes) {
          setAssetTypes(typesRes.assetTypes);
        }
      } catch (err) {
        console.warn('Failed to load apparatus records:', err);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token, apparatusList.length]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  const dynamicApparatusTypes = useMemo(() => {
    const custom = assetTypes.filter((t) => t.category === 'apparatus');
    if (custom.length > 0) {
      return custom.map((t) => ({ value: t.value || t.label, label: t.label }));
    }
    return APPARATUS_TYPES;
  }, [assetTypes]);

  // Filtering
  const filteredList = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return apparatusList.filter((item) => {
      if (typeFilter !== 'all' && item.type !== typeFilter) return false;
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (!q) return true;

      const haystack = [
        item.description,
        item.identifier,
        item.type,
        item.make_model,
        item.vin,
        item.license_plate,
        item.station,
        item.notes,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [apparatusList, searchQuery, typeFilter, statusFilter]);

  // Fleet health summary metrics
  const stats = useMemo(() => {
    const total = apparatusList.length;
    const inService = apparatusList.filter((a) => a.status === 'in_service').length;
    const inShop = apparatusList.filter((a) => a.status === 'in_shop').length;
    const outOfService = apparatusList.filter((a) => a.status === 'out_of_service').length;
    const reserve = apparatusList.filter((a) => a.status === 'reserve').length;
    return { total, inService, inShop, outOfService, reserve };
  }, [apparatusList]);

  const selectedApparatus = useMemo(() => {
    if (!selectedApparatusId) return null;
    return apparatusList.find((a) => a.id === selectedApparatusId) || null;
  }, [apparatusList, selectedApparatusId]);

  const openDetailsModal = (item, initialTab = 'details') => {
    setSelectedApparatusId(item.id);
    setModalTab(initialTab);
  };

  const closeDetailsModal = () => {
    setSelectedApparatusId(null);
  };

  return (
    <div className="space-y-6">
      {/* Top Bar: Navigation Back & Refresh */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 hover:text-slate-900 dark:hover:text-white shadow-xs transition active:scale-[0.98] w-fit"
            title="Back to Dashboard"
          >
            <ArrowLeft className="w-4 h-4 text-slate-500 dark:text-slate-400" />
            <span>Back to Dashboard</span>
          </button>
        )}

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            title="Refresh fleet data"
          >
            <RotateCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-red-600' : 'text-slate-400'}`} />
            <span>{refreshing ? 'Refreshing…' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Fleet Overview Metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Fleet</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <Truck className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{stats.total}</p>
          <span className="text-[11px] text-slate-400">Registered vehicles</span>
        </div>

        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/30 p-4 shadow-sm dark:border-emerald-950/40 dark:bg-emerald-950/10">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Ready</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-emerald-700 dark:text-emerald-300">{stats.inService}</p>
          <span className="text-[11px] text-emerald-600/80 dark:text-emerald-400/80">In-service front-line</span>
        </div>

        <div className="rounded-2xl border border-amber-100 bg-amber-50/30 p-4 shadow-sm dark:border-amber-950/40 dark:bg-amber-950/10">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">In Shop</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
              <Wrench className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-amber-700 dark:text-amber-300">{stats.inShop}</p>
          <span className="text-[11px] text-amber-600/80 dark:text-amber-400/80">Under service/repair</span>
        </div>

        <div className="rounded-2xl border border-rose-100 bg-rose-50/30 p-4 shadow-sm dark:border-rose-950/40 dark:bg-rose-950/10">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">Out of Service</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-rose-700 dark:text-rose-300">{stats.outOfService}</p>
          <span className="text-[11px] text-rose-600/80 dark:text-rose-400/80">Down for defects</span>
        </div>

        <div className="col-span-2 sm:col-span-4 lg:col-span-1 rounded-2xl border border-sky-100 bg-sky-50/30 p-4 shadow-sm dark:border-sky-950/40 dark:bg-sky-950/10">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-sky-600 dark:text-sky-400">Reserve</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">
              <Layers className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-sky-700 dark:text-sky-300">{stats.reserve}</p>
          <span className="text-[11px] text-sky-600/80 dark:text-sky-400/80">Backup readiness</span>
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, call sign, make, VIN, station…"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-4 py-2 text-sm text-slate-900 outline-none transition focus:border-red-500 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-red-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <Filter className="h-3.5 w-3.5" />
            <span>Type:</span>
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="all">All Types</option>
            {dynamicApparatusTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 ml-1">
            <span>Status:</span>
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="all">All Statuses</option>
            {APPARATUS_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Content: Loading, Empty, or Cards Grid */}
      {loading && apparatusList.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin text-red-600" />
          <span className="ml-3 text-sm font-medium">Loading apparatus fleet…</span>
        </div>
      ) : filteredList.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center dark:border-slate-800 dark:bg-slate-900">
          <Truck className="mx-auto h-12 w-12 text-slate-300 dark:text-slate-600" />
          <h3 className="mt-3 text-base font-semibold text-slate-900 dark:text-white">
            {apparatusList.length === 0 ? 'No apparatus records found' : 'No matching apparatuses'}
          </h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
            {apparatusList.length === 0
              ? 'There are currently no vehicles recorded in the department fleet directory.'
              : 'Try clearing your search query or adjusting your filters to find what you are looking for.'}
          </p>
          {apparatusList.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setTypeFilter('all');
                setStatusFilter('all');
              }}
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {filteredList.map((item) => {
            const badge = apparatusStatusBadge(item.status);
            const serviceDue = evaluateServiceDue(item.next_service_due);
            const callsign = item.identifier || item.description;

            return (
              <div
                key={item.id}
                className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-slate-700 dark:bg-slate-800"
              >
                <div>
                  {/* Top Bar: Title, Identifier, Status Badge */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400">
                        <Truck className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {item.identifier && (
                            <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-800 dark:bg-slate-800 dark:text-slate-200 uppercase">
                              {item.identifier}
                            </span>
                          )}
                          <h3 className="font-semibold text-slate-900 dark:text-white truncate">
                            {item.description}
                          </h3>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                          <span className="font-medium text-slate-700 dark:text-slate-300">
                            {item.type}
                          </span>
                          {item.year && <span>• {item.year}</span>}
                          {item.make_model && <span>• {item.make_model}</span>}
                        </div>
                      </div>
                    </div>

                    <span
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${badge.dotClass}`} />
                      {badge.label}
                    </span>
                  </div>

                  {/* Specifications Grid */}
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-4 rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-700/80 dark:bg-slate-700/40">
                    <div>
                      <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                        Pump
                      </span>
                      <p className="mt-0.5 font-medium text-slate-800 dark:text-slate-200">
                        {item.pump_capacity || '—'}
                      </p>
                    </div>

                    <div>
                      <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                        Water Tank
                      </span>
                      <p className="mt-0.5 font-medium text-slate-800 dark:text-slate-200">
                        {item.tank_capacity || '—'}
                      </p>
                    </div>

                    <div>
                      <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                        Mileage
                      </span>
                      <p className="mt-0.5 font-medium text-slate-800 dark:text-slate-200">
                        {item.mileage || '—'}
                      </p>
                    </div>

                    <div>
                      <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                        Engine Hours
                      </span>
                      <p className="mt-0.5 font-medium text-slate-800 dark:text-slate-200">
                        {item.engine_hours || '—'}
                      </p>
                    </div>
                  </div>

                  {/* Details summary */}
                  <div className="mt-3 space-y-1.5 text-xs text-slate-500 dark:text-slate-400">
                    {item.station && (
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span>Station / Bay: <strong className="text-slate-700 dark:text-slate-200">{item.station}</strong></span>
                      </div>
                    )}

                    {item.next_service_due && (
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span>Next Service Due: <strong className="text-slate-700 dark:text-slate-200">{item.next_service_due}</strong></span>
                        {serviceDue && (
                          <span
                            className={`ml-1.5 rounded-full px-2 py-0.2 text-[10px] font-medium ${
                              serviceDue.status === 'overdue'
                                ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                                : serviceDue.status === 'due_soon'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {serviceDue.label}
                          </span>
                        )}
                      </div>
                    )}

                    {item.last_pump_test && (
                      <div className="flex items-center gap-1.5">
                        <Droplets className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span>Last Pump Test: <strong className="text-slate-700 dark:text-slate-200">{item.last_pump_test}</strong></span>
                      </div>
                    )}

                    {item.maintenance_records?.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <Wrench className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                        <span>
                          Maintenance:{' '}
                          <strong className="text-slate-700 dark:text-slate-200">
                            {item.maintenance_records.length} record{item.maintenance_records.length === 1 ? '' : 's'}
                          </strong>{' '}
                          ({formatCurrency(item.maintenance_records.reduce((sum, r) => sum + (Number(r.cost) || 0), 0))})
                        </span>
                      </div>
                    )}

                    {item.vin && (
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="font-mono text-[11px] text-slate-400">VIN: {item.vin}</span>
                        {item.license_plate && <span className="text-slate-400">• Plate: {item.license_plate}</span>}
                      </div>
                    )}

                    {item.notes && (
                      <p className="mt-2 text-xs italic text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800/80 pt-2 line-clamp-2">
                        "{item.notes}"
                      </p>
                    )}
                  </div>
                </div>

                {/* Read-only Action Footer */}
                <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
                  <span className="text-[11px] text-slate-400">
                    Callsign: <strong className="text-slate-600 dark:text-slate-300">{callsign}</strong>
                  </span>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenChecklist(item)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-2xs hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/50 transition"
                      title={`Start daily checklist for ${callsign}`}
                    >
                      <ClipboardCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>Checklist</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => openDetailsModal(item, 'maintenance')}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition"
                      title="View maintenance records and receipts"
                    >
                      <Wrench className="h-3.5 w-3.5 text-amber-500" />
                      <span>Maintenance ({item.maintenance_records?.length || 0})</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => openDetailsModal(item, 'details')}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-3.5 py-1.5 text-xs font-semibold shadow-xs hover:bg-slate-800 dark:hover:bg-slate-100 transition"
                      title="View complete apparatus specs and history"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>View Details</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Read-Only Inspection Modal */}
      {selectedApparatus && (
        <ViewportModal
          title={selectedApparatus.description}
          subtitle={
            selectedApparatus.identifier
              ? `Unit ${selectedApparatus.identifier} • ${selectedApparatus.type}`
              : selectedApparatus.type
          }
          icon={<Truck className="w-5 h-5 text-red-600" />}
          readOnly={true}
          size="large"
          onClose={closeDetailsModal}
        >
          <div className="space-y-6">
            {/* Modal Navigation Tabs: Details vs Maintenance */}
            <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-700 pb-2">
              <button
                type="button"
                onClick={() => setModalTab('details')}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition ${
                  modalTab === 'details'
                    ? 'bg-red-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <Truck className="h-4 w-4" />
                <span>Specifications &amp; Details</span>
              </button>

              <button
                type="button"
                onClick={() => setModalTab('maintenance')}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition ${
                  modalTab === 'maintenance'
                    ? 'bg-red-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <Wrench className="h-4 w-4" />
                <span>
                  Maintenance History ({selectedApparatus.maintenance_records?.length || 0})
                </span>
              </button>
            </div>

            {/* Tab 1: Specifications & Details */}
            {modalTab === 'details' && (
              <div className="space-y-5">
                {/* Header card with status */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700/80 dark:bg-slate-800/40">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400">
                      <Truck className="h-6 w-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        {selectedApparatus.identifier && (
                          <span className="rounded-md bg-slate-200 dark:bg-slate-700 px-2 py-0.5 font-mono text-xs font-extrabold uppercase text-slate-800 dark:text-slate-200">
                            {selectedApparatus.identifier}
                          </span>
                        )}
                        <h3 className="text-base font-bold text-slate-900 dark:text-white">
                          {selectedApparatus.description}
                        </h3>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {selectedApparatus.type} {selectedApparatus.year ? `• ${selectedApparatus.year}` : ''} {selectedApparatus.make_model ? `• ${selectedApparatus.make_model}` : ''}
                      </p>
                    </div>
                  </div>

                  <div>
                    {(() => {
                      const badge = apparatusStatusBadge(selectedApparatus.status);
                      return (
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${badge.className}`}>
                          <span className={`h-2 w-2 rounded-full ${badge.dotClass}`} />
                          {badge.label}
                        </span>
                      );
                    })()}
                  </div>
                </div>

                {/* Technical Specifications Grid */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Vehicle Specifications
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Pump Capacity</span>
                      <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {selectedApparatus.pump_capacity || 'Not specified'}
                      </p>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Water Tank</span>
                      <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {selectedApparatus.tank_capacity || 'Not specified'}
                      </p>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Last Pump Test</span>
                      <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {selectedApparatus.last_pump_test || 'None recorded'}
                      </p>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Odometer Mileage</span>
                      <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {selectedApparatus.mileage || 'None recorded'}
                      </p>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Engine Hours</span>
                      <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {selectedApparatus.engine_hours || 'None recorded'}
                      </p>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Station / Bay Assignment</span>
                      <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {selectedApparatus.station || 'Unassigned'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Identification and Service Due */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Registration &amp; Inspection Dates
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500 dark:text-slate-400">VIN Number:</span>
                        <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                          {selectedApparatus.vin || '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500 dark:text-slate-400">License Plate:</span>
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          {selectedApparatus.license_plate || '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500 dark:text-slate-400">Make &amp; Model:</span>
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          {selectedApparatus.make_model || '—'}
                        </span>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500 dark:text-slate-400">Last Service Date:</span>
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          {selectedApparatus.last_service_date || '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500 dark:text-slate-400">Next Service Due:</span>
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-slate-800 dark:text-slate-200">
                            {selectedApparatus.next_service_due || '—'}
                          </span>
                          {(() => {
                            const due = evaluateServiceDue(selectedApparatus.next_service_due);
                            if (!due) return null;
                            return (
                              <span
                                className={`rounded-full px-2 py-0.2 text-[10px] font-medium ${
                                  due.status === 'overdue'
                                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                                    : due.status === 'due_soon'
                                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                                }`}
                              >
                                {due.label}
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Notes */}
                {selectedApparatus.notes && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                      Operational Remarks &amp; Notes
                    </h4>
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                      {selectedApparatus.notes}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tab 2: Maintenance History */}
            {modalTab === 'maintenance' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Maintenance Records History
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Service logs, mechanical repairs, safety inspections, and attached invoices.
                    </p>
                  </div>

                  {selectedApparatus.maintenance_records?.length > 0 && (
                    <div className="text-right">
                      <span className="text-xs text-slate-400">Total Investment</span>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">
                        {formatCurrency(
                          selectedApparatus.maintenance_records.reduce(
                            (sum, r) => sum + (Number(r.cost) || 0),
                            0
                          )
                        )}
                      </p>
                    </div>
                  )}
                </div>

                {!selectedApparatus.maintenance_records ||
                selectedApparatus.maintenance_records.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-10 text-center dark:border-slate-800 dark:bg-slate-900/40">
                    <Wrench className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
                    <p className="mt-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                      No maintenance records logged yet
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      There are currently no maintenance work logs or repair invoices on file for this vehicle.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selectedApparatus.maintenance_records.map((rec) => {
                      const typeMeta = maintenanceTypeMeta(rec.type);
                      return (
                        <div
                          key={rec.id}
                          className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700/80 dark:bg-slate-800/80 space-y-2.5"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-bold text-sm text-slate-900 dark:text-white">
                                  {formatCurrency(rec.cost)}
                                </span>
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                                  {typeMeta.label}
                                </span>
                                <span className="text-xs text-slate-400 flex items-center gap-1">
                                  <Calendar className="w-3 h-3 text-slate-400" />
                                  {rec.date}
                                </span>
                              </div>
                              <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
                                {rec.description}
                              </p>
                              {rec.recorded_by_name && (
                                <p className="text-[11px] text-slate-400">
                                  Recorded by {rec.recorded_by_name}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Attached files */}
                          {rec.files && rec.files.length > 0 && (
                            <div className="border-t border-slate-100 pt-2.5 dark:border-slate-700/60">
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block mb-1.5">
                                Attached Documents &amp; Receipts ({rec.files.length})
                              </span>
                              <div className="space-y-1.5">
                                {rec.files.map((file, idx) => (
                                  <div
                                    key={file.fileId || idx}
                                    className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800/60"
                                  >
                                    <div className="flex items-center gap-2 truncate">
                                      <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                      <span className="truncate font-medium text-slate-800 dark:text-slate-200">
                                        {file.name}
                                      </span>
                                      <span className="text-[11px] text-slate-400">
                                        ({formatFileSize(file.size)})
                                      </span>
                                    </div>

                                    <button
                                      type="button"
                                      onClick={() => openApparatusMaintenanceFile(file)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-600 transition shrink-0 ml-2"
                                      title="Open and view attachment"
                                    >
                                      <Eye className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                                      <span>View</span>
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </ViewportModal>
      )}

      {/* Apparatus Daily Checklist Modal */}
      {checklistModalOpen && (
        <TaskNoteEntryModal
          entry={activeChecklistEntry}
          template={activeChecklistTemplate}
          templates={taskNoteTemplates}
          currentUser={currentUser}
          canEdit={true}
          canUnsign={false}
          canDelete={false}
          apparatusList={apparatusList}
          departmentName={departmentName}
          departmentLogoUrl={departmentLogoUrl}
          onClose={() => {
            setChecklistModalOpen(false);
            setActiveChecklistTemplate(null);
            setActiveChecklistEntry(null);
          }}
          onSaved={() => {
            toast.success('Apparatus checklist saved successfully.');
          }}
        />
      )}
    </div>
  );
}
