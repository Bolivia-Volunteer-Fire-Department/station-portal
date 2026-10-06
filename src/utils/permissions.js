// Role-based permissions.
//
// The `roles` sheet holds one column per permission and every check in the app
// funnels through this module, so the UI and the backend agree on what each flag
// means. `is_admin` is the master switch: it implies every other permission, which
// is why nothing else has to be set (and why the Roles tab shows the rest as
// locked-on while it is ticked).
//
// Nothing imports this list as code - the security rules and the callables each name their
// column up by name through hasRolePermission(). That is deliberate: this list is
// then the only place the keys are enumerated, so adding a permission does not
// require a matching list on the server.
//
// Dependency-free apart from the shared TRUE parser, so the rules can be exercised
// directly - see scripts/verify-permissions.mjs.

// The `.js` is not optional here. This module is imported by firestoreReads.js, which the firestore harnesses load
// through plain Node ESM, and Node will not resolve an extensionless relative specifier - so a bare './rankEligibility'
// failed the whole read with ERR_MODULE_NOT_FOUND, in a place that had never loaded this file before. The app's bundler
// hides that class of mistake, which is exactly why it survived until a second importer arrived.
import { isTruthyFlag } from './rankEligibility.js';

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
    description: 'Add and edit ranks, including their order, color and icon.',
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
    description: 'Add and edit assignments, their minimum rank and color.',
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
    key: 'can_edit_availability_windows',
    tab: 'availability-windows',
    // THE WINDOWS ARE THE OPTIONS LIST, and this is its own permission rather than half of the one above. They started as
    // one - the windows were the options for the claims, so maintaining one meant maintaining the other - but they are
    // different jobs: configuring what the station's week looks like is a station-wide decision, while reading and
    // correcting a member's claims is day-to-day work. Sharing a permission meant an officer could not be given the roster
    // without also being handed the shape of the station's week.
    label: 'Manage availability windows',
    description: 'Define the weekly availability windows members choose from: the nickname, hours and days of each.',
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
    key: 'can_manage_documents',
    tab: 'documents',
    label: 'Manage documents',
    description: 'Open Documents: write and edit documents, their folders and checklists, set who may read each one, and see or remove signatures. Requires "View documents".',
    // Managing documents you cannot see is not a thing, so seeing them is a prerequisite here as well as on the
    // verifier's permission. The Roles editor locks this box until "View documents" is ticked, and the server
    // applies the same rule to every action - see the documents rules in firestore.rules.
    requires: 'can_view_documents',
  },
  {
    // Two tabs, and therefore two permissions - the Roles model maps one permission to one tab, and the split
    // is real: recording who holds what is a supervisor's job, while defining what the station tracks is an
    // administrator's.
    key: 'can_manage_certifications',
    tab: 'certifications',
    label: 'Manage certifications',
    description: 'Open Certifications: record what each member holds, with effective and end dates, and remove records. Renewals are added rather than overwritten, so the history stays.',
  },
  {
    key: 'can_manage_certification_setup',
    tab: 'certification-setup',
    label: 'Set up certifications',
    description: 'Open Certification Setup: define the certifications the station tracks, their icon, whether each can be renewed, and where current certifications are shown. Requires "Manage certifications".',
    requires: 'can_manage_certifications',
  },
  {
    key: 'can_view_system_log',
    tab: 'system-log',
    label: 'View the audit log',
    description:
      'Read the station audit trail: sign-ins and failures, the account actions officers take, and notification events. Read on demand from Cloud Logging when the tab is opened, so it costs nothing to keep.',
  },
  {
    key: 'can_access_debug',
    tab: 'debug',
    label: 'Access the debug page',
    description: 'Open Debug: fire test toasts, modals and sounds on demand, to check what the app shows and plays without waiting for a real event.',
  },
  {
    key: 'can_configure_reports',
    tab: 'reports-config',
    label: 'Configure reports',
    description: 'Create and edit report definitions and choose which roles and ranks may use each report. Requires "View reports".',
    requires: 'can_view_reports',
  },
  {
    key: 'can_configure_forms',
    tab: 'forms-config',
    label: 'Configure forms',
    description: 'Create and edit printable form definitions: which blank PDF a form fills, which data it draws from, and where each value goes. Choose which roles and ranks may generate each one.',
  },
];

// Member-facing permissions: these gate modules rather than admin tabs.
export const MEMBER_PERMISSIONS = [
  {
    key: 'can_view_my_schedule',
    label: 'View their schedule',
    description: 'Open the Schedule module and see their own shifts.',
  },
  {
    key: 'can_make_offers',
    label: 'Offer to fill open shifts',
    description: 'Offer to take an open shift from Schedule. Requires "View their schedule".',
    requires: 'can_view_my_schedule',
  },
  {
    key: 'can_view_full_schedule',
    label: 'See the whole crew\'s schedule',
    description: 'Use the "Show everyone" toggle in Schedule. Requires "View their schedule".',
    requires: 'can_view_my_schedule',
  },
  {
    key: 'can_edit_own_availability',
    label: 'Set their own availability',
    description: 'Open the Availability module and mark the shifts they could work.',
  },
  {
    key: 'can_use_timeclock',
    label: 'Use the timeclock',
    description: 'Clock in and out and open Clock History. Without it a member still sees the clock and who is on duty, just no buttons.',
  },
  {
    key: 'can_view_roster',
    label: 'View roster',
    description: 'Open the Roster module to see active members, their ranks, and current certifications marked for display.',
  },
  {
    key: 'can_view_reports',
    label: 'View reports',
    description: 'Open Reports and run reports shared with your role or rank.',
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
  {
    // There is deliberately no `can_view_certifications`.
    // It existed for one deploy and did exactly what a permission with no column yet does: it hid the member's
    // own certifications from EVERY member, because the roles sheet had not been given the column (the Roles
    // editor writes only columns that already exist, see upsertSheetRowById). A screen whose whole content is
    // "what the station has recorded about you" is not a management act, so it is open to everybody - like Help
    // - and the two permissions that remain are about RECORDING (can_manage_certifications) and DEFINING
    // (can_manage_certification_setup), which are.
    //
    // The floor for the Documents module: without this a member has no Documents tab, and the server refuses
    // every documents action. It is a MEMBER permission rather than an administrative one, because reading the
    // station's documents is a member-facing ability - and because it is what the other two rest on.
    key: 'can_view_documents',
    label: 'View documents',
    description: 'Open the Documents module: read the station documents and checklists shared with this role and rank.',
  },
  {
    key: 'can_verify_documents',
    label: 'Verify signatures',
    // Deliberately a member permission rather than an administration one: an officer checking that a new
    // member's truck checklist was really done is not an administrator, and should not need to become one.
    // Verifying happens on the Documents tab, which this permission opens on its own.
    //
    // The KEY is still `can_verify_documents` and stays that way: it names the paperwork, as the other document
    // permissions do, and it is stored on every role that already has it. Only the label moved, when the same panel
    // started confirming a document's whole signature as well as a checklist's items.
    description:
      'Confirm what another member has signed: the items of a checklist, or a document whose author asked for its signature to be confirmed. From Documents. Requires "View documents". Nobody can verify their own work.',
    requires: 'can_view_documents',
  },
  {
    // Recording an assessment result is RECORDING, not defining - the assessment itself is a document and is written
    // with "Manage documents", exactly like any other. So this is a separate permission from that one rather than a
    // part of it: a station may well want somebody who runs the agility test every month to be able to enter the result
    // without also being able to rewrite the test's wording or delete the document.
    //
    // A member permission, not an administration one, for the same reason `can_verify_documents` is: entering a score
    // happens on the Documents module, which is not an Administration tab.
    key: 'can_add_assessment_scores',
    label: 'Add assessment scores',
    description:
      'Enter and change an assessment score for another member, with the date it was taken, from Documents. Members can read their own score but can never change it, including their own - this permission is the only way any score is written. Requires "View documents".',
    requires: 'can_view_documents',
  },
  {
    // Generating a printable form. WHO may generate WHICH form is decided by each definition's own AUDIENCE, not by a
    // permission - a permission cannot say "this rank, not that one", and every form needs a different answer. So this
    // is one flag for the module, and the audience does the rest.
    key: 'can_generate_forms',
    label: 'Generate forms',
    description: 'Open Forms and generate the printable PDFs shared with their role or rank.',
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

  // A tab is found by the permission that OWNS it, or by one that merely includes it: `moreTabs` is how a permission
  // reaches a second screen of the same responsibility (member availability and the windows it offers), which is the
  // mirror of the tab two permissions open, below.
  const direct = ADMIN_PERMISSIONS.find(
    (permission) => permission.tab === tabId || (permission.moreTabs || []).includes(tabId)
  );

  // An unrecognized tab id is refused even for an administrator: a typo should fail
  // closed rather than silently pass for admins and fail for everyone else.
  if (!direct) return false;

  if (permissionGranted(role, MASTER_PERMISSION_KEY)) return true;

  // Documents is the one tab two permissions open, and deliberately so. `can_manage_documents` is the obvious
  // one; `can_verify_documents` needs it as well, because that is where a verifier goes to confirm another
  // member's signed items - the officer checking a new member's truck checklist should not have to be able to
  // edit the checklist to confirm it was done.
  //
  // Seeing documents is the floor for both, so a role that cannot see them has no documents tab however its row
  // was written: the Roles editor refuses to store either permission without it, and this is the same rule applied
  // to whatever is on the sheet. Everything either permission opens behind this tab is decided again inside the
  // tab, and again on the server.
  if (tabId === 'documents') {
    if (!permissionGranted(role, 'can_view_documents')) return false;
    if (permissionGranted(role, direct.key)) return true;
    return permissionGranted(role, 'can_verify_documents');
  }

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
  ...ADMIN_PERMISSIONS.flatMap((permission) =>
    roleAllowsTab(role, permission.tab) ? [permission.tab, ...(permission.moreTabs || [])] : []
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

