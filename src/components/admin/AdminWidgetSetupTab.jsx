import React, { useState, useEffect, useMemo } from 'react';
import {
  Boxes,
  Plus,
  Pencil,
  Trash2,
  Save,
  Check,
  AlertCircle,
  Loader2,
  ExternalLink,
  FileText,
  Link2,
  Globe,
  Eye,
  EyeOff,
  X,
  Compass,
} from 'lucide-react';
import CenteredContent from '../CenteredContent';
import ToggleSwitch from '../ToggleSwitch';
import { adminSaveSystemSettings } from '../../services/api';
import { getSettingValue } from '../../utils/systemSettings';
import {
  BUILTIN_WIDGETS,
  DASHBOARD_CUSTOM_WIDGETS_KEY,
  DASHBOARD_WIDGET_CONFIGS_KEY,
  parseCustomWidgets,
  formatCustomWidgets,
  parseWidgetConfigs,
  formatWidgetConfigs,
  DEFAULT_QUICK_LINKS,
} from '../../utils/dashboardWidgets';

export default function AdminWidgetSetupTab({ token, systemSettings, onDataChanged }) {
  const rawCustomWidgets = getSettingValue(systemSettings, DASHBOARD_CUSTOM_WIDGETS_KEY, '');
  const rawWidgetConfigs = getSettingValue(systemSettings, DASHBOARD_WIDGET_CONFIGS_KEY, '');

  const [customWidgets, setCustomWidgets] = useState(() => parseCustomWidgets(rawCustomWidgets));
  const [widgetConfigs, setWidgetConfigs] = useState(() => parseWidgetConfigs(rawWidgetConfigs));

  // Editing custom widget modal state
  const [editingWidget, setEditingWidget] = useState(null); // null or widget object
  const [isNew, setIsNew] = useState(false);

  // Editing built-in widget configuration modal state
  const [editingBuiltinWidget, setEditingBuiltinWidget] = useState(null);

  // Saving states
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setCustomWidgets(parseCustomWidgets(getSettingValue(systemSettings, DASHBOARD_CUSTOM_WIDGETS_KEY, '')));
    setWidgetConfigs(parseWidgetConfigs(getSettingValue(systemSettings, DASHBOARD_WIDGET_CONFIGS_KEY, '')));
  }, [systemSettings]);

  // Check if dirty
  const isDirty = useMemo(() => {
    const origCustom = formatCustomWidgets(parseCustomWidgets(rawCustomWidgets));
    const origConfigs = formatWidgetConfigs(parseWidgetConfigs(rawWidgetConfigs));
    return formatCustomWidgets(customWidgets) !== origCustom || formatWidgetConfigs(widgetConfigs) !== origConfigs;
  }, [customWidgets, widgetConfigs, rawCustomWidgets, rawWidgetConfigs]);

  // Toggle widget enabled/disabled
  const handleToggleWidget = (widgetId, enabled) => {
    setWidgetConfigs((prev) => ({
      ...prev,
      [widgetId]: {
        ...(prev[widgetId] || {}),
        enabled,
      },
    }));
    setSaved(false);
  };

  // Open modal to configure a built-in widget
  const handleOpenConfigureBuiltin = (widget) => {
    const config = widgetConfigs[widget.id] || {};
    setEditingBuiltinWidget({
      id: widget.id,
      originalLabel: widget.label,
      originalDescription: widget.description,
      label: config.label !== undefined ? config.label : widget.label,
      description: config.description !== undefined ? config.description : widget.description,
      customLinks: Array.isArray(config.customLinks) && config.customLinks.length > 0 ? [...config.customLinks] : [...DEFAULT_QUICK_LINKS],
      radarUrl: config.radarUrl || 'https://radar.weather.gov',
      groupBySchedule: config.groupBySchedule !== false,
    });
  };

  // Save built-in widget configuration
  const handleSaveBuiltinConfig = (e) => {
    e.preventDefault();
    if (!editingBuiltinWidget) return;

    setWidgetConfigs((prev) => ({
      ...prev,
      [editingBuiltinWidget.id]: {
        ...(prev[editingBuiltinWidget.id] || {}),
        label: editingBuiltinWidget.label.trim(),
        description: editingBuiltinWidget.description.trim(),
        ...(editingBuiltinWidget.id === 'quick-links' ? { customLinks: editingBuiltinWidget.customLinks } : {}),
        ...(editingBuiltinWidget.id === 'weather-radar' ? { radarUrl: editingBuiltinWidget.radarUrl.trim() } : {}),
        ...(editingBuiltinWidget.id === 'on-duty' ? { groupBySchedule: editingBuiltinWidget.groupBySchedule !== false } : {}),
      },
    }));

    setEditingBuiltinWidget(null);
    setSaved(false);
  };

  // Open modal for new widget
  const handleCreateNewWidget = () => {
    setIsNew(true);
    setEditingWidget({
      id: `custom-${Date.now()}`,
      title: '',
      description: '',
      type: 'markdown', // 'markdown' | 'links' | 'embed'
      content: '',
      links: [{ label: '', url: '', external: true }],
      embedUrl: '',
      defaultColSpan: 2,
    });
  };

  // Save modal form
  const handleSaveModalWidget = (e) => {
    e.preventDefault();
    if (!editingWidget || !editingWidget.title.trim()) return;

    setCustomWidgets((prev) => {
      const idx = prev.findIndex((w) => w.id === editingWidget.id);
      if (idx !== -1) {
        const next = [...prev];
        next[idx] = editingWidget;
        return next;
      }
      return [...prev, editingWidget];
    });

    setEditingWidget(null);
    setIsNew(false);
    setSaved(false);
  };

  // Delete custom widget
  const handleDeleteCustomWidget = (widgetId) => {
    setCustomWidgets((prev) => prev.filter((w) => w.id !== widgetId));
    setSaved(false);
  };

  // Save changes to systemSettings
  const handleSaveAll = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const formattedCustom = formatCustomWidgets(customWidgets);
      const formattedConfigs = formatWidgetConfigs(widgetConfigs);

      const result = await adminSaveSystemSettings(
        [
          { key: DASHBOARD_CUSTOM_WIDGETS_KEY, value: formattedCustom },
          { key: DASHBOARD_WIDGET_CONFIGS_KEY, value: formattedConfigs },
        ],
        token
      );

      if (result && (result.success === false || result.error)) {
        setError(result.error || result.message || 'Failed to save widget setup');
      } else {
        setSaved(true);
        onDataChanged?.();
      }
    } catch (err) {
      setError(err?.message || 'Failed to save widget setup');
    } finally {
      setSaving(false);
    }
  };

  return (
    <CenteredContent className="space-y-6">
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/80 p-6 shadow-xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-700/80 pb-4">
          <div>
            <div className="flex items-center gap-2 text-red-600 dark:text-red-500 font-semibold text-xs tracking-wider uppercase mb-1">
              <Boxes className="w-4 h-4" />
              <span>Administration · Content</span>
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white">Widget Setup</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Configure available built-in widgets and create custom department cards for the dashboard.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCreateNewWidget}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-xs font-semibold text-slate-800 dark:text-slate-100 transition shadow-xs"
            >
              <Plus className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
              <span>New Custom Card</span>
            </button>

            <button
              type="button"
              onClick={handleSaveAll}
              disabled={saving || !isDirty}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-xs font-semibold text-white shadow-md shadow-red-600/20 transition"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              <span>Save Changes</span>
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
            <span>Widget setup successfully saved!</span>
          </div>
        )}

        {/* Built-in Widgets Section */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Standard System Widgets
          </h4>

          <div className="space-y-2">
            {BUILTIN_WIDGETS.map((widget) => {
              const isCore = widget.id === 'time-status' || widget.id === 'announcements';
              const isEnabled = isCore ? true : widgetConfigs[widget.id]?.enabled !== false;
              const displayLabel = widgetConfigs[widget.id]?.label || widget.label;
              const displayDesc = widgetConfigs[widget.id]?.description || widget.description;

              return (
                <div
                  key={widget.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700/70 bg-slate-50/60 dark:bg-slate-900/40"
                >
                  <div className="space-y-0.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {displayLabel}
                      </span>
                      {isCore && (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 shrink-0">
                          Required
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">
                      {displayDesc}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleOpenConfigureBuiltin(widget)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 transition shadow-xs"
                      title={`Customize ${widget.label} settings`}
                    >
                      <Pencil className="w-3.5 h-3.5 text-slate-500" />
                      <span>Customize</span>
                    </button>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {isEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                      <ToggleSwitch
                        enabled={isEnabled}
                        checked={isEnabled}
                        disabled={isCore}
                        onChange={(checked) => handleToggleWidget(widget.id, checked)}
                        ariaLabel={`Enable or disable ${widget.label}`}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Custom Department Widgets Section */}
        <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-700/80">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Custom Department Cards ({customWidgets.length})
            </h4>
          </div>

          {customWidgets.length > 0 ? (
            <div className="space-y-2">
              {customWidgets.map((widget) => (
                <div
                  key={widget.id}
                  className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 dark:border-slate-700/70 bg-slate-50/60 dark:bg-slate-900/40"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">
                        {widget.title}
                      </span>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 uppercase">
                        {widget.type}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">
                      {widget.description || widget.content || 'Custom station card'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsNew(false);
                        setEditingWidget({ ...widget });
                      }}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                      title="Edit widget"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteCustomWidget(widget.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition"
                      title="Delete widget"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
              No custom cards created yet. Click "New Custom Card" to create daily pass-down notes, custom link lists, or web embeds.
            </div>
          )}
        </div>
      </div>

      {/* Edit / Create Custom Widget Modal */}
      {editingWidget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
          <div className="relative w-full max-w-lg rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-700">
              <h4 className="text-base font-bold text-slate-900 dark:text-white">
                {isNew ? 'Create Custom Card' : 'Edit Custom Card'}
              </h4>
              <button
                type="button"
                onClick={() => setEditingWidget(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveModalWidget} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Card Title
                </label>
                <input
                  type="text"
                  required
                  value={editingWidget.title}
                  onChange={(e) => setEditingWidget({ ...editingWidget, title: e.target.value })}
                  placeholder="e.g. Daily Pass-Down Notes, Chief's Briefing"
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Card Type
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setEditingWidget({ ...editingWidget, type: 'markdown' })}
                    className={`p-2.5 rounded-xl border text-left transition flex items-center gap-2 ${
                      editingWidget.type === 'markdown'
                        ? 'border-red-500 bg-red-50/60 dark:bg-red-950/40 text-red-700 dark:text-red-300 font-semibold'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <FileText className="w-4 h-4 shrink-0" />
                    <span>Markdown / Notes</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingWidget({ ...editingWidget, type: 'links' })}
                    className={`p-2.5 rounded-xl border text-left transition flex items-center gap-2 ${
                      editingWidget.type === 'links'
                        ? 'border-red-500 bg-red-50/60 dark:bg-red-950/40 text-red-700 dark:text-red-300 font-semibold'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <Link2 className="w-4 h-4 shrink-0" />
                    <span>Quick Link List</span>
                  </button>
                </div>
              </div>

              {editingWidget.type === 'markdown' ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Markdown Content
                  </label>
                  <textarea
                    rows={5}
                    value={editingWidget.content || ''}
                    onChange={(e) => setEditingWidget({ ...editingWidget, content: e.target.value })}
                    placeholder="Enter notes or markdown formatted instructions..."
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 font-mono text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Links List
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setEditingWidget({
                          ...editingWidget,
                          links: [...(editingWidget.links || []), { label: '', url: '', external: true }],
                        })
                      }
                      className="text-xs text-red-600 dark:text-red-400 hover:underline flex items-center gap-0.5"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add Link</span>
                    </button>
                  </div>
                  {(editingWidget.links || []).map((link, lIdx) => (
                    <div key={lIdx} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Label"
                        value={link.label}
                        onChange={(e) => {
                          const nextLinks = [...editingWidget.links];
                          nextLinks[lIdx] = { ...nextLinks[lIdx], label: e.target.value };
                          setEditingWidget({ ...editingWidget, links: nextLinks });
                        }}
                        className="w-1/3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-900 dark:text-white"
                      />
                      <input
                        type="text"
                        placeholder="https://..."
                        value={link.url}
                        onChange={(e) => {
                          const nextLinks = [...editingWidget.links];
                          nextLinks[lIdx] = { ...nextLinks[lIdx], url: e.target.value };
                          setEditingWidget({ ...editingWidget, links: nextLinks });
                        }}
                        className="w-2/3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-900 dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const nextLinks = editingWidget.links.filter((_, i) => i !== lIdx);
                          setEditingWidget({ ...editingWidget, links: nextLinks });
                        }}
                        className="p-1 text-slate-400 hover:text-red-500"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Default Width
                </label>
                <select
                  value={editingWidget.defaultColSpan || 1}
                  onChange={(e) =>
                    setEditingWidget({ ...editingWidget, defaultColSpan: Number(e.target.value) })
                  }
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-white"
                >
                  <option value={1}>1 Column (Standard)</option>
                  <option value={2}>2 Columns (Wide)</option>
                  <option value={3}>3 Columns (Full Width)</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setEditingWidget(null)}
                  className="px-3.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-xs font-semibold text-white shadow-sm"
                >
                  {isNew ? 'Create Card' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Built-in Widget Customization Modal */}
      {editingBuiltinWidget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
          <div className="relative w-full max-w-lg rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-700">
              <div>
                <h4 className="text-base font-bold text-slate-900 dark:text-white">
                  Customize System Card
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Default: {editingBuiltinWidget.originalLabel}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingBuiltinWidget(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveBuiltinConfig} className="space-y-4 text-xs">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Custom Display Title
                </label>
                <input
                  type="text"
                  value={editingBuiltinWidget.label}
                  onChange={(e) =>
                    setEditingBuiltinWidget({ ...editingBuiltinWidget, label: e.target.value })
                  }
                  placeholder={editingBuiltinWidget.originalLabel}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Custom Subtitle / Description
                </label>
                <input
                  type="text"
                  value={editingBuiltinWidget.description}
                  onChange={(e) =>
                    setEditingBuiltinWidget({ ...editingBuiltinWidget, description: e.target.value })
                  }
                  placeholder={editingBuiltinWidget.originalDescription}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-white"
                />
              </div>

              {/* Quick Links Specific Configuration */}
              {editingBuiltinWidget.id === 'quick-links' && (
                <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Configured Action Links ({editingBuiltinWidget.customLinks?.length || 0})
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setEditingBuiltinWidget({
                            ...editingBuiltinWidget,
                            customLinks: [...DEFAULT_QUICK_LINKS],
                          })
                        }
                        className="text-[11px] text-slate-500 hover:text-slate-700 dark:text-slate-400 hover:underline"
                      >
                        Reset Defaults
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setEditingBuiltinWidget({
                            ...editingBuiltinWidget,
                            customLinks: [
                              ...(editingBuiltinWidget.customLinks || []),
                              { id: `link-${Date.now()}`, label: 'New Link', url: 'https://', external: true },
                            ],
                          })
                        }
                        className="text-red-600 dark:text-red-400 font-semibold text-xs flex items-center gap-1 hover:underline"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Link</span>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                    {(editingBuiltinWidget.customLinks || []).map((link, idx) => (
                      <div
                        key={link.id || idx}
                        className="flex items-center gap-2 p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50"
                      >
                        <input
                          type="text"
                          placeholder="Link Label"
                          value={link.label}
                          onChange={(e) => {
                            const next = [...editingBuiltinWidget.customLinks];
                            next[idx] = { ...next[idx], label: e.target.value };
                            setEditingBuiltinWidget({ ...editingBuiltinWidget, customLinks: next });
                          }}
                          className="w-1/3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs text-slate-900 dark:text-white"
                        />
                        <input
                          type="text"
                          placeholder="https://..."
                          value={link.url}
                          onChange={(e) => {
                            const next = [...editingBuiltinWidget.customLinks];
                            next[idx] = { ...next[idx], url: e.target.value };
                            setEditingBuiltinWidget({ ...editingBuiltinWidget, customLinks: next });
                          }}
                          className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs text-slate-900 dark:text-white"
                        />
                        <label className="flex items-center gap-1 text-[11px] text-slate-500 whitespace-nowrap cursor-pointer">
                          <input
                            type="checkbox"
                            checked={link.external !== false}
                            onChange={(e) => {
                              const next = [...editingBuiltinWidget.customLinks];
                              next[idx] = { ...next[idx], external: e.target.checked };
                              setEditingBuiltinWidget({ ...editingBuiltinWidget, customLinks: next });
                            }}
                            className="rounded text-red-600 focus:ring-0"
                          />
                          <span>New Tab</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            const next = editingBuiltinWidget.customLinks.filter((_, i) => i !== idx);
                            setEditingBuiltinWidget({ ...editingBuiltinWidget, customLinks: next });
                          }}
                          className="p-1 text-slate-400 hover:text-red-500 rounded transition"
                          title="Remove link"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* On Duty Specific Configuration */}
              {editingBuiltinWidget.id === 'on-duty' && (
                <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                  <div className="flex items-start justify-between gap-4 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/50">
                    <div className="space-y-1">
                      <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                        Prioritize Scheduled Shift Crew
                      </label>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                        Show personnel scheduled for the current time first (highlighting those clocked in with a green border), followed by additional clocked-in personnel in a separate section below.
                      </p>
                    </div>
                    <ToggleSwitch
                      enabled={editingBuiltinWidget.groupBySchedule !== false}
                      checked={editingBuiltinWidget.groupBySchedule !== false}
                      onChange={(checked) =>
                        setEditingBuiltinWidget({
                          ...editingBuiltinWidget,
                          groupBySchedule: checked,
                        })
                      }
                      ariaLabel="Prioritize scheduled shift crew on Currently On Duty widget"
                    />
                  </div>
                </div>
              )}

              {/* Weather Radar Specific Configuration */}
              {editingBuiltinWidget.id === 'weather-radar' && (
                <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Weather Radar Feed URL
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setEditingBuiltinWidget({
                          ...editingBuiltinWidget,
                          radarUrl: 'https://radar.weather.gov',
                        })
                      }
                      className="text-[11px] text-slate-500 hover:text-slate-700 dark:text-slate-400 hover:underline"
                    >
                      Reset NOAA Default
                    </button>
                  </div>
                  <input
                    type="url"
                    value={editingBuiltinWidget.radarUrl}
                    onChange={(e) =>
                      setEditingBuiltinWidget({ ...editingBuiltinWidget, radarUrl: e.target.value })
                    }
                    placeholder="https://radar.weather.gov"
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-white"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Provide your local NWS radar link, county Doppler station, or emergency weather portal URL.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() =>
                    setEditingBuiltinWidget({
                      ...editingBuiltinWidget,
                      label: editingBuiltinWidget.originalLabel,
                      description: editingBuiltinWidget.originalDescription,
                      customLinks: [...DEFAULT_QUICK_LINKS],
                      radarUrl: 'https://radar.weather.gov',
                      groupBySchedule: true,
                    })
                  }
                  className="text-xs text-slate-500 hover:text-red-600 transition"
                >
                  Reset Card Defaults
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingBuiltinWidget(null)}
                    className="px-3.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-xs font-semibold text-white shadow-sm transition"
                  >
                    Apply Changes
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </CenteredContent>
  );
}

