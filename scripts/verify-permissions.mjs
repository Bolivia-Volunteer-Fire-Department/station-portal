// Verifies the role-permission rules (utils/permissions).
//
// This is the model every gate in the app reads - the admin tabs, the module
// navigation, the schedule calendar and the User Settings switches - so the
// interesting cases are the master switch (`is_admin` grants everything), a single
// permission opening exactly one tab, and the dependency rules the Roles editor
// draws as locked checkboxes. A mistake here either locks a role out of what it was
// granted or shows it something it cannot use.
//
// Run with: npm run verify:permissions
import {
  ADMIN_PERMISSION_GROUPS,
  ADMIN_PERMISSIONS,
  ADMIN_PERMISSIONLESS_TABS,
  ALL_PERMISSIONS,
  MASTER_PERMISSION_KEY,
  MEMBER_PERMISSION_GROUPS,
  MEMBER_PERMISSIONS,
  PERMISSION_KEYS,
  allowedAdminTabs,
  permissionBlockedByDependency,
  permissionColumnState,
  permissionGranted,
  permissionsByGroup,
  permissionLockedByAdmin,
  permissionTab,
  resolvePermissionValue,
  roleAllowsTab,
  roleFieldsFromForm,
  roleHasAdministration,
  rolePermissionAudit,
  shouldFocusApprovals,
  unknownRoleColumns,
} from '../src/utils/permissions.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${
      ok ? '' : ` (expected ${JSON.stringify(expected)})`
    }`
  );
};

const ALL_TABS = ADMIN_PERMISSIONS.flatMap((permission) => [permission.tab, ...(permission.moreTabs || [])]);
// The permission-driven tabs plus the permissionless ones (Help), which trail behind and are
// granted to anyone with Administration access.
const ALL_TABS_WITH_PERMISSIONLESS = [...ALL_TABS, ...ADMIN_PERMISSIONLESS_TABS];

console.log('--- the catalog is well formed ---');
check('every permission has a label and description', ALL_PERMISSIONS.every((p) => p.label && p.description), true);
check('keys are unique', new Set(PERMISSION_KEYS).size, PERMISSION_KEYS.length);
check('keys are all can_* columns', PERMISSION_KEYS.every((key) => key.startsWith('can_')), true);
check('admin tabs are unique', new Set(ALL_TABS).size, ALL_TABS.length);
check('is_admin is not listed as a normal permission', PERMISSION_KEYS.includes(MASTER_PERMISSION_KEY), false);
check(
  'every dependency points at a real permission',
  ALL_PERMISSIONS.filter((p) => p.requires).every((p) => PERMISSION_KEYS.includes(p.requires)),
  true
);
check('permissionTab maps approvals to its tab', permissionTab('can_approve_shifts'), 'approvals');
check('permissionTab is null for a member permission', permissionTab('can_use_timeclock'), null);
check('View roster is a member permission, not an Administration tab', permissionTab('can_view_roster'), null);

console.log('\n--- the catalog is grouped for the form ---');
// THE GROUPS ARE A SECOND STATEMENT ABOUT THE SAME LIST, so what matters is that they agree with it: every permission is
// under exactly one heading, no heading is empty, and a permission nobody mentions is a failure rather than a permission
// that quietly stops being grantable (permissionsByGroup would file it under "Other").
const adminSections = permissionsByGroup(ADMIN_PERMISSIONS, ADMIN_PERMISSION_GROUPS);
const memberSections = permissionsByGroup(MEMBER_PERMISSIONS, MEMBER_PERMISSION_GROUPS);
const groupedKeys = [...ADMIN_PERMISSION_GROUPS, ...MEMBER_PERMISSION_GROUPS].flatMap((group) => group.keys);
check('no permission is filed under "Other"', [...adminSections, ...memberSections].some((s) => s.label === 'Other'), false);
check('every group names real permissions', groupedKeys.every((key) => PERMISSION_KEYS.includes(key)), true);
check('no permission is named twice', new Set(groupedKeys).size, groupedKeys.length);
check(
  'and every permission is named somewhere',
  ALL_PERMISSIONS.every((permission) => groupedKeys.includes(permission.key)),
  true
);
check('no group is empty', [...adminSections, ...memberSections].every((section) => section.permissions.length > 0), true);
check(
  'no heading is used twice in a list',
  [ADMIN_PERMISSION_GROUPS, MEMBER_PERMISSION_GROUPS].every(
    (groups) => new Set(groups.map((group) => group.label)).size === groups.length
  ),
  true
);
// THE COUNTS ARE PINNED so that adding a permission makes somebody choose a heading for it, which is the moment the
// grouping is worth re-reading. Both lists are drawn whole: nothing may be lost between the array and the form.
check('the admin list is drawn whole, under six headings', [adminSections.length, adminSections.reduce((n, s) => n + s.permissions.length, 0)], [6, ADMIN_PERMISSIONS.length]);
check('and the member list under three', [memberSections.length, memberSections.reduce((n, s) => n + s.permissions.length, 0)], [3, MEMBER_PERMISSIONS.length]);
check('the headings are in the order they were written', adminSections.map((s) => s.label), ['People', 'Scheduling', 'Records', 'Communication', 'Reports & forms', 'Station setup']);
check('and the chat permissions share one', memberSections[memberSections.length - 1].label, 'Chat');
check('with the door first', memberSections[memberSections.length - 1].permissions[0].key, 'can_use_chat');
// An empty list is an empty list rather than a crash - the form draws this on the way in, before any role is chosen.
check('and an empty catalog is an empty form', permissionsByGroup(undefined, undefined), []);
check('a permission with no heading is still drawn', permissionsByGroup([{ key: 'can_use_chat', label: 'Chat' }], []), [{ label: 'Other', permissions: [{ key: 'can_use_chat', label: 'Chat' }] }]);
check('and an empty group leaves no bare heading', permissionsByGroup([{ key: 'can_use_chat' }], [{ label: 'People', keys: ['can_edit_users'] }]), [{ label: 'Other', permissions: [{ key: 'can_use_chat' }] }]);

console.log('\n--- TRUE parsing (the sheet stores booleans or the text TRUE) ---');
check('boolean true', permissionGranted({ can_edit_users: true }, 'can_edit_users'), true);
check('the string TRUE', permissionGranted({ can_edit_users: 'TRUE' }, 'can_edit_users'), true);
check('a padded lowercase " true "', permissionGranted({ can_edit_users: ' true ' }, 'can_edit_users'), true);
check('boolean false', permissionGranted({ can_edit_users: false }, 'can_edit_users'), false);
check('the string FALSE', permissionGranted({ can_edit_users: 'FALSE' }, 'can_edit_users'), false);
check('an empty cell', permissionGranted({ can_edit_users: '' }, 'can_edit_users'), false);
check('a missing column', permissionGranted({}, 'can_edit_users'), false);
check('a null role', permissionGranted(null, 'can_edit_users'), false);

console.log('\n--- is_admin is the master switch ---');
const admin = { is_admin: true };
check('an administrator can use every tab', ALL_TABS_WITH_PERMISSIONLESS.every((tab) => roleAllowsTab(admin, tab)), true);
check('an administrator reaches Administration', roleHasAdministration(admin), true);
check('an administrator gets every tab id', allowedAdminTabs(admin), ALL_TABS_WITH_PERMISSIONLESS);
check('the string TRUE works too', roleAllowsTab({ is_admin: 'TRUE' }, 'users'), true);

console.log('\n--- one permission opens exactly one tab ---');
const approver = { can_approve_shifts: 'TRUE' };
check('approvals is allowed', roleAllowsTab(approver, 'approvals'), true);
check('users is not', roleAllowsTab(approver, 'users'), false);
check('the schedule board is not', roleAllowsTab(approver, 'schedule'), false);
check('but Administration DOES open', roleHasAdministration(approver), true);
check('with only that tab listed', allowedAdminTabs(approver), ['approvals', ...ADMIN_PERMISSIONLESS_TABS]);
// TWO PERMISSIONS, TWO TABS, AND THE SPLIT IS DELIBERATE: the windows are the station's own options list - a station-wide
// configuration - while the roster is one member's claims. These assert the SEPARATION, which is what stops a later edit
// folding them back together: one permission governing both meant an officer could not be given the roster without also
// being handed the shape of the station's week.
check(
  'managing member availability opens only the roster',
  allowedAdminTabs({ can_edit_member_availability: true }),
  ['availability', ...ADMIN_PERMISSIONLESS_TABS]
);
check(
  'and managing windows opens only the windows tab',
  allowedAdminTabs({ can_edit_availability_windows: true }),
  ['availability-windows', ...ADMIN_PERMISSIONLESS_TABS]
);

console.log('\n--- a role with nothing granted ---');
const nothing = { is_admin: false };
check('cannot open Administration', roleHasAdministration(nothing), false);
check('has no tabs', allowedAdminTabs(nothing), []);
check('cannot use any tab', ALL_TABS.some((tab) => roleAllowsTab(nothing, tab)), false);
check('a missing role has no tabs', allowedAdminTabs(null), []);

console.log('\n--- the retired Shifts tab ---');
// It is no longer wired into the admin nav at all, so it must not be reachable even
// for a role that could edit schedule templates.
check('is not allowed for an administrator', roleAllowsTab(admin, 'shifts'), false);
check('is not allowed for a template editor', roleAllowsTab({ can_edit_schedule_templates: 'TRUE' }, 'shifts'), false);
check('is not listed for an administrator', allowedAdminTabs(admin).includes('shifts'), false);
check('and stays out of the tab list', allowedAdminTabs({ can_edit_schedule_templates: 'TRUE' }), ['templates', ...ADMIN_PERMISSIONLESS_TABS]);
check('an unknown tab is refused', roleAllowsTab(admin, 'nope'), false);

console.log('\n--- dependencies lock the dependent boxes off ---');
const noSchedule = { can_view_my_schedule: false, can_make_offers: true, can_view_full_schedule: true };
check('offers are blocked without the schedule', permissionBlockedByDependency(noSchedule, 'can_make_offers'), true);
check('the crew view is blocked too', permissionBlockedByDependency(noSchedule, 'can_view_full_schedule'), true);
check(
  'and both resolve to FALSE on save',
  [resolvePermissionValue(noSchedule, 'can_make_offers'), resolvePermissionValue(noSchedule, 'can_view_full_schedule')],
  [false, false]
);
check('a permission with no dependency is never blocked', permissionBlockedByDependency(noSchedule, 'can_use_timeclock'), false);

// The documents permissions: seeing documents comes first, for the manager and the verifier alike.
console.log('\n--- the documents permissions depend on seeing documents ---');
const documentsWithoutView = {
  can_view_documents: false,
  can_manage_documents: true,
  can_verify_documents: true,
};
check('managing documents is blocked without the view permission', permissionBlockedByDependency(documentsWithoutView, 'can_manage_documents'), true);
check('so is verifying them', permissionBlockedByDependency(documentsWithoutView, 'can_verify_documents'), true);
check(
  'and both save as FALSE',
  [resolvePermissionValue(documentsWithoutView, 'can_manage_documents'), resolvePermissionValue(documentsWithoutView, 'can_verify_documents')],
  [false, false]
);
check('seeing them is not blocked by anything', permissionBlockedByDependency({}, 'can_view_documents'), false);
check(
  'with the view permission granted, nothing is blocked',
  [permissionBlockedByDependency({ can_view_documents: true }, 'can_manage_documents'), permissionBlockedByDependency({ can_view_documents: true }, 'can_verify_documents')],
  [false, false]
);
// The view permission is a MEMBER permission: reading the station's documents is not an administrative act, and it
// is what a role needs before it can be given either of the other two.
check('viewing documents is a member permission, not a tab', permissionTab('can_view_documents'), null);
check('and it grants no Administration access on its own', roleHasAdministration({ can_view_documents: true }), false);
check('View roster alone does not open Administration', roleHasAdministration({ can_view_roster: true }), false);
check('and does not add a phantom Administration tab', allowedAdminTabs({ can_view_roster: true }), []);

// The Documents TAB is the one place two permissions open the same thing, which is the whole reason a verifier can
// reach the Administration module at all.
console.log('\n--- the documents tab opens for either permission ---');
check('a manager opens it', roleAllowsTab({ can_view_documents: true, can_manage_documents: true }, 'documents'), true);
check('a verifier opens it', roleAllowsTab({ can_view_documents: true, can_verify_documents: true }, 'documents'), true);
check(
  'and the verifier gets exactly that one tab',
  allowedAdminTabs({ can_view_documents: true, can_verify_documents: true }),
  // No Help: the permissionless tabs still need Administration access, and verifying documents is not an
  // administrative permission.
  ['documents']
);
check('while the view permission alone opens no tab', allowedAdminTabs({ can_view_documents: true }), []);
check(
  'a verifier without the view permission opens nothing',
  roleAllowsTab({ can_verify_documents: true }, 'documents'),
  false
);

const withSchedule = { can_view_my_schedule: true, can_make_offers: true };
check('with the schedule granted, offers are honored', resolvePermissionValue(withSchedule, 'can_make_offers'), true);
check('and nothing is blocked', permissionBlockedByDependency(withSchedule, 'can_make_offers'), false);

console.log('\n--- the master switch locks the other boxes on, and forces them TRUE ---');
check('locked while is_admin is ticked', permissionLockedByAdmin({ is_admin: true }, 'can_edit_users'), true);
check('the master switch is not locked by itself', permissionLockedByAdmin({ is_admin: true }, MASTER_PERMISSION_KEY), false);
check('not locked without it', permissionLockedByAdmin({ is_admin: false }, 'can_edit_users'), false);
check(
  'everything saves as TRUE under is_admin',
  PERMISSION_KEYS.every((key) => resolvePermissionValue({ is_admin: true }, key) === true),
  true
);
check(
  'a switched-off permission still saves FALSE',
  resolvePermissionValue({ is_admin: false, can_edit_users: false }, 'can_edit_users'),
  false
);

console.log('\n--- the saved payload carries every column ---');
const fields = roleFieldsFromForm({ is_admin: true });
check('is_admin plus every permission key', Object.keys(fields).sort(), [MASTER_PERMISSION_KEY, ...PERMISSION_KEYS].sort());
check('all values are booleans', Object.values(fields).every((value) => typeof value === 'boolean'), true);
const partial = roleFieldsFromForm({ can_edit_ranks: 'TRUE' });
check('a granted permission is sent as true', partial.can_edit_ranks, true);
check('unset permissions are sent as false, not omitted', partial.is_admin, false);
check('member permissions present too', 'can_use_timeclock' in partial, true);

console.log('\n--- hand-edited headers are matched tolerantly ---');
// The roles sheet is edited by hand, so a header that differs only in case, spacing
// or underscores must still work. An exact match would read it as not granted and
// hide the tab with nothing to explain why.
check('exact key', permissionGranted({ can_edit_users: 'TRUE' }, 'can_edit_users'), true);
check('title case header', permissionGranted({ Can_Edit_Users: 'TRUE' }, 'can_edit_users'), true);
check('spaces instead of underscores', permissionGranted({ 'can edit users': 'TRUE' }, 'can_edit_users'), true);
check('a trailing space in the header', permissionGranted({ 'can_edit_users ': 'TRUE' }, 'can_edit_users'), true);
check('all caps', permissionGranted({ CAN_EDIT_USERS: 'TRUE' }, 'can_edit_users'), true);
check('a merely similar header does nothing', permissionGranted({ can_edit_user: 'TRUE' }, 'can_edit_users'), false);
check('the master switch tolerates formatting too', allowedAdminTabs({ 'Is Admin': 'TRUE' }), ALL_TABS_WITH_PERMISSIONLESS);

console.log('\n--- a missing column is not the same as a FALSE column ---');
check('a present FALSE column', permissionColumnState({ can_edit_users: 'FALSE' }, 'can_edit_users'), 'not granted');
check('a blank cell counts as off', permissionColumnState({ can_edit_users: '' }, 'can_edit_users'), 'not granted');
check('an absent column', permissionColumnState({ id: '1' }, 'can_edit_users'), 'no column');
check('a missing role row', permissionColumnState(null, 'can_edit_users'), 'no column');

console.log('\n--- the audit explains what a role grants and what the sheet lacks ---');
const partialAudit = rolePermissionAudit({ id: 'r9', description: 'Clerk', can_edit_users: 'TRUE' });
check('grants only what its column says', partialAudit.granted.map((permission) => permission.key), ['can_edit_users']);
check('so it gets exactly one tab', partialAudit.allowedTabs, ['users', ...ADMIN_PERMISSIONLESS_TABS]);
check('reports a column the sheet lacks', partialAudit.missing.some((p) => p.key === 'can_edit_ranks'), true);
// The state matters for diagnosis: "no column at all" is a different problem from a
// column that is deliberately switched off.
check('a role with no is_admin column reports that', partialAudit.masterState, 'no column');
check('a role with is_admin FALSE reports that', rolePermissionAudit({ id: 'r12', is_admin: 'FALSE' }).masterState, 'not granted');
check('a role with is_admin TRUE reports that', rolePermissionAudit({ id: 'r13', is_admin: 'TRUE' }).masterState, 'granted');
check('and there are no typos to report', partialAudit.unknownColumns, []);
const adminAudit = rolePermissionAudit({ is_admin: 'TRUE' });
check('an administrator has no missing columns', adminAudit.missing, []);
check('an administrator is granted everything', adminAudit.granted.length, ALL_PERMISSIONS.length);

console.log('\n--- a misspelled column is reported instead of silently doing nothing ---');
const typoRole = { id: 'r11', description: 'Templates editor', can_edit_schedule_template: 'TRUE' };
check('the singular typo is reported', unknownRoleColumns(typoRole), ['can_edit_schedule_template']);
check('and grants nothing', allowedAdminTabs(typoRole), []);
check('ordinary columns are never reported', unknownRoleColumns({ id: '1', description: 'x', name: 'y', sort_order: 2 }), []);

console.log('\n--- the permissionless Help tab ---');
// Help is documentation in the repo: it has no permission column, but it is still closed to a role
// with no Administration access at all, and it must never become a role's landing tab.
check('it is the only permissionless tab', ADMIN_PERMISSIONLESS_TABS, ['help']);
check('a role with any Administration access may use it', roleAllowsTab({ can_edit_users: 'TRUE' }, 'help'), true);
check('a role granted nothing cannot reach it', roleAllowsTab(nothing, 'help'), false);
check('nor can a role with no row at all', roleAllowsTab(null, 'help'), false);
check('nor a role with only a typo column', roleAllowsTab(typoRole, 'help'), false);
check('it trails the permission-driven tabs', allowedAdminTabs({ can_edit_users: 'TRUE' }), ['users', 'help']);
check(
  'so the landing tab is always one the role was granted',
  allowedAdminTabs({ can_edit_users: 'TRUE' })[0],
  'users'
);
check('an administrator gets it too', allowedAdminTabs(admin).includes('help'), true);

console.log('\n--- approvals only claim focus for NEW offers (navigation regression) ---');
// The bug this guards: with anything pending, every navigation bounced back to
// Pending Approvals, so no other tab could be opened at all.
const approverTabs = allowedAdminTabs({ can_approve_shifts: 'TRUE' });
check('new offers do move the user to approvals', shouldFocusApprovals(0, 2, ALL_TABS), true);
check('the same pending count does not, so navigation sticks', shouldFocusApprovals(2, 2, ALL_TABS), false);
check('a decided offer does not', shouldFocusApprovals(2, 1, ALL_TABS), false);
check('a further offer after a decision does', shouldFocusApprovals(1, 2, ALL_TABS), true);
check('nothing pending does not', shouldFocusApprovals(0, 0, ALL_TABS), false);
check('a role with the tab is still moved', shouldFocusApprovals(0, 3, approverTabs), true);
check('a role without any tabs is never moved', shouldFocusApprovals(0, 3, []), false);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

