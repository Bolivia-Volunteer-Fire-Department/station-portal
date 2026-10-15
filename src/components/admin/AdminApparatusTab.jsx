import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Truck,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Search,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Filter,
  Layers,
  Calendar,
  Gauge,
  Droplets,
  MapPin,
  FileText,
  RotateCw,
  Wrench,
  ShieldAlert,
} from 'lucide-react';
import {
  adminSaveApparatus,
  adminDeleteApparatus,
  fetchApparatus,
  fetchAssetTypes,
} from '../../services/api';
import {
  APPARATUS_TYPES,
  APPARATUS_STATUSES,
  apparatusStatusBadge,
  evaluateServiceDue,
  normalizeApparatusRecord,
} from '../../utils/apparatus';
import ConfirmModal from '../ConfirmModal';
import ViewportModal from '../ViewportModal';

const APPARATUS_FORM_ID = 'apparatus-editor-form';

const EMPTY_FORM = {
  id: '',
  description: '',
  type: 'Engine',
  identifier: '',
  make_model: '',
  year: '',
  vin: '',
  license_plate: '',
  status: 'in_service',
  station: '',
  pump_capacity: '',
  tank_capacity: '',
  mileage: '',
  engine_hours: '',
  last_service_date: '',
  next_service_due: '',
  last_pump_test: '',
  notes: '',
};

export default function AdminApparatusTab({ token, onDataChanged }) {
  const [apparatusList, setApparatusList] = useState([]);
  const [assetTypes, setAssetTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const [formData, setFormData] = useState(EMPTY_FORM);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState(null);

  // Load apparatus records and configured asset types from backend
  const loadApparatus = useCallback(async () => {
    setLoading(true);
    try {
      const [response, typesRes] = await Promise.all([
        fetchApparatus(token),
        fetchAssetTypes(token).catch(() => null),
      ]);
      if (response?.apparatus) {
        setApparatusList(response.apparatus.map(normalizeApparatusRecord));
      }
      if (typesRes?.assetTypes) {
        setAssetTypes(typesRes.assetTypes);
      }
    } catch (err) {
      console.warn('Failed to load apparatus records:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadApparatus();
  }, [loadApparatus]);

  const dynamicApparatusTypes = useMemo(() => {
    const custom = assetTypes.filter((t) => t.category === 'apparatus');
    if (custom.length > 0) {
      return custom.map((t) => ({ value: t.value || t.label, label: t.label }));
    }
    return APPARATUS_TYPES;
  }, [assetTypes]);

  const resetForm = () => {
    setFormData(EMPTY_FORM);
    setEditorOpen(false);
    setError(null);
  };

  const startNew = () => {
    setFormData({
      ...EMPTY_FORM,
      id: crypto.randomUUID ? crypto.randomUUID() : `app_${Date.now()}`,
    });
    setEditorOpen(true);
    setError(null);
  };

  const startEdit = (item) => {
    setFormData({
      ...EMPTY_FORM,
      ...item,
    });
    setEditorOpen(true);
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.description.trim()) {
      setError('Description / Apparatus Name is required.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const cleanData = {};
      Object.entries(formData).forEach(([k, v]) => {
        if (v !== undefined) {
          cleanData[k] = typeof v === 'string' ? v.trim() : v;
        }
      });
      cleanData.id = formData.id || (crypto.randomUUID ? crypto.randomUUID() : `app_${Date.now()}`);
      cleanData.description = formData.description.trim();
      cleanData.type = formData.type || 'Other';

      const result = await adminSaveApparatus(cleanData, token);
      if (result && result.success === false) {
        throw new Error(result.error || 'Failed to save apparatus.');
      }

      await loadApparatus();
      if (typeof onDataChanged === 'function') {
        onDataChanged();
      }
      resetForm();
    } catch (err) {
      setError(err?.message || 'Error saving apparatus record.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeletingId(pendingDelete.id);
    try {
      const result = await adminDeleteApparatus(pendingDelete.id, token);
      if (result && result.success === false) {
        throw new Error(result.error || 'Failed to delete apparatus.');
      }
      await loadApparatus();
      if (typeof onDataChanged === 'function') {
        onDataChanged();
      }
      setPendingDelete(null);
    } catch (err) {
      console.error('Failed to delete apparatus:', err);
      alert(err?.message || 'Failed to delete apparatus.');
    } finally {
      setDeletingId(null);
    }
  };

  // Filtered apparatus list
  const filteredList = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return apparatusList.filter((item) => {
      if (typeFilter !== 'all' && item.type !== typeFilter) {
        return false;
      }
      if (statusFilter !== 'all' && item.status !== statusFilter) {
        return false;
      }
      if (!q) return true;

      return (
        item.description.toLowerCase().includes(q) ||
        item.type.toLowerCase().includes(q) ||
        (item.identifier && item.identifier.toLowerCase().includes(q)) ||
        (item.make_model && item.make_model.toLowerCase().includes(q)) ||
        (item.station && item.station.toLowerCase().includes(q)) ||
        (item.vin && item.vin.toLowerCase().includes(q)) ||
        (item.license_plate && item.license_plate.toLowerCase().includes(q))
      );
    });
  }, [apparatusList, searchQuery, typeFilter, statusFilter]);

  // KPI counts
  const kpis = useMemo(() => {
    let inService = 0;
    let inShop = 0;
    let outOfService = 0;
    let reserve = 0;
    let retired = 0;

    apparatusList.forEach((item) => {
      const s = String(item.status || 'in_service').toLowerCase();
      if (s === 'in_service') inService++;
      else if (s === 'in_shop') inShop++;
      else if (s === 'out_of_service') outOfService++;
      else if (s === 'reserve') reserve++;
      else if (s === 'retired') retired++;
      else inService++;
    });

    return {
      total: apparatusList.length,
      inService,
      inShop,
      outOfService,
      reserve,
      retired,
    };
  }, [apparatusList]);

  return (
    <div className="space-y-6">
      {/* Header & New Button */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Truck className="h-6 w-6 text-red-600" />
            <span>Apparatuses</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Track fire department fleet vehicles, pump and tank specs, in-service status, and maintenance deadlines.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadApparatus}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            title="Refresh apparatus records"
          >
            <RotateCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button
            type="button"
            onClick={startNew}
            className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-red-500"
          >
            <Plus className="h-4 w-4" />
            <span>Add Apparatus</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Fleet</span>
            <Truck className="h-4 w-4 text-slate-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">{kpis.total}</p>
          <p className="mt-1 text-xs text-slate-400">Registered apparatuses</p>
        </div>

        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4 shadow-sm dark:border-emerald-950/60 dark:bg-emerald-950/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-emerald-800 dark:text-emerald-300">In Service</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-emerald-900 dark:text-emerald-200">{kpis.inService}</p>
          <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">Front-line emergency ready</p>
        </div>

        <div className="rounded-2xl border border-amber-100 bg-amber-50/50 p-4 shadow-sm dark:border-amber-950/60 dark:bg-amber-950/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-amber-800 dark:text-amber-300">In Shop / Maint</span>
            <Wrench className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-amber-900 dark:text-amber-200">{kpis.inShop}</p>
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Routine service / repairs</p>
        </div>

        <div className="rounded-2xl border border-rose-100 bg-rose-50/50 p-4 shadow-sm dark:border-rose-950/60 dark:bg-rose-950/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-rose-800 dark:text-rose-300">Out of Service</span>
            <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-rose-900 dark:text-rose-200">{kpis.outOfService}</p>
          <p className="mt-1 text-xs text-rose-700 dark:text-rose-400">Unavailable for dispatch</p>
        </div>
      </div>

      {/* Search and Filters */}
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

      {/* Main Content List / Cards */}
      {loading ? (
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
              ? 'Start building your department fleet directory by adding your first engine, truck, rescue, or brush unit.'
              : 'Try clearing your search query or adjusting your filters to find what you are looking for.'}
          </p>
          {apparatusList.length === 0 ? (
            <button
              type="button"
              onClick={startNew}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-500"
            >
              <Plus className="h-4 w-4" />
              <span>Add First Apparatus</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setTypeFilter('all');
                setStatusFilter('all');
              }}
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
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

            return (
              <div
                key={item.id}
                className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-slate-700 dark:bg-slate-800"
              >
                <div>
                  {/* Top Bar: Title, Identifier, Status Badge */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400">
                        <Truck className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          {item.identifier && (
                            <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                              {item.identifier}
                            </span>
                          )}
                          <h3 className="font-semibold text-slate-900 dark:text-white">
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

                  {/* Details row: Station, VIN, Next Service */}
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

                {/* Card Action Footer */}
                <div className="mt-5 flex items-center justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => startEdit(item)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    <Pencil className="h-3.5 w-3.5 text-slate-400" />
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(item)}
                    disabled={deletingId === item.id}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:border-slate-700 dark:text-rose-400 dark:hover:bg-rose-950/40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Delete</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Apparatus Modal */}
      {editorOpen && (
        <ViewportModal
          title={formData.id && apparatusList.some((a) => a.id === formData.id) ? 'Edit Apparatus' : 'Add Apparatus'}
          subtitle={formData.description ? `${formData.description} (${formData.type})` : 'Register a fire department fleet vehicle'}
          icon={<Truck className="h-4 w-4 text-red-600" />}
          formId={APPARATUS_FORM_ID}
          saveLabel={formData.id && apparatusList.some((a) => a.id === formData.id) ? 'Save Changes' : 'Save Apparatus'}
          saving={saving}
          onClose={resetForm}
        >
          <form id={APPARATUS_FORM_ID} onSubmit={handleSubmit} className="space-y-4 text-sm">
            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300">
                {error}
              </div>
            )}

            {/* Basic Identification */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                Basic Identification
              </h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Apparatus Name / Description *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Old Brush Truck, Engine 1, Tower 3"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Apparatus Type *
                  </label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    {dynamicApparatusTypes.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mt-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Unit Identifier / Radio Call Sign
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Brush 4, E-1, Squad 2"
                    value={formData.identifier}
                    onChange={(e) => setFormData({ ...formData, identifier: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Operational Status
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    {APPARATUS_STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Station / Bay Location
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Station 1, Bay 2"
                    value={formData.station}
                    onChange={(e) => setFormData({ ...formData, station: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>
            </div>

            {/* Vehicle Specifications */}
            <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                Vehicle Specifications
              </h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Make & Model / Chassis
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Pierce Enforcer, Ford F-550, Seagrave"
                    value={formData.make_model}
                    onChange={(e) => setFormData({ ...formData, make_model: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Model Year
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 2018"
                    value={formData.year}
                    onChange={(e) => setFormData({ ...formData, year: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mt-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    VIN (Vehicle Identification Number)
                  </label>
                  <input
                    type="text"
                    placeholder="17-character VIN"
                    value={formData.vin}
                    onChange={(e) => setFormData({ ...formData, vin: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white font-mono text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    License Plate / State Tag
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. MG-8492"
                    value={formData.license_plate}
                    onChange={(e) => setFormData({ ...formData, license_plate: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>
            </div>

            {/* Firefighting Capabilities */}
            <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                Fire Capabilities & Capacities
              </h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Pump Capacity
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 1500 GPM, 250 GPM portable"
                    value={formData.pump_capacity}
                    onChange={(e) => setFormData({ ...formData, pump_capacity: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Water Tank Capacity
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 750 Gal, 3000 Gal, 300 Gal"
                    value={formData.tank_capacity}
                    onChange={(e) => setFormData({ ...formData, tank_capacity: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>
            </div>

            {/* Usage & Maintenance Tracking */}
            <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                Maintenance & Usage Tracking
              </h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Current Mileage (Odometer)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 24,150 miles"
                    value={formData.mileage}
                    onChange={(e) => setFormData({ ...formData, mileage: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Engine Run Hours
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 2,150 hrs"
                    value={formData.engine_hours}
                    onChange={(e) => setFormData({ ...formData, engine_hours: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mt-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Next Service Due Date
                  </label>
                  <input
                    type="date"
                    value={formData.next_service_due}
                    onChange={(e) => setFormData({ ...formData, next_service_due: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Last Service Date
                  </label>
                  <input
                    type="date"
                    value={formData.last_service_date}
                    onChange={(e) => setFormData({ ...formData, last_service_date: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Last Annual Pump Test
                  </label>
                  <input
                    type="date"
                    value={formData.last_pump_test}
                    onChange={(e) => setFormData({ ...formData, last_pump_test: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Notes & Equipment Cache
              </label>
              <textarea
                rows={3}
                placeholder="Specialized tools, hose compliment, known mechanical quirks, or service history notes…"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            {/* Bottom action row */}
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
              <button
                type="button"
                onClick={resetForm}
                disabled={saving}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-500 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>{formData.id && apparatusList.some((a) => a.id === formData.id) ? 'Save Changes' : 'Save Apparatus'}</span>
              </button>
            </div>
          </form>
        </ViewportModal>
      )}

      {/* Delete Confirmation Modal */}
      {pendingDelete && (
        <ConfirmModal
          title="Delete Apparatus"
          message={`Are you sure you want to remove "${pendingDelete.description}" from the apparatus registry? This will permanently delete this apparatus record.`}
          confirmLabel="Delete Apparatus"
          confirmKind="danger"
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

