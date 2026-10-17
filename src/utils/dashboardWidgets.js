// Dashboard widget catalog, default layout, and helpers.
//
// The Dashboard is a customizable card-based grid layout.
// - Slot (0,0) is permanently locked to the combined Time & Current Status card (TimeAndStatusCard).
// - Other widgets can be enabled/disabled, repositioned, resized (1 col, 2 col, or 3 col full-width),
//   and customized by administrators (Station Default Layout) or individual members (Personal Layout).

export const DASHBOARD_DEFAULT_LAYOUT_KEY = 'dashboard_default_layout';
export const DASHBOARD_CUSTOM_WIDGETS_KEY = 'dashboard_custom_widgets';
export const DASHBOARD_WIDGET_CONFIGS_KEY = 'dashboard_widget_configs';

// Built-in standard widget types available on the dashboard
export const BUILTIN_WIDGETS = [
  {
    id: 'announcements',
    label: 'Station Announcements',
    description: 'Broadcast messages and important department bulletins.',
    defaultColSpan: 3,
    minColSpan: 1,
    maxColSpan: 3,
    category: 'Communication',
  },
  {
    id: 'time-status',
    label: 'Station Time & Current Status',
    description: 'Digital station clock, member duty indicator, and Clock In/Out button.',
    defaultColSpan: 1,
    minColSpan: 1,
    maxColSpan: 3,
    category: 'System',
  },
  {
    id: 'on-duty',
    label: 'Who Is On Duty',
    description: 'Live roster of all crew members currently clocked in and on duty.',
    defaultColSpan: 2,
    minColSpan: 1,
    maxColSpan: 3,
    category: 'Crew',
  },
  {
    id: 'upcoming-shifts',
    label: 'Upcoming Shifts & Open Shifts',
    description: 'Your scheduled shifts and open shifts available for coverage.',
    defaultColSpan: 2,
    minColSpan: 1,
    maxColSpan: 3,
    category: 'Scheduling',
  },
  {
    id: 'apparatus-status',
    label: 'Apparatus Fleet Status',
    description: 'Fleet readiness, unit callsigns, vehicle types, and in-service status.',
    defaultColSpan: 2,
    minColSpan: 1,
    maxColSpan: 3,
    category: 'Operations',
  },
  {
    id: 'quick-links',
    label: 'Quick Action Links',
    description: 'Department links to CAD dispatch, county GIS, and active resources.',
    defaultColSpan: 1,
    minColSpan: 1,
    maxColSpan: 3,
    category: 'Resources',
  },
  {
    id: 'weather-radar',
    label: 'Live Weather & Radar',
    description: 'Weather radar quick view and active weather conditions.',
    defaultColSpan: 1,
    minColSpan: 1,
    maxColSpan: 3,
    category: 'Resources',
  },
  {
    id: 'assigned-work-orders',
    label: 'Assigned Work Orders',
    description: 'Maintenance and repair tickets assigned to you for action.',
    defaultColSpan: 2,
    minColSpan: 1,
    maxColSpan: 3,
    category: 'Operations',
  },
];

// Factory default station layout:
// Row 1: [Station Announcements (3 col)]
// Row 2: [Time & Status (1 col)] [Who Is On Duty (2 col)]
// Row 3: [Upcoming Shifts (2 col)] [Apparatus Status (1 col)]
// Row 4: [Quick Links (1 col)] [Live Weather & Radar (1 col)]
export const FACTORY_DEFAULT_LAYOUT = [
  { id: 'announcements', colSpan: 3 },
  { id: 'time-status', colSpan: 1 },
  { id: 'on-duty', colSpan: 2 },
  { id: 'upcoming-shifts', colSpan: 2 },
  { id: 'apparatus-status', colSpan: 1 },
  { id: 'quick-links', colSpan: 1 },
  { id: 'weather-radar', colSpan: 1 },
];

// Default sample links for quick links widget
export const DEFAULT_QUICK_LINKS = [
  { id: 'cad', label: 'CAD Dispatch Portal', url: 'https://www.google.com', external: true },
  { id: 'gis', label: 'County GIS / Hydrants', url: 'https://www.google.com', external: true },
  { id: 'weather', label: 'NOAA National Weather', url: 'https://radar.weather.gov', external: true },
  { id: 'sops', label: 'Standard Operating Guidelines', url: '#documents', external: false },
];

/**
 * Parses custom widgets array from raw JSON string or object.
 */
export function parseCustomWidgets(rawValue) {
  if (!rawValue) return [];
  if (Array.isArray(rawValue)) return rawValue;
  if (typeof rawValue === 'string') {
    try {
      const parsed = JSON.parse(rawValue);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Serializes custom widgets array to JSON.
 */
export function formatCustomWidgets(widgets) {
  return JSON.stringify(Array.isArray(widgets) ? widgets : []);
}

/**
 * Parses widget configs (enable/disable, custom audience) from raw JSON.
 */
export function parseWidgetConfigs(rawValue) {
  if (!rawValue) return {};
  if (typeof rawValue === 'object' && rawValue !== null) return rawValue;
  if (typeof rawValue === 'string') {
    try {
      const parsed = JSON.parse(rawValue);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Serializes widget configs map to JSON.
 */
export function formatWidgetConfigs(configs) {
  return JSON.stringify(typeof configs === 'object' && configs !== null ? configs : {});
}

/**
 * Returns complete catalog of widgets: built-ins + custom widgets.
 */
export function getAllAvailableWidgets(customWidgets = [], widgetConfigs = {}) {
  const configs = typeof widgetConfigs === 'object' && widgetConfigs !== null ? widgetConfigs : {};
  const builtins = BUILTIN_WIDGETS.map((w) => {
    const config = configs[w.id];
    return {
      ...w,
      label: config?.label ? config.label : w.label,
      description: config?.description ? config.description : w.description,
    };
  });
  const customItems = (Array.isArray(customWidgets) ? customWidgets : []).map((w) => {
    const config = configs[w.id];
    return {
      id: w.id,
      label: config?.label ? config.label : (w.title || 'Custom Card'),
      description: config?.description
        ? config.description
        : (w.description || (w.type === 'markdown' ? 'Custom markdown notice' : 'Custom widget')),
      defaultColSpan: w.defaultColSpan || 1,
      minColSpan: 1,
      maxColSpan: 3,
      category: 'Custom',
      isCustom: true,
      customData: w,
    };
  });
  return [...builtins, ...customItems];
}

/**
 * Validates and parses a dashboard layout array.
 * Ensures both 'announcements' and 'time-status' are present.
 * For member layouts (forceAnnouncementsFirst !== false), forces announcements to index 0.
 * For admin default layouts (forceAnnouncementsFirst === false), respects admin's exact ordering.
 */
export function parseDashboardLayout(rawValue, customWidgets = [], widgetConfigs = {}, options = {}) {
  let items = [];
  if (Array.isArray(rawValue)) {
    items = rawValue;
  } else if (typeof rawValue === 'string' && rawValue.trim()) {
    try {
      const parsed = JSON.parse(rawValue);
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      items = [];
    }
  }

  // Fall back to factory default if nothing valid was stored
  if (items.length === 0) {
    items = [...FACTORY_DEFAULT_LAYOUT];
  }

  const catalog = getAllAvailableWidgets(customWidgets);
  const catalogIds = new Set(catalog.map((w) => w.id));

  // Filter items that exist in catalog, deduplicating IDs
  const seen = new Set();
  const validItems = [];

  for (const item of items) {
    if (!item || !item.id) continue;
    if (seen.has(item.id)) continue;
    if (!catalogIds.has(item.id)) continue;

    // Check if widget was disabled by admin in widgetConfigs
    const config = widgetConfigs[item.id];
    if (config && config.enabled === false && item.id !== 'time-status' && item.id !== 'announcements') continue;

    seen.add(item.id);
    const colSpan = Math.min(3, Math.max(1, Number(item.colSpan) || (item.id === 'announcements' ? 3 : 1)));
    validItems.push({ id: item.id, colSpan });
  }

  // Ensure 'announcements' is always present
  if (!seen.has('announcements')) {
    validItems.unshift({ id: 'announcements', colSpan: 3 });
    seen.add('announcements');
  }

  // Ensure 'time-status' is always present
  if (!seen.has('time-status')) {
    validItems.push({ id: 'time-status', colSpan: 1 });
    seen.add('time-status');
  }

  // If forceAnnouncementsFirst is true (default for member dashboard), ensure announcements is first
  if (options.forceAnnouncementsFirst !== false) {
    const annIdx = validItems.findIndex((it) => it.id === 'announcements');
    if (annIdx > 0) {
      const [ann] = validItems.splice(annIdx, 1);
      validItems.unshift(ann);
    }
  }

  return validItems;
}

/**
 * Serializes dashboard layout array to JSON.
 * Preserves exact widget order and colSpans for all widgets.
 */
export function formatDashboardLayout(layoutItems) {
  if (!Array.isArray(layoutItems)) return JSON.stringify(FACTORY_DEFAULT_LAYOUT);
  const normalized = [];
  const seen = new Set();

  for (const item of layoutItems) {
    if (!item || !item.id) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    normalized.push({
      id: item.id,
      colSpan: Math.min(3, Math.max(1, Number(item.colSpan) || 1)),
    });
  }

  // Ensure both announcements and time-status are present
  if (!seen.has('announcements')) {
    normalized.unshift({ id: 'announcements', colSpan: 3 });
  }
  if (!seen.has('time-status')) {
    normalized.push({ id: 'time-status', colSpan: 1 });
  }

  return JSON.stringify(normalized);
}

