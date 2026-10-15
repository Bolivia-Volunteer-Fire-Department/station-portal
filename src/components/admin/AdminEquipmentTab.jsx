import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ShieldAlert,
  Radio,
  Wind,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Search,
  AlertTriangle,
  CheckCircle2,
  Clock,
  User,
  Filter,
  Layers,
  Calendar,
  Tag,
  ShieldCheck,
  RotateCw,
} from 'lucide-react';
import {
  adminSaveEquipment,
  adminDeleteEquipment,
  fetchEquipment,
  fetchAssetTypes,
} from '../../services/api';
import {
  EQUIPMENT_CATEGORIES,
  TURNOUT_GEAR_TYPES,
  RADIO_TYPES,
  EQUIPMENT_CONDITIONS,
  evaluateTurnoutRetirement,
  evaluateInspectionCycle,
  evaluateScbaLifecycles,
  conditionBadgeStyle,
} from '../../utils/equipment';
import ConfirmModal from '../ConfirmModal';
import ViewportModal from '../ViewportModal';

const EQUIPMENT_FORM_ID = 'equipment-editor-form';

const EMPTY_FORM = {
  id: '',
  category: 'turnout_gear',
  type: 'coat',
  serial_number: '',
  identifier: '',
  make_model: '',
  manufacture_date: '',
  last_inspection_date: '',
  last_hydro_date: '',
  assigned_to: '',
  assigned_date: '',
  size: '',
  condition: 'in_service',
  location: '',
  notes: '',
};

export default function AdminEquipmentTab({
  token,
  users = [],
  onDataChanged,
}) {
  const [equipmentList, setEquipmentList] = useState([]);
  const [assetTypes, setAssetTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('turnout_gear');
  const [searchQuery, setSearchQuery] = useState('');
  const [conditionFilter, setConditionFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  const [formData, setFormData] = useState(EMPTY_FORM);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [error, setError] = useState(null);

  // Load equipment records and configured asset types from backend
  const loadEquipment = useCallback(async () => {
    setLoading(true);
    try {
      const [response, typesRes] = await Promise.all([
        fetchEquipment(token),
        fetchAssetTypes(token).catch(() => null),
      ]);
      if (response?.equipment) {
        setEquipmentList(response.equipment);
      }
      if (typesRes?.assetTypes) {
        setAssetTypes(typesRes.assetTypes);
      }
    } catch (err) {
      console.warn('Failed to load equipment:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadEquipment();
  }, [loadEquipment]);

  const dynamicTurnoutTypes = useMemo(() => {
    const custom = assetTypes.filter((t) => t.category === 'turnout_gear');
    if (custom.length > 0) {
      return custom.map((t) => ({ id: t.value || t.id, label: t.label }));
    }
    return TURNOUT_GEAR_TYPES;
  }, [assetTypes]);

  const dynamicRadioTypes = useMemo(() => {
    const custom = assetTypes.filter((t) => t.category === 'radios');
    if (custom.length > 0) {
      return custom.map((t) => ({ id: t.value || t.id, label: t.label }));
    }
    return RADIO_TYPES;
  }, [assetTypes]);

  const resetForm = () => {
    setFormData({
      ...EMPTY_FORM,
      category: activeCategory,
      type: activeCategory === 'turnout_gear' ? 'coat' : activeCategory === 'radios' ? 'portable' : 'scba_cylinder',
    });
    setEditorOpen(false);
    setError(null);
  };

  const startNew = () => {
    setFormData({
      ...EMPTY_FORM,
      category: activeCategory,
      type: activeCategory === 'turnout_gear' ? 'coat' : activeCategory === 'radios' ? 'portable' : 'scba_cylinder',
    });
    setError(null);
    setEditorOpen(true);
  };

  const startEdit = (item) => {
    setFormData({
      id: item.id || '',
      category: item.category || 'turnout_gear',
      type: item.type || '',
      serial_number: item.serial_number || '',
      identifier: item.identifier || '',
      make_model: item.make_model || '',
      manufacture_date: item.manufacture_date || '',
      last_inspection_date: item.last_inspection_date || '',
      last_hydro_date: item.last_hydro_date || '',
      assigned_to: item.assigned_to || '',
      assigned_date: item.assigned_date || '',
      size: item.size || '',
      condition: item.condition || 'in_service',
      location: item.location || '',
      notes: item.notes || '',
    });
    setError(null);
    setEditorOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.serial_number?.trim()) {
      setError('Serial number is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const cleanData = {
        ...formData,
        id: formData.id || `eq_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        serial_number: formData.serial_number.trim(),
        identifier: (formData.identifier || '').trim(),
        make_model: (formData.make_model || '').trim(),
      };
      const result = await adminSaveEquipment(cleanData, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to save equipment.');
      await loadEquipment();
      if (typeof onDataChanged === 'function') onDataChanged('equipment');
      resetForm();
    } catch (err) {
      setError(err.message || 'Failed to save equipment record.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    const item = pendingDelete;
    setPendingDelete(null);
    if (!item?.id) return;
    setDeletingId(item.id);
    try {
      const result = await adminDeleteEquipment(item.id, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to delete equipment.');
      await loadEquipment();
      if (typeof onDataChanged === 'function') onDataChanged('equipment');
      if (formData.id === item.id) resetForm();
    } catch (err) {
      setError(err.message || 'Failed to delete equipment.');
    } finally {
      setDeletingId(null);
    }
  };

  // Map user ID to display name
  const memberNameMap = useMemo(() => {
    const map = new Map();
    (users || []).forEach((u) => {
      const name = String(u.name || u.user_name || `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.id);
      map.set(String(u.id), name);
    });
    return map;
  }, [users]);

  // Filter equipment by active category, search query, and filters
  const filteredEquipment = useMemo(() => {
    return equipmentList.filter((item) => {
      if (item.category !== activeCategory) return false;
      if (conditionFilter !== 'all' && item.condition !== conditionFilter) return false;
      if (typeFilter !== 'all' && item.type !== typeFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const serial = (item.serial_number || '').toLowerCase();
        const tag = (item.identifier || '').toLowerCase();
        const model = (item.make_model || '').toLowerCase();
        const assignedName = (memberNameMap.get(item.assigned_to) || '').toLowerCase();
        const notes = (item.notes || '').toLowerCase();
        if (!serial.includes(q) && !tag.includes(q) && !model.includes(q) && !assignedName.includes(q) && !notes.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [equipmentList, activeCategory, conditionFilter, typeFilter, searchQuery, memberNameMap]);

  // Category counts and alerts
  const summaryStats = useMemo(() => {
    const turnoutItems = equipmentList.filter((e) => e.category === 'turnout_gear');
    const radioItems = equipmentList.filter((e) => e.category === 'radios');
    const scbaItems = equipmentList.filter((e) => e.category === 'scba_cylinders');

    let expiredTurnoutCount = 0;
    let overdueInspectionCount = 0;
    turnoutItems.forEach((item) => {
      const retirement = evaluateTurnoutRetirement(item.manufacture_date);
      if (retirement.isExpired) expiredTurnoutCount++;
      const inspection = evaluateInspectionCycle(item.last_inspection_date);
      if (inspection.isOverdue) overdueInspectionCount++;
    });

    let overdueHydroCount = 0;
    let expiredScbaCount = 0;
    scbaItems.forEach((item) => {
      const scba = evaluateScbaLifecycles(item.last_hydro_date, item.manufacture_date);
      if (scba.hydroStatus.isOverdue) overdueHydroCount++;
      if (scba.lifeStatus.isExpired) expiredScbaCount++;
    });

    return {
      turnoutTotal: turnoutItems.length,
      turnoutAssigned: turnoutItems.filter((e) => e.assigned_to).length,
      turnoutExpired: expiredTurnoutCount,
      turnoutOverdueInspection: overdueInspectionCount,
      radioTotal: radioItems.length,
      radioAssigned: radioItems.filter((e) => e.assigned_to).length,
      scbaTotal: scbaItems.length,
      scbaHydroOverdue: overdueHydroCount,
      scbaExpired: expiredScbaCount,
    };
  }, [equipmentList]);

  const activeCategoryMeta = EQUIPMENT_CATEGORIES.find((c) => c.id === activeCategory);

  return (
    <div className="space-y-6">
      {/* Category Folders / Buckets */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div className="flex flex-wrap gap-2">
          {EQUIPMENT_CATEGORIES.map((cat) => {
            const isSelected = activeCategory === cat.id;
            const Icon = cat.id === 'turnout_gear' ? ShieldAlert : cat.id === 'radios' ? Radio : Wind;
            const badgeCount =
              cat.id === 'turnout_gear'
                ? summaryStats.turnoutTotal
                : cat.id === 'radios'
                ? summaryStats.radioTotal
                : summaryStats.scbaTotal;

            const attentionCount =
              cat.id === 'turnout_gear'
                ? summaryStats.turnoutExpired + summaryStats.turnoutOverdueInspection
                : cat.id === 'scba_cylinders'
                ? summaryStats.scbaHydroOverdue + summaryStats.scbaExpired
                : 0;

            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setActiveCategory(cat.id);
                  setTypeFilter('all');
                  setConditionFilter('all');
                }}
                className={`relative inline-flex items-center gap-2.5 rounded-xl border px-4 py-2.5 text-sm font-medium transition cursor-pointer ${
                  isSelected
                    ? 'border-red-600 bg-red-600 text-white shadow-md shadow-red-600/20'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{cat.label}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    isSelected
                      ? 'bg-red-700 text-white'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                  }`}
                >
                  {badgeCount}
                </span>
                {attentionCount > 0 && (
                  <span
                    title={`${attentionCount} items require inspection or hydro review`}
                    className={`h-2.5 w-2.5 rounded-full ${
                      isSelected ? 'bg-amber-300' : 'bg-rose-500'
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={startNew}
          className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-red-500"
        >
          <Plus className="h-4 w-4" />
          <span>Add {activeCategory === 'turnout_gear' ? 'Gear' : activeCategory === 'radios' ? 'Radio' : 'Cylinder'}</span>
        </button>
      </div>

      {/* Summary KPI Cards for Active Category */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {activeCategory === 'turnout_gear' && (
          <>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Total Turnout Items</span>
                <ShieldAlert className="h-4 w-4 text-slate-400" />
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
                {summaryStats.turnoutTotal}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {summaryStats.turnoutAssigned} assigned to members
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Annual Inspection Cycle</span>
                <Clock className="h-4 w-4 text-amber-500" />
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
                {summaryStats.turnoutOverdueInspection > 0 ? (
                  <span className="text-rose-600 dark:text-rose-400">{summaryStats.turnoutOverdueInspection} Overdue</span>
                ) : (
                  <span className="text-emerald-600 dark:text-emerald-400">All Current</span>
                )}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                NFPA 1851 12-month routine cycle
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>10-Year NFPA Retirement</span>
                <AlertTriangle className="h-4 w-4 text-rose-500" />
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
                {summaryStats.turnoutExpired > 0 ? (
                  <span className="text-rose-600 dark:text-rose-400">{summaryStats.turnoutExpired} Expired</span>
                ) : (
                  <span className="text-emerald-600 dark:text-emerald-400">Zero Expired</span>
                )}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Mandatory retirement by manufacture date
              </div>
            </div>
          </>
        )}

        {activeCategory === 'radios' && (
          <>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Total Radios</span>
                <Radio className="h-4 w-4 text-slate-400" />
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
                {summaryStats.radioTotal}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Fleet inventory count
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Assigned to Crew</span>
                <User className="h-4 w-4 text-blue-500" />
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
                {summaryStats.radioAssigned}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Visible on member profiles
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Spare / Pool</span>
                <Layers className="h-4 w-4 text-emerald-500" />
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
                {Math.max(0, summaryStats.radioTotal - summaryStats.radioAssigned)}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Station reserve units
              </div>
            </div>
          </>
        )}

        {activeCategory === 'scba_cylinders' && (
          <>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Total SCBA Cylinders</span>
                <Wind className="h-4 w-4 text-slate-400" />
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
                {summaryStats.scbaTotal}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Apparatus & cascade reserve
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>5-Year Hydro Status</span>
                <Clock className="h-4 w-4 text-amber-500" />
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
                {summaryStats.scbaHydroOverdue > 0 ? (
                  <span className="text-rose-600 dark:text-rose-400">{summaryStats.scbaHydroOverdue} Overdue</span>
                ) : (
                  <span className="text-emerald-600 dark:text-emerald-400">All Requalified</span>
                )}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                DOT 5-year hydrostatic testing
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>15-Year Life Limit</span>
                <AlertTriangle className="h-4 w-4 text-rose-500" />
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
                {summaryStats.scbaExpired > 0 ? (
                  <span className="text-rose-600 dark:text-rose-400">{summaryStats.scbaExpired} Expired</span>
                ) : (
                  <span className="text-emerald-600 dark:text-emerald-400">Zero Expired</span>
                )}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                DOT-SP composite life limit
              </div>
            </div>
          </>
        )}
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by serial number, tag, model, or member…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-4 py-2 text-sm text-slate-900 focus:border-red-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeCategory === 'turnout_gear' && (
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              <option value="all">All Gear Types</option>
              {dynamicTurnoutTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          )}

          <select
            value={conditionFilter}
            onChange={(e) => setConditionFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            <option value="all">All Conditions</option>
            {EQUIPMENT_CONDITIONS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Equipment Table / List */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin text-red-600" />
            <span className="ml-3 text-sm font-medium">Loading equipment inventory…</span>
          </div>
        ) : filteredEquipment.length === 0 ? (
          <div className="py-16 text-center text-slate-500 dark:text-slate-400">
            <ShieldAlert className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
            <p className="mt-2 text-sm font-medium">No equipment records found.</p>
            <p className="text-xs">Click "Add {activeCategory === 'turnout_gear' ? 'Gear' : activeCategory === 'radios' ? 'Radio' : 'Cylinder'}" to create the first record.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
              <thead className="border-b border-slate-200 bg-slate-50/70 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-semibold">Item & Serial Number</th>
                  <th className="px-4 py-3 font-semibold">Assigned Member</th>
                  {activeCategory === 'turnout_gear' && (
                    <>
                      <th className="px-4 py-3 font-semibold">NFPA 10-Year Retirement</th>
                      <th className="px-4 py-3 font-semibold">Annual Inspection</th>
                    </>
                  )}
                  {activeCategory === 'radios' && (
                    <>
                      <th className="px-4 py-3 font-semibold">Radio Model / Tag</th>
                      <th className="px-4 py-3 font-semibold">Location / Rig</th>
                    </>
                  )}
                  {activeCategory === 'scba_cylinders' && (
                    <>
                      <th className="px-4 py-3 font-semibold">5-Year Hydro Status</th>
                      <th className="px-4 py-3 font-semibold">15-Year Life Limit</th>
                    </>
                  )}
                  <th className="px-4 py-3 font-semibold">Condition</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredEquipment.map((item) => {
                  const assignedMemberName = memberNameMap.get(item.assigned_to) || '';
                  const turnoutRetirement = activeCategory === 'turnout_gear' ? evaluateTurnoutRetirement(item.manufacture_date) : null;
                  const turnoutInspection = activeCategory === 'turnout_gear' ? evaluateInspectionCycle(item.last_inspection_date) : null;
                  const scba = activeCategory === 'scba_cylinders' ? evaluateScbaLifecycles(item.last_hydro_date, item.manufacture_date) : null;
                  const typeLabel =
                    activeCategory === 'turnout_gear'
                      ? dynamicTurnoutTypes.find((t) => t.id === item.type)?.label || item.type
                      : activeCategory === 'radios'
                      ? dynamicRadioTypes.find((t) => t.id === item.type)?.label || item.type
                      : 'Composite Cylinder';

                  return (
                    <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {typeLabel} {item.identifier && <span className="font-normal text-slate-500">({item.identifier})</span>}
                        </div>
                        <div className="font-mono text-xs text-slate-500 dark:text-slate-400">
                          SN: {item.serial_number} {item.size && `• Size: ${item.size}`}
                        </div>
                        {item.make_model && (
                          <div className="text-[11px] text-slate-400">
                            {item.make_model}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        {assignedMemberName ? (
                          <div className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                            <User className="h-3 w-3 text-slate-400" />
                            <span>{assignedMemberName}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400 italic">Unassigned (Pool)</span>
                        )}
                      </td>

                      {activeCategory === 'turnout_gear' && (
                        <>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${turnoutRetirement.badgeClass}`}>
                              {turnoutRetirement.label}
                            </span>
                            {item.manufacture_date && (
                              <div className="mt-0.5 text-[11px] text-slate-400">
                                MFG: {item.manufacture_date}
                              </div>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${turnoutInspection.badgeClass}`}>
                              {turnoutInspection.label}
                            </span>
                            {item.last_inspection_date && (
                              <div className="mt-0.5 text-[11px] text-slate-400">
                                Last: {item.last_inspection_date}
                              </div>
                            )}
                          </td>
                        </>
                      )}

                      {activeCategory === 'radios' && (
                        <>
                          <td className="px-4 py-3">
                            <div className="text-xs font-medium text-slate-700 dark:text-slate-200">
                              {item.make_model || 'Standard Radio'}
                            </div>
                            {item.identifier && (
                              <div className="text-[11px] text-slate-400">Unit ID: {item.identifier}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500">
                            {item.location || 'Station Cache'}
                          </td>
                        </>
                      )}

                      {activeCategory === 'scba_cylinders' && (
                        <>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${scba.hydroStatus.badgeClass}`}>
                              {scba.hydroStatus.label}
                            </span>
                            {item.last_hydro_date && (
                              <div className="mt-0.5 text-[11px] text-slate-400">
                                Last test: {item.last_hydro_date}
                              </div>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${scba.lifeStatus.badgeClass}`}>
                              {scba.lifeStatus.label}
                            </span>
                            {item.manufacture_date && (
                              <div className="mt-0.5 text-[11px] text-slate-400">
                                MFG: {item.manufacture_date}
                              </div>
                            )}
                          </td>
                        </>
                      )}

                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${conditionBadgeStyle(item.condition)}`}>
                          {EQUIPMENT_CONDITIONS.find((c) => c.id === item.condition)?.label || item.condition}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => startEdit(item)}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                            title="Edit Equipment"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDelete(item)}
                            disabled={deletingId === item.id}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:text-slate-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                            title="Delete Equipment"
                          >
                            {deletingId === item.id ? (
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

      {/* Add / Edit Equipment Modal */}
      {editorOpen && (
        <ViewportModal
          title={formData.id ? `Edit ${activeCategoryMeta?.label || 'Equipment'}` : `Add ${activeCategoryMeta?.label || 'Equipment'}`}
          subtitle={formData.id ? `Serial No: ${formData.serial_number}` : 'Create a new equipment asset record'}
          icon={<ShieldAlert className="h-4 w-4 text-red-600" />}
          formId={EQUIPMENT_FORM_ID}
          saveLabel={formData.id ? 'Save Changes' : 'Save Equipment'}
          saving={saving}
          onClose={resetForm}
        >
          <form id={EQUIPMENT_FORM_ID} onSubmit={handleSubmit} className="space-y-4 text-sm">
            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Equipment Category
                </label>
                <select
                  value={formData.category}
                  onChange={(e) => {
                    const cat = e.target.value;
                    setFormData({
                      ...formData,
                      category: cat,
                      type: cat === 'turnout_gear' ? 'coat' : cat === 'radios' ? 'portable' : 'scba_cylinder',
                    });
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  {EQUIPMENT_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Item Type
                </label>
                {formData.category === 'turnout_gear' ? (
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    {dynamicTurnoutTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                ) : formData.category === 'radios' ? (
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    {dynamicRadioTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value="SCBA Composite Cylinder"
                    disabled
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900"
                  />
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Serial Number *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. SN-892401"
                  value={formData.serial_number}
                  onChange={(e) => setFormData({ ...formData, serial_number: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Tag / Unit Identifier
                </label>
                <input
                  type="text"
                  placeholder="e.g. Radio #4, Coat #12, Bottle 201"
                  value={formData.identifier}
                  onChange={(e) => setFormData({ ...formData, identifier: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Make & Model / Brand
                </label>
                <input
                  type="text"
                  placeholder="e.g. Morning Pride Tails, Motorola APX 6000"
                  value={formData.make_model}
                  onChange={(e) => setFormData({ ...formData, make_model: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              {formData.category === 'turnout_gear' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Size / Fit
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 42R, 34x32, Large, 11W"
                    value={formData.size}
                    onChange={(e) => setFormData({ ...formData, size: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              )}

              {formData.category !== 'turnout_gear' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Location / Apparatus Assigned
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Engine 1, Ladder 2, Station Rack"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              )}
            </div>

            {/* Dates: Manufacture, Inspection, Hydro */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Manufacture Date (YYYY-MM-DD)
                </label>
                <input
                  type="date"
                  value={formData.manufacture_date}
                  onChange={(e) => setFormData({ ...formData, manufacture_date: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                {formData.category === 'turnout_gear' && (
                  <p className="mt-1 text-[11px] text-slate-400">
                    NFPA 1851 requires retirement 10 years from this date.
                  </p>
                )}
                {formData.category === 'scba_cylinders' && (
                  <p className="mt-1 text-[11px] text-slate-400">
                    DOT composite service life expires 15 years from this date.
                  </p>
                )}
              </div>

              {formData.category === 'turnout_gear' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Last Inspection Date
                  </label>
                  <input
                    type="date"
                    value={formData.last_inspection_date}
                    onChange={(e) => setFormData({ ...formData, last_inspection_date: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    Annual inspection due every 12 months.
                  </p>
                </div>
              )}

              {formData.category === 'scba_cylinders' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Last Hydrostatic Test Date
                  </label>
                  <input
                    type="date"
                    value={formData.last_hydro_date}
                    onChange={(e) => setFormData({ ...formData, last_hydro_date: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    5-year hydrostatic test interval.
                  </p>
                </div>
              )}
            </div>

            {/* Assignment & Condition */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Assign to Member
                </label>
                <select
                  value={formData.assigned_to}
                  onChange={(e) => setFormData({ ...formData, assigned_to: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="">Unassigned (Station Pool / Spare)</option>
                  {(users || []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {memberNameMap.get(u.id) || u.id}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-400">
                  Assigned gear & radios appear on the member's My Profile page.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Status / Condition
                </label>
                <select
                  value={formData.condition}
                  onChange={(e) => setFormData({ ...formData, condition: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  {EQUIPMENT_CONDITIONS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Notes / Inspection Comments
              </label>
              <textarea
                rows={2}
                placeholder="Repairs needed, cleanings, or serial history…"
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
                <span>{formData.id ? 'Save Changes' : 'Save Equipment'}</span>
              </button>
            </div>
          </form>
        </ViewportModal>
      )}

      {/* Delete Confirmation Modal */}
      {pendingDelete && (
        <ConfirmModal
          isOpen={true}
          title="Delete Equipment Record"
          message={`Are you sure you want to delete ${pendingDelete.serial_number} (${pendingDelete.identifier || pendingDelete.type})? This action cannot be undone.`}
          confirmLabel="Delete Equipment"
          confirmVariant="danger"
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
