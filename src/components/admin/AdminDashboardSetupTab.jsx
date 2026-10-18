import React, { useState, useEffect, useMemo } from 'react';
import {
  LayoutDashboard,
  Save,
  RotateCcw,
  Plus,
  ArrowLeft,
  ArrowRight,
  Lock,
  X,
  AlertCircle,
  Check,
  Loader2,
  Layers,
  GripVertical,
} from 'lucide-react';
import WidgetResizeHandle from '../widgets/WidgetResizeHandle';
import { adminSaveSystemSettings } from '../../services/api';
import { getSettingValue } from '../../utils/systemSettings';
import {
  DASHBOARD_DEFAULT_LAYOUT_KEY,
  DASHBOARD_CUSTOM_WIDGETS_KEY,
  DASHBOARD_WIDGET_CONFIGS_KEY,
  FACTORY_DEFAULT_LAYOUT,
  parseDashboardLayout,
  formatDashboardLayout,
  parseCustomWidgets,
  parseWidgetConfigs,
  getAllAvailableWidgets,
} from '../../utils/dashboardWidgets';

export default function AdminDashboardSetupTab({ token, systemSettings, onDataChanged }) {
  const rawStationDefaultLayout = getSettingValue(systemSettings, DASHBOARD_DEFAULT_LAYOUT_KEY, '');
  const rawCustomWidgets = getSettingValue(systemSettings, DASHBOARD_CUSTOM_WIDGETS_KEY, '');
  const rawWidgetConfigs = getSettingValue(systemSettings, DASHBOARD_WIDGET_CONFIGS_KEY, '');

  const customWidgets = useMemo(() => parseCustomWidgets(rawCustomWidgets), [rawCustomWidgets]);
  const widgetConfigs = useMemo(() => parseWidgetConfigs(rawWidgetConfigs), [rawWidgetConfigs]);

  const allWidgets = useMemo(() => getAllAvailableWidgets(customWidgets, widgetConfigs), [customWidgets, widgetConfigs]);
  const allWidgetsMap = useMemo(() => new Map(allWidgets.map((w) => [w.id, w])), [allWidgets]);

  const [layout, setLayout] = useState(() =>
    parseDashboardLayout(rawStationDefaultLayout, customWidgets, widgetConfigs)
  );

  const [showAddMenu, setShowAddMenu] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLayout(parseDashboardLayout(getSettingValue(systemSettings, DASHBOARD_DEFAULT_LAYOUT_KEY, ''), customWidgets, widgetConfigs));
  }, [systemSettings, customWidgets, widgetConfigs]);

  // Is dirty
  const isDirty = useMemo(() => {
    const orig = formatDashboardLayout(parseDashboardLayout(rawStationDefaultLayout, customWidgets, widgetConfigs));
    return formatDashboardLayout(layout) !== orig;
  }, [layout, rawStationDefaultLayout, customWidgets, widgetConfigs]);

  // Unplaced widgets
  const placedIds = useMemo(() => new Set(layout.map((item) => item.id)), [layout]);
  const unplacedWidgets = useMemo(
    () => allWidgets.filter((w) => !placedIds.has(w.id) && widgetConfigs[w.id]?.enabled !== false),
    [allWidgets, placedIds, widgetConfigs]
  );

  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  // Movement: Admins can position any widget (including timeclock and announcements)
  const moveWidget = (fromIndex, toIndex) => {
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= layout.length || toIndex >= layout.length) return;
    setLayout((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    setSaved(false);
  };

  // Drag-and-drop snap to grid handlers
  const handleDragStart = (e, index) => {
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
    if (draggedIndex === null) return;
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = (e, index) => {
    if (dragOverIndex === index) {
      setDragOverIndex(null);
    }
  };

  const handleDrop = (e, index) => {
    e.preventDefault();
    if (draggedIndex === null) return;
    if (draggedIndex !== index) {
      setLayout((prev) => {
        const next = [...prev];
        const [moved] = next.splice(draggedIndex, 1);
        next.splice(index, 0, moved);
        return next;
      });
      setSaved(false);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  // Resize: Admins can resize any widget (1 Col, 2 Col, or Full Width)
  const setColSpan = (index, colSpan) => {
    if (index < 0 || index >= layout.length) return;
    setLayout((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], colSpan: Math.min(3, Math.max(1, colSpan)) };
      return next;
    });
    setSaved(false);
  };

  // Remove: Non-core widgets can be removed from default layout
  const removeWidget = (index) => {
    const item = layout[index];
    if (item?.id === 'time-status' || item?.id === 'announcements') return;
    setLayout((prev) => prev.filter((_, i) => i !== index));
    setSaved(false);
  };

  // Add
  const addWidget = (widget) => {
    setLayout((prev) => [...prev, { id: widget.id, colSpan: widget.defaultColSpan || 1 }]);
    setShowAddMenu(false);
    setSaved(false);
  };

  // Reset to factory defaults
  const handleResetToFactory = () => {
    setLayout([...FACTORY_DEFAULT_LAYOUT]);
    setSaved(false);
  };

  // Save station default layout
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const formatted = formatDashboardLayout(layout);
      const result = await adminSaveSystemSettings(
        [{ key: DASHBOARD_DEFAULT_LAYOUT_KEY, value: formatted }],
        token
      );

      if (result && (result.success === false || result.error)) {
        setError(result.error || result.message || 'Failed to save default dashboard layout');
      } else {
        setSaved(true);
        onDataChanged?.();
      }
    } catch (err) {
      setError(err?.message || 'Failed to save default dashboard layout');
    } finally {
      setSaving(false);
    }
  };

  const colSpanClasses = (colSpan) => {
    switch (colSpan) {
      case 2:
        return 'col-span-1 md:col-span-2';
      case 3:
        return 'col-span-1 md:col-span-2 lg:col-span-3';
      case 1:
      default:
        return 'col-span-1';
    }
  };

  return (
    <div className="w-full space-y-6">
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/80 p-6 shadow-xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-700/80 pb-4">
          <div>
            <div className="flex items-center gap-2 text-red-600 dark:text-red-500 font-semibold text-xs tracking-wider uppercase mb-1">
              <LayoutDashboard className="w-4 h-4" />
              <span>Administration · Content</span>
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white">Dashboard Setup</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Arrange the station default layout that new members and users without a custom layout see on the Dashboard.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleResetToFactory}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 transition shadow-xs"
              title="Reset to factory default layout"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
              <span>Factory Default</span>
            </button>

            {/* Add Widget Picker */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowAddMenu((open) => !open)}
                disabled={unplacedWidgets.length === 0}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 text-xs font-semibold text-slate-800 dark:text-slate-100 transition shadow-xs"
              >
                <Plus className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                <span>Add Widget</span>
              </button>

              {showAddMenu && unplacedWidgets.length > 0 && (
                <div className="absolute right-0 top-10 z-30 w-64 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-2xl p-2 origin-top-right animate-popoverIn">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Add Widget to Default
                  </div>
                  <div className="space-y-1 mt-1 max-h-60 overflow-y-auto">
                    {unplacedWidgets.map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => addWidget(w)}
                        className="flex w-full items-start gap-2.5 p-2 rounded-xl text-left hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                      >
                        <div className="mt-0.5 p-1 rounded-md bg-slate-100 dark:bg-slate-800 text-red-600 dark:text-red-400">
                          <Plus className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                            {w.label}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">
                            {w.description}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !isDirty}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-xs font-semibold text-white shadow-md shadow-red-600/20 transition"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              <span>Save Default Layout</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-xs font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {saved && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-xs font-medium bg-emerald-50 text-emerald-600 border border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-400 dark:border-emerald-800/80">
            <Check className="w-4 h-4 shrink-0" />
            <span>Station default dashboard layout successfully saved!</span>
          </div>
        )}

        {/* Visual Grid Builder representation */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-2">
              <Layers className="w-4 h-4 text-red-500" />
              <span>Default Layout Grid Preview (3-Column Desktop View)</span>
            </h4>
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {layout.length} widgets placed
            </span>
          </div>

          <div className="dashboard-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40">
            {layout.map((item, index) => {
              const isCore = item.id === 'time-status' || item.id === 'announcements';
              const widgetMeta = allWidgetsMap.get(item.id) || { label: item.id, description: '' };
              const spanClass = colSpanClasses(item.colSpan);

              return (
                <div
                  key={item.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragLeave={(e) => handleDragLeave(e, index)}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  className={`relative isolate flex flex-col justify-between rounded-xl border p-4 bg-white dark:bg-slate-800 shadow-sm transition-all ${spanClass} ${
                    draggedIndex === index
                      ? 'opacity-40 border-dashed border-red-500 scale-[0.98]'
                      : dragOverIndex === index
                      ? 'ring-4 ring-red-500 ring-offset-2 dark:ring-red-400 dark:ring-offset-slate-900 border-red-500 scale-[1.01]'
                      : isCore
                      ? 'border-red-200 dark:border-red-900/40 bg-red-50/10'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {/* Drag Handle */}
                        <div
                          draggable
                          onDragStart={(e) => handleDragStart(e, index)}
                          className="flex items-center gap-1 cursor-grab active:cursor-grabbing px-1.5 py-0.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 select-none transition"
                          title="Drag to reposition widget (snap to grid)"
                        >
                          <GripVertical className="w-3.5 h-3.5" />
                        </div>
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                          {widgetMeta.label}
                        </span>
                        {isCore && (
                          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300 shrink-0">
                            Core
                          </span>
                        )}
                      </div>

                      {!isCore ? (
                        <button
                          type="button"
                          onClick={() => removeWidget(index)}
                          className="p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition shrink-0"
                          title="Remove from default layout"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-400 shrink-0">Required</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">
                      {widgetMeta.description}
                    </p>
                  </div>

                  {/* Card Controls Footer */}
                  <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-100 dark:border-slate-700/60 text-xs">
                    {/* Position movement arrows */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveWidget(index, index - 1)}
                        disabled={index === 0}
                        className="p-1 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-20"
                        title="Move left/up"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveWidget(index, index + 1)}
                        disabled={index === layout.length - 1}
                        className="p-1 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-20"
                        title="Move right/down"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <span className="text-[11px] text-slate-400 pr-5">
                      {item.colSpan === 3 ? 'Full Width' : `${item.colSpan} Col`}
                    </span>
                  </div>

                  {/* Grabbable Corner Resize Handle */}
                  <WidgetResizeHandle
                    colSpan={item.colSpan}
                    onResize={(newSpan) => setColSpan(index, newSpan)}
                    minColSpan={1}
                    maxColSpan={3}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

