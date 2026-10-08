// Renders the permission-gated screens headlessly, once per kind of role.
//
// The build only checks syntax, so a mistake like rendering a value before it is
// declared (a temporal-dead-zone crash) or reading a prop that a new code path
// forgot to pass would still compile and then fail in the browser. Rendering each
// screen for each role shape turns those into a failing test instead.
//
//   npm run verify:admin-render
import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToString, renderToStaticMarkup } from 'react-dom/server';
import { CENTERED_CONTENT_TABS, CONTENT_MAX_WIDTH } from '../src/utils/contentWidth.js';
import { ADMIN_BAR_LABELS, PAGE_BAR_LABELS, adminBarLabel, pageBarLabel } from '../src/utils/pageLabels.js';
import CenteredContent from '../src/components/CenteredContent.jsx';
// The whole app, so the shell itself can be rendered. Everything below is a component in isolation; a mistake in
// App's own body - a derived value that reads state declared further down, for instance - was invisible to all of
// it and to every source check, and took the entire app down in the browser.
import App from '../src/App.jsx';
import AdminPanel, { ADMIN_NAV_CATEGORIES } from '../src/components/admin/AdminPanel.jsx';
import AdminMenuPage from '../src/components/admin/AdminMenuPage.jsx';
import Sidebar from '../src/components/Sidebar.jsx';
import AdminRolesTab from '../src/components/admin/AdminRolesTab.jsx';
import AdminScheduleTemplatesTab from '../src/components/admin/AdminScheduleTemplatesTab.jsx';
import AdminAssignmentsTab from '../src/components/admin/AdminAssignmentsTab.jsx';
import AdminCertificationsTab from '../src/components/admin/AdminCertificationsTab.jsx';
// (The Audit Log tab is gone; the trail is Cloud Logging now.)
import MyAvailability from '../src/components/MyAvailability.jsx';
import AvailabilityCalendar from '../src/components/AvailabilityCalendar.jsx';
import AdminAvailabilityTab from '../src/components/admin/AdminAvailabilityTab.jsx';
import AdminAvailabilityWindowsTab from '../src/components/admin/AdminAvailabilityWindowsTab.jsx';
import AdminScheduleManagementTab from '../src/components/admin/AdminScheduleManagementTab.jsx';
import HelpGuides from '../src/components/HelpGuides.jsx';
import Markdown from '../src/components/Markdown.jsx';
import { hasGuideContent, helpGuides } from '../src/utils/helpGuides.js';
import AdminSystemSettingsTab from '../src/components/admin/AdminSystemSettingsTab.jsx';
// The separate roster module is rendered below with focused fixtures.
import AdminUsersTab from '../src/components/admin/AdminUsersTab.jsx';
import RosterModule from '../src/components/RosterModule.jsx';
import AdminPendingApprovalsTab from '../src/components/admin/AdminPendingApprovalsTab.jsx';
import AdminTrainingTab from '../src/components/admin/AdminTrainingTab.jsx';
import { ADMIN_PERMISSIONS, roleAllowsTab } from '../src/utils/permissions.js';
import TrainingModule from '../src/components/TrainingModule.jsx';
import ClockBlockedModal from '../src/components/ClockBlockedModal.jsx';
import ConfirmModal from '../src/components/ConfirmModal.jsx';
import MyClockHistory from '../src/components/MyClockHistory.jsx';
import { clockLocationNotice } from '../src/utils/clockLocation.js';
import FirefighterRunner from '../src/components/FirefighterRunner/FirefighterRunner.jsx';
import ScheduleCalendar from '../src/components/ScheduleCalendar.jsx';
import UserSettings from '../src/components/MySettings.jsx';

let failures = 0;
const check = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || detail === undefined ? '' : ` -> ${detail}`}`);
};

// ---------------------------------------------------------------------------
// The whole app renders
// ---------------------------------------------------------------------------
// Everything below renders one component at a time with hand-made props, which leaves App's own body - its state,
// and every derived value computed from it on every render - untested. Rendering it here executes that body, so a
// crash in it is reported as a failed check instead of a blank page.
//
// What this does NOT reach: effects do not run during a server render, so there is no data path here, and the state
// it renders in is the one a fresh app has - the loading screen. A mistake that only happens on a signed-in screen,
// or on one branch of an expression that short-circuits on the initial render, can still get past it: the
// `Cannot access 'adminSubTab' before initialization` bug was exactly that shape, and is covered by the source
// order check in scripts/verify-app-shell.mjs instead. It is deliberately the FIRST check either way, so a failure
// in the shell itself is the first thing reported.
console.log('\n--- the whole app ---');
const appRender = (() => {
  try {
    return { html: renderToString(React.createElement(App)) };
  } catch (error) {
    return { error };
  }
})();
check(
  'App renders without throwing',
  typeof appRender.html === 'string',
  appRender.error && `${appRender.error.name}: ${appRender.error.message}`
);
check('and gets as far as the splash (the boot screen)', String(appRender.html || '').includes('splash-screen'));
check('with nothing from the signed-in shell in it', !String(appRender.html || '').includes('My Schedule'));

// The role shapes that matter: full access, one tab only, member-only, and a role
// that has been granted nothing at all.
const ROLES = {
  administrator: { id: 'r1', description: 'Administrator', is_admin: true },
  rosterOnly: { id: 'r6', description: 'Roster Viewer', can_view_roster: true },
  approverOnly: { id: 'r2', description: 'Lieutenant', can_approve_shifts: 'TRUE' },
  usersOnly: { id: 'r3', description: 'Clerk', can_edit_users: 'TRUE' },
  memberOnly: { id: 'r4', description: 'Firefighter', can_view_my_schedule: true, can_use_timeclock: true },
  nothing: { id: 'r5', description: 'Suspended', is_admin: false },
};

const users = [{ id: 'u1', name: 'Matt', role_id: 'r1', rank_id: 'k1', status: 'active', is_change_password_on_login: true }];
const currentUser = { id: 'u1', name: 'Matt', role_id: 'r1', rank_id: 'k1', status: 'active' };

const adminPanelProps = {
  token: 'test-token',
  isAdmin: false,
  users,
  roles: Object.values(ROLES),
  ranks: [],
  shifts: [],
  schedule: [],
  scheduleTemplates: [],
  assignments: [],
  availability: [],
  systemSettings: [],
  logs: [],
  timeFormat: '12',
  offers: [],
};

for (const [name, role] of Object.entries(ROLES)) {
  // 1. The Administration panel, LANDING ON THE MENU PAGE: no sub-tab is requested, so the panel
  // renders the category cards rather than any tab's content.
  let panelError = null;
  let panelHtml = '';
  try {
    panelHtml = renderToString(
      React.createElement(AdminPanel, {
        ...adminPanelProps,
        currentRole: role,
        isAdmin: role.is_admin === true,
      })
    );
  } catch (error) {
    panelError = error;
  }
  check(
    `AdminPanel renders for a ${name} role`,
    !panelError,
    panelError && `${panelError.name}: ${panelError.message}`
  );

  // A role with nothing granted must be told so rather than shown an empty frame.
  if (name === 'nothing') {
    check('a role with no permissions sees an explanation', panelHtml.includes('does not include access'));
  }
  // The menu is filtered by the same permission list, so it shows what the role can reach. The
  // Users table's Username header distinguishes that panel from the Scheduling menu category.
  if (name === 'approverOnly') {
    check('an approver-only role gets the Scheduling category', panelHtml.includes('Scheduling'));
    check('and not the People category it cannot use', !panelHtml.includes('>People<'));
    check('and the Users panel is not rendered', !panelHtml.includes('Username</th>'));
  }
  if (name === 'usersOnly') {
    check('a users-only role gets the People category', panelHtml.includes('>People<'));
    // The tab's LABEL is "Members" (id 'users') - it always has been, and the id is what the permission resolves. This
    // assertion said ">Users<" and had been failing for that reason alone: a stale label, not a regression, and it was
    // masking whether the rest of this file ran. Asserted on the label the nav actually carries.
    check('and the menu lists the members tab it may open', panelHtml.includes('>Members<'));
    check('and no tab panel is rendered on the menu', !panelHtml.includes('Username</th>'));
  }
  if (name === 'administrator') {
    check('an administrator sees every category', ['People', 'Scheduling', 'Timeclock', 'System'].every((label) => panelHtml.includes(label)));
  }
  if (name === 'memberOnly' || name === 'nothing') {
    check(`a ${name} role sees no administration panels`, !panelHtml.includes('Username</th>'));
  }

  // ...and CHOOSING a tab from the menu renders that tab: the menu's cards and the dropdown bar
  // drive the same controlled value, so this is the same panel with a sub-tab requested.
  if (name === 'usersOnly') {
    const usersPanelHtml = renderToString(
      React.createElement(AdminPanel, {
        ...adminPanelProps,
        currentRole: role,
        isAdmin: role.is_admin === true,
        subTab: 'users',
        onSelectTab: () => {},
      })
    );
    check(
      'and choosing Users renders the table without the Scheduling status column',
      usersPanelHtml.includes('Username') && !/Schedulable|Excluded/.test(usersPanelHtml)
    );
    check('the password-change badge remains visible in the Members list', usersPanelHtml.includes('Password change due'));
  }

  // 2. The Roles editor, including the form for an administrator-only role.
  let rolesError = null;
  try {
    renderToString(
      React.createElement(AdminRolesTab, {
        token: 'test-token',
        roles: Object.values(ROLES),
        isAdmin: role.is_admin === true,
      })
    );
    // ...and with the administrator role open in the form (the protected case).
    const editor = renderToString(
      React.createElement(AdminRolesTab, {
        token: 'test-token',
        roles: Object.values(ROLES),
        isAdmin: false,
      })
    );
    // The permission list is inside the editor modal now, and a portal renders as nothing under SSR - so the label
    // is asserted at the source. What the render proves is that the page came up: the list header and its button.
    check(
      `the Roles editor renders for a ${name} role`,
      editor.includes('>Roles</h3>') &&
        editor.includes('New role') &&
        readFileSync('src/components/admin/AdminRolesTab.jsx', 'utf8').includes('Administrator access')
    );
  } catch (error) {
    rolesError = error;
  }
  check(
    `the Roles editor does not throw for a ${name} role`,
    !rolesError,
    rolesError && `${rolesError.name}: ${rolesError.message}`
  );

  // 3. The sidebar, with the module flags derived from the same role.
  let sidebarError = null;
  let sidebarHtml = '';
  try {
    sidebarHtml = renderToString(
      React.createElement(Sidebar, {
        currentUser,
        isClockedIn: false,
        activeTab: 'dashboard',
        setActiveTab: () => {},
        isSidebarOpen: false,
        setIsSidebarOpen: () => {},
        onLogout: () => {},
        canAdminister: role.is_admin === true || Boolean(role.can_approve_shifts || role.can_edit_users),
        canViewSchedule: Boolean(role.can_view_my_schedule),
        canEditAvailability: false,
        canUseTimeclock: Boolean(role.can_use_timeclock),
        canViewRoster: role.is_admin === true || Boolean(role.can_view_roster),
        ranks: [],
      })
    );
  } catch (error) {
    sidebarError = error;
  }
  check(
    `Sidebar renders for a ${name} role`,
    !sidebarError,
    sidebarError && `${sidebarError.name}: ${sidebarError.message}`
  );

  // Help is open to everyone - unlike every other module it is not permission-gated, so it must
  // appear for the role granted nothing at all, not just for administrators.
  check('Help is in the sidebar for every role', String(sidebarHtml).includes('Help'));
  check(
    `Roster is visible to ${name} only with its permission`,
    String(sidebarHtml).includes('Roster') === (role.is_admin === true || role.can_view_roster === true)
  );

  // 4. The member calendar, with and without the offer permission.
  let calendarError = null;
  try {
    renderToString(
      React.createElement(ScheduleCalendar, {
        currentUser,
        schedule: [
          { id: 's1', date_from: '2026-03-14', date_to: '2026-03-14', assignment_id: 'a1', user_id: 'u1' },
        ],
        assignments: [{ id: 'a1', description: 'Engine 1' }],
        scheduleTemplates: [],
        ranks: [],
        users,
        offers: [],
        token: 'test-token',
        canMakeOffers: role.can_view_my_schedule === true,
        canViewFullSchedule: false,
      })
    );
  } catch (error) {
    calendarError = error;
  }
  check(
    `ScheduleCalendar renders for a ${name} role`,
    !calendarError,
    calendarError && `${calendarError.name}: ${calendarError.message}`
  );
}

// 5. The User Settings access card, which explains a role and reports problems in the
// roles sheet itself. This is the screen an administrator checks when a permission
// "does not work", so it has to render for every role shape and say the right thing.
const userSettingsProps = {
  currentUser,
  userSettings: [],
  systemSettings: {},
  canApproveShifts: false,
  onSaveSettings: async () => ({ success: true }),
  onPasswordChange: async () => ({ success: true }),
};

const accessCardFor = (role) => {
  try {
    return renderToString(React.createElement(UserSettings, { ...userSettingsProps, currentRole: role }));
  } catch (error) {
    return { error };
  }
};

console.log('\n--- the User Settings access card ---');
const adminCard = accessCardFor(ROLES.administrator);
check('renders for an administrator', typeof adminCard === 'string', adminCard.error && adminCard.error.message);
check('and reports administrator access without the column state note', String(adminCard).includes('Administrator access') && !String(adminCard).includes('no is_admin column'));
check('with nothing to flag in the sheet', !String(adminCard).includes('Roles sheet check'));

const approverCard = accessCardFor(ROLES.approverOnly);
check('renders for a single-tab role', typeof approverCard === 'string', approverCard.error && approverCard.error.message);
// A role that can reach Administration but whose sheet lacks most permission columns
// gets the sheet check - this is the case that used to fail silently.
check('and flags the columns the roles sheet lacks', String(approverCard).includes('Roles sheet check'));
check('naming a missing column', String(approverCard).includes('can_edit_ranks'));
check('and says the is_admin column itself is missing', String(approverCard).includes('no is_admin column'));

const typoCard = accessCardFor({ id: 'r9', description: 'Typo role', can_edit_schedule_template: 'TRUE' });
check('a misspelled column is reported as unrecognized', String(typoCard).includes('can_edit_schedule_template'));
check('and it is called out as doing nothing', String(typoCard).includes('not recognized'));

const memberAccessCard = accessCardFor(ROLES.memberOnly);
check('renders for a member-only role', typeof memberAccessCard === 'string', memberAccessCard.error && memberAccessCard.error.message);
check('with their station modules listed', String(memberAccessCard).includes('Station modules'));
// A member's card must not be turned into a list of admin columns their sheet has no
// use for.
check('and no administration noise', !String(memberAccessCard).includes('Roles sheet check'));

// The Sound Effects switch is the one control in the app that carries the sound it is about to make as a
// data-sound directive, which is how the delegated listener knows to play sound_on/sound_off instead of a click
// - and how it manages to be heard while turning sounds back ON. Rendered here because the value depends on the
// resolution ladder (member row, then station default, then on), and the directive flips with it.
console.log('\n--- the User Settings sound switch ---');
const soundSwitchHtml = ({ userRow, systemRow }) => {
  try {
    return renderToString(
      React.createElement(UserSettings, {
        ...userSettingsProps,
        currentRole: ROLES.memberOnly,
        userSettings: userRow ? [{ id: currentUser.id, ...userRow }] : [],
        systemSettings: systemRow || {},
      })
    );
  } catch (error) {
    return { error };
  }
};
const switchDirective = (html) => (/data-sound="(sound-o(?:n|ff))"/.exec(String(html)) || [])[1] || null;

check('the switch is rendered', String(soundSwitchHtml({})).includes('Sound Effects'));
check(
  'User Settings offers the opt-in colorblind-friendly rank labels',
  readFileSync('src/components/MySettings.jsx', 'utf8').includes('Colorblind-Friendly Rank Labels') &&
    /colorblind_rank_labels: String\(formData\.colorblind_rank_labels\)/.test(readFileSync('src/components/MySettings.jsx', 'utf8')),
  true
);
const mySettingsSource = readFileSync('src/components/MySettings.jsx', 'utf8');
const appSourceForAccessibility = readFileSync('src/App.jsx', 'utf8');
check(
  'Accessibility offers the four supported font multiplier stops',
  /const FONT_SCALES = \[0\.9, 1, 1\.1, 1\.2\]/.test(mySettingsSource) &&
    /id="font-scale"/.test(mySettingsSource) &&
    /type="range"/.test(mySettingsSource) &&
    /max=\{FONT_SCALES\.length - 1\}/.test(mySettingsSource) &&
    /step="1"/.test(mySettingsSource) &&
    /FONT_SCALES\[Number\(event\.target\.value\)\]/.test(mySettingsSource),
  true
);
check(
  'slider changes preview immediately and restore the prior preview on exit',
  /onFontScalePreview\?\.\(scale\)/.test(mySettingsSource) &&
    /useEffect\(\(\) => \(\) => onFontScalePreview\?\.\(null\)/.test(mySettingsSource),
  true
);
check(
  'App applies the preview as a root font-size multiplier',
  /root\.style\.fontSize = `\$\{appFontScale \* 100\}%`/.test(appSourceForAccessibility) &&
    /'font_scale'/.test(appSourceForAccessibility),
  true
);
check('and Settings offers a saved event visibility default', /label="Hide Events by Default"/.test(readFileSync('src/components/MySettings.jsx', 'utf8')) && /hide_events_by_default: String\(formData\.hide_events_by_default\)/.test(readFileSync('src/components/MySettings.jsx', 'utf8')));
check(
  'the saved preference initializes every event-bearing calendar hidden by default',
  /useState\(\(\) => !hideEventsByDefault\)/.test(readFileSync('src/components/ScheduleCalendar.jsx', 'utf8')) &&
    /useState\(\(\) => !hideEventsByDefault\)/.test(readFileSync('src/components/AvailabilityCalendar.jsx', 'utf8')) &&
    /useState\(\(\) => !hideEventsByDefault\)/.test(readFileSync('src/components/admin/AdminScheduleManagementTab.jsx', 'utf8')) &&
    /const eventsByDay = showEvents \? allEventsByDay : new Map\(\)/.test(readFileSync('src/components/admin/AdminAvailabilityTab.jsx', 'utf8')),
  true
);
// Nothing set anywhere: on, so pressing it will turn them off.
check('with nothing configured it is on, so the switch offers to turn them off', switchDirective(soundSwitchHtml({})), 'sound-off');
// The member's own FALSE wins: off, so pressing it will turn them on.
check('a member who turned sounds off is offered to turn them on', switchDirective(soundSwitchHtml({ userRow: { is_sounds_active: 'FALSE' } })), 'sound-on');
// Inheriting the station default, both ways round - the case that would silently do nothing if the ladder were
// only reading the member's own row.
check('a blank cell inherits a station default of off', switchDirective(soundSwitchHtml({ systemRow: { is_sounds_active: 'FALSE' } })), 'sound-on');
check('and a blank cell inherits a station default of on', switchDirective(soundSwitchHtml({ systemRow: { is_sounds_active: 'TRUE' } })), 'sound-off');
check('the member still wins over the station', switchDirective(soundSwitchHtml({ userRow: { is_sounds_active: 'TRUE' }, systemRow: { is_sounds_active: 'FALSE' } })), 'sound-off');
check('and the card says when the station default is what applies', String(soundSwitchHtml({ systemRow: { is_sounds_active: 'FALSE' } })).includes('station default'));
// Every other switch in the app clicks, so only this one may carry a directive.
check('no other switch carries a directive', (String(soundSwitchHtml({})).match(/data-sound=/g) || []).length, 1);


console.log('\n--- the Schedule Templates tab ---');
// The form gained an optional nickname field and the week cards draw it, so a broken
// declaration here would only surface in the browser.
const templatesHtml = (() => {
  try {
    return renderToString(
      React.createElement(AdminScheduleTemplatesTab, {
        token: 'test-token',
        scheduleTemplates: [
          {
            id: 't1',
            day_of_week: 'monday',
            start_time: '08:00',
            end_time: '18:00',
            assignment_id: 'a1',
            nickname: 'Day Shift',
          },
        ],
        assignments: [{ id: 'a1', description: 'Firefighter 3' }],
        onDataChanged: async () => {},
      })
    );
  } catch (error) {
    return { error };
  }
})();
check('renders', typeof templatesHtml === 'string', templatesHtml.error && templatesHtml.error.message);
// The form is inside the editor modal now, so its fields are asserted at the source - the same reason the
// document editor and the training form are. What the render proves is that the page is the week calendar and a
// button, not a form.
check(
  'with a nickname field in the form',
  readFileSync('src/components/admin/AdminScheduleTemplatesTab.jsx', 'utf8').includes('Nickname'),
  true
);
check('and the nickname drawn on the week card', String(templatesHtml).includes('Day Shift'));

console.log('\n--- the Assignments tab ---');
// The optional icon picker is drawn from the same catalog the ranks editor uses
// (RANK_ICON_MAP), and the icon renders beside the description in the list.
const assignmentsHtml = (() => {
  try {
    return renderToString(
      React.createElement(AdminAssignmentsTab, {
        token: 'test-token',
        assignments: [
          { id: 'a1', description: 'Engine 1', color: '#227dc3', icon: 'truck', rank_order_required: '' },
        ],
        ranks: [{ id: 'k1', description: 'Firefighter', rank_order: 1 }],
        users: [],
        onDataChanged: async () => {},
      })
    );
  } catch (error) {
    return { error };
  }
})();
check('renders', typeof assignmentsHtml === 'string', assignmentsHtml.error && assignmentsHtml.error.message);
// The icon is chosen from a grid of the icons themselves now, not a <select> of their names, so what a render
// can show is the trigger - which reads "No icon" while the field is empty - and that nothing was left behind
// on a dropdown. The catalog itself is asserted from the source below, because a closed picker renders none of
// its options.
// The editor is a modal now, so its fields are asserted at the source: a dialog renders through createPortal,
// which server-side rendering skips. What the render proves is that the page is the list and a New assignment
// button - not a form.
const assignmentsTabSrc = readFileSync('src/components/admin/AdminAssignmentsTab.jsx', 'utf8');
check('with the icon picker', /<IconPicker/.test(assignmentsTabSrc));
check('and no icon dropdown left behind', !/-- No Icon --/.test(assignmentsTabSrc));
//
// The picker imports the same RANK_ICON_MAP the ranks editor renders, so there is one catalog and an icon
// added for one editor is available in the other - which is the property the <option> assertion used to hold.
const iconPickerSrc = readFileSync('src/components/IconPicker.jsx', 'utf8');
check(
  'and the catalog the ranks editor uses',
  iconPickerSrc.includes('from') && iconPickerSrc.includes("'./RankIcon'") && iconPickerSrc.includes('RANK_ICON_MAP')
);
// THE PICKER RENDERS ABOVE THE DIALOG LAYER, because it is opened FROM one: every editor that hosts it is a
// ViewportModal (z-[60]) while the panel renders to document.body - and at the popover-grade z-50 the dialog's
// own shade painted over the panel and swallowed every click, which is how "the icon dropdown doesn't work, no
// icon can be chosen" happened with every check green. The catcher and the panel are asserted against the
// dialog layer they must clear, in order: catcher above the dialog, panel above its own catcher.
const dialogLayerZ = 'z-[60]';
check(
  'the icon picker opens above the dialog layer',
  [
    /fixed inset-0 z-\[65\]/.test(iconPickerSrc),
    /fixed z-\[66\] /.test(iconPickerSrc),
    readFileSync('src/components/ViewportModal.jsx', 'utf8').includes(dialogLayerZ),
  ],
  [true, true, true]
);
check('and the saved icon drawn in the list', String(assignmentsHtml).includes('lucide-truck'));

// Effective and end dates: the form collects them, and the list marks where an assignment sits in its
// own life. The "Always" case is the one every existing assignment is in, so it is asserted explicitly.
//
// Strips markup with a LOCAL helper rather than the visibleText function: that one is declared further
// down this file, and a const used before its declaration throws (which is how this line failed first).
const stripMarkup = (html) =>
  String(html)
    .replace(/<!--[^>]*-->/g, '')
    .replace(/<[^>]*>/g, '');

const assignmentsText = stripMarkup(assignmentsHtml);
check('the form offers an Effective Date', /Effective Date/.test(assignmentsTabSrc));
check('and an End Date', /End Date/.test(assignmentsTabSrc));
// Counted inside the form: the file has other date inputs (the filters).
const assignmentFormSrc = assignmentsTabSrc.slice(
  assignmentsTabSrc.indexOf('<form id={ASSIGNMENT_FORM_ID}'),
  assignmentsTabSrc.indexOf('</form>', assignmentsTabSrc.indexOf('<form id={ASSIGNMENT_FORM_ID}'))
);
check('with two date inputs', (assignmentFormSrc.match(/type="date"/g) || []).length === 2);
check('marking the effective date required', /Effective Date[\s\S]{0,200}\(required\)/.test(assignmentsTabSrc));
check('and the end date optional', /End Date[\s\S]{0,200}\(optional\)/.test(assignmentsTabSrc));
check('explaining what the effective date means', /The first date this assignment may be used/.test(assignmentsTabSrc));
check('and that a blank end means still available', /still available/.test(assignmentsTabSrc));
check('and noting that existing shifts are never removed', /never removed/.test(assignmentsTabSrc));
// An assignment created before the rule has no effective date. It keeps working, so the list nudges
// rather than hiding it - which is also how an administrator finds the rows still to fill in.
check('an undated assignment is nudged, not hidden', /No start date/.test(assignmentsText));

const datedAssignmentsHtml = (() => {
  try {
    return renderToString(
      React.createElement(AdminAssignmentsTab, {
        token: 'test-token',
        assignments: [
          { id: 'r1', description: 'Retired', color: '', icon: '', rank_order_required: '', effective_date: '2020-01-01', end_date: '2021-01-01' },
          { id: 'r2', description: 'Upcoming', color: '', icon: '', rank_order_required: '', effective_date: '2099-01-01', end_date: '' },
          // An undated one, so "Always" is asserted alongside the two dated states rather than alone.
          { id: 'r3', description: 'Undated', color: '', icon: '', rank_order_required: '' },
        ],
        ranks: [],
        users: [],
        scheduleTemplates: [{ id: 't1', assignment_id: 'r1', day_of_week: 'monday' }],
        onDataChanged: async () => {},
      })
    );
  } catch (error) {
    return { error };
  }
})();
const datedText = stripMarkup(datedAssignmentsHtml);
check('a windowed assignment shows its dates', /Jan 1, 2020 - Jan 1, 2021/.test(datedText), true);
check('a retired assignment says so', /Retired/.test(datedText), true);
check('a future assignment says so', /Not yet/.test(datedText), true);
check('and an undated one is nudged too', /No start date/.test(datedText), true);
// The table used to lead with an ID column showing the assignment's UUID. Rendered rather than read from the source,
// because a column that is present but empty reads exactly like a column that is gone when you only grep the file.
check('the table has no ID column', !/>ID</.test(String(datedAssignmentsHtml)), true);
check('and the row ids are not printed anywhere', !/>(r1|r2|r3)</.test(String(datedAssignmentsHtml)), true);

// The one consequence an administrator could otherwise miss: retiring an assignment stops its templates
// drawing shifts. The warning only appears once an end date is set, so the source is what is asserted
// here - it cannot be reached by rendering the untouched form.
const assignmentsSource = readFileSync('src/components/admin/AdminAssignmentsTab.jsx', 'utf8');
check('and warns before retiring an assignment in use', /will stop producing shifts after/.test(assignmentsSource), true);
// The wording is JSX with a singular/plural ternary between the number and the noun, so this matches the
// count expression rather than trying to span the prose.
check('naming the number of templates', /templatesAffectedByEndDate\(formData\.id, scheduleTemplates\)\} schedule template/.test(assignmentsSource), true);
check('and telling the administrator what to do instead', /Give those templates their own end date/.test(assignmentsSource), true);

console.log('\n--- the availability screens ---');
// Availability is per shift now, so the fixtures have to land inside the month the
// screens open on or nothing would render (and the assertions would pass for the wrong
// reason). The 15th exists in every month, so its weekday defines the test template.
const availNow = new Date();
const availYear = availNow.getFullYear();
const availMonth = availNow.getMonth();
const availDay = `${availYear}-${String(availMonth + 1).padStart(2, '0')}-15`;
const _availDow = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][
  new Date(availYear, availMonth, 15).getDay()
];
// A window that runs every day, and one member's claim against it. The weekday logic is the derivation's job and
// verify-availability-slots tests it exhaustively; this block is about what the member's grid DRAWS.
const availWindow = {
  id: 'w1',
  nickname: 'Day shift cover',
  start_time: '08:00',
  end_time: '18:00',
  is_monday: true,
  is_tuesday: true,
  is_wednesday: true,
  is_thursday: true,
  is_friday: true,
  is_saturday: true,
  is_sunday: true,
};
const availMember = { id: 'u1', name: 'Member 1', rank_id: 'k1', status: 'active' };
const availRows = [
  { id: 'c1', availability_window_id: 'w1', date_from: availDay, user_id: 'u1' },
];
// One event before the day's 8am window and one after it, so the order asserted below cannot pass by accident: with
// events drawn as their own block above the windows it would read Breakfast, Drill, Day shift cover.
const availEvents = [
  { id: 'ae0', title: 'Breakfast', date_from: `${availDay} 07:00`, date_to: `${availDay} 07:30` },
  { id: 'ae1', title: 'Drill', date_from: `${availDay} 19:00`, date_to: `${availDay} 19:30` },
];

const calendarHtml = (() => {
  try {
    return renderToString(
      React.createElement(AvailabilityCalendar, {
        member: availMember,
        availability: availRows,
        windows: [availWindow],
        ranks: [{ id: 'k1', description: 'Firefighter', rank_order: 1 }],
        events: availEvents,
        onSave: async () => ({ success: true }),
      })
    );
  } catch (error) {
    return { error };
  }
})();
check('the member grid renders', typeof calendarHtml === 'string', calendarHtml.error && calendarHtml.error.message);
check('with the availability legend', String(calendarHtml).includes('Not marked'));
check('and the window it preloaded', String(calendarHtml).includes('Day shift cover'));
check('marking the marked shift as available', String(calendarHtml).includes('bg-emerald-600'));
check('showing the window hours on the pill', String(calendarHtml).includes('6:00 PM'));
// Ticks are held locally now, so the Save button must be present and start disabled (no
// changes yet) - that is the whole point of the batch.
check('with a batch save button', String(calendarHtml).includes('Save availability'));
check('starting disabled until something changes', calendarHtml.includes('disabled=""'));
// The same ordering rule as the other calendars (utils/dayOrder), asserted on the rendering because a cell that
// merges events and slots is the part the member actually reads. Split out of the grid by the day cell's class.
const availCells = String(calendarHtml).split('min-h-[76px] rounded-lg flex flex-col items-stretch');
const availDayCell = availCells.find((cell) => cell.includes('Breakfast')) || '';
check('the availability day cell with its events was found', availDayCell.length > 0);
const availOrder = ['Breakfast', 'Day shift cover', 'Drill'].map((label) => availDayCell.indexOf(label));
check(
  'and the availability cell reads a 7am event, the 8am window, a 7pm event',
  availOrder.every((at, i) => at > -1 && (i === 0 || availOrder[i - 1] < at)),
  `Breakfast, window, Drill at ${availOrder.join(', ')}`
);

const myAvailabilityHtml = (() => {
  try {
    return renderToString(
      React.createElement(MyAvailability, {
        token: 'test-token',
        currentUser: availMember,
        availability: availRows,
        windows: [availWindow],
        ranks: [{ id: 'k1', description: 'Firefighter', rank_order: 1 }],
        onChanged: async () => {},
      })
    );
  } catch (error) {
    return { error };
  }
})();
check(
  'My Availability renders for a member',
  typeof myAvailabilityHtml === 'string',
  myAvailabilityHtml.error && myAvailabilityHtml.error.message
);
check('explaining what marking means', String(myAvailabilityHtml).includes('does not commit you'));

const adminAvailabilityHtml = (() => {
  try {
    return renderToString(
      React.createElement(AdminAvailabilityTab, {
        token: 'test-token',
        users: [availMember, { id: 'u2', name: 'Member 3', rank_id: 'k1', status: 'active' }],
        windows: [availWindow],
        // Member 1's one claim, so the day list has a chip and the no-availability card has exactly one name.
        rosterAvailability: availRows,
        ranks: [{ id: 'k1', description: 'Firefighter', rank_order: 1 }],
        onDataChanged: async () => {},
      })
    );
  } catch (error) {
    return { error };
  }
})();
check(
  'the administrator tab renders',
  typeof adminAvailabilityHtml === 'string',
  adminAvailabilityHtml.error && adminAvailabilityHtml.error.message
);
check('with All Members first in the picker', String(adminAvailabilityHtml).includes('>All Members<'));
// Both members are in the picker, so the assertions that mean something are about the two lists BELOW it: the day
// list's chips name who CLAIMED a window, and the no-availability card names who claimed nothing.
//
// The card is drawn before the day list (beside it on a computer, above it on a phone), so the slice between its
// heading and the first window is the card itself - and that is how the member who claimed is told apart from the one
// who did not. The names go through MemberName, so they are wrapped in their own spans rather than bare text.
const adminAvailabilityRosterHtml = String(adminAvailabilityHtml);
const noAvailCardAt = adminAvailabilityRosterHtml.indexOf('No availability');
const dayListAt = adminAvailabilityRosterHtml.indexOf('Day shift cover');
const noAvailCard = adminAvailabilityRosterHtml.slice(noAvailCardAt, dayListAt);
check('and naming the members who claimed the window', adminAvailabilityRosterHtml.includes('Member 1'));
check(
  'the no-availability card is drawn before the day list',
  noAvailCardAt > -1 && noAvailCardAt < dayListAt,
  `card at ${noAvailCardAt}, day list at ${dayListAt}`
);
check('naming the member who claimed nothing', noAvailCard.includes('Member 3'));
check('and not the member who did claim', !noAvailCard.includes('Member 1'));

console.log('\n--- the availability windows tab, with nothing in it ---');
// THE STATE A STATION STARTS IN, and the one this tab shipped broken in. The list and the empty message were two panels
// behind `rows.length`, so a station with no windows yet got the message and NO CARD - and the card is where "New window"
// lives, which left no way to create the first window at all. Nothing caught it because this harness never rendered the
// tab: it was the one Administration screen with no coverage here.
//
// SSR renders the INITIAL state (`rows: []`, `loading: true`) and never runs the load effect, so rendering the tab is
// exactly the empty-list render - if the button is in this markup, an officer with no windows has it.
const windowsTabHtml = renderToStaticMarkup(
  React.createElement(AdminAvailabilityWindowsTab, { token: 'test-token' })
);
check('the empty tab still offers New window', windowsTabHtml.includes('New window'));
check('with the count it is listing', windowsTabHtml.includes('Availability windows (0)'));
check('and says what it is doing rather than showing nothing', /Loading availability windows|No availability windows yet/.test(windowsTabHtml));

// -----------------------------------------------------------------------------------------------------------
// MEMBER AVAILABILITY MUST HAVE ITS WINDOWS, OR NO CLAIM CAN EVER BE SHOWN.
// -----------------------------------------------------------------------------------------------------------
// The reported fault: members had marked themselves available, and Administration > Member Availability showed none of
// it - "No availability windows fall in <month>", and nothing at all in the single-member view.
//
// IT WAS NOT THE CLAIMS READ. `ADMIN_GET_AVAILABILITY` returns the crew's rows correctly (verify-firestore-reads covers
// the shape; the read itself is exercised there too). A claim is only ever DRAWN attached to a WINDOW, and the windows list
// was empty in this module - so the claims arrived and had nothing to hang on. That is what these checks hold.
//
// WHY THE LIST WAS EMPTY, and it is the part worth writing down: two readers, neither reachable from Administration.
//   - the sign-in payload deliberately omits the windows (see firestorePayload.js), so `setAvailabilityWindows` in
//     applyBootstrap was reading a field no payload ever wrote;
//   - the other reader is gated on `activeTab === 'availability'`, the MEMBER's own screen, which an officer working in
//     Administration never opens.
// Read here rather than reusing the `appSource` further down this file: that one is declared AFTER this block, and a
// `const` used before its declaration is a temporal dead zone error - the build failed on exactly that.
const rosterAppSource = readFileSync('src/App.jsx', 'utf8');
const adminRosterEffect = /const wantsRoster[\s\S]*?\n  \}, \[activeTab, adminSubTab/;

// The officer's roster effect reads the windows. Without this the tab renders from an empty list forever.
check(
  'the officer roster effect reads the availability windows',
  /const wantsRoster[\s\S]*?adminFetchAvailabilityWindows\(/.test(rosterAppSource),
  'the windows are never read for the Administration module'
);
// ...and it reads them with the SHARED once-per-session guard, so opening both screens is still one read.
check('under the shared windowsLoaded guard', /const wantsRoster[\s\S]*?if \(!windowsLoaded\)\s*\{[\s\S]*?setWindowsLoaded\(true\)/.test(rosterAppSource));
// ...and BEFORE the claims-scope guard. This ordering is load-bearing: that guard legitimately skips the claims read when
// the range is already held, and the windows are needed either way, so reading them after it would reintroduce the bug
// for exactly the officer who had already browsed the board.
const effectBody = adminRosterEffect.exec(rosterAppSource)?.[0] || '';
const windowsAt = effectBody.indexOf('adminFetchAvailabilityWindows(');
const scopeGuardAt = effectBody.indexOf('rosterScope.from && rosterScope.from <= from');
check(
  'and before the claims-scope guard, which can skip its own read',
  windowsAt > -1 && scopeGuardAt > -1 && windowsAt < scopeGuardAt,
  'the windows read sits after a guard that may return first'
);
// The window read must not be gated on the MEMBER's own tab, which is what left the module empty in the first place.
check(
  'and not gated on the member\'s own availability screen',
  !/adminSubTab === 'availability'[\s\S]{0,400}?activeTab === 'availability'/.test(effectBody),
  'the read is behind a member-screen gate an officer never passes'
);

// THE JOIN ITSELF, on the tab's own derivation: a claim row with a matching window draws the member; without the window
// there is nothing to draw it on. This is the claim the two lines above exist to keep true.
const claimRow = { id: 'aw1|2026-10-06', user_id: 'u2', availability_window_id: 'aw1', date_from: '2026-10-06' };
const octoberWindows = [{ id: 'aw1', nickname: 'Tuesday night', start_time: '18:00', end_time: '08:00', is_tuesday: true }];
const rosterUsers = [{ id: 'u2', name: 'Bo Jones', rank_id: 'k2' }];
const rosterFor = (windows) =>
  renderToStaticMarkup(
    React.createElement(AdminAvailabilityTab, {
      token: 'test-token',
      users: rosterUsers,
      rosterAvailability: [claimRow],
      windows,
      loadedFrom: '2026-10-01',
      loadedTo: '2026-10-31',
    })
  );
const withWindowsHtml = rosterFor(octoberWindows);
const withoutWindowsHtml = rosterFor([]);

check('a claim whose window is loaded is drawn', /Tuesday night/.test(withWindowsHtml) && !/No availability windows fall in/.test(withWindowsHtml));
// The bug's exact symptom, and the reason it read as "the data is not loading" rather than "the windows are missing".
check('the same claim with no windows says there are none', /No availability windows fall in/.test(withoutWindowsHtml));

// -----------------------------------------------------------------------------------------------------------
// THE EVENTS, IN EACH DAY'S HEADING OF THE "ALL MEMBERS" LIST.
// -----------------------------------------------------------------------------------------------------------
// Restored, not invented. `src/components/admin/AdminAvailabilityRoster.jsx` drew exactly this - a coloured dot, the
// title and the time, once per DAY beside the date - until the availability model was rebuilt around windows and that file
// was folded into AdminAvailabilityTab, taking the events with it. The prop comment here used to say "The All Members list
// is windows and names, so events have no place in it", which is the sentence that lost it.
//
// It has a place: this list answers "who can cover Tuesday night?", and an event on that Tuesday is very often why fewer
// of them can. The member's own grid already drew them, which is why the gap was easy to miss.
const availabilityTabFile = readFileSync('src/components/admin/AdminAvailabilityTab.jsx', 'utf8');
// ONE event on ONE day, on a Tuesday night window with a member on it. The columns are `date_from`/`date_to` with the time
// inside the value - a first fixture here used `start_date`, and normalizeEvent dropped it as unreadable, so the heading
// came out empty and the probe blamed the feature instead of the fixture.
const oneEvent = [
  { id: 'ev1', title: 'Drill night', date_from: '2026-10-06 19:00:00', date_to: '2026-10-06 21:00:00', color: '#2563eb' },
];
const rosterWithEvent = (events) =>
  renderToStaticMarkup(
    React.createElement(AdminAvailabilityTab, {
      token: 'test-token',
      users: rosterUsers,
      windows: octoberWindows,
      rosterAvailability: [claimRow],
      events,
      loadedFrom: '2026-10-01',
      loadedTo: '2026-10-31',
    })
  );
const eventHtml = rosterWithEvent(oneEvent);

check('an event on a day is named in that day\'s heading', /Drill night/.test(eventHtml));
// The coloured dot, so a pale event colour cannot swallow the date - the reason the original used a dot rather than a chip.
check('and carries its colour', /#2563eb/.test(eventHtml));
// The list's actual job is untouched: the window and WHO claimed it are still there.
check('with the window and its claimants still drawn', /Tuesday night/.test(eventHtml) && /Bo Jones/.test(eventHtml));
check('and the month counts its events', /1 event this month/.test(eventHtml));
// ONCE PER DAY, not per window. This is the original's reason and it is the right one: an event belongs to the day, and
// repeating it down every window would bury the names this view exists to show.
//
// THE SECOND WINDOW IS THE POINT of this check, AND IT MUST BE ON THE SAME DAY. With one window under the day, "once per
// day" and "once per window" draw exactly the same pixels, so the first version of this assertion passed on a build that
// repeated the event under every window. A second window on a DIFFERENT day does not help either - the event would only
// appear under the one day it falls on, and the count would be unchanged. So both windows are on the SAME Tuesday, which
// is what makes the difference visible: the event must appear twice (its title attribute and its visible label) and not
// four times.
const twoWindowDay = [...octoberWindows, { ...octoberWindows[0], id: 'aw2', nickname: 'Extra cover', is_saturday: false }];
const twoWindowHtml = renderToStaticMarkup(
  React.createElement(AdminAvailabilityTab, {
    token: 'test-token',
    users: rosterUsers,
    windows: twoWindowDay,
    rosterAvailability: [claimRow],
    events: oneEvent,
    loadedFrom: '2026-10-01',
    loadedTo: '2026-10-31',
  })
);
// `check` IN THIS FILE IS A TRUTHINESS TEST, `(label, condition, detail)` - it is NOT the equality helper the other
// harnesses use. The first version of this passed the COUNT as the condition, and a count of 4 is truthy, so it reported
// "ok" on a build that repeated the event under every window. Two separate ways this check could not fail; the counts are
// compared explicitly here.
check('once per day rather than once per window', (twoWindowHtml.match(/Drill night/g) || []).length === 2, `found ${(twoWindowHtml.match(/Drill night/g) || []).length} occurrences of the event title`);
// ...and every window is still drawn, so the count above is not achieved by dropping one.
check('with every window still listed', /Tuesday night/.test(twoWindowHtml) && /Extra cover/.test(twoWindowHtml));

// A RECURRING event must expand. This is `eventSegmentsByDay` doing the work, and the reason the roster calls it rather
// than grouping the events by date itself.
const weeklyEvent = [
  {
    id: 'ev2',
    title: 'Weekly drill',
    is_recurring: true,
    recurring_start: '2026-10-06',
    recurring_end: '2026-10-31',
    recurring_frequency: 'weekly',
    recurring_amount: '1',
    is_tuesday: true,
    date_from: '2026-10-06 19:00:00',
    date_to: '2026-10-06 21:00:00',
  },
];
const weeklyHtml = rosterWithEvent(weeklyEvent);
const dayHeadings = (weeklyHtml.match(/<h4[\s\S]*?<\/h4>/g) || []).length;
const headingsWithDrill = (weeklyHtml.match(/<h4[\s\S]*?Weekly drill[\s\S]*?<\/h4>/g) || []).length;
// Compared explicitly, for the reason above: a count is truthy whatever it is.
check(
  'a recurring event reaches every day it falls on',
  dayHeadings > 0 && headingsWithDrill === dayHeadings,
  `${headingsWithDrill} of ${dayHeadings} day headings carry it`
);

// The wiring, read as source: the roster has to be HANDED the events. A tab that renders them and a tab that is given them
// are two different bugs, and this was the second one - `events` was already a prop here, and simply not passed down.
// AdminPanel is read again rather than reusing the `adminAvailabilitySource` further down this file: that one is declared
// after this block, and reading a `const` before its declaration is a dead-zone error.
check(
  'and the tab is handed its events for the list as well as the grid',
  /events=\{events\}/.test(readFileSync('src/components/admin/AdminPanel.jsx', 'utf8')) &&
    /events=\{events\}/.test(availabilityTabFile),
  'the roster is not given the events'
);

// -----------------------------------------------------------------------------------------------------------
// AND THE EVENTS ON THAT GRID.
// -----------------------------------------------------------------------------------------------------------
// The second regression on this tab, and the same shape as the first: a screen that is handed a prop nothing ever fills
// for it. `AdminAvailabilityTab` passes `events` down to the member's month grid, and the tab below asserts it really
// does - so the prop is live, and the only question is where the list comes from.
//
// THE ANSWER IS THIS GATE, AND ONLY THIS GATE. The events left the sign-in payload in 1.12 (correctly - they belong to the
// calendars, which read them when one opens), so before that an officer had them from sign-in and this tab just worked.
// 1.12 replaced that with a per-screen read and listed the member's schedule, the member's availability and the officer's
// board - but not Administration > Member Availability. Nothing else fills the shared state either: the administration
// Events tab fetches its own list and keeps it to itself.
const eventsGate = /const wantsEvents =([\s\S]*?);/.exec(rosterAppSource)?.[1] || '';
check(
  'the Administration Member Availability tab is one of the screens that reads the events',
  /onMemberAvailabilityTab/.test(rosterAppSource) && /onMemberAvailabilityTab/.test(eventsGate),
  'the tab is not in the events gate, so it draws a month with no events on it'
);
// ...and the clause is bound to THAT tab, not merely to something called "availability". A first version of this check only
// asked whether the name appeared, and it passed happily when the clause pointed at `availability-windows` - which draws
// no month and reads no events, so it would have left the bug in place under a green suite. The id is tied to the nav's own
// entry below, so renaming the tab breaks this rather than silently disabling it.
check(
  'and that clause names the member availability tab, not a neighbour',
  /const onMemberAvailabilityTab = activeTab === 'admin' && adminSubTab === 'availability';/.test(rosterAppSource)
);
// The nav's own entry for that id - the two must agree, or the clause is gating a tab that does not exist.
const adminAvailabilitySource = readFileSync('src/components/admin/AdminPanel.jsx', 'utf8');
check(
  'which is the tab the nav calls Member Availability',
  /\{ id: 'availability', label: 'Member Availability'/.test(adminAvailabilitySource)
);
// The events prop is not decoration: it reaches the calendar, the only place it can be seen. AdminPanel hands the list to
// the tab and the tab hands it to the grid, and the panel hop is scoped to THIS tab's block - AdminPanel passes `events` to
// the schedule board as well, so a whole-file search passed even after the prop was removed from here. That is the same bug
// wearing a different hat.
const availabilityTabSource = readFileSync('src/components/admin/AdminAvailabilityTab.jsx', 'utf8');
const availabilityPanelBlock = /activeSubTab === 'availability' && \(([\s\S]*?)\n      \)\}/.exec(adminAvailabilitySource)?.[1] || '';
check(
  'and it reaches the month grid, through this tab only',
  /events=\{events\}/.test(availabilityPanelBlock) && /events=\{events\}/.test(availabilityTabSource),
  'the events prop does not reach the availability tab'
);
// The gate is load-bearing, so nobody may "tidy" it away on the assumption the payload has them back. This is the
// regression's own shape stated as a check: the payload carries no events, therefore this gate is the only source.
check(
  'and the sign-in payload does not carry events, so this gate is the only source',
  !/\n\s*events,\n/.test(readFileSync('src/services/firestorePayload.js', 'utf8')) ||
    /events is NOT here/.test(readFileSync('src/services/firestorePayload.js', 'utf8')),
  'the payload carries events again, so the gate no longer decides'
);
// And the source, because the render above cannot reach the settled empty state: the button must sit ABOVE the
// empty-list branch rather than inside it, which is precisely how the dead end was built.
const windowsTabSource = readFileSync('src/components/admin/AdminAvailabilityWindowsTab.jsx', 'utf8');
check(
  'and the source puts New window above the empty-list branch, not inside it',
  windowsTabSource.indexOf('New window') < windowsTabSource.indexOf('rows.length === 0 ?')
);

console.log('\n--- the Schedule Management board ---');
// WHAT THIS RENDER CANNOT SHOW, and why the wiring is asserted at source level beside it: the board reads the month it
// is showing from Firestore (see its onNeedSchedule note), and EFFECTS DO NOT RUN during a server render - so this pass
// draws the month's template slots and the events, and the pills that come from rows arrive on the client. That is also
// why a missing prop here is invisible: a board handed no reader draws an empty month and says nothing.
//
// A vacancy in this tab is labeled with its ASSIGNMENT, not the word "Open" (the vacancy
// styling carries that), so this renders a vacant row for a template slot in the current
// month and checks what the pill says. The row and the template have to line up: the board
// draws a pill on the day the row STARTS, and only into the slot whose weekday matches.
const boardNow = new Date();
const boardDay = `${boardNow.getFullYear()}-${String(boardNow.getMonth() + 1).padStart(2, '0')}-15`;
const boardDow = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][
  new Date(boardNow.getFullYear(), boardNow.getMonth(), 15).getDay()
];
const boardAssignment = { id: 'a1', description: 'Firefighter 3' };

const boardHtml = (() => {
  try {
    return renderToString(
      React.createElement(AdminScheduleManagementTab, {
        token: 'test-token',
        schedule: [
          {
            id: 's1',
            schedule_template_id: 't1',
            assignment_id: 'a1',
            user_id: '',
            date_from: boardDay,
            date_to: boardDay,
          },
        ],
        scheduleTemplates: [
          {
            id: 't1',
            day_of_week: boardDow,
            start_time: '08:00',
            end_time: '18:00',
            assignment_id: 'a1',
          },
        ],
        assignments: [boardAssignment],
        ranks: [],
        users: [],
        availability: [],
        offers: [],
        // One event before the day's shift and one after it: with events still drawn as their own block above the
        // shifts, the order would be Breakfast, Drill, Firefighter 3 - so asserting Breakfast, shift, Drill is what
        // proves the two streams are actually interleaved (see npm run verify:day-order for the merge itself).
        events: [
          { id: 'be0', title: 'Breakfast', date_from: `${boardDay} 07:00`, date_to: `${boardDay} 07:30` },
          { id: 'be1', title: 'Drill', date_from: `${boardDay} 19:00`, date_to: `${boardDay} 20:00` },
        ],
        onOffersChanged: async () => {},
        onAdminDataChanged: async () => {},
      })
    );
  } catch (error) {
    return { error };
  }
})();
check('the board renders', typeof boardHtml === 'string', boardHtml.error && boardHtml.error.message);
check('a vacant pill names the assignment', String(boardHtml).includes('Firefighter 3'));
// The word would only appear if something still labeled a vacancy with it.
check('and no longer says "Open"', !String(boardHtml).includes('Open'));
// Still styled as a vacancy, which is now doing the work the word used to do.
check('keeping its vacancy styling', String(boardHtml).includes('text-slate-400'));
// Tooltips repeat the labels (each pill has a title, and the day cell has a summary), so they are stripped before
// measuring - what is being asserted is the order of the pills themselves.
// Measured inside the ONE day cell that holds the events, not across the whole board: the template runs every week,
// so its slot (and this assignment's name) appears in every week's cell, and an index into the page would be
// measuring a later day. The cell is split out by its class.
const boardCells = String(boardHtml).split('min-h-[124px] rounded-lg border p-1.5 flex flex-col gap-1');
const boardDayCell = boardCells.find((cell) => cell.includes('Breakfast')) || '';
check('the day cell with the events was found', boardDayCell.length > 0);
const boardOrder = ['Breakfast', 'Firefighter 3', 'Drill'].map((label) => boardDayCell.indexOf(label));
check(
  'and reads a 7am event, the 8am shift, a 7pm event',
  boardOrder.every((at, i) => at > -1 && (i === 0 || boardOrder[i - 1] < at)),
  `Breakfast, shift, Drill at ${boardOrder.join(', ')}`
);

// THE BOARD DRAWS THE MONTH IT READ, NOT THE ARRAY IT IS HANDED. This is the other half of the wiring above, and it is
// provable in a server render: a FILLED row in the `schedule` prop would name its member if the board still seeded from
// it, and this board is handed no reader at all - so the member's name must be nowhere on the page. That was the shape of
// the original fault: the board drew the shared array, so a month round-trip re-seeded it from a cache the save had not
// refreshed, and the shift appeared to move back.
const boardStaleHtml = (() => {
  try {
    return renderToString(
      React.createElement(AdminScheduleManagementTab, {
        token: 'test-token',
        // A row for this month, with a member only these rows could name.
        schedule: [
          {
            id: 's9',
            schedule_template_id: 't1',
            assignment_id: 'a1',
            user_id: 'u9',
            date_from: boardDay,
            date_to: boardDay,
          },
        ],
        scheduleTemplates: [
          { id: 't1', day_of_week: boardDow, start_time: '08:00', end_time: '18:00', assignment_id: 'a1' },
        ],
        assignments: [boardAssignment],
        ranks: [],
        users: [{ id: 'u9', name: 'Zed Quarles' }],
        offers: [],
        events: [],
        onOffersChanged: async () => {},
        onAdminDataChanged: async () => {},
      })
    );
  } catch (error) {
    return { error };
  }
})();
check(
  'the board renders without a reader',
  typeof boardStaleHtml === 'string',
  boardStaleHtml.error && boardStaleHtml.error.message
);
check(
  'and names nobody from the shared array it was handed, because it draws its own month',
  !String(boardStaleHtml).includes('Zed Quarles'),
  'the board is still drawing the array App holds rather than the month it read'
);

console.log('\n--- the Firefighter Runner easter egg ---');
// The game carries a leaderboard panel now. Effects do not run during a server render, so
// this proves the panel's markup renders (and that the game still renders with no props at
// all) - the data path is covered by verify:runner.
const runnerHtml = (() => {
  try {
    return renderToString(React.createElement(FirefighterRunner, { width: 800, height: 280 }));
  } catch (error) {
    return { error };
  }
})();
check(
  'the game renders with no token',
  typeof runnerHtml === 'string',
  runnerHtml.error && `${runnerHtml.error.name}: ${runnerHtml.error.message}`
);
check('with the leaderboard panel', String(runnerHtml).includes('STATION LEADERBOARD'));
check(
  'and its loading state before the fetch resolves',
  String(runnerHtml).includes('CHECKING THE BOARD')
);
// The minigame is opted out of the app-wide UI click sound (utils/uiSounds): its own audio is untouched, and a UI
// click must not layer over it. Asserted on the RENDERED markup, because that is what the delegated listener
// actually queries - a React attribute that never reaches the DOM would pass a source check and fail in practice.
check('and opts the whole game out of the app click sound', String(runnerHtml).includes('data-sound="none"'));
check('rather than the app click being its default', !/data-sound="click"/.test(String(runnerHtml)));

const runnerWithSession = (() => {
  try {
    return renderToString(
      React.createElement(FirefighterRunner, {
        width: 800,
        height: 280,
        token: 'test-token',
        currentUser: { id: 'u1', name: 'Matt' },
      })
    );
  } catch (error) {
    return { error };
  }
})();
check(
  'and with a session',
  typeof runnerWithSession === 'string',
  runnerWithSession.error && runnerWithSession.error.message
);
check('the leaderboard still renders', String(runnerWithSession).includes('STATION LEADERBOARD'));

console.log('\n--- the Help screens ---');
// The admin Help tab reads src/content/help/admin/*.md and the member module reads
// src/content/help/member/*.md. Both load through a glob, which fails silently when it matches
// nothing, so rendering them proves the guides actually arrived.
const adminHelp = (() => {
  try {
    return renderToString(React.createElement(HelpGuides, { scope: 'admin' }));
  } catch (error) {
    return { error };
  }
})();
check('the admin Help tab renders', typeof adminHelp === 'string', adminHelp.error && adminHelp.error.message);
check('and lists the admin guides', String(adminHelp).includes('Administration guides'));
check('with a guide title from the folder', String(adminHelp).includes('Schedule Management'));
check('including the last one', String(adminHelp).includes('Notifications') && String(adminHelp).includes('Help'));
// verify-admin-render's check() takes a boolean condition, so the "does not contain" cases are
// negated explicitly rather than passing an expected value.
check('and never the member guides', !String(adminHelp).includes('Clocking in and out'));

const memberHelp = (() => {
  try {
    return renderToString(React.createElement(HelpGuides, { scope: 'member' }));
  } catch (error) {
    return { error };
  }
})();
check('the member Help module renders', typeof memberHelp === 'string', memberHelp.error && memberHelp.error.message);
check('and lists the member guides', String(memberHelp).includes('Help guides'));
check('with a guide title from the folder', String(memberHelp).includes('Getting started'));
check('and covers the modules', String(memberHelp).includes('Timeclock') && String(memberHelp).includes('My Availability'));

// The guide pane is bounded and scrolls on desktop (see the note in HelpGuides). Asserted on the RENDERED markup,
// because that is what the browser lays out: a class that never reaches the DOM would pass a source check and then
// silently leave the whole page scrolling again.
console.log('\n--- the guide pane, as rendered ---');
const memberHelpHtml = String(memberHelp);
check(
  'the pane is rendered as a labeled scroll region',
  /role="region"/.test(memberHelpHtml) && /aria-label="[^"]*guide"/.test(memberHelpHtml),
  'no region in the markup'
);
check('with a tab stop, so the keyboard can scroll it', /tabindex="0"/.test(memberHelpHtml));
check(
  'bounded on desktop, so it scrolls instead of growing',
  /md:h-full/.test(memberHelpHtml) && /md:flex-1/.test(memberHelpHtml) && /md:grid-rows-1/.test(memberHelpHtml)
);
check(
  'and scrolling only on desktop',
  /md:overflow-y-auto/.test(memberHelpHtml) && !/class="[^"]*(?:^|\s)overflow-y-auto(?:\s|")/.test(memberHelpHtml)
);
// The bookmarks are a sibling of the pane, not inside it: that is what keeps them in place while the guide moves.
check(
  'with the guide list outside the scrolling element',
  memberHelpHtml.indexOf('</nav>') < memberHelpHtml.indexOf('<article')
);

// An empty guide file is still listed, and explains itself instead of rendering a blank pane.
// There is no empty guide in the repository right now (the Training placeholder has been filled
// in), so the rule itself is asserted - in verify:help, against hasGuideContent - and this checks
// the state of the guides that DO exist plus the branch the component takes for them.
const trainingGuideView = (() => {
  try {
    // Renumbered with the rest of the set: guides follow the order of the modules in the sidebar.
    return renderToString(React.createElement(HelpGuides, { scope: 'member', initialSlug: '06-training' }));
  } catch (error) {
    return { error };
  }
})();
check('the Training guide opens directly', typeof trainingGuideView === 'string', trainingGuideView.error && trainingGuideView.error.message);
check('and renders its content', String(trainingGuideView).includes('Save signatures'));
check('rather than the empty-guide notice', !String(trainingGuideView).includes('This guide has no content yet'));
check('and is listed in the sidebar', String(memberHelp).includes('Training'));
check('no guide is empty any more', helpGuides('member').concat(helpGuides('admin')).filter((g) => !hasGuideContent(g)), []);
check('an unknown slug falls back instead of blanking', String(adminHelp).length > 0);
check('and never the admin guides', !String(memberHelp).includes('Administration quick tour'));

// The markdown renders as real elements rather than raw markup.
check('headings become elements', String(memberHelp).includes('<h2'));
check('and lists become list items', String(memberHelp).includes('<li>'));
check('and a table becomes a table', String(adminHelp).includes('<table'));

// Alerts. The point of the feature is that `[!CAUTION]` becomes a styled box - NOT literal text on the
// page.
//
// Asserted with regexes rather than the visibleText helper, which is declared further down the file
// (using it here would be a use-before-declaration, which threw the first time).
//
// Every assertion here renders a SYNTHETIC guide rather than reading the shipped ones. Which marker a
// guide happens to contain is the author's business, so asserting "the admin set leads with a note" made
// the suite fail when that note was edited out - a test of the reviewer's prose, not of the renderer.
// The rendering itself is what matters and is checked directly.
const alertFixture = (marker, body) =>
  renderToString(React.createElement(Markdown, { markdown: `> [!${marker}]\n> ${body}` }));

const cautionHtml = alertFixture('CAUTION', 'Careful now.');
const noteHtml = alertFixture('NOTE', 'For your information.');
const importantHtml = alertFixture('IMPORTANT', 'Do not miss this.');
const warningHtml = alertFixture('WARNING', 'This loses work.');
const tipHtml = alertFixture('TIP', 'A shortcut.');

check('an alert renders as a callout with a left rule', /border-l-4/.test(cautionHtml), true);
check('carrying the type label', /<span>Caution<\/span>/.test(cautionHtml), true);
check('with the alert icon', /lucide-octagon-alert/.test(cautionHtml), true);
check('and its body text, not the marker', !cautionHtml.includes('[!CAUTION]') && cautionHtml.includes('Careful now.'), true);
check('Note renders with its own label and icon', /<span>Note<\/span>/.test(noteHtml) && /lucide-info/.test(noteHtml), true);
check('Important renders', /<span>Important<\/span>/.test(importantHtml) && /lucide-circle-alert/.test(importantHtml), true);
check('Warning renders', /<span>Warning<\/span>/.test(warningHtml) && /lucide-triangle-alert/.test(warningHtml), true);
check('Tip renders', /<span>Tip<\/span>/.test(tipHtml) && /lucide-lightbulb/.test(tipHtml), true);
check('each type keeps its own label', [cautionHtml, noteHtml, importantHtml, warningHtml, tipHtml].every((html, i) => {
  const labels = ['Caution', 'Note', 'Important', 'Warning', 'Tip'];
  return html.includes(`<span>${labels[i]}</span>`);
}), true);

// The shipped guides are still checked, but only for the defect that has a visible consequence: a
// supported marker must never survive as literal text on the page.
const shippedAlertMarkers = helpGuides('member')
  .concat(helpGuides('admin'))
  .flatMap((guide) => (guide.markdown.match(/^> \[![A-Za-z]+\]/gm) || []));
check('the shipped guides do contain alerts to check', shippedAlertMarkers.length > 0, true);
check(
  'and no rendered guide leaks a marker as text',
  !/\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/.test(String(memberHelp) + String(adminHelp)),
  true
);

// HelpGuides renders ONE guide, so a type that lives in another guide is asserted by opening that
// guide - the same way the Training guide is checked below.
const importantGuideView = (() => {
  try {
    return renderToString(React.createElement(HelpGuides, { scope: 'admin', initialSlug: '15-system-settings' }));
  } catch (error) {
    return { error };
  }
})();
check('an Important alert renders', /<span>Important<\/span>/.test(String(importantGuideView)) && /lucide-circle-alert/.test(String(importantGuideView)), true);

// The Help guide documents the alert syntax in a fenced block. That example must stay INERT: one real
// alert on the page (its own Note) and the sample visible as code, not rendered as a second callout.
//
// The slugs are filenames, so the two checks below name them. Asserting they still EXIST first keeps a renamed
// guide from turning into a puzzling "the callout did not render" - the panel would fall back to the first guide
// and the failure would point at the wrong thing.
check(
  'the guides these checks open still exist',
  ['15-system-settings', '19-help'].filter((slug) => helpGuides('admin').some((guide) => guide.slug === slug)),
  ['15-system-settings', '19-help']
);
const helpAboutHelpView = (() => {
  try {
    return renderToString(React.createElement(HelpGuides, { scope: 'admin', initialSlug: '18-help' }));
  } catch (error) {
    return { error };
  }
})();
const helpAboutHelpHtml = String(helpAboutHelpView);
check('the guide about guides renders', helpAboutHelpHtml.includes('Looking after these guides'), true);
check('its own alert is a callout', (helpAboutHelpHtml.match(/border-l-4/g) || []).length, 1);
check('and the fenced example stays inert', /<pre[^>]*><code>&gt; \[!WARNING\]/.test(helpAboutHelpHtml), true);

// The renderer's own branches, on snippets: no shipped guide has a plain quote left (every quote now
// carries a type), so asserting the blockquote branch needs a snippet rather than content that could
// change. This also covers Tip and Warning, which no guide currently uses.
const quoteAndAlerts = renderToString(
  React.createElement(Markdown, {
    markdown: [
      '> A plain quote.',
      '',
      '> [!NOTE]',
      '> A note.',
      '',
      '> [!TIP]',
      '> A tip.',
      '',
      '> [!WARNING]',
      '> A warning.',
    ].join('\n'),
  })
);
check('a plain quote is still a blockquote', quoteAndAlerts.includes('<blockquote'), true);
check('a marker becomes an alert instead', (quoteAndAlerts.match(/border-l-4/g) || []).length, 3);
check('all three labels render', ['Note', 'Tip', 'Warning'].every((label) => quoteAndAlerts.includes(`<span>${label}</span>`)), true);
check('with no marker text left over', !/\[!(NOTE|TIP|WARNING)\]/.test(quoteAndAlerts), true);

// The admin panel must expose the new tab, and Member Availability must have moved groups.
// Asserted on the exported nav catalog rather than the HTML: the sub-tab labels live inside a
// closed dropdown, so they are absent from rendered output.
const categoryOf = (tabId) => {
  const category = ADMIN_NAV_CATEGORIES.find((entry) =>
    entry.items.some((item) => item.id === tabId)
  );
  return category ? category.label : null;
};

check('Member Availability is under Scheduling', categoryOf('availability'), 'Scheduling');
check('and no longer under Timeclock', categoryOf('clock'), 'Timeclock');
check('Clock Management is alone in Timeclock', ADMIN_NAV_CATEGORIES.find((c) => c.id === 'catTimeclock').items.length, 1);
check('Help is under System', categoryOf('help'), 'System');
check(
  'every nav tab id is unique',
  new Set(ADMIN_NAV_CATEGORIES.flatMap((category) => category.items.map((item) => item.id))).size,
  ADMIN_NAV_CATEGORIES.flatMap((category) => category.items.length).reduce((a, b) => a + b, 0)
);

// THE SCHEDULING ORDER IS THE ORDER THE WORK HAPPENS IN, and it was moved by request: the board an officer actually
// schedules on leads, the queue waiting on their decision is next, and the configuration the board depends on follows.
// Asserted as an exact list because the whole point of the change IS the sequence - a membership check like the ones above
// passes on any arrangement, which is why this one is spelled out item by item.
const schedulingOrder = (ADMIN_NAV_CATEGORIES.find((c) => c.id === 'catScheduling') || { items: [] }).items;
check(
  'Scheduling opens on Schedule Management and Pending Approvals',
  schedulingOrder.slice(0, 2).map((item) => item.id),
  ['schedule', 'approvals']
);
check(
  'then availability, events, templates and the windows',
  schedulingOrder.slice(2, 6).map((item) => item.id),
  ['availability', 'events', 'templates', 'availability-windows']
);
// ...and nothing was dropped or duplicated in the move. A reorder that quietly loses a tab would still satisfy the two
// checks above, because they only look at the first six.
check(
  'and reordering lost no tab',
  schedulingOrder.map((item) => item.id),
  ['schedule', 'approvals', 'availability', 'events', 'templates', 'availability-windows', 'assignments']
);
// The retired Shifts tab stays out of the nav.
check('the retired Shifts tab is still absent', categoryOf('shifts') === null);

console.log('\n--- the Clock Settings card ---');
// It writes three keys at once and reports its own state, so rendering it proves the card mounts
// and that the two states read differently - an unconfigured station must NOT be told its clocks
// are restricted.
const clockLocationCard = (settings) => {
  try {
    return renderToString(
      React.createElement(AdminSystemSettingsTab, {
        token: 'test-token',
        systemSettings: settings,
        onDataChanged: async () => {},
      })
    );
  } catch (error) {
    return { error };
  }
};

const unconfiguredCard = clockLocationCard([
  { key: 'department_name', value: 'Test Fire' },
  { key: 'required_clock_latitude', value: '' },
  { key: 'required_clock_longitude', value: '' },
  { key: 'gps_margin_of_error', value: '' },
]);
check('the card renders with the keys unset', typeof unconfiguredCard === 'string', unconfiguredCard.error && unconfiguredCard.error.message);
check('and says clocking is not restricted', String(unconfiguredCard).includes('Not enforced'));
check('and still offers the three fields', String(unconfiguredCard).includes('Margin (feet)'));
check('and lists what is still blank', String(unconfiguredCard).includes('Still blank'));
// THE ROUNDING STEP IS THE OTHER HALF OF THIS CARD, and it is offered whether or not the fence is configured - the two are
// independent policies that happen to live together. Its value is read from settings and echoed back into the select.
check(
  'and offers the rounding steps',
  ['Nearest 15 minutes', 'Nearest 30 minutes', 'Nearest hour'].every((label) => String(unconfiguredCard).includes(label)),
  true
);
check('with the default step shown when the station has never chosen', String(unconfiguredCard).includes('value="15"'), true);
check(
  'and the step the station chose read back',
  String(
    clockLocationCard([
      { key: 'required_clock_latitude', value: '39.277157' },
      { key: 'required_clock_longitude', value: '-78.238330' },
      { key: 'gps_margin_of_error', value: '1000' },
      { key: 'clock_hours_rounding', value: '30' },
    ])
  ).includes('value="30"'),
  true
);

const configuredCard = clockLocationCard([
  { key: 'required_clock_latitude', value: '39.277157' },
  { key: 'required_clock_longitude', value: '-78.238330' },
  { key: 'gps_margin_of_error', value: '1000' },
]);
check('the card renders when configured', typeof configuredCard === 'string', configuredCard.error && configuredCard.error.message);
check('and says it is enforcing', String(configuredCard).includes('Enforcing'));
// Asserted in two parts: React's SSR inserts a comment marker between an interpolated value and
// the text that follows it, so the literal "1,000 feet" never appears in the output.
check('and names the margin', String(configuredCard).includes('1,000'));
check('and the coordinates', String(configuredCard).includes('39.277157') && String(configuredCard).includes('-78.23833'));
check('and does not claim anything is blank', !String(configuredCard).includes('Still blank'));

// A half-filled setup must report as unconfigured, not as enforcing: that is the rule that stops a
// partial configuration from locking the station out of its own timeclock.
const partialCard = clockLocationCard([
  { key: 'required_clock_latitude', value: '39.277157' },
  { key: 'required_clock_longitude', value: '-78.238330' },
  { key: 'gps_margin_of_error', value: '' },
]);
check('a half-filled configuration is not enforcing', !String(partialCard).includes('Enforcing'));
check('and names the outstanding key', String(partialCard).includes('gps_margin_of_error'));

const invalidCard = clockLocationCard([
  { key: 'required_clock_latitude', value: 'north' },
  { key: 'required_clock_longitude', value: '-78.238330' },
  { key: 'gps_margin_of_error', value: '1000' },
]);
check('an unreadable value is reported as invalid', String(invalidCard).includes('Not a valid value'));
check('and is not silently treated as enforcing', !String(invalidCard).includes('Enforcing'));

console.log('\n--- the Training module and report ---');
// The member module. can_sign_trainings is what makes it reachable, so the interesting shapes are
// a plain signer, an editor (the form appears) and an administrator (the full report).
const TRAININGS = [
  {
    id: 't1',
    date: '2026-03-14',
    title: 'SCBA Refresher',
    start_time: '08:00',
    duration: '2',
    location: 'Station 1',
    instructors: 'Capt. Cooper',
    is_hazmat: 'TRUE',
    is_company_training: 'TRUE',
    narrative: 'Masks and bottles.',
    signature_count: 1,
  },
  { id: 't2', date: '2026-03-02', title: 'Driver Recertification', start_time: '18:00', duration: '4', is_driver_training: 'TRUE', signature_count: 0 },
  { id: 't3', date: '2026-02-10', title: 'Filed Externally', duration: '1', is_entered_into_external: 'TRUE', signature_count: 0 },
];
const TRAINING_SIGNATURES = [
  { id: 's1', training_id: 't1', user_id: 'u1' },
  { id: 's2', training_id: 't1', user_id: 'u2' },
  { id: 's3', training_id: 't2', user_id: 'u2' },
];

const trainingModule = (props) => {
  try {
    return renderToString(
      React.createElement(TrainingModule, {
        token: 'test-token',
        currentUser,
        trainings: TRAININGS,
        signatures: TRAINING_SIGNATURES,
        ...props,
      })
    );
  } catch (error) {
    return { error };
  }
};

const signerView = trainingModule({});
// React's SSR inserts comment markers between interpolated values and the text around them, so
// assertions about a sentence are made against the rendered text with those markers removed.
const visibleText = (html) => String(html).replace(/<!--[^>]*-->/g, '');
check('the module renders for a signer', typeof signerView === 'string', signerView.error && signerView.error.message);
check('with the trainings listed', String(signerView).includes('SCBA Refresher') && String(signerView).includes('Driver Recertification'));
check('a signed training shows as signed', String(signerView).includes('Signed'));
check('and an unsigned one offers to sign', String(signerView).includes('Sign<'));
check('the running count is shown', /1 of 3 signed/.test(visibleText(signerView)));
check('a signer does NOT get the add/edit form', !String(signerView).includes('Add New Training'));
check('and no Edit action', !String(signerView).includes('>Edit<'));

// --- the signing window, on the member's screen -------------------------------------------------
//
// The window is a number of days after the training's date, and the member's screen is where it has teeth: a training
// older than the window reads Closed rather than offering a button the writer would refuse. THE FIXTURES ARE DATED
// FEBRUARY AND MARCH, which the app's own clock left behind long ago, so a 30-day window closes every one of them - and
// the key is written as a LITERAL here on purpose: it is the name the settings document carries, and a rename has to
// break this.
const WINDOW_KEY = 'training_signature_window_days';
const closedWindowView = trainingModule({ systemSettings: [{ key: WINDOW_KEY, value: '30' }] });
check('the module renders with a window set', typeof closedWindowView === 'string', closedWindowView.error && closedWindowView.error.message);
check('a training past the window reads Closed', /disabled=""[^>]*>Closed</.test(String(closedWindowView)), true);
check('and the rule is said once above the table', /can be signed for 30 days after the date/.test(visibleText(closedWindowView)), true);
// THE TITLE IS THE SAME SENTENCE THE WRITER REFUSES WITH, so a click and a save cannot read differently.
check('the closed button names the window it missed', /30 days after its date/.test(String(closedWindowView)), true);
// A SIGNATURE ALREADY GIVEN IS NOT AN OFFER, so a window never turns Signed into Closed.
check('while the training already signed still reads Signed', /Signed</.test(String(closedWindowView)), true);
check('and a blank setting leaves every training signable', String(trainingModule({ systemSettings: [{ key: WINDOW_KEY, value: '' }] })).includes('Sign<'), true);
check('as does an unreadable one, which is ignored rather than enforced', String(trainingModule({ systemSettings: [{ key: WINDOW_KEY, value: '3O' }] })).includes('Sign<'), true);
check('with no settings at all the list is unchanged', String(signerView).includes('Sign<'), true);
// Badges come from the member-facing flag set.
//
// Matched on the badge's own title attribute rather than on its text, because the Category filter in the bar
// renders the SAME WORDS as option text - and "Fire prev" is a substring of "Fire prevention", so a plain text
// match would pass with no badge rendered at all, and would fail with no badge missing.
check('a set flag shows as a badge', /title="Hazmat"/.test(String(signerView)));
check('and so does the other renamed category', /title="Company Training"/.test(String(signerView)));
check('an unset flag does not', !/title="Fire prevention"/.test(String(signerView)));
// The Category filter itself, rendered rather than asserted from the source: both screens share one filter bar,
// so this is the check that the control actually reaches the member module.
check('the member module has the Category filter', String(signerView).includes('training-filter-category'));
check('offering the renamed categories', String(signerView).includes('All categories') && String(signerView).includes('No category'));

const editorView = trainingModule({ canEdit: true });
check('an editor gets an Add training button', String(editorView).includes('Add training'));
check('but not the form itself until it is asked for', !String(editorView).includes('training-editor-form'));
check('and an Edit action per row', String(editorView).includes('>Edit<'));
check('but still no delete', !String(editorView).toLowerCase().includes('delete'));
// Rule: a training anybody has signed, or one that is locked, cannot be edited from the module - but it is not a
// greyed-out Edit button any more. The row offers "Open" instead, which reads the training in the modal with every
// field frozen, and its tooltip names the reason. Asserted on that tooltip sentence, so what is checked is the block
// being VISIBLE and explained rather than the presence of a particular disabled attribute.
check('a signed training is blocked from editing, with the reason offered as Read-only', /title="Somebody has already signed this training, so it can only be changed in the Administration module\. Open it to read the details\."/.test(String(editorView)));
check('and a locked one likewise', /title="This training has been entered into an external system, so it is locked and cannot be changed\. Open it to read the details\."/.test(String(editorView)));
check('the external column exists', String(editorView).includes('>Ext.<'));

console.log('\n--- the training editor modal ---');
// Icons render as inline <svg>, which sits between an attribute and the text after it, so assertions about "this
// disabled button says X" are made against the markup with the icons removed.
const withoutIcons = (html) => String(html).replace(/<svg[\s\S]*?<\/svg>/g, '');
// The form is inside ViewportModal, which goes through createPortal - and server-side rendering skips portals
// entirely, so this renders as nothing at all. The form's contents are therefore asserted at the source, the way
// the document editor's are; what the render can prove is that the form is NOT on the page until it is asked for.
const trainingFormSource = readFileSync('src/components/training/TrainingForm.jsx', 'utf8');
check('it renders in the editor modal', /<ViewportModal/.test(trainingFormSource), true);
check('with a Save and a Cancel in the toolbar', /formId=\{TRAINING_FORM_ID\}/.test(trainingFormSource) && /onClose=\{onCancel\}/.test(trainingFormSource), true);
check('and the label the caller needs', /saveLabel=\{isEditing \? 'Save training' : 'Add training'\}/.test(trainingFormSource), true);
check('the fields are all there', ['Start time', 'Duration', 'Location', 'Instructors', 'Narrative'].every((label) => trainingFormSource.includes(label)), true);
// Which flags the form offers depends on the caller: the member module gets the member set, the Administration
// report gets everything including the external-system marker.
check('the member set by default', /allowAdminFlags \? TRAINING_FLAGS : MEMBER_EDITABLE_FLAGS/.test(trainingFormSource), true);
check('and a warning that the external marker is permanent', /is permanent/.test(trainingFormSource), true);
// A locked training is read-only even for an administrator, and says why. The freeze is `frozen` - `locked` OR the
// caller opening it read-only - so a signed training opened to read is frozen the same way a locked one is.
check('a locked training is read-only', /const frozen = locked \|\| readOnly/.test(trainingFormSource) && /<fieldset disabled=\{frozen\}/.test(trainingFormSource), true);
check('with an explanation', /entered into an external system, so it is locked/.test(trainingFormSource), true);
check('and cannot be saved', /const canSave = [^;]*!frozen/.test(trainingFormSource), true);
check('and the reason sits beside the Save button', /This training is locked\.|A date and a title are required\./.test(trainingFormSource), true);

// A training with no date or title cannot be saved either - the backend would drop it.
check('an incomplete training says what is missing', /A date and a title are required/.test(trainingFormSource));

const adminTrainingView = (() => {
  try {
    return renderToString(
      React.createElement(AdminTrainingTab, {
        token: 'test-token',
        trainings: TRAININGS,
        signatures: TRAINING_SIGNATURES,
        users: [{ id: 'u1', name: 'Matt' }, { id: 'u2', name: 'Member 4' }],
        onDataChanged: () => {},
      })
    );
  } catch (error) {
    return { error };
  }
})();
check('the Training report renders', typeof adminTrainingView === 'string', adminTrainingView.error && adminTrainingView.error.message);
// The report shares the filter bar with the member module, so the same control has to be here too.
check('the report has the Category filter', String(adminTrainingView).includes('training-filter-category'));
check('listing every training', String(adminTrainingView).includes('SCBA Refresher') && String(adminTrainingView).includes('Filed Externally'));
check('with a signature count per training', String(adminTrainingView).includes('>2<') && String(adminTrainingView).includes('>1<'));
check('and a total', /3 trainings · 3 signatures/.test(visibleText(adminTrainingView)));
check('it offers to add a training', String(adminTrainingView).includes('Add training') && !String(adminTrainingView).includes('training-editor-form'));
check('and to delete one', String(adminTrainingView).includes('Delete'));
check('signatures start collapsed', String(adminTrainingView).includes('Nobody has signed this training yet') === false);
// THE MARKER READS AS A LOCKED TRAINING ON THE REPORT, which is what these two checks are about. They used to be spelled
// out: the row printed "Entered into an external system", and the Edit and Delete tooltips said "Locked — entered into an
// external system" (twice per locked row, which is how the count below pinned "exactly one"). 1.45 shortened both
// tooltips to "Locked" and gave the table a Locked COLUMN, so the phrase now lives where the marker is SET - the flag's
// own label, drawn as a checkbox by the administrative form - and the report's job is the consequence.
//
// A COLUMN AND A BADGE ARE ASSERTED TOGETHER, because either alone still passes while a locked row draws as an ordinary
// one: a column with nothing under it, or a badge under no heading to read it by. The badge is the count's new anchor -
// one per locked row, where the two tooltips used to be - so "exactly the one training that carries the marker" is still
// what the number means.
check(
  'the external marker reads as a locked training on the report',
  /<th[^>]*title="Locked"[^>]*>Locked<\/th>/.test(String(adminTrainingView)),
  true
);
check(
  'and it is the only locked row',
  (String(adminTrainingView).match(/title="Locked for everyone\."/g) || []).length,
  1
);
check(
  'and the phrase itself still has a home, on the flag the form draws',
  /label: 'Entered into an external system'/.test(readFileSync('src/utils/training.js', 'utf8')),
  true
);
// A locked training cannot be edited or deleted even here. Asserted with the icons stripped - the Edit button
// carries a pencil and Delete a bin, and a check for the label directly after the tag would be a check on
// whether those buttons happen to have icons rather than on whether they are locked.
check('a locked training cannot be edited', /disabled=""[^>]*title="Locked[^"]*"[^>]*>Edit/.test(withoutIcons(adminTrainingView)));
check('nor deleted', /disabled=""[^>]*title="Locked[^"]*"[^>]*>\s*Delete/.test(withoutIcons(adminTrainingView)));

// Unknown members must not render as a bare id.
const orphanSignatureView = (() => {
  try {
    return renderToString(
      React.createElement(AdminTrainingTab, {
        token: 'test-token',
        trainings: TRAININGS,
        signatures: [{ id: 's9', training_id: 't1', user_id: 'u404' }],
        users: [],
        onDataChanged: () => {},
      })
    );
  } catch (error) {
    return { error };
  }
})();
check('an unknown member still renders', typeof orphanSignatureView === 'string', orphanSignatureView.error && orphanSignatureView.error.message);

// The Training group was renamed Content when Announcements arrived beside the Training report.
const contentCategory = ADMIN_NAV_CATEGORIES.find((c) => c.id === 'catContent') || { items: [] };
check('Training sits under the Content group', categoryOf('training'), 'Content');
check('alongside Announcements', categoryOf('announcements'), 'Content');
check('as the first item, so the group opens on the newest feature', contentCategory.items[0]?.id, 'announcements');
check('with the Training report second', contentCategory.items[1]?.id, 'training');
check('and the tab reads "Training", not "Training Report"', contentCategory.items[1]?.label, 'Training');
// NOTE: this file's check() is boolean-only - a third argument is a DETAIL string, not an expected value -
// so every assertion about absence has to negate. `, false)` would invert the meaning.
check('the group is no longer called Training', !ADMIN_NAV_CATEGORIES.some((c) => c.label === 'Training'));
check('and it holds exactly two tabs', contentCategory.items.length, 2);
// The old id must not linger, or a stale permissions row could still name it.
check('the old catTraining id is gone', !ADMIN_NAV_CATEGORIES.some((c) => c.id === 'catTraining'));

// The permission that gates the new tab, and the fact it is enforced per-tab like every other.
check(
  'a role without the permission cannot reach Announcements',
  !roleAllowsTab({ is_admin: false, can_edit_users: 'TRUE' }, 'announcements')
);
check(
  'and one with it can',
  roleAllowsTab({ is_admin: false, can_make_announcements: 'TRUE' }, 'announcements'),
  true
);
check('while an administrator always can', roleAllowsTab({ is_admin: 'TRUE' }, 'announcements'), true);

console.log('\n--- rank color and icon on the All Members list ---');
// Each name carries its rank: the rank's color, and its icon. The roster gets `ranks` from the
// tab, and each member's rank_id comes from utils/availability.js, so the two are checked here.
// The roster opens on the CURRENT month (its viewDate is internal state), so the fixture has to
// land in that month or the list legitimately shows nothing. The first Monday of this month it is.
const _rosterMonday = (() => {
  const day = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  while (day.getDay() !== 1) day.setDate(day.getDate() + 1);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
})();

// The All Members list, rendered through the TAB that hosts it: the roster is a private component inside it now, which is
// the simplification the windows model allowed (one list instead of a component of its own).
//
// The fixtures are WINDOW-shaped, because that is the model: a window recurs weekly, and a claim points at one window on
// one day. The window here runs every day on purpose - which weekday it falls on is the derivation's job and
// verify-availability-slots tests it exhaustively - so this block is only about how the list draws names.
const rosterView = (props) => {
  try {
    return renderToString(
      React.createElement(AdminAvailabilityTab, {
        windows: [
          {
            id: 'w1',
            nickname: 'Always on',
            start_time: '08:00',
            end_time: '18:00',
            is_monday: true,
            is_tuesday: true,
            is_wednesday: true,
            is_thursday: true,
            is_friday: true,
            is_saturday: true,
            is_sunday: true,
          },
        ],
        rosterAvailability: [
          // Dated in the CURRENT month, because that is the month the All Members list opens on - a claim dated
          // elsewhere would simply not appear, which is correct and useless as a fixture.
          { id: 'c1', user_id: 'u1', availability_window_id: 'w1', date_from: availDay },
          { id: 'c2', user_id: 'u2', availability_window_id: 'w1', date_from: availDay },
          { id: 'c3', user_id: 'u3', availability_window_id: 'w1', date_from: availDay },
        ],
        users: [
          { id: 'u1', name: 'Member 1', rank_id: 'r1' },
          { id: 'u2', name: 'Member 2', rank_id: 'r2' },
          { id: 'u3', name: 'No Rank Member', rank_id: '' },
        ],
        ranks: [
          { id: 'r1', description: 'Driver/Operator', color: '#227dc3', icon: 'truck' },
          { id: 'r2', description: 'Officer', color: '#c3223b', icon: 'shield-check' },
        ],
        ...props,
      })
    );
  } catch (error) {
    return { error };
  }
};

// The chip markup for one member, from the tag that OPENS the chip through to the member's name.
//
// TWO THINGS HERE HAD MADE THE CHECK BELOW MEANINGLESS rather than merely wrong, and they are worth naming because the
// failure was silent:
//   * the name is drawn EARLIER in the document, in the member picker's <option> list at the top of the tab. Matching
//     the FIRST occurrence therefore returned a window that began before the roster and contained no chip at all.
//   * the chip is a <button> now - clicking a name is how a shift gets assigned - and MemberName wraps the name in a
//     <span> of its own, so the nearest span is INSIDE the chip. A helper looking for '<span' read that instead.
// The last drawing of the name is the chip's own text, and the last <button> before it is the chip that holds it.
const chipFor = (html, name) => {
  const source = String(html);
  const end = source.lastIndexOf(name);
  if (end === -1) return '';
  return source.slice(source.lastIndexOf('<button', end), end);
};

const roster = rosterView({});
check('the roster renders', typeof roster === 'string', roster.error && roster.error.message);
// A GUARD ON THE HELPER ITSELF, because its failure mode is silence: if neither tag is found it returns everything from
// the start of the document, and the checks below still pass. This asserts it landed on a chip.
check(
  'and the chip helper finds the chip itself rather than a slice of it',
  /^<button\b/.test(chipFor(roster, 'No Rank Member')),
  true
);
check('listing the members', String(roster).includes('Member 1') && String(roster).includes('Member 2'));

// The colors come from the ranks, applied to the name and to the icon.
check('a rank color is applied', String(roster).includes('color:#227dc3'), true);
check('and a second rank keeps its own', String(roster).includes('color:#c3223b'), true);
check('the icon is drawn for a ranked member', String(roster).includes('lucide-truck') && String(roster).includes('lucide-shield-check'), true);
// The rank name is still the tooltip's OPENING, which is what this asks: the chip also says what clicking it does now
// that a name click assigns a shift, and pinning the whole string would make adding that hint a test failure.
check('the rank name is available as a tooltip', /title="Member 1 — Driver\/Operator[^"]*"/.test(String(roster)), true);
// Two inline colors for one member: the icon and the name. The name is rendered through MemberName, which
// wraps it (and any certification icons) in its own spans, so these look for the name INSIDE the colored span
// rather than requiring the span to contain nothing else - the contract is where the color lands, not that the
// name is the only thing there.
// The colour lands on the CHIP, and the rank's icon is drawn with it. The icon deliberately has no colour of its own:
// it inherits the chip's, so the two can never disagree.
check('the name carries the rank color', /style="[^"]*color:#227dc3[^"]*"[\s\S]{0,900}Member 1/.test(String(roster)), true);
check('and the rank icon is drawn with it', /lucide-truck/.test(String(roster)), true);
check('the icon sets no colour of its own, so it cannot drift from the chip', !/<svg[^>]*style="color:/.test(String(roster)), true);
check('and exactly those two, not more', (String(roster).match(/color:#227dc3/g) || []).length, 2);
check('a second member gets their own color', /style="[^"]*color:#c3223b[^"]*"[\s\S]{0,900}Member 2/.test(String(roster)), true);

// An unranked member must not break or silently borrow someone else's rank.
check('an unranked member still appears', String(roster).includes('No Rank Member'));

// AND A MEMBER WHO ALREADY HOLDS A SHIFT IS FILLED IN WITHOUT ANYBODY CLICKING, which is the whole point of drawing the
// chips from the month's rows rather than from the draft alone. A SERVER RENDER IS ENOUGH TO PROVE IT: the tab draws the
// `schedule` it is handed, and the read that fetches those rows is asserted as source further down (effects do not run in
// a server render at all - see the note beside the board's own fixtures).
//
// A ONE-OFF SHIFT rather than a template slot, so the fixture needs no weekday arithmetic: `isCustomShift` plus
// `rowCoversDate` is the whole rule a row satisfies to be a place on a day somebody holds.
const heldRoster = rosterView({
  assignments: [{ id: 'a1', description: 'Firefighter', color: '#0f766e' }],
  schedule: [
    {
      id: 's1',
      user_id: 'u1',
      schedule_template_id: '',
      date_from: availDay,
      date_to: availDay,
      start_time: '08:00',
      end_time: '18:00',
      assignment_id: 'a1',
      description: 'Night cover',
    },
  ],
});
check(
  'a member already on a shift is filled in with that shift’s colour, with nobody having clicked',
  /style="background-color:#0f766e;border-color:#0f766e;color:#ffffff"/.test(chipFor(heldRoster, 'Member 1')),
  chipFor(heldRoster, 'Member 1').slice(0, 240)
);
check(
  'and the shift they are on is named under their name',
  /Night cover/.test(chipFor(heldRoster, 'Member 1')),
  chipFor(heldRoster, 'Member 1').slice(0, 240)
);
check(
  'while a member holding nothing keeps the plain chip',
  !/background-color:#0f766e/.test(chipFor(heldRoster, 'Member 2')),
  chipFor(heldRoster, 'Member 2').slice(0, 240)
);

// TWO FAILURES EARNED THESE, and both would come back unnoticed:
//
//   * THE MENU LANDED TOO HIGH when it flipped above a button near the bottom of the screen. The shared positioning
//     helper returns a `top` computed as if the panel were maxHeight tall, so a short menu floated a couple of hundred
//     pixels above the name it belonged to. The flipped case is anchored by its BOTTOM instead - and folding that back
//     into a spread of the helper's result is exactly the tidy-up that would reintroduce it.
//   * THE MONTH'S SHIFTS WERE READ ON THE FIRST NAME CLICK rather than when the tab opened, because the only thing that
//     needed them was a menu most visits never open. THE CHIPS CHANGED THAT: a name that already holds a shift is filled
//     in with that shift's colour (see the check below), so the list DRAWS the month and the read belongs with the paint.
//     What is pinned here is that the read stays the tab's own WINDOWED one - asked for once a month, and skipped
//     entirely when App already holds the month - rather than that it waits for a click.
const availabilityPickerSource = readFileSync('src/components/admin/AdminAvailabilityTab.jsx', 'utf8');
check(
  'the shift menu is anchored by its bottom when it flips above the button',
  /bottom: flipUp \? window\.innerHeight - rect\.top \+ PICKER_GAP : undefined/.test(availabilityPickerSource) &&
    /top: flipUp \? undefined : rect\.bottom \+ PICKER_GAP/.test(availabilityPickerSource),
  true
);
check(
  'and the month’s shifts are read when the list opens, so a chip can be filled in',
  /useEffect\(\(\) => \{\s*void ensureShifts\(\);\s*\}, \[year, month\]\)/.test(availabilityPickerSource) &&
    /void ensureShifts\(\)/.test(availabilityPickerSource),
  true
);
// THE READ IS STILL BOUNDED, which is the half of the old check worth keeping. It is asked for ONCE PER MONTH - the ref
// remembers the month it asked about - and skipped entirely when App is already holding the month, which is the common
// case for an officer arriving from the board. The dependency list is the MONTH rather than the function: `onNeedSchedule`
// is re-created by App on every render, and an effect that depended on it would re-read the month after every paint.
check(
  'and it is asked for once a month, and skipped when the month is already held',
  /shiftsAsked\.current === askedFor \|\| monthAlreadyHeld/.test(availabilityPickerSource) &&
    !/useEffect\([\s\S]{0,300}?onNeedSchedule/.test(availabilityPickerSource),
  true
);
// A MEMBER WHO HAS BEEN GIVEN A SHIFT IS FILLED IN, with that shift's ASSIGNMENT colour, so the same member reads the same
// way here as on the board. The colour is the assignment's, not the rank's - a filled chip is about the SHIFT.
//
// IT IS THE CHOICE IN HAND FIRST, THEN THE SHIFT ALREADY HELD, and that second half is the point of the view: an officer
// opening this list is asking "who is spoken for?", and a chip that filled in only for a draft would answer that with
// silence until every name had been clicked.
check(
  'a member given a shift is filled in with that shift’s assignment colour',
  /const chosen = pending \? pending\.place : held/.test(availabilityPickerSource) &&
    /const assignedColor = chosen \? assignmentColor\(/.test(availabilityPickerSource) &&
    /backgroundColor: assignedColor, borderColor: assignedColor, color: '#ffffff'/.test(availabilityPickerSource),
  true
);
check(
  'and the shift a member already holds fills the chip in too, not only the choice in hand',
  /const held = pending \? null : heldFor\(member, day\.dateKey\)/.test(availabilityPickerSource) &&
    /for \(const place of placesForDay\(day\.dateKey\)\) \{\s*if \(place\.userId\) map\.set\(/.test(
      availabilityPickerSource
    ),
  true
);
// AND THE SHIFT GOES UNDER THE NAME, for either kind of fill. Trailing it made one long chip that pushed the rest of the
// row about and read as part of the member's name; the shift line is a second row inside the chip, which is what this
// pins - the name's row is CLOSED before the shift is drawn.
check(
  'and the shift is stacked under the name rather than trailing it',
  /inline-flex flex-col items-start/.test(availabilityPickerSource) &&
    /<MemberName user=\{member\}[\s\S]{0,40}\/>\s*<\/span>\s*\{chosen && \(/.test(availabilityPickerSource),
  true
);
// THE CHECK MARK IS THE ONE THING THE DRAFT KEEPS TO ITSELF. A filled chip means either "already on this shift" or "about
// to be put on it, not written yet", and those are not the same fact - so the mark that means unsaved choice is drawn for
// the draft alone, which is what keeps the Save bar's count matching what is on the screen.
check(
  'and only an unsaved choice carries the check',
  /\{pending && <Check className="h-3 w-3 shrink-0" \/>\} \{chosen\.name\}/.test(availabilityPickerSource),
  true
);
check('and keeps an uncoloured chip', !/style="border-color:/.test(chipFor(roster, 'No Rank Member')), true);
check('with an unstyled name', !/style="color:#[^"]*"[^<]*No Rank Member/.test(String(roster)), true);
check('and no rank icon', !/lucide-user[^>]*style="color:/.test(String(roster)), true);

// A rank with no color set must not paint a blank.
const noColor = rosterView({
  users: [{ id: 'u1', name: 'Colorless', rank_id: 'r9' }],
  ranks: [{ id: 'r9', description: 'Unpainted', color: '', icon: 'star' }],
});
check('a rank without a color renders its name plainly', String(noColor).includes('Colorless'), true);
check('and sets no inline color on it', !/color:#/.test(String(noColor)), true);
check('but still shows the rank icon', String(noColor).includes('lucide-star'), true);

const noRanks = rosterView({ ranks: [] });
check('with no ranks at all the list still renders', typeof noRanks === 'string' && String(noRanks).includes('Member 1'), true);
check('and no rank color is applied', !/color:#/.test(String(noRanks)), true);

// The tab must actually pass ranks through: without it the roster cannot color anything.
const tabSource = readFileSync('src/components/admin/AdminAvailabilityTab.jsx', 'utf8');
check('the tab forwards ranks to the roster', /<AvailabilityRoster[\s\S]{0,400}?ranks=\{ranks\}/.test(tabSource), true);

// --- sticky app bar -----------------------------------------------------------------------------
console.log('\n--- the app bar pins on mobile ---');

const shellSource = readFileSync('src/App.jsx', 'utf8');
const adminPanelSource = readFileSync('src/components/admin/AdminPanel.jsx', 'utf8');
// Attributes before className are allowed: the bar carries a ref for the scroll observer.
const mobileHeader = /<header[^>]*className="([^"]*md:hidden[^"]*)"/.exec(shellSource);
check('the mobile app bar was found', !!mobileHeader, true);

const headerClass = mobileHeader ? mobileHeader[1] : '';

check('it sticks to the top', /sticky/.test(headerClass) && /top-0/.test(headerClass), true);
// The bar holds the menu button, so it has to stay reachable while the page scrolls beneath it.
check('and spans the width above the content', /justify-between/.test(headerClass) && /p-4/.test(headerClass), true);

// The page title deliberately does NOT stick: only the bar is fixed, so a heading scrolls out of the
// way as you read. Pinned here so it does not creep back in.
//
// Extra classes on it are fine - it carries a `md:shrink-0` guard so the bounded Help screen shrinks the guide
// rather than squashing the title - so this matches the intent (not sticky) rather than an exact attribute.
check(
  'the page title scrolls with the page',
  /<div[^>]*className="mb-8[^"]*"/.test(shellSource) && !/<div className="sticky/.test(shellSource),
  true
);

// The stacking order: the bar must sit UNDER the sidebar's backdrop (z-20) and drawer (z-30), so
// opening the menu on a phone dims the whole page rather than leaving a bright strip above the shade.
// Note this file's `check` takes a CONDITION, not an expected value - a bare `check(label, '10', '20')`
// would pass, because a non-empty string is truthy. Hence the explicit comparisons.
const sidebarSource = readFileSync('src/components/Sidebar.jsx', 'utf8');
const backdropZ = /fixed inset-0 bg-black\/60 z-(\d+)/.exec(sidebarSource);
// `md:h-dvh` here: the drawer's height unit is the visible viewport (see verify-app-shell), and the
// pinned order below is about the CLASS LIST this pattern identifies, not about that unit.
const drawerZ = /fixed md:static md:h-dvh inset-y-0 left-0 z-(\d+)/.exec(sidebarSource);
const headerZ = /(?:^|\s)z-(\d+)(?:\s|$)/.exec(headerClass);
check('the sidebar backdrop z-index was found', (backdropZ ? backdropZ[1] : null) === '20', true);
check('the drawer z-index was found', (drawerZ ? drawerZ[1] : null) === '30', true);
check(
  'the app bar sits below both',
  Boolean(headerZ && backdropZ && drawerZ) &&
    Number(headerZ[1]) < Number(backdropZ[1]) &&
    Number(headerZ[1]) < Number(drawerZ[1]),
  `bar z-${headerZ ? headerZ[1] : 'none'}, backdrop z-${backdropZ ? backdropZ[1] : 'none'}, drawer z-${drawerZ ? drawerZ[1] : 'none'}`
);
check('while still sitting above the page content', Number(headerZ && headerZ[1]) > 0, true);


// The sub-menu inside Administration must sit UNDER the app bar too: it was `z-20` against the bar's
// `z-10`, so the tab strip and its overflow menus painted on top of the sticky header as you scrolled.
const subMenuClass = /<div ref=\{barRef\} className="([^"]*)"/.exec(adminPanelSource);
check('the admin sub-menu bar was found', !!subMenuClass, true);
const subMenuZ = /z-\[(\d+)\]/.exec(subMenuClass ? subMenuClass[1] : '');
check('it uses a bracket z-index (below the numbered scale)', !!subMenuZ, true);
check(
  'and sits below the sticky app bar',
  Boolean(subMenuZ && headerZ) && Number(subMenuZ[1]) < Number(headerZ[1]),
  `sub-menu z-${subMenuZ ? subMenuZ[1] : 'none'} vs bar z-${headerZ ? headerZ[1] : 'none'}`
);
check('while still floating above the page content', Number(subMenuZ && subMenuZ[1]) > 0, true);

// --- the page name appended to the app bar ------------------------------------------------------
console.log('\n--- the app bar names the page once its heading scrolls away ---');

check('the bar reads the label from one place', /pageBarLabel\(activeTab, adminSubTab\)/.test(shellSource), true);
check(
  'and only once the heading has gone',
  /showPageLabel && pageBarLabel\(activeTab, adminSubTab\)/.test(shellSource),
  true
);
// The Administration sub-tab has to reach the bar, or it would always read the bare page name.
check('the open sub-tab is reported upward', /onActiveSubTabChange=\{setAdminSubTab\}/.test(shellSource), true);
// The sub-tab is CONTROLLED: the app owns the value (an empty one is the menu page), the panel
// renders whatever it is given, and selections are reported back through the setter.
check('the panel is driven by the app’s sub-tab value', /subTab=\{adminSubTab\}/.test(shellSource), true);
check('and reports selections back through it', /onSelectTab=\{setAdminSubTab\}/.test(shellSource), true);
// The menu page is the landing view: an empty or unusable sub-tab renders the category cards, never
// a tab's content - which is what keeps opening Administration from paying for a tab nobody asked for.
check('the menu page is the landing view', /allowedTabs\.includes\(subTab\) \? subTab : null/.test(adminPanelSource), true);
check('and the menu renders the category cards', /<AdminMenuPage/.test(adminPanelSource), true);
check(
  'verification badge fetching requires an open menu and verifier/admin permission',
  /if \(activeSubTab !== null \|\| !canViewDocumentVerificationCount\)/.test(adminPanelSource) &&
    /isAdmin \|\| permissionGranted\(currentRole, 'is_admin'\) \|\| permissionGranted\(currentRole, 'can_verify_documents'\)/.test(adminPanelSource),
  true
);
const EmptyMenuIcon = () => null;
const documentsMenuMarkup = renderToStaticMarkup(
  React.createElement(AdminMenuPage, {
    categories: [{
      id: 'content',
      label: 'Content',
      icon: EmptyMenuIcon,
      items: [{ id: 'documents', label: 'Documents', icon: EmptyMenuIcon }],
    }],
    onSelectTab: () => {},
    documentVerificationCount: 3,
  })
);
check('the Documents menu item shows a positive verification badge', />3<\/span>/.test(documentsMenuMarkup), true);
const documentsMenuWithoutQueue = renderToStaticMarkup(
  React.createElement(AdminMenuPage, {
    categories: [{
      id: 'content',
      label: 'Content',
      icon: EmptyMenuIcon,
      items: [{ id: 'documents', label: 'Documents', icon: EmptyMenuIcon }],
    }],
    onSelectTab: () => {},
    documentVerificationCount: 0,
  })
);
check('the Documents menu item hides a zero badge', !/>0<\/span>/.test(documentsMenuWithoutQueue), true);
check(
  'and AdminPanel reports it as it changes',
  /onActiveSubTabChange\(activeSubTab \|\| ''\)/.test(adminPanelSource),
  true
);

// The trigger is a measured bar height rather than a magic number: if the two drift, the label appears
// while the heading is still on screen (or long after it has gone).
check('an IntersectionObserver drives it', /new IntersectionObserver\(/.test(shellSource), true);
check(
  'with the root margin measured from the bar',
  /topBarRef\.current\.offsetHeight/.test(shellSource) && /rootMargin: `-\$\{barHeight\}px/.test(shellSource),
  true
);
check('observing the page heading', /pageHeadingRef\.current/.test(shellSource) && /ref=\{pageHeadingRef\}/.test(shellSource), true);
// A long label must not push the menu button off the screen.
check('the label truncates and the row can shrink', /truncate text-sm/.test(shellSource) && /flex min-w-0 items-center gap-2/.test(shellSource), true);

// Every page that has a heading must have a bar label, or the bar would gain an empty dash.
//
// This file's `check` takes a CONDITION, not an expected value: `check(label, someArray, [])` passes for
// any truthy value, empty array included, so an unchecked list of offenders would assert nothing.
const headingBlockStart = shellSource.indexOf('ref={pageHeadingRef}');
const headingBlockEnd = shellSource.indexOf("{activeTab === 'dashboard' && (", headingBlockStart);
const headingBlock = shellSource.slice(headingBlockStart, headingBlockEnd);
const headingTabs = [...new Set([...headingBlock.matchAll(/activeTab === '([a-z-]+)'/g)].map((m) => m[1]))];
const tabsMissingLabel = headingTabs.filter((tab) => !pageBarLabel(tab));
check('the heading block was found', headingTabs.length >= 8, `found ${headingTabs.length}`);
check('every page heading has a bar label', tabsMissingLabel.length === 0, `missing: ${tabsMissingLabel.join(', ')}`);
check('and the example from the request reads correctly', pageBarLabel('admin') === 'Administration', `got ${JSON.stringify(pageBarLabel('admin'))}`);
check(
  'and with a sub-tab it names it',
  pageBarLabel('admin', 'schedule') === 'Admin: Schedule Mgt',
  `got ${JSON.stringify(pageBarLabel('admin', 'schedule'))}`
);
check(
  'an unknown sub-tab falls back to the page name',
  pageBarLabel('admin', 'nope') === 'Administration',
  `got ${JSON.stringify(pageBarLabel('admin', 'nope'))}`
);
check('an unknown tab has no label', pageBarLabel('runner') === '', `got ${JSON.stringify(pageBarLabel('runner'))}`);

// Every sub-tab in the real navigation must have a bar label, derived from ADMIN_NAV_CATEGORIES itself
// rather than from a regex: these ids are hyphenated (`system-log`), which a naive pattern misses - and
// that is exactly how the first version of the map came to key on `log` and show nothing.
const navTabIds = ADMIN_NAV_CATEGORIES.flatMap((category) => category.items.map((item) => item.id));
const missingSubLabels = navTabIds.filter((id) => !adminBarLabel(id));
check('every admin sub-tab has a bar label', missingSubLabels.length === 0, `missing: ${missingSubLabels.join(', ')}`);
check('and the navigation was read', navTabIds.length >= 15, `found ${navTabIds.length}`);

// Short on purpose: these sit beside the app name on a phone. The two sets have different budgets -
// a page label stands alone, while a sub-tab label is always prefixed with "Admin: ".
const longPageLabels = Object.entries(PAGE_BAR_LABELS).filter(([, label]) => label.length > 20);
check('page labels stay short', longPageLabels.length === 0, `too long: ${longPageLabels.map(([key]) => key).join(', ')}`);
const longSubLabels = Object.entries(ADMIN_BAR_LABELS).filter(([, label]) => label.length > 13);
check(
  'and sub-tab labels leave room for the prefix',
  longSubLabels.length === 0,
  `too long: ${longSubLabels.map(([key]) => key).join(', ')}`
);


// --- content width ----------------------------------------------------------------------------
console.log('\n--- content width ---');
// Content pages fill the viewport, except the two form/status screens listed in CENTERED_CONTENT_TABS,
// whose content is capped and centerd. The cap lives on <main> itself so the heading is centerd with the
// content rather than sitting off to one side.
//
// This also still answers the older question of whether My Availability and the administrative
// availability tab look the same: both render the shared AvailabilityCalendar inside the same full-width
// container, so their pills are the same width by construction rather than by two max-widths agreeing.
const appShellSource = readFileSync('src/App.jsx', 'utf8');
// The whole <main ...> opening tag, anchored on its className attribute.
//
// Not `/<main\b([^>]*)>/`: the explanatory comment above the component contains the literal text `<main>`,
// which comes first in the file and matches with an empty body. Anchoring on the attribute skips it.
// And not the className's backtick body either: that template literal contains a NESTED one for the
// conditional, so a backtick-to-backtick match would stop at the wrong place.
//
// `//` comments between the tag and its className are allowed for: a note about what a class is doing belongs
// right there, and without this the whole match came back empty the first time one was added.
const mainTag = /<main\s+(?:\/\/[^\n]*\n\s*)*className=\{[\s\S]*?\}\s*>/.exec(appShellSource)?.[0] || '';
check('the main container was found', mainTag.length > 0, true);
// Everything before the first ${ is unconditional, so these classes apply to every page.
const baseMainClasses = mainTag.split('${')[0];
check('it fills the width it is given', /\bflex-1\b/.test(baseMainClasses), true);
// A flex child defaults to min-width:auto and refuses to shrink below its content, so without min-w-0 one
// wide table pushes the page past the viewport and the app scrolls sideways on a phone or tablet.
check('and may shrink below its content, so a wide table cannot overflow the page', /\bmin-w-0\b/.test(baseMainClasses), true);
check('with padding that steps up with the screen', /\bp-4\b/.test(baseMainClasses) && /\bsm:p-6\b/.test(baseMainClasses) && /\blg:p-8\b/.test(baseMainClasses), true);
check('and keeps its own vertical scroll on desktop', /\bmd:overflow-y-auto\b/.test(baseMainClasses), true);
// A max-width here would be an unconditional cap rather than the deliberate per-tab one.
check('the base container sets no max-width of its own', !/\bmax-w-/.test(baseMainClasses), baseMainClasses);

check('the centerd-content set is exported', Array.isArray(CENTERED_CONTENT_TABS), true);
check('it covers the Timeclock/Dashboard', CENTERED_CONTENT_TABS.includes('dashboard'), true);
check('and User Settings', CENTERED_CONTENT_TABS.includes('settings'), true);
check('and a width is chosen for it', /^max-w-/.test(CONTENT_MAX_WIDTH), CONTENT_MAX_WIDTH);
check('which is a readable column rather than the full page', CONTENT_MAX_WIDTH !== 'max-w-full', true);
// Table and calendar screens must stay full width, or the change defeats the point of the previous request.
check('a dense table screen is NOT capped', !CENTERED_CONTENT_TABS.includes('clock-history'), true);
check('nor the schedule board', !CENTERED_CONTENT_TABS.includes('schedule'), true);
check('nor Administration', !CENTERED_CONTENT_TABS.includes('admin'), true);
check('nor the Help guides', !CENTERED_CONTENT_TABS.includes('help'), true);
check('and the cap is applied per tab, not always', /centeredContent \?/.test(mainTag), true);
check('centering it in the panel the sidebar leaves', /\bmx-auto\b/.test(mainTag), true);
check('and keeping it full width below the cap', /\bw-full\b/.test(mainTag), true);
check('using the shared width so both screens match', /CONTENT_MAX_WIDTH/.test(mainTag), true);

// --- the part-of-a-screen mechanism -------------------------------------------------------------
//
// Two administration screens cannot use the whole-module rule, because they are sub-tabs: they opt in by wrapping
// their content in CenteredContent. Member Availability is the OTHER side of that rule - BOTH of its views fill the
// content frame, because each is a board rather than a document (the All Members list with the no-availability card
// beside it, and the seven-column member grid) - so it wraps nothing.
const centered = readFileSync('src/components/CenteredContent.jsx', 'utf8');
check('CenteredContent is the only place a content max-width lives', /CONTENT_MAX_WIDTH/.test(centered), true);
check('it uses the one shared width', /CONTENT_MAX_WIDTH/.test(centered) && !/max-w-3xl/.test(centered), true);
check('and centers what it caps', /\bmx-auto\b/.test(centered), true);
check('while staying full width below the cap', /\bw-full\b/.test(centered), true);
// Rendered, so a wrapper that failed to apply the classes would show up.
const centeredHtml = renderToString(React.createElement(CenteredContent, { className: 'space-y-6' }, React.createElement('p', null, 'inner')));
check('the wrapper renders its children', centeredHtml.includes('inner'), true);
check('with the shared width applied', centeredHtml.includes('w-full') && centeredHtml.includes('mx-auto') && centeredHtml.includes(CONTENT_MAX_WIDTH), true);
check('and passes extra classes through', centeredHtml.includes('space-y-6'), true);

const adminCenteredTabs = [
  ['src/components/admin/AdminSystemSettingsTab.jsx', 'System Settings'],
  ['src/components/admin/AdminNotificationsTab.jsx', 'Notifications'],
];
for (const [path, name] of adminCenteredTabs) {
  const source = readFileSync(path, 'utf8');
  // The tab's own root element is what gets wrapped, not one of the cards inside it.
  const rootReturn = source.slice(source.indexOf('export default function'));
  check(`${name} wraps its content`, /<CenteredContent[\s>]/.test(rootReturn), true);
  check(`${name} closes the wrapper`, /<\/CenteredContent>/.test(rootReturn), true);
  check(`${name} imports it`, /import CenteredContent from '\.\.\/CenteredContent'/.test(source), true);
  check(`${name} sets no max-width of its own`, !/\bmax-w-(2xl|3xl|4xl|5xl|6xl|7xl)\b/.test(source), true);
}

// Member Availability: BOTH views fill the content frame - the All Members list is a board with the no-availability
// card beside it, and the member grid is a grid - so neither is wrapped and neither names a max-width.
const availabilitySource = readFileSync('src/components/admin/AdminAvailabilityTab.jsx', 'utf8');
check('Member Availability opts out of the reading column', !/CenteredContent/.test(availabilitySource), true);
const showingAllBranch = availabilitySource.slice(availabilitySource.indexOf('{showingAll ? ('), availabilitySource.indexOf(') : selectedMember ?'));
// The no-availability card sits BESIDE the list on a computer and ABOVE it on a phone - one column until `lg`, a row
// after it - and that row is the full width of the frame, so the list takes whatever the card leaves.
check(
  'the All Members list spans the frame, with the card beside it',
  /<NoAvailabilityCard/.test(showingAllBranch) &&
    /lg:flex-row/.test(showingAllBranch) &&
    /\bw-full\b/.test(showingAllBranch) &&
    !/\bmax-w-/.test(showingAllBranch),
  true
);
check('and the card stacks above it on a phone', /flex-col/.test(showingAllBranch), true);
const memberBranch = availabilitySource.slice(availabilitySource.indexOf(') : selectedMember ?'));
check('the single-member grid fills the frame too', /<AvailabilityCalendar/.test(memberBranch) && !/CenteredContent/.test(memberBranch), true);
check('and the whole tab is not wrapped', !/^export default function[\s\S]{0,200}<CenteredContent/.test(availabilitySource), true);

// The runtime behavior, not just the presence of a class: the same expression the component evaluates, run
// against every tab, so a tab added to the wrong side of the rule shows up here.
//
// NOTE: check() here is boolean-only - the third argument is a detail string, not an expected value - so
// every assertion about a tab NOT being capped has to negate. Writing `, false)` counts a false condition
// as a failure and inverts the meaning.
const centeredFor = (tab) => CENTERED_CONTENT_TABS.includes(tab);
check('the dashboard is capped at runtime', centeredFor('dashboard'), true);
check('and User Settings', centeredFor('settings'), true);
check('while Clock History is not', !centeredFor('clock-history'));
check('nor My Schedule', !centeredFor('schedule'));
check('nor My Availability', !centeredFor('availability'));
check('nor Training', !centeredFor('training'));
check('nor the firefighter game', !centeredFor('runner'));
check('and an unknown tab is not capped either', !centeredFor('nonsense'));

// No module may cap its own width, and the three newly capped admin screens must not either: the policy
// lives in utils/contentWidth, applied via App for whole modules and CenteredContent for part of a screen.
// Those two files are the only places a content max-width class may appear.
const widthPolicyFiles = [
  'src/components/MySettings.jsx',
  'src/components/ScheduleCalendar.jsx',
  'src/components/MyClockHistory.jsx',
  'src/components/HelpGuides.jsx',
  'src/components/ClockCard.jsx',
  'src/components/admin/AdminClockManagementTab.jsx',
  'src/components/admin/AdminSystemSettingsTab.jsx',
  'src/components/admin/AdminNotificationsTab.jsx',
  'src/components/admin/AdminAvailabilityTab.jsx',
];
const cappedPages = widthPolicyFiles.filter((path) => /className="[^"]*\bmax-w-(2xl|3xl|4xl|5xl|6xl|7xl)\b/.test(readFileSync(path, 'utf8')));
check('no content page caps its own width', cappedPages.length === 0, cappedPages.join(', '));
// Modals are the exception and must stay narrow: a dialog stretched across a 27-inch screen is unreadable.
check('a modal still caps its own width', /max-w-md/.test(readFileSync('src/components/ReauthModal.jsx', 'utf8')), true);

// The premise of that requirement: one calendar component, used by both views.
const myAvailabilitySource = readFileSync('src/components/MyAvailability.jsx', 'utf8');
check('My Availability renders the shared calendar', /AvailabilityCalendar/.test(myAvailabilitySource), true);
check('and so does the Administration availability tab', /AvailabilityCalendar/.test(tabSource), true);
check(
  'both inside the same component, so only the container width can differ',
  /<AvailabilityCalendar/.test(myAvailabilitySource) && /<AvailabilityCalendar/.test(tabSource),
  true
);
// The calendar itself must not cap its own width, or widening the container would do nothing.
const calendarSource = readFileSync('src/components/AvailabilityCalendar.jsx', 'utf8');
check('the calendar sets no width cap of its own', !/max-w-/.test(calendarSource), true);
check('and lays out seven equal columns', /grid grid-cols-7/.test(calendarSource), true);

console.log('\n--- the runner sound profile field on the Users tab ---');
// The field is visible to anyone who can manage users, but only an administrator can change it.
// Both shapes are rendered, because the disabled state is the whole requirement.
const usersTabView = (props) => {
  try {
    return renderToString(
      React.createElement(AdminUsersTab, {
        token: 'test-token',
        users: [{ id: 'u1', name: 'Matt', user_name: 'matt', role_id: 'r1', rank_id: 'k1', status: 'active', runner_sound_profile: 'bird' }],
        roles: [{ id: 'r1', description: 'Administrator' }],
        ranks: [{ id: 'k1', description: 'Chief' }],
        onDataChanged: () => {},
        ...props,
      })
    );
  } catch (error) {
    return { error };
  }
};

// The field only appears while editing a member: a new member has no settings row to write yet.
const addUserView = usersTabView({ isAdmin: true });
check('the Users tab renders', typeof addUserView === 'string', addUserView.error && addUserView.error.message);
check('with no sound field on the add form', !String(addUserView).includes('Runner Sound Profile'), true);

// Rendering "editing" means the tab has to be driven into that state, so the form is rendered
// directly with the field it would show for an existing member.
// One save, not two: the profile rides along with the users row. And the refresh is not awaited,
// because doPost serializes requests behind a script lock - awaiting the whole wave left the
// spinner up for the length of the queue after the write had already landed.
const usersSource = readFileSync('src/components/admin/AdminUsersTab.jsx', 'utf8');
check('the form loads the profile from the member row', /runner_sound_profile: user\.runner_sound_profile/.test(usersSource), true);
check('the field is disabled unless isAdmin', /disabled=\{!isAdmin\}/.test(usersSource), true);
check('and explains itself to an administrator', /A prefix for this member's Firefighter Runner sounds/.test(usersSource), true);
check('and to everyone else', /Only an administrator can change this setting/.test(usersSource), true);
check('the save is a single request', (usersSource.match(/await adminSaveUser\(/g) || []).length, 1);
check('with no second write for the profile', !/adminSaveRunnerSoundProfile/.test(usersSource), true);
// Scoped to handleSubmit on purpose. The bare file-wide check for "await onDataChanged()" matched a
// line in a DIFFERENT handler, so it passed while saying nothing about the save path - which is the
// only place the un-awaited refresh matters.
const saveHandlerSource = (() => {
  const start = usersSource.indexOf('const handleSubmit');
  if (start === -1) return '';
  const next = usersSource.indexOf('\n  const handle', start + 10);
  return usersSource.slice(start, next === -1 ? usersSource.length : next);
})();
check('the save handler was found', saveHandlerSource.length > 100, true);
// Negated: `check` passes only when its condition is TRUE, so "must not contain" has to be written
// as !test(...). The earlier file-wide version asserted the PRESENCE of `await onDataChanged()`
// while being labeled "is not awaited", and passed only because an unrelated handler further down
// the file contained it.
check('and it does not await the refresh', !/await onDataChanged\(/.test(saveHandlerSource));
// Not awaiting the refresh left the list holding pre-save values, so re-opening the form showed the
// old ones. The saved row is applied locally first, and the refresh is reported rather than silent.
check('the saved row is applied locally first', /onRowSaved\?\.\('users', \{ \.\.\.formData/.test(saveHandlerSource), true);
check('before the form is reset', usersSource.indexOf("onRowSaved?.('users', { ...formData") < usersSource.indexOf('resetForm();\n\n      // The refresh is NOT awaited'), true);
check('the background refresh is started', /Promise\.resolve\(onDataChanged\?\.\('users'\)\)/.test(usersSource), true);
check('and tracked so it can be shown', /setRefreshing\(true\)/.test(usersSource) && /finally\(\(\) => setRefreshing\(false\)\)/.test(usersSource), true);
check('with a visible indicator', /Reloading the list in the background/.test(usersSource), true);

// Bounded by the end of the element rather than by a character count, which is what a fixed window
// gets wrong. Declared here because more than one section asserts on an element's props.
const elementFor = (source, tag) => {
  const start = source.indexOf(tag);
  if (start === -1) return '';
  const end = source.indexOf('/>', start);
  return end === -1 ? source.slice(start) : source.slice(start, end);
};

// The panel has to pass both, and App has to provide the merge.
// The panel has to pass both, and App has to provide the merge.
const panelSource = readFileSync('src/components/admin/AdminPanel.jsx', 'utf8');
const panelUsersEl = elementFor(panelSource, '<AdminUsersTab');
check('the panel renders the Users tab', panelUsersEl.length > 0, true);
check('and passes isAdmin to it', /isAdmin=\{isAdmin\}/.test(panelUsersEl), true);
check('and the immediate-update callback', /onRowSaved=\{onRowSaved\}/.test(panelUsersEl), true);
const appSource = readFileSync('src/App.jsx', 'utf8');
// One applier for every collection: a save merges the row it wrote, whichever table it belongs to, so no
// screen waits on the nine-request refresh wave.
check('App applies a saved row for the users collection', /users: \{ set: setUsers, merge: mergeSavedUser \}/.test(appSource), true);
check('and registers one for each table that renders app state', (appSource.match(/merge: mergeSavedRow/g) || []).length, 5);
check('and passes the applier into the panel', /onRowSaved=\{applySavedRow\}/.test(appSource), true);

console.log('\n--- the approvals queue controls ---');
// The tab sorts ascending by date by default and filters by member and by assignment.
const approvalsSource = readFileSync('src/components/admin/AdminPendingApprovalsTab.jsx', 'utf8');
check('the tab renders the controls', /All Members/.test(approvalsSource) && /All Assignments/.test(approvalsSource), true);
check('with a sort select built from the shared options', /OFFER_SORT_OPTIONS\.map/.test(approvalsSource), true);
check('defaulting to the ascending-by-date sort', /useState\(DEFAULT_OFFER_SORT\)/.test(approvalsSource), true);
check('the table renders the filtered and sorted rows', /visibleRows\.map/.test(approvalsSource), true);
// Two empty states: nothing pending at all, versus nothing matching the filters.
check('it distinguishes "nothing pending" from "nothing matched"', /No pending shift offers\./.test(approvalsSource) && /No offers match these filters\./.test(approvalsSource), true);
check('it offers to clear the filters', /Clear filters/.test(approvalsSource), true);
check('and shows how many are shown', /of \$\{rows\.length\} offer/.test(approvalsSource), true);
// One describe per offer, shared by the table and the sort rather than recomputed per row.
check('the rows are described once', (approvalsSource.match(/describeShiftOffer\(/g) || []).length, 1);
// The wiring from rows -> options and rows -> visible rows.
check('the filter options come from the rows', /offerFilterOptions\(rows\)/.test(approvalsSource), true);
check('and the table shows the filtered, sorted rows', /filterAndSortOffers\(rows, \{/.test(approvalsSource), true);
check('the filters feed that call', /member: memberFilter/.test(approvalsSource) && /assignment: assignmentFilter/.test(approvalsSource), true);
check('as does the sort', /sort: sortBy/.test(approvalsSource), true);

// Rendered: the control bar is there.
//
// Deliberately NOT asserting the contents of the selects here. This tab fills its list in a
// useEffect, and renderToString does not run effects - so the queue is always empty in SSR and an
// assertion on the options would pass or fail for the wrong reason. The option and ordering rules
// are covered by verify:offer-row, against the pure functions, which is where they live.
const approvalsView = (() => {
  try {
    return renderToString(
      React.createElement(AdminPendingApprovalsTab, {
        token: 'test-token',
        users: [{ id: 'u1', name: 'Member 1' }],
        assignments: [{ id: 'a1', description: 'Engine 1' }],
        schedule: [],
        scheduleTemplates: [],
        offers: [{ id: 'o1', user_id: 'u1', date_from: '2026-03-10', assignment_id: 'a1' }],
        onOffersChanged: () => {},
        onAdminDataChanged: () => {},
      })
    );
  } catch (error) {
    return { error };
  }
})();
check('the approvals tab renders', typeof approvalsView === 'string', approvalsView.error && approvalsView.error.message);
check('with both filter selects', String(approvalsView).includes('All Members') && String(approvalsView).includes('All Assignments'), true);
check('and the sort options', String(approvalsView).includes('Shift date (soonest first)'), true);
check('showing the empty state while the queue loads', String(approvalsView).includes('No pending shift offers.'), true);

// --- Training filters and totals -------------------------------------------------------------
//
// Both Training screens gained the same filter bar and an hours total. The controls are asserted
// against the rendered markup, and the totals are asserted on their VALUES - those come from the
// pure helpers, which verify:training exercises in depth, so here the question is only whether the
// screens wire them up.
const trainingFilterFixtures = [
  { id: 't1', date: '2026-03-01', title: 'SCBA Refresher', location: 'Station 1', duration: '2' },
  { id: 't2', date: '2026-03-14', title: 'Ladder Drill', location: 'Academy', duration: '3.5' },
  { id: 't3', date: '2026-04-02', title: 'Hazmat', location: 'Academy', duration: '4' },
];

const moduleWithFilters = (() => {
  try {
    return renderToString(
      React.createElement(TrainingModule, {
        token: 't',
        currentUser: { id: 'u1', name: 'Member 1' },
        trainings: trainingFilterFixtures,
        signatures: [{ id: 's1', training_id: 't1', user_id: 'u1' }],
        canEdit: true,
        onChanged: () => {},
      })
    );
  } catch (error) {
    return { error };
  }
})();
check('the member Training module renders with filters', typeof moduleWithFilters === 'string', moduleWithFilters.error && moduleWithFilters.error.message);
check('it offers the filter controls', String(moduleWithFilters).includes('Filter &amp; sort'));
check('with a date range', String(moduleWithFilters).includes('From date') && String(moduleWithFilters).includes('To date'));
check('a location filter', String(moduleWithFilters).includes('All locations'));
check('and the sort options', String(moduleWithFilters).includes('Date (newest first)'));
// Absence assertions: the condition must be NEGATED. Passing `false` as the third argument makes it
// a detail string, not a condition, which is how a "must not contain" check ends up asserting the
// opposite of its label.
check('it has no Member filter (a member sees only themselves)', !String(moduleWithFilters).includes('>Member<'));
check('the total hours are shown', visibleText(moduleWithFilters).includes('9.5 hrs'), true);
check('with the trainings shown', visibleText(moduleWithFilters).includes('Trainings shown'), true);
check('and the signed count for this member', visibleText(moduleWithFilters).includes('Signed by me'), true);
check('its per-row signature column stays', visibleText(moduleWithFilters).includes('Signature'), true);

const adminReportWithFilters = (() => {
  try {
    return renderToString(
      React.createElement(AdminTrainingTab, {
        token: 't',
        trainings: trainingFilterFixtures,
        signatures: [{ id: 's1', training_id: 't1', user_id: 'u1' }],
        users: [
          { id: 'u2', name: 'Member 2' },
          { id: 'u1', name: 'Member 1' },
        ],
        onDataChanged: () => {},
      })
    );
  } catch (error) {
    return { error };
  }
})();
check('the Training report renders with filters', typeof adminReportWithFilters === 'string', adminReportWithFilters.error && adminReportWithFilters.error.message);
check('it has a Member filter', String(adminReportWithFilters).includes('All Members'));
check(
  'with All Members first',
  String(adminReportWithFilters).indexOf('All Members') <
    String(adminReportWithFilters).indexOf('Member 1')
);
check(
  'and members sorted by name',
  String(adminReportWithFilters).indexOf('Member 1') <
    String(adminReportWithFilters).indexOf('Member 2')
);
check('the hours total is shown', visibleText(adminReportWithFilters).includes('9.5 hrs'), true);
check(
  'the signature tile is withheld for All Members',
  !visibleText(adminReportWithFilters).includes('Signed by this member')
);
check('and the location filter lists the locations present', String(adminReportWithFilters).includes('>Station 1<'));

// --- the schedule board owns ONE month, which is what stops a save deleting the station's history ------------------
//
// computeChanges deletes every row the board can see and no longer has in `working`, so the base it diffs against decides
// what a save is able to delete. Scoped to the visible month that means "what changed on this month's board"; scoped to
// the whole collection - or to the whole window the payload carried - it means the rest of history. This is a source
// check because the alternative is a test that deletes fixtures to prove it did not delete fixtures.
const boardSource = readFileSync('src/components/admin/AdminScheduleManagementTab.jsx', 'utf8');
check(
  'the board scopes its rows to the visible month',
  /const scopeToMonth = \(rows\) =>[\s\S]{0,400}?return from <= monthEndKey && to >= monthStartKey;/.test(boardSource),
  true
);
// A MONTH CHANGE MUST RE-SEED, WHATEVER THE DRAFT. The guard that lets an unsaved draft outlive a server refresh used to
// apply to the month change as well, and that combination lost saved rows: `working` kept the previous month's rows, the
// board drew the new month, and - because the same guard skipped the re-seed that fresh server rows cause - Refresh
// could not bring them back either. The draft is now keyed to its month for the same reason.
check(
  'and it re-seeds when the month changes, even with a draft in hand',
  /const monthChanged = seededMonth\.current !== monthKey;[\s\S]{0,200}?if \(!monthChanged && dirtyRef\.current\) return;/.test(
    boardSource
  ),
  'the month change is being skipped while a draft exists'
);
check(
  'and a restored draft is discarded unless it belongs to the month on screen',
  /if \(savedMonth && savedMonth !== monthKey\)/.test(boardSource),
  true
);
check(
  'and the draft is stored with the month it was made in',
  /JSON\.stringify\(\{ month: monthKey, rows: working \}\)/.test(boardSource),
  true
);
// A SAVE RE-READS THE MONTH IT EDITED, so the shared array holds what was written. This is the precise read of the
// month that changed - the section refresh answers with the whole window and can be skipped - and it is what stops a
// drag-move from being drawn back on the day it came from after a month round-trip.
check(
  'and a save re-reads the month it just wrote, so the board cannot show a stale day',
  /if \(onNeedSchedule\) void onNeedSchedule\(monthStartKey, monthEndKey\);/.test(boardSource),
  'the save relies on a refresh that may not carry the schedule'
);
// AN EMPTY-LOOKING MONTH HAS TO SAY WHICH KIND OF EMPTY IT IS. Three states draw the same grid of empty slots - nothing
// loaded, loaded but matched to no slot, and genuinely nobody rostered - and only the last is innocent. Every one of them
// used to read as "nobody is on duty", which is how a loading problem looked like a roster problem for a whole session.
check(
  'and an empty month says whether nothing was loaded or nothing matched a slot',
  /monthHoldsNothing && visibleSlots\.length > 0/.test(boardSource) && /unmatchedRows\.length > 0/.test(boardSource),
  'the board can still draw an unexplained empty month'
);
// The count is what distinguishes "a shift is on the board but beside its slot" - which reads as "it did not save" and is
// the exact shape of a report that took a whole session to pin down.
check(
  'and it counts the shifts that are loaded but not sitting in a slot, by name',
  /unmatchedRows\.length} of \{working\.length}/.test(boardSource) &&
    /const matchedKeys = new Set\(visibleSlots\.map\(\(slot\) => slotOccupant\(slot\)\?\._key\)/.test(boardSource),
  true
);
check(
  'and seeds both of its copies from that month, not from the whole schedule',
  /setWorking\(monthRows\);[\s\S]{0,80}?setBase\(monthRows\);/.test(boardSource),
  true
);
// The board owns its month and re-reads it from the server, so a failed read must NOT look like an empty month: it leaves
// the rows already on screen in place (loadScheduleWindow returns null, not []).
check(
  'and a failed read leaves the rows on screen rather than emptying the month',
  /if \(Array\.isArray\(rows\)\)/.test(boardSource),
  'a failed read would wipe the board to an empty month'
);

check(
  'with nothing left seeding state from the whole array',
  !/useState\(\(\) => normalizeRows\(schedule\)\)/.test(boardSource),
  true
);
// A PROP THAT STOPS AT AdminPanel PRODUCES NO ERROR - only a board that quietly shows the wrong month. `onNeedSchedule`
// was passed by App.jsx and never forwarded, so every month this board asked for went nowhere and it fell back to the
// shared array the payload left behind. These three checks are the forwarding itself.
const boardPanelSource = readFileSync('src/components/admin/AdminPanel.jsx', 'utf8');
check(
  'the board is handed the month reader it needs to draw anything at all',
  /onNeedSchedule=\{onNeedSchedule\}/.test(boardPanelSource) && /^\s+onNeedSchedule,$/m.test(boardPanelSource),
  'the month reader stops at AdminPanel, and the board draws nothing'
);
check(
  'and the reason a read failed, so a failed month is not drawn as an empty one',
  /scheduleWindowError=\{scheduleWindowError\}/.test(boardPanelSource),
  'a failed read would look like a month nobody is rostered on'
);
// The claims' RANGE, because an empty claims list and an unread month are the same list of zero rows: without the range
// the board cannot tell "the member marked nothing" from "this app has never read the month" - and it answered the second
// by naming every filled shift as a member who had marked no availability.
check(
  'and the range the crew\'s claims cover, so no warning is made from an unread month',
  /rosterClaimsFrom=\{rosterScope\?\.from \|\| ''\}/.test(boardPanelSource) &&
    /rosterClaimsTo=\{rosterScope\?\.to \|\| ''\}/.test(boardPanelSource),
  'the board would judge every day, whether or not it read it'
);
// ...and the way to close that gap: the board fetches the month it is judging rather than waiting for a screen the
// officer may never open. One month of claims, which is all this tab reads them for.
check(
  'and the way to ask for a month of claims this app does not hold',
  /onRosterMonth=\{onRosterMonth\}/.test(boardPanelSource),
  'the board can only judge months another screen happened to load'
);
check(
  'and the board asks for that month once, not on every render',
  /claimsAskedFor\.current === monthKey/.test(boardSource) && /ask\(year, month\)/.test(boardSource),
  'the claims for an unread month are never asked for, or are asked for on every render'
);
// ...and the board's own side of that contract: a verdict is only given for a day inside the read range.
check(
  'and the board only judges a day it actually read',
  /if \(!dayCovered\(entry\._from\)\) return true;/.test(boardSource) && /dayCovered\(e\._from\) &&/.test(boardSource),
  'a day outside the loaded range is still treated as unclaimed'
);
check(
  'and says which month it could not check instead of naming members',
  /!claimsMonthLoaded && working\.length > 0/.test(boardSource),
  'an unchecked month is reported as members who marked nothing'
);
check(
  'and it re-reads its own month on every change, never trusting a window a save may have left stale',
  /void read\(monthStartKey, monthEndKey\)/.test(boardSource) &&
    !/windowCoversMonth\(scheduleWindow, monthKey\)\) return;/.test(boardSource),
  'the board waits on a window that a save could leave stale'
);
// THE READER IS HELD IN A REF, AND THE EFFECT WATCHES THE MONTH ONLY. `loadScheduleWindow` is a plain function in App's
// body, so App re-creates it on every render - and an effect that listed it as a dependency re-ran after every read it
// had just started: read, setState, new identity, read again, forever. That is an unbounded loop of Firestore reads, and
// nothing in this file can catch it, because effects do not run during a server render. So the shape is pinned here, and
// the same guard is asserted for the claims read, which takes `loadRosterMonth` from the same place.
check(
  'and the read cannot loop: the reader is held in a ref, and the effect watches the month',
  /const needScheduleRef = useRef\(onNeedSchedule\);/.test(boardSource) &&
    /\}, \[monthStartKey, monthEndKey, monthKey\]\);/.test(boardSource),
  'the effect depends on a callback App re-creates every render, which re-reads forever'
);
check(
  'and the claims read cannot loop either',
  /const rosterMonthRef = useRef\(onRosterMonth\);/.test(boardSource) &&
    /\}, \[claimsMonthLoaded, monthKey, year, month\]\);/.test(boardSource),
  'the claims effect depends on a callback App re-creates every render'
);
// READS ARE NUMBERED, NOT CANCELLED. `main.jsx` wraps the app in StrictMode, which mounts the board, unmounts it, and
// mounts it again - so this effect runs twice on first load. A cleanup flag paired with an "already reading this month"
// guard turns that into a board that never loads at all: run one starts a read and is then cancelled, run two sees the
// month already in flight and starts nothing, and the answer that arrives is discarded because it was cancelled. No rows
// are ever applied and the spinner never stops - which is exactly how this presented. Nothing in this file can catch it,
// because effects do not run during a server render, so the shape is pinned here.
check(
  'and a superseded read cannot strand the board: reads are numbered and nothing cancels the one in flight',
  /const readSeq = useRef\(0\);/.test(boardSource) &&
    /if \(readSeq\.current !== thisRead\) return;/.test(boardSource) &&
    !/let cancelled = false;/.test(boardSource),
  'StrictMode mounts the board twice; cancelling plus deduplicating leaves the second mount with no read at all'
);

//
// Two things to pin: the tab is wired to its own permission and reaches the panel, and it is NOT part of the shared
// refresh wave - the log is the largest table in the app, so loading it on sign-in for everyone would undo the point.
// It is read ON DEMAND FROM CLOUD LOGGING, which is what replaced the collection: the filter, sorts and row mapping
// are tested for real where they can be (the Functions' own read callable), and what is left for source checks is the wiring.
// (The Audit Log tab's own source checks went with the tab. What remains below is the guard that keeps the log OFF the
// shared refresh wave, and the assertion that the read callable is gated on the permission - both still true.)

// The guard that keeps it lazy: nothing in App's admin refresh may ask for the log.
const appAuditSource = readFileSync('src/App.jsx', 'utf8');
const refreshBody = (() => {
  const start = appAuditSource.indexOf('const refreshAdminData = async');
  if (start === -1) return '';
  const end = appAuditSource.indexOf('const handleLogin', start);
  return appAuditSource.slice(start, end === -1 ? appAuditSource.length : end);
})();
check('the refresh wave was found', refreshBody.length > 300, true);
check('and it does NOT fetch the log', !/SystemLog|system_log|systemLog/.test(refreshBody));
check('nor does any other App-level fetch', !/adminFetchSystemLog/.test(appAuditSource));



//
// Two halves again: the client timer signs the user out, and the server expires the session. The
// card has three states worth asserting (unset, configured, unusable), and App has to actually arm
// the timer rather than merely importing the helpers.
const systemSettingsSource = readFileSync('src/components/admin/AdminSystemSettingsTab.jsx', 'utf8');
check('the settings card exists', /function SessionTimeoutCard/.test(systemSettingsSource), true);
check('and is mounted in the tab', /<SessionTimeoutCard/.test(systemSettingsSource), true);
check(
  'it saves the session_timeout key',
  /adminSaveSystemSetting\('session_timeout'/.test(systemSettingsSource),
  true
);
check('and is a curated key, not a generic row', /'session_timeout'/.test(systemSettingsSource), true);

// THE SIGNING WINDOW CARD, the same shape again and one difference that matters: a BLANK value means NO LIMIT rather than
// "off", which is why the card explains itself instead of being a row in the generic key/value list.
check('the signing-window card exists', /function SignatureWindowCard/.test(systemSettingsSource), true);
check('and is mounted in the tab', /<SignatureWindowCard/.test(systemSettingsSource), true);
check(
  'it saves the signing-window key',
  /adminSaveSystemSetting\(SIGNATURE_WINDOW_KEY/.test(systemSettingsSource),
  true
);
check('and is a curated key, not a generic row', /SIGNATURE_WINDOW_KEY,/.test(systemSettingsSource), true);

const windowCardView = (rawValue) => {
  try {
    return renderToString(
      React.createElement(AdminSystemSettingsTab, {
        token: 't',
        systemSettings: [{ key: 'training_signature_window_days', value: rawValue }],
        onDataChanged: () => {},
      })
    );
  } catch (error) {
    return { error };
  }
};

const windowUnset = windowCardView('');
check('the signing-window card renders with nothing configured', typeof windowUnset === 'string', windowUnset.error && windowUnset.error.message);
check('reporting No limit', visibleText(windowUnset).includes('No limit'), true);
check('and saying trainings stay open as long as they exist', visibleText(windowUnset).includes('open for signature for as long as they exist'), true);

const windowSet = windowCardView('30');
check('a configured window reports its days', visibleText(windowSet).includes('30 days'), true);
check('and works out the last day for the reader', visibleText(windowSet).includes('closes after 31 March'), true);

const windowBad = windowCardView('3O');
check('an unreadable value says it cannot be used', visibleText(windowBad).includes('cannot be used, so there is no window at all'), true);
check('and reports No limit rather than a wrong number', visibleText(windowBad).includes('No limit'), true);

const timeoutCardView = (rawValue) => {
  try {
    return renderToString(
      React.createElement(AdminSystemSettingsTab, {
        token: 't',
        systemSettings: [{ key: 'session_timeout', value: rawValue }],
        onDataChanged: () => {},
      })
    );
  } catch (error) {
    return { error };
  }
};

const timeoutUnset = timeoutCardView('');
check('the card renders with nothing configured', typeof timeoutUnset === 'string', timeoutUnset.error && timeoutUnset.error.message);
check('reporting Not enforced', visibleText(timeoutUnset).includes('Not enforced'), true);
check('and saying sessions are not timed out', visibleText(timeoutUnset).includes('not timed out for inactivity'), true);
check('with the input present', String(timeoutUnset).includes('Idle timeout (minutes)'), true);

const timeoutSet = timeoutCardView('30');
check('a configured timeout reports Enforcing', visibleText(timeoutSet).includes('Enforcing'), true);
check('and names the period', visibleText(timeoutSet).includes('30 minutes'), true);
check('and mentions the server half', visibleText(timeoutSet).includes('stops working on the server'), true);

const timeoutBad = timeoutCardView('half an hour');
check('an unusable value does NOT report Enforcing', visibleText(timeoutBad).includes('Not enforced'), true);
check('it explains that it cannot be used', visibleText(timeoutBad).includes('cannot be used'), true);
check('and quotes the offending value', visibleText(timeoutBad).includes('half an hour'), true);

// App.jsx: the timer, the banner, and the keep-alive.
const timeoutAppSource = readFileSync('src/App.jsx', 'utf8');
check('App derives the timeout from the system settings', /sessionTimeoutConfig\(systemSettings\)/.test(timeoutAppSource), true);
check('it arms a one-second tick', /setInterval\(evaluate, 1000\)/.test(timeoutAppSource), true);
check('it listens for interaction', /IDLE_RESET_EVENTS.forEach/.test(timeoutAppSource), true);
// The dependency list is the reset mechanism, so assert what it must CONTAIN rather than its exact
// text. `activeTab` is the navigation reset; `applyIdleWarning` keeps the effect's callback stable.
const idleEffectDeps = (() => {
  const match = /const timer = setInterval\(evaluate, 1000\);[\s\S]*?\}, \[([^\]]+)\]\);/.exec(timeoutAppSource);
  return match ? match[1].split(',').map((part) => part.trim()) : [];
})();
check('the idle effect has a dependency list', idleEffectDeps.length > 0, true);
check('including activeTab, which is the navigation reset', idleEffectDeps.includes('activeTab'), true);
check('and currentUser, so it only runs when signed in', idleEffectDeps.includes('currentUser'), true);
check('and sessionConfig, so a settings change re-arms it', idleEffectDeps.includes('sessionConfig'), true);
check('and the stable warning setter', idleEffectDeps.includes('applyIdleWarning'), true);

// --- push notifications do not depend on a session ---------------------------------------------
//
// The idle timeout signs people out, so it is worth pinning what it must NOT affect: sending a push
// is server-to-server with the service account, the device token is keyed by member rather than by
// session, and signing out must therefore leave the device registered.
const pushAppSource = timeoutAppSource;
check(
  'the in-app push toast is gated on being signed in',
  /if \(!\('serviceWorker' in navigator\) \|\| !currentUser\) return undefined;/.test(pushAppSource),
  true
);
check(
  'and re-subscribes when that changes',
  /\}, \[currentUser\]\);/.test(pushAppSource),
  true
);
// Signing out must not unregister the device, or the idle timeout would silently stop notifications.
const signOutBody = (() => {
  const match = /const endSession = useCallback\(\(message\) => \{([\s\S]*?)\}, \[applyIdleWarning\]\);/.exec(pushAppSource);
  return match ? match[1] : '';
})();
check('the idle sign-out was found', signOutBody.length > 100, true);
// Negated: `check` passes only when its condition is TRUE, so "must not contain" is !test(...).
check('it does not clear the FCM token', !/fcm_token/.test(signOutBody));
check('it does not unregister the service worker', !/unregister|deleteToken|pushManager/.test(signOutBody));

const logoutBody = (() => {
  const match = /const handleLogout = \(\) => \{([\s\S]*?)\n  \};/.exec(pushAppSource);
  return match ? match[1] : '';
})();
check('the manual sign-out was found', logoutBody.length > 100, true);
check('it does not clear the FCM token either', !/fcm_token|unregister/.test(logoutBody));

// Registration is a settings write, so it does need a session - inherent, not a regression. Read
// here rather than reusing a const declared further down, which is a use-before-declaration that
// silently evaluated as "no match".
check(
  'the token is registered through the callable',
  /export const registerPushDevice/.test(readFileSync('src/services/api.js', 'utf8'))
);

check('it re-checks when the tab becomes visible', /addEventListener\('visibilitychange', evaluate\)/.test(timeoutAppSource), true);
check('it signs the user out when the state expires', /idleState\(lastActivityRef.current, now, sessionConfig\)/.test(timeoutAppSource) && /endSession\(idleLogoutMessage/.test(timeoutAppSource), true);
check('the warning banner renders', /Still there\? You will be signed out in/.test(timeoutAppSource), true);
check('with a stay-signed-in action', /Stay signed in/.test(timeoutAppSource) && /handleStaySignedIn/.test(timeoutAppSource), true);
// The button used to push the SERVER session window out as well, or it would have dismissed the warning while the
// session quietly lapsed anyway. There is no server session now - the SDK refreshes the Firebase session itself - so
// what is asserted is what the button actually does: reset the timer the warning reads.
check(
  'which resets the idle clock the warning reads',
  /const handleStaySignedIn = \(\) => \{[\s\S]*?lastActivityRef\.current = Date\.now\(\)/.test(timeoutAppSource) &&
    /handleStaySignedIn[\s\S]*?applyIdleWarning\(null\)/.test(timeoutAppSource),
  true
);
// The call, not the word: the comment in handleStaySignedIn names pingSession deliberately, to say what it was for.
check('and has no server session left to push', /pingSession\(/.test(timeoutAppSource) === false);
check('and an explicit sign-out action', /Sign out now/.test(timeoutAppSource), true);
check('listeners are removed on cleanup', /removeEventListener\(event, markActive\)/.test(timeoutAppSource) && /clearInterval\(timer\)/.test(timeoutAppSource), true);

const apiSource = readFileSync('src/services/api.js', 'utf8');
// The PING action is gone from the client: it existed to push the Apps Script session window out, and there is no such
// window now - Firebase's SDK keeps its own session fresh.
// `check` here takes a CONDITION, not an (actual, expected) pair - so the negation belongs inside it. Passing `false`
// as a third argument reads as "and here is the detail to print", not as "this must be false".
check('the PING action is gone from the client', /action: 'PING'/.test(apiSource) === false);

// --- the clock-refusal modal, actually rendered -------------------------------------------------
//
// The reported bug: clocking out of GPS range loaded for a moment and then stopped, with nothing
// shown. The refusal was written to `statusMessage`, which ONLY LoginScreen renders, so while signed
// in every clock message was invisible. These render the modal for real rather than trusting the
// wiring, because "the component exists" was already true when the bug shipped.
console.log('\n--- clock refusal modal (rendered) ---');

const tooFarHtml = renderToString(
  React.createElement(ClockBlockedModal, {
    notice: clockLocationNotice(
      { allowed: false, code: 'outside', distanceFeet: 5000, message: 'You are about 5,000 ft from the station, outside the 1,000 ft limit. Move closer and try again.' },
      { configured: true, marginFeet: 1000 }
    ),
    onDismiss: () => {},
  })
);

check('it renders a dialog', /role="dialog"/.test(tooFarHtml), true);
check('with the title', /Too far from the station/.test(tooFarHtml), true);
check('the server/client message', /5,000 ft from the station/.test(tooFarHtml), true);
check('the measured distance', /5,000 ft/.test(tooFarHtml), true);
check('the allowed limit', /1,000 ft/.test(tooFarHtml), true);
check('a hint about clocking in at the station', /has to be done at the station/.test(tooFarHtml), true);
check('and a dismiss button', /Got it/.test(tooFarHtml), true);

// Nothing to report must render nothing at all - a modal with no notice would be a blank overlay
// trapping the member out of the app.
check('no notice renders nothing', renderToString(React.createElement(ClockBlockedModal, { notice: null, onDismiss: () => {} })) === '', true);

const noLocationHtml = renderToString(
  React.createElement(ClockBlockedModal, {
    notice: clockLocationNotice({ allowed: false, code: 'no-coords', message: 'Your location could not be determined.' }, { configured: true, marginFeet: 1000 }),
    onDismiss: () => {},
  })
);
check('a missing-location refusal renders', /Location required/.test(noLocationHtml), true);
check('telling them to allow access', /Allow location access/.test(noLocationHtml), true);
check('and shows no invented distance', !/NaN/.test(noLocationHtml) && !/ ft</.test(noLocationHtml), true);

// The backend's own refusal carries no distance, so the numbers must simply be absent.
const serverHtml = renderToString(
  React.createElement(ClockBlockedModal, {
    notice: clockLocationNotice({ allowed: false, code: 'OUT_OF_RANGE', message: 'Clocking must be done on site.' }),
    onDismiss: () => {},
  })
);
check('a server refusal renders', /Clocking must be done on site/.test(serverHtml), true);
check('with no NaN anywhere', !/NaN/.test(serverHtml), true);

const clockModalSource = readFileSync('src/components/ClockBlockedModal.jsx', 'utf8');
check('and it renders nothing when handed no notice', /if \(!notice\) return null/.test(clockModalSource), true);

const clockNoticeSource = readFileSync('src/utils/clockLocation.js', 'utf8');
check('the notice builder is a pure function of the outcome', /export const clockLocationNotice = \(outcome, config\)/.test(clockNoticeSource), true);

// --- the confirmation dialog, actually rendered ------------------------------------------------
//
// This replaced window.confirm in thirteen places. verify:confirmations reads the source for the contract (it must
// be announced, dismissible, and sound like a confirmation); this renders it, because those are different kinds of
// evidence - a component can read correctly and still render the wrong thing, which is what a screen reader and a
// sighted member would actually get.
console.log('\n--- confirmation dialog (rendered) ---');

// Static markup rather than renderToString, because this asserts the exact text and characters a member reads:
// renderToString inserts `<!-- -->` between adjacent text nodes to mark hydration boundaries, and those would sit
// inside the sentence being matched.
const confirmHtml = renderToStaticMarkup(
  React.createElement(ConfirmModal, {
    title: 'Delete user',
    message: React.createElement(
      React.Fragment,
      null,
      'Delete ',
      React.createElement('strong', { className: 'font-semibold' }, 'Jane Smith'),
      '? This cannot be undone.'
    ),
    confirmLabel: 'Delete',
    onConfirm: () => {},
    onCancel: () => {},
  })
);

check('it renders an alert dialog', /role="alertdialog"/.test(confirmHtml), true);
check('marked modal', /aria-modal="true"/.test(confirmHtml), true);
check('labeled by an id', /aria-labelledby="[^"]+"/.test(confirmHtml), true);
check('and described by an id', /aria-describedby="[^"]+"/.test(confirmHtml), true);
check('the label id is a real one', confirmHtml.includes(`id="${/aria-labelledby="([^"]+)"/.exec(confirmHtml)?.[1]}"`), true);
check('the title is a heading', /<h2[^>]*>Delete user<\/h2>/.test(confirmHtml), true);
check(
  'the message names what goes',
  /Delete <strong class="font-semibold">Jane Smith<\/strong>\? This cannot be undone\./.test(confirmHtml),
  true
);
check('the confirmation says what it does', /<button[^>]*>Delete<\/button>/.test(confirmHtml), true);
check('and there is a way out', /<button[^>]*>Cancel<\/button>/.test(confirmHtml), true);
check('the destructive button is the red one', /bg-red-600/.test(confirmHtml), true);

// The message is optional, and a dialog that still describes a message it does not render is a lie to a screen
// reader - so the aria-describedby has to disappear with it. The "expected" value here is a condition, not a value
// to compare: this harness prints the third argument only when the condition FAILS, so it is the diagnostic.
const bareHtml = renderToStaticMarkup(
  React.createElement(ConfirmModal, { title: 'Remove it?', onConfirm: () => {}, onCancel: () => {} })
);
check('it renders with no message at all', /<h2[^>]*>Remove it\?<\/h2>/.test(bareHtml), true);
check(
  'and then describes nothing',
  !/aria-describedby/.test(bareHtml),
  `/aria-describedby="[^"]*"/.exec(bareHtml)?.[0] ?? 'present, but not as an attribute this check can show'`
);
check('the labels have sane defaults', /<button[^>]*>Confirm<\/button>/.test(bareHtml), true);
check('including the way out', /<button[^>]*>Cancel<\/button>/.test(bareHtml), true);

// --- My Clock History: filters, sorting and the summary cards ---------------------------------
//
// The summary cards now total the FILTERED rows. The trap this guards is the obvious one: if the
// cards kept totalling every entry while the table showed three, a member reading "Total Hours
// Logged" next to a filtered list would be reading the wrong number.
console.log('\n--- My Clock History (rendered) ---');

const clockMember = { id: '10', name: 'Member 1' };
const clockLogs = [
  { id: 'l1', user_id: '10', time_in: '2026-03-10 08:00:00', time_out: '2026-03-10 16:00:00', calc_hours: '8' },
  { id: 'l2', user_id: '10', time_in: '2026-03-12 08:00:00', time_out: '2026-03-12 10:00:00', calc_hours: '2' },
  { id: 'l3', user_id: '11', time_in: '2026-03-11 08:00:00', time_out: '2026-03-11 12:00:00', calc_hours: '4' },
];

const historyHtml = renderToString(
  React.createElement(MyClockHistory, { currentUser: clockMember, logs: clockLogs, timeFormat: '12', shifts: [] })
);
// visibleText strips the <!-- --> markers React's SSR puts between text and an interpolated value, so
// "Showing 2 of 2 entries" reads as written rather than as "Showing <!-- -->2<!-- --> of ...".
const historyText = visibleText(historyHtml);

check('the filter bar renders', /Showing 2 of 2 entries/.test(historyText), historyText.slice(0, 120));
check('with a From and To date input', (historyHtml.match(/type="date"/g) || []).length === 2);
check('a status select', /All Entries/.test(historyText) && /Active \(Clocked In\)/.test(historyText) && /Completed/.test(historyText));
check('a sort select', /Time In \(Newest First\)/.test(historyText) && /Duration \(Longest First\)/.test(historyText));
// Boolean-only checks: negate rather than passing a desired `false` as a third argument, which the
// helper treats as a detail string and counts a failing condition as a failure.
check('it does not offer the administrator-only name sort', !/Member Name \(A-Z\)/.test(historyText));
// Asserted on the DATE of the other member's entry rather than on its id: a bare "l3" matches
// Tailwind classes such as ml-3 and pl-3, which would make this pass for the wrong reason.
check("another member's entry is absent", !/Mar 11/.test(historyText));
check('the hours card totals only this member', /10 hrs/.test(historyText));
check('the entries card counts only this member', /2 entries/.test(historyText));
check('and nothing is labeled filtered when no filter is set', !/\(filtered\)/.test(historyText));
check('so there is no clear-filters link', !/Clear filters/.test(historyText));
// Rows carry toLocaleDateString('en-US') output, so this asserts on "3/12/2026" rather than "Mar 12".
check('the rows are newest first', historyText.indexOf('3/12/2026') < historyText.indexOf('3/10/2026'));

const emptyHistoryHtml = renderToString(
  React.createElement(MyClockHistory, { currentUser: { id: '99', name: 'Nobody' }, logs: clockLogs, timeFormat: '12', shifts: [] })
);
const emptyHistoryText = visibleText(emptyHistoryHtml);
check('a member with no entries gets the plain empty message', /You have no recorded clock entries yet\./.test(emptyHistoryText));
check('and totals of zero rather than a blank', /0 hrs/.test(emptyHistoryText) && /0 entries/.test(emptyHistoryText));
check('with no (filtered) label, since nothing is filtered', !/\(filtered\)/.test(emptyHistoryText));

const historySource = readFileSync('src/components/MyClockHistory.jsx', 'utf8');
check('the admin-only sort is excluded deliberately', /value !== 'name_asc'/.test(historySource), true);
check('the table and the cards read the same list', /logs=\{visibleLogs\}/.test(historySource), true);

// ---------------------------------------------------------------------------
// THE TABS THAT NAME A MEMBER DRAW THOSE NAMES FROM THE MERGED ROWS. The bug this exists for: every tab read a
// `users` prop, the payload refactor left it empty on a fresh session, and the rows of the Certifications and
// Schedule tabs read "Unnamed member" - with every other check green. The fix is one merge (AdminPanel#nameRows:
// the public directory, with the joined Users section laid over it) handed to every name-drawing tab. The rows are
// DIRECTORY-SHAPED on a fresh session, so nothing in a tab may require `user_name` or `status` to draw a name.
const directoryRows = [
  { id: '10', name: 'Member 1', rank_id: 'r1', exclude_from_scheduling: false, runner_sound_profile: '' },
];
const certFixture = {
  token: 'test-token',
  setup: [{ id: 'c1', name: 'EMT-B', icon: 'heart-pulse', is_renewable: true }],
  records: [
    {
      id: 'k1',
      user_id: '10',
      certification_id: 'c1',
      icon: 'heart-pulse',
      name: 'EMT-B',
      effective_date: '2026-08-19',
      end_date: '2030-08-19',
      state: 'active',
    },
  ],
};
const certFromDirectory = renderToString(
  React.createElement(AdminCertificationsTab, { ...certFixture, users: directoryRows })
);
check(
  'the certifications tab names members from directory-shaped rows',
  String(certFromDirectory).includes('Member 1') && !String(certFromDirectory).includes('Unnamed member'),
  true
);
// The merge lives in ONE place, and the props follow from it: every name-drawing tab takes the merged rows, while
// the Users tab keeps the joined section (it edits the username and the status, which the directory does not carry).
const panelForNames = readFileSync('src/components/admin/AdminPanel.jsx', 'utf8');
check('the panel merges the directory with the joined users rows', /const nameRows = useMemo\(/.test(panelForNames), true);
const nameRowConsumers = (panelForNames.match(/users=\{nameRows\}/g) || []).length;
check('and hands them to every tab that names a member', nameRowConsumers >= 10, `${nameRowConsumers} consumer(s)`);
check('while the Users tab keeps the joined rows it edits', /<AdminUsersTab[\s\S]{0,400}?users=\{users\}/.test(panelForNames), true);
// THE NEGATIVE, which is what actually broke: no name-drawing tab may be wired to the joined rows alone.
check(
  'and nothing still draws names from the unjoined rows',
  !/<Admin(Certifications|ScheduleManagement|Availability|ClockManagement|Assignments|SystemLog|Announcements|Events|Training|PendingApprovals)Tab[\s\S]{0,400}?users=\{users\}/.test(
    panelForNames
  ),
  true
);

// ---------------------------------------------------------------------------
// A "New X" card is an editor modal: the form is not on the page until it is asked for, it is submitted from the
// modal's toolbar, and it closes when the save lands. Ranks and Shifts are the first two converted; this is the
// shape the rest are being brought to, so it is asserted as a shape rather than tab by tab.
const editorModalTabs = {
  'AdminRanksTab.jsx': readFileSync('src/components/admin/AdminRanksTab.jsx', 'utf8'),
  'AdminShiftsTab.jsx': readFileSync('src/components/admin/AdminShiftsTab.jsx', 'utf8'),
};
Object.entries(editorModalTabs).forEach(([file, source]) => {
  check(`${file} mounts its editor only while it is open`, /\{editorOpen && \(/.test(source), true);
  check(`${file} opens it from a row and from New`, /setEditorOpen\(true\)/.test(source) && /setEditorOpen\(\)/.test(source) === false, true);
  check(`${file} submits through the toolbar's form id`, /formId=\{[A-Z_]+_FORM_ID\}/.test(source) && /id=\{[A-Z_]+_FORM_ID\}/.test(source), true);
  check(`${file} closes when the form is reset`, /const resetForm = \(\) => \{\s*setFormData\(EMPTY_FORM\);\s*setEditorOpen\(false\);\s*\};/.test(source), true);
  check(`${file} says it is saving`, /saving=\{saving\}/.test(source) && /saveLabel=/.test(source), true);
  check(`${file} has a New button in the list header`, /New (rank|shift)/.test(source), true);
});

// The Ranks tab's order is the one column in this app that a save can silently leave behind, because it drives a rule
// rather than being read back as text: `rank_order` decides an assignment's minimum rank, an event's "this rank and
// above" audience, and the order a day's crew draws in. It was collected by the form, sent by nothing, and the save
// still reported success - so the table showed the number for the length of a refresh wave and then the old one back.
//
// The write half of that is pinned in scripts/verify-write-safety.mjs (the payload carries every column the form
// collects). These are the two display halves of the same round trip, because either one alone leaves an officer
// looking at a stale number and no way to tell a refused save from one that was never sent.
console.log('\n--- a rank\'s order survives the round trip ---');
const ranksTabSource = readFileSync('src/components/admin/AdminRanksTab.jsx', 'utf8');
check(
  'the editor opens with the rank\'s own order in the field',
  /rank_order:\s*rank\.rank_order === undefined \|\| rank\.rank_order === null \? '' : String\(rank\.rank_order\)/.test(
    ranksTabSource
  ),
  'opening the editor does not carry the stored order, so saving overwrites it with a blank'
);
check('and the field is bound to that form state', /formData\.rank_order/.test(ranksTabSource), 'the input is not the form state');
// A number the officer typed has to reach the table, and a blank has to read as absent rather than as zero.
check(
  'the list reads the order back off the row',
  /Number\.isFinite\(parseInt\(rank\.rank_order, 10\)\) \? parseInt\(rank\.rank_order, 10\)/.test(ranksTabSource),
  'the list does not draw the stored order'
);
check(
  'and says so when there is none',
  /Not set/.test(ranksTabSource),
  'an unset order is indistinguishable from a real one'
);
// The table is sorted BY that column, which is why losing it also reorders the page under the officer.
check(
  'the list is sorted by it, so a lost order is visible as a list that will not keep its order',
  /bo - ao/.test(ranksTabSource) && /parseInt\(a\.rank_order, 10\)/.test(ranksTabSource),
  'the table is not sorted by rank order'
);

console.log('\n--- every editor closes when it is asked to ---');
// The bug this exists for: AdminCertificationSetupTab wired onClose={startNew}, which looked right and was not.
// startNew OPENS the editor - the New button calls it - so closing left the open state true, the dismissal
// animation hid the panel anyway, and the next Edit changed the form data with nothing on screen to show for it.
// A handler that opens cannot be a handler that closes, and the only way to tell is to look at what it does.
const CLOSING_TABS = [
  'AdminRanksTab.jsx',
  'AdminShiftsTab.jsx',
  'AdminAnnouncementsTab.jsx',
  'AdminScheduleTemplatesTab.jsx',
  'AdminAssignmentsTab.jsx',
  'AdminCertificationSetupTab.jsx',
  'AdminCertificationsTab.jsx',
  'AdminUsersTab.jsx',
  'AdminClockManagementTab.jsx',
  'AdminEventsTab.jsx',
  'AdminRolesTab.jsx',
  'AdminDocumentsTab.jsx',
];
CLOSING_TABS.forEach((file) => {
  const src = readFileSync(`src/components/admin/${file}`, 'utf8');
  const named = (/onClose=\{([\w$]+)\}/.exec(src) || [])[1] || '';
  // A concise or braced arrow that closes is proven by its own pattern.
  const inline = /onClose=\{\(\) => [\s\S]{0,140}?Open\(false\)/.test(src);
  check(`${file} says what closes its editor`, named !== '' || inline, true);
  if (!named) return;
  // The handler's BODY, not the file after it: searching forward from the definition runs straight into the next
  // function, which is how an editor whose only sin was a nearby `startNew` looked like it never closed.
  const body = (
    new RegExp(`const ${named} = \\(\\) => \\{([\\s\\S]{0,300}?)\\};`).exec(src) || ['', '']
  )[1];
  check(
    `${file}'s close handler closes rather than opens`,
    body === '' || (/Open\(false\)/.test(body) && !/Open\(true\)/.test(body)),
    true
  );
});
// The training form renders a modal and hands the close to its callers, so they own it - both of them.
['src/components/admin/AdminTrainingTab.jsx', 'src/components/TrainingModule.jsx'].forEach((file) => {
  check(
    `${file} closes the training editor itself`,
    /onCancel=\{\(\) => \{\s*setEditing\(null\);\s*setEditorOpen\(false\);/.test(readFileSync(file, 'utf8')),
    true
  );
});

console.log('\n--- the member-facing Roster module ---');
const rosterHtml = renderToStaticMarkup(
  React.createElement(RosterModule, {
    members: [{ id: 'm1', name: 'Jordan Jones', rank_id: 'k1' }],
    ranks: [{ id: 'k1', description: 'Captain', color: '#c3223b', icon: 'shield-check' }],
    certificationTypes: [{ id: 'c1', name: 'Emergency Medical Technician', icon: 'heart-pulse' }],
    memberCertificationIds: { m1: ['c1'] },
  })
);
check('the Roster has Name and Rank columns', rosterHtml.includes('>Name</th>') && rosterHtml.includes('>Rank</th>'));
check(
  'the Roster scrolls inside a bounded container with sticky headings',
  rosterHtml.includes('max-h-[calc(100dvh-18rem)]') &&
    rosterHtml.includes('overflow-auto') &&
    (rosterHtml.match(/sticky top-0/g) || []).length === 3
);
check('the member name and colored rank icon render', rosterHtml.includes('Jordan Jones') && rosterHtml.includes('Captain') && rosterHtml.includes('color:#c3223b'));
check('certification names are truncated with their full label available', rosterHtml.includes('title="Emergency Medical Technician"') && rosterHtml.includes('truncate'));
check('an active certification is indicated in its own column', rosterHtml.includes('aria-label="Emergency Medical Technician active"'));
check('the read-only module offers no member editing actions', !/\b(Edit|Delete|Add member)\b/.test(rosterHtml));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
