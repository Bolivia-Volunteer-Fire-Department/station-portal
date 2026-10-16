import React, { useState, useEffect, useMemo } from 'react';
import {
  Compass,
  Smartphone,
  GripVertical,
  ChevronUp,
  ChevronDown,
  RotateCcw,
  Save,
  Loader2,
  AlertCircle,
  Pencil,
  Search,
  X,
  Check,
  Lock,
} from 'lucide-react';
import CenteredContent from '../CenteredContent';
import { adminSaveSystemSettings } from '../../services/api';
import { getSettingValue } from '../../utils/systemSettings';
import {
  SIDEBAR_NAV_ORDER_KEY,
  SIDEBAR_NAV_ICONS_KEY,
  DEFAULT_SIDEBAR_NAV_ORDER,
  DEFAULT_MODULE_ICONS,
  SIDEBAR_MODULE_CATALOG,
  NAV_ICON_MAP,
  NAV_ICON_OPTIONS,
  NAV_ICON_CATEGORIES,
  parseSidebarNavOrder,
  formatSidebarNavOrder,
  parseSidebarNavIcons,
  formatSidebarNavIcons,
  getSidebarModuleIcon,
} from '../../utils/sidebarNav';
import {
  MOBILE_NAV_MODULES_KEY,
  AVAILABLE_MOBILE_NAV_MODULES,
  parseMobileNavModules,
  formatMobileNavModules,
} from '../../utils/mobileNav';

// Settings tab for customizing navigation: reordering sidebar links, picking icons, and choosing mobile nav bar shortcuts.
export default function AdminNavigationSetupTab({ token, systemSettings, onDataChanged }) {
  const currentRawIcons = getSettingValue(systemSettings, SIDEBAR_NAV_ICONS_KEY, '');
  const customIcons = useMemo(() => parseSidebarNavIcons(currentRawIcons), [currentRawIcons]);

  return (
    <CenteredContent className="space-y-6">
      <SidebarNavOrderCard
        token={token}
        systemSettings={systemSettings}
        onDataChanged={onDataChanged}
      />
      <MobileNavSettingsCard
        token={token}
        systemSettings={systemSettings}
        customIcons={customIcons}
        onDataChanged={onDataChanged}
      />
    </CenteredContent>
  );
}

function SidebarNavOrderCard({ token, systemSettings, onDataChanged }) {
  const currentRawOrder = getSettingValue(systemSettings, SIDEBAR_NAV_ORDER_KEY, '');
  const currentRawIcons = getSettingValue(systemSettings, SIDEBAR_NAV_ICONS_KEY, '');

  const [order, setOrder] = useState(() => parseSidebarNavOrder(currentRawOrder));
  const [customIcons, setCustomIcons] = useState(() => parseSidebarNavIcons(currentRawIcons));
  const [editingIconModule, setEditingIconModule] = useState(null);

  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setOrder(parseSidebarNavOrder(getSettingValue(systemSettings, SIDEBAR_NAV_ORDER_KEY, '')));
    setCustomIcons(parseSidebarNavIcons(getSettingValue(systemSettings, SIDEBAR_NAV_ICONS_KEY, '')));
  }, [systemSettings]);

  const pristineOrder = useMemo(() => parseSidebarNavOrder(currentRawOrder), [currentRawOrder]);
  const pristineIcons = useMemo(() => parseSidebarNavIcons(currentRawIcons), [currentRawIcons]);

  const isOrderDirty = order.join(',') !== pristineOrder.join(',');
  const isIconsDirty = JSON.stringify(customIcons) !== JSON.stringify(pristineIcons);
  const isDirty = isOrderDirty || isIconsDirty;

  const moveItem = (fromIndex, toIndex) => {
    // Dashboard module is permanently locked to index 0
    if (fromIndex === 0 || toIndex === 0) return;
    if (toIndex < 0 || toIndex >= order.length) return;
    setOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    setSaved(false);
  };

  const handleDragStart = (e, index) => {
    if (index === 0) {
      e.preventDefault();
      return;
    }
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', String(index));
    } catch {
      // ignore
    }
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (index === 0) return;
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e, targetIndex) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === undefined || draggedIndex === 0) return;
    if (targetIndex === 0) return;
    if (draggedIndex !== targetIndex) {
      moveItem(draggedIndex, targetIndex);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleSelectIcon = (moduleId, iconName) => {
    setCustomIcons((prev) => {
      const next = { ...prev };
      if (iconName && iconName !== DEFAULT_MODULE_ICONS[moduleId]) {
        next[moduleId] = iconName;
      } else {
        delete next[moduleId];
      }
      return next;
    });
    setEditingIconModule(null);
    setSaved(false);
  };

  const handleResetModuleIcon = (moduleId) => {
    setCustomIcons((prev) => {
      const next = { ...prev };
      delete next[moduleId];
      return next;
    });
    setEditingIconModule(null);
    setSaved(false);
  };

  const handleResetDefault = () => {
    setOrder([...DEFAULT_SIDEBAR_NAV_ORDER]);
    setCustomIcons({});
    setSaved(false);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const formattedOrder = formatSidebarNavOrder(order);
      const formattedIcons = formatSidebarNavIcons(customIcons);

      const result = await adminSaveSystemSettings(
        [
          { key: SIDEBAR_NAV_ORDER_KEY, value: formattedOrder },
          { key: SIDEBAR_NAV_ICONS_KEY, value: formattedIcons },
        ],
        token
      );
      if (!result?.success) throw new Error(result?.message || 'Failed to save sidebar navigation setup.');

      void onDataChanged?.();
      setSaved(true);
    } catch (err) {
      setError(err.message || 'Failed to save sidebar navigation setup.');
    } finally {
      setSaving(false);
    }
  };

  const catalogMap = useMemo(() => new Map(SIDEBAR_MODULE_CATALOG.map((m) => [m.id, m])), []);
  const isDefaultConfiguration =
    order.join(',') === DEFAULT_SIDEBAR_NAV_ORDER.join(',') &&
    Object.keys(customIcons).length === 0;

  const editingMeta = editingIconModule ? catalogMap.get(editingIconModule) : null;

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <form onSubmit={handleSave} className="p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-red-500">
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Sidebar Navigation &amp; Icons</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Drag to reorder modules and click any icon to customize it. Changes apply station-wide once saved.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleResetDefault}
            disabled={isDefaultConfiguration || saving}
            className="self-start sm:self-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-700/60 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
            title="Reset sidebar order and custom icons to defaults"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset to Default
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-2">
          {order.map((moduleId, index) => {
            const meta = catalogMap.get(moduleId) || { label: moduleId, description: '' };
            const IconComponent = getSidebarModuleIcon(moduleId, customIcons);
            const isCustomIcon = Boolean(customIcons[moduleId]);
            const isDragging = draggedIndex === index;
            const isOver = dragOverIndex === index;
            const isLocked = index === 0;

            return (
              <div
                key={moduleId}
                draggable={!isLocked && !saving}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
                className={`flex items-center gap-3 p-3 rounded-xl border transition select-none ${
                  isDragging
                    ? 'opacity-40 border-dashed border-red-400 bg-red-50/50 dark:bg-red-950/20'
                    : isOver
                    ? 'border-red-500 bg-red-50/70 dark:bg-red-950/40 shadow-sm'
                    : 'border-slate-200 dark:border-slate-700/80 bg-slate-50/60 dark:bg-slate-900/40 hover:bg-slate-100/70 dark:hover:bg-slate-800/70'
                }`}
              >
                {isLocked ? (
                  <div
                    className="text-slate-400 p-1"
                    title="Dashboard is pinned as the primary module"
                  >
                    <Lock className="w-4 h-4 text-slate-400" />
                  </div>
                ) : (
                  <div
                    className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
                    title="Drag to reorder"
                  >
                    <GripVertical className="w-4 h-4" />
                  </div>
                )}

                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-slate-200 dark:bg-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {index + 1}
                </div>

                {/* Interactive Icon Selector Button */}
                <button
                  type="button"
                  onClick={() => setEditingIconModule(moduleId)}
                  disabled={saving}
                  className="group relative p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 hover:border-red-500 dark:hover:border-red-500 hover:bg-red-50/40 dark:hover:bg-red-950/30 text-slate-700 dark:text-slate-200 transition shadow-sm"
                  title={`Click to change icon for ${meta.label}${isCustomIcon ? ' (Custom icon)' : ''}`}
                >
                  <IconComponent className="w-4 h-4 text-slate-700 dark:text-slate-200 group-hover:text-red-600 dark:group-hover:text-red-400 transition" />
                  <span className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700 text-[8px] text-slate-600 dark:text-slate-300 group-hover:bg-red-600 group-hover:text-white transition shadow-sm">
                    <Pencil className="w-2 h-2" />
                  </span>
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {meta.label}
                    </p>
                    {isLocked && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-slate-700/70 text-slate-600 dark:text-slate-300">
                        Pinned first
                      </span>
                    )}
                    {isCustomIcon && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-950/70 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/60">
                        Custom icon
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {meta.description}
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveItem(index, index - 1)}
                    disabled={index <= 1 || isLocked || saving}
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-20 disabled:hover:bg-transparent"
                    title="Move up"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveItem(index, index + 1)}
                    disabled={index === order.length - 1 || isLocked || saving}
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-20 disabled:hover:bg-transparent"
                    title="Move down"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end items-center gap-3 pt-3 border-t border-slate-200 dark:border-slate-700/80">
          {saved && <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Sidebar navigation saved!</span>}
          {isDirty && !saved && (
            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              Unsaved changes
            </span>
          )}
          <button
            type="submit"
            disabled={saving || (!isDirty && !saved)}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Sidebar Navigation
          </button>
        </div>
      </form>

      {/* Icon Picker Modal */}
      {editingIconModule && editingMeta && (
        <IconPickerModal
          moduleId={editingIconModule}
          moduleMeta={editingMeta}
          currentIconKey={customIcons[editingIconModule] || DEFAULT_MODULE_ICONS[editingIconModule]}
          defaultIconKey={DEFAULT_MODULE_ICONS[editingIconModule]}
          isCustomIcon={Boolean(customIcons[editingIconModule])}
          onSelect={(iconKey) => handleSelectIcon(editingIconModule, iconKey)}
          onReset={() => handleResetModuleIcon(editingIconModule)}
          onClose={() => setEditingIconModule(null)}
        />
      )}
    </div>
  );
}

function IconPickerModal({
  moduleId,
  moduleMeta,
  currentIconKey,
  defaultIconKey,
  isCustomIcon,
  onSelect,
  onReset,
  onClose,
}) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  const filteredIcons = useMemo(() => {
    const q = search.trim().toLowerCase();
    return NAV_ICON_OPTIONS.filter((item) => {
      const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
      if (!matchesCategory) return false;
      if (!q) return true;
      return (
        item.label.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [search, selectedCategory]);

  const DefaultIconComponent = NAV_ICON_MAP[defaultIconKey] || Compass;
  const CurrentIconComponent = NAV_ICON_MAP[currentIconKey] || Compass;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Change Icon for ${moduleMeta.label}`}
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-xs animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl max-w-xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-modalIn"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-700/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-red-100 dark:bg-red-950/70 border border-red-200 dark:border-red-800/80 text-red-600 dark:text-red-400">
              <CurrentIconComponent className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                Choose Icon for &ldquo;{moduleMeta.label}&rdquo;
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Pick any icon to represent this module in the navigation sidebar.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search & Quick Controls */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-700/80 space-y-3 bg-slate-50/70 dark:bg-slate-900/40">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search icons (e.g. fire, truck, clock, shield, award)..."
              autoFocus
              className="w-full pl-9 pr-8 py-2 text-sm rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            <button
              type="button"
              onClick={() => setSelectedCategory('All')}
              className={`px-2.5 py-1 rounded-lg font-medium transition whitespace-nowrap ${
                selectedCategory === 'All'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              All
            </button>
            {NAV_ICON_CATEGORIES.map((cat) => (
              <button
                type="button"
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded-lg font-medium transition whitespace-nowrap ${
                  selectedCategory === cat
                    ? 'bg-red-600 text-white shadow-sm'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Default Icon Shortcut Banner */}
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs">
            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
              <span className="font-medium text-slate-400">Default:</span>
              <DefaultIconComponent className="w-4 h-4 text-slate-700 dark:text-slate-200" />
              <span>{defaultIconKey}</span>
            </div>
            {isCustomIcon ? (
              <button
                type="button"
                onClick={onReset}
                className="flex items-center gap-1 text-red-600 dark:text-red-400 hover:underline font-medium"
              >
                <RotateCcw className="w-3 h-3" />
                Reset to Default Icon
              </button>
            ) : (
              <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                <Check className="w-3 h-3" /> Currently Default
              </span>
            )}
          </div>
        </div>

        {/* Scrollable Icon Grid */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {filteredIcons.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm">
              No icons matched &ldquo;{search}&rdquo;. Try another search term.
            </div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 sm:gap-2.5">
              {filteredIcons.map((opt) => {
                const IconGlyph = NAV_ICON_MAP[opt.id];
                if (!IconGlyph) return null;
                const isSelected = currentIconKey === opt.id;
                const isDefault = defaultIconKey === opt.id;

                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onSelect(opt.id)}
                    className={`relative flex flex-col items-center justify-center p-2.5 rounded-xl border transition text-center group ${
                      isSelected
                        ? 'border-red-500 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 ring-2 ring-red-500/20 shadow-xs'
                        : 'border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-red-300 dark:hover:border-red-700 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                    }`}
                    title={`${opt.label} (${opt.category})${isDefault ? ' - Default' : ''}`}
                  >
                    <IconGlyph className="w-5 h-5 mb-1.5 shrink-0 group-hover:scale-110 transition-transform" />
                    <span className="text-[11px] leading-tight truncate w-full">
                      {opt.label}
                    </span>
                    {isSelected && (
                      <span className="absolute top-1 right-1 flex h-3 w-3 items-center justify-center rounded-full bg-red-600 text-white">
                        <Check className="w-2 h-2" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 sm:p-4 border-t border-slate-200 dark:border-slate-700/80 bg-slate-50 dark:bg-slate-900/40 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>{filteredIcons.length} available icons</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-200/80 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 font-medium transition"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function MobileNavSettingsCard({ token, systemSettings, customIcons = {}, onDataChanged }) {
  const currentSetting = getSettingValue(systemSettings, MOBILE_NAV_MODULES_KEY, '');
  const [selectedModules, setSelectedModules] = useState(() => parseMobileNavModules(currentSetting));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setSelectedModules(parseMobileNavModules(getSettingValue(systemSettings, MOBILE_NAV_MODULES_KEY, '')));
  }, [systemSettings]);

  const handleSlotChange = (slotIndex, newModuleId) => {
    setSelectedModules((prev) => {
      const next = [...prev];
      const existingIndex = next.indexOf(newModuleId);
      if (existingIndex !== -1 && existingIndex !== slotIndex) {
        next[existingIndex] = next[slotIndex];
      }
      next[slotIndex] = newModuleId;
      return next;
    });
    setSaved(false);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const formatted = formatMobileNavModules(selectedModules);
      const result = await adminSaveSystemSettings(
        [{ key: MOBILE_NAV_MODULES_KEY, value: formatted }],
        token
      );
      if (!result?.success) throw new Error(result?.message || 'Failed to save mobile navigation settings.');

      void onDataChanged?.();
      setSaved(true);
    } catch (err) {
      setError(err.message || 'Failed to save mobile navigation settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <form onSubmit={handleSave} className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-red-500">
            <Smartphone className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Mobile Navigation Bar</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Choose the 3 primary action modules displayed on mobile devices (&lt; 768px). Remaining modules are placed inside the &quot;More&quot; menu.
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* 3 Action Module Slots */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((slotIndex) => {
            const currentModuleId = selectedModules[slotIndex] || '';
            const slotMeta = AVAILABLE_MOBILE_NAV_MODULES.find((m) => m.id === currentModuleId);
            const SlotIcon = getSidebarModuleIcon(currentModuleId, customIcons);

            return (
              <div key={slotIndex} className="p-4 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-slate-50 dark:bg-slate-900/40 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Button {slotIndex + 1}
                  </label>
                  <SlotIcon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                </div>
                <select
                  value={currentModuleId}
                  onChange={(e) => handleSlotChange(slotIndex, e.target.value)}
                  className="w-full px-3 py-2 text-sm font-medium rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                >
                  {AVAILABLE_MOBILE_NAV_MODULES.map((mod) => (
                    <option key={mod.id} value={mod.id}>
                      {mod.label} ({mod.description})
                    </option>
                  ))}
                </select>
                {slotMeta && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {slotMeta.description}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Live Preview Box */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-700/60 p-4 bg-slate-100/60 dark:bg-slate-900/60 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>Mobile Bottom Bar Preview</span>
            <span className="text-[11px] font-normal text-slate-400 dark:text-slate-500">Live preview (mobile viewport)</span>
          </div>
          <div className="max-w-sm mx-auto bg-white/95 dark:bg-slate-800/95 border border-slate-200 dark:border-slate-700/80 rounded-2xl p-2 flex items-center justify-around shadow-sm">
            {selectedModules.map((modId) => {
              const meta = AVAILABLE_MOBILE_NAV_MODULES.find((m) => m.id === modId) || { label: modId };
              const PreviewIcon = getSidebarModuleIcon(modId, customIcons);
              return (
                <div key={modId} className="flex flex-col items-center justify-center flex-1 py-1 text-slate-700 dark:text-slate-300">
                  <div className="w-6 h-6 rounded-md bg-red-100 dark:bg-red-950/70 border border-red-300 dark:border-red-700/60 mb-1 flex items-center justify-center text-red-600 dark:text-red-400">
                    <PreviewIcon className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-[11px] font-medium truncate max-w-[65px]">{meta.label}</span>
                </div>
              );
            })}
            <div className="flex flex-col items-center justify-center flex-1 py-1 text-slate-500 dark:text-slate-400">
              <div className="w-6 h-6 rounded-md bg-slate-200 dark:bg-slate-700 mb-1 flex items-center justify-center text-[10px] font-bold">
                ≡
              </div>
              <span className="text-[11px] font-medium">More</span>
            </div>
          </div>
        </div>

        <div className="flex justify-end items-center gap-3 pt-2 border-t border-slate-200 dark:border-slate-700/80">
          {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Mobile Navigation
          </button>
        </div>
      </form>
    </div>
  );
}
