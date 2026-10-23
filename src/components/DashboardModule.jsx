import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  LayoutDashboard,
  Pencil,
  Check,
  X,
  RotateCcw,
  Plus,
  ArrowLeft,
  ArrowRight,
  Maximize2,
  Minimize2,
  Lock,
  Layers,
  Save,
  Loader2,
  GripVertical,
} from 'lucide-react';
import TimeAndStatusCard from './widgets/TimeAndStatusCard';
import OnDutyCard from './OnDutyCard';
import AnnouncementList from './AnnouncementList';
import { visibleAnnouncementsFor } from '../utils/announcements';
import CertificationNotice from './CertificationNotice';
import UpcomingShiftsWidget from './widgets/UpcomingShiftsWidget';
import QuickLinksWidget from './widgets/QuickLinksWidget';
import WeatherRadarWidget from './widgets/WeatherRadarWidget';
import CustomMarkdownWidget from './widgets/CustomMarkdownWidget';
import ApparatusStatusWidget from './widgets/ApparatusStatusWidget';
import AssignedWorkOrdersWidget from './widgets/AssignedWorkOrdersWidget';
import PreplansDueWidget from './widgets/PreplansDueWidget';
import ScheduledTasksWidget from './widgets/ScheduledTasksWidget';
import WidgetResizeHandle from './widgets/WidgetResizeHandle';
import {
  DASHBOARD_DEFAULT_LAYOUT_KEY,
  DASHBOARD_CUSTOM_WIDGETS_KEY,
  DASHBOARD_WIDGET_CONFIGS_KEY,
  BUILTIN_WIDGETS,
  parseDashboardLayout,
  formatDashboardLayout,
  parseCustomWidgets,
  parseWidgetConfigs,
  getAllAvailableWidgets,
} from '../utils/dashboardWidgets';
import { getSettingValue } from '../utils/systemSettings';

export default function DashboardModule({
  currentUser,
  currentRole,
  isClockedIn = false,
  loading = false,
  offline = false,
  onClockAction,
  timeFormat = '12',
  canUseTimeclock = false,
  certificationAlerts = [],
  announcements = [],
  announcementAudience = {},
  onDutyUsers = [],
  users = [],
  ranks = [],
  schedule = [],
  scheduleWindow = null,
  onNeedSchedule = null,
  scheduleTemplates = [],
  assignments = [],
  workOrders = [],
  systemSettings = [],
  userSettings = {},
  onSaveUserSettings,
  onNavigate,
  onNavigateToMap,
  token,
  roles = [],
}) {
  // Read station default layout, custom widgets, and widget configurations
  const rawStationDefaultLayout = getSettingValue(systemSettings, DASHBOARD_DEFAULT_LAYOUT_KEY, '');
  const rawCustomWidgets = getSettingValue(systemSettings, DASHBOARD_CUSTOM_WIDGETS_KEY, '');
  const rawWidgetConfigs = getSettingValue(systemSettings, DASHBOARD_WIDGET_CONFIGS_KEY, '');

  const customWidgets = useMemo(() => parseCustomWidgets(rawCustomWidgets), [rawCustomWidgets]);
  const widgetConfigs = useMemo(() => parseWidgetConfigs(rawWidgetConfigs), [rawWidgetConfigs]);

  // Station-wide default layout
  const stationDefaultLayout = useMemo(
    () => parseDashboardLayout(rawStationDefaultLayout, customWidgets, widgetConfigs),
    [rawStationDefaultLayout, customWidgets, widgetConfigs]
  );

  // Active user layout: user's personal layout if saved in user_settings, otherwise station default
  const [layout, setLayout] = useState(() => {
    const userRaw = userSettings?.dashboard_layout;
    if (userRaw) {
      return parseDashboardLayout(userRaw, customWidgets, widgetConfigs);
    }
    return stationDefaultLayout;
  });

  // Keep layout synchronized if user settings or station layout changes while not in edit mode
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);

  useEffect(() => {
    if (!isCustomizing) {
      const userRaw = userSettings?.dashboard_layout;
      if (userRaw) {
        setLayout(parseDashboardLayout(userRaw, customWidgets, widgetConfigs));
      } else {
        setLayout(stationDefaultLayout);
      }
    }
  }, [userSettings?.dashboard_layout, stationDefaultLayout, isCustomizing, customWidgets, widgetConfigs]);

  // Catalog of all available widgets
  const allWidgets = useMemo(() => getAllAvailableWidgets(customWidgets, widgetConfigs), [customWidgets, widgetConfigs]);
  const allWidgetsMap = useMemo(() => new Map(allWidgets.map((w) => [w.id, w])), [allWidgets]);

  // Unplaced available widgets that can be added
  const placedIds = useMemo(() => new Set(layout.map((item) => item.id)), [layout]);
  const unplacedWidgets = useMemo(
    () => allWidgets.filter((w) => !placedIds.has(w.id) && widgetConfigs[w.id]?.enabled !== false),
    [allWidgets, placedIds, widgetConfigs]
  );

  // Check for active visible dashboard announcements
  const visibleAnnouncements = useMemo(
    () =>
      visibleAnnouncementsFor({
        announcements,
        location: 'is_visible_on_dashboard',
        audience: announcementAudience,
      }),
    [announcements, announcementAudience]
  );
  const hasVisibleAnnouncements = visibleAnnouncements.length > 0;

  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  // Card movement handlers: announcements is forced first at the top and cannot be moved
  const moveWidget = (fromIndex, toIndex) => {
    const fromItem = layout[fromIndex];
    const toItem = layout[toIndex];
    if (fromItem?.id === 'announcements' || toItem?.id === 'announcements') return;
    if (fromIndex < 0 || toIndex < 0 || toIndex >= layout.length) return;
    setLayout((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  // Drag-and-drop snap to grid handlers
  const handleDragStart = (e, index) => {
    if (layout[index]?.id === 'announcements' || index === 0) {
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
    if (draggedIndex === null) return;
    const targetIdx = index === 0 ? 1 : index;
    if (dragOverIndex !== targetIdx) {
      setDragOverIndex(targetIdx);
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
    const targetIdx = index === 0 ? 1 : index;
    if (draggedIndex !== targetIdx) {
      setLayout((prev) => {
        const next = [...prev];
        const [moved] = next.splice(draggedIndex, 1);
        next.splice(targetIdx, 0, moved);
        return next;
      });
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  // Card resizing handlers (colSpan: 1, 2, or 3)
  const setColSpan = (index, colSpan) => {
    if (layout[index]?.id === 'announcements') return; // announcements is fixed full-width at the top
    setLayout((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], colSpan: Math.min(3, Math.max(1, colSpan)) };
      return next;
    });
  };

  // Remove widget handler: neither announcements nor time-status can be removed
  const removeWidget = (index) => {
    const item = layout[index];
    if (item?.id === 'announcements' || item?.id === 'time-status') return;
    setLayout((prev) => prev.filter((_, i) => i !== index));
  };

  // Add widget handler
  const addWidget = (widget) => {
    setLayout((prev) => [...prev, { id: widget.id, colSpan: widget.defaultColSpan || 1 }]);
    setShowAddMenu(false);
  };

  // Reset to station default
  const handleResetToDefault = () => {
    setLayout([...stationDefaultLayout]);
  };

  // Save personal layout to user_settings
  const handleSaveLayout = async () => {
    setSavingLayout(true);
    try {
      const formatted = formatDashboardLayout(layout);
      const targetUserId = currentUser?.id || userSettings?.id || userSettings?.user_id;
      await onSaveUserSettings?.({
        ...(userSettings || {}),
        id: targetUserId,
        user_id: targetUserId,
        dashboard_layout: formatted,
      });
      setIsCustomizing(false);
    } catch {
      // ignore
    } finally {
      setSavingLayout(false);
    }
  };

  // Map column spans to responsive Tailwind classes
  const colSpanClasses = (colSpan) => {
    switch (colSpan) {
      case 2:
        return 'col-span-1 lg:col-span-2 xl:col-span-2';
      case 3:
        return 'col-span-1 lg:col-span-2 xl:col-span-3';
      case 1:
      default:
        return 'col-span-1';
    }
  };

  // Render individual widget component by widget ID
  const renderWidgetContent = (item, index) => {
    switch (item.id) {
      case 'time-status':
        return (
          <TimeAndStatusCard
            isClockedIn={isClockedIn}
            loading={loading}
            offline={offline}
            canUseTimeclock={canUseTimeclock}
            onClockAction={onClockAction}
            timeFormat={timeFormat}
            isCustomizing={isCustomizing}
            onNavigate={onNavigate}
          />
        );

      case 'on-duty':
        return (
          <OnDutyCard
            onDutyUsers={onDutyUsers}
            ranks={ranks}
            schedule={schedule}
            scheduleWindow={scheduleWindow}
            onNeedSchedule={onNeedSchedule}
            scheduleTemplates={scheduleTemplates}
            assignments={assignments}
            users={users}
            currentUser={currentUser}
            timeFormat={timeFormat}
            token={token}
            groupBySchedule={widgetConfigs['on-duty']?.groupBySchedule !== false}
            title={widgetConfigs['on-duty']?.label || 'Currently On Duty'}
            subtitle={widgetConfigs['on-duty']?.description || ''}
          />
        );

      case 'announcements':
        if (!hasVisibleAnnouncements && isCustomizing) {
          return (
            <div className="rounded-2xl border border-dashed border-amber-300/80 dark:border-amber-600/50 bg-amber-50/50 dark:bg-amber-950/20 p-4 text-center">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                Station Announcements (Fixed at Top)
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Active announcements will appear here across the top of the dashboard.
              </p>
            </div>
          );
        }
        return (
          <div className="max-h-[500px] overflow-y-auto pr-0.5">
            <AnnouncementList
              announcements={announcements}
              location="is_visible_on_dashboard"
              audience={announcementAudience}
            />
          </div>
        );

      case 'upcoming-shifts':
        return (
          <UpcomingShiftsWidget
            schedule={schedule}
            scheduleWindow={scheduleWindow}
            onNeedSchedule={onNeedSchedule}
            scheduleTemplates={scheduleTemplates}
            currentUser={currentUser}
            assignments={assignments}
            timeFormat={timeFormat}
            onNavigateToSchedule={() => onNavigate?.('schedule')}
          />
        );

      case 'quick-links':
        return (
          <QuickLinksWidget
            links={widgetConfigs['quick-links']?.customLinks}
            onNavigate={onNavigate}
          />
        );

      case 'weather-radar':
        return (
          <WeatherRadarWidget
            radarUrl={widgetConfigs['weather-radar']?.radarUrl || 'https://radar.weather.gov'}
          />
        );

      case 'apparatus-status':
        return <ApparatusStatusWidget token={token} onNavigate={onNavigate} />;

      case 'assigned-work-orders':
        return (
          <AssignedWorkOrdersWidget
            token={token}
            currentUser={currentUser}
            onNavigate={onNavigate}
            workOrders={workOrders}
          />
        );

      case 'preplans-due':
        return (
          <PreplansDueWidget
            token={token}
            currentUser={currentUser}
            onNavigate={onNavigate}
            onNavigateToMap={onNavigateToMap}
          />
        );

      case 'scheduled-tasks':
        return (
          <ScheduledTasksWidget
            token={token}
            currentUser={currentUser}
            currentRole={currentRole}
            roles={roles}
            onNavigate={onNavigate}
          />
        );

      default: {
        // Custom widget lookup
        const customDef = customWidgets.find((w) => w.id === item.id);
        if (customDef) {
          if (customDef.type === 'links') {
            return <QuickLinksWidget links={customDef.links} onNavigate={onNavigate} />;
          }
          return (
            <CustomMarkdownWidget
              title={customDef.title || 'Notice'}
              content={customDef.content || ''}
            />
          );
        }
        return (
          <div className="h-full max-h-[500px] flex flex-col justify-between overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-xl text-center">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {allWidgetsMap.get(item.id)?.label || item.id}
            </p>
          </div>
        );
      }
    }
  };

  const [headerTarget, setHeaderTarget] = useState(null);

  useEffect(() => {
    setHeaderTarget(document.getElementById('dashboard-header-actions'));
  }, []);

  const headerActionsContent = (
    <div className="flex items-center gap-2">
      {!isCustomizing ? (
        <button
          type="button"
          onClick={() => setIsCustomizing(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 shadow-xs transition"
          title="Customize your dashboard layout"
        >
          <Pencil className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
          <span>Customize</span>
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleResetToDefault}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 transition"
            title="Reset layout to station default"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
            <span>Station Default</span>
          </button>

          {/* Add Widget Picker */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowAddMenu((open) => !open)}
              disabled={unplacedWidgets.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 text-xs font-medium text-slate-800 dark:text-slate-200 transition"
            >
              <Plus className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
              <span>Add Widget</span>
            </button>

            {showAddMenu && unplacedWidgets.length > 0 && (
              <div className="absolute right-0 top-9 z-30 w-64 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-2xl p-2 origin-top-right animate-popoverIn">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Available Widgets
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

          {/* Cancel Edit */}
          <button
            type="button"
            onClick={() => {
              setIsCustomizing(false);
              const userRaw = userSettings?.dashboard_layout;
              setLayout(userRaw ? parseDashboardLayout(userRaw, customWidgets, widgetConfigs) : stationDefaultLayout);
            }}
            className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
          >
            Cancel
          </button>

          {/* Save Layout */}
          <button
            type="button"
            onClick={handleSaveLayout}
            disabled={savingLayout}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold text-xs shadow-md shadow-red-600/20 transition"
          >
            {savingLayout ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span>Save</span>
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Dashboard Customization Bar: render in header inline with Welcome message if target exists */}
      {headerTarget ? (
        createPortal(headerActionsContent, headerTarget)
      ) : (
        <div className="flex items-center justify-end gap-2">{headerActionsContent}</div>
      )}

      {/* Customization Notice Banner */}
      {isCustomizing && (
        <div className="p-3.5 rounded-2xl border border-amber-300 dark:border-amber-700/60 bg-amber-50/80 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2 shadow-xs">
          <div className="flex items-center gap-2 text-xs font-medium">
            <Layers className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>
              <strong>Customizing layout:</strong> Drag cards to reposition (snap to grid), and drag the bottom-right corner handles to resize. Station announcements are permanently fixed at the top.
            </span>
          </div>
        </div>
      )}

      {/* Critical personal alerts (always on top) */}
      <CertificationNotice alerts={certificationAlerts} />

      {/* Responsive Dashboard Grid */}
      <div className="dashboard-grid grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6 items-start">
        {layout.map((item, index) => {
          if (item.id === 'announcements' && !hasVisibleAnnouncements && !isCustomizing) {
            return null;
          }

          const isFixedTop = item.id === 'announcements';
          const isCore = item.id === 'announcements' || item.id === 'time-status';
          const spanClass = colSpanClasses(item.colSpan);

          return (
            <div
              key={item.id}
              draggable={isCustomizing && !isFixedTop}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={(e) => handleDragLeave(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              className={`relative isolate flex flex-col h-full transition-all duration-150 ${spanClass} ${
                isCustomizing
                  ? draggedIndex === index
                    ? 'opacity-40 border-2 border-dashed border-red-500 rounded-2xl p-1 bg-slate-50/50 dark:bg-slate-900/30 scale-[0.98]'
                    : dragOverIndex === index
                    ? 'ring-4 ring-red-500 ring-offset-2 dark:ring-red-400 dark:ring-offset-slate-900 rounded-2xl p-1 bg-red-50/20 dark:bg-red-950/20 scale-[1.01]'
                    : 'ring-2 ring-red-400/40 dark:ring-red-500/30 rounded-2xl p-1 bg-slate-50/50 dark:bg-slate-900/30'
                  : ''
              }`}
            >
              {/* Customizing Controls Toolbar over Card */}
              {isCustomizing && (
                <div className="flex items-center justify-between px-2 py-1 mb-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs">
                  {/* Position controls */}
                  <div className="flex items-center gap-1">
                    {isFixedTop ? (
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300 px-1 py-0.5">
                        <Lock className="w-3 h-3 text-amber-500" />
                        <span>Fixed (Top)</span>
                      </span>
                    ) : (
                      <>
                        {/* Drag Handle */}
                        <div
                          draggable
                          onDragStart={(e) => handleDragStart(e, index)}
                          className="flex items-center gap-1 cursor-grab active:cursor-grabbing px-1.5 py-0.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 select-none transition"
                          title="Drag to reposition widget (snap to grid)"
                        >
                          <GripVertical className="w-3.5 h-3.5" />
                          <span className="text-[10px] font-bold uppercase tracking-wider">Drag</span>
                        </div>

                        <button
                          type="button"
                          onClick={() => moveWidget(index, index - 1)}
                          disabled={index <= 1}
                          className="p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-20 text-slate-600 dark:text-slate-300 transition"
                          title="Move left/up"
                        >
                          <ArrowLeft className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveWidget(index, index + 1)}
                          disabled={index === layout.length - 1}
                          className="p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-20 text-slate-600 dark:text-slate-300 transition"
                          title="Move right/down"
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>

                  {/* Size label and remove button */}
                  {!isFixedTop && (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400 font-medium">
                        {item.colSpan === 3 ? 'Full Width' : `${item.colSpan} Col`}
                      </span>

                      {!isCore ? (
                        <button
                          type="button"
                          onClick={() => removeWidget(index)}
                          className="p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition"
                          title="Remove widget from dashboard"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <span className="text-[10px] font-semibold text-slate-400 px-1">Required</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Render the actual widget */}
              <div className="h-full min-h-0">{renderWidgetContent(item, index)}</div>

              {/* Grabbable Corner Resize Handle */}
              {isCustomizing && !isFixedTop && (
                <WidgetResizeHandle
                  colSpan={item.colSpan}
                  onResize={(newSpan) => setColSpan(index, newSpan)}
                  minColSpan={1}
                  maxColSpan={3}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

