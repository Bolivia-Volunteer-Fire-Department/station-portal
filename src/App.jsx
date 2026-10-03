import React, { Suspense, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Clock, Loader2, Menu, X } from 'lucide-react';
// Toasts come from our own wrapper, not from sonner: it plays the sound mapped to each toast kind and then
// delegates, so every toast in the app is audible without its call site knowing about sounds. The Toaster host
// itself is still sonner's.
import { Toaster } from 'sonner';
import { toast, notificationToast } from './utils/toast';
import {
  installUiSoundListeners,
  setSoundsEnabled,
  soundsActiveFrom,
  SOUNDS_SETTING_KEY,
  SOUNDS_DEFAULT,
  // The Debug page's per-session sound levels. Reset here because a level belongs to the session that set it.
  resetSoundVolumes,
} from './utils/uiSounds';
import { runRefreshWave, REFRESH_OK, REFRESH_FAILED, REFRESH_EXPIRED } from './utils/refreshWave';
import {
  fetchInitialData,
  fetchBootstrap,
  adminFetchBootstrap,
  fetchAdminSections,
  fetchAvailabilityWindows,
  fetchEvents,
  fetchRoster,
  fetchScheduleSetup,
  fetchScheduleWindow,
  fetchTimeclockLogs,
  fetchTraining,
  fetchOnDutyUsers,
  fetchMyShiftOffers,
  fetchAvailability,
  adminFetchAvailability,
  submitClockAction,
  saveUserSettings,
  updateUserPassword,
  loginUser,
  registerPushDevice,
  unregisterPushDevice,
  fetchMyPushDevices
} from './services/api';
import { signInAlongside, signOutAlongside } from './services/firebaseAuth.js';
import { firebaseConfigured } from './services/firebase';
// The four small collections where a listener is cheaper than re-reading. See the module: the rule for which
// collections qualify is written there rather than implied by the list.
import { subscribeLive } from './services/liveReads';

import LoginScreen from './components/LoginScreen';
import ReauthModal from './components/ReauthModal';
import PasswordChangeModal from './components/PasswordChangeModal';
import { mustChangePassword, MUST_CHANGE_PASSWORD_COLUMN } from './utils/passwordPolicy';
import ClockBlockedModal from './components/ClockBlockedModal';
import Sidebar from './components/Sidebar';
import ClockCard from './components/ClockCard';
import OnDutyCard from './components/OnDutyCard';
import SplashScreen from './components/SplashScreen';
import LoadingOverlay from './components/LoadingOverlay';
import {
  MASTER_PERMISSION_KEY,
  allowedAdminTabs,
  permissionGranted,
  roleHasAdministration,
} from './utils/permissions';
// The app's heavy screens arrive when their tab is opened, not before - see utils/deferredModules.js, which also
// explains the idle prefetch below. The names are unchanged, so no render site in this file had to be edited: a
// module that is not in this list (the clock, the sidebar, the modals) is still part of the first download.
import {
  AdminPanel,
  CertificationsModule,
  DocumentsModule,
  FirefighterRunner,
  HelpGuides,
  MyAvailability,
  MyClockHistory,
  ScheduleCalendar,
  TrainingModule,
  UserSettings,
  prefetchDeferredModules,
  prefetchableFor,
} from './utils/deferredModules';
import { pageBarLabel } from './utils/pageLabels';
import CertificationNotice from './components/CertificationNotice';
import { setCertificationBadges } from './utils/certifications';
import DigitalClock from './components/DigitalClock';
import { getCurrentCoordinates } from './utils/geolocation';
import { clockLocationConfig, clockLocationNotice, evaluateClockLocation, OUT_OF_RANGE_CODE } from './utils/clockLocation';
import { mergeSavedUser } from './utils/userRow';
import { mergeSavedRow, mergeRowsById, replaceRowsInRange } from './utils/savedRow';
// Date keys, for the windows this screen asks for (the clock history, and the schedule before it). The history's
// window is measured on the STATION's clock, because that is the clock its entries are stamped on.
import { dateKeyMonthsBack, stationTodayKey, toDateKey } from './utils/scheduleDate';
// The trustworthy-clock rule, for the clock card: it must not offer a button it cannot honour, and it must say why.
import { OFFLINE_CLOCK_MESSAGE, isOffline } from './utils/connectivity';
import { createWaveReporter, nextWaveId } from './utils/activity';
import {
  IDLE_RESET_EVENTS,
  formatIdleCountdown,
  idleLogoutMessage,
  idleSecondsRemaining,
  idleState,
  sessionTimeoutConfig,
  unauthorizedIsStale,
} from './utils/sessionTimeout';
import { stationLogoUrl } from './utils/assets';
import { CENTERED_CONTENT_TABS, CONTENT_MAX_WIDTH } from './utils/contentWidth';
import AnnouncementList from './components/AnnouncementList';
import { normalizeEventList } from './utils/events';

// Content pages fill the viewport. There is deliberately no max-width on the container itself: a station's
// schedule and clock tables are dense, and capping them wasted the horizontal space a wide screen has.
//
// The exceptions are listed in utils/contentWidth, which owns the whole policy: which top-level modules get
// a capped, centerd column, and how wide it is. Screens that need the cap only in part - an administration
// sub-tab, or one view inside a tab - wrap that part in components/CenteredContent instead.
//
// `min-w-0` on the <main> below is the load-bearing part on small screens. Main is a flex child, and a
// flex item's default `min-width: auto` refuses to shrink below its content - so one wide table would
// push the page wider than the viewport and give the app a horizontal scrollbar on a phone or tablet.
// Letting it shrink keeps the overflow inside each table's own `overflow-x-auto` wrapper, where it
// belongs. Padding steps up with the screen size so a phone spends its width on content, not margins.

// Stands in while a deferred screen's chunk is in flight. Centred in the space the screen will fill, and the same
// spinner every other wait in the app shows, so opening a tab does not flash an empty frame. `role="status"` so a
// screen reader is told something is happening rather than being read a blank page.
function DeferredScreenFallback() {
  return (
    <div className="flex items-center justify-center py-16" role="status" aria-live="polite">
      <Loader2 className="w-6 h-6 text-red-500 animate-spin" />
    </div>
  );
}

export default function App() {
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [onDutyUsers, setOnDutyUsers] = useState([]);
  const [userSettings, setUserSettings] = useState([]);
  const [roles, setRoles] = useState([]);
  const [ranks, setRanks] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [schedule, setSchedule] = useState([]);
  // WHAT THE `schedule` ARRAY HOLDS: the window the last payload carried - last month, this month and next. A screen that
  // navigates outside it asks for the month it needs, which is why this travels with the rows rather than being worked
  // out again: without it a screen cannot tell "this month is empty" from "I have not asked for this month".
  const [scheduleWindow, setScheduleWindow] = useState({ from: '', to: '' });
  // Why a read of that window failed, if it did. Shown by the screens that draw a schedule, because an empty month and
  // a month that never arrived look identical otherwise.
  const [scheduleWindowError, setScheduleWindowError] = useState('');
  const [availability, setAvailability] = useState([]);
  // The availability windows (station reference data, in the sign-in payload) and the scope the claims were read over -
  // the grid needs to know what it holds before it can trust "nothing is marked" for a month.
  const [availabilityWindows, setAvailabilityWindows] = useState([]);
  const [availabilityScope, setAvailabilityScope] = useState({ from: '', to: '' });
  // EVERY member's claims, for the officer screens: loaded lazily for a range, and the read that replaced an officer's
  // own rows being handed to a roster of the crew.
  const [rosterAvailability, setRosterAvailability] = useState([]);
  const [rosterScope, setRosterScope] = useState({ from: '', to: '' });
  // Training: the activities, and the signatures this member may see (their own, unless the
  // role can administer trainings - the server decides which).
  const [trainings, setTrainings] = useState([]);
  const [trainingSignatures, setTrainingSignatures] = useState([]);
  // Certifications: the member's own warnings for the dashboard notice, the catalog (which names and icons the
  // records), and - for a role that may manage them - every record for the administration table. The badge
  // registry that sits beside members' names is not state; see utils/certifications.
  const [certificationAlerts, setCertificationAlerts] = useState([]);
  const [certificationSetup, setCertificationSetup] = useState([]);
  const [certificationRecords, setCertificationRecords] = useState([]);
  // Announcements: the public ones from the initial payload (login screen), and this member's own
  // targeted ones fetched after sign-in. Kept apart so signing out cannot clear the public list.
  const [announcements, setAnnouncements] = useState([]);
  // Non-shift calendar entries. Fetched once per sign-in and after an administrator changes something,
  // rather than on every page view: they change rarely and every calendar reads the same list.
  const [events, setEvents] = useState([]);
  const [scheduleTemplates, setScheduleTemplates] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [systemSettings, setSystemSettings] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  // Minimal, member-visible roster (id/name/rank_id). Admins also load the full
  // directory via refreshAdminUsers; members only get this projection, and it's
  // what lets the schedule calendar name other people's shifts.
  const [roster, setRoster] = useState([]);
  // THE DIRECTORY the admin tabs name members from: the full public users rows, read as a section when a tab that
  // draws names opens (see sectionsForTab). Deliberately NOT the roster projection and NOT the users section: the
  // projection lacks the scheduling fields the board filters on, and the users section joins users_private, which
  // the rules refuse to officers without can_edit_users.
  const [directory, setDirectory] = useState([]);
  // WHETHER IT HAS BEEN ASKED FOR YET. The roster is a DIRECTORY - one document per member - and it is not in the sign-in
  // payload any more: the dashboard names nobody except whoever is on duty (which the payload carries by id), and most
  // sign-ins are clock-ins. The effect below fetches it the first time a screen that LISTS people is opened, and once for the
  // rest of the session after that.
  const [rosterLoaded, setRosterLoaded] = useState(false);
  // Shift offers: the signed-in member's own requests, plus (admins only) the
  // full table the Schedule Management calendar flags pending approvals from.
  const [offers, setOffers] = useState([]);
  const [adminOffers, setAdminOffers] = useState([]);
  const [authToken, setAuthToken] = useState(null);
  // When true, an expired/invalid session opens the reauthentication modal on
  // top of the current UI instead of forcing the full-page login screen.
  const [needsReauth, setNeedsReauth] = useState(false);
  // Optional callback (receives the fresh token) replayed once reauthentication
  // succeeds - e.g. the clock in/out that was interrupted mid-flight.
  const pendingActionRef = useRef(null);
  // The current session token, readable synchronously. State alone is not enough: a request started in the same
  // tick as a sign-in has to compare its UNAUTHORIZED replies against the token that is current NOW, not the one
  // the last render happened to hold. See sessionExpired and applyToken below.
  const tokenRef = useRef(null);
  // When the current token was minted, so a refusal can say how long the session had lasted. See sessionExpired.
  const sessionStartedAtRef = useRef(0);
  // Why the prompt opened: which request was refused and which token it carried, for the modal to show.
  const [reauthReason, setReauthReason] = useState(null);
  const [isClockedIn, setIsClockedIn] = useState(false);

  // A clock action refused for location, awaiting the member's acknowledgment. Held here rather
  // than in the clock card so both refusal paths can raise it: the client-side geofence check and
  // the backend's own OUT_OF_RANGE refusal.
  const [clockNotice, setClockNotice] = useState(null);
  // Whether this device has a network, for the clock card - which must not offer a button it cannot honour.
  //
  // AN EVENT LISTENER, NOT A POLL, and not a value read once at render: the browser already knows, and a member who walks
  // back into signal should see the buttons return without reloading the page. `isOffline` treats an absent
  // `navigator.onLine` as online, so a harness or an old browser gets the working card rather than a disabled one.
  const [offline, setOffline] = useState(() => isOffline());
  useEffect(() => {
    const update = () => setOffline(isOffline());
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');

  // Initial Boot Loading
  const [initialLoading, setInitialLoading] = useState(true);
  // The splash's own timeline has finished (the fade has run and onFinish fired). While it is
  // false the splash overlays the app - including the boot it covers.
  const [splashDone, setSplashDone] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState([]);

  // Global Shade & Spinner State
  const [globalLoading, setGlobalLoading] = useState({ active: false, message: '' });

  const [statusMessage, setStatusMessage] = useState({ type: '', text: '' });

  // Idle session timeout. `sessionConfig` is derived from the system settings the app already
  // holds, and the seconds-remaining value drives the warning banner. `lastActivityRef` is a ref
  // rather than state because activity fires on every mouse move - re-rendering the whole app for
  // each one would be absurd, and only the banner needs to know the countdown.
  const sessionConfig = useMemo(() => sessionTimeoutConfig(systemSettings), [systemSettings]);
  const lastActivityRef = useRef(Date.now());
  const [idleWarningSeconds, setIdleWarningSeconds] = useState(null);
  // Mirrors the state above so the once-a-second tick can skip a setState entirely when the value
  // has not changed. Without it every tick would call setState with null and rely on React bailing
  // out of the re-render - cheap, but pointless work every second for the whole session.
  const idleWarningRef = useRef(null);
  const applyIdleWarning = useCallback((value) => {
    if (idleWarningRef.current === value) return;
    idleWarningRef.current = value;
    setIdleWarningSeconds(value);
  }, []);

  const [easterEggCount, setEasterEggCount] = React.useState(0);
  const handleEasterEgg = () => {
      if (easterEggCount < 5) setEasterEggCount(prev => prev + 1);
      else if (activeTab !== 'runner') {
          setActiveTab('runner');
      } else {
          setActiveTab('dashboard');
          setEasterEggCount(0);
      }
  };

  // Resolve effective time format: user_setting > system_setting > default ('12')
  const currentUserSettings = userSettings.find(
    (s) => String(s.id ?? s.user_id) === String(currentUser?.id)
  );

  const activeTimeFormat =
    currentUserSettings?.time_format ||
    // systemSettings?.time_format ||
    '12';

  // Admin access is granted when the user's role has is_admin set
  const currentUserRole = roles.find((r) => String(r.id) === String(currentUser?.role_id));
  // Who the member-scoped announcements are filtered for: the shared rule ANDs the three columns, so a
  // blank column in an announcement does not restrict.
  const announcementAudience = {
    roleId: String(currentUser?.role_id ?? ''),
    rankId: String(currentUser?.rank_id ?? ''),
    userId: String(currentUser?.id ?? ''),
  };
  const isAdmin = permissionGranted(currentUserRole, MASTER_PERMISSION_KEY);
  // The Administration module opens for ANY single admin permission, so a role can
  // be given one tab (say Pending Approvals) without becoming an administrator.
  const canAdminister = roleHasAdministration(currentUserRole);
  // One reader for every role flag, so each check below names the permission it
  // depends on rather than re-deriving the truthiness.
  const can = (key) => permissionGranted(currentUserRole, key);
  // Roles that approve shift requests are the only ones a "new shift request"
  // notification is relevant to.
  const canApproveShifts = can('can_approve_shifts');
  // Module visibility, resolved once and reused by the sidebar, the router below
  // and the guard effect.
  const canViewSchedule = can('can_view_my_schedule');
  const canMakeOffers = can('can_make_offers');
  const canViewFullSchedule = can('can_view_full_schedule');
  const canEditOwnAvailability = can('can_edit_own_availability');
  const canUseTimeclock = can('can_use_timeclock');
  // Training. can_sign_trainings is what makes the module reachable at all; the server also
  // filters the signature payload by can_administer_trainings, so a member never receives the
  // rest of the crew's signatures even though this flag only shapes the UI. The admin Training
  // tab needs no flag of its own here: it is gated by the tab it lives under, which
  // roleAllowsTab already ties to can_administer_trainings.
  const canSignTrainings = can('can_sign_trainings');
  const canEditTrainings = can('can_edit_trainings');

  // Verifying checklists. A member permission rather than an administrative one: an officer confirming a new
  // member's truck checklist is not an administrator. The server re-checks it, so this flag only shapes what is
  // offered. Verifying happens on the Documents tab (see AdminPanel) as well as in the member module.
  const canVerifyDocuments = can('can_verify_documents');

  // Reading documents at all. Without this the module has no sidebar entry and the app will not open it - and the
  // server refuses every documents action, which is where the rule actually lives. The other two documents
  // permissions both require this one (see utils/permissions).
  const canViewDocuments = can('can_view_documents');

  // Modules that render a seven-column calendar get the wider container.
  //
  // The Administration module has always been wider than the member modules, but My Availability
  // renders the SAME calendar component as the Administration availability tab. At the member
  // width the day columns are noticeably narrower there, so the pills truncate text they have room
  // for on the other side of the app. Widening this one module keeps the two identical.
  // The signed-in member's own Firefighter Runner sound profile. It is an administrator-managed
  // column on the users sheet, so it arrives with the signed-in member's own record rather than in
  // the (unauthenticated) settings payload. Empty means the game uses the default sounds.
  const runnerSoundProfile = currentUser?.runner_sound_profile || '';

  // Whether this screen's content is capped and centerd (see CENTERED_CONTENT_TABS).
  const centeredContent = CENTERED_CONTENT_TABS.includes(activeTab);

  // The mobile app bar gains the page name once the page's own heading has scrolled out of sight, so a
  // reader partway down a long table still knows where they are. Only that bar shows it - from md up it
  // is hidden and the heading is always on screen anyway.
  //
  // An IntersectionObserver rather than a scroll listener: no handler runs per frame, and the trigger is
  // "the heading has gone behind the bar", which is exactly what the negative root margin expresses. The
  // margin is measured from the bar rather than hardcoded, so the two cannot drift apart.
  const topBarRef = useRef(null);
  const pageHeadingRef = useRef(null);
  const [showPageLabel, setShowPageLabel] = useState(false);
  // The open Administration sub-tab, reported up by AdminPanel so the bar can say "Admin: Schedule Mgt".
  // The open Administration sub-tab, reported up by the panel (and used by the app bar's page name).
  const [adminSubTab, setAdminSubTab] = useState('');

  // The screens whose content is bounded to the viewport instead of scrolling the page with it: the Help screen's
  // guide pane, and the Documents module's list and reader, both scroll inside their own card (see HelpGuides and
  // DocumentsModule). The page heading above them has to be a ROW of that layout rather than something the card
  // sits underneath, or the card - which asks for the full height of <main>'s content box - pushes the total ~90px
  // past the viewport and the last of the pane hides behind the page scroll. So <main> becomes a flex column for
  // these screens, and only these screens.
  //
  // Both audiences' Help tabs qualify. The Administration one is why the open sub-tab is part of the test; it is
  // reported by an effect, so for one frame after opening that tab the old value is still in play and the page
  // behaves as it did before. That is a single frame of a layout that was correct yesterday, and it corrects
  // itself - which is a better trade than reaching into the panel for it.
  //
  // Declared HERE, below the state it reads, and not up with the other derived values: a `const` that mentions
  // `adminSubTab` before that `useState` runs is a temporal dead zone error, and it takes the whole app down
  // rather than the screen it belongs to. scripts/verify-app-shell.mjs checks the order.
  const boundedScreen = activeTab === 'help' || activeTab === 'documents' || (activeTab === 'admin' && adminSubTab === 'help');

  // The chunks this member may need, joined into a string so the effect below depends on the SET rather than on an
  // array that is a fresh object on every render - which would re-arm the idle callback continuously and warm
  // nothing. The flags passed are the same ones the render sites below gate on; see utils/deferredModules.js.
  const prefetchKeys = useMemo(
    () =>
      prefetchableFor({
        canUseTimeclock,
        canViewSchedule,
        canEditOwnAvailability,
        canViewDocuments,
        canSignTrainings,
        canAdminister,
      }).join(','),
    [
      canUseTimeclock,
      canViewSchedule,
      canEditOwnAvailability,
      canViewDocuments,
      canSignTrainings,
      canAdminister,
    ]
  );

  useEffect(() => {
    // Nothing to warm until a member is signed in: that is when a role exists, and so a set of reachable tabs.
    if (!currentUser || !prefetchKeys) return undefined;
    // Idle time, and asset fetches only - never an API request, so this costs the Apps Script side nothing. Without
    // requestIdleCallback the wait is a short timeout: late enough not to compete with the first screen, early
    // enough to be there before anyone has finished reading the clock.
    const idle = (callback) =>
      typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback(callback)
        : window.setTimeout(callback, 200);
    const cancel = (handle) =>
      typeof window.cancelIdleCallback === 'function'
        ? window.cancelIdleCallback(handle)
        : window.clearTimeout(handle);
    const handle = idle(() => prefetchDeferredModules(prefetchKeys.split(',')));
    return () => cancel(handle);
  }, [currentUser, prefetchKeys]);

  useEffect(() => {
    const heading = pageHeadingRef.current;
    if (!heading || typeof IntersectionObserver === 'undefined') return undefined;

    const barHeight = topBarRef.current ? topBarRef.current.offsetHeight : 0;
    const observer = new IntersectionObserver(
      ([entry]) => setShowPageLabel(!entry.isIntersecting),
      { rootMargin: `-${barHeight}px 0px 0px 0px`, threshold: 0 }
    );
    observer.observe(heading);
    return () => observer.disconnect();
    // Re-observing on a tab change reports the new heading's position immediately, without waiting for
    // the reader to scroll.
  }, [activeTab, currentUser]);

  const departmentName = systemSettings.find((s) => String(s.key) === 'department_name')?.value || '';

  // Name lookup for the schedule calendar's "Show everyone" view. Admins hold
  // the full directory (a superset of the minimal roster members receive).
  const nameDirectory = users.length > 0 ? users : roster;

  useEffect(() => {
    // Mount-only data load. loadAppData is recreated every render, so naming it here would
    // re-run the load on every render rather than once - the empty list is the intent.
    loadAppData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load and update loading messages from systemSettings
  useEffect(() => {
    const messages = [];
    for (let i = 0; i < 10; i++) {
      const key = `loading_message${i}`;
      const setting = systemSettings.find((s) => String(s.key) === key);
      messages.push(setting?.value || '');
    }
    setLoadingMessages(messages);
  }, [systemSettings]);

// Helper to get a loading message (random from available ones, or default)
const getLoadingMessage = () => {
  const messages = loadingMessages.filter((msg) => msg.trim() !== '');
  if (messages.length === 0) return 'Communicating with server...';
  return messages[Math.floor(Math.random() * messages.length)];
};

// Reflect the department name in the browser tab title
  useEffect(() => {
    document.title = departmentName ? `${departmentName} Station Portal` : 'Station Portal';
  }, [departmentName]);

  // Dark mode: user_setting > system_setting > default (dark). Resolved in
  // render scope so the toast host can match the app's theme as well.
  const isDarkMode = (() => {
    const systemDarkModeSetting = systemSettings.find((s) => String(s.key) === 'is_dark_mode')?.value;
    const darkModeSetting = currentUserSettings?.is_dark_mode !== undefined && currentUserSettings?.is_dark_mode !== ''
      ? currentUserSettings.is_dark_mode
      : systemDarkModeSetting;
    return darkModeSetting === undefined
      ? true
      : darkModeSetting === true || String(darkModeSetting).trim().toUpperCase() === 'TRUE';
  })();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
  }, [isDarkMode]);

  // The page transition runs on the children of <main> (see index.css), so it replays by itself when a tab
  // replaces them: no hook, no replay, nothing that can silently do nothing.

  // Sounds.
  //
  // The listeners are installed once, for the life of the app, and are deliberately NOT gated on being signed in:
  // the login screen is full of buttons, and a click that is silent before you sign in and audible after reads as
  // broken rather than as a setting.
  //
  // One delegated listener rather than a sound per control: see utils/uiSounds, which also carries the rules for
  // which press makes which noise, the modal tone table, and the reason the Firefighter Runner is excluded.
  useEffect(() => installUiSoundListeners(), []);

  // Which setting wins is the usual ladder - the member's own choice, else the station default, else on - and it
  // is resolved here so the rest of the app only ever asks "are sounds on". Before sign-in, and for a member who
  // has never touched the switch, that is the station default, which is why the login screen has sounds at all.
  const soundsActive = soundsActiveFrom(
    currentUserSettings?.[SOUNDS_SETTING_KEY],
    systemSettings.find((s) => String(s?.key ?? '').trim() === SOUNDS_SETTING_KEY)?.value ?? SOUNDS_DEFAULT
  );
  useEffect(() => {
    setSoundsEnabled(soundsActive);
  }, [soundsActive]);

  // Push notifications are also surfaced in-app. The service worker broadcasts
  // every message it displays, so a member looking at the app gets a toast in
  // addition to the OS notification - which matters on desktop systems that
  // silently suppress OS notifications (macOS, unless Chrome Helper alerts are
  // allowed).
  //
  // Gated on being signed in: the OS notification is per-device and still fires, but a toast on the
  // login screen would announce app activity to whoever is standing at the terminal - which is the
  // exact situation the idle timeout produces, since it leaves a signed-out page open and visible.
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !currentUser) return undefined;

    const handlePushMessage = (event) => {
      const message = event.data;
      if (!message || message.type !== 'PUSH_RECEIVED') return;
      // Hidden tabs would just swallow the toast; the OS notification has it covered.
      if (document.visibilityState !== 'visible') return;

      // A push that arrives while the member is looking at the app: the OS notification is drawn by the
      // service worker either way, and this is the in-app copy of it. It gets the NOTIFICATION sound rather
      // than a toast sound - the two mean different things, and a member who has just been told about a shift
      // offer should hear the same earcon on both channels.
      notificationToast(message.title || 'Station Portal', { description: message.body || '' });
    };

    navigator.serviceWorker.addEventListener('message', handlePushMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handlePushMessage);
  }, [currentUser]);

  // AM I CLOCKED IN, from the ON-DUTY list rather than from my clock history. Those are the same fact — the clock transaction
  // writes the entry and the on-duty row together, so a member's row exists exactly while one of their entries is open — and
  // the list is already here, read once and kept live. Asking the history instead meant reading every entry a member has ever
  // made, at every sign-in, to answer a yes/no question.
  useEffect(() => {
    if (!currentUser) return;
    setIsClockedIn(onDutyUsers.some((row) => String(row.id ?? row.user_id) === String(currentUser.id)));
  }, [currentUser, onDutyUsers]);

  const loadAppData = async () => {
    try {
      // Only public/config data is fetched pre-login. Member data (logs, on-duty
      // roster, admin directory) is fetched after authentication succeeds.
      await refreshAdminData();
    } catch {
      setStatusMessage({ type: 'error', text: 'Failed to connect to backend server.' });
    } finally {
      setInitialLoading(false);
    }
  };

  // Opens the reauthentication modal instead of logging the user out. An
  // optional retry callback is replayed with the fresh token once verification
  // succeeds, so interrupted actions can complete seamlessly.
  const queueReauth = (retryAction = null) => {
    pendingActionRef.current = retryAction || null;
    setNeedsReauth(true);
  };

  // Opens that prompt only when the reply was about the session we are HOLDING.
  //
  // A background refresh that was already in flight when somebody signed in again answers with UNAUTHORIZED for
  // the token it was sent with - which is no longer ours. Prompting then asks a member who has just signed in to
  // sign in again. See utils/sessionTimeout.unauthorizedIsStale, and note that both halves of that comparison
  // come from the ref rather than state, because the ref is what is true right now.
  const sessionExpired = (usedToken, retryAction = null, reply = null) => {
    if (unauthorizedIsStale(usedToken, tokenRef.current)) return false;

    // Keep the reason, so the prompt can explain itself.
    //
    // A bare "Your session has expired" cannot be told apart from a session that was refused for another reason,
    // and neither can it say whether the refused token was the one this page is holding. The action, the token's
    // tail and how long the session had existed are what make it answerable - utils/sessionTimeout has the rule,
    // services/api logs the same facts, and the modal shows this.
    const token = String(tokenRef.current || '');
    const ageSeconds = sessionStartedAtRef.current
      ? Math.round((Date.now() - sessionStartedAtRef.current) / 1000)
      : null;
    setReauthReason({
      action: (reply && reply.requestAction) || '',
      tokenTail: token.slice(-6),
      ageSeconds,
    });

    queueReauth(retryAction);
    return true;
  };

  // The single way the session token changes.
  //
  // The REF is written first and synchronously, so a request started in the same tick as a sign-in already
  // compares against the new token. `setAuthToken` alone would leave a window in which a fresh session looked
  // superseded, which is exactly the case this whole guard exists for.
  const applyToken = (token) => {
    tokenRef.current = token;
    sessionStartedAtRef.current = token ? Date.now() : 0;
    setAuthToken(token);
  };

  // Refreshes every cache an admin screen reads, in one parallel wave.
  //
  // This used to branch on the token argument and reload only ONE half of the data:
  // without a token it reloaded the initial payload (roles/ranks/shifts/settings) and with
  // one it reloaded only the admin-scoped sets (users/templates/assignments/offers). Tabs
  // that called it token-less therefore saved an assignment - or a user, or a template -
  // and kept rendering their own stale copy: the sheet was right and the screen was wrong.
  //
  // Both halves are now refreshed together, plus the schedule rows (approving an offer
  // fills one) and the roster (member names on the calendar), so an admin save can never
  // leave another screen showing the old value. Requests run in parallel, and one failing
  // does not sink the rest.
  const refreshAdminData = async (token = authToken) => {
    // ONE request, not nine.
    //
    // This wave used to be nine Apps Script executions (the public payload, users, templates/assignments/offers,
    // the schedule rows, the roster, on-duty, training, announcements, events) - and at sign-in it ran alongside
    // the member wave, six of whose calls were the same reads again. Every execution pays a second or three of
    // startup, so the wave's tail was what ran out of the client's 60-second patience, and a call that gives up is
    // a screen that keeps showing yesterday's data.
    //
    // ADMIN_GET_BOOTSTRAP answers all of it, built from the same helpers the individual actions use (see
    // admin payload). Without a token - the pre-login load, which is all the login screen
    // needs - the public payload is still its own request, unauthenticated by design.
    const tasks = token
      ? [
          {
            name: 'everything an admin screen reads',
            run: async () => {
              const data = await adminFetchBootstrap(token);
              if (data && data.code === 'UNAUTHORIZED') {
                sessionExpired(token);
                return REFRESH_EXPIRED;
              }
              if (!data || !data.success) return REFRESH_FAILED;
              applyAdminBootstrap(data);
              return REFRESH_OK;
            }
          }
        ]
      : [
          {
            name: 'the initial payload',
            run: async () => {
              // THE ONLY READ THE APP MAKES WITHOUT A SESSION, and it reads one document: the public settings the login and
              // loading screens draw. Three more reads used to be asked for here - roles, ranks and the shift definitions -
              // and the rules refuse them to a stranger, so they were round trips that could not succeed. The fourth was
              // the login-screen announcements, which are gone rather than fixed: see utils/announcements.
              const initial = await fetchInitialData();
              if (!initial) return REFRESH_FAILED;
              if (initial.userSettings) setUserSettings(initial.userSettings);
              if (initial.systemSettings) setSystemSettings(initial.systemSettings);
              return REFRESH_OK;
            }
          }
        ];

    // One toast per wave, with an id that is never reused, so a second wave (a save during sign-in, say)
    // STACKS rather than replacing the first. It reports and gets out of the way - nothing awaits it, and
    // nothing is blocked by it.
    const waveId = nextWaveId();
    const report = createWaveReporter({
      label: 'Refreshing views',
      total: tasks.length,
      onProgress: (message) => toast.loading(message, { id: waveId }),
      onDone: (message) => toast.success(message, { id: waveId, duration: 2500 }),
    });
    // Says so BEFORE the request goes out. This wave is a single task now, and a reporter that only speaks as
    // tasks settle would say nothing at all until it was finished - see the note on createWaveReporter.start.
    report.start();

    try {
      // The count follows the tasks as they settle, WHETHER THEY SUCCEEDED OR NOT - which is why the wave
      // reports each one. A request that failed used to leave the wave claiming to be unfinished forever.
      //
      // Only the first pass is counted: a retry that recovers is reported in the console instead, because a
      // toast cannot both say "done" and then change its mind.
      const outcome = await runRefreshWave(tasks, {
        onSettle: ({ status, pass }) => {
          if (pass === 1) report.settle(status === REFRESH_OK || status === REFRESH_EXPIRED);
        }
      });
      if (outcome.missing.length) {
        console.error(`[refresh] admin wave still missing after a retry: ${outcome.missing.join(', ')}`);
      } else if (outcome.recovered.length) {
        console.warn(`[refresh] admin wave loaded on a second attempt: ${outcome.recovered.join(', ')}`);
      }
    } catch (err) {
      console.error('Failed to refresh admin data', err);
    }
  };

  // WHERE A SECTION LANDS WHEN IT COMES BACK ON ITS OWN: the same setters the full payload uses, so a scoped refresh and
  // a sign-in cannot put one collection in two different places.
  const ADMIN_SECTION_SETTERS = {
    users: setUsers,
    directory: setDirectory,
    roles: setRoles,
    ranks: setRanks,
    shifts: setShifts,
    // THE SCHEDULE SECTION ANSWERS WITH ITS ROWS *AND* THE WINDOW THEY CAME IN - one shape for the server, which has
    // to say what it read rather than let a screen assume it holds everything. Every other section is a plain list, so
    // this one is a function that unwraps, and it records the window too. Registering a bare `setSchedule` here would
    // put the ENVELOPE into the array: `{schedule: [...], schedule_window: {...}}`, which is not a month of shifts and
    // would break every screen that filters it.
    schedule: (payload) => {
      const rows = Array.isArray(payload) ? payload : payload?.schedule;
      if (Array.isArray(rows)) setSchedule(rows);
      const window = payload?.schedule_window;
      if (window && (window.from || window.to)) setScheduleWindow(window);
    },
    scheduleTemplates: setScheduleTemplates,
    assignments: setAssignments,
    scheduleOffers: setAdminOffers,
    certificationRecords: setCertificationRecords,
    certificationSetup: setCertificationSetup,
    trainings: setTrainings,
  };

  // AFTER A SAVE, re-read only what that save could have changed.
  //
  // Every admin save used to reload the whole payload - eighteen collections, including every shift the station has ever
  // scheduled, and the roster twice - because the sheet-era wave had to reconcile everything at once. Firestore needs no
  // such thing: the write went where the writer said it did, the tab has already merged its own row (`onRowSaved`), and
  // the only open question is the OTHER screens that read the same collection.
  //
  // NO NAMES MEANS THE WHOLE PAYLOAD, which is what makes this safe to adopt one tab at a time: a save that has not been
  // scoped yet is slow rather than wrong. A scoped refresh that FAILS falls back to the payload for the same reason -
  // being wrong is worse than being expensive.
  //
  // AND ONE THING THE FALLBACK CANNOT DO, which is the trap that had to be fixed once already: the payload carries only
  // the collections bounded by the station's size. `schedule`, `users`, `assignments` and `schedule_templates` left it
  // when the app began loading lazily (see firestorePayload), so a save that writes one of those MUST name it. An
  // unnamed refresh of a schedule write is not merely stale - it returns successfully, having refreshed everything
  // except the thing that changed, so the board looks saved until the month changes and then loses the row.
  const refreshAdminCollections = async (names, token = authToken) => {
    const wanted = (Array.isArray(names) ? names : [names])
      .filter(Boolean)
      .filter((name) => ADMIN_SECTION_SETTERS[name]);
    if (!wanted.length) return refreshAdminData(token);

    try {
      const data = await fetchAdminSections(wanted);
      wanted.forEach((name) => ADMIN_SECTION_SETTERS[name](data[name]));
      // The `schedule` section carries its own window and its setter records it (see ADMIN_SECTION_SETTERS above), so
      // there is nothing to do here. This used to look for a top-level `schedule_window`, which the section reader has
      // never returned - the window rides INSIDE the section, beside the rows it describes.
      return REFRESH_OK;
    } catch (err) {
      console.error(`[refresh] could not re-read ${wanted.join(', ')}, so the whole payload is being read instead`, err);
      return refreshAdminData(token);
    }
  };

  // A WINDOW of the schedule the sign-in did not carry, for a screen that navigated to it: a month further back or
  // further forward than last/this/next, which is all the payload reads (see utils/scheduleWindow).
  //
  // THE FETCH IS AUTHORITATIVE FOR THE RANGE IT WAS ASKED ABOUT, so the rows inside that range are replaced by what
  // came back and the months outside it are left alone. Merging alone is not enough: a merge can only ADD, so a shift
  // DELETED from a month stayed in the array and the board drew it straight back on. The window only ever grows, which
  // is what stops a month being asked for twice - and that makes `refreshAdminCollections` the only thing that can
  // refresh one, which is why every save that writes a schedule row has to name that section.
  //
  // A FAILED READ IS REMEMBERED, NOT SWALLOWED, and this is not defensive padding. The call used to let its error
  // escape into a `void` at every call site, so a refused or offline read produced a full month of empty slots that
  // looked exactly like a month with nobody rostered - the board drew its template skeleton and said nothing. The
  // window is NOT recorded on failure either, so the next look asks again rather than believing it already has a
  // month it never received.
  const loadScheduleWindow = async (from, to) => {
    try {
      const data = await fetchScheduleWindow(from, to, authToken);
      const rows = data && Array.isArray(data.schedule) ? data.schedule : [];
      setSchedule((prev) => replaceRowsInRange(prev, rows, from, to));
      // The window grows to cover what was just read, so the same month is never asked for twice.
      if (data && data.schedule_window) {
        setScheduleWindow((prev) => ({
          from: prev.from && prev.from < data.schedule_window.from ? prev.from : data.schedule_window.from,
          to: prev.to && prev.to > data.schedule_window.to ? prev.to : data.schedule_window.to,
        }));
      }
      setScheduleWindowError('');
      return rows;
    } catch (err) {
      console.error(`[schedule] could not read ${from || 'the first month'} to ${to || 'the last'}`, err);
      setScheduleWindowError(
        (err && err.message) || 'Could not load the schedule for that month.'
      );
      // null, not []: an empty month is a real answer, and the board seeds from it - a failed read must not look like a
      // month with nobody rostered, so the caller can tell the two apart.
      return null;
    }
  };

  // LIVE READS (services/liveReads.js): the four small collections where a listener is cheaper than re-reading - a listener
  // bills per CHANGE, and while one is attached a repeated read of the same query is answered from the local cache.
  //
  // KEYED ON THE UID, NOT THE TOKEN, and that detail is what decides whether this costs anything: an ID token refreshes
  // hourly, and re-attaching on each one would pay a fresh initial snapshot for no new data at all. Firestore
  // re-authenticates its own streams when the token changes, so this effect has no business watching it.
  //
  // Each handler REPLACES its list rather than merging: a snapshot is the whole answer to its query, which is exactly what
  // these setters already store - the payload hands them the same shape.
  useEffect(() => {
    const userId = currentUser?.id ? String(currentUser.id) : '';
    if (!userId || !firebaseConfigured()) return undefined;
    const stop = subscribeLive({
      userId,
      handlers: {
        onDuty: setOnDutyUsers,
        announcements: setAnnouncements,
        systemSettings: setSystemSettings,
      },
      // A listener that fails must not throw into a render: it is logged, the last data stays on screen, and the next
      // sign-in or refresh reads the collection the way it always did. Nothing here is load-bearing.
      onError: (error) => console.warn('[live] a live read could not be kept open:', error && error.message),
    });
    return stop;
  }, [currentUser?.id]);

  // EVENTS, AND THEIR LISTENER, FOLLOW THE SCREEN RATHER THAN THE SESSION.
  //
  // They are drawn by the member's own calendar, the availability grid and the officer's board - and by nothing on the dashboard,
  // which is the screen most sign-ins are here for. So both halves arrive when one of those opens: the READ first (a listener
  // alone would show nothing until somebody else changed an event), then the listener to keep it fresh.
  //
  // `subscribeLive` takes a SUBSET of handlers by design - "a handler that is not given is not subscribed to at all" - so this is
  // the same call as the sign-in one with a single handler in it, and it returns its own teardown. The dependency is the BOOLEAN,
  // not the tab, so walking between those screens does not re-subscribe; leaving them all does tear the stream down.
  //
  // The board counts because it is the only OFFICER screen with a calendar on it: opening Administration for the Users tab should
  // no more attach this listener than it should read the schedule.
  const onScheduleBoard = activeTab === 'admin' && adminSubTab === 'schedule';
  const wantsEvents = activeTab === 'schedule' || activeTab === 'availability' || onScheduleBoard;
  useEffect(() => {
    if (!authToken || !currentUser?.id || !wantsEvents) return;
    let cancelled = false;
    fetchEvents(authToken)
      .then((data) => {
        if (cancelled || !data || !Array.isArray(data.events)) return;
        setEvents(normalizeEventList(data.events));
      })
      .catch((error) => console.error('[events] could not read the calendar entries', error));
    const stop = subscribeLive({
      userId: currentUser.id,
      handlers: { events: (rows) => setEvents(normalizeEventList(rows)) },
      onError: (error) => console.warn('[live] the events read could not be kept open:', error && error.message),
    });
    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, currentUser?.id, wantsEvents]);

  // THE SCHEDULE'S REFERENCE DATA - the templates, the assignments and the shift definitions - read once when a screen that draws
  // a schedule (or labels a clock entry) is opened.
  //
  // It is the last of the station-wide data to leave the sign-in payload. The member calendar needs the templates and assignments
  // to draw a month, the clock history needs the shift definitions to label each entry with the shift it belonged to, and the
  // officer's module needs all three. Nothing on the dashboard draws any of them - which is why this waited.
  const [scheduleSetupLoaded, setScheduleSetupLoaded] = useState(false);
  // The TWO screens of a member's own that draw a shift or label an entry with one. An OFFICER's copies come from the sections
  // below, tab by tab, because they belong to tabs that are opened one at a time - which is the point of that map.
  const wantsScheduleSetup = activeTab === 'schedule' || activeTab === 'clock-history';
  useEffect(() => {
    if (!authToken || scheduleSetupLoaded || !wantsScheduleSetup) return;
    let cancelled = false;
    fetchScheduleSetup(authToken)
      .then((data) => {
        if (cancelled || !data) return;
        if (Array.isArray(data.scheduleTemplates)) setScheduleTemplates(data.scheduleTemplates);
        if (Array.isArray(data.assignments)) setAssignments(data.assignments);
        if (Array.isArray(data.shifts)) setShifts(data.shifts);
        setScheduleSetupLoaded(true);
      })
      .catch((error) => console.error('[schedule] could not read the templates and the assignments', error));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, wantsScheduleSetup, scheduleSetupLoaded]);

  // THE ADMINISTRATION MODULE'S TWO LARGE READS ARRIVE WITH THEIR OWN TABS, not with the module.
  //
  // `users` is the directory joined to its private half - one document per member, twice over - and `certificationRecords` is
  // every member's records. Both grow with the station, and an officer who opens Administration for the schedule board sees
  // neither. The client already reads ONE section at a time for a save's own refresh (fetchAdminSections, over
  // readAdminSections), so this is that same read, asked for by the tab that draws it - and the permission that gates the tab is
  // what gates it, because a section is only reachable from a tab the role holds.
  const [adminSectionLoaded, setAdminSectionLoaded] = useState({});
  useEffect(() => {
    if (!authToken || activeTab !== 'admin') return;
    // WHICH SECTIONS A TAB DRAWS, which is the whole of this arrangement: the board draws a schedule, so it needs the templates
    // the pills are built from, the assignments that colour and order them, and the offers still waiting (its slot flags read
    // those); two tabs exist for one of those rows each, and each also wants the assignments a template is filtered by; the
    // approvals queue is the offers table; the clock table labels each entry with the shift it belonged to.
    //
    // A TAB WITH NO ENTRY READS NOTHING (the menu's own entry is the badge exception above), which is what makes this
    // worthwhile rather than a different arrangement of the same
    // reads: the module's shell - the documents tab - costs nothing beyond the member payload.
    //
    // `directory` IS ON EVERY TAB THAT NAMES A MEMBER, and that is the fix for a whole class of bug rather than one
    // report: the payload refactor left the tabs' `users` prop empty on a fresh session, and every screen that draws a
    // name drew "Unnamed member" instead. The section is the full public `users` collection - readable by every
    // officer, unlike the `users` section's `users_private` join - and AdminPanel merges the two before handing them
    // to a tab (see AdminPanel#nameRows).
    const sectionsForTab = {
      // THE MENU PAGE (an empty sub-tab - it is what Administration opens on now) reads the ONE small
      // thing its badge needs, the offers still waiting, and nothing else: deferring every other read
      // until a section is chosen is the point of the menu. The badge is only meaningful to a role that
      // can act on offers, so any other role's menu reads nothing at all - the rules would refuse the
      // read, and a refusal here would be noise on every visit.
      '': allowedAdminTabs(currentUserRole).includes('approvals') ? ['scheduleOffers'] : [],
      // THE BOARD READS THE SCHEDULE, and this line is the bug that lost the member names: the tab read its templates,
      // its assignments and its offers - which is enough to draw a month of EMPTY SLOTS - and never read the rows that
      // fill them. The board looked like a month nobody was rostered on. The `schedule` section answers with the rows
      // and the window they came in, which its setter above unwraps.
      schedule: ['schedule', 'scheduleTemplates', 'assignments', 'scheduleOffers', 'directory'],
      templates: ['scheduleTemplates', 'assignments'],
      assignments: ['assignments', 'scheduleTemplates', 'directory'],
      approvals: ['scheduleOffers', 'directory'],
      clock: ['shifts', 'directory'],
      users: ['users'],
      certifications: ['certificationRecords', 'directory'],
      // AVAILABILITY HAD NO ENTRY AT ALL, which is the same lost-names bug the board's line once had: the tab
      // draws the crew by name and drew nothing until it read the directory.
      availability: ['directory'],
      // The tabs whose only use for the directory is the name beside a record (an audit row's actor, an audience
      // picker, a signature, a pending offer). Their own rows arrive by the route they always did - a live listener
      // for announcements, the events read, each tab's own section - so this is the one addition each of them needs.
      'system-log': ['directory'],
      announcements: ['directory'],
      events: ['directory'],
      training: ['directory'],
    };
    const wanted = (sectionsForTab[adminSubTab] || []).filter((section) => !adminSectionLoaded[section]);
    if (!wanted.length) return;
    let cancelled = false;
    fetchAdminSections(wanted)
      .then((data) => {
        if (cancelled || !data) return;
        const loaded = {};
        wanted.forEach((section) => {
          if (data[section] === undefined) return;
          ADMIN_SECTION_SETTERS[section]?.(data[section]);
          loaded[section] = true;
        });
        if (Object.keys(loaded).length) setAdminSectionLoaded((previous) => ({ ...previous, ...loaded }));
      })
      .catch((error) => console.error(`[admin] could not read the ${wanted.join(', ')} section(s)`, error));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, activeTab, adminSubTab, adminSectionLoaded]);

  // THE ADMINISTRATION WAVE WAITS FOR THE MODULE TO BE OPENED.
  //
  // An administrator signing in to clock in used to pay for the whole wave: the roster, the user directory, every assignment,
  // every schedule template, the offers and the certifications - reads made for a screen they may never open. Most sign-ins
  // are clock-ins, and this is the same laziness the clock history and the schedule get: a module's data is read when the
  // module is.
  //
  // It fires on the FIRST SECTION CHOSEN, not on the menu: landing on the menu page must be free, which
  // is the whole point of it (see AdminMenuPage). Thereafter it behaves exactly as before, including
  // re-reading on a token change. The menu itself is unaffected: permissions come from `roles/{roleId}`,
  // which is in the shared wave beside the caller's own profile, so the sidebar knows what this officer
  // may do before anything is opened.
  const [adminModuleOpened, setAdminModuleOpened] = useState(false);
  // Whether that first read has come back - so the module draws a spinner rather than a panel full of "No users yet".
  const [adminWaveSettled, setAdminWaveSettled] = useState(false);
  useEffect(() => {
    // A REAL SECTION, not the menu: an empty sub-tab IS the menu page, and opening it must cost nothing.
    if (activeTab === 'admin' && canAdminister && adminSubTab) setAdminModuleOpened(true);
  }, [activeTab, canAdminister, adminSubTab]);

  // Refresh all admin-scoped data for an administrator - ONCE THE MODULE HAS BEEN OPENED, not at sign-in (see above).
  useEffect(() => {
    if (!isAdmin || !authToken || !adminModuleOpened) return;

    void refreshAdminData(authToken).finally(() => setAdminWaveSettled(true));
    // The effect is keyed on WHEN the module opened, not on the refresher's identity:
    // refreshAdminData is recreated every render, and naming it would refire the wave
    // on every render after the module opens. The saves call their own scoped refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, isAdmin, adminModuleOpened]);

  // Opens the reauthentication modal instead of logging the user out. An
  // Applying a sign-in payload.
  //
  // One applier per payload, because the batch and the individual refreshers must agree about what a field MEANS:
  // `roster` is the same roster whichever request carried it, and a field the server omitted (a permission the
  // role does not have) must leave that cache exactly as it was rather than clearing it.
  //
  // The two member projections are skipped for an administrator, exactly as refreshSchedule skips them: an admin
  // already holds the FULL assignment and template rows, and the narrower member copy must not replace them.
  const applyBootstrap = (data) => {
    // The certification icons beside every member's name, and the warnings for the signed-in member. Both are
    // registry/lookup shaped rather than component state, which is why they are not in the list below.
    if (data.certificationBadges) setCertificationBadges(data.certificationBadges);
    if (data.certificationAlerts) setCertificationAlerts(data.certificationAlerts);
    if (data.certificationSetup) setCertificationSetup(data.certificationSetup);
    // Only present for a role that may manage certifications - see adminBootstrapPayload.
    if (data.certificationRecords) setCertificationRecords(data.certificationRecords);
    if (data.schedule) setSchedule(data.schedule);
    // The window those rows came in, which every screen that draws a month depends on. Load-bearing, not bookkeeping.
    if (data.schedule_window) setScheduleWindow(data.schedule_window);
    if (data.availability) setAvailability(data.availability);
    // The windows, and the scope the claims came back over: the grid compares the month it is showing against this
    // before it draws or saves anything.
    if (data.availabilityWindows) setAvailabilityWindows(data.availabilityWindows);
    if (data.availability_window) setAvailabilityScope(data.availability_window);
    if (data.roster) setRoster(data.roster);
    if (data.offers) setOffers(data.offers);
    if (data.trainings) setTrainings(data.trainings);
    if (data.signatures) setTrainingSignatures(data.signatures);
    if (data.announcements) setAnnouncements(data.announcements);
    if (data.events) setEvents(normalizeEventList(data.events));
    // `logs` is deliberately NOT read here any more. It is the one per-member table that grows without limit, and it was read
    // at every sign-in only so the dashboard could answer "am I clocked in" - which the on-duty row answers for free. The
    // Clock History screen reads its own, over a range, when it is opened.
    if (data.onDuty) setOnDutyUsers(data.onDuty);
    if (!isAdmin && data.assignments) setAssignments(data.assignments);
    if (!isAdmin && data.scheduleTemplates) setScheduleTemplates(data.scheduleTemplates);
    // The public configuration, which rides along for the same reason the rest does: a member whose pre-login
    // fetch was cut short would otherwise keep a 12-hour clock and a default system setting all session.
    if (data.userSettings) setUserSettings(data.userSettings);
    if (data.roles) setRoles(data.roles);
    if (data.ranks) setRanks(data.ranks);
    if (data.shifts) setShifts(data.shifts);
    if (data.systemSettings) setSystemSettings(data.systemSettings);
  };

  const applyAdminBootstrap = (data) => {
    // The member half rides along in the same payload: one request, one apply, no chance of the two halves
    // disagreeing about the schedule they both draw.
    applyBootstrap(data);
    if (data.users) setUsers(data.users);
    if (data.scheduleTemplates) setScheduleTemplates(data.scheduleTemplates);
    if (data.assignments) setAssignments(data.assignments);
    if (data.scheduleOffers) setAdminOffers(data.scheduleOffers);
  };

  // The signed-in member's own shift offers (pending/approved/declined) - what
  // the My Schedule pills read to show "pending approval".
  const refreshOffers = async (token) => {
    try {
      const data = await fetchMyShiftOffers(token);
      if (data && data.code === 'UNAUTHORIZED') {
        sessionExpired(token);
        return REFRESH_EXPIRED;
      }
      if (data && data.success && data.offers) setOffers(data.offers);
      return REFRESH_OK;
    } catch (err) {
      console.error('Failed to update shift offers', err);
      return REFRESH_FAILED;
    }
  };

  // WHAT RANGE OF THE MEMBER'S CLOCK HISTORY IS LOADED, and null until the History screen asks for it. It is not read at
  // sign-in: it is the one per-member table that grows without limit (a five-year member has thousands of entries), and the
  // dashboard's only question about it — "am I clocked in" — is answered by the on-duty row.
  const [logsScope, setLogsScope] = useState(null);

  // Loading a range GROWS what is held rather than replacing it: the screen can ask for an older year without losing the one
  // it has, and a range that arrives late cannot drop rows an earlier one brought. Same arrangement as the schedule window.
  const loadLogs = async (from, to) => {
    const data = await fetchTimeclockLogs(authToken, { from, to });
    if (!data || data.code === 'UNAUTHORIZED') {
      sessionExpired(authToken);
      return [];
    }
    const rows = data && Array.isArray(data.logs) ? data.logs : [];
    if (rows.length) setLogs((prev) => mergeRowsById(prev, rows));
    setLogsScope((prev) => ({
      from: prev && prev.from && prev.from < from ? prev.from : from,
      to: prev && prev.to && prev.to > to ? prev.to : to,
    }));
    return rows;
  };

  // The window the screen opens with, and the one its "older entries" button asks for: twelve months at a time.
  //
  // MEASURED ON THE STATION'S CLOCK, not the device's. Entries are stamped with `stationTimestamp` (Eastern), so a
  // phone whose own date has already rolled over - or has not yet - would put the window's edge on the wrong day and
  // hide exactly the entry just written. The end of a window is the one bound that must not be approximate, which is
  // what makes this the same `stationTodayKey` the rest of the app asks "is this in force today?" with.
  const monthsBack = (months) => dateKeyMonthsBack(months);

  // ONCE PER SESSION PER WINDOW, which is what makes this different from re-fetching a module on every visit: the guard is
  // the scope itself, so moving between tabs costs nothing after the first look.
  //
  // The admin Clock Management tab is included because it is drawn from this same list. Worth saying plainly: that list is
  // the SIGNED-IN member's own entries, for an officer as much as for a member, because the payload it used to come from was
  // always per-member - so the tab shows an officer their own clock entries, not the station's. That is a gap of its own (an
  // admin-wide clock read does not exist yet), and it is deliberately left exactly as it was here: this pass must not turn
  // "the officer's own entries" into "nothing at all".
  useEffect(() => {
    const wantsTheHistory = activeTab === 'clock-history' || (activeTab === 'admin' && adminSubTab === 'clock');
    if (!wantsTheHistory || !authToken || logsScope) return;
    void loadLogs(monthsBack(12), stationTodayKey()).catch((error) => {
      console.error('[logs] could not load the clock history', error);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, adminSubTab, authToken, logsScope]);

  const refreshLogs = async (token = authToken) => {
    // Only when the history is loaded. A clock action needs the ON-DUTY list refreshed (refreshOnDuty does that); fetching a
    // member's entire clock history to show a card that does not use it is exactly the read this pass removed.
    if (!logsScope) return REFRESH_OK;
    try {
      const data = await fetchTimeclockLogs(token, { from: logsScope.from, to: logsScope.to });
      if (data && data.code === 'UNAUTHORIZED') {
        sessionExpired(token);
        return REFRESH_EXPIRED;
      }
      // REPLACED WITHIN ITS OWN RANGE, not merged. This read is authoritative for exactly the window `logsScope`
      // names, so a clock entry DELETED from that window has to leave the array - a merge could only ever add, which
      // left the deleted row on screen until the page was reloaded. The range applies to `time_in`, which is the only
      // date a clock entry has ("yyyy-MM-dd HH:mm:ss"); see utils/savedRow#replaceRowsInRange.
      if (data && data.logs) {
        setLogs((prev) => replaceRowsInRange(prev, data.logs, logsScope.from, logsScope.to, 'time_in'));
      }
      return REFRESH_OK;
    } catch (err) {
      console.error('Failed to update logs', err);
      return REFRESH_FAILED;
    }
  };

  const refreshOnDuty = async (token) => {
    try {
      const data = await fetchOnDutyUsers(token);
      if (data && data.code === 'UNAUTHORIZED') {
        sessionExpired(token);
        return REFRESH_EXPIRED;
      }
      if (data && data.onDuty) setOnDutyUsers(data.onDuty);
      return REFRESH_OK;
    } catch (err) {
      console.error('Failed to update on-duty roster', err);
      return REFRESH_FAILED;
    }
  };


  const refreshTraining = async (token) => {
    try {
      const data = await fetchTraining(token);
      if (data && data.code === 'UNAUTHORIZED') {
        sessionExpired(token);
        return;
      }
      if (data && data.trainings) setTrainings(data.trainings);
      if (data && data.signatures) setTrainingSignatures(data.signatures);
      return REFRESH_OK;
    } catch (err) {
      console.error('Failed to refresh training data:', err);
      return REFRESH_FAILED;
    }
  };

  // The member's own claims, over a range. It REPLACES what the range covers and keeps what is outside it: a plain
  // merge would keep a row the server no longer has (an un-marked day), and a plain replace would drop months nobody
  // asked for. Naming no range replaces everything, which is what the refresh wave does.
  const refreshAvailability = async (token = authToken, range = null) => {
    try {
      const scope = range || {};
      const data = await fetchAvailability(token, scope);
      if (data && data.code === 'UNAUTHORIZED') {
        sessionExpired(token);
        return;
      }
      if (data && data.availability) {
        const rows = Array.isArray(data.availability) ? data.availability : [];
        const from = String(scope.from || '');
        const to = String(scope.to || '');
        setAvailability((prev) =>
          from && to
            ? [
                ...(prev || []).filter((row) => {
                  const day = String(row?.date_from || '').slice(0, 10);
                  return day < from || day > to;
                }),
                ...rows,
              ]
            : rows
        );
      }
      if (data && data.availability_window) setAvailabilityScope(data.availability_window);
      return REFRESH_OK;
    } catch (err) {
      console.error('Failed to update availability', err);
      return REFRESH_FAILED;
    }
  };

  // THE OFFICER'S ROSTER DATA, loaded when one of the screens that reads it is open - the Member Availability tab and
  // THE AVAILABILITY OPTIONS LIST AND THE MEMBER'S OWN CLAIMS, read when that screen is opened - neither is in the sign-in
  // payload any more, because a member who signs in to clock in never opens it.
  //
  // The windows are reference data, read once for the session. The claims come in MONTHS, so a quarter around today is what the
  // grid starts with, and the Load <month> button inside it asks for anything outside that (App#loadAvailabilityMonth).
  const [windowsLoaded, setWindowsLoaded] = useState(false);
  useEffect(() => {
    if (!authToken) return;
    if (activeTab !== 'availability') return;
    if (!windowsLoaded) {
      fetchAvailabilityWindows(authToken)
        .then((data) => {
          if (!data || !Array.isArray(data.availabilityWindows)) return;
          setAvailabilityWindows(data.availabilityWindows);
          setWindowsLoaded(true);
        })
        .catch((error) => console.error('[availability] could not read the windows', error));
    }
    // The claims for this quarter are already in hand once a scope has been set; the button in the grid covers the rest.
    if (availabilityScope.from) return;
    const from = toDateKey(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1));
    const to = toDateKey(new Date(new Date().getFullYear(), new Date().getMonth() + 2, 0));
    void refreshAvailability(authToken, { from, to });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, activeTab, windowsLoaded, availabilityScope.from]);

  // THE MEMBER'S OWN OFFERS, read once when the calendar that draws their pills is opened - and refreshed from there by the
  // screen itself when an offer is raised or withdrawn (see onOfferSubmitted). They used to ride with every sign-in, on a
  // dashboard that draws none of them.
  const [offersLoaded, setOffersLoaded] = useState(false);
  useEffect(() => {
    if (!authToken || offersLoaded) return;
    if (activeTab !== 'schedule') return;
    let cancelled = false;
    void refreshOffers(authToken).finally(() => {
      if (!cancelled) setOffersLoaded(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, activeTab, offersLoaded]);

  // THE TRAINING CATALOGUE AND THIS MEMBER'S SIGNATURES, read once when that module is opened - by a member who signs, or by an
  // officer whose tab lists who has signed what - and refreshed from there when something is signed (onChanged={refreshTraining}).
  // Both used to ride with every sign-in.
  const [trainingLoaded, setTrainingLoaded] = useState(false);
  useEffect(() => {
    if (!authToken || trainingLoaded) return;
    // THE MEMBER'S Training screen, or the ADMINISTRATION one - and for the officer it waits for that TAB rather than the whole
    // module, because the catalogue is one tab's data and an officer opening the system log should not read it.
    const wantsTraining = activeTab === 'training' || (activeTab === 'admin' && adminSubTab === 'training');
    if (!wantsTraining) return;
    let cancelled = false;
    void refreshTraining(authToken).finally(() => {
      if (!cancelled) setTrainingLoaded(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, activeTab, adminSubTab, trainingLoaded]);

  // THE CREW DIRECTORY, read when a screen that LISTS people is opened - the calendar's pill names, and everything in the
  // Administration module that names somebody - and once per session after that.
  //
  // THIS IS THE POINT OF THE WHOLE PASS. It used to arrive with every sign-in as one document per member, for a dashboard that
  // names nobody except whoever is on duty: a station of thirty paid thirty reads so that somebody clocking in could see
  // themselves. Nothing on the dashboard reads this, so nothing triggers it - see readStationRows.
  useEffect(() => {
    if (!authToken || rosterLoaded) return;
    if (activeTab !== 'schedule' && activeTab !== 'admin') return;
    let cancelled = false;
    fetchRoster(authToken)
      .then((data) => {
        if (cancelled || !data || !Array.isArray(data.roster)) return;
        setRoster(data.roster);
        // The badge index comes with it: the screens that draw a name draw the icons beside it (components/CertificationBadges),
        // and until this load there is nothing to draw - which is why it reads from the same place.
        if (data.certificationBadges) setCertificationBadges(data.certificationBadges);
        setRosterLoaded(true);
      })
      .catch((error) => {
        console.error('[roster] could not read the crew directory', error);
      });
    return () => {
      cancelled = true;
    };
  }, [authToken, activeTab, rosterLoaded]);

  // the windows tab beside it - and scoped to the months around today, which is what those screens show. It is not in
  // the payload: a member's session would be paying for the whole crew's claims.
  //
  // Before this existed those screens were handed the OFFICER'S OWN claims, which is why the roster listed them against
  // the crew and the board warned about availability it could not actually see.
  useEffect(() => {
    // THE SCREENS THAT DRAW THE WHOLE CREW. The schedule board is deliberately NOT here: it needs ONE month - the one on
    // screen - to judge a shift against, and it asks for exactly that (`onRosterMonth`, from the board), rather than
    // pulling seven months of every member's claims to warn about one.
    const wantsRoster =
      activeTab === 'admin' && (adminSubTab === 'availability' || adminSubTab === 'availability-windows');
    if (!wantsRoster || !authToken) return;
    const from = toDateKey(new Date(new Date().getFullYear(), new Date().getMonth() - 3, 1));
    const to = toDateKey(new Date(new Date().getFullYear(), new Date().getMonth() + 4, 0));
    // SKIPPED ONLY WHEN THIS RANGE IS ALREADY HELD - which is not the same as "a read has happened". A bare
    // `rosterScope.from` check treated one month the board asked for as the whole range, and these screens then drew a
    // month they did not hold.
    if (rosterScope.from && rosterScope.from <= from && rosterScope.to >= to) return;
    void loadRosterAvailability(from, to).catch((error) => {
      console.error('[availability] could not load the crew availability', error);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, adminSubTab, authToken, rosterScope.from, rosterScope.to]);

  // Loading another month for a screen that navigated outside the scope it holds.
  const loadRosterMonth = async (year, month) => {
    const from = toDateKey(new Date(year, month, 1));
    const to = toDateKey(new Date(year, month + 1, 0));
    return loadRosterAvailability(from, to);
  };
  const loadAvailabilityMonth = async (year, month) => {
    const from = toDateKey(new Date(year, month, 1));
    const to = toDateKey(new Date(year, month + 1, 0));
    return refreshAvailability(authToken, { from, to });
  };

  // EVERY member's claims for a range, for the officer screens. Loaded when one of those screens is open, so a member's
  // session never pays for it.
  const loadRosterAvailability = async (from, to) => {
    try {
      const data = await adminFetchAvailability(authToken, { from, to });
      if (data && data.code === 'UNAUTHORIZED') {
        sessionExpired(authToken);
        return REFRESH_EXPIRED;
      }
      if (data && data.availability) setRosterAvailability(data.availability);
      setRosterScope({ from: String(from || ''), to: String(to || '') });
      if (data && data.availability_window) setRosterScope(data.availability_window);
      return REFRESH_OK;
    } catch (err) {
      console.error('Failed to load the crew availability', err);
      return REFRESH_FAILED;
    }
  };

  // Post-sign-in data load.
  //
  // ONE request. This used to be nine Apps Script executions (schedule, availability, roster, offers, training,
  // announcements, events, clock history, who is on duty), fired alongside the admin wave - whose six shared reads
  // were the same calls again. Every execution pays a second or three of startup before it reads a cell, so the
  // tail of that pile was what ran out of the 60-second patience this app enforces, and a call that gives up is
  // data the screen never gets: no shifts on the calendar, a 12-hour clock for a member who chose 24.
  //
  // The sign-in payload answers everything at once. The individual refreshers all remain:
  // a tab that reloads its own list still asks for its own list, and the panel's callbacks use them.
  //
  // The wave retries a failure once, one at a time, so a slow backend degrades into "a few seconds later" rather
  // than "missing until you reload". See utils/refreshWave.
  const loadPostLoginData = async (token) => {
    const outcome = await runRefreshWave([
      {
        name: 'everything this screen needs',
        run: async () => {
          const data = await fetchBootstrap(token);
          if (data && data.code === 'UNAUTHORIZED') {
            sessionExpired(token);
            return REFRESH_EXPIRED;
          }
          if (!data || !data.success) return REFRESH_FAILED;
          applyBootstrap(data);
          return REFRESH_OK;
        }
      }
    ]);

    // One line each, and only when something did not load on the first attempt: this is the difference between
    // "the app is slow" and "the app is quietly missing data", which was previously invisible without opening
    // DevTools on the right screen.
    if (outcome.missing.length) {
      console.error(`[refresh] still missing after a retry: ${outcome.missing.join(', ')}`);
    } else if (outcome.recovered.length) {
      console.warn(`[refresh] loaded on a second attempt: ${outcome.recovered.join(', ')}`);
    }
  };

  const handleLogin = async (username, password) => {
    setStatusMessage({ type: '', text: '' });
    setGlobalLoading({ active: true, message: getLoadingMessage() });

    try {
      const result = await loginUser(username, password);

      if (result.success) {
        // Signed in to the app: now sign in to Firebase with the same credentials, so the features already moved to
        // Firestore have a user to act as. It cannot fail the login - a member whose Auth password is still the
        // migration's temporary one signs in exactly as before and simply has those features on the sheet.
        await signInAlongside(username, password);
        setCurrentUser(result.user);
        applyToken(result.token);

        // Only the first screen's data blocks the overlay now - see the note on
        // loadPostLoginData. Admin data loads via the authToken effect.
        await loadPostLoginData(result.token);
      } else {
        setStatusMessage({
          type: 'error',
          text: result.message || 'Invalid username or password.'
        });
      }
    } catch {
      setStatusMessage({
        type: 'error',
        text: 'Unable to connect to authentication server.'
      });
    } finally {
      setGlobalLoading({ active: false, message: '' });
    }
  };

  // If the signed-in role cannot use the tab that is open - because an admin
  // edited the role mid-session, or the role was changed elsewhere - fall back to
  // the dashboard instead of rendering an empty frame.
  useEffect(() => {
    if (!currentUser) return;
    const allowed =
      activeTab === 'admin'
        ? canAdminister
        : activeTab === 'schedule'
          ? canViewSchedule
          : activeTab === 'availability'
            ? canEditOwnAvailability
            : activeTab === 'clock-history'
              ? canUseTimeclock
              : activeTab === 'training'
                ? canSignTrainings
                : activeTab === 'documents'
                  ? canViewDocuments
                  : true; // the dashboard, help, settings and the easter egg are always open
    if (!allowed) setActiveTab('dashboard');
  }, [
    activeTab,
    currentUser,
    canAdminister,
    canViewSchedule,
    canEditOwnAvailability,
    canUseTimeclock,
    canSignTrainings,
    canViewDocuments,
  ]);

  const handleLogout = () => {
    pendingActionRef.current = null;
    setNeedsReauth(false);
    setReauthReason(null);
    setCurrentUser(null);
    applyToken(null);

    // Every path that drops the app session drops the Firebase one with it: a token that outlived a sign-out would
    // leave the next person at this computer holding the last one's identity, which the rules would honour.
    void signOutAlongside();

    setIsSidebarOpen(false);
    setActiveTab('dashboard');
    setAdminSubTab('');
    // A refusal modal belongs to the session that hit it, so it must not survive a sign-out - the
    // next person to sign in should never be greeted by someone else's message.
    setClockNotice(null);
    setStatusMessage({ type: '', text: '' });
    // The Debug page's sound levels are a per-session experiment: the next person to sign in on this machine gets
    // the app's own mix back, not somebody's test levels.
    resetSoundVolumes();
  };

  // Every navigation through the sidebar. Administration is special: it ALWAYS lands on the menu page
  // (AdminMenuPage) - including pressing the item again while already inside the module, which is the
  // only way back to the menu once a section is open. An empty sub-tab is what the menu renders.
  const handleSidebarNavigate = (tab) => {
    if (tab === 'admin') setAdminSubTab('');
    setActiveTab(tab);
  };

  // Ends the session with an explanation, which is the only difference from a normal sign-out.
  // Stable (setters and refs only) so it can be called from the timer without re-arming it.
  const endSession = useCallback((message) => {
    pendingActionRef.current = null;
    setNeedsReauth(false);
    setReauthReason(null);
    setCurrentUser(null);
    applyToken(null);

    // Every path that drops the app session drops the Firebase one with it: a token that outlived a sign-out would
    // leave the next person at this computer holding the last one's identity, which the rules would honour.
    void signOutAlongside();

    setIsSidebarOpen(false);
    setActiveTab('dashboard');
    applyIdleWarning(null);
    // Same reasoning as handleLogout: a refusal modal must not survive the session that raised it - and nor should
    // a sound level the session's Debug page set.
    setClockNotice(null);
    setStatusMessage(message ? { type: 'error', text: message } : { type: '', text: '' });
    resetSoundVolumes();
  }, [applyIdleWarning]);

  // The idle timer.
  //
  // Re-armed by `activeTab`, which is what implements "or navigate somewhere": switching module
  // counts as activity even if the click itself produced no event we listened for. Interaction
  // events reset the ref without re-rendering, and the one-second tick is the only thing that
  // touches state - so the cost is a single comparison per second while signed in.
  //
  // Returning to the tab re-checks immediately rather than waiting for the next tick, so a session
  // abandoned in a background tab ends as soon as the member looks at it again.
  useEffect(() => {
    if (!currentUser || !sessionConfig.configured) {
      applyIdleWarning(null);
      return undefined;
    }

    lastActivityRef.current = Date.now();
    applyIdleWarning(null);

    const markActive = () => {
      lastActivityRef.current = Date.now();
      applyIdleWarning(null);
    };

    const evaluate = () => {
      const now = Date.now();
      const state = idleState(lastActivityRef.current, now, sessionConfig);
      if (state === 'expired') {
        endSession(idleLogoutMessage(sessionConfig.minutes));
        return;
      }
      // Only the warning window needs a countdown; the rest of the time this is a no-op.
      applyIdleWarning(state === 'warning' ? idleSecondsRemaining(lastActivityRef.current, now, sessionConfig) : null);
    };

    IDLE_RESET_EVENTS.forEach((event) => window.addEventListener(event, markActive, { passive: true }));
    document.addEventListener('visibilitychange', evaluate);

    const timer = setInterval(evaluate, 1000);

    return () => {
      IDLE_RESET_EVENTS.forEach((event) => window.removeEventListener(event, markActive));
      document.removeEventListener('visibilitychange', evaluate);
      clearInterval(timer);
    };
  }, [currentUser, activeTab, sessionConfig, endSession, applyIdleWarning]);

  // "Stay signed in". On Apps Script this also had to push the SERVER session window out, or the button would have
  // dismissed the warning while the session quietly lapsed anyway - that is what pingSession was for, and it went with
  // the sheet. There is nothing to push now: the SDK keeps the Firebase session refreshed on its own, so all this has
  // to do is reset the local timer, which is the only clock the idle warning reads.
  const handleStaySignedIn = () => {
    lastActivityRef.current = Date.now();
    applyIdleWarning(null);
  };

  // Verifies credentials from the reauthentication modal and keeps the user in
  // the app: session data is refreshed (and any interrupted action retried)
  // instead of dumping them back onto the full-page login screen.
  const handleReauth = async (username, password) => {
    try {
      const result = await loginUser(username, password);

      if (!result.success) {
        return { success: false, message: result.message || 'Invalid username or password.' };
      }

      // The modal must confirm the same account - block silent profile switching.
      if (currentUser && String(result.user.id) !== String(currentUser.id)) {
        return { success: false, message: 'Those credentials belong to a different account. Please use your own.' };
      }

      // The reauth exists because a session expired. Firebase's may have expired with it, or may never have been
      // established - either way the features on Firestore need it back before an interrupted action is replayed.
      await signInAlongside(username, password);
      setCurrentUser(result.user);
      applyToken(result.token);

      const retry = pendingActionRef.current;
      pendingActionRef.current = null;

      if (retry) {
        // Resume whatever triggered reauthentication (e.g. a pending clock in/out)
        await retry(result.token);
      } else {
        // Same split as a normal sign-in: only the first screen's data is awaited,
        // so the modal closes promptly instead of waiting on every tab's fetch.
        // If a background refresh does hit the session wall, queueReauth reopens
        // this modal.
        await loadPostLoginData(result.token);
        setStatusMessage({ type: 'success', text: 'Session verified. Welcome back!' });
      }

      // Admin-scoped data is left to the authToken effect (which fires as soon as
      // setAuthToken lands above). Re-fetching it here as well meant every admin
      // call ran twice, which is a large part of why re-verifying felt slow.

      // Keep the modal open if the awaited refresh or the replayed action hit the
      // session wall again (a background refresh that does would reopen it via
      // queueReauth).
      if (!pendingActionRef.current) {
        setNeedsReauth(false);
        // The reason described the prompt that has just closed; the next one brings its own.
        setReauthReason(null);

      }

      return { success: true };
    } catch {
      return { success: false, message: 'Unable to connect to authentication server.' };
    }
  };

  const performClockAction = async (actionType, coords, token) => {
    try {
      const result = await submitClockAction(actionType, currentUser.id, coords, token);

      if (result.success) {
        setStatusMessage({
          type: 'success',
          text: `Successfully ${actionType === 'CLOCK_IN' ? 'Clocked In' : 'Clocked Out'}${coords.latitude ? ' with GPS location' : ''
            }!`,
        });
        await refreshLogs(token);
        await refreshOnDuty(token);
      } else if (result.code === 'UNAUTHORIZED') {
        // Session expired mid-action: open the reauth modal and replay this exact
        // clock in/out (with the already-captured GPS coords) once verified.
        // Only when the refusal is about the token we are holding: a late reply from a superseded session
        // must not interrupt a clock-in whose request was already accepted, nor replay it on the new one.
        sessionExpired(token, (freshToken) => performClockAction(actionType, coords, freshToken));
      } else if (result.code === OUT_OF_RANGE_CODE) {
        // The backend refused on location. This happens when the station fence was enabled while
        // this page was already open, so the client check above never ran - hence the same modal.
        setClockNotice(
          clockLocationNotice({ allowed: false, code: OUT_OF_RANGE_CODE, message: result.message })
        );
      } else {
        setStatusMessage({ type: 'error', text: result.message || 'Action failed.' });
        toast.error(result.message || 'Action failed.');
      }
    } catch {
      setStatusMessage({ type: 'error', text: 'Network error submitting shift update.' });
    } finally {
      setGlobalLoading({ active: false, message: '' });
    }
  };

  const handleClockAction = async (actionType) => {
    setStatusMessage({ type: '', text: '' });
    // Clear any refusal left over from a previous attempt, so a second press does not show a stale
    // modal while this one is in flight.
    setClockNotice(null);

    // BEFORE THE GPS PROMPT, not after. A permission dialog is a poor first answer to a request that cannot work, and this
    // is the documented behaviour rather than a nicety: clocking in and out requires connectivity and says so when it is
    // missing (the README, "Offline"). The writers refuse too - that is what protects the record itself; this
    // is what stops the member from being asked for their location first and told second.
    if (isOffline()) {
      setStatusMessage({ type: 'error', text: OFFLINE_CLOCK_MESSAGE });
      toast.error(OFFLINE_CLOCK_MESSAGE);
      setGlobalLoading({ active: false, message: '' });
      return;
    }

    setGlobalLoading({ active: true, message: getLoadingMessage() });

    try {
      // Acquire GPS coordinates from browser
      const coords = await getCurrentCoordinates();

      // Optional station geofence. Checked BEFORE the request so an out-of-range clock action
      // never reaches the sheet, and so the member gets an answer immediately instead of after a
      // round trip. A station with the keys unset is not configured here and behaves as before.
      const locationCheck = evaluateClockLocation(coords, clockLocationConfig(systemSettings));
      if (!locationCheck.allowed) {
        // A modal, not the status banner: the banner is only rendered on the login screen, and a
        // refusal is the answer to the button the member just pressed. See ClockBlockedModal.
        setClockNotice(clockLocationNotice(locationCheck, clockLocationConfig(systemSettings)));
        setGlobalLoading({ active: false, message: '' });
        return;
      }

      await performClockAction(actionType, coords, authToken);
    } catch {
      setStatusMessage({ type: 'error', text: 'Network error submitting shift update.' });
      setGlobalLoading({ active: false, message: '' });
    }
  };

  // Push-device registration, handed to the settings card as ONE object rather than three callbacks,
  // so the card has a single prop to thread through two component layers.
  //
  // Registration is per device: these calls must never touch another device's row, which is why
  // unregister takes the token the browser released rather than the member's id.
  const pushDeviceApi = useMemo(
    () => ({
      register: (deviceToken, deviceLabel, options) => registerPushDevice(deviceToken, deviceLabel, authToken, options),
      unregister: (deviceToken) => unregisterPushDevice(deviceToken, authToken),
      // My devices AND whose this browser is, in one call. The card cannot answer the second half from
      // the member's own rows - that is exactly what the bug was - so the token this browser holds has
      // to travel with the question.
      status: (deviceToken) => fetchMyPushDevices(authToken, deviceToken),
    }),
    [authToken]
  );

  const handleSaveUserSettings = async (updatedSettings) => {
    try {
      // Call API service wrapper instead of raw fetch
      const result = await saveUserSettings(updatedSettings, authToken);

      if (result && result.success) {
        // Optimistically update React state so UI reflects changes immediately.
        // Only keys the caller actually sent are merged, so the token-only save
        // from the "enable this device" flow can't wipe other preferences.
        setUserSettings((prevSettings) => {
          const targetId = String(updatedSettings.id);
          const exists = prevSettings.some(
            (s) => String(s.id || s.user_id) === targetId
          );

          const changed = {};
          [
            'time_format',
            'is_dark_mode',
            // Missing from this list means the optimistic merge drops it, so the switch would appear not to stick
            // until the refresh wave reconciled the row seconds later.
            'is_sounds_active',
            'fcm_token',
            'notify_new_offer',
            'notify_offer_approved',
            'notify_offer_declined',
            'notify_announcements',
          ].forEach((key) => {
            if (updatedSettings[key] !== undefined) changed[key] = String(updatedSettings[key]);
          });

          if (exists) {
            return prevSettings.map((s) =>
              String(s.id || s.user_id) === targetId ? { ...s, ...changed } : s
            );
          }

          return [
            ...prevSettings,
            { id: targetId, user_id: targetId, ...changed },
          ];
        });

        return result;
      } else {
        throw new Error(result?.message || 'Failed to persist settings in Google Sheets.');
      }
    } catch (error) {
      console.error('Error saving user settings:', error);
      throw error;
    }
  };

  // Applies a just-saved user row to the in-memory list straight away.
  //
  // The authoritative refresh still runs, but it cannot be waited on: doPost serializes every
  // request behind a script lock, so the refresh wave takes tens of seconds, and holding the form
  // open for it is what made saving feel broken. Without this the list kept the pre-save values
  // until that wave drained, so re-opening the form right after saving showed the OLD values even
  // though the write had succeeded. Same idea as the password change below and the optimistic
  // merge in handleSaveUserSettings. The rules live in utils/userRow.js.
  // Applies a saved row to the collection it belongs to, immediately.
  //
  // The refresh wave behind a save takes tens of seconds (see utils/savedRow.js), so a save that waited for
  // it left buttons spinning over a sheet that had already been written. Instead the row the editor just
  // saved is merged in locally, and the wave reconciles it later.
  const SAVED_ROW_COLLECTIONS = {
    users: { set: setUsers, merge: mergeSavedUser },
    roles: { set: setRoles, merge: mergeSavedRow },
    ranks: { set: setRanks, merge: mergeSavedRow },
    shifts: { set: setShifts, merge: mergeSavedRow },
    assignments: { set: setAssignments, merge: mergeSavedRow },
    scheduleTemplates: { set: setScheduleTemplates, merge: mergeSavedRow },
  };

  const applySavedRow = (collection, fields) => {
    const target = SAVED_ROW_COLLECTIONS[collection];
    // An unknown collection is a programming error, not a silent no-op: nothing to merge means the screen
    // would stay stale for no visible reason.
    if (!target) {
      console.error(`No saved-row merge registered for "${collection}"`);
      return;
    }
    target.set((prev) => target.merge(prev, fields));
  };


  const handlePasswordChange = async (newPassword) => {
    setGlobalLoading({ active: true, message: getLoadingMessage() });
    try {
      const result = await updateUserPassword({ newPassword });
      if (result.success) {
        // The server clears the "must change it" flag as part of the save; clearing it here too is what closes
        // the forced-change modal, so the member is not held at it by our own stale copy of their row.
        setCurrentUser((prev) => ({ ...prev, [MUST_CHANGE_PASSWORD_COLUMN]: 'FALSE' }));
      }
      return result;
    } catch {
      return { success: false, message: 'Network error updating password.' };
    } finally {
      setGlobalLoading({ active: false, message: '' });
    }
  };

  // THE SPLASH plays first, so the rotating loading messages only show if loading outlasts it: one
  // of the station's own messages - configured in Administration → System → Settings, or the
  // defaults - spins under the boot screen's clock. Picked once per mount, so a re-render as data
  // arrives does not reshuffle it mid-boot.
  const bootMessage = useMemo(() => {
    const configured = loadingMessages.filter((msg) => msg.trim() !== '');
    const messages = configured.length > 0
      ? configured
      : [
          'Starting the engine...',
          'Deciding who cleans the bay today...',
          'Waking up the night shift...',
          'Asking CCOM for a radio check...',
          'Looking for a ladder truck...',
          'Looking for a radio strap...',
          'Warming up the coffee...',
          'Making sure the hydrant still flows water...',
        ];
    return messages[Math.floor(Math.random() * messages.length)];
    // The message is chosen once per boot on purpose: loadingMessages arriving later must not
    // reshuffle it, and the boot screen only shows while initialLoading, which starts true.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {/* THE SPLASH: the brand moment that plays first, while the app's data loads concurrently
          underneath (loadAppData runs on mount). It fades on its own beat - straight into a ready
          app on an ordinary launch; the boot screen below only shows if loading outlasts it. */}
      {!splashDone && <SplashScreen onFinish={() => setSplashDone(true)} />}

      {/* Global Shade & Animated Spinner Overlay */}
      <LoadingOverlay

        isLoading={globalLoading.active}
        message={globalLoading.message}
      />

      {/* Toast host. Until now `toast()` was imported by the pending-approvals
          tab but never rendered anywhere, so those approve/decline confirmations
          never appeared; this also renders in-app push notifications. */}
      <Toaster theme={isDarkMode ? 'dark' : 'light'} position="top-right" richColors closeButton />

      {/* Idle timeout warning. Shown only in the final minute, so it reads as a warning rather than
          as a permanent fixture. "Stay signed in" pushes the server window out as well as resetting
          the timer - see handleStaySignedIn. */}
      {currentUser && idleWarningSeconds !== null && (
        <div
          role="alert"
          className="fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center justify-center gap-3 border-t border-amber-300 bg-amber-50 px-4 py-3 pb-[calc(0.75rem_+_env(safe-area-inset-bottom))] text-sm text-amber-900 shadow-2xl dark:border-amber-800/80 dark:bg-amber-950/90 dark:text-amber-200"
        >
          <span className="font-medium">
            Still there? You will be signed out in {formatIdleCountdown(idleWarningSeconds)} of inactivity.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleStaySignedIn}
              className="rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-500"
            >
              Stay signed in
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-xl border border-amber-400 px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/60"
            >
              Sign out now
            </button>
          </div>
        </div>
      )}


      {/* Session re-verification: modal over the app, not the login screen.
          Mounted only while required, so the form starts fresh each time. */}
      {currentUser && needsReauth && (
        <ReauthModal
          username={currentUser.user_name || ''}
          reason={reauthReason}
          onReauth={handleReauth}
          onSignOut={handleLogout}
        />
      )}

      {/* The forced password change. Above the app, BELOW the re-authentication prompt above (z-55 vs z-60), so
          that if the session expires while it is open the member verifies first - otherwise the change would be
          attempted with a dead session and fail with something other than "your session expired".
          It has no dismiss affordance: see PasswordChangeModal. */}
      {currentUser && mustChangePassword(currentUser) && (
        <PasswordChangeModal
          username={currentUser.user_name || ''}
          onPasswordChange={handlePasswordChange}
          onSignOut={handleLogout}
        />
      )}

      {/* A clock action refused for location. Mounted only while a notice is pending, so it can
          never linger over the app, and dismissed only by the member's own click. */}
      {currentUser && clockNotice && (
        <ClockBlockedModal notice={clockNotice} onDismiss={() => setClockNotice(null)} />
      )}

      {/* The boot screen: the splash plays FIRST, and this only appears if loading has outlasted
          the animation on a slow connection - the app's data has been loading concurrently the whole
          time, so an ordinary launch never sees this at all. */}
      {initialLoading ? (
        <div className="min-h-dvh bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-white flex items-center justify-center">
          <Clock className="w-8 h-8 animate-spin text-red-500 mr-3" />
          <span className="text-xl font-medium">{bootMessage}</span>
        </div>
      ) : !currentUser ? (
        <LoginScreen onLogin={handleLogin} statusMessage={statusMessage} departmentName={departmentName} />
      ) : (
        <div className="min-h-dvh bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100 flex flex-col md:flex-row md:h-dvh md:overflow-hidden pb-[env(safe-area-inset-bottom)] md:pb-0">
          {/* The strip the iOS status bar sits on.
          //
          // index.html asks for `black-translucent`, which paints the app UNDER the status bar - so the
          // area behind the clock belongs to us, and iOS draws the clock and its icons WHITE whatever we
          // put there. That is free in the dark theme and invisible in the light one, and iOS will not
          // reconsider (it caches the meta when the app is added to the Home Screen - see the note in
          // utils/nativeShell.js). So instead of asking which theme we are in, something dark is painted
          // there in BOTH: the navy the manifest and theme-color already declare, which is the color every
          // other platform uses for its own chrome around this app.
          //
          // `fixed` rather than part of the app bar, because the bar is sticky: the moment the page
          // scrolls, the bar slides up under this area, and a strip that had scrolled away would leave
          // white clock text on a white bar in the light theme. `z-20` clears the bar (z-10) and stays
          // under the sidebar's backdrop (z-20) and drawer (z-30), so opening the menu still dims it.
          //
          // It is 0-height wherever there is no inset - every browser tab, every notchless phone, and a
          // full-screen Android window - so it costs nothing anywhere it is not needed. */}
          <div
            aria-hidden="true"
            className="md:hidden fixed inset-x-0 top-0 z-20 h-[env(safe-area-inset-top)] bg-[#0A2A5B]"
          />
          {/* `min-h-dvh` (not `min-h-screen`) is the viewport the member can actually SEE: on a phone in a
              browser tab `100vh` is measured with the URL bar hidden, so a short screen left a strip of
              canvas at the bottom and a scrolling one overshot it by the height of the bar. `dvh` follows
              the bar as it moves, which is also what makes the installed app fill the window exactly.

              `pb-[env(safe-area-inset-bottom)]` and the matching `pt-` on the header below give the layout
              the whole screen WITHOUT letting anything important sit under the home indicator - a pair
              that only means anything because index.html declares `viewport-fit=cover` (see the note
              there). Both resolve to 0 on a device with no inset, and both are dropped at md, where the
              sidebar takes the full height and there is no bottom edge left to clear. */}
          {/* Sticky on mobile so the app name and the menu button are always reachable; the page title
              below scrolls with the content, as it should. `z-10` keeps it BELOW the sidebar's z-20
              backdrop and z-30 drawer, so opening the menu dims the whole page including this bar. */}
          <header ref={topBarRef} className="md:hidden sticky top-0 z-10 flex items-center justify-between bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4 pt-[calc(1rem_+_env(safe-area-inset-top))]">
            <div className="flex min-w-0 items-center gap-2">
              <a href="#" onClick={(e) => {
                e.preventDefault();
                handleEasterEgg();
              }}>
                <img src={stationLogoUrl()} alt="Bolivia Fire Department Logo" className="w-8 h-8" />
                {/* <Shield className="w-7 h-7 text-red-500" /> */}
              </a>
              <span className="font-bold text-lg text-slate-900 dark:text-white shrink-0">Station Portal</span>
              {/* The current page, once its own heading has scrolled away. `truncate` matters here: a
                  long label must not push the menu button off the screen. */}
              {showPageLabel && pageBarLabel(activeTab, adminSubTab) && (
                <>
                  <span className="shrink-0 text-slate-300 dark:text-slate-600" aria-hidden="true">—</span>
                  <span className="truncate text-sm font-medium text-slate-500 dark:text-slate-400">
                    {pageBarLabel(activeTab, adminSubTab)}
                  </span>
                </>
              )}
            </div>
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
            >
              {isSidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </header>

          <Sidebar
            currentUser={currentUser}
            isClockedIn={isClockedIn}
            announcements={announcements}
            announcementAudience={announcementAudience}
            activeTab={activeTab}
            setActiveTab={handleSidebarNavigate}
            isSidebarOpen={isSidebarOpen}
            setIsSidebarOpen={setIsSidebarOpen}
            onLogout={handleLogout}
            // Module visibility, all driven by the role's permissions.
            canAdminister={canAdminister}
            canViewSchedule={canViewSchedule}
            canEditAvailability={canEditOwnAvailability}
            canUseTimeclock={canUseTimeclock}
            canSignTrainings={canSignTrainings}
            canViewDocuments={canViewDocuments}
            ranks={ranks}
          />

          <main
            // `overscroll-y-contain` stops the desktop layout's inner scroll area from chaining its overscroll to
            // the document: reaching the bottom of a long tab used to lift the whole page (see index.css).
            //
            // `md:flex md:flex-col` only on the Help screen, where the heading above the guide card has to be one of
            // the rows rather than something the card is stacked under - see boundedScreen above. Every other
            // tab is untouched: the page scrolls them.
            className={`flex-1 min-w-0 md:h-screen md:overflow-y-auto overscroll-y-contain p-4 sm:p-6 lg:p-8 page-enter ${
              boundedScreen ? 'md:flex md:flex-col' : ''
            } ${
              centeredContent ? `mx-auto w-full ${CONTENT_MAX_WIDTH}` : ''
            }`}
          >
            {/* The page title scrolls with the content: only the app bar above is pinned, so the heading
                moves out of the way as you read. Once it has, the app bar says which page this is.
                On the Help screen it does NOT scroll (there is nothing to scroll) and must keep its height, or a
                short window would squash the title instead of the guide: hence `md:shrink-0`. */}
            <div ref={pageHeadingRef} className="mb-8 md:shrink-0">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                {activeTab === 'dashboard' && `Welcome, ${currentUser.name}`}
                {activeTab === 'clock-history' && 'Clock History'}
                {activeTab === 'schedule' && 'Schedule'}
                {activeTab === 'availability' && 'Availability'}
                {activeTab === 'training' && 'Training'}
                {activeTab === 'certifications' && 'Certifications'}
                {activeTab === 'help' && 'Help'}
                {activeTab === 'settings' && 'My Settings'}
                {activeTab === 'admin' && 'Administration'}
              </h2>
              <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
                {activeTab === 'dashboard' && 'Manage your hours and time tracking.'}
                {activeTab === 'clock-history' && 'Review your previous clock-in entries, duration, and locations.'}
                {activeTab === 'schedule' && 'Review your assigned shifts, or switch on "Show everyone" to see the whole crew.'}
                {activeTab === 'availability' && 'Mark the shifts you could work, and administrators will see it when they build the schedule.'}
                {activeTab === 'training' && 'Sign off the trainings you attended. Administrators can see who has signed each one.'}
                {activeTab === 'certifications' && 'The certifications the station has recorded for you, with their dates and where each one stands.'}
                {activeTab === 'help' && 'Guides for using the portal. Administrators have their own set under Administration → System → Help.'}
                {activeTab === 'settings' && 'Customize your personal account preferences.'}
                {activeTab === 'admin' && 'Manage members, roles, ranks, and system settings.'}
              </p>
            </div>

            {/* One boundary for every deferred screen in the chain below (see utils/deferredModules.js). It adds
                no element of its own, so the layout above - and the flex rows on the Help screen - are untouched;
                while a chunk is in flight the fallback stands in. The page heading is deliberately OUTSIDE it, so
                the tab that is opening still names itself. */}
            <Suspense fallback={<DeferredScreenFallback />}>
            {activeTab === 'dashboard' && (
              <div className="space-y-6">
                {/* Anything about to run out, above everything else: it is the one thing on this screen that is
                    both personal and time-critical. Nothing renders when there is nothing to say. */}
                <CertificationNotice alerts={certificationAlerts} />
                {/* Announcements for the crew: above the clock, below the welcome message. */}
                <AnnouncementList
                  announcements={announcements}
                  location="is_visible_on_dashboard"
                  audience={announcementAudience}
                />

                {/* Live Station Digital Clock */}
                <DigitalClock timeFormat={activeTimeFormat} />

                {/* Primary Clock In / Clock Out Action Card. Without the timeclock
                    permission a member still sees the station clock and who is on
                    duty, just no buttons. */}
                {canUseTimeclock && (
                  <ClockCard
                    isClockedIn={isClockedIn}
                    loading={globalLoading.active}
                    offline={offline}
                    onClockAction={handleClockAction}
                  />
                )}

                {/* Who's currently working */}
                <OnDutyCard onDutyUsers={onDutyUsers} ranks={ranks} />
              </div>
            )}

            {activeTab === 'clock-history' && canUseTimeclock && (
              <MyClockHistory
                currentUser={currentUser}
                logs={logs}
                timeFormat={activeTimeFormat}
                shifts={shifts}
                // WHAT IS LOADED, so the screen can say so and offer to go further back. The page opens on the last twelve
                // months rather than on a member's whole history - see the note on `logsScope` above.
                loadedFrom={logsScope ? logsScope.from : ''}
                onLoadOlder={() => {
                  if (!logsScope || !logsScope.from) return undefined;
                  return loadLogs(monthsBack(24), logsScope.from);
                }}
              />
            )}

            {activeTab === 'schedule' && canViewSchedule && (
              <ScheduleCalendar
                currentUser={currentUser}
                schedule={schedule}
                scheduleWindow={scheduleWindow}
                scheduleWindowError={scheduleWindowError}
                onNeedSchedule={loadScheduleWindow}
                assignments={assignments}
                scheduleTemplates={scheduleTemplates}
                ranks={ranks}
                users={nameDirectory}
                offers={offers}
                token={authToken}
                // Role permissions the calendar itself has to honor: who may offer
                // to fill an open shift, and who may look at the whole crew.
                canMakeOffers={canMakeOffers}
                canViewFullSchedule={canViewFullSchedule}
                // Non-shift entries, already audience-filtered by the server.
                events={events}
                eventAudience={announcementAudience}
                // Names the audience line in an event's detail popup (a role description rather than "#id").
                roles={roles}
                timeFormat={activeTimeFormat}
                // Used only on the printed sheet's header.
                departmentName={departmentName}
                // Re-reads the member's offers after a submit so the pill flips
                // to "pending approval" immediately.
                onOfferSubmitted={() => refreshOffers(authToken)}
              />
            )}

            {activeTab === 'availability' && canEditOwnAvailability && (
              <MyAvailability
                token={authToken}
                currentUser={currentUser}
                availability={availability}
                // The windows are the options list, and the scope is what the claims cover - so the grid knows when to
                // ask for a month rather than draw it as unmarked.
                windows={availabilityWindows}
                loadedFrom={availabilityScope.from}
                loadedTo={availabilityScope.to}
                onLoadMonth={loadAvailabilityMonth}
                ranks={ranks}
                timeFormat={activeTimeFormat}
                // Non-shift entries, so the month reads the same here as on My Schedule.
                events={events}
                eventAudience={announcementAudience}
                onChanged={refreshAvailability}
              />
            )}

            {activeTab === 'help' && <HelpGuides scope="member" />}

            {/* Documents: open to every signed-in member, like Help. The server decides which documents a
                member may see (published, and at or above their rank), so there is no permission to check here -
                a screen that filtered again would be a second copy of that rule. */}
            {activeTab === 'documents' && canViewDocuments && (
              <DocumentsModule
                token={authToken}
                currentUser={currentUser}
                timeFormat={activeTimeFormat}
                users={users}
                canVerify={canVerifyDocuments}
              />
            )}

            {activeTab === 'training' && canSignTrainings && (
              <TrainingModule
                token={authToken}
                currentUser={currentUser}
                trainings={trainings}
                signatures={trainingSignatures}
                canEdit={canEditTrainings}
                onChanged={refreshTraining}
              />
            )}

            {activeTab === 'certifications' && (
              <CertificationsModule token={authToken} />
            )}

            {activeTab === 'settings' && (
              <UserSettings
                currentUser={currentUser}
                userSettings={userSettings}
                systemSettings={systemSettings.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {})}
                currentRole={currentUserRole}
                canApproveShifts={canApproveShifts}
                onSaveSettings={handleSaveUserSettings}
                pushDeviceApi={pushDeviceApi}
                onPasswordChange={handlePasswordChange}
              />
            )}

            {activeTab === 'admin' && canAdminister && (
              <AdminPanel
                // THE MODULE'S DATA IS READ WHEN A SECTION IS CHOSEN (see the adminModuleOpened effect), so a tab can be
                // holding its props before the read has landed - and every tab below renders "No users yet" from an empty
                // list, which reads as a broken station rather than a read in flight. The menu page is exempt: it reads
                // only the badge's offers, and an empty list there is a real answer, not a read in flight. (For a role
                // without is_admin the wave never runs at all - its sections load per tab - so the spinner must not gate it.)
                loading={isAdmin && !!adminSubTab && !adminWaveSettled}
                // Used only on the printed schedule sheet's header.
                departmentName={departmentName}
                // The open sub-tab is OWNED HERE: '' is the menu page, a tab id is that tab. The sidebar
                // resets it to '' on every visit to Administration, which is the way back to the menu.
                subTab={adminSubTab}
                onSelectTab={setAdminSubTab}
                // Lets the app bar name the open Administration tab ("Admin: Schedule Mgt").
                onActiveSubTabChange={setAdminSubTab}
                // Certifications: the catalog rides with every payload, the records only for a role that may
                // manage them (see adminBootstrapPayload).
                certificationSetup={certificationSetup}
                certificationRecords={certificationRecords}
                // The crew directory the admin tabs name members from (see sectionsForTab): read when a tab that
                // draws names opens, because the users section's users_private join is refused to an officer
                // without can_edit_users.
                directory={directory}
                currentRole={currentUserRole}
                isAdmin={isAdmin}
                currentUserId={String(currentUser?.id ?? '')}
                users={users}
                roles={roles}
                ranks={ranks}
                shifts={shifts}
                schedule={schedule}
                // THE BOARD READS THE MONTH IT IS SHOWING, so it is handed the reader and the reason the last read
                // failed. `scheduleWindow` is deliberately NOT passed any more: the board no longer decides from a window
                // whether to ask - it asks for the month on screen, every time (see AdminScheduleManagementTab).
                scheduleWindowError={scheduleWindowError}
                onNeedSchedule={loadScheduleWindow}
                scheduleTemplates={scheduleTemplates}
                assignments={assignments}
                availability={availability}
                // The Member Availability tab reads the WINDOWS and the CREW'S claims, not this member's own rows: that
                // is what the station-wide read changed, and it is why the roster and the board used to be wrong.
                availabilityWindows={availabilityWindows}
                rosterAvailability={rosterAvailability}
                rosterScope={rosterScope}
                onRosterMonth={loadRosterMonth}
                systemSettings={systemSettings}
                logs={logs}
                timeFormat={activeTimeFormat}
                token={authToken}
                // One callback for every admin save, SCOPED: `onDataChanged('ranks')` re-reads the ranks and nothing
                // else, because the tab has already merged its own row and the write went where the writer said it did.
                // Called with no names it still reloads the whole payload, so a tab that has not been scoped yet is
                // slow rather than wrong.
                onDataChanged={refreshAdminCollections}
                onAvailabilityChanged={refreshAvailability}
                onLogsChanged={refreshLogs}
                onAdminDataChanged={refreshAdminCollections}
                // Non-shift entries, for the board and the availability grid this module hosts.
                events={events}
                offers={adminOffers}
                // Resolving an offer fills the shift, so this one save touches two collections: the offers table and
                // the schedule row it just filled.
                onOffersChanged={() => refreshAdminCollections(['scheduleOffers', 'schedule'])}
                trainings={trainings}
                trainingSignatures={trainingSignatures}
                // Lets any admin tab show a saved row immediately instead of waiting for the
                // background refresh wave to drain. One prop for every collection.
                onRowSaved={applySavedRow}
              />
            )}

            {activeTab === 'runner' && (
              <FirefighterRunner
                width={800}
                height={280}
                initialSpeed={350}
                maxSpeed={900}
                // The leaderboard needs a session (the score is stored as a personal best on
                // the signed-in member's row), and the id to highlight your own line.
                token={authToken}
                currentUser={currentUser}
                // Which sound set to play, chosen by an administrator on the Users tab.
                soundProfile={runnerSoundProfile}
              />
            )}
            </Suspense>
          </main>
        </div>
      )}
    </>
  );
}