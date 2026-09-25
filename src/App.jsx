import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Clock, Shield, Menu, X } from 'lucide-react';
// Also hosts the in-app copy of push notifications (see the service-worker
// message listener below).
import { Toaster, toast } from 'sonner';
import {
  fetchInitialData,
  fetchTimeclockLogs,
  fetchUserSchedule,
  fetchTraining,
  fetchOnDutyUsers,
  fetchRoster,
  fetchMyShiftOffers,
  adminFetchScheduleOffers,
  fetchAvailability,
  submitClockAction,
  saveUserSettings,
  updateUserPassword,
  loginUser,
  pingSession,
  adminFetchUsers,
  adminFetchScheduleTemplates,
  registerPushDevice,
  unregisterPushDevice,
  fetchMyPushDevices
} from './services/api';

import LoginScreen from './components/LoginScreen';
import ReauthModal from './components/ReauthModal';
import ClockBlockedModal from './components/ClockBlockedModal';
import Sidebar from './components/Sidebar';
import ClockCard from './components/ClockCard';
import OnDutyCard from './components/OnDutyCard';
import UserSettings from './components/UserSettings';
import LoadingOverlay from './components/LoadingOverlay';
import MyClockHistory from './components/MyClockHistory';
import {
  MASTER_PERMISSION_KEY,
  permissionGranted,
  roleHasAdministration,
} from './utils/permissions';
import ScheduleCalendar from './components/ScheduleCalendar';
import MyAvailability from './components/MyAvailability';
import HelpGuides from './components/HelpGuides';
import { pageBarLabel } from './utils/pageLabels';
import TrainingModule from './components/TrainingModule';
import DigitalClock from './components/DigitalClock';
import AdminPanel from './components/admin/AdminPanel';
import { getCurrentCoordinates } from './utils/geolocation';
import { clockLocationConfig, clockLocationNotice, evaluateClockLocation, OUT_OF_RANGE_CODE } from './utils/clockLocation';
import { mergeSavedUser } from './utils/userRow';
import { mergeSavedRow } from './utils/savedRow';
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
import { fetchMyAnnouncements, fetchEvents } from './services/api';
import { normalizeEventList } from './utils/events';
import FirefighterRunner from './components/FirefighterRunner/FirefighterRunner';

// Content pages fill the viewport. There is deliberately no max-width on the container itself: a station's
// schedule and clock tables are dense, and capping them wasted the horizontal space a wide screen has.
//
// The exceptions are listed in utils/contentWidth, which owns the whole policy: which top-level modules get
// a capped, centred column, and how wide it is. Screens that need the cap only in part - an administration
// sub-tab, or one view inside a tab - wrap that part in components/CenteredContent instead.
//
// `min-w-0` on the <main> below is the load-bearing part on small screens. Main is a flex child, and a
// flex item's default `min-width: auto` refuses to shrink below its content - so one wide table would
// push the page wider than the viewport and give the app a horizontal scrollbar on a phone or tablet.
// Letting it shrink keeps the overflow inside each table's own `overflow-x-auto` wrapper, where it
// belongs. Padding steps up with the screen size so a phone spends its width on content, not margins.

export default function App() {
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [onDutyUsers, setOnDutyUsers] = useState([]);
  const [userSettings, setUserSettings] = useState([]);
  const [roles, setRoles] = useState([]);
  const [ranks, setRanks] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [availability, setAvailability] = useState([]);
  // Training: the activities, and the signatures this member may see (their own, unless the
  // role can administer trainings - the server decides which).
  const [trainings, setTrainings] = useState([]);
  const [trainingSignatures, setTrainingSignatures] = useState([]);
  // Announcements: the public ones from the initial payload (login screen), and this member's own
  // targeted ones fetched after sign-in. Kept apart so signing out cannot clear the public list.
  const [announcements, setAnnouncements] = useState([]);
  // Non-shift calendar entries. Fetched once per sign-in and after an administrator changes something,
  // rather than on every page view: they change rarely and every calendar reads the same list.
  const [events, setEvents] = useState([]);
  const [loginAnnouncements, setLoginAnnouncements] = useState([]);
  const [scheduleTemplates, setScheduleTemplates] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [systemSettings, setSystemSettings] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  // Minimal, member-visible roster (id/name/rank_id). Admins also load the full
  // directory via refreshAdminUsers; members only get this projection, and it's
  // what lets the schedule calendar name other people's shifts.
  const [roster, setRoster] = useState([]);
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
  const [isClockedIn, setIsClockedIn] = useState(false);

  // A clock action refused for location, awaiting the member's acknowledgement. Held here rather
  // than in the clock card so both refusal paths can raise it: the client-side geofence check and
  // the backend's own OUT_OF_RANGE refusal.
  const [clockNotice, setClockNotice] = useState(null);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');

  // Initial Boot Loading
  const [initialLoading, setInitialLoading] = useState(true);
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

  // Whether this screen's content is capped and centred (see CENTERED_CONTENT_TABS).
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
  const [adminSubTab, setAdminSubTab] = useState('');

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
    loadAppData();
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

      toast(message.title || 'Station Portal', { description: message.body || '' });
    };

    navigator.serviceWorker.addEventListener('message', handlePushMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handlePushMessage);
  }, [currentUser]);

  useEffect(() => {
    if (currentUser && logs) {
      const activeShift = logs.find(
        (log) => String(log.user_id) === String(currentUser.id) && !log.time_out
      );
      setIsClockedIn(!!activeShift);
    }
  }, [currentUser, logs]);

  const loadAppData = async () => {
    try {
      // Only public/config data is fetched pre-login. Member data (logs, on-duty
      // roster, admin directory) is fetched after authentication succeeds.
      await refreshAdminData();
    } catch (err) {
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
  const sessionExpired = (usedToken, retryAction = null) => {
    if (unauthorizedIsStale(usedToken, tokenRef.current)) return false;
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
    // The request list is built FIRST, so the reporter's total is DERIVED from it.
    //
    // A hand-maintained count is what left a toast stuck at "9 of 10 done…" while all nine requests had
    // already finished: the number and the list were two facts that had to be kept in step by hand, and
    // verification of that number was itself broken (see verify-refresh-wiring). Now there is nothing to
    // keep in step - add a request to this list and the count follows.
    const requests = [fetchInitialData()];

    if (token) {
      requests.push(
        refreshAdminUsers(token),
        refreshAdminScheduleData(token), // templates, assignments AND offers
        refreshSchedule(token),
        refreshRoster(token),
        // The dashboard's on-duty card: an admin correcting a clock record should not leave someone
        // looking still on duty.
        refreshOnDuty(token),
        // The Training report: a save there changes both trainings and signatures, and the member module
        // reads the same two caches.
        refreshTraining(token),
        // Announcements: a newly created one should appear in the member views immediately.
        refreshAnnouncements(token),
        // Events: the calendars draw them, so they have to arrive with everything else.
        refreshEvents(token)
      );
    }

    // One toast per wave, with an id that is never reused, so a second wave (a save during sign-in, say)
    // STACKS rather than replacing the first. It reports and gets out of the way - nothing awaits it, and
    // nothing is blocked by it.
    const waveId = nextWaveId();
    const report = createWaveReporter({
      label: 'Refreshing views',
      total: requests.length,
      onProgress: (message) => toast.loading(message, { id: waveId }),
      onDone: (message) => toast.success(message, { id: waveId, duration: 2500 }),
    });

    try {
      // Each request is counted as it settles, WHETHER IT SUCCEEDED OR NOT. An earlier version counted only
      // the ones it awaited, so a request that failed left the wave claiming to be unfinished forever.
      const tracked = requests.map((request) =>
        request.then(
          (value) => {
            report.settle(true);
            return value;
          },
          (err) => {
            console.error('Admin refresh: one request failed', err);
            report.settle(false);
            return null;
          }
        )
      );

      const [initial] = await Promise.all(tracked);

      if (initial && initial.userSettings) setUserSettings(initial.userSettings);
      if (initial && initial.roles) setRoles(initial.roles);
      if (initial && initial.ranks) setRanks(initial.ranks);
      if (initial && initial.shifts) setShifts(initial.shifts);
      if (initial && initial.systemSettings) setSystemSettings(initial.systemSettings);
      // The login screen's announcements ride with the public payload, since there is no session then.
      if (initial && Array.isArray(initial.announcements)) setLoginAnnouncements(initial.announcements);
    } catch (err) {
      console.error('Failed to refresh admin data', err);
    }
  };

  // When auth token changes, refresh all admin-scoped data if we're an admin
  useEffect(() => {
    if (!isAdmin || !authToken) return;
    
    const fetchData = async () => {
      try {
        // refreshAdminScheduleData already fetches the offers table itself, so
        // listing refreshAdminOffers here as well fired that call twice.
        await Promise.all([
          refreshAdminUsers(authToken),
          refreshAdminScheduleData(authToken),
        ]);
      } catch (err) {
        console.error('Failed to refresh admin data', err);
      }
    };
    
    fetchData();
  }, [authToken, isAdmin]);

  // Opens the reauthentication modal instead of logging the user out. An
  const refreshAdminUsers = async (token) => {
    const data = await adminFetchUsers(token);
    if (data && data.success && data.users) {
      setUsers(data.users);
    }
    if (data && data.code === 'UNAUTHORIZED') {
      sessionExpired(token);
      return;
    }
  };

  // Fetches schedule template configuration + reference data (templates,
  // assignments, apparatus) plus every shift offer - only succeeds server-side
  // for a logged-in admin.
  const refreshAdminScheduleData = async (token) => {
    try {
      const data = await adminFetchScheduleTemplates(token);
      if (data && data.code === 'UNAUTHORIZED') {
        sessionExpired(token);
        return;
      }
      if (data && data.success) {
        if (data.scheduleTemplates) setScheduleTemplates(data.scheduleTemplates);
        if (data.assignments) setAssignments(data.assignments);
      }
    } catch (err) {
      console.error('Failed to update schedule templates', err);
    }
    await refreshAdminOffers(token);
  };

  // The signed-in member's own shift offers (pending/approved/declined) - what
  // the My Schedule pills read to show "pending approval".
  const refreshOffers = async (token) => {
    try {
      const data = await fetchMyShiftOffers(token);
      if (data && data.code === 'UNAUTHORIZED') {
        sessionExpired(token);
        return;
      }
      if (data && data.success && data.offers) setOffers(data.offers);
    } catch (err) {
      console.error('Failed to update shift offers', err);
    }
  };

  // Admin: the whole offers table, so Schedule Management can flag the slots
  // waiting on approval.
    const refreshAdminOffers = async (token) => {
    const t = token || authToken;
    if (!t) return;
    try {
      const data = await adminFetchScheduleOffers(t);
      if (data && data.code === 'UNAUTHORIZED') {
        sessionExpired(token);
        return;
      }
      if (data && data.success && data.offers) setAdminOffers(data.offers);
    } catch (err) {
      console.error('Failed to update schedule offers', err);
    }
  };

  const refreshLogs = async (token) => {
    try {
      const data = await fetchTimeclockLogs(token);
      if (data && data.code === 'UNAUTHORIZED') {
        sessionExpired(token);
        return;
      }
      if (data && data.logs) setLogs(data.logs);
    } catch (err) {
      console.error('Failed to update logs', err);
    }
  };

  const refreshOnDuty = async (token) => {
    try {
      const data = await fetchOnDutyUsers(token);
      if (data && data.code === 'UNAUTHORIZED') {
        sessionExpired(token);
        return;
      }
      if (data && data.onDuty) setOnDutyUsers(data.onDuty);
    } catch (err) {
      console.error('Failed to update on-duty roster', err);
    }
  };


  // Training. The list is readable by any signed-in member, but the names/signatures payload
  // differs by role - the server returns only the signed-in member's own signatures unless the
  // role can administer trainings - so this simply stores whatever came back.
  // Non-shift calendar entries for the signed-in member. The server filters by audience, so this list is
  // already only what they may see; the calendar filters again by the same rule as a guard.
  const refreshEvents = async (token) => {
    try {
      const data = await fetchEvents(token);
      if (data && data.code === 'UNAUTHORIZED') {
        sessionExpired(token);
        return;
      }
      if (data && data.events) {
        // Normalised at the boundary, once: every calendar (and the printed sheet) then reads the same
        // shape, and none of them has to remember to convert a raw sheet row. Passing raw rows through was
        // the bug that made events invisible - the engine reads `isAllDay`/`startsAt`, not `is_all_day`.
        setEvents(normalizeEventList(data.events));
      }
    } catch (err) {
      // A calendar without events is still a usable calendar, so this never blocks the app.
      console.error('Failed to refresh events:', err);
    }
  };

  const refreshAnnouncements = async (token) => {
    try {
      const data = await fetchMyAnnouncements(token);
      if (data && data.code === 'UNAUTHORIZED') {
        sessionExpired(token);
        return;
      }
      // Replaces only the member's own list. The login-screen announcements came with the public initial
      // payload, so signing out does not clear them.
      if (data && data.announcements) setAnnouncements(data.announcements);
    } catch (err) {
      console.error('Failed to refresh announcements:', err);
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
    } catch (err) {
      console.error('Failed to refresh training data:', err);
    }
  };

  const refreshSchedule = async (token) => {
    try {
      const data = await fetchUserSchedule(token);
      if (data && data.code === 'UNAUTHORIZED') {
        sessionExpired(token);
        return;
      }
      if (data && data.schedule) setSchedule(data.schedule);
      // GET_SCHEDULE also returns the assignment reference data (name, colour,
      // minimum rank). Admins already hold the FULL assignment rows from their own
      // endpoint, and this payload is a four-column projection of them, so it is
      // only applied for members - otherwise an admin's richer copy could be
      // replaced by the narrower one.
      if (!isAdmin && data && data.assignments) setAssignments(data.assignments);
      // Same reasoning as the projection above: an admin already holds the full template
      // rows from their own endpoint, so the narrower member copy is only applied for a
      // role without Administration access. Without it a member has no template data at
      // all, and so no shift windows, nicknames or unfilled template slots.
      if (!isAdmin && data && data.scheduleTemplates) setScheduleTemplates(data.scheduleTemplates);
    } catch (err) {
      console.error('Failed to update schedule', err);
    }
  };

  // Member-visible roster used to label other members on the schedule calendar.
  // A backend deployment that predates GET_ROSTER returns no roster (or the
  // action is unknown), which is non-fatal - names fall back to member ids.
  const refreshRoster = async (token) => {
    try {
      const data = await fetchRoster(token);
      if (data && data.code === 'UNAUTHORIZED') {
        sessionExpired(token);
        return;
      }
      if (data && data.roster) setRoster(data.roster);
    } catch (err) {
      console.error('Failed to update member roster', err);
    }
  };

  const refreshAvailability = async (token = authToken) => {
    try {
      const data = await fetchAvailability(token);
      if (data && data.code === 'UNAUTHORIZED') {
        sessionExpired(token);
        return;
      }
      if (data && data.availability) setAvailability(data.availability);
    } catch (err) {
      console.error('Failed to update availability', err);
    }
  };

  // Post-sign-in data load.
  //
  // Every fetch here is a separate Apps Script execution (~1-3s). Awaiting all of
  // them held the "Please Wait" overlay over an already-rendered app, which is
  // what made signing in feel slow even after the token came back. Only the data
  // the first screen actually shows (clock history + who is on duty) is awaited;
  // everything else fills in its own tab in the background.
  //
  // Admin-scoped data is deliberately NOT fetched here - the authToken effect
  // below already does it, and doing both meant every admin call ran twice.
  const loadPostLoginData = (token) => {
    // Started first, so these are already in flight while the overlay waits on
    // the two calls returned below.
    void Promise.all([
      refreshSchedule(token),
      refreshAvailability(token),
      refreshRoster(token),
      refreshOffers(token),
      refreshTraining(token),
      refreshAnnouncements(token),
      // The calendars draw events, so a member needs them as soon as they sign in.
      refreshEvents(token)
    ]);

    return Promise.all([refreshLogs(token), refreshOnDuty(token)]);
  };

  const handleLogin = async (username, password) => {
    setStatusMessage({ type: '', text: '' });
    setGlobalLoading({ active: true, message: getLoadingMessage() });

    try {
      const result = await loginUser(username, password);

      if (result.success) {
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
    } catch (err) {
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
  ]);

  const handleLogout = () => {
    pendingActionRef.current = null;
    setNeedsReauth(false);
    setCurrentUser(null);
    applyToken(null);
    setIsSidebarOpen(false);
    setActiveTab('dashboard');
    // A refusal modal belongs to the session that hit it, so it must not survive a sign-out - the
    // next person to sign in should never be greeted by someone else's message.
    setClockNotice(null);
    setStatusMessage({ type: '', text: '' });
  };

  // Ends the session with an explanation, which is the only difference from a normal sign-out.
  // Stable (setters and refs only) so it can be called from the timer without re-arming it.
  const endSession = useCallback((message) => {
    pendingActionRef.current = null;
    setNeedsReauth(false);
    setCurrentUser(null);
    applyToken(null);
    setIsSidebarOpen(false);
    setActiveTab('dashboard');
    applyIdleWarning(null);
    // Same reasoning as handleLogout: a refusal modal must not survive the session that raised it.
    setClockNotice(null);
    setStatusMessage(message ? { type: 'error', text: message } : { type: '', text: '' });
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

  // "Stay signed in". The click already counts as activity, but the server window has to be pushed
  // out too - otherwise the button would only dismiss the warning while the session lapsed anyway.
  const handleStaySignedIn = () => {
    lastActivityRef.current = Date.now();
    applyIdleWarning(null);
    // Deliberately not awaited: the warning disappears at once, and a failure here is not worth
    // reporting when the next action will simply ask for the password again.
    void pingSession(authToken);
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
      }

      return { success: true };
    } catch (err) {
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
    } catch (err) {
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
    } catch (err) {
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
      register: (deviceToken, deviceLabel) => registerPushDevice(deviceToken, deviceLabel, authToken),
      unregister: (deviceToken) => unregisterPushDevice(deviceToken, authToken),
      list: () => fetchMyPushDevices(authToken),
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
  // The authoritative refresh still runs, but it cannot be waited on: doPost serialises every
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
      const result = await updateUserPassword(currentUser.id, newPassword, authToken);
      if (result.success) {
        setCurrentUser((prev) => ({ ...prev, password: newPassword }));
        setUsers((prev) =>
          prev.map((u) => (String(u.id) === String(currentUser.id) ? { ...u, password: newPassword } : u))
        );
      }
      return result;
    } catch (err) {
      return { success: false, message: 'Network error updating password.' };
    } finally {
      setGlobalLoading({ active: false, message: '' });
    }
  };

  if (initialLoading) {
    // Use configured loading messages from system settings, or fall back to default ones
    const configuredMessages = loadingMessages.filter((msg) => msg.trim() !== '');
    const defaultMessages = [
      'Starting the engine...',
      'Deciding who cleans the bay today...',
      'Waking up the night shift...',
      'Asking CCOM for a radio check...',
      'Looking for a ladder truck...',
      'Looking for a radio strap...',
      'Warming up the coffee...',
      'Making sure the hydrant still flows water...',
    ];
    const messages = configuredMessages.length > 0 ? configuredMessages : defaultMessages;

    return (
      <div className="min-h-screen bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-white flex items-center justify-center">
        <Clock className="w-8 h-8 animate-spin text-red-500 mr-3" />
        <span className="text-xl font-medium">{messages[Math.floor(Math.random() * messages.length)]}</span>
      </div>
    );
  }

  return (
    <>
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
          className="fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center justify-center gap-3 border-t border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-2xl dark:border-amber-800/80 dark:bg-amber-950/90 dark:text-amber-200"
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
          onReauth={handleReauth}
          onSignOut={handleLogout}
        />
      )}

      {/* A clock action refused for location. Mounted only while a notice is pending, so it can
          never linger over the app, and dismissed only by the member's own click. */}
      {currentUser && clockNotice && (
        <ClockBlockedModal notice={clockNotice} onDismiss={() => setClockNotice(null)} />
      )}

      {!currentUser ? (
        <LoginScreen onLogin={handleLogin} statusMessage={statusMessage} departmentName={departmentName} announcements={loginAnnouncements} />
      ) : (
        <div className="min-h-screen bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100 flex flex-col md:flex-row md:h-screen md:overflow-hidden">
          {/* Sticky on mobile so the app name and the menu button are always reachable; the page title
              below scrolls with the content, as it should. `z-10` keeps it BELOW the sidebar's z-20
              backdrop and z-30 drawer, so opening the menu dims the whole page including this bar. */}
          <header ref={topBarRef} className="md:hidden sticky top-0 z-10 flex items-center justify-between bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4">
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
            setActiveTab={setActiveTab}
            isSidebarOpen={isSidebarOpen}
            setIsSidebarOpen={setIsSidebarOpen}
            onLogout={handleLogout}
            // Module visibility, all driven by the role's permissions.
            canAdminister={canAdminister}
            canViewSchedule={canViewSchedule}
            canEditAvailability={canEditOwnAvailability}
            canUseTimeclock={canUseTimeclock}
            canSignTrainings={canSignTrainings}
            ranks={ranks}
          />

          <main
            className={`flex-1 min-w-0 md:h-screen md:overflow-y-auto p-4 sm:p-6 lg:p-8 ${
              centeredContent ? `mx-auto w-full ${CONTENT_MAX_WIDTH}` : ''
            }`}
          >
            {/* The page title scrolls with the content: only the app bar above is pinned, so the heading
                moves out of the way as you read. Once it has, the app bar says which page this is. */}
            <div ref={pageHeadingRef} className="mb-8">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                {activeTab === 'dashboard' && `Welcome, ${currentUser.name}`}
                {activeTab === 'clock-history' && 'My Clock History'}
                {activeTab === 'schedule' && 'My Schedule'}
                {activeTab === 'availability' && 'My Availability'}
                {activeTab === 'training' && 'Training'}
                {activeTab === 'help' && 'Help'}
                {activeTab === 'settings' && 'User Settings'}
                {activeTab === 'admin' && 'Administration'}
              </h2>
              <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
                {activeTab === 'dashboard' && 'Manage your hours and time tracking.'}
                {activeTab === 'clock-history' && 'Review your previous clock-in entries, duration, and locations.'}
                {activeTab === 'schedule' && 'Review your assigned shifts, or switch on "Show everyone" to see the whole crew.'}
                {activeTab === 'availability' && 'Mark the shifts you could work, and administrators will see it when they build the schedule.'}
                {activeTab === 'training' && 'Sign off the trainings you attended. Administrators can see who has signed each one.'}
                {activeTab === 'help' && 'Guides for using the portal. Administrators have their own set under Administration → System → Help.'}
                {activeTab === 'settings' && 'Customize your personal account preferences.'}
                {activeTab === 'admin' && 'Manage users, roles, ranks, and system settings.'}
              </p>
            </div>

            {activeTab === 'dashboard' && (
              <div className="space-y-6">
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
                    onClockAction={handleClockAction}
                  />
                )}

                {/* Who's currently working */}
                <OnDutyCard onDutyUsers={onDutyUsers} ranks={ranks} />
              </div>
            )}

            {activeTab === 'clock-history' && canUseTimeclock && (
              <MyClockHistory currentUser={currentUser} logs={logs} timeFormat={activeTimeFormat} shifts={shifts} />
            )}

            {activeTab === 'schedule' && canViewSchedule && (
              <ScheduleCalendar
                currentUser={currentUser}
                schedule={schedule}
                assignments={assignments}
                scheduleTemplates={scheduleTemplates}
                ranks={ranks}
                users={nameDirectory}
                offers={offers}
                token={authToken}
                // Role permissions the calendar itself has to honour: who may offer
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
                // Same reference data My Schedule uses, so the slots this screen
                // preloads are exactly the shifts the calendar would let them offer for.
                scheduleTemplates={scheduleTemplates}
                assignments={assignments}
                ranks={ranks}
                timeFormat={activeTimeFormat}
                // Non-shift entries, so the month reads the same here as on My Schedule.
                events={events}
                eventAudience={announcementAudience}
                onChanged={refreshAvailability}
              />
            )}

            {activeTab === 'help' && <HelpGuides scope="member" />}

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
                // Used only on the printed schedule sheet's header.
                departmentName={departmentName}
                // Lets the app bar name the open Administration tab ("Admin: Schedule Mgt").
                onActiveSubTabChange={setAdminSubTab}
                currentRole={currentUserRole}
                isAdmin={isAdmin}
                users={users}
                roles={roles}
                ranks={ranks}
                shifts={shifts}
                schedule={schedule}
                scheduleTemplates={scheduleTemplates}
                assignments={assignments}
                availability={availability}
                systemSettings={systemSettings}
                logs={logs}
                timeFormat={activeTimeFormat}
                token={authToken}
                // One callback for every admin save: refreshAdminData reloads all the
                // caches the tabs read (roles, ranks, shifts, settings, users, templates,
                // assignments, offers, the schedule rows and the roster), so a tab cannot
                // refresh "its half" and leave another screen stale.
                onDataChanged={refreshAdminData}
                onAvailabilityChanged={refreshAvailability}
                onLogsChanged={refreshLogs}
                onAdminDataChanged={refreshAdminData}
                // Non-shift entries, for the board and the availability grid this module hosts.
                events={events}
                offers={adminOffers}
                onOffersChanged={refreshAdminOffers}
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
          </main>
        </div>
      )}
    </>
  );
}