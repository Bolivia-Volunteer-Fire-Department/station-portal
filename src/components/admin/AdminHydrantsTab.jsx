import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Droplets,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Search,
  AlertTriangle,
  CheckCircle2,
  RotateCw,
  MapPin,
  Upload,
  Gauge,
  Activity,
  Layers,
  X,
} from 'lucide-react';
import {
  fetchHydrants,
  adminSaveHydrant,
  adminDeleteHydrant,
} from '../../services/api';
import {
  normalizeHydrant,
  getHydrantNfpaClass,
  HYDRANT_STATUSES,
  HYDRANT_TYPES,
} from '../../utils/preIncidentPlans';
import ConfirmModal from '../ConfirmModal';
import ViewportModal from '../ViewportModal';
import AdminHydrantImportModal from './AdminHydrantImportModal';

const HYDRANT_FORM_ID = 'hydrant-editor-form';

const EMPTY_FORM = {
  id: '',
  hydrant_id: '',
  address: '',
  district: '',
  status: 'in-service',
  type: 'dry',
  latitude: '',
  longitude: '',
  calculated_gpm_20psi: '',
  calculated_gpm: '',
  static_pressure_psi: '',
  residual_pressure_psi: '',
  pitot_pressure_psi: '',
  last_tested_date: '',
  tested_by: '',
  agency_name: '',
  notes: '',
};

export default function AdminHydrantsTab({
  token,
  onDataChanged,
}) {
  const [hydrants, setHydrants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [classFilter, setClassFilter] = useState('all');
  const [districtFilter, setDistrictFilter] = useState('all');

  const [editorOpen, setEditorOpen] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [pendingDelete, setPendingDelete] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const [importModalOpen, setImportModalOpen] = useState(false);

  // Fetch all hydrants
  const loadHydrants = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchHydrants();
      const list = Array.isArray(res?.hydrants) ? res.hydrants : [];
      setHydrants(list.map((h) => normalizeHydrant(h)));
    } catch (err) {
      console.error('Failed to load hydrants:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHydrants();
  }, [loadHydrants]);

  // Unique list of districts for the filter dropdown
  const districtOptions = useMemo(() => {
    const set = new Set();
    hydrants.forEach((h) => {
      if (h.district && String(h.district).trim()) {
        set.add(String(h.district).trim());
      }
    });
    return Array.from(set).sort();
  }, [hydrants]);

  // Filtered hydrants list
  const filteredHydrants = useMemo(() => {
    return hydrants.filter((h) => {
      // Status filter
      if (statusFilter !== 'all' && h.status !== statusFilter) return false;

      // NFPA Class filter
      if (classFilter !== 'all') {
        const nfpa = getHydrantNfpaClass(h.calculated_gpm_20psi || h.flow);
        if (classFilter === 'unrated') {
          if (nfpa.shortClass !== 'Unrated') return false;
        } else if (nfpa.shortClass !== classFilter) {
          return false;
        }
      }

      // District filter
      if (districtFilter !== 'all') {
        if (String(h.district || '').trim() !== districtFilter) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const idMatch = (h.id || h.hydrant_id || '').toLowerCase().includes(q);
        const addrMatch = (h.address || '').toLowerCase().includes(q);
        const distMatch = (h.district || '').toLowerCase().includes(q);
        const testerMatch = (h.tested_by || '').toLowerCase().includes(q);
        const agencyMatch = (h.agency_name || '').toLowerCase().includes(q);
        if (!idMatch && !addrMatch && !distMatch && !testerMatch && !agencyMatch) {
          return false;
        }
      }

      return true;
    });
  }, [hydrants, statusFilter, classFilter, districtFilter, searchQuery]);

  // Summary statistics
  const stats = useMemo(() => {
    const total = hydrants.length;
    let inService = 0;
    let outOfService = 0;
    let ratedCount = 0;
    const classCounts = {
      'Class AA': 0,
      'Class A': 0,
      'Class B': 0,
      'Class C': 0,
      Unrated: 0,
    };

    hydrants.forEach((h) => {
      if (h.status === 'out-of-service') {
        outOfService += 1;
      } else {
        inService += 1;
      }
      const nfpa = getHydrantNfpaClass(h.calculated_gpm_20psi || h.flow);
      if (nfpa.shortClass !== 'Unrated') {
        ratedCount += 1;
      }
      classCounts[nfpa.shortClass] = (classCounts[nfpa.shortClass] || 0) + 1;
    });

    return {
      total,
      inService,
      outOfService,
      ratedCount,
      ratedPercent: total > 0 ? Math.round((ratedCount / total) * 100) : 0,
      classCounts,
    };
  }, [hydrants]);

  // Start creating a new hydrant
  const startAdd = () => {
    setFormData(EMPTY_FORM);
    setError('');
    setEditorOpen(true);
  };

  // Start editing an existing hydrant
  const startEdit = (h) => {
    setFormData({
      id: h.id || h.hydrant_id || '',
      hydrant_id: h.hydrant_id || h.id || '',
      address: h.address || '',
      district: h.district || '',
      status: h.status || 'in-service',
      type: h.type || 'dry',
      latitude: h.latitude !== null && h.latitude !== undefined ? String(h.latitude) : '',
      longitude: h.longitude !== null && h.longitude !== undefined ? String(h.longitude) : '',
      calculated_gpm_20psi: h.calculated_gpm_20psi !== null && h.calculated_gpm_20psi !== undefined ? String(h.calculated_gpm_20psi) : '',
      calculated_gpm: h.calculated_gpm !== null && h.calculated_gpm !== undefined ? String(h.calculated_gpm) : '',
      static_pressure_psi: h.static_pressure_psi !== null && h.static_pressure_psi !== undefined ? String(h.static_pressure_psi) : '',
      residual_pressure_psi: h.residual_pressure_psi !== null && h.residual_pressure_psi !== undefined ? String(h.residual_pressure_psi) : '',
      pitot_pressure_psi: h.pitot_pressure_psi !== null && h.pitot_pressure_psi !== undefined ? String(h.pitot_pressure_psi) : '',
      last_tested_date: h.last_tested_date || '',
      tested_by: h.tested_by || '',
      agency_name: h.agency_name || '',
      notes: h.notes || '',
    });
    setError('');
    setEditorOpen(true);
  };

  const resetForm = () => {
    setFormData(EMPTY_FORM);
    setError('');
    setEditorOpen(false);
  };

  // Save hydrant
  const handleSubmit = async (e) => {
    e.preventDefault();
    const tag = (formData.hydrant_id || formData.id || '').trim();
    if (!tag) {
      setError('Hydrant ID is required.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const payload = {
        id: tag,
        hydrant_id: tag,
        address: formData.address.trim(),
        district: formData.district.trim(),
        status: formData.status,
        type: formData.type,
        latitude: formData.latitude !== '' ? Number(formData.latitude) : null,
        longitude: formData.longitude !== '' ? Number(formData.longitude) : null,
        calculated_gpm_20psi: formData.calculated_gpm_20psi !== '' ? Number(formData.calculated_gpm_20psi) : null,
        flow: formData.calculated_gpm_20psi !== '' ? Number(formData.calculated_gpm_20psi) : null,
        calculated_gpm: formData.calculated_gpm !== '' ? Number(formData.calculated_gpm) : null,
        static_pressure_psi: formData.static_pressure_psi !== '' ? Number(formData.static_pressure_psi) : null,
        residual_pressure_psi: formData.residual_pressure_psi !== '' ? Number(formData.residual_pressure_psi) : null,
        pitot_pressure_psi: formData.pitot_pressure_psi !== '' ? Number(formData.pitot_pressure_psi) : null,
        last_tested_date: formData.last_tested_date.trim(),
        tested_by: formData.tested_by.trim(),
        agency_name: formData.agency_name.trim(),
        notes: formData.notes.trim(),
      };

      await adminSaveHydrant({ id: tag, fields: payload }, token);
      resetForm();
      await loadHydrants();
      onDataChanged?.();
    } catch (err) {
      console.error('Failed to save hydrant:', err);
      setError(err?.message || 'Failed to save hydrant. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Delete hydrant
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const targetId = pendingDelete.hydrant_id || pendingDelete.id;
    setDeletingId(targetId);
    try {
      await adminDeleteHydrant(targetId, token);
      setPendingDelete(null);
      await loadHydrants();
      onDataChanged?.();
    } catch (err) {
      console.error('Failed to delete hydrant:', err);
      alert(err?.message || 'Failed to delete hydrant.');
    } finally {
      setDeletingId(null);
    }
  };

  // Current form NFPA rating preview
  const liveNfpa = useMemo(() => {
    return getHydrantNfpaClass(formData.calculated_gpm_20psi);
  }, [formData.calculated_gpm_20psi]);

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Droplets className="h-6 w-6 text-cyan-600 dark:text-cyan-400" />
            <span>Hydrant Management</span>
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Track municipal & private fire hydrants, NFPA 291 flow tests, static/residual pressures, and sync with Pre-Incident Plans and the District Map.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadHydrants}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            title="Refresh hydrants"
          >
            <RotateCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={() => setImportModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-200 bg-cyan-50 px-3.5 py-2 text-xs font-semibold text-cyan-700 shadow-sm hover:bg-cyan-100 dark:border-cyan-900/50 dark:bg-cyan-950/60 dark:text-cyan-300 dark:hover:bg-cyan-900/50"
          >
            <Upload className="h-4 w-4" />
            <span>Import CSV</span>
          </button>

          <button
            type="button"
            onClick={startAdd}
            className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-cyan-500"
          >
            <Plus className="h-4 w-4" />
            <span>Add Hydrant</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Hydrants</span>
            <Droplets className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">{stats.total}</div>
          <div className="mt-1 text-[11px] text-slate-400">In district inventory</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">In Service</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.inService}</div>
          <div className="mt-1 text-[11px] text-slate-400">
            {stats.outOfService > 0 ? (
              <span className="text-rose-500 font-medium">{stats.outOfService} out of service</span>
            ) : (
              '100% operational'
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Flow Tested</span>
            <Activity className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.ratedCount}</div>
          <div className="mt-1 text-[11px] text-slate-400">{stats.ratedPercent}% rated @ 20 PSI</div>
        </div>

        <div className="col-span-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">NFPA 291 Ratings</span>
            <Gauge className="h-4 w-4 text-indigo-500" />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 py-0.5 font-medium text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/50 dark:text-blue-300">
              <span className="h-2 w-2 rounded-full bg-blue-500"></span>
              AA: {stats.classCounts['Class AA']}
            </span>
            <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
              A: {stats.classCounts['Class A']}
            </span>
            <span className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-0.5 font-medium text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-300">
              <span className="h-2 w-2 rounded-full bg-amber-500"></span>
              B: {stats.classCounts['Class B']}
            </span>
            <span className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-0.5 font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
              <span className="h-2 w-2 rounded-full bg-red-500"></span>
              C: {stats.classCounts['Class C']}
            </span>
            {stats.classCounts['Unrated'] > 0 && (
              <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-400">
                Unrated: {stats.classCounts['Unrated']}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by Hydrant ID, location, district, or tester…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-8 text-xs text-slate-900 placeholder-slate-400 focus:border-cyan-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-slate-500"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            <option value="all">All Statuses</option>
            <option value="in-service">In Service</option>
            <option value="out-of-service">Out of Service</option>
          </select>

          {/* NFPA Class filter */}
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            <option value="all">All Flow Classes</option>
            <option value="Class AA">Class AA (1,500+ GPM)</option>
            <option value="Class A">Class A (1,000–1,499 GPM)</option>
            <option value="Class B">Class B (500–999 GPM)</option>
            <option value="Class C">Class C (&lt;500 GPM)</option>
            <option value="unrated">Unrated</option>
          </select>

          {/* District filter */}
          {districtOptions.length > 0 && (
            <select
              value={districtFilter}
              onChange={(e) => setDistrictFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              <option value="all">All Districts</option>
              {districtOptions.map((dist) => (
                <option key={dist} value={dist}>
                  District {dist}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Hydrants Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin text-cyan-600" />
            <span className="ml-3 text-sm font-medium">Loading hydrant records…</span>
          </div>
        ) : filteredHydrants.length === 0 ? (
          <div className="py-16 text-center text-slate-500 dark:text-slate-400">
            <Droplets className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
            <p className="mt-2 text-sm font-medium">No hydrants found.</p>
            <p className="text-xs">
              {searchQuery || statusFilter !== 'all' || classFilter !== 'all' || districtFilter !== 'all'
                ? 'Try clearing your filters or search query.'
                : 'Import your hydrant flow CSV or click "Add Hydrant" to start.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
              <thead className="border-b border-slate-200 bg-slate-50/70 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-semibold">Hydrant ID</th>
                  <th className="px-4 py-3 font-semibold">Location / District</th>
                  <th className="px-4 py-3 font-semibold">NFPA 291 Rating</th>
                  <th className="px-4 py-3 font-semibold">Test Pressures</th>
                  <th className="px-4 py-3 font-semibold">Last Tested</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Coordinates</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredHydrants.map((h) => {
                  const tag = h.hydrant_id || h.id;
                  const flow = h.calculated_gpm_20psi || h.flow;
                  const nfpa = getHydrantNfpaClass(flow);
                  const hasCoords = Number.isFinite(h.latitude) && Number.isFinite(h.longitude);

                  return (
                    <tr key={tag} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                      {/* Hydrant ID */}
                      <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center justify-center rounded-lg bg-cyan-100/70 px-2 py-0.5 font-mono text-xs font-bold text-cyan-800 dark:bg-cyan-950/80 dark:text-cyan-300">
                            {tag}
                          </span>
                          {h.type === 'wet' && (
                            <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                              Wet
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Location & District */}
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800 dark:text-slate-200">
                          {h.address || '—'}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          {h.district && <span>District {h.district}</span>}
                          {h.agency_name && <span>• {h.agency_name}</span>}
                        </div>
                      </td>

                      {/* NFPA Flow Rating */}
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${nfpa.badgeClass}`}>
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: nfpa.hex }}
                          ></span>
                          {nfpa.shortClass}
                        </span>
                        {Number.isFinite(Number(flow)) && Number(flow) > 0 && (
                          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            {Math.round(Number(flow)).toLocaleString()} GPM @ 20 PSI
                          </div>
                        )}
                      </td>

                      {/* Test Pressures (Static / Residual / Pitot) */}
                      <td className="px-4 py-3 text-xs">
                        {h.static_pressure_psi !== null || h.residual_pressure_psi !== null || h.pitot_pressure_psi !== null ? (
                          <div className="space-y-0.5">
                            <div>
                              <span className="text-slate-400">Static:</span>{' '}
                              <span className="font-medium text-slate-700 dark:text-slate-300">
                                {h.static_pressure_psi !== null ? `${h.static_pressure_psi} psi` : '—'}
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-400">Residual:</span>{' '}
                              <span className="font-medium text-slate-700 dark:text-slate-300">
                                {h.residual_pressure_psi !== null ? `${h.residual_pressure_psi} psi` : '—'}
                              </span>
                            </div>
                            {h.pitot_pressure_psi !== null && (
                              <div>
                                <span className="text-slate-400">Pitot:</span>{' '}
                                <span className="font-medium text-slate-700 dark:text-slate-300">
                                  {h.pitot_pressure_psi} psi
                                </span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* Last Tested */}
                      <td className="px-4 py-3 text-xs">
                        <div className="font-medium text-slate-700 dark:text-slate-300">
                          {h.last_tested_date || '—'}
                        </div>
                        {h.tested_by && (
                          <div className="text-[11px] text-slate-400">By {h.tested_by}</div>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        {h.status === 'out-of-service' ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300">
                            Out of Service
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300">
                            In Service
                          </span>
                        )}
                      </td>

                      {/* Coordinates */}
                      <td className="px-4 py-3 text-xs">
                        {hasCoords ? (
                          <span
                            className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300"
                            title={`${h.latitude}, ${h.longitude}`}
                          >
                            <MapPin className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
                            <span>
                              {h.latitude.toFixed(4)}, {h.longitude.toFixed(4)}
                            </span>
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">No GPS</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => startEdit(h)}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                            title="Edit Hydrant"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDelete(h)}
                            disabled={deletingId === tag}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:text-slate-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                            title="Delete Hydrant"
                          >
                            {deletingId === tag ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Hydrant Modal */}
      {editorOpen && (
        <ViewportModal
          title={formData.id ? `Edit Hydrant: ${formData.id}` : 'Add Hydrant'}
          subtitle={formData.id ? 'Update location, pressures, and flow ratings' : 'Register a new municipal or private fire hydrant'}
          icon={<Droplets className="h-4 w-4 text-cyan-600" />}
          formId={HYDRANT_FORM_ID}
          saveLabel={formData.id ? 'Save Changes' : 'Save Hydrant'}
          saving={saving}
          onClose={resetForm}
        >
          <form id={HYDRANT_FORM_ID} onSubmit={handleSubmit} className="space-y-4 text-sm">
            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300">
                {error}
              </div>
            )}

            {/* General Identification */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Hydrant ID *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. HYD-337"
                  value={formData.hydrant_id}
                  onChange={(e) => setFormData({ ...formData, hydrant_id: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  District / Section
                </label>
                <input
                  type="text"
                  placeholder="e.g. 1"
                  value={formData.district}
                  onChange={(e) => setFormData({ ...formData, district: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Status
                </label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  {HYDRANT_STATUSES.map((st) => (
                    <option key={st.value} value={st.value}>
                      {st.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Address / Physical Location
                </label>
                <input
                  type="text"
                  placeholder="e.g. 4455 E Ocean Hwy"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Hydrant Type
                </label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  {HYDRANT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* GPS Coordinates */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 mb-2">
                <MapPin className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
                <span>Geographic Position (District Map sync)</span>
              </span>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    Latitude
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="e.g. 33.987654"
                    value={formData.latitude}
                    onChange={(e) => setFormData({ ...formData, latitude: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    Longitude
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="e.g. -78.123456"
                    value={formData.longitude}
                    onChange={(e) => setFormData({ ...formData, longitude: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>
            </div>

            {/* Test & Flow Details */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Gauge className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  <span>Flow Test &amp; Pressure Data</span>
                </span>
                {liveNfpa.shortClass !== 'Unrated' && (
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${liveNfpa.badgeClass}`}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: liveNfpa.hex }}></span>
                    {liveNfpa.classLabel}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    Static Pressure (PSI)
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="e.g. 62"
                    value={formData.static_pressure_psi}
                    onChange={(e) => setFormData({ ...formData, static_pressure_psi: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    Residual Pressure (PSI)
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="e.g. 52"
                    value={formData.residual_pressure_psi}
                    onChange={(e) => setFormData({ ...formData, residual_pressure_psi: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    Pitot Pressure (PSI)
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="e.g. 40"
                    value={formData.pitot_pressure_psi}
                    onChange={(e) => setFormData({ ...formData, pitot_pressure_psi: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    Test Calculated GPM
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="e.g. 1007.1"
                    value={formData.calculated_gpm}
                    onChange={(e) => setFormData({ ...formData, calculated_gpm: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 mt-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                    Calculated GPM @ 20 PSI (Fire Flow)
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="e.g. 2129"
                    value={formData.calculated_gpm_20psi}
                    onChange={(e) => setFormData({ ...formData, calculated_gpm_20psi: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    Last Test Date
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 12/31/2024"
                    value={formData.last_tested_date}
                    onChange={(e) => setFormData({ ...formData, last_tested_date: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    Tested By
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Myles R Cooper"
                    value={formData.tested_by}
                    onChange={(e) => setFormData({ ...formData, tested_by: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div className="mt-3">
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                  Testing Agency Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Bolivia FD"
                  value={formData.agency_name}
                  onChange={(e) => setFormData({ ...formData, agency_name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Notes &amp; Location Details
              </label>
              <textarea
                rows={2}
                placeholder="Obstructions, special fittings, access notes, or paint conditions…"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            {/* Action buttons */}
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
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-cyan-500 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>{formData.id ? 'Save Changes' : 'Save Hydrant'}</span>
              </button>
            </div>
          </form>
        </ViewportModal>
      )}

      {/* Delete Confirmation Modal */}
      {pendingDelete && (
        <ConfirmModal
          isOpen={true}
          title="Delete Hydrant Record"
          message={`Are you sure you want to delete hydrant ${pendingDelete.hydrant_id || pendingDelete.id}? This will remove it from the district inventory and pre-incident plans.`}
          confirmLabel="Delete Hydrant"
          confirmVariant="danger"
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {/* CSV Import Modal */}
      <AdminHydrantImportModal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImportSuccess={() => {
          loadHydrants();
          onDataChanged?.();
        }}
        token={token}
        existingHydrants={hydrants}
      />
    </div>
  );
}

