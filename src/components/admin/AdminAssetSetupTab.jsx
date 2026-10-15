import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  SlidersHorizontal,
  Truck,
  ShieldAlert,
  Radio,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Search,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  Info,
} from 'lucide-react';
import {
  fetchAssetTypes,
  adminSaveAssetType,
  adminDeleteAssetType,
} from '../../services/api';
import { APPARATUS_TYPES } from '../../utils/apparatus';
import { TURNOUT_GEAR_TYPES, RADIO_TYPES } from '../../utils/equipment';
import ConfirmModal from '../ConfirmModal';
import ViewportModal from '../ViewportModal';

const ASSET_TYPE_FORM_ID = 'asset-type-editor-form';

const CATEGORIES = [
  { id: 'apparatus', label: 'Apparatus Types', icon: Truck, description: 'Vehicles, engines, rescues, and fleet rigs' },
  { id: 'turnout_gear', label: 'Turnout Gear Types', icon: ShieldAlert, description: 'PPE bunker gear and protective items' },
  { id: 'radios', label: 'Radio Types', icon: Radio, description: 'Handheld portables, mobile vehicle rigs, and pagers' },
];

const EMPTY_FORM = {
  id: '',
  category: 'apparatus',
  label: '',
  value: '',
  description: '',
  sort_order: '',
};

export default function AdminAssetSetupTab({ token, onDataChanged }) {
  const [assetTypes, setAssetTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [activeCategory, setActiveCategory] = useState('apparatus');
  const [searchTerm, setSearchTerm] = useState('');

  const [editorOpen, setEditorOpen] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchAssetTypes(token);
      if (response?.assetTypes) {
        setAssetTypes(response.assetTypes);
      }
    } catch (err) {
      console.error('Failed to load asset types:', err);
      setError(err.message || 'Could not load asset types.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Merge database custom types with standard system defaults.
  const effectiveTypes = useMemo(() => {
    const list = [...assetTypes];

    // Check if defaults should be included if not already present
    const hasCategoryTypes = (cat) => list.some((t) => t.category === cat);

    if (!hasCategoryTypes('apparatus')) {
      APPARATUS_TYPES.forEach((item, index) => {
        list.push({
          id: `default_app_${item.value.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
          category: 'apparatus',
          label: item.label,
          value: item.value,
          description: 'Standard apparatus fleet vehicle type',
          sort_order: (index + 1) * 10,
          is_default: true,
        });
      });
    }

    if (!hasCategoryTypes('turnout_gear')) {
      TURNOUT_GEAR_TYPES.forEach((item, index) => {
        list.push({
          id: `default_gear_${item.id}`,
          category: 'turnout_gear',
          label: item.label,
          value: item.id,
          description: 'Standard NFPA 1851 turnout gear item',
          sort_order: (index + 1) * 10,
          is_default: true,
        });
      });
    }

    if (!hasCategoryTypes('radios')) {
      RADIO_TYPES.forEach((item, index) => {
        list.push({
          id: `default_radio_${item.id}`,
          category: 'radios',
          label: item.label,
          value: item.id,
          description: 'Standard communication device type',
          sort_order: (index + 1) * 10,
          is_default: true,
        });
      });
    }

    return list;
  }, [assetTypes]);

  // Filter types by active category and search term.
  const filteredTypes = useMemo(() => {
    let result = effectiveTypes.filter((t) => t.category === activeCategory);
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      result = result.filter(
        (t) =>
          (t.label || '').toLowerCase().includes(q) ||
          (t.value || '').toLowerCase().includes(q) ||
          (t.description || '').toLowerCase().includes(q)
      );
    }
    return result.sort((a, b) => {
      const orderA = a.sort_order !== '' && a.sort_order !== undefined ? Number(a.sort_order) : 999;
      const orderB = b.sort_order !== '' && b.sort_order !== undefined ? Number(b.sort_order) : 999;
      if (orderA !== orderB) return orderA - orderB;
      return (a.label || '').localeCompare(b.label || '');
    });
  }, [effectiveTypes, activeCategory, searchTerm]);

  // Counts per category
  const categoryCounts = useMemo(() => {
    const counts = { apparatus: 0, turnout_gear: 0, radios: 0 };
    effectiveTypes.forEach((t) => {
      if (counts[t.category] !== undefined) counts[t.category]++;
    });
    return counts;
  }, [effectiveTypes]);

  const closeEditor = () => {
    setFormData(EMPTY_FORM);
    setError(null);
    setEditorOpen(false);
  };

  const startNew = () => {
    setFormData({
      ...EMPTY_FORM,
      category: activeCategory,
    });
    setError(null);
    setEditorOpen(true);
  };

  const startEdit = (item) => {
    setFormData({
      id: item.is_default ? '' : item.id,
      category: item.category,
      label: item.label || '',
      value: item.value || '',
      description: item.description || '',
      sort_order: item.sort_order !== undefined && item.sort_order !== null ? String(item.sort_order) : '',
    });
    setError(null);
    setEditorOpen(true);
  };

  const handleSave = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!formData.label.trim()) {
      setError('Please provide a type label or name.');
      return;
    }

    const valueKey = formData.value.trim() || formData.label.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
    const id = formData.id || `${formData.category}_${Date.now()}`;

    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    const payload = {
      id,
      category: formData.category,
      label: formData.label.trim(),
      value: valueKey,
      description: formData.description.trim(),
      sort_order: formData.sort_order !== '' ? Number(formData.sort_order) : 999,
      updated_at: new Date().toISOString(),
    };

    try {
      const response = await adminSaveAssetType(payload, token);
      if (!response?.success) {
        throw new Error(response?.message || 'Could not save this asset type.');
      }
      closeEditor();
      setSuccessMessage('Asset type saved successfully.');
      setTimeout(() => setSuccessMessage(null), 3000);
      await loadData();
      void onDataChanged?.();
    } catch (err) {
      console.error('Failed to save asset type:', err);
      setError(err.message || 'Could not save this asset type.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target || target.is_default) return;

    setDeletingId(target.id);
    setError(null);
    try {
      const response = await adminDeleteAssetType(target.id, token);
      if (!response?.success) {
        throw new Error(response?.message || 'Could not delete this asset type.');
      }
      setSuccessMessage('Asset type deleted.');
      setTimeout(() => setSuccessMessage(null), 3000);
      await loadData();
      void onDataChanged?.();
    } catch (err) {
      console.error('Failed to delete asset type:', err);
      setError(err.message || 'Could not delete this asset type.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner and Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <SlidersHorizontal className="h-6 w-6 text-red-500" />
            <span>Asset Setup</span>
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Configure available equipment categories, turnout gear inspection types, and apparatus fleet categories.
          </p>
        </div>

        <button
          type="button"
          onClick={startNew}
          className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-red-600/20 transition hover:bg-red-500 cursor-pointer self-start sm:self-auto"
        >
          <Plus className="h-4 w-4" />
          <span>Add Type</span>
        </button>
      </div>

      {successMessage && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
          <span>{successMessage}</span>
        </div>
      )}

      {error && !editorOpen && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-600 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
          <AlertCircle className="h-5 w-5 shrink-0 text-red-500" />
          <span>{error}</span>
        </div>
      )}

      {/* Category Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3 dark:border-slate-700">
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const isActive = activeCategory === cat.id;
          const count = categoryCounts[cat.id] || 0;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => {
                setActiveCategory(cat.id);
                setSearchTerm('');
              }}
              className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition cursor-pointer ${
                isActive
                  ? 'border-red-600 bg-red-600 text-white shadow-lg shadow-red-600/20'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{cat.label}</span>
              <span
                className={`ml-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                  isActive
                    ? 'bg-red-700 text-white'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search types..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Showing {filteredTypes.length} configured {activeCategory === 'apparatus' ? 'apparatus' : 'equipment'} types
        </p>
      </div>

      {/* Types List Card */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800">
        <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-700 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              {CATEGORIES.find((c) => c.id === activeCategory)?.label}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {CATEGORIES.find((c) => c.id === activeCategory)?.description}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin text-red-600" />
            <span className="ml-3 text-sm font-medium">Loading asset types…</span>
          </div>
        ) : filteredTypes.length === 0 ? (
          <div className="py-12 text-center text-slate-500 dark:text-slate-400">
            <SlidersHorizontal className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
            <p className="mt-2 text-sm font-medium">No types found</p>
            <p className="text-xs text-slate-400 mt-1">
              {searchTerm ? 'No asset types match your search.' : 'Add your first asset type with the button above.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {filteredTypes.map((type) => (
              <div
                key={type.id}
                className="flex items-center justify-between p-4 sm:px-6 hover:bg-slate-50/60 dark:hover:bg-slate-700/30 transition"
              >
                <div className="min-w-0 pr-4">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900 dark:text-white text-sm">
                      {type.label}
                    </span>
                    <span className="font-mono text-xs text-slate-400 dark:text-slate-500">
                      ({type.value})
                    </span>
                    {type.is_default ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                        Default
                      </span>
                    ) : (
                      <span className="rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[10px] font-semibold text-red-600 dark:bg-red-950/50 dark:border-red-900 dark:text-red-400">
                        Custom
                      </span>
                    )}
                  </div>
                  {type.description && (
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 line-clamp-1">
                      {type.description}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => startEdit(type)}
                    className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200 transition cursor-pointer"
                    title={type.is_default ? 'Customize this default type' : 'Edit type'}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>

                  {!type.is_default && (
                    <button
                      type="button"
                      disabled={deletingId === type.id}
                      onClick={() => setPendingDelete(type)}
                      className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400 transition cursor-pointer disabled:opacity-50"
                      title="Delete type"
                    >
                      {deletingId === type.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-red-600" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Editor Modal */}
      {editorOpen && (
        <ViewportModal
          isOpen={editorOpen}
          title={formData.id ? 'Edit Asset Type' : 'New Asset Type'}
          subtitle={formData.id ? 'Editing configured asset type' : 'Add custom equipment or apparatus category'}
          icon={<SlidersHorizontal className="h-5 w-5 text-red-500" />}
          formId={ASSET_TYPE_FORM_ID}
          onSave={handleSave}
          saveLabel={formData.id ? 'Save changes' : 'Add type'}
          saving={saving}
          onClose={closeEditor}
        >
          <form id={ASSET_TYPE_FORM_ID} onSubmit={handleSave} className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-600 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                Asset Category
              </label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                Type Name / Label <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Engine / Pumper, Bunker Coat, Handheld Portable..."
                value={formData.label}
                onChange={(e) => {
                  const label = e.target.value;
                  setFormData((prev) => ({
                    ...prev,
                    label,
                    value: prev.id ? prev.value : label.toLowerCase().replace(/[^a-z0-9]/g, '_'),
                  }));
                }}
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                  Code Identifier
                </label>
                <input
                  type="text"
                  placeholder="e.g. engine, coat, portable"
                  value={formData.value}
                  onChange={(e) => setFormData({ ...formData, value: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                  className="w-full font-mono rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
                <p className="text-[11px] text-slate-400 mt-1">Unique machine key stored on equipment rows.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                  Sort Order
                </label>
                <input
                  type="number"
                  placeholder="e.g. 10, 20..."
                  value={formData.sort_order}
                  onChange={(e) => setFormData({ ...formData, sort_order: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
                <p className="text-[11px] text-slate-400 mt-1">Lower numbers appear first in selection menus.</p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                Description & Notes
              </label>
              <textarea
                rows={2}
                placeholder="Optional notes or description of this gear or vehicle type..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white resize-none"
              />
            </div>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-700/80 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeEditor}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 font-medium text-sm hover:bg-slate-100 dark:hover:bg-slate-700 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <span>{formData.id ? 'Save changes' : 'Add type'}</span>
                )}
              </button>
            </div>
          </form>
        </ViewportModal>
      )}

      {/* Delete Confirmation Modal */}
      {pendingDelete && (
        <ConfirmModal
          isOpen={!!pendingDelete}
          title="Delete Asset Type?"
          message={`Are you sure you want to delete "${pendingDelete.label}"? Existing equipment or apparatuses using this type will retain their recorded data, but this option will no longer be available in selection menus.`}
          confirmLabel="Delete Type"
          isDestructive
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

