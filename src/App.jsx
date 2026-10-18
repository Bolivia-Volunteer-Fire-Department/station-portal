import React, { Suspense, lazy, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Clock, Loader2 } from 'lucide-react';
// Shows toast notification popups on screen.
import { Toaster } from 'sonner';
import { toast, notificationToast } from './utils/toast';
import {
  installUiSoundListeners,
  setSoundsEnabled,
  soundsActiveFrom,
  SOUNDS_SETTING_KEY,
  SOUNDS_DEFAULT,
  playSound,
  // Resets session sound volumes from Debug settings.
  resetSoundVolumes,
} from './utils/uiSounds';
// Checks if the welcome sound should play on sign-in.
import { welcomeIsOwed } from './utils/welcomeSound';
import { runRefreshWave, REFRESH_OK, REFRESH_FAILED, REFRESH_EXPIRED } from './utils/refreshWave';
import {
  fetchInitialData,
  fetchBootstrap,
  adminFetchBootstrap,
  fetchAdminSections,
  fetchAvailabilityWindows,
  fetchCertificationBadges,
  fetchRoster,
  fetchRosterModule,
  fetchScheduleSetup,
  fetchScheduleWindow,
  fetchTimeclockLogs,
  fetchTraining,
  fetchOnDutyUsers,
  fetchMyShiftOffers,
  fetchAvailability,
  adminFetchAvailability,
  adminFetchAvailabilityWindows,
  submitClockAction,
  saveUserSettings,
  updateUserPassword,
  loginUser,
  registerPushDevice,
  unregisterPushDevice,
  fetchMyPushDevices,
  fetchWorkOrders,
} from './services/api';
import { signInAlongside, signOutAlongside, watchAccount } from './services/firebaseAuth.js';
import { firebaseConfigured } from './services/firebase';
// Listens for real-time updates from Firestore.
import { subscribeLive } from './services/liveReads';
// Decides when to refresh stale data upon returning to the tab.
import { sentinelChanged, shouldRefreshOnReturn } from './utils/freshness';

import LoginScreen from './components/LoginScreen';
import ReauthModal from './components/ReauthModal';
import PasswordChangeModal from './components/PasswordChangeModal';
import { mustChangePassword, MUST_CHANGE_PASSWORD_COLUMN } from './utils/passwordPolicy';
import ClockBlockedModal from './components/ClockBlockedModal';
import Sidebar from './components/Sidebar';
import MobileBottomNav from './components/MobileBottomNav';
import { MOBILE_NAV_MODULES_KEY, parseMobileNavModules } from './utils/mobileNav';
import PixelBurst from './components/PixelBurst';
import DashboardModule from './components/DashboardModule';
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
// Handles clock in and clock out actions.
import {
  AdminPanel,
  CertificationsModule,
  DistrictMap,
  DocumentsModule,
  FirefighterRunner,
  HelpGuides,
  MyAvailability,
  MyClockHistory,
  ScheduleCalendar,
  RosterModule,
  ReportsAndFormsModule,
  // Lazy-loaded modules for reports and forms.
  ReportsModule,
  FormsModule,
  TrainingModule,
  UserProfile,
  UserSettings,
  prefetchDeferredModules,
  prefetchableFor,
} from './utils/deferredModules';
const WorkOrdersModule = lazy(() => import('./components/WorkOrdersModule'));
// Chat component available across all screens.
import ChatHost from './components/Chat/ChatHost';
import ScheduleFreshness from './components/ScheduleFreshness';
import { pageBarLabel } from './utils/pageLabels';
import CertificationNotice from './components/CertificationNotice';
import {
  certificationBadgesLoaded,
  mergeCertificationBadges,
  setCertificationBadges,
} from './utils/certifications';
import DigitalClock from './components/DigitalClock';
import { getCurrentCoordinates } from './utils/geolocation';
import { clockLocationConfig, clockLocationNotice, evaluateClockLocation, OUT_OF_RANGE_CODE } from './utils/clockLocation';
import { mergeSavedUser } from './utils/userRow';
import { mergeSavedRow, mergeRowsById, replaceRowsInRange } from './utils/savedRow';
// Gets the current date key based on station timezone.
import { stationTodayKey, toDateKey } from './utils/scheduleDate';
// Configures pay period dates for the timeclock history.
import { payPeriodConfig, payPeriodWindow } from './utils/payPeriod';
// Sets the starting day of the calendar week.
import { setCalendarWeekStart } from './utils/calendarConstants';
// Prevents clock actions while the user is offline.
import { OFFLINE_CLOCK_MESSAGE, isOffline } from './utils/connectivity';
import { createWaveReporter, nextWaveId } from './utils/activity';
import {
  IDLE_RESET_EVENTS,
  accountChangeEndsSession,
  formatIdleCountdown,
  idleLogoutMessage,
  idleSecondsRemaining,
  idleState,
  sessionTimeoutConfig,
  SESSION_ENDED_MESSAGE,
  unauthorizedIsStale,
} from './utils/sessionTimeout';
import { bossSayingsFrom } from './utils/systemSettings';
import { departmentLogoUrl, stationLogoUrl, stationSyncLoopsUrl } from './utils/assets';
import { updateRuntimePwaIcons } from './utils/pwaIcons';
import { CENTERED_CONTENT_TABS, CONTENT_MAX_WIDTH } from './utils/contentWidth';
import AnnouncementList from './components/AnnouncementList';
import { normalizeEventList } from './utils/events';
import AppUpdateBanner from './components/AppUpdateBanner';
import { AuthProvider } from './context/AuthContext';
import { StationDataProvider } from './context/StationDataContext';
import { readStationMetaCache, writeStationMetaCache, isStationMetaStale } from './utils/stationCache';

// Loading spinner displayed while screen code is downloading.

// Loading spinner displayed while screen code is downloading.
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
  const [cachedStationMeta] = useState(() => readStationMetaCache());
  const [roles, setRoles] = useState(() => cachedStationMeta?.roles || []);
  const [ranks, setRanks] = useState(() => cachedStationMeta?.ranks || []);
  const [shifts, setShifts] = useState(() => cachedStationMeta?.shifts || []);
  const [schedule, setSchedule] = useState([]);
  // Tracks the currently loaded date range for the schedule.
  const [scheduleWindow, setScheduleWindow] = useState({ from: '', to: '' });
  // Tracks the currently loaded date range for the schedule.
  const [scheduleWindowError, setScheduleWindowError] = useState('');
  const [availability, setAvailability] = useState([]);
  // Shift availability templates and date boundaries.
  const [availabilityWindows, setAvailabilityWindows] = useState([]);
  const [availabilityScope, setAvailabilityScope] = useState({ from: '', to: '' });
  // Crew availability submissions loaded for administrators.
  const [rosterAvailability, setRosterAvailability] = useState([]);
  const [rosterScope, setRosterScope] = useState({ from: '', to: '' });
  // Training activities and member completion signatures.
  const [trainings, setTrainings] = useState([]);
  const [trainingSignatures, setTrainingSignatures] = useState([]);
  const [adminTrainingSignatures, setAdminTrainingSignatures] = useState([]);
  // Alerts for upcoming or expired certifications.
  const [certificationAlerts, setCertificationAlerts] = useState([]);
  const [certificationSetup, setCertificationSetup] = useState([]);
  const [certificationRecords, setCertificationRecords] = useState([]);
  // Station announcements and bulletins.
  const [announcements, setAnnouncements] = useState([]);
  // Calendar events and station activities.
  const [events, setEvents] = useState([]);
  const [scheduleTemplates, setScheduleTemplates] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [systemSettings, setSystemSettings] = useState(() => cachedStationMeta?.systemSettings || []);
  const [currentUser, setCurrentUser] = useState(null);
  const [fontScalePreview, setFontScalePreview] = useState(null);
  // Member roster information for shift assignments.
  const [roster, setRoster] = useState([]);
  // Crew member directory for administrative tools.
  const [directory, setDirectory] = useState([]);
  // Member roster information for shift assignments.
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const [rosterModuleCache, setRosterModuleCache] = useState(null);
  const [rosterModuleLoading, setRosterModuleLoading] = useState(false);
  const [rosterModuleError, setRosterModuleError] = useState('');
  // Shift coverage requests and trade offers.
  const [offers, setOffers] = useState([]);
  const [adminOffers, setAdminOffers] = useState([]);
  const [workOrders, setWorkOrders] = useState([]);
  const [authToken, setAuthToken] = useState(null);
  // Prompts the user to re-enter their password when expired.
  const [needsReauth, setNeedsReauth] = useState(false);
  // Handles clock in and clock out actions.
  const pendingActionRef = useRef(null);
  // Stores the current authentication token in a ref.
  const tokenRef = useRef(null);
  // When the current token was minted, so a refusal can say how long the session had lasted
  const sessionStartedAtRef = useRef(0);
  // Why the prompt opened: which request was refused and which token it carried, for the modal to show
  const [reauthReason, setReauthReason] = useState(null);
  const [isClockedIn, setIsClockedIn] = useState(false);

  const [clockNotice, setClockNotice] = useState(null);

  // Synchronize station metadata changes to persistent client cache
  useEffect(() => {
    if (roles.length > 0 || ranks.length > 0 || shifts.length > 0 || systemSettings.length > 0) {
      writeStationMetaCache({ roles, ranks, shifts, systemSettings });
    }
  }, [roles, ranks, shifts, systemSettings]);
  // Tracks online/offline connectivity status.
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
  const [mapTargetPreplanId, setMapTargetPreplanId] = useState(null);
  const [unreadChatCount, setUnreadChatCount] = useState(0);

  // Initial Boot Loading
  const [initialLoading, setInitialLoading] = useState(true);
  // Tracks app startup loading states.
  const [splashDone, setSplashDone] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState([]);

  // Global Shade & Spinner State
  const [globalLoading, setGlobalLoading] = useState({ active: false, message: '' });

  const [statusMessage, setStatusMessage] = useState({ type: '', text: '' });

  // Tracks inactivity countdown to sign out idle users.
  const sessionConfig = useMemo(() => sessionTimeoutConfig(systemSettings), [systemSettings]);
  const lastActivityRef = useRef(Date.now());
  const [idleWarningSeconds, setIdleWarningSeconds] = useState(null);
  // Tracks inactivity countdown to sign out idle users.
  const idleWarningRef = useRef(null);
  const applyIdleWarning = useCallback((value) => {
    if (idleWarningRef.current === value) return;
    idleWarningRef.current = value;
    setIdleWarningSeconds(value);
  }, []);

  const [easterEggCount, setEasterEggCount] = React.useState(0);
  // Triggers playful animation when clicking the station logo.
  const [easterBurst, setEasterBurst] = React.useState(0);
  const handleEasterEgg = () => {
      setEasterBurst((n) => n + 1);
      if (easterEggCount < 5) setEasterEggCount(prev => prev + 1);
      else if (activeTab !== 'runner') {
          setActiveTab('runner');
      } else {
          setActiveTab('dashboard');
          setEasterEggCount(0);
      }
  };

  // Determines 12-hour or 24-hour time format preference.
  const currentUserSettings = userSettings.find(
    (s) => String(s.id ?? s.user_id) === String(currentUser?.id)
  );
  const storedFontScale = Number(currentUserSettings?.font_scale);
  const savedFontScale = [0.5, 1, 1.5, 2].includes(storedFontScale) ? storedFontScale : 1;
  const appFontScale = fontScalePreview ?? (currentUser ? savedFontScale : 1);

  useEffect(() => {
    const root = document.documentElement;
    if (appFontScale === 1) root.style.removeProperty('font-size');
    else root.style.fontSize = `${appFontScale * 100}%`;
    return () => root.style.removeProperty('font-size');
  }, [appFontScale]);
  const hideEventsByDefault =
    currentUserSettings?.hide_events_by_default === true ||
    String(currentUserSettings?.hide_events_by_default ?? '').trim().toUpperCase() === 'TRUE';
  const colorblindRankLabels =
    currentUserSettings?.colorblind_rank_labels === true ||
    String(currentUserSettings?.colorblind_rank_labels ?? '').trim().toUpperCase() === 'TRUE';

  const activeTimeFormat =
    currentUserSettings?.time_format ||
    // systemSettings?.time_format ||
    '12';

  // Admin access is granted when the user's role has is_admin set
  const currentUserRole = roles.find((r) => String(r.id) === String(currentUser?.role_id));
  const currentUserRank = ranks.find((r) => String(r.id) === String(currentUser?.rank_id));
  // Filters announcements matching current user role and rank.
  const announcementAudience = {
    roleId: String(currentUser?.role_id ?? ''),
    rankId: String(currentUser?.rank_id ?? ''),
    userId: String(currentUser?.id ?? ''),
  };
  const isAdmin = permissionGranted(currentUserRole, MASTER_PERMISSION_KEY);
  // Checks if the user has permission to view administration tabs.
  const canAdminister = roleHasAdministration(currentUserRole);
  // One reader for every role flag, so each check below names the permission it depends on rather tha...
  const can = (key) => permissionGranted(currentUserRole, key);
  // Checks specific feature permissions for the current user.
  const canApproveShifts = can('can_approve_shifts');
  // Checks specific feature permissions for the current user.
  const canViewSchedule = can('can_view_my_schedule');
  const canMakeOffers = can('can_make_offers');
  const canViewFullSchedule = can('can_view_full_schedule');
  const canEditOwnAvailability = can('can_edit_own_availability');
  const canUseTimeclock = can('can_use_timeclock');
  // Training activities and member completion signatures.
  const canSignTrainings = can('can_sign_trainings');
  const canEditTrainings = can('can_edit_trainings');
  const canViewRoster = isAdmin || can('can_view_roster');
  // Checks if user has permission to use the chat module.
  const canUseChat = can('can_use_chat');

  // Checks if user can verify checklist items.
  const canVerifyDocuments = can('can_verify_documents');
// Checks if user can record assessment test scores.
const canAddAssessmentScores = can('can_add_assessment_scores');

  // Checks if user can read station documents.
  const canViewDocuments = can('can_view_documents');
  // Checks if user can view the district map.
  const canViewMap = can('can_view_map');
  // Checks if user can edit district map landmarks.
  const canEditMap = can('can_edit_map');
  const canViewReports = can('can_view_reports');
  const canGenerateForms = can('can_generate_forms');
  const canViewWorkOrders = isAdmin || can('can_view_work_orders') || can('can_manage_work_orders');
  const canManageWorkOrders = isAdmin || can('can_manage_work_orders');

  // Modules that render a seven-column calendar get the wider container
  const runnerSoundProfile = currentUser?.runner_sound_profile || '';

  // Whether this screen's content is capped and centerd (see CENTERED_CONTENT_TABS)
  const centeredContent = CENTERED_CONTENT_TABS.includes(activeTab);

  // The mobile app bar gains the page name once the page's own heading has scrolled out of sight, so ...
  const topBarRef = useRef(null);
  const pageHeadingRef = useRef(null);
  const [showPageLabel, setShowPageLabel] = useState(false);
  // The open Administration sub-tab, reported up by AdminPanel so the bar can say "Admin: Schedule Mgt"
  const [adminSubTab, setAdminSubTab] = useState('');
  const [initialWorkOrderId, setInitialWorkOrderId] = useState(null);
  const [initialWorkOrder, setInitialWorkOrder] = useState(null);

  // Determines whether the current screen fits within the viewport.
  const boundedScreen = activeTab === 'help' || activeTab === 'documents' || (activeTab === 'admin' && adminSubTab === 'help');

  // The chunks this member may need, joined into a string so the effect below depends on the SET rath...
  const prefetchKeys = useMemo(
    () =>
      prefetchableFor({
        canUseTimeclock,
        canViewSchedule,
        canEditOwnAvailability,
        canViewDocuments,
        canSignTrainings,
        canViewReports,
        canGenerateForms,
        canAdminister,
        canViewRoster,
        canViewMap,
      }).join(','),
    [
      canUseTimeclock,
      canViewSchedule,
      canEditOwnAvailability,
      canViewDocuments,
      canSignTrainings,
      canViewReports,
      canGenerateForms,
      canAdminister,
      canViewRoster,
      canViewMap,
    ]
  );

  // Member roster information for shift assignments.
  const [rosterSearch, setRosterSearch] = useState('');
  const [rosterLoadingMore, setRosterLoadingMore] = useState(false);
  // Member roster information for shift assignments.
  const [rosterLoadedFor, setRosterLoadedFor] = useState('');

  const loadRosterPage = async ({ token = authToken, search = '', cursor = '', append = false } = {}) => {
    if (append) setRosterLoadingMore(true);
    else setRosterModuleLoading(true);
    setRosterModuleError('');
    try {
      const data = await fetchRosterModule(token, { search, cursor });
      if (!data || data.code === 'UNAUTHORIZED') {
        sessionExpired(token);
        return;
      }
      setRosterModuleCache((prev) => {
        // A SECOND PAGE ADDS to the first rather than replacing it, and the columns merge with it: the call...
        const base = append && prev && prev.token === token && prev.search === search ? prev.data : null;
        return {
          token,
          search,
          data: {
            ...data,
            members: base ? [...(base.members || []), ...(data.members || [])] : data.members || [],
            memberCertificationIds: {
              ...((base && base.memberCertificationIds) || {}),
              ...(data.memberCertificationIds || {}),
            },
          },
        };
      });
    } catch (error) {
      setRosterModuleError(error.message || 'Could not load the roster.');
    } finally {
      if (append) setRosterLoadingMore(false);
      else setRosterModuleLoading(false);
    }
  };

  useEffect(() => {
    if (!authToken || activeTab !== 'roster' || !canViewRoster) return undefined;
    const key = `${authToken}|${rosterSearch}`;
    if (rosterLoadedFor === key) return undefined;
    setRosterLoadedFor(key);
    void loadRosterPage({ token: authToken, search: rosterSearch });
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, activeTab, canViewRoster, rosterSearch, rosterLoadedFor]);

  useEffect(() => {
    // Nothing to warm until a member is signed in: that is when a role exists, and so a set of reachabl...
    if (!currentUser || !prefetchKeys) return undefined;
    // Tracks inactivity countdown to sign out idle users.
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
    // Re-observing on a tab change reports the new heading's position immediately, without waiting for ...
  }, [activeTab, currentUser]);

  const departmentName = systemSettings.find((s) => String(s.key) === 'department_name')?.value || '';
  const stationName = systemSettings.find((s) => String(s.key) === 'station_name')?.value || departmentName || '';
  const departmentLogo = departmentLogoUrl(systemSettings);
  const mobileNavModules = parseMobileNavModules(
    systemSettings.find((s) => String(s.key) === MOBILE_NAV_MODULES_KEY)?.value
  );

  useEffect(() => {
    const customLogo = systemSettings.find((s) => String(s.key) === 'department_logo_url')?.value;
    updateRuntimePwaIcons(customLogo, departmentName);
  }, [systemSettings, departmentName]);

  // Crew member directory for administrative tools.
  const nameDirectory = users.length > 0 ? users : roster;

  useEffect(() => {
    // Loads core data when the app initializes.
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

  // The chief's five lines for the runner's boss level, derived rather than stored: MEMOISED because ...
  const bossSayings = useMemo(() => bossSayingsFrom(systemSettings), [systemSettings]);

// Helper to get a loading message (random from available ones, or default)
const getLoadingMessage = () => {
  const messages = loadingMessages.filter((msg) => msg.trim() !== '');
  if (messages.length === 0) return 'Communicating with server...';
  return messages[Math.floor(Math.random() * messages.length)];
};

// Reflect the department name in the browser tab title
  useEffect(() => {
    document.title = departmentName ? `${departmentName} StationSync` : 'StationSync';
  }, [departmentName]);

  // Dark mode: user_setting > system_setting > default (dark)
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

  // The page transition runs on the children of <main> (see index

  // Sounds
  useEffect(() => installUiSoundListeners(), []);

  // Which setting wins is the usual ladder - the member's own choice, else the station default, else ...
  const soundsActive = soundsActiveFrom(
    currentUserSettings?.[SOUNDS_SETTING_KEY],
    systemSettings.find((s) => String(s?.key ?? '').trim() === SOUNDS_SETTING_KEY)?.value ?? SOUNDS_DEFAULT
  );
  useEffect(() => {
    setSoundsEnabled(soundsActive);
  }, [soundsActive]);

  // Push notifications are also surfaced in-app
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !currentUser) return undefined;

    const handlePushMessage = (event) => {
      const message = event.data;
      if (!message || message.type !== 'PUSH_RECEIVED') return;
      // Hidden tabs would just swallow the toast; the OS notification has it covered
      if (document.visibilityState !== 'visible') return;

      // Shows toast notification popups on screen.
      notificationToast(message.title || 'StationSync', { description: message.body || '' });
    };

    navigator.serviceWorker.addEventListener('message', handlePushMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handlePushMessage);
  }, [currentUser]);

  // Handles clock in and clock out actions.
  useEffect(() => {
    if (!currentUser) return;
    setIsClockedIn(onDutyUsers.some((row) => String(row.id ?? row.user_id) === String(currentUser.id)));
  }, [currentUser, onDutyUsers]);

  const loadAppData = async () => {
    try {
      // Only public/config data is fetched pre-login
      await refreshAdminData();
    } catch {
      setStatusMessage({ type: 'error', text: 'Failed to connect to backend server.' });
    } finally {
      setInitialLoading(false);
    }
  };

  // Opens the reauthentication modal instead of logging the user out
  const queueReauth = (retryAction = null) => {
    pendingActionRef.current = retryAction || null;
    setNeedsReauth(true);
  };

  // Opens that prompt only when the reply was about the session we are HOLDING
  const sessionExpired = (usedToken, retryAction = null, reply = null) => {
    if (unauthorizedIsStale(usedToken, tokenRef.current)) return false;

    // Stores the current authentication token in a ref.
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

  // The single way the session token changes
  const applyToken = (token) => {
    tokenRef.current = token;
    sessionStartedAtRef.current = token ? Date.now() : 0;
    setAuthToken(token);
  };

  // Refreshes every cache an admin screen reads, in one parallel wave
  const refreshAdminData = async (token = authToken) => {
    // ONE request, not nine
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
              // THE ONLY READ THE APP MAKES WITHOUT A SESSION, and it reads one document: the public settings the...
              const initial = await fetchInitialData();
              if (!initial) return REFRESH_FAILED;
              if (initial.userSettings) setUserSettings(initial.userSettings);
              if (initial.systemSettings) setSystemSettings(initial.systemSettings);
              return REFRESH_OK;
            }
          }
        ];

    // One toast per wave, with an id that is never reused, so a second wave (a save during sign-in, say...
    const waveId = nextWaveId();
    const report = createWaveReporter({
      label: 'Refreshing views',
      total: tasks.length,
      onProgress: (message) => toast.loading(message, { id: waveId }),
      onDone: (message) => toast.success(message, { id: waveId, duration: 2500 }),
    });
    // Says so BEFORE the request goes out
    report.start();

    try {
      // The count follows the tasks as they settle, WHETHER THEY SUCCEEDED OR NOT - which is why the wave...
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

  // WHERE A SECTION LANDS WHEN IT COMES BACK ON ITS OWN: the same setters the full payload uses, so a...
  const ADMIN_SECTION_SETTERS = {
    users: setUsers,
    directory: setDirectory,
    roles: setRoles,
    ranks: setRanks,
    shifts: setShifts,
    // THE SCHEDULE SECTION ANSWERS WITH ITS ROWS *AND* THE WINDOW THEY CAME IN - one shape for the serv...
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
    trainings: (payload) => {
      const rows = Array.isArray(payload) ? payload : payload?.trainings;
      if (Array.isArray(rows)) setTrainings(rows);
      const signatures = payload?.signatures || payload?.trainingSignatures;
      if (Array.isArray(signatures)) setAdminTrainingSignatures(signatures);
    },
  };

  // AFTER A SAVE, re-read only what that save could have changed
  const refreshAdminCollections = async (names, token = authToken) => {
    const list = Array.isArray(names) ? names : [names].filter(Boolean);
    if (list.includes('workOrders') || list.includes('work-orders')) {
      void refreshWorkOrders(token);
    }
    const wanted = list
      .filter(Boolean)
      .filter((name) => ADMIN_SECTION_SETTERS[name]);
    if (!wanted.length) {
      if (canViewWorkOrders || canManageWorkOrders) void refreshWorkOrders(token);
      return refreshAdminData(token);
    }
    const rosterSections = ['users', 'certificationSetup', 'certificationRecords'];
    const invalidateRoster = () => {
      if (wanted.some((name) => rosterSections.includes(name))) {
        setRosterModuleCache(null);
        // Member roster information for shift assignments.
        setRosterLoadedFor('');
      }
    };

    try {
      const data = await fetchAdminSections(wanted);
      wanted.forEach((name) => ADMIN_SECTION_SETTERS[name](data[name]));
      invalidateRoster();
      // The `schedule` section carries its own window and its setter records it (see ADMIN_SECTION_SETTER...
      return REFRESH_OK;
    } catch (err) {
      console.error(`[refresh] could not re-read ${wanted.join(', ')}, so the whole payload is being read instead`, err);
      invalidateRoster();
      return refreshAdminData(token);
    }
  };

  // A WINDOW of the schedule the sign-in did not carry, for a screen that navigated to it: a month fu...
  const scheduleSentinel = useRef({ version: null, from: '', to: '', at: 0 });
  const [scheduleLoadedAt, setScheduleLoadedAt] = useState(0);
  // The loader as of THIS render, for the listeners that were registered on an earlier one
  const scheduleReloadRef = useRef(null);

  // Reloads the schedule view for the active date range.
  const refreshSchedule = () => {
    const { from, to } = scheduleSentinel.current;
    if (from || to) void scheduleReloadRef.current?.(from, to);
  };

  const loadScheduleWindow = async (from, to) => {
    scheduleReloadRef.current = loadScheduleWindow;
    try {
      // WHAT THE SCREENS LAST ASKED FOR, remembered so the sentinel can read exactly that window again wh...
      scheduleSentinel.current.from = from;
      scheduleSentinel.current.to = to;
      const data = await fetchScheduleWindow(from, to, authToken);
      // THE WINDOW LANDED, which is the only moment "updated" means anything
      scheduleSentinel.current.at = Date.now();
      setScheduleLoadedAt(scheduleSentinel.current.at);
      const rows = data && Array.isArray(data.schedule) ? data.schedule : [];
      setSchedule((prev) => replaceRowsInRange(prev, rows, from, to));
      // The window grows to cover what was just read, so the same month is never asked for twice
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
      // null, not []: an empty month is a real answer, and the board seeds from it - a failed read must n...
      return null;
    }
  };

  // LIVE READS (services/liveReads
  useEffect(() => {
    const onVisibilityChanged = () => {
      if (document.visibilityState !== 'visible') {
        scheduleSentinel.current.hiddenAt = Date.now();
        return;
      }
      const hiddenAt = scheduleSentinel.current.hiddenAt || 0;
      scheduleSentinel.current.hiddenAt = 0;
      const { from, to } = scheduleSentinel.current;
      if (!from && !to) return;
      const hiddenMs = hiddenAt ? Date.now() - hiddenAt : 0;
      if (!shouldRefreshOnReturn({ hiddenMs, atMs: scheduleSentinel.current.at })) return;
      void scheduleReloadRef.current?.(from, to);
    };
    document.addEventListener('visibilitychange', onVisibilityChanged);
    return () => document.removeEventListener('visibilitychange', onVisibilityChanged);
  }, []);

  useEffect(() => {
    const userId = currentUser?.id ? String(currentUser.id) : '';
    if (!userId || !firebaseConfigured()) return undefined;
    const stop = subscribeLive({
      userId,
      handlers: {
        onDuty: setOnDutyUsers,
        announcements: setAnnouncements,
        systemSettings: setSystemSettings,
        // Handles clock in and clock out actions.
        scheduleVersion: (row) => {
          const version = Number((row && row.version) || 0);
          const changed = sentinelChanged({ version, seen: scheduleSentinel.current.version });
          scheduleSentinel.current.version = version;
          if (!changed) return;
          const { from, to } = scheduleSentinel.current;
          if (from || to) void loadScheduleWindow(from, to);
        },
      },
      // A listener that fails must not throw into a render: it is logged, the last data stays on screen, ...
      onError: (error) => console.warn('[live] a live read could not be kept open:', error && error.message),
    });
    return stop;
  }, [currentUser?.id]);

  // When network reconnects (or when a backgrounded tab returns to visible on a mobile browser), re-sync on-duty
  useEffect(() => {
    if (!currentUser?.id || !authToken) return undefined;
    const resyncOnDuty = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine && tokenRef.current) {
        void refreshOnDuty(tokenRef.current);
      }
    };
    const checkStationMetadataFreshness = () => {
      const cached = readStationMetaCache();
      if (isStationMetaStale(cached?.savedAt) && typeof navigator !== 'undefined' && navigator.onLine && tokenRef.current) {
        if (canAdminister) {
          void refreshAdminCollections(['roles', 'ranks', 'shifts'], tokenRef.current);
        }
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        resyncOnDuty();
        checkStationMetadataFreshness();
      }
    };
    window.addEventListener('online', resyncOnDuty);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('online', resyncOnDuty);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [currentUser?.id, authToken, canAdminister]);

  // Sets up live data listeners for instant updates.
  const onScheduleBoard = activeTab === 'admin' && adminSubTab === 'schedule';
  // 
  const onMemberAvailabilityTab = activeTab === 'admin' && adminSubTab === 'availability';
  const wantsEvents =
    activeTab === 'schedule' || activeTab === 'availability' || onScheduleBoard || onMemberAvailabilityTab;
  useEffect(() => {
    if (!authToken || !currentUser?.id || !wantsEvents) return;
    const stop = subscribeLive({
      userId: currentUser.id,
      handlers: { events: (rows) => setEvents(normalizeEventList(rows)) },
      onError: (error) => console.warn('[live] the events read could not be kept open:', error && error.message),
    });
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, currentUser?.id, wantsEvents]);

  // Handles clock in and clock out actions.
  const [scheduleSetupLoaded, setScheduleSetupLoaded] = useState(false);
  // The screens of a member's own that draw a shift or label an entry with one
  const wantsScheduleSetup = activeTab === 'schedule' || activeTab === 'clock-history' || activeTab === 'dashboard';
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

  // THE ADMINISTRATION MODULE'S TWO LARGE READS ARRIVE WITH THEIR OWN TABS, not with the module
  const [adminSectionLoaded, setAdminSectionLoaded] = useState({});
  useEffect(() => {
    if (!authToken || activeTab !== 'admin') return;
    // Handles clock in and clock out actions.
    const sectionsForTab = {
      // THE MENU PAGE (an empty sub-tab - it is what Administration opens on now) reads the ONE small thi...
      '': allowedAdminTabs(currentUserRole).includes('approvals') ? ['scheduleOffers'] : [],
      // Crew member directory for administrative tools.
      schedule: ['schedule', 'scheduleTemplates', 'assignments', 'scheduleOffers', 'directory'],
      templates: ['scheduleTemplates', 'assignments'],
      assignments: ['assignments', 'scheduleTemplates', 'directory'],
      approvals: ['scheduleOffers', 'directory', 'schedule', 'scheduleTemplates', 'assignments'],
      clock: ['shifts', 'directory'],
      users: ['users'],
      certifications: ['certificationRecords', 'directory'],
      // Crew member directory for administrative tools.
      availability: ['directory', 'scheduleTemplates', 'assignments'],
      // Crew member directory for administrative tools.
      documents: ['directory'],
      announcements: ['directory'],
      events: ['directory'],
      training: ['trainings', 'directory'],
      'work-orders': ['directory', 'roles'],
      equipment: ['directory'],
      apparatus: ['directory'],
      'asset-setup': ['directory'],
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

  // Handles clock in and clock out actions.
  const [adminModuleOpened, setAdminModuleOpened] = useState(false);
  // Whether that first read has come back - so the module draws a spinner rather than a panel full of...
  const [adminWaveSettled, setAdminWaveSettled] = useState(false);
  useEffect(() => {
    // Checks if the user has permission to view administration tabs.
    if (activeTab === 'admin' && canAdminister && adminSubTab) setAdminModuleOpened(true);
  }, [activeTab, canAdminister, adminSubTab]);

  // Refresh all admin-scoped data for an administrator - ONCE THE MODULE HAS BEEN OPENED, not at sign...
  useEffect(() => {
    if (!isAdmin || !authToken || !adminModuleOpened) return;

    void refreshAdminData(authToken).finally(() => setAdminWaveSettled(true));
    // The effect is keyed on WHEN the module opened, not on the refresher's identity: refreshAdminData ...
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, isAdmin, adminModuleOpened]);

  // Opens the reauthentication modal instead of logging the user out
  const applyBootstrap = (data) => {
    // The certification icons beside every member's name, and the warnings for the signed-in member
    if (data.certificationBadges) setCertificationBadges(data.certificationBadges);
    if (data.certificationAlerts) setCertificationAlerts(data.certificationAlerts);
    if (data.certificationSetup) setCertificationSetup(data.certificationSetup);
    // Only present for a role that may manage certifications - see adminBootstrapPayload
    if (data.certificationRecords) setCertificationRecords(data.certificationRecords);
    if (data.schedule) setSchedule(data.schedule);
    // Tracks the currently loaded date range for the schedule.
    if (data.schedule_window) setScheduleWindow(data.schedule_window);
    if (data.availability) setAvailability(data.availability);
    // Shift availability templates and date boundaries.
    if (data.availabilityWindows) setAvailabilityWindows(data.availabilityWindows);
    if (data.availability_window) setAvailabilityScope(data.availability_window);
    if (data.roster) setRoster(data.roster);
    if (data.offers) setOffers(data.offers);
    if (data.trainings) setTrainings(data.trainings);
    if (data.signatures) setTrainingSignatures(data.signatures);
    if (data.announcements) setAnnouncements(data.announcements);
    if (data.events) setEvents(normalizeEventList(data.events));
    // Handles clock in and clock out actions.
    if (data.onDuty) setOnDutyUsers(data.onDuty);
    if (!isAdmin && data.assignments) setAssignments(data.assignments);
    if (!isAdmin && data.scheduleTemplates) setScheduleTemplates(data.scheduleTemplates);
    // Handles clock in and clock out actions.
    if (data.userSettings) setUserSettings(data.userSettings);
    if (data.roles) setRoles(data.roles);
    if (data.ranks) setRanks(data.ranks);
    if (data.shifts) setShifts(data.shifts);
    if (data.systemSettings) setSystemSettings(data.systemSettings);
  };

  const applyAdminBootstrap = (data) => {
    // The member half rides along in the same payload: one request, one apply, no chance of the two hal...
    applyBootstrap(data);
    if (data.users) setUsers(data.users);
    if (data.scheduleTemplates) setScheduleTemplates(data.scheduleTemplates);
    if (data.assignments) setAssignments(data.assignments);
    if (data.scheduleOffers) setAdminOffers(data.scheduleOffers);
    if (data.adminTrainingSignatures) setAdminTrainingSignatures(data.adminTrainingSignatures);
  };

  // The signed-in member's own shift offers (pending/approved/declined) - what the My Schedule pills ...
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

  const refreshWorkOrders = useCallback(async (token = authToken) => {
    if (!token) return;
    try {
      const data = await fetchWorkOrders(token);
      if (data && data.code === 'UNAUTHORIZED') {
        sessionExpired(token);
        return;
      }
      if (data && data.workOrders) {
        setWorkOrders(data.workOrders);
      }
    } catch (err) {
      console.warn('Failed to fetch work orders:', err);
    }
  }, [authToken]);

  // Handles clock in and clock out actions.
  const [logsScope, setLogsScope] = useState(null);

  // Loading a range GROWS what is held rather than replacing it: the screen can ask for an older year...
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

  // Configures pay period dates for the timeclock history.
  const payPeriod = payPeriodConfig(systemSettings);
  const logsWindow = payPeriodWindow(payPeriod, stationTodayKey());

  // Handles clock in and clock out actions.
  useEffect(() => {
    setCalendarWeekStart(payPeriod.weekStart);
  }, [payPeriod.weekStart]);

  // Handles clock in and clock out actions.
  useEffect(() => {
    const wantsTheHistory = activeTab === 'clock-history' || (activeTab === 'admin' && adminSubTab === 'clock');
    if (!wantsTheHistory || !authToken || logsScope) return;
    void loadLogs(logsWindow.from, logsWindow.to).catch((error) => {
      console.error('[logs] could not load the clock history', error);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, adminSubTab, authToken, logsScope]);

  const refreshLogs = async (token = authToken) => {
    // Handles clock in and clock out actions.
    if (!logsScope) return REFRESH_OK;
    try {
      const data = await fetchTimeclockLogs(token, { from: logsScope.from, to: logsScope.to });
      if (data && data.code === 'UNAUTHORIZED') {
        sessionExpired(token);
        return REFRESH_EXPIRED;
      }
      // Handles clock in and clock out actions.
      if (data && data.logs) {
        setLogs((prev) => replaceRowsInRange(prev, data.logs, logsScope.from, logsScope.to, 'time_in'));
      }
      return REFRESH_OK;
    } catch (err) {
      console.error('Failed to update logs', err);
      return REFRESH_FAILED;
    }
  };

  // Handles clock in and clock out actions.
  const applyClockOutcome = (clockedIn) =>
    setOnDutyUsers((current) => {
      const mine = String(currentUser?.id ?? '');
      if (!mine) return current;
      const withoutMe = current.filter((row) => String(row.id ?? row.user_id) !== mine);
      if (!clockedIn) return withoutMe;
      const alreadyDrawn = current.find((row) => String(row.id ?? row.user_id) === mine);
      return [
        ...withoutMe,
        alreadyDrawn || { id: mine, user_id: mine, name: currentUser?.name || '', rank_id: currentUser?.rank_id || '' },
      ];
    });

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
      setAdminSectionLoaded((prev) => (prev.trainings ? { ...prev, trainings: false } : prev));
      return REFRESH_OK;
    } catch (err) {
      console.error('Failed to refresh training data:', err);
      return REFRESH_FAILED;
    }
  };

  // Crew availability submissions loaded for administrators.
  const loadRosterAvailability = async (from, to) => {
    try {
      const data = await adminFetchAvailability(authToken, { from, to });
      if (data && data.code === 'UNAUTHORIZED') {
        sessionExpired(authToken);
        return REFRESH_EXPIRED;
      }
      if (data && data.availability) {
        const rows = Array.isArray(data.availability) ? data.availability : [];
        const fromStr = String(from || '');
        const toStr = String(to || '');
        setRosterAvailability((prev) =>
          fromStr && toStr
            ? [
                ...(prev || []).filter((row) => {
                  const day = String(row?.date_from || '').slice(0, 10);
                  return day < fromStr || day > toStr;
                }),
                ...rows,
              ]
            : rows
        );
      }
      setRosterScope({ from: String(from || ''), to: String(to || '') });
      if (data && data.availability_window) setRosterScope(data.availability_window);
      return REFRESH_OK;
    } catch (err) {
      console.error('Failed to load the crew availability', err);
      return REFRESH_FAILED;
    }
  };

  // The member's own claims, over a range
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
      if ((isAdmin || can('can_edit_member_availability')) && (scope.from || rosterScope?.from)) {
        const rFrom = scope.from || rosterScope?.from;
        const rTo = scope.to || rosterScope?.to;
        if (rFrom && rTo) {
          void loadRosterAvailability(rFrom, rTo);
        }
      }
      return REFRESH_OK;
    } catch (err) {
      console.error('Failed to update availability', err);
      return REFRESH_FAILED;
    }
  };

  // Handles clock in and clock out actions.
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
    // The claims for this quarter are already in hand once a scope has been set; the button in the grid...
    if (availabilityScope.from) return;
    const from = toDateKey(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1));
    const to = toDateKey(new Date(new Date().getFullYear(), new Date().getMonth() + 2, 0));
    void refreshAvailability(authToken, { from, to });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, activeTab, windowsLoaded, availabilityScope.from]);

  // Shift coverage requests and trade offers.
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

  // THE TRAINING CATALOGUE AND THIS MEMBER'S SIGNATURES, read once when that module is opened - by a ...
  const [trainingLoaded, setTrainingLoaded] = useState(false);
  useEffect(() => {
    if (!authToken || trainingLoaded) return;
    // THE MEMBER'S Training screen, or the ADMINISTRATION one - and for the officer it waits for that T...
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

  // Work orders list for member module and administration badge/tab
  useEffect(() => {
    if (!authToken) return;
    if (!canViewWorkOrders && !canManageWorkOrders) return;
    void refreshWorkOrders(authToken);
  }, [authToken, canViewWorkOrders, canManageWorkOrders, refreshWorkOrders]);

  // THE DOCUMENTS MODULE'S MEMBER LIST, read when that module is open and the reader is somebody who ...
  useEffect(() => {
    if (!authToken || activeTab !== 'documents') return;
    if (directory.length) return;
    if (!canVerifyDocuments && !canAddAssessmentScores) return;
    let cancelled = false;
    fetchAdminSections(['directory'])
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data?.directory)) setDirectory(data.directory);
      })
      .catch((error) => console.error('[documents] could not read the member directory', error));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, activeTab, canVerifyDocuments, canAddAssessmentScores, directory.length]);

  // Crew member directory for administrative tools.
  const documentsMembers = directory.length ? directory : users;

  // Handles clock in and clock out actions.
  useEffect(() => {
    if (!authToken || rosterLoaded) return;
    if (activeTab !== 'schedule' && activeTab !== 'admin') return;
    let cancelled = false;
    fetchRoster(authToken)
      .then((data) => {
        if (cancelled || !data || !Array.isArray(data.roster)) return;
        setRoster(data.roster);
        // The badge index comes with it: the screens that draw a name draw the icons beside it (components/...
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

  // THE BADGE INDEX FOR THE NAMES ON THIS SCREEN - and only those
  const badgeTargets = useMemo(() => {
    const ids = new Set();
    // The sidebar shows the signed-in member's own badges on EVERY screen, so this one is always wanted
    if (currentUser?.id) ids.add(String(currentUser.id));
    // The dashboard draws whoever is on duty, which is a live list that changes as shifts are worked
    if (activeTab === 'dashboard') onDutyUsers.forEach((user) => user?.id && ids.add(String(user.id)));
    return [...ids];
  }, [currentUser?.id, activeTab, onDutyUsers]);

  useEffect(() => {
    if (!authToken || !badgeTargets.length) return;
    // Only the ones with no answer yet
    const wanted = badgeTargets.filter((id) => !certificationBadgesLoaded(id));
    if (!wanted.length) return;

    let cancelled = false;
    fetchCertificationBadges(wanted, authToken)
      .then((data) => {
        if (cancelled || !data?.success) return;
        // Merged, never replaced - see utils/certifications
        const badges = { ...(data.badges || {}) };
        // The members ASKED ABOUT are known even when they have no document, which is how the two states st...
        (data.asked || wanted).forEach((id) => {
          if (!badges[id]) badges[id] = [];
        });
        mergeCertificationBadges(badges);
        // STILL not React state here - the index is a module registry read through a subscription (utils/ce...
      })
      .catch((error) => console.error('[badges] could not read the certification badges', error));
    return () => {
      cancelled = true;
    };
  }, [authToken, badgeTargets]);

  // the windows tab beside it - and scoped to the months around today, which is what those screens show
  useEffect(() => {
    // THE SCREENS THAT DRAW THE WHOLE CREW
    const wantsRoster =
      activeTab === 'admin' && (adminSubTab === 'availability' || adminSubTab === 'availability-windows');
    if (!wantsRoster || !authToken) return;
    const from = toDateKey(new Date(new Date().getFullYear(), new Date().getMonth() - 3, 1));
    const to = toDateKey(new Date(new Date().getFullYear(), new Date().getMonth() + 4, 0));

    // Handles clock in and clock out actions.
    if (!windowsLoaded) {
      adminFetchAvailabilityWindows(authToken)
        .then((data) => {
          if (!data || !Array.isArray(data.availabilityWindows)) return;
          setAvailabilityWindows(data.availabilityWindows);
          setWindowsLoaded(true);
        })
        .catch((error) => console.error('[availability] could not read the windows for the officer screens', error));
    }

    // SKIPPED ONLY WHEN THIS RANGE IS ALREADY HELD - which is not the same as "a read has happened"
    if (rosterScope.from && rosterScope.from <= from && rosterScope.to >= to) return;
    void loadRosterAvailability(from, to).catch((error) => {
      console.error('[availability] could not load the crew availability', error);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, adminSubTab, authToken, windowsLoaded, rosterScope.from, rosterScope.to]);

  // Loading another month for a screen that navigated outside the scope it holds
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

  // Handles clock in and clock out actions.
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

    // One line each, and only when something did not load on the first attempt: this is the difference ...
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
        // Signed in to the app: now sign in to Firebase with the same credentials, so the features already ...
        await signInAlongside(username, password);
        setCurrentUser(result.user);
        applyToken(result.token);
        // A REAL SIGN-IN HAPPENED, which is what the welcome waits for: the click that submitted this form ...
        setSignInCount((count) => count + 1);

        // Only the first screen's data blocks the overlay now - see the note on loadPostLoginData
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

  // If the signed-in role cannot use the tab that is open - because an admin edited the role mid-sess...
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
                  : activeTab === 'district-map'
                    ? canViewMap
                    : activeTab === 'roster'
                      ? canViewRoster
                      : activeTab === 'reports'
                        // Reports and Forms share one tab id now, so this is the same OR the sidebar and the prefetch use
                        ? canViewReports || canGenerateForms
                        : activeTab === 'work-orders'
                          ? canViewWorkOrders
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
    canViewMap,
    canViewRoster,
    canViewReports,
    canGenerateForms,
    canViewWorkOrders,
  ]);

  const handleLogout = () => {
    pendingActionRef.current = null;
    setNeedsReauth(false);
    setReauthReason(null);
    setCurrentUser(null);
    applyToken(null);

    // Signs the user out and clears session state.
    void signOutAlongside();

    setIsSidebarOpen(false);
    setActiveTab('dashboard');
    setAdminSubTab('');
    // Notice shown when clocking in outside allowed station radius.
    setClockNotice(null);
    setStatusMessage({ type: '', text: '' });
    // Resets session sound volumes from Debug settings.
    resetSoundVolumes();
  };

  // Every navigation through the sidebar or dashboard widgets
  const handleSidebarNavigate = (tab, subTab = '', options = null) => {
    const targetTab = tab === 'administration' ? 'admin' : tab;
    if (targetTab === 'admin') {
      setAdminSubTab(subTab || '');
    }
    const resolvedOpts = typeof options === 'object' && options !== null ? options : {};
    if (resolvedOpts.workOrderId || resolvedOpts.initialWorkOrderId || resolvedOpts.initialWorkOrder) {
      setInitialWorkOrderId(resolvedOpts.workOrderId || resolvedOpts.initialWorkOrderId || resolvedOpts.initialWorkOrder?.id || null);
      setInitialWorkOrder(resolvedOpts.initialWorkOrder || null);
    } else {
      setInitialWorkOrderId(null);
      setInitialWorkOrder(null);
    }
    setActiveTab(targetTab);
  };

  // Ends the session with an explanation, which is the only difference from a normal sign-out
  const endSession = useCallback((message) => {
    pendingActionRef.current = null;
    setNeedsReauth(false);
    setReauthReason(null);
    setCurrentUser(null);
    applyToken(null);

    // Signs the user out and clears session state.
    void signOutAlongside();

    setIsSidebarOpen(false);
    setActiveTab('dashboard');
    applyIdleWarning(null);
    // Notice shown when clocking in outside allowed station radius.
    setClockNotice(null);
    setStatusMessage(message ? { type: 'error', text: message } : { type: '', text: '' });
    resetSoundVolumes();
  }, [applyIdleWarning]);

  // The idle timer.
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
      // Tracks inactivity countdown to sign out idle users.
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

  // The Auth SDK's account, watched - because the app and the SDK each hold the same session, and onl...
  useEffect(() => {
    if (!currentUser) return undefined;
    let opening = true;
    return watchAccount((account) => {
      const isOpeningReport = opening;
      opening = false;
      if (isOpeningReport) return;
      if (!accountChangeEndsSession(currentUser, account)) return;
      endSession(SESSION_ENDED_MESSAGE);
    });
  }, [currentUser, endSession]);

  // Handles clock in and clock out actions.
  const handleStaySignedIn = () => {
    lastActivityRef.current = Date.now();
    applyIdleWarning(null);
  };

  // Verifies credentials from the reauthentication modal and keeps the user in the app: session data ...
  const handleReauth = async (username, password) => {
    try {
      const result = await loginUser(username, password);

      if (!result.success) {
        return { success: false, message: result.message || 'Invalid username or password.' };
      }

      // The modal must confirm the same account - block silent profile switching
      if (currentUser && String(result.user.id) !== String(currentUser.id)) {
        return { success: false, message: 'Those credentials belong to a different account. Please use your own.' };
      }

      // The reauth exists because a session expired
      await signInAlongside(username, password);
      setCurrentUser(result.user);
      applyToken(result.token);

      const retry = pendingActionRef.current;
      pendingActionRef.current = null;

      if (retry) {
        // Handles clock in and clock out actions.
        await retry(result.token);
      } else {
        // Same split as a normal sign-in: only the first screen's data is awaited, so the modal closes prom...
        await loadPostLoginData(result.token);
        setStatusMessage({ type: 'success', text: 'Session verified. Welcome back!' });
      }

      // Admin-scoped data is left to the authToken effect (which fires as soon as setAuthToken lands above)

      // Keep the modal open if the awaited refresh or the replayed action hit the session wall again (a b...
      if (!pendingActionRef.current) {
        setNeedsReauth(false);
        // The reason described the prompt that has just closed; the next one brings its own
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
        const clockedIn = actionType === 'CLOCK_IN';
        setStatusMessage({
          type: 'success',
          text: `Successfully ${clockedIn ? 'Clocked In' : 'Clocked Out'}${coords.latitude ? ' with GPS location' : ''
            }!`,
        });
        // Shows toast notification popups on screen.
        toast.success(clockedIn ? 'Clocked in.' : 'Clocked out. Have a good one.');
        // Applied BEFORE the re-read, so the card flips on the action's own answer rather than on the refre...
        applyClockOutcome(clockedIn);
        await refreshLogs(token);
        await refreshOnDuty(token);
      } else if (result.code === 'UNAUTHORIZED') {
        // Handles clock in and clock out actions.
        sessionExpired(token, (freshToken) => performClockAction(actionType, coords, freshToken));
      } else if (result.code === OUT_OF_RANGE_CODE) {
        // Notice shown when clocking in outside allowed station radius.
        setClockNotice(
          clockLocationNotice({ allowed: false, code: OUT_OF_RANGE_CODE, message: result.message })
        );
      } else {
        const msg = String(result?.message || '');
        if (/already clocked in/i.test(msg)) {
          // The server confirmed the user is already on duty, but local state was out of sync (e
          applyClockOutcome(true);
          toast.info('You are already clocked in. Updated status to On Duty.');
          void refreshLogs(token);
          void refreshOnDuty(token);
        } else if (/not clocked in|already clocked out|already closed/i.test(msg)) {
          // Handles clock in and clock out actions.
          applyClockOutcome(false);
          toast.info('You are already clocked out. Updated status to Off Duty.');
          void refreshLogs(token);
          void refreshOnDuty(token);
        } else {
          setStatusMessage({ type: 'error', text: result.message || 'Action failed.' });
          toast.error(result.message || 'Action failed.');
        }
      }
    } catch {
      setStatusMessage({ type: 'error', text: 'Network error submitting shift update.' });
    } finally {
      setGlobalLoading({ active: false, message: '' });
    }
  };

  const handleClockAction = async (actionType) => {
    setStatusMessage({ type: '', text: '' });
    // Notice shown when clocking in outside allowed station radius.
    setClockNotice(null);

    // Handles clock in and clock out actions.
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

      // Handles clock in and clock out actions.
      const locationCheck = evaluateClockLocation(coords, clockLocationConfig(systemSettings));
      if (!locationCheck.allowed) {
        // A modal, not the status banner: the banner is only rendered on the login screen, and a
        // refusal is the answer to the button the member just pressed. See ClockBlockedModal.
        // It specifically does not write to statusMessage here because signed-in members cannot see it.
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

  // Push-device registration, handed to the settings card as ONE object rather than three callbacks, ...
  const pushDeviceApi = useMemo(
    () => ({
      register: (deviceToken, deviceLabel, options) => registerPushDevice(deviceToken, deviceLabel, authToken, options),
      unregister: (deviceToken) => unregisterPushDevice(deviceToken, authToken),
      // My devices AND whose this browser is, in one call
      status: (deviceToken) => fetchMyPushDevices(authToken, deviceToken),
    }),
    [authToken]
  );

  const handleSaveUserSettings = async (updatedSettings) => {
    try {
      // Call API service wrapper instead of raw fetch
      const result = await saveUserSettings(updatedSettings, authToken);

      if (result && result.success) {
        // Optimistically update React state so UI reflects changes immediately
        setUserSettings((prevSettings) => {
          const targetId = String(updatedSettings.id);
          const exists = prevSettings.some(
            (s) => String(s.id || s.user_id) === targetId
          );

          const changed = {};
          [
            'time_format',
            'is_dark_mode',
            'hide_events_by_default',
            'colorblind_rank_labels',
            'font_scale',
            'dashboard_layout',
            // Missing from this list means the optimistic merge drops it, so the switch would appear not to sti...
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

  // Applies a just-saved user row to the in-memory list straight away
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
    // An unknown collection is a programming error, not a silent no-op: nothing to merge means the scre...
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
        // The server clears the "must change it" flag as part of the save; clearing it here too is what clo...
        setCurrentUser((prev) => ({ ...prev, [MUST_CHANGE_PASSWORD_COLUMN]: 'FALSE' }));
      }
      return result;
    } catch {
      return { success: false, message: 'Network error updating password.' };
    } finally {
      setGlobalLoading({ active: false, message: '' });
    }
  };

  // Handles clock in and clock out actions.
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
    // The message is chosen once per boot on purpose: loadingMessages arriving later must not reshuffle...
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // THE STATION'S WELCOME, on every sign-in
  const [signInCount, setSignInCount] = useState(0);
  const welcomedSignInRef = useRef(0);
  useEffect(() => {
    if (!welcomeIsOwed({ signIns: signInCount, welcomed: welcomedSignInRef.current, ready: !initialLoading })) return;
    welcomedSignInRef.current = signInCount;
    playSound('intro_short');
  }, [signInCount, initialLoading]);

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
      <Toaster
        theme={isDarkMode ? 'dark' : 'light'}
        position="top-right"
        richColors
        closeButton
        offset="max(16px, calc(env(safe-area-inset-top, 0px) + 12px))"
        mobileOffset={{
          top: 'max(16px, calc(env(safe-area-inset-top, 0px) + 12px))',
          bottom: 'max(16px, calc(env(safe-area-inset-bottom, 0px) + 80px))',
        }}
      />

      {/* Floating banner alert when a new release is deployed */}
      <AppUpdateBanner />

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
        <LoginScreen
          onLogin={handleLogin}
          statusMessage={statusMessage}
          departmentName={departmentName}
          departmentLogoUrl={departmentLogo}
          isLoading={globalLoading.active}
        />
      ) : (
        <AuthProvider
          currentUser={currentUser}
          currentRole={currentUserRole}
          currentRank={currentUserRank}
          authToken={authToken}
          isAdmin={isAdmin}
          canAdminister={canAdminister}
          permissions={{
            canApproveShifts,
            canViewSchedule,
            canMakeOffers,
            canViewFullSchedule,
            canEditOwnAvailability,
            canUseTimeclock,
            canSignTrainings,
            canEditTrainings,
            canViewRoster,
            canUseChat,
            canVerifyDocuments,
            canAddAssessmentScores,
            canViewDocuments,
            canViewMap,
            canEditMap,
            canViewReports,
            canGenerateForms,
          }}
          onLogout={handleLogout}
        >
          <StationDataProvider
            ranks={ranks}
            roles={roles}
            shifts={shifts}
            systemSettings={systemSettings}
            departmentName={departmentName}
            departmentLogo={departmentLogo}
          >
            <div className="min-h-dvh bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100 flex flex-col md:flex-row md:h-dvh md:overflow-hidden md:overscroll-y-contain pb-[env(safe-area-inset-bottom)] md:pb-0">
          {/* The strip the iOS status bar sits on.
          // Handles clock in and clock out actions.
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
              below scrolls with the content, as it should. `z-[19]` keeps it just BELOW the status strip and
              the sidebar's backdrop (z-20) and drawer (z-30), so opening the menu dims the whole page
              including this bar - and just ABOVE the admin sub-menu bar (z-[15]), which is what keeps that
              menu sliding under this bar rather than over it. The whole ladder is written out on that bar,
              in AdminPanel.jsx, because it is only ever wrong as a whole. */}
          <header ref={topBarRef} className="md:hidden sticky top-0 z-[19] flex items-center justify-between bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4 pt-[calc(1rem_+_env(safe-area-inset-top))]">
            <div className="flex min-w-0 items-center gap-2">
              {/* The burst is placed off the anchor, so the anchor is the containing block. */}
              <a href="#" className="relative inline-flex items-center gap-2 shrink-0" onClick={(e) => {
                e.preventDefault();
                handleEasterEgg();
              }}>
                {/* The same lockup the desktop sidebar draws: the loops mark, then "Station" in the theme's text
                    color and "Sync" in the brand red. This used to be the full-logo image, whose wordmark is baked
                    blue - so on a phone the name read blue while the sidebar's read white-on-dark plus red. */}
                <img src={stationSyncLoopsUrl()} alt="StationSync" className="h-7 w-auto shrink-0 object-contain" />
                <span className="text-lg font-extrabold tracking-tight leading-none text-slate-800 dark:text-white">
                  Station<span className="bg-gradient-to-r from-red-500 to-red-600 bg-clip-text text-transparent">Sync</span>
                </span>
                <PixelBurst trigger={easterBurst} />
              </a>
              {departmentName ? (
                <div className="flex items-center min-w-0 border-l border-slate-200 dark:border-slate-700 pl-2">
                  <span
                    className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 truncate max-w-[140px]"
                    title={departmentName}
                  >
                    {departmentName}
                  </span>
                </div>
              ) : null}
            </div>
            {/* The current page, once its own heading has scrolled away. */}
            {showPageLabel && pageBarLabel(activeTab, adminSubTab) && (
              <div className="flex items-center min-w-0 pl-2 shrink-0">
                <span className="truncate text-sm font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700/60 px-2 py-1 rounded-lg border border-slate-200/60 dark:border-slate-600/50">
                  {pageBarLabel(activeTab, adminSubTab)}
                </span>
              </div>
            )}
          </header>

          <Sidebar
            currentUser={currentUser}
            isClockedIn={isClockedIn}
            departmentName={departmentName}
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
            canViewMap={canViewMap}
            canViewReports={canViewReports}
            canGenerateForms={canGenerateForms}
            canViewRoster={canViewRoster}
            canViewWorkOrders={canViewWorkOrders}
            canUseChat={canUseChat}
            ranks={ranks}
            systemSettings={systemSettings}
          />

          <main
            // `overscroll-y-contain` stops the desktop layout's inner scroll area from chaining its overscroll ...
            className={`flex-1 min-w-0 md:h-screen md:overflow-y-auto overscroll-y-contain p-4 sm:p-6 lg:p-8 page-enter pb-20 sm:pb-24 lg:pb-8 ${
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
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-3">
                {activeTab === 'dashboard' ? (
                  <img
                    src={departmentLogo || stationLogoUrl()}
                    alt={departmentName ? `${departmentName} Logo` : 'Department Logo'}
                    className="w-10 h-10 object-contain shrink-0"
                  />
                ) : null}
                <div>
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                    {activeTab === 'dashboard' && `Welcome, ${currentUser.name}`}
                    {activeTab === 'clock-history' && 'Clock History'}
                    {activeTab === 'roster' && 'Roster'}
                    {activeTab === 'schedule' && 'Schedule'}
                    {activeTab === 'availability' && 'Availability'}
                    {activeTab === 'training' && 'Training'}
                    {activeTab === 'certifications' && 'Certifications'}
                    {activeTab === 'district-map' && 'District Map'}
                    {activeTab === 'chat' && 'Chat'}
                    {activeTab === 'reports' && 'Reports & Forms'}
                    {activeTab === 'help' && 'Help'}
                    {activeTab === 'settings' && 'My Settings'}
                    {activeTab === 'profile' && 'User Profile'}
                    {activeTab === 'admin' && 'Administration'}
                  </h2>
                  <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
                    {activeTab === 'dashboard' && (
                      'Station overview, active clock status, and duty dashboard.'
                    )}
                    {activeTab === 'clock-history' && 'Review your previous clock-in entries, duration, and locations.'}
                    {activeTab === 'roster' && 'View active members, ranks, and current certifications.'}
                    {activeTab === 'schedule' && 'Review your assigned shifts, or switch on "Show everyone" to see the whole crew.'}
                    {activeTab === 'availability' && 'Mark the shifts you could work, and administrators will see it when they build the schedule.'}
                    {activeTab === 'training' && 'Sign off the trainings you attended. Administrators can see who has signed each one.'}
                    {activeTab === 'certifications' && 'The certifications the station has recorded for you, with their dates and where each one stands.'}
                    {activeTab === 'district-map' && 'The department\'s boundary drawing. Drag to move, pinch or scroll to zoom.'}
                    {activeTab === 'chat' && "The station's rooms, and your own line in them. It stays open over whatever else you are doing."}
                    {activeTab === 'reports' && 'Run reports, and generate printable forms, shared with your role or rank.'}
                    {activeTab === 'help' && 'Guides for using StationSync. Administrators have their own set under Administration → System → Help.'}
                    {activeTab === 'settings' && 'Customize your personal account preferences.'}
                    {activeTab === 'profile' && 'Manage your personal details, profile picture, certifications, and account settings.'}
                    {activeTab === 'admin' && 'Manage members, roles, ranks, and system settings.'}
                  </p>
                </div>
              </div>
              <div id="dashboard-header-actions" className="flex items-center gap-2 shrink-0 empty:hidden" />
              </div>
            </div>

            {/* One boundary for every deferred screen in the chain below (see utils/deferredModules.js). It adds
                no element of its own, so the layout above - and the flex rows on the Help screen - are untouched;
                while a chunk is in flight the fallback stands in. The page heading is deliberately OUTSIDE it, so
                the tab that is opening still names itself. */}
            <Suspense fallback={<DeferredScreenFallback />}>
            {activeTab === 'dashboard' && (
              <DashboardModule
                currentUser={currentUser}
                currentRole={currentUserRole}
                isClockedIn={isClockedIn}
                loading={globalLoading.active}
                offline={offline}
                onClockAction={handleClockAction}
                timeFormat={activeTimeFormat}
                canUseTimeclock={canUseTimeclock}
                certificationAlerts={certificationAlerts}
                announcements={announcements}
                announcementAudience={announcementAudience}
                onDutyUsers={onDutyUsers}
                ranks={ranks}
                schedule={schedule}
                scheduleWindow={scheduleWindow}
                onNeedSchedule={loadScheduleWindow}
                scheduleTemplates={scheduleTemplates}
                assignments={assignments}
                workOrders={workOrders}
                systemSettings={systemSettings}
                userSettings={currentUserSettings}
                onSaveUserSettings={handleSaveUserSettings}
                onNavigate={handleSidebarNavigate}
                token={authToken}
              />
            )}

            {activeTab === 'clock-history' && canUseTimeclock && (
              <MyClockHistory
                currentUser={currentUser}
                logs={logs}
                timeFormat={activeTimeFormat}
                shifts={shifts}
                // Handles clock in and clock out actions.
                systemSettings={systemSettings}
                // WHAT IS LOADED, so the screen can say so and offer to go further back
                loadedFrom={logsScope ? logsScope.from : ''}
                onLoadOlder={() => {
                  if (!logsScope || !logsScope.from) return undefined;
                  return loadLogs(payPeriodWindow(payPeriod, logsScope.from).from, logsScope.from);
                }}
                onBack={() => handleSidebarNavigate('dashboard')}
              />
            )}

            {activeTab === 'roster' && canViewRoster && (
              <RosterModule
                loading={rosterModuleLoading}
                error={rosterModuleError}
                // State for searching the member roster by name.
                search={rosterSearch}
                onSearch={setRosterSearch}
                loadingMore={rosterLoadingMore}
                page={rosterModuleCache && rosterModuleCache.token === authToken ? rosterModuleCache.data.roster_page || {} : {}}
                onLoadMore={() =>
                  loadRosterPage({
                    token: authToken,
                    search: rosterSearch,
                    cursor: (rosterModuleCache && rosterModuleCache.data && rosterModuleCache.data.roster_page
                      ? rosterModuleCache.data.roster_page.next_cursor
                      : '') || '',
                    append: true,
                  })
                }
                members={rosterModuleCache?.token === authToken ? rosterModuleCache.data.members || [] : []}
                ranks={ranks}
                certificationTypes={rosterModuleCache?.token === authToken ? rosterModuleCache.data.certificationTypes || [] : []}
                memberCertificationIds={rosterModuleCache?.token === authToken ? rosterModuleCache.data.memberCertificationIds || {} : {}}
              />
            )}

            {/* HOW OLD THE SCHEDULE IS, and the read. A sibling of the calendar rather than a prop into it: the two screens
                that draw a schedule (the calendar and the board) would each have to render it, and the condition below is
                repeated for the same reason - a fragment would need a parent element that neither screen wants. */}
            {activeTab === 'schedule' && canViewSchedule && (
              <ScheduleFreshness atMs={scheduleLoadedAt} onRefresh={refreshSchedule} />
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
                // Role permissions the calendar itself has to honor: who may offer to fill an open shift, and who m...
                canMakeOffers={canMakeOffers}
                canViewFullSchedule={canViewFullSchedule}
                // Non-shift entries, already audience-filtered by the server.
                events={events}
                eventAudience={announcementAudience}
                hideEventsByDefault={hideEventsByDefault}
                colorblindRankLabels={colorblindRankLabels}
                // Names the audience line in an event's detail popup (a role description rather than "#id")
                roles={roles}
                timeFormat={activeTimeFormat}
                // Used only on the printed sheet's header
                departmentName={departmentName}
                departmentLogoUrl={departmentLogo}
                // Re-reads the member's offers after a submit so the pill flips to "pending approval" immediately
                onOfferSubmitted={() => refreshOffers(authToken)}
              />
            )}

            {activeTab === 'availability' && canEditOwnAvailability && (
              <MyAvailability
                token={authToken}
                currentUser={currentUser}
                availability={availability}
                // Shift availability templates and date boundaries.
                windows={availabilityWindows}
                loadedFrom={availabilityScope.from}
                loadedTo={availabilityScope.to}
                onLoadMonth={loadAvailabilityMonth}
                ranks={ranks}
                timeFormat={activeTimeFormat}
                // Calendar events and station activities.
                events={events}
                eventAudience={announcementAudience}
                hideEventsByDefault={hideEventsByDefault}
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
                users={documentsMembers}
                canVerify={canVerifyDocuments}
                // Checks if user can record assessment test scores.
                canAddScores={canAddAssessmentScores}
                stationName={stationName}
                onNavigateToMap={(plan) => {
                  setMapTargetPreplanId(plan?.id || null);
                  setActiveTab('district-map');
                }}
              />
            )}

            {activeTab === 'training' && canSignTrainings && (
              <TrainingModule
                token={authToken}
                currentUser={currentUser}
                trainings={trainings}
                signatures={trainingSignatures}
                // The public settings, for the SIGNING WINDOW: a training can be signed for a configured number of ...
                systemSettings={systemSettings}
                canEdit={canEditTrainings}
                onChanged={refreshTraining}
              />
            )}

            {activeTab === 'profile' && (
              <UserProfile
                initialTab="profile"
                currentUser={currentUser}
                currentRole={currentUserRole}
                currentRank={currentUserRank}
                ranks={ranks}
                token={authToken}
                userSettings={userSettings}
                systemSettings={systemSettings.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {})}
                canApproveShifts={canApproveShifts}
                canManageWorkOrders={canManageWorkOrders}
                canUseChat={canUseChat}
                onSaveSettings={handleSaveUserSettings}
                onFontScalePreview={setFontScalePreview}
                pushDeviceApi={pushDeviceApi}
                onPasswordChange={handlePasswordChange}
              />
            )}

            {activeTab === 'certifications' && (
              <UserProfile
                initialTab="profile"
                currentUser={currentUser}
                currentRole={currentUserRole}
                currentRank={currentUserRank}
                ranks={ranks}
                token={authToken}
                userSettings={userSettings}
                systemSettings={systemSettings.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {})}
                canApproveShifts={canApproveShifts}
                canManageWorkOrders={canManageWorkOrders}
                canUseChat={canUseChat}
                onSaveSettings={handleSaveUserSettings}
                onFontScalePreview={setFontScalePreview}
                pushDeviceApi={pushDeviceApi}
                onPasswordChange={handlePasswordChange}
              />
            )}

            {/* The district map. Gated on can_view_map, which is also what firestore.rules checks on the read - so the
                tab, the sidebar entry and the data all answer to the same flag. The token is passed for the same reason
                every other module takes it: a new session is a new read. */}
            {activeTab === 'district-map' && canViewMap && (
              <DistrictMap
                token={authToken}
                canEdit={canEditMap}
                isDarkMode={isDarkMode}
                targetPreplanId={mapTargetPreplanId}
                onClearTargetPreplan={() => setMapTargetPreplanId(null)}
                stationName={stationName}
              />
            )}

            {/* Reports and Forms are one module behind one sidebar entry. Both screens are built here but only the one
                the member is looking at is RENDERED, which is what keeps each half its own chunk: an unrendered element
                is a description, not a fetch. See ReportsAndFormsModule for why. */}
            {activeTab === 'reports' && (canViewReports || canGenerateForms) && (
              <ReportsAndFormsModule
                canViewReports={canViewReports}
                canGenerateForms={canGenerateForms}
                reportsScreen={
                  <ReportsModule
                    departmentName={departmentName}
                    departmentLogoUrl={departmentLogo}
                    members={roster.length ? roster : users}
                  />
                }
                formsScreen={
                  <FormsModule
                    departmentName={departmentName}
                    departmentLogoUrl={departmentLogo}
                    currentUser={currentUser}
                    users={roster.length ? roster : users}
                    canPickMembers={can('can_administer_trainings')}
                  />
                }
              />
            )}

            {activeTab === 'work-orders' && canViewWorkOrders && (
              <WorkOrdersModule
                token={authToken}
                currentUser={currentUser}
                currentUserId={String(currentUser?.id ?? '')}
                currentUserName={currentUser?.name || currentUser?.full_name || currentUser?.user_name || ''}
                canManageWorkOrders={canManageWorkOrders}
                onNavigateToAdmin={() => {
                  setActiveTab('admin');
                  setAdminSubTab('work-orders');
                }}
                onChanged={refreshWorkOrders}
              />
            )}

            {activeTab === 'settings' && (
              <UserProfile
                initialTab="settings"
                currentUser={currentUser}
                currentRole={currentUserRole}
                currentRank={currentUserRank}
                ranks={ranks}
                token={authToken}
                userSettings={userSettings}
                systemSettings={systemSettings.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {})}
                canApproveShifts={canApproveShifts}
                canManageWorkOrders={canManageWorkOrders}
                canUseChat={canUseChat}
                onSaveSettings={handleSaveUserSettings}
                onFontScalePreview={setFontScalePreview}
                pushDeviceApi={pushDeviceApi}
                onPasswordChange={handlePasswordChange}
              />
            )}

            {activeTab === 'admin' && canAdminister && (
              <AdminPanel
                // THE MODULE'S DATA IS READ WHEN A SECTION IS CHOSEN (see the adminModuleOpened effect), so a tab c...
                loading={isAdmin && !!adminSubTab && !adminWaveSettled}
                // Used only on the printed schedule sheet's header
                departmentName={departmentName}
                colorblindRankLabels={colorblindRankLabels}
                // The open sub-tab is OWNED HERE: '' is the menu page, a tab id is that tab
                subTab={adminSubTab}
                onSelectTab={setAdminSubTab}
                // Lets the app bar name the open Administration tab ("Admin: Schedule Mgt")
                onActiveSubTabChange={setAdminSubTab}
                // Certifications: the catalog rides with every payload, the records only for a role that may manage...
                certificationSetup={certificationSetup}
                certificationRecords={certificationRecords}
                // Crew member directory for administrative tools.
                directory={directory}
                currentRole={currentUserRole}
                isAdmin={isAdmin}
                currentUserId={String(currentUser?.id ?? '')}
                currentUser={currentUser}
                currentUserName={currentUser?.name || currentUser?.full_name || currentUser?.user_name || ''}
                users={users}
                roles={roles}
                ranks={ranks}
                shifts={shifts}
                schedule={schedule}
                // Tracks the currently loaded date range for the schedule.
                scheduleWindowError={scheduleWindowError}
                onNeedSchedule={loadScheduleWindow}
                scheduleTemplates={scheduleTemplates}
                assignments={assignments}
                availability={availability}
                // Shift availability templates and date boundaries.
                availabilityWindows={availabilityWindows}
                rosterAvailability={rosterAvailability}
                rosterScope={rosterScope}
                onRosterMonth={loadRosterMonth}
                systemSettings={systemSettings}
                logs={logs}
                timeFormat={activeTimeFormat}
                token={authToken}
                // One callback for every admin save, SCOPED: `onDataChanged('ranks')` re-reads the ranks and nothin...
                onDataChanged={refreshAdminCollections}
                onAvailabilityChanged={refreshAvailability}
                onLogsChanged={refreshLogs}
                // Handles clock in and clock out actions.
                clockLogsFrom={logsScope ? logsScope.from : ''}
                onLoadOlderClockLogs={() => {
                  const fromKey = logsScope ? logsScope.from : stationTodayKey();
                  return loadLogs(payPeriodWindow(payPeriod, fromKey).from, fromKey);
                }}
                onAdminDataChanged={refreshAdminCollections}
                // A certification or setup save returns the rebuilt badge index
                onBadgesChanged={setCertificationBadges}
                // Calendar events and station activities.
                events={events}
                offers={adminOffers}
                trainings={trainings}
                trainingSignatures={adminTrainingSignatures}
                // Lets any admin tab show a saved row immediately instead of waiting for the background refresh wav...
                onRowSaved={applySavedRow}
                departmentLogoUrl={departmentLogo}
                workOrders={workOrders}
                initialWorkOrderId={initialWorkOrderId}
                initialWorkOrder={initialWorkOrder}
                onClearInitialWorkOrder={() => {
                  setInitialWorkOrderId(null);
                  setInitialWorkOrder(null);
                }}
              />
            )}

            {activeTab === 'runner' && (
              <FirefighterRunner
                width={800}
                height={280}
                initialSpeed={350}
                maxSpeed={900}
                // The leaderboard needs a session (the score is stored as a personal best on the signed-in member's...
                token={authToken}
                currentUser={currentUser}
                // Which sound set to play, chosen by an administrator on the Users tab.
                soundProfile={runnerSoundProfile}
                // Administrators get a hidden debug control that skips straight to the boss scene
                isAdmin={isAdmin}
                // What the boss level's floating head says between fireball blasts, from System Settings
                bossSayings={bossSayings}
              />
            )}
            </Suspense>

            {/* CHAT, ON EVERY TAB. It is mounted here rather than inside one of the tab blocks because it is not a tab -
                it is a panel over whatever the member is doing, so a message arriving while they are building a schedule
                still reaches them. `fullScreen` is the one exception: the Chat module IS this component at full width,
                which is why there is one implementation and not two. It renders nothing at all without `can_use_chat`. */}
            <ChatHost
              token={authToken}
              currentUser={currentUser}
              role={currentUserRole}
              timeFormat={activeTimeFormat}
              // The ranks, for the icon drawn before an author's name - the same array every other screen gets, l...
              ranks={ranks}
              fullScreen={activeTab === 'chat'}
              // Handles clock in and clock out actions.
              offline={offline}
              onUnreadChange={setUnreadChatCount}
            />
          </main>

          {/* Sticky mobile bottom navigation bar (< 768px) */}
          <MobileBottomNav
            activeTab={activeTab}
            onSelectTab={handleSidebarNavigate}
            onOpenMore={() => setIsSidebarOpen(true)}
            modules={mobileNavModules}
            canViewSchedule={canViewSchedule}
            canUseChat={canUseChat}
            canUseTimeclock={canUseTimeclock}
            canEditAvailability={canEditOwnAvailability}
            canViewRoster={canViewRoster}
            canSignTrainings={canSignTrainings}
            canViewDocuments={canViewDocuments}
            canViewMap={canViewMap}
            canViewReports={canViewReports}
            canGenerateForms={canGenerateForms}
            canAdminister={canAdminister}
            unreadChatCount={unreadChatCount}
          />
        </div>
          </StationDataProvider>
        </AuthProvider>
      )}
    </>
  );
}