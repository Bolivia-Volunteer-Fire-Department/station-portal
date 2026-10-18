// Helpers and catalog for mobile bottom navigation bar customization.
//
// Admins can configure which 3 primary action modules appear on mobile (< 768px),
// while all other modules remain reachable through the "More" button.

export const MOBILE_NAV_MODULES_KEY = 'mobile_nav_modules';

export const DEFAULT_MOBILE_NAV_MODULES = ['dashboard', 'schedule', 'chat'];

export const AVAILABLE_MOBILE_NAV_MODULES = [
  { id: 'dashboard', label: 'Dashboard', description: 'Station dashboard & widgets', permissionKey: null },
  { id: 'schedule', label: 'Schedule', description: 'Shift calendar & open shifts', permissionKey: 'canViewSchedule' },
  { id: 'chat', label: 'Chat', description: 'Station messages & chat', permissionKey: 'canUseChat' },
  { id: 'availability', label: 'Availability', description: 'Monthly availability submission', permissionKey: 'canEditAvailability' },
  { id: 'roster', label: 'Roster', description: 'Crew member roster directory', permissionKey: 'canViewRoster' },
  { id: 'training', label: 'Trainings', description: 'Training sessions & logs', permissionKey: 'canSignTrainings' },
  { id: 'documents', label: 'Documents', description: 'Standard operating guidelines', permissionKey: 'canViewDocuments' },
  { id: 'work-orders', label: 'Work Orders', description: 'Work orders & repair requests', permissionKey: 'canViewWorkOrders' },
  { id: 'district-map', label: 'Map', description: 'The department boundary drawing', permissionKey: 'canViewMap' },
  { id: 'reports', label: 'Reports', description: 'Reports & forms module', permissionKey: 'canViewReports' },
  { id: 'help', label: 'Help', description: 'Guides & documentation', permissionKey: null },
  // { id: 'settings', label: 'Settings', description: 'User preferences & account', permissionKey: null },
];

export function parseMobileNavModules(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') {
    return [...DEFAULT_MOBILE_NAV_MODULES];
  }
  const parts = rawValue.split(',').map((s) => s.trim()).filter(Boolean);
  const valid = parts.filter((id) => AVAILABLE_MOBILE_NAV_MODULES.some((m) => m.id === id));
  const result = [];
  for (const id of valid) {
    if (!result.includes(id)) {
      result.push(id);
    }
    if (result.length === 3) break;
  }
  for (const def of DEFAULT_MOBILE_NAV_MODULES) {
    if (result.length >= 3) break;
    if (!result.includes(def)) {
      result.push(def);
    }
  }
  return result.slice(0, 3);
}

export function formatMobileNavModules(moduleIds) {
  if (!Array.isArray(moduleIds)) return DEFAULT_MOBILE_NAV_MODULES.join(',');
  return moduleIds.slice(0, 3).join(',');
}

