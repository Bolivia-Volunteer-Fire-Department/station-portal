// Role-based permissions.
//
// The `roles` sheet holds one column per permission and every check in the app
// funnels through this module, so the UI and the backend agree on what each flag
// means. `is_admin` is the master switch: it implies every other permission, which
// is why nothing else has to be set (and why the Roles tab shows the rest as
// locked-on while it is ticked).
//
// The backend (src/services/Code.gs) does NOT import this file - it looks each
// column up by name through hasRolePermission(). That is deliberate: this list is
// then the only place the keys are enumerated, so adding a permission does not
// require a matching list on the server.
//
// Dependency-free apart from the shared TRUE parser, so the rules can be exercised
// directly - see scripts/verify-permissions.mjs.

import { isTruthyFlag } from './rankEligibility';

// Permission flags that unlock a tab in the Administration module. `tab` matches
// the sub-tab ids used by AdminPanel, which is what lets one list gate both the
// navigation and the rendered panel.
export const ADMIN_PERMISSIONS = [
  {
    key: 'can_edit_users',
    tab: 'users',
    label: 'Manage users',
    description: 'Add, edit and remove members, and set each member\'s role and rank.',
  },
  {
    key: 'can_edit_roles',
    tab: 'roles',
    label: 'Manage roles',
    description: 'Create and edit roles and their permissions. A role with Administrator access can only be changed by an administrator.',
  },
  {
    key: 'can_edit_ranks',
    tab: 'ranks',
    label: 'Manage ranks',
    description: 'Add and edit ranks, including their order, colour and icon.',
  },
  {
    key: 'can_edit_schedule_templates',
    tab: 'templates',
    label: 'Manage schedule templates',
    description: 'Define the weekly shifts the schedule is built from. (The shifts sheet itself is edited in the spreadsheet.)',
  },
  {
    key: 'can_edit_assignments',
    tab: 'assignments',
    label: 'Manage assignments',
    description: 'Add and edit assignments, their minimum rank and colour.',
  },
  {
    key: 'can_edit_schedule',
    tab: 'schedule',
    label: 'Manage the schedule',
    description: 'Build and change the schedule: assign members to shifts and add custom shifts.',
  },
  {
    key: 'can_create_events',
    tab: 'events',
    label: 'Create events',
    description: 'Open Events: add non-shift entries such as trainings or meetings to the calendars, and edit or delete them.',
  },
  {
    key: 'can_approve_shifts',
    tab: 'approvals',
    label: 'Approve shift requests',
    description: 'See offers to fill open shifts in Pending Approvals, and switch on "New shift requests" notifications.',
  },
  {
    key: 'can_edit_timeclock',
    tab: 'clock',
    label: 'Manage the timeclock',
    description: 'View and correct other members\' clock in/out records.',
  },
  {
    key: 'can_edit_member_availability',
    tab: 'availability',
    label: 'Manage member availability',
    description: 'View and edit the weekly availability of any member.',
  },
  {
    key: 'can_edit_system_settings',
    tab: 'system',
    label: 'Manage system settings',
    description: 'Change station-wide settings, including the loading messages and defaults.',
  },
  {
    key: 'can_edit_notification_settings',
    tab: 'notifications',
    label: 'Manage notification settings',
    description: 'Configure push notifications. The Firebase (FCM) credentials themselves stay administrator-only.',
  },
  {
    key: 'can_administer_trainings',
    tab: 'training',
    label: 'Administer trainings',
    description: 'Open the Training report: see who signed each training, change any training, and remove signatures.',
  },
  {
    key: 'can_make_announcements',
    tab: 'announcements',
    label: 'Make announcements',
    description: 'Open Announcements: write, edit and delete the messages shown on the login screen, the dashboard and the sidebar, and send them as push notifications.',
  },
  {
    key: 'can_view_system_log',
    tab: 'system-log',
    label: 'View the system log',
    description: 'Read the station activity log: sign-ins and failures, changes made, and notification events.',
  },
];

// Member-facing permissions: these gate modules rather than admin tabs.
export const MEMBER_PERMISSIONS = [
  {
    key: 'can_view_my_schedule',
    label: 'View their schedule',
    description: 'Open the My Schedule module and see their own shifts.',
  },
  {
    key: 'can_make_offers',
    label: 'Offer to fill open shifts',
    description: 'Offer to take an open shift from My Schedule. Requires "View their schedule".',
    requires: 'can_view_my_schedule',
  },
  {
    key: 'can_view_full_schedule',
    label: 'See the whole crew\'s schedule',
    description: 'Use the "Show everyone" toggle in My Schedule. Requires "View their schedule".',
    requires: 'can_view_my_schedule',
  },
  {
    key: 'can_edit_own_availability',
    label: 'Set their own availability',
    description: 'Open the My Availability module and mark the shifts they could work.',
  },
  {
    key: 'can_use_timeclock',
    label: 'Use the timeclock',
    description: 'Clock in and out and open Clock History. Without it a member still sees the clock and who is on duty, just no buttons.',
  },
  {
    key: 'can_sign_trainings',
    label: 'Sign trainings',
    description: 'Open the Training module and sign off the trainings they attended.',
  },
  {
    key: 'can_edit_trainings',
    label: 'Manage trainings',
    description: 'Add and change training activities in the Training module. Requires "Sign trainings".',
    requires: 'can_sign_trainings',
  },
];

// Every permission, for the Roles editor, in display order.
export const ALL_PERMISSIONS = [...ADMIN_PERMISSIONS, ...MEMBER_PERMISSIONS];

export const PERMISSION_KEYS = ALL_PERMISSIONS.map((permission) => permission.key);

// is_admin is not one of the lists above: it is the switch that makes them all true.
export const MASTER_PERMISSION_KEY = 'is_admin';

// There is deliberately no entry for the old Shifts tab: it is not wired into the
// admin nav at all (shift definitions are edited in the spreadsheet), so it needs no
// permission and no mapping.

// Column lookup that tolerates hand-edited headers. The `roles` sheet is maintained
// by hand, so a header can differ from the key only in case, spacing or underscores
// ("Can_Edit_Users", "can edit users", "can_edit_users "). An exact match would read
// those as not granted and silently hide the tab, with nothing to explain why.
const normalizeColumnName = (name) =>
  String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

// Normalized name -> the row's actual key, built once per role object (roles are
// re-fetched as new objects, so the cache follows them).
const columnIndexes = new WeakMap();
const roleColumnIndex = (role) => {
  let index = columnIndexes.get(role);
  if (!index) {
    index = new Map();
    Object.keys(role).forEach((column) => index.set(normalizeColumnName(column), column));
    columnIndexes.set(role, index);
  }
  return index;
};

// The raw sheet value for a permission column, or undefined when the row has no such
// column at all. The difference matters: "no column" means the roles sheet was never
// given that permission, which is a different problem from a column saying FALSE.
export const roleColumnValue = (role, key) => {
  if (!role) return undefined;
  if (Object.prototype.hasOwnProperty.call(role, key)) return role[key];
  const actual = roleColumnIndex(role).get(normalizeColumnName(key));
  return actual === undefined ? undefined : role[actual];
};

// True when the raw sheet value (boolean, or "TRUE"/" true ") counts as granted.
export const permissionGranted = (role, key) => isTruthyFlag(roleColumnValue(role, key));

// 'granted' | 'not granted' | 'no column'. A blank cell counts as "not granted" - it
// is a column that exists and is switched off.
export const permissionColumnState = (role, key) => {
  const value = roleColumnValue(role, key);
  if (value === undefined) return 'no column';
  return permissionGranted(role, key) ? 'granted' : 'not granted';
};

// The Admin tab a permission unlocks, or null for member-facing permissions.
export const permissionTab = (key) => {
  const found = ADMIN_PERMISSIONS.find((permission) => permission.key === key);
  return found ? found.tab : null;
};

// Admin tabs that ride on NO permission column.
//
// Help is the only one: it is documentation, and gating documentation behind a permission
// would hide it from exactly the people most likely to need it. It is still closed to a role
// with no Administration access at all, so it is not a back door into the module - and because
// it has no column, it can never become the tab a role lands on by default.
export const ADMIN_PERMISSIONLESS_TABS = ['help'];

// Whether the role may use a given Administration sub-tab. is_admin passes
// everything; otherwise the tab's own permission decides.
export const roleAllowsTab = (role, tabId) => {
  if (!role) return false;

  // A permissionless tab still needs Administration access to be reachable.
  if (ADMIN_PERMISSIONLESS_TABS.indexOf(tabId) !== -1) return roleHasAdministration(role);

  const direct = ADMIN_PERMISSIONS.find((permission) => permission.tab === tabId);

  // An unrecognised tab id is refused even for an administrator: a typo should fail
  // closed rather than silently pass for admins and fail for everyone else.
  if (!direct) return false;

  if (permissionGranted(role, MASTER_PERMISSION_KEY)) return true;
  return permissionGranted(role, direct.key);
};

// Whether the role may open the Administration module at all: any single admin
// permission is enough, so a role can be given one tab without being an
// administrator.
export const roleHasAdministration = (role) => {
  if (!role) return false;
  if (permissionGranted(role, MASTER_PERMISSION_KEY)) return true;
  return ADMIN_PERMISSIONS.some((permission) => permissionGranted(role, permission.key));
};

// The admin tabs this role may use, in the order AdminPanel expects.
//
// Permission-driven tabs come first so a role's default tab is always one it was actually
// granted; the permissionless ones (Help) trail behind and can never become the landing tab.
export const allowedAdminTabs = (role) => [
  ...ADMIN_PERMISSIONS.filter((permission) => roleAllowsTab(role, permission.tab)).map(
    (permission) => permission.tab
  ),
  ...ADMIN_PERMISSIONLESS_TABS.filter((tab) => roleAllowsTab(role, tab)),
];

// Whether a permission checkbox is locked on because is_admin is ticked.
export const permissionLockedByAdmin = (role, key) =>
  key !== MASTER_PERMISSION_KEY && permissionGranted(role, MASTER_PERMISSION_KEY);

// Whether a permission is unavailable because something it depends on is off.
export const permissionBlockedByDependency = (role, key) => {
  // Administrator access satisfies every prerequisite, so nothing is blocked under
  // it - otherwise ticking "Administrator access" would leave dependent boxes
  // unchecked even though that role can do everything.
  if (permissionGranted(role, MASTER_PERMISSION_KEY)) return false;

  const permission = ALL_PERMISSIONS.find((entry) => entry.key === key);
  if (!permission?.requires) return false;
  return !permissionGranted(role, permission.requires);
};

// What should actually be SAVED for a permission, once the master switch and the
// dependencies are applied. Keeps the sheet free of combinations the UI cannot
// express (e.g. can_make_offers without can_view_my_schedule).
export const resolvePermissionValue = (formRole, key) => {
  // is_admin forces every other permission TRUE - the sheet should read all-TRUE
  // for an administrator, matching the boxes the editor shows locked on.
  if (key !== MASTER_PERMISSION_KEY && permissionGranted(formRole, MASTER_PERMISSION_KEY)) return true;
  if (permissionBlockedByDependency(formRole, key)) return false;
  return permissionGranted(formRole, key);
};

// The full permission set to send when saving a role.
export const roleFieldsFromForm = (formRole) => {
  const fields = { [MASTER_PERMISSION_KEY]: resolvePermissionValue(formRole, MASTER_PERMISSION_KEY) };
  PERMISSION_KEYS.forEach((key) => {
    fields[key] = resolvePermissionValue(formRole, key);
  });
  return fields;
};

// Columns that look like a permission but match nothing this app knows about. A typo
// such as `can_edit_schedule_template` (singular) is otherwise invisible: it simply
// reads as not granted and its tab never appears, with nothing to explain why.
export const unknownRoleColumns = (role) => {
  if (!role) return [];
  const known = new Set(
    [...PERMISSION_KEYS, MASTER_PERMISSION_KEY, 'id', 'description', 'name', 'sort_order'].map(
      normalizeColumnName
    )
  );
  return Object.keys(role).filter((column) => {
    const normalized = normalizeColumnName(column);
    if (known.has(normalized)) return false;
    return normalized.startsWith('can') || normalized.includes('admin');
  });
};

// Everything needed to explain a role's access: what it grants, which permission
// columns the roles sheet does not have, and any column that looks like a typo. This
// drives the "Your access" card in User Settings, which is the fastest way to tell a
// misconfigured sheet (columns missing or misspelled) from a misconfigured role.
export const rolePermissionAudit = (role) => {
  const granted = [];
  const missing = [];
  // The master switch is checked once rather than per permission: `permissionGranted`
  // reads a single column, so it knows nothing about is_admin implying the rest.
  const masterGranted = permissionGranted(role, MASTER_PERMISSION_KEY);

  ALL_PERMISSIONS.forEach((permission) => {
    // Access first: an administrator is granted everything whether or not the
    // individual columns exist.
    if (masterGranted || permissionGranted(role, permission.key)) {
      granted.push(permission);
      return;
    }
    // Not granted - if there is no column at all, the roles sheet is missing it, which
    // is worth reporting. A column that exists and says FALSE is a deliberate choice,
    // so it is not.
    if (roleColumnValue(role, permission.key) === undefined) missing.push(permission);
  });
  return {
    masterState: permissionColumnState(role, MASTER_PERMISSION_KEY),
    granted,
    missing,
    unknownColumns: unknownRoleColumns(role),
    allowedTabs: allowedAdminTabs(role),
  };
};

// Whether the Pending Approvals tab should claim focus because NEW offers arrived.
//
// Deliberately compares counts rather than asking "is anything pending": re-jumping
// whenever the count is non-zero drags the user back to approvals every time they
// open another tab while an offer waits, which is the flash-and-return bug this
// prevents.
export const shouldFocusApprovals = (previousCount, pendingCount, allowedTabs) => {
  if (!Array.isArray(allowedTabs) || !allowedTabs.includes('approvals')) return false;
  return Number(pendingCount) > Number(previousCount ?? 0);
};

