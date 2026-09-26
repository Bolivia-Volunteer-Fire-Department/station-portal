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
import { renderToString } from 'react-dom/server';
import { CENTERED_CONTENT_TABS, CONTENT_MAX_WIDTH } from '../src/utils/contentWidth.js';
import { ADMIN_BAR_LABELS, PAGE_BAR_LABELS, adminBarLabel, pageBarLabel } from '../src/utils/pageLabels.js';
import CenteredContent from '../src/components/CenteredContent.jsx';
// The whole app, so the shell itself can be rendered. Everything below is a component in isolation; a mistake in
// App's own body - a derived value that reads state declared further down, for instance - was invisible to all of
// it and to every source check, and took the entire app down in the browser.
import App from '../src/App.jsx';
import AdminPanel, { ADMIN_NAV_CATEGORIES } from '../src/components/admin/AdminPanel.jsx';
import Sidebar from '../src/components/Sidebar.jsx';
import AdminRolesTab from '../src/components/admin/AdminRolesTab.jsx';
import AdminScheduleTemplatesTab from '../src/components/admin/AdminScheduleTemplatesTab.jsx';
import AdminAssignmentsTab from '../src/components/admin/AdminAssignmentsTab.jsx';
import MyAvailability from '../src/components/MyAvailability.jsx';
import AvailabilityCalendar from '../src/components/AvailabilityCalendar.jsx';
import AdminAvailabilityTab from '../src/components/admin/AdminAvailabilityTab.jsx';
import AdminScheduleManagementTab from '../src/components/admin/AdminScheduleManagementTab.jsx';
import HelpGuides from '../src/components/HelpGuides.jsx';
import Markdown from '../src/components/Markdown.jsx';
import { hasGuideContent, helpGuides } from '../src/utils/helpGuides.js';
import AdminSystemSettingsTab from '../src/components/admin/AdminSystemSettingsTab.jsx';
import AdminAvailabilityRoster from '../src/components/admin/AdminAvailabilityRoster.jsx';
import AdminUsersTab from '../src/components/admin/AdminUsersTab.jsx';
import AdminPendingApprovalsTab from '../src/components/admin/AdminPendingApprovalsTab.jsx';
import AdminTrainingTab from '../src/components/admin/AdminTrainingTab.jsx';
import AdminSystemLogTab from '../src/components/admin/AdminSystemLogTab.jsx';
import { ADMIN_PERMISSIONS, roleAllowsTab } from '../src/utils/permissions.js';
import TrainingModule from '../src/components/TrainingModule.jsx';
import ClockBlockedModal from '../src/components/ClockBlockedModal.jsx';
import MyClockHistory from '../src/components/MyClockHistory.jsx';
import { clockLocationNotice } from '../src/utils/clockLocation.js';
import TrainingForm from '../src/components/training/TrainingForm.jsx';
import FirefighterRunner from '../src/components/FirefighterRunner/FirefighterRunner.jsx';
import ScheduleCalendar from '../src/components/ScheduleCalendar.jsx';
import UserSettings from '../src/components/UserSettings.jsx';

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
check('and gets as far as the loading screen', String(appRender.html || '').includes('animate-spin'));
check('with nothing from the signed-in shell in it', !String(appRender.html || '').includes('My Schedule'));

// The role shapes that matter: full access, one tab only, member-only, and a role
// that has been granted nothing at all.
const ROLES = {
  administrator: { id: 'r1', description: 'Administrator', is_admin: true },
  approverOnly: { id: 'r2', description: 'Lieutenant', can_approve_shifts: 'TRUE' },
  usersOnly: { id: 'r3', description: 'Clerk', can_edit_users: 'TRUE' },
  memberOnly: { id: 'r4', description: 'Firefighter', can_view_my_schedule: true, can_use_timeclock: true },
  nothing: { id: 'r5', description: 'Suspended', is_admin: false },
};

const users = [{ id: 'u1', name: 'Matt', role_id: 'r1', rank_id: 'k1', status: 'active' }];
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
  // 1. The Administration panel, opened on whatever tab the role is allowed.
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
  // The category bar is filtered by the same permission list, so it shows what the
  // role can reach. (The sub-tab labels themselves only exist inside an open
  // dropdown, so the categories are the reliable thing to assert on.) Note the
  // Users tab has its own "Scheduling" column, so presence of that word alone
  // proves nothing - the table header is the precise marker.
  if (name === 'approverOnly') {
    check('an approver-only role gets the Scheduling category', panelHtml.includes('Scheduling'));
    check('and not the People category it cannot use', !panelHtml.includes('>People<'));
    check('and the Users panel is not rendered', !panelHtml.includes('Scheduling</th>'));
  }
  if (name === 'usersOnly') {
    check('a users-only role gets the People category', panelHtml.includes('>People<'));
    check('and lands on the Users panel', panelHtml.includes('Scheduling</th>'));
  }
  if (name === 'administrator') {
    check('an administrator sees every category', ['People', 'Scheduling', 'Timeclock', 'System'].every((label) => panelHtml.includes(label)));
  }
  if (name === 'memberOnly' || name === 'nothing') {
    check(`a ${name} role sees no administration panels`, !panelHtml.includes('Scheduling</th>'));
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
    check(`the Roles editor renders for a ${name} role`, editor.includes('Administrator access'));
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
check('a misspelled column is reported as unrecognised', String(typoCard).includes('can_edit_schedule_template'));
check('and it is called out as doing nothing', String(typoCard).includes('not recognised'));

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
check('with a nickname field in the form', String(templatesHtml).includes('Nickname (optional)'));
check('and the nickname drawn on the week card', String(templatesHtml).includes('Day Shift'));

console.log('\n--- the Assignments tab ---');
// The optional icon picker is drawn from the same catalogue the ranks editor uses
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
check('with the icon picker', String(assignmentsHtml).includes('-- No Icon --'));
// The catalogue itself is the same RANK_ICON_MAP the ranks editor renders, so an option
// that exists there must exist here.
check(
  'and the catalogue the ranks editor uses',
  String(assignmentsHtml).includes('<option value="star">star</option>')
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
check('the form offers an Effective Date', /Effective Date/.test(assignmentsText));
check('and an End Date', /End Date/.test(assignmentsText));
check('with two date inputs', (String(assignmentsHtml).match(/type="date"/g) || []).length === 2);
check('marking the effective date required', /Effective Date \(required\)/.test(assignmentsText));
check('and the end date optional', /End Date \(optional\)/.test(assignmentsText));
check('explaining what the effective date means', /The first date this assignment may be used/.test(assignmentsText));
check('and that a blank end means still available', /still available/.test(assignmentsText));
check('and noting that existing shifts are never removed', /never removed/.test(assignmentsText));
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
const availDow = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][
  new Date(availYear, availMonth, 15).getDay()
];
const availTemplate = {
  id: 't1',
  day_of_week: availDow,
  start_time: '08:00',
  end_time: '18:00',
  assignment_id: 'a1',
};
const availAssignment = { id: 'a1', description: 'Firefighter 3', icon: 'flame' };
const availMember = { id: 'u1', name: 'Member 1', rank_id: 'k1', status: 'active' };
const availRows = [
  { id: 1, schedule_template_id: 't1', date_from: availDay, date_to: availDay, user_id: 'u1' },
];

const calendarHtml = (() => {
  try {
    return renderToString(
      React.createElement(AvailabilityCalendar, {
        member: availMember,
        availability: availRows,
        scheduleTemplates: [availTemplate],
        assignments: [availAssignment],
        ranks: [{ id: 'k1', description: 'Firefighter', rank_order: 1 }],
        onSave: async () => ({ success: true }),
      })
    );
  } catch (error) {
    return { error };
  }
})();
check('the member grid renders', typeof calendarHtml === 'string', calendarHtml.error && calendarHtml.error.message);
check('with the availability legend', String(calendarHtml).includes('Not marked'));
check('and the shift it preloaded', String(calendarHtml).includes('Firefighter 3'));
check('marking the marked shift as available', String(calendarHtml).includes('bg-emerald-600'));
check('showing the assignment icon too', String(calendarHtml).includes('lucide-flame'));
// Ticks are held locally now, so the Save button must be present and start disabled (no
// changes yet) - that is the whole point of the batch.
check('with a batch save button', String(calendarHtml).includes('Save availability'));
check('starting disabled until something changes', calendarHtml.includes('disabled=""'));

const myAvailabilityHtml = (() => {
  try {
    return renderToString(
      React.createElement(MyAvailability, {
        token: 'test-token',
        currentUser: availMember,
        availability: availRows,
        scheduleTemplates: [availTemplate],
        assignments: [availAssignment],
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
        availability: availRows,
        scheduleTemplates: [availTemplate],
        assignments: [availAssignment],
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
// Both members are in the picker, so the meaningful assertion is about the ROSTER rows:
// a marked member appears as a chip (<span>), an unmarked one only as an <option>.
check('and naming the members who marked the shift', String(adminAvailabilityHtml).includes('>Member 1</span>'));
check(
  'while the member who said nothing is not listed as available',
  !String(adminAvailabilityHtml).includes('>Member 3</span>')
);

console.log('\n--- the Schedule Management board ---');
// A vacancy in this tab is labelled with its ASSIGNMENT, not the word "Open" (the vacancy
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
// The word would only appear if something still labelled a vacancy with it.
check('and no longer says "Open"', !String(boardHtml).includes('Open'));
// Still styled as a vacancy, which is now doing the work the word used to do.
check('keeping its vacancy styling', String(boardHtml).includes('text-slate-400'));

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
  'the pane is rendered as a labelled scroll region',
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
    return renderToString(React.createElement(HelpGuides, { scope: 'admin', initialSlug: '14-system-settings' }));
  } catch (error) {
    return { error };
  }
})();
check('an Important alert renders', /<span>Important<\/span>/.test(String(importantGuideView)) && /lucide-circle-alert/.test(String(importantGuideView)), true);

// The Help guide documents the alert syntax in a fenced block. That example must stay INERT: one real
// alert on the page (its own Note) and the sample visible as code, not rendered as a second callout.
const helpAboutHelpView = (() => {
  try {
    return renderToString(React.createElement(HelpGuides, { scope: 'admin', initialSlug: '17-help' }));
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
// Asserted on the exported nav catalogue rather than the HTML: the sub-tab labels live inside a
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
// The retired Shifts tab stays out of the nav.
check('the retired Shifts tab is still absent', categoryOf('shifts') === null);

console.log('\n--- the Clock Location settings card ---');
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
    instructors: 'Capt. Alvarez',
    is_certification: 'TRUE',
    is_drill: 'TRUE',
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
// Badges come from the member-facing flag set.
check('a set flag shows as a badge', String(signerView).includes('Cert'));
check('an unset flag does not', !String(signerView).includes('Fire prev'));

const editorView = trainingModule({ canEdit: true });
check('an editor gets the add/edit form', String(editorView).includes('Add New Training'));
check('and an Edit action per row', String(editorView).includes('>Edit<'));
check('but still no delete', !String(editorView).toLowerCase().includes('delete'));
// Rule: a training anybody has signed, or one that is locked, cannot be edited from the module.
check('the Edit button is disabled for a signed training', /disabled=""[^>]*title="Somebody has already signed/.test(String(editorView)));
check('and for a locked one', /disabled=""[^>]*title="This training has been entered into an external/.test(String(editorView)));
check('the external column exists', String(editorView).includes('>Ext.<'));

console.log('\n--- the collapsible add/edit card ---');
// Icons render as inline <svg>, which sits between an attribute and the text after it, so
// assertions about "this disabled button says X" are made against the markup with icons removed.
const withoutIcons = (html) => String(html).replace(/<svg[\s\S]*?<\/svg>/g, '');
const formView = (props) => {
  try {
    return renderToString(React.createElement(TrainingForm, { onSubmit: () => {}, ...props }));
  } catch (error) {
    return { error };
  }
};

// Collapsed by default: the card is there, its fields are not.
const collapsedForm = formView({});
check('the card renders', typeof collapsedForm === 'string', collapsedForm.error && collapsedForm.error.message);
check('showing its title', String(collapsedForm).includes('Add New Training'));
check('but collapsed by default', /aria-expanded="false"/.test(String(collapsedForm)));
check('so no fields are rendered', !String(collapsedForm).includes('Start time') && !String(collapsedForm).includes('Narrative'));
check('and it still says what it is for', String(collapsedForm).includes('Record a training activity'));

// Editing a row opens it, so clicking Edit cannot appear to do nothing.
const editingForm = formView({ editing: { id: 't9', date: '2026-03-14', title: 'Opened' } });
check('editing opens the card', /aria-expanded="true"/.test(String(editingForm)));
check('with the row loaded in', String(editingForm).includes('Edit Training #t9') && String(editingForm).includes('value="Opened"'));
check('and the fields present', String(editingForm).includes('Narrative') && String(editingForm).includes('Duration (hours)'));
check('plus a cancel action', String(editingForm).includes('Cancel edit'));

// Which flags the form offers depends on the caller.
check('a member-facing form shows the member flags', String(editingForm).includes('Fire prevention') && String(editingForm).includes('Multi-company'));
check('and NOT the external marker', !String(editingForm).includes('Entered into an external system'));
const adminForm = formView({ editing: { id: 't9', date: '2026-03-14', title: 'Opened' }, allowAdminFlags: true });
check('an administrative form DOES offer the external marker', String(adminForm).includes('Entered into an external system'));
check('and warns that it is permanent', /is permanent/.test(String(adminForm)));

// A locked training is read-only even for an administrator, and says why.
const lockedForm = formView({ editing: { id: 't9', date: '2026-03-14', title: 'Filed', is_entered_into_external: 'TRUE' }, allowAdminFlags: true });
check('a locked training shows as locked', String(lockedForm).includes('Locked'));
check('with an explanation', /entered into an external system, so it is locked/.test(String(lockedForm)));
check('and a disabled fieldset', String(lockedForm).includes('<fieldset disabled=""'));
check('and a disabled save button', /disabled=""[^>]*>\s*Save Training/.test(withoutIcons(lockedForm)));

// A training with no date or title cannot be saved either - the backend would drop it.
const blankForm = formView({ editing: { id: 't9' } });
check('an incomplete training says what is missing', /A date and a title are required/.test(String(blankForm)));

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
check('listing every training', String(adminTrainingView).includes('SCBA Refresher') && String(adminTrainingView).includes('Filed Externally'));
check('with a signature count per training', String(adminTrainingView).includes('>2<') && String(adminTrainingView).includes('>1<'));
check('and a total', /3 trainings · 3 signatures/.test(visibleText(adminTrainingView)));
check('it offers to add a training', String(adminTrainingView).includes('Add New Training'));
check('and to delete one', String(adminTrainingView).includes('Delete'));
check('signatures start collapsed', String(adminTrainingView).includes('Nobody has signed this training yet') === false);
check('the external marker is only in the administrative form', String(adminTrainingView).includes('Entered into an external system'));
// A locked training cannot be edited or deleted even here.
check('a locked training cannot be edited', /disabled=""[^>]*title="Locked[^"]*"[^>]*>Edit/.test(String(adminTrainingView)));
check('nor deleted', /disabled=""[^>]*title="Locked[^"]*"[^>]*>\s*Delete/.test(withoutIcons(adminTrainingView)));
check('and it is the only locked row', (String(adminTrainingView).match(/Locked — entered into an external system/g) || []).length === 2);

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
const rosterMonday = (() => {
  const day = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  while (day.getDay() !== 1) day.setDate(day.getDate() + 1);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
})();

const rosterView = (props) => {
  try {
    return renderToString(
      React.createElement(AdminAvailabilityRoster, {
        scheduleTemplates: [
          { id: 'tp1', day_of_week: 'Monday', start_time: '08:00', end_time: '18:00', assignment_id: 'a1' },
        ],
        availability: [
          { id: 'av1', schedule_template_id: 'tp1', date_from: rosterMonday, user_id: 'u1' },
          { id: 'av2', schedule_template_id: 'tp1', date_from: rosterMonday, user_id: 'u2' },
          { id: 'av3', schedule_template_id: 'tp1', date_from: rosterMonday, user_id: 'u3' },
        ],
        users: [
          { id: 'u1', name: 'Member 1', rank_id: 'r1' },
          { id: 'u2', name: 'Member 2', rank_id: 'r2' },
          { id: 'u3', name: 'No Rank Member', rank_id: '' },
        ],
        assignments: [{ id: 'a1', description: 'Engine 1' }],
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

// The chip markup for one member, from its opening tag through to the member's name. Used for
// "this chip has the emerald styling / has no color of its own" - a window before the name would
// also catch the PREVIOUS member's chip and its color.
const chipFor = (html, name) => {
  const idx = String(html).indexOf(name);
  if (idx === -1) return '';
  return String(html).slice(String(html).lastIndexOf('<span', idx), idx);
};

const roster = rosterView({});
check('the roster renders', typeof roster === 'string', roster.error && roster.error.message);
check('listing the members', String(roster).includes('Member 1') && String(roster).includes('Member 2'));

// The colors come from the ranks, applied to the name and to the icon.
check('a rank color is applied', String(roster).includes('color:#227dc3'), true);
check('and a second rank keeps its own', String(roster).includes('color:#c3223b'), true);
check('the icon is drawn for a ranked member', String(roster).includes('lucide-truck') && String(roster).includes('lucide-shield-check'), true);
check('the rank name is available as a tooltip', /title="Member 1 — Driver\/Operator"/.test(String(roster)), true);
// Two inline colors for one member: the icon and the name.
check('the name carries the rank color', String(roster).includes('<span style="color:#227dc3">Member 1</span>'), true);
check('the icon is colored with it too', /<svg[^>]*style="color:#227dc3"/.test(String(roster)), true);
check('and exactly those two, not more', (String(roster).match(/color:#227dc3/g) || []).length, 2);
check('a second member gets their own color', String(roster).includes('<span style="color:#c3223b">Member 2</span>'), true);

// An unranked member must not break or silently borrow someone else's rank.
check('an unranked member still appears', String(roster).includes('No Rank Member'));
check('and keeps the plain chip', /bg-emerald-50/.test(chipFor(roster, 'No Rank Member')), true);
check('with an unstyled name', String(roster).includes('<span>No Rank Member</span>'), true);
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
check('the tab forwards ranks to the roster', /<AdminAvailabilityRoster[\s\S]{0,300}?ranks=\{ranks\}/.test(tabSource), true);

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
const drawerZ = /fixed md:static md:h-screen inset-y-0 left-0 z-(\d+)/.exec(sidebarSource);
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
// whose content is capped and centred. The cap lives on <main> itself so the heading is centred with the
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

check('the centred-content set is exported', Array.isArray(CENTERED_CONTENT_TABS), true);
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
check('centring it in the panel the sidebar leaves', /\bmx-auto\b/.test(mainTag), true);
check('and keeping it full width below the cap', /\bw-full\b/.test(mainTag), true);
check('using the shared width so both screens match', /CONTENT_MAX_WIDTH/.test(mainTag), true);

// --- the part-of-a-screen mechanism -------------------------------------------------------------
//
// Three administration screens cannot use the whole-module rule: they are sub-tabs, and Member
// Availability needs the cap on one of its two views only. They opt in by wrapping that part of the
// screen in CenteredContent, so this checks each of them does - and that the availability grid does NOT.
const centered = readFileSync('src/components/CenteredContent.jsx', 'utf8');
check('CenteredContent is the only place a content max-width lives', /CONTENT_MAX_WIDTH/.test(centered), true);
check('it uses the one shared width', /CONTENT_MAX_WIDTH/.test(centered) && !/max-w-3xl/.test(centered), true);
check('and centres what it caps', /\bmx-auto\b/.test(centered), true);
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

// Member Availability: the All Members list is capped, the seven-column member grid is not.
const availabilitySource = readFileSync('src/components/admin/AdminAvailabilityTab.jsx', 'utf8');
check('Member Availability imports the wrapper', /import CenteredContent from '\.\.\/CenteredContent'/.test(availabilitySource), true);
const showingAllBranch = availabilitySource.slice(availabilitySource.indexOf('{showingAll ? ('), availabilitySource.indexOf(') : selectedMember ?'));
check('the All Members list is wrapped', /<CenteredContent>[\s\S]*?<AdminAvailabilityRoster/.test(showingAllBranch), true);
const memberBranch = availabilitySource.slice(availabilitySource.indexOf(') : selectedMember ?'));
check('the single-member grid is NOT wrapped', /<AvailabilityCalendar/.test(memberBranch) && !/<CenteredContent/.test(memberBranch.slice(0, memberBranch.indexOf('<AvailabilityCalendar'))), true);
check('and the whole tab is not wrapped', !/^export default function[\s\S]{0,200}<CenteredContent/.test(availabilitySource), true);

// The runtime behaviour, not just the presence of a class: the same expression the component evaluates, run
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
  'src/components/UserSettings.jsx',
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
// because doPost serialises requests behind a script lock - awaiting the whole wave left the
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
// while being labelled "is not awaited", and passed only because an unrelated handler further down
// the file contained it.
check('and it does not await the refresh', !/await onDataChanged\(/.test(saveHandlerSource));
// Not awaiting the refresh left the list holding pre-save values, so re-opening the form showed the
// old ones. The saved row is applied locally first, and the refresh is reported rather than silent.
check('the saved row is applied locally first', /onRowSaved\?\.\('users', \{ \.\.\.formData/.test(saveHandlerSource), true);
check('before the form is reset', usersSource.indexOf("onRowSaved?.('users', { ...formData") < usersSource.indexOf('resetForm();\n\n      // The refresh is NOT awaited'), true);
check('the background refresh is started', /Promise\.resolve\(onDataChanged\?\.\(\)\)/.test(usersSource), true);
check('and tracked so it can be shown', /setRefreshing\(true\)/.test(usersSource) && /finally\(\(\) => setRefreshing\(false\)\)/.test(usersSource), true);
check('with a visible indicator', /Reloading the full list in the background/.test(usersSource), true);

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

// --- the System Log tab ------------------------------------------------------------------------
//
// Two things to pin: the tab is wired to its own permission and reaches the panel, and it is NOT part
// of the shared refresh wave - the log is the largest table in the app, so loading it on sign-in for
// everyone would undo the point of the feature.
const systemLogSource = readFileSync('src/components/admin/AdminSystemLogTab.jsx', 'utf8');
check('the System Log tab exists', systemLogSource.length > 2000, true);
check('it fetches its own page', /adminFetchSystemLog\(query, token\)/.test(systemLogSource), true);
check(
  'and builds the query from the shared helper',
  /logQueryParams\(\{ page, sort, filters \}\)/.test(systemLogSource),
  true
);
check(
  'it shows a spinner while loading',
  /animate-spin/.test(systemLogSource) && /Loading the system log/.test(systemLogSource),
  true
);
check('with a pager', /Previous/.test(systemLogSource) && /Next/.test(systemLogSource), true);
check('and a page indicator', /Page \{meta\.page\} of \{pages\}/.test(systemLogSource), true);

const panelLogSource = readFileSync('src/components/admin/AdminPanel.jsx', 'utf8');
check('the panel has the tab', /<AdminSystemLogTab/.test(panelLogSource), true);
check('under the System heading', /id: 'system-log', label: 'System Log'/.test(panelLogSource), true);
// Lazy loading depends on this: the component is mounted only while its tab is open.
check('rendered only while its tab is active', /activeSubTab === 'system-log' &&/.test(panelLogSource), true);

// The guard that keeps it lazy: nothing in the refresh wave may ask for the log.
const appLogSource = readFileSync('src/App.jsx', 'utf8');
const refreshSource = (() => {
  const source = readFileSync('src/App.jsx', 'utf8');
  const start = source.indexOf('const refreshAdminData = async');
  if (start === -1) return '';
  const end = source.indexOf('const handleLogin', start);
  return source.slice(start, end === -1 ? source.length : end);
})();
check('the refresh wave was found', refreshSource.length > 300, true);
check('and it does NOT fetch the log', !/SystemLog|system_log|systemLog/.test(refreshSource));
check('nor does any other App-level fetch', !/adminFetchSystemLog/.test(readFileSync('src/App.jsx', 'utf8')));

// The permission drives the tab, and the action is gated on both the session and that permission.
const logPermission = ADMIN_PERMISSIONS.find((permission) => permission.key === 'can_view_system_log');
check('the permission is declared', Boolean(logPermission), true);
check('pointing at the tab', logPermission && logPermission.tab, 'system-log');
const logCode = readFileSync('src/services/Code.gs', 'utf8');
check(
  'the action is session-gated',
  /case "ADMIN_GET_SYSTEM_LOG"[\s\S]{0,400}?getAuthContext\(ss, data\)/.test(logCode),
  true
);
check(
  'and permission-gated',
  /can_view_system_log/.test(logCode.slice(logCode.indexOf('case "ADMIN_GET_SYSTEM_LOG"'))),
  true
);

// A real render, because source assertions cannot catch a typo in the JSX. Effects do not run under
// renderToString, so what this proves is the FIRST paint: the controls exist, and the loading state
// is what a visitor sees before the request resolves.
const logTabView = (() => {
  try {
    return renderToString(
      React.createElement(AdminSystemLogTab, {
        token: 't',
        users: [{ id: 'u1', name: 'Member 1' }],
        timeFormat: '12',
      })
    );
  } catch (error) {
    return { error };
  }
})();
check('the log tab renders', typeof logTabView === 'string', logTabView.error && logTabView.error.message);
check('showing the loader first', String(logTabView).includes('Loading the system log'), true);
check(
  'with the filter controls',
  String(logTabView).includes('All actions') && String(logTabView).includes('All members'),
  true
);
check(
  'every sort option',
  ['Timestamp (newest first)', 'Timestamp (oldest first)', 'Action (A–Z)', 'Member (A–Z)'].every(
    (label) => String(logTabView).includes(label)
  ),
  true
);
check(
  'the five columns',
  ['ID', 'Timestamp', 'Member', 'Action', 'Details'].every((heading) =>
    String(logTabView).includes(`>${heading}<`)
  ),
  true
);
// visibleText strips the SSR comment markers React inserts between text and an interpolation, so
// "Page 1 of 1" matches rather than "Page <!-- -->1<!-- --> of ...".
check('and a pager that is idle with no data', visibleText(logTabView).includes('Page 1 of 1'), true);


// --- Session idle timeout ---------------------------------------------------------------------
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
const pushCodeSource = readFileSync('src/services/Code.gs', 'utf8');
check(
  'the token is written through the session-guarded settings action',
  /case "UPDATE_USER_SETTINGS"/.test(pushCodeSource) && /fcm_token/.test(pushCodeSource)
);

check('it re-checks when the tab becomes visible', /addEventListener\('visibilitychange', evaluate\)/.test(timeoutAppSource), true);
check('it signs the user out when the state expires', /idleState\(lastActivityRef.current, now, sessionConfig\)/.test(timeoutAppSource) && /endSession\(idleLogoutMessage/.test(timeoutAppSource), true);
check('the warning banner renders', /Still there\? You will be signed out in/.test(timeoutAppSource), true);
check('with a stay-signed-in action', /Stay signed in/.test(timeoutAppSource) && /handleStaySignedIn/.test(timeoutAppSource), true);
check('which pings the server rather than only a local timer', /void pingSession\(authToken\)/.test(timeoutAppSource), true);
check('and an explicit sign-out action', /Sign out now/.test(timeoutAppSource), true);
check('listeners are removed on cleanup', /removeEventListener\(event, markActive\)/.test(timeoutAppSource) && /clearInterval\(timer\)/.test(timeoutAppSource), true);

const apiSource = readFileSync('src/services/api.js', 'utf8');
check('the PING action exists client-side', /action: 'PING'/.test(apiSource), true);
const codeForPing = readFileSync('src/services/Code.gs', 'utf8');
check('and server-side', /case "PING"/.test(codeForPing), true);
check('guarded by a session like every other action', /case "PING"[\s\S]{0,400}?getAuthContext\(ss, data\)/.test(codeForPing), true);

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
check('and nothing is labelled filtered when no filter is set', !/\(filtered\)/.test(historyText));
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

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
