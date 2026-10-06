import { lazy } from 'react';

// THE SCREENS BEHIND A TAB, FETCHED WHEN THE TAB IS OPENED.
//
// The bundle used to be one 1.08 MB file, and everything in it was downloaded by everybody before the clock
// appeared: the Administration tree alone is 631 kB of source, which a member who never opens Administration
// still paid for. Each module below is rendered behind `activeTab === '...'`, so nothing mounts until that tab is
// opened - and React fetches the chunk at the moment it is mounted.
//
// Deferring is invisible in use with one exception: the first moment after a tab is opened. `prefetchableFor`
// answers which chunks a signed-in member can actually reach, and App warms those once the first screen is up.
// That is an ASSET fetch on idle, never an API request, so it costs the Apps Script side nothing; and because the
// list is derived from the same permission flags the sidebar and the router use, a member never downloads a
// screen whose tab they cannot open.
//
// The loaders live in one object so the prefetch walks exactly the list the lazy() calls are built from: a module
// added here cannot be deferred in one place and missing from the other. scripts/verify-app-shell.mjs asserts
// that too, because a module that quietly stopped being deferred would show up only as a bigger bundle.
const loaders = {
  AdminPanel: () => import('../components/admin/AdminPanel'),
  ScheduleCalendar: () => import('../components/ScheduleCalendar'),
  RosterModule: () => import('../components/RosterModule'),
  MyAvailability: () => import('../components/MyAvailability'),
  DocumentsModule: () => import('../components/DocumentsModule'),
  TrainingModule: () => import('../components/TrainingModule'),
  CertificationsModule: () => import('../components/CertificationsModule'),
  ReportsModule: () => import('../components/ReportsModule'),
  UserSettings: () => import('../components/MySettings'),
  HelpGuides: () => import('../components/HelpGuides'),
  MyClockHistory: () => import('../components/MyClockHistory'),
  FirefighterRunner: () => import('../components/FirefighterRunner/FirefighterRunner'),
};

// Named exports, so every `import X from './components/X'` in App.jsx became `import { X } from
// './utils/deferredModules'` and not one of the render sites below had to change.
//
// The export is still called `UserSettings`: it is a code identifier, and renaming it is a diff across the app for
// no reader. Only the words members SEE were renamed to "My Settings" (the heading, the nav label and the help
// guide).
export const AdminPanel = lazy(loaders.AdminPanel);
export const ScheduleCalendar = lazy(loaders.ScheduleCalendar);
export const RosterModule = lazy(loaders.RosterModule);
export const MyAvailability = lazy(loaders.MyAvailability);
export const DocumentsModule = lazy(loaders.DocumentsModule);
export const TrainingModule = lazy(loaders.TrainingModule);
export const CertificationsModule = lazy(loaders.CertificationsModule);
export const ReportsModule = lazy(loaders.ReportsModule);
export const UserSettings = lazy(loaders.UserSettings);
export const HelpGuides = lazy(loaders.HelpGuides);
export const MyClockHistory = lazy(loaders.MyClockHistory);
export const FirefighterRunner = lazy(loaders.FirefighterRunner);

// Every name a prefetch may be handed, so a typo in App cannot silently warm nothing.
export const DEFERRED_MODULE_KEYS = Object.keys(loaders);

// Which chunks this member may need. The conditions are copied from the render gates in App.jsx one for one, so
// this is auditable against them: an ungated tab (certifications, settings, help) is always worth warming; a
// gated one is warmed only for the flag that opens it.
//
// The Firefighter Runner is deliberately absent - it is a hidden screen, and warming it would download a game
// nobody asked for.
export const prefetchableFor = ({
  canUseTimeclock = false,
  canViewSchedule = false,
  canEditOwnAvailability = false,
  canViewDocuments = false,
  canSignTrainings = false,
  canViewReports = false,
  canAdminister = false,
  canViewRoster = false,
} = {}) => {
  const keys = ['CertificationsModule', 'UserSettings', 'HelpGuides'];
  if (canUseTimeclock) keys.push('MyClockHistory');
  if (canViewSchedule) keys.push('ScheduleCalendar');
    if (canViewRoster) keys.push('RosterModule');
  if (canEditOwnAvailability) keys.push('MyAvailability');
  if (canViewDocuments) keys.push('DocumentsModule');
  if (canSignTrainings) keys.push('TrainingModule');
  if (canViewReports) keys.push('ReportsModule');
  if (canAdminister) keys.push('AdminPanel');
  return keys;
};

export const prefetchDeferredModules = (keys) => {
  keys.forEach((key) => {
    const load = loaders[key];
    // A chunk that will not load is not worth a console warning here: opening that tab reports it properly, with
    // the screen the member asked for in view.
    if (load) load().catch(() => {});
  });
};
