// Short page labels for the mobile app bar.
//
// The bar appends the current page once the page's own heading has scrolled out of sight, so a reader
// deep in a long table still knows where they are: "Station Portal — Administration".
//
// These are deliberately SHORTER than the page headings. The heading for the dashboard is
// "Welcome, Matthew", which would not fit beside the app name on a phone, so the bar says "Dashboard".
// The two are separate on purpose rather than one being derived from the other.
export const PAGE_BAR_LABELS = {
  dashboard: 'Dashboard',
  'clock-history': 'Clock History',
  schedule: 'My Schedule',
  availability: 'My Availability',
  training: 'Training',
  help: 'Help',
  settings: 'User Settings',
  admin: 'Administration',
};

// Short names for the Administration sub-tabs, for the app bar's "Admin: …" label.
//
// Shorter than the navigation labels on purpose: "Admin: Schedule Mgt" fits beside the app name on a
// phone, "Administration: Schedule Management" does not. Keyed by the same ids as
// ADMIN_NAV_CATEGORIES, and a test asserts every one of those ids has an entry, so adding a tab cannot
// silently produce "Admin: " with nothing after it.
export const ADMIN_BAR_LABELS = {
  users: 'Users',
  roles: 'Roles',
  ranks: 'Ranks',
  templates: 'Templates',
  assignments: 'Assignments',
  schedule: 'Schedule Mgt',
  events: 'Events',
  availability: 'Availability',
  approvals: 'Approvals',
  clock: 'Clock Mgt',
  announcements: 'Announcements',
  training: 'Training',
  system: 'Settings',
  notifications: 'Notifications',
  // The nav id is `system-log`, not `log`: an id-based lookup has to match the navigation exactly, and a
  // test asserts every id in ADMIN_NAV_CATEGORIES has an entry here.
  'system-log': 'System Log',
  help: 'Help',
};

export const adminBarLabel = (subTabId) => ADMIN_BAR_LABELS[String(subTabId || '')] || '';

// The label for the app bar.
//
// Administration is the only page with a sub-page, so it reads "Admin: Schedule Mgt" rather than the
// bare "Administration" - which would be true but useless once you are three screens deep in a table.
// An unknown sub-tab falls back to the page name rather than to a dangling "Admin: ".
export const pageBarLabel = (tabId, subTabId) => {
  const tab = String(tabId || '');

  if (tab === 'admin') {
    const sub = adminBarLabel(subTabId);
    return sub ? `Admin: ${sub}` : 'Administration';
  }

  return PAGE_BAR_LABELS[tab] || '';
};
