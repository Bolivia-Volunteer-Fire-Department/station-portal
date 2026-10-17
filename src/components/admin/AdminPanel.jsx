import React, { useState, useRef, useEffect, useMemo, lazy, Suspense } from 'react';
import { Users, User, ShieldCheck, Award, Settings2, Map as MapIcon, CalendarClock, CalendarDays, CalendarCog, CalendarCheck, CalendarPlus, ChevronDown, Check, ListTodo, Clock, AlertCircle, Bell, BookOpen, BookText, GraduationCap, Megaphone, Book, Bug, BadgeCheck, ClipboardCheck, Repeat, Loader2, BarChart3, FileText, MessagesSquare, Compass, Package, ShieldAlert, Truck, SlidersHorizontal, LayoutDashboard, Boxes, Wrench } from 'lucide-react';
import AdminUsersTab from './AdminUsersTab';
import AdminDebugTab from './AdminDebugTab';
import HelpGuides from '../HelpGuides';
import { pendingOffersOnly } from '../../utils/shiftOfferRow';
import { fetchAdminDocumentVerificationSummary } from '../../services/api';
import { allowedAdminTabs, permissionGranted, shouldFocusApprovals } from '../../utils/permissions';
import { isActiveWorkOrder } from '../../utils/workOrders';
import AdminMenuPage from './AdminMenuPage';

const AdminRolesTab = lazy(() => import('./AdminRolesTab'));
const AdminRanksTab = lazy(() => import('./AdminRanksTab'));
const AdminScheduleTemplatesTab = lazy(() => import('./AdminScheduleTemplatesTab'));
const AdminAssignmentsTab = lazy(() => import('./AdminAssignmentsTab'));
const AdminAvailabilityTab = lazy(() => import('./AdminAvailabilityTab'));
const AdminAvailabilityWindowsTab = lazy(() => import('./AdminAvailabilityWindowsTab'));
const AdminScheduleManagementTab = lazy(() => import('./AdminScheduleManagementTab'));
const AdminSystemSettingsTab = lazy(() => import('./AdminSystemSettingsTab'));
const AdminNavigationSetupTab = lazy(() => import('./AdminNavigationSetupTab'));
const AdminMapSettingsTab = lazy(() => import('./AdminMapSettingsTab'));
const AdminClockManagementTab = lazy(() => import('./AdminClockManagementTab'));
const AdminPendingApprovalsTab = lazy(() => import('./AdminPendingApprovalsTab'));
const AdminNotificationsTab = lazy(() => import('./AdminNotificationsTab'));
const AdminTrainingTab = lazy(() => import('./AdminTrainingTab'));
const AdminCertificationsTab = lazy(() => import('./AdminCertificationsTab'));
const AdminCertificationSetupTab = lazy(() => import('./AdminCertificationSetupTab'));
const AdminAnnouncementsTab = lazy(() => import('./AdminAnnouncementsTab'));
const AdminChatTab = lazy(() => import('./AdminChatTab'));
const AdminDocumentsTab = lazy(() => import('./AdminDocumentsTab'));
const AdminEventsTab = lazy(() => import('./AdminEventsTab'));
const AdminReportsConfigurationTab = lazy(() => import('./AdminReportsConfigurationTab'));
const AdminFormsTab = lazy(() => import('./AdminFormsTab'));
const AdminEquipmentTab = lazy(() => import('./AdminEquipmentTab'));
const AdminApparatusTab = lazy(() => import('./AdminApparatusTab'));
const AdminAssetSetupTab = lazy(() => import('./AdminAssetSetupTab'));
const AdminDashboardSetupTab = lazy(() => import('./AdminDashboardSetupTab'));
const AdminWidgetSetupTab = lazy(() => import('./AdminWidgetSetupTab'));
const AdminWorkOrdersTab = lazy(() => import('./AdminWorkOrdersTab'));

function AdminTabLoading() {
  return (
    <div className="flex items-center justify-center py-16 text-slate-400">
      <Loader2 className="w-6 h-6 animate-spin text-red-600" />
      <span className="ml-3 text-sm font-medium text-slate-500 dark:text-slate-400">Loading module…</span>
    </div>
  );
}

// Categories and links displayed in the Administration navigation bar.
export const ADMIN_NAV_CATEGORIES = [
  {
    id: 'catPeople',
    label: 'People',
    icon: Users,
    items: [
      { id: 'users', label: 'Members', icon: User },
      { id: 'certifications', label: 'Certifications', icon: BadgeCheck },
      { id: 'roles', label: 'Role Setup', icon: ShieldCheck },
      { id: 'ranks', label: 'Rank Setup', icon: Award },
      { id: 'certification-setup', label: 'Certification Setup', icon: ClipboardCheck },
    ],
  },
  {
    id: 'catAssets',
    label: 'Assets',
    icon: Package,
    items: [
      { id: 'equipment', label: 'Equipment', icon: ShieldAlert },
      { id: 'apparatus', label: 'Apparatuses', icon: Truck },
      { id: 'work-orders', label: 'Work Orders', icon: Wrench },
      { id: 'asset-setup', label: 'Asset Setup', icon: SlidersHorizontal },
    ],
  },
  {
    id: 'catScheduling',
    label: 'Scheduling',
    icon: CalendarDays,
    items: [
      { id: 'clock', label: 'Clock Management', icon: CalendarClock },
      { id: 'schedule', label: 'Schedule Management', icon: CalendarCheck },
      { id: 'events', label: 'Events', icon: CalendarPlus },
      { id: 'availability', label: 'Member Availability', icon: Clock },
      { id: 'approvals', label: 'Pending Approvals', icon: AlertCircle },
      { id: 'templates', label: 'Shift Template Setup', icon: CalendarCog },
      { id: 'assignments', label: 'Assignment Setup', icon: ListTodo },
      { id: 'availability-windows', label: 'Availability Window Setup', icon: Repeat },
    ],
  },
  {
    id: 'catContent',
    label: 'Content',
    icon: Book,
    items: [
      { id: 'announcements', label: 'Announcements', icon: Megaphone },
      { id: 'documents', label: 'Documents', icon: BookText },
      { id: 'training', label: 'Training', icon: GraduationCap },
      { id: 'dashboard-setup', label: 'Dashboard Setup', icon: LayoutDashboard },
      { id: 'widget-setup', label: 'Widget Setup', icon: Boxes },
      { id: 'chat', label: 'Chat Setup', icon: MessagesSquare },
      { id: 'map', label: 'Map Setup', icon: MapIcon },
    ],
  },
  {
    id: 'catReports',
    label: 'Reports',
    icon: BarChart3,
    items: [
      { id: 'reports-config', label: 'Report Setup', icon: BarChart3 },
      { id: 'forms-config', label: 'Form Setup', icon: FileText },
    ],
  },
  {
    id: 'catSystem',
    label: 'System',
    icon: Settings2,
    items: [
      { id: 'system', label: 'System Settings', icon: Settings2 },
      { id: 'navigation', label: 'Navigation Setup', icon: Compass },
      { id: 'notifications', label: 'Notifications', icon: Bell },
      { id: 'debug', label: 'Debug', icon: Bug },
      { id: 'help', label: 'Help', icon: BookOpen },
    ],
  },
];

export default function AdminPanel({
  token,
  // The signed-in member's own role row: every tab below is gated on it.
  currentRole,
  isAdmin,
  users,
  directory = [],
  roles,
  ranks,
  shifts,
  schedule,
  scheduleWindowError = '',
  onNeedSchedule,
  scheduleTemplates,
  assignments,
  loading = false,
  availabilityWindows = [],
  rosterAvailability = [],
  rosterScope = { from: '', to: '' },
  onRosterMonth,
  systemSettings,
  logs,
  clockLogsFrom = '',
  onLoadOlderClockLogs,
  timeFormat,
  onDataChanged,
  currentUserId = '',
  currentUser = null,
  currentUserName = '',
  onAvailabilityChanged,
  onLogsChanged,
  onAdminDataChanged,
  onBadgesChanged,
  onActiveSubTabChange,
  subTab = '',
  onSelectTab,
  offers = [],
  trainings = [],
  trainingSignatures = [],
  certificationSetup = [],
  certificationRecords = [],
  events = [],
  onRowSaved,
  departmentName = '',
  departmentLogoUrl = '',
  hideEventsByDefault = false,
  colorblindRankLabels = false,
  workOrders = [],
}) {
  const pendingApprovalsCount = pendingOffersOnly(offers).length;
  const activeWorkOrdersCount = useMemo(
    () => (Array.isArray(workOrders) ? workOrders : []).filter(isActiveWorkOrder).length,
    [workOrders]
  );
  const [documentVerificationBadge, setDocumentVerificationBadge] = useState({ userId: '', count: 0, byDocument: {} });
  const documentVerificationCount =
    documentVerificationBadge.userId === currentUserId ? documentVerificationBadge.count : 0;
  const documentVerificationCounts =
    documentVerificationBadge.userId === currentUserId ? (documentVerificationBadge.byDocument || {}) : {};
  const canViewDocumentVerificationCount =
    isAdmin || permissionGranted(currentRole, 'is_admin') || permissionGranted(currentRole, 'can_verify_documents');

  // List of admin tabs the user's role has permission to access.
  const allowedTabs = useMemo(() => allowedAdminTabs(currentRole), [currentRole]);
  const visibleCategories = useMemo(
    () =>
      ADMIN_NAV_CATEGORIES.map((category) => ({
        ...category,
        items: category.items.filter((item) => allowedTabs.includes(item.id)),
      })).filter((category) => category.items.length > 0),
    [allowedTabs]
  );

  const [openCategory, setOpenCategory] = useState(null);
  const barRef = useRef(null);

  // Combines directory records with full user rows so all members have names.
  const nameRows = useMemo(() => {
    const byId = new Map((Array.isArray(directory) ? directory : []).map((user) => [String(user?.id), user]));
    (Array.isArray(users) ? users : []).forEach((user) => byId.set(String(user?.id), user));
    return [...byId.values()];
  }, [directory, users]);

  // The open tab is DERIVED from the app's value: an id the role may still use renders that tab;
  // anything else - the initial open, the sidebar asking for the menu again, a role edited
  // mid-session, a stale request - renders the menu page. No effect, no second render pass.
  const activeSubTab = allowedTabs.includes(subTab) ? subTab : null;

  // The pending count the last auto-focus was based on. Only an INCREASE moves the
  // user to approvals, so opening another tab stays put while an offer is still
  // waiting - see shouldFocusApprovals for why that matters.
  const lastApprovalCount = useRef(0);

  useEffect(() => {
    const previous = lastApprovalCount.current;
    lastApprovalCount.current = pendingApprovalsCount;
    // ON THE MENU the badge is the whole answer: the member has not chosen a screen, so an offer
    // arriving must update the count they can see, not drag them to it. Once a tab is open the old
    // rule applies - an increase claims focus, and everything else leaves navigation alone.
    if (activeSubTab === null) return;
    if (shouldFocusApprovals(previous, pendingApprovalsCount, allowedTabs)) {
      onSelectTab('approvals');
    }
  }, [pendingApprovalsCount, allowedTabs, activeSubTab, onSelectTab]);

  useEffect(() => {
    if (activeSubTab !== null || !canViewDocumentVerificationCount) return undefined;
    let cancelled = false;
    fetchAdminDocumentVerificationSummary()
      .then((summary) => {
        if (!cancelled) {
          setDocumentVerificationBadge({
            userId: currentUserId,
            count: summary.count,
            byDocument: summary.byDocument || {},
          });
        }
      })
      .catch((error) => console.error('[admin] could not read pending document verification count', error));
    return () => {
      cancelled = true;
    };
  }, [activeSubTab, canViewDocumentVerificationCount, currentUserId]);

  const closeMenus = () => setOpenCategory(null);

  // Close the dropdowns when the user clicks outside the bar or presses Escape.
  useEffect(() => {
    const handleClick = (e) => {
      if (barRef.current && !barRef.current.contains(e.target)) closeMenus();
    };
    const handleEscape = (e) => {
      if (e.key === 'Escape') closeMenus();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  // Report the active sub-tab up to the app bar.
  useEffect(() => {
    if (onActiveSubTabChange) onActiveSubTabChange(activeSubTab || '');
  }, [activeSubTab, onActiveSubTabChange]);

  const categoryHasActive = (items) => items.some((item) => item.id === activeSubTab);
  const selectItem = (itemId) => {
    onSelectTab(itemId);
    closeMenus();
  };

  // Show a loading skeleton while administrative data is being fetched.
  if (loading) {
    return (
      <div className="space-y-6" role="status" aria-label="Loading Administration">
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading Administration…</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 space-y-3 shadow-sm"
            >
              <div className="h-6 w-36 bg-slate-200 dark:bg-slate-700/60 rounded-lg" />
              <div className="h-4 w-full bg-slate-100 dark:bg-slate-700/40 rounded" />
              <div className="h-4 w-3/4 bg-slate-100 dark:bg-slate-700/40 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Show the main menu if no specific tab is selected.
  if (activeSubTab === null) {
    return (
      <AdminMenuPage
        categories={visibleCategories}
        onSelectTab={selectItem}
        pendingCount={pendingApprovalsCount}
        documentVerificationCount={canViewDocumentVerificationCount ? documentVerificationCount : 0}
        workOrdersCount={activeWorkOrdersCount}
      />
    );
  }

  return (
    <div
      className={`space-y-6 page-enter ${
        activeSubTab === 'help' ? 'md:h-full md:min-h-0 md:flex-1 md:flex md:flex-col' : ''
      }`}
    >
      {visibleCategories.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Your role does not include access to any Administration tabs.
        </p>
      )}
      {/* Navigation bar with category dropdowns. */}
      <div ref={barRef} className="relative z-[15] flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-700 pb-2">
        {visibleCategories.map(({ id, label, icon: CatIcon, items }) => {
          const isOpen = openCategory === id;
          const isActive = categoryHasActive(items);
          return (
            <div key={id} className="relative">
              <button
                type="button"
                onClick={() => setOpenCategory(isOpen ? null : id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition ${
                  isActive
                    ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <CatIcon className="w-4 h-4" />
                {label}
                <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>

              {isOpen && (
                                <div className="absolute left-0 top-full mt-1 z-30 w-64 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl overflow-hidden py-1 origin-top-left animate-popoverIn">
                  {items.map(({ id: itemId, label: itemLabel, icon: ItemIcon }) => {
                        const badge =
                          itemId === 'approvals'
                            ? pendingApprovalsCount
                            : itemId === 'work-orders'
                              ? activeWorkOrdersCount
                              : undefined;
                        return (
                    <button
                      key={itemId}
                      type="button"
                      onClick={() => selectItem(itemId)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition ${
                        itemId === activeSubTab
                          ? 'bg-red-600 text-white'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      <ItemIcon className="w-4 h-4 shrink-0" />
                      <span className="flex-1 text-left">{itemLabel}</span>
                      {badge !== undefined && badge > 0 && (
                        <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-bold rounded-full bg-amber-400 text-amber-950">
                          {badge}
                        </span>
                      )}
                      {itemId === activeSubTab && <Check className="w-4 h-4" />}
                    </button>
                  );
                })}
              </div>
              )}
            </div>
          );
        })}
      </div>

      <Suspense fallback={<AdminTabLoading />}>
        {activeSubTab === 'users' && (
        <AdminUsersTab
          token={token}
          users={users}
          roles={roles}
          ranks={ranks}
          onDataChanged={onDataChanged}
          isAdmin={isAdmin}
          onRowSaved={onRowSaved}
        />
      )}

      {activeSubTab === 'roles' && (
        <AdminRolesTab token={token} roles={roles} isAdmin={isAdmin} onDataChanged={onDataChanged} onRowSaved={onRowSaved} />
      )}

      {activeSubTab === 'ranks' && (
        <AdminRanksTab token={token} ranks={ranks} onDataChanged={onDataChanged} onRowSaved={onRowSaved} />
      )}

      {activeSubTab === 'certifications' && (
        <AdminCertificationsTab
          token={token}
          users={nameRows}
          setup={certificationSetup}
          records={certificationRecords}
          departmentName={departmentName}
          departmentLogoUrl={departmentLogoUrl}
          onDataChanged={onAdminDataChanged}
          onBadgesChanged={onBadgesChanged}
        />
      )}

      {activeSubTab === 'certification-setup' && (
        <AdminCertificationSetupTab
          token={token}
          setup={certificationSetup}
          onDataChanged={onAdminDataChanged}
          onBadgesChanged={onBadgesChanged}
        />
      )}

      {activeSubTab === 'chat' && (
        <AdminChatTab
          token={token}
          roles={roles}
          ranks={ranks}
          users={nameRows}
          onDataChanged={onAdminDataChanged}
          onRowSaved={onRowSaved}
        />
      )}

      {activeSubTab === 'templates' && (
        <AdminScheduleTemplatesTab
          token={token}
          scheduleTemplates={scheduleTemplates}
          assignments={assignments}
          onDataChanged={onDataChanged}
          onRowSaved={onRowSaved}
        />
      )}

      {activeSubTab === 'assignments' && (
        <AdminAssignmentsTab
          token={token}
          assignments={assignments}
          ranks={ranks}
          users={nameRows}
          scheduleTemplates={scheduleTemplates}
          onDataChanged={onDataChanged}
          onRowSaved={onRowSaved}
        />
      )}

      {activeSubTab === 'schedule' && (
        <AdminScheduleManagementTab
          token={token}
          scheduleWindowError={scheduleWindowError}
          onNeedSchedule={onNeedSchedule}
          scheduleTemplates={scheduleTemplates}
          assignments={assignments}
          ranks={ranks}
          users={nameRows}
          rosterAvailability={rosterAvailability}
          rosterClaimsFrom={rosterScope?.from || ''}
          rosterClaimsTo={rosterScope?.to || ''}
          onRosterMonth={onRosterMonth}
          offers={offers}
          onAdminDataChanged={onAdminDataChanged}
          events={events}
          hideEventsByDefault={hideEventsByDefault}
          colorblindRankLabels={colorblindRankLabels}
          timeFormat={timeFormat}
          departmentName={departmentName}
          departmentLogoUrl={departmentLogoUrl}
        />
      )}

      {activeSubTab === 'availability' && (
        <AdminAvailabilityTab
          token={token}
          users={nameRows}
          windows={availabilityWindows}
          rosterAvailability={rosterAvailability}
          loadedFrom={rosterScope?.from || ''}
          loadedTo={rosterScope?.to || ''}
          onLoadMonth={onRosterMonth}
          ranks={ranks}
          roles={roles}
          timeFormat={timeFormat}
          events={events}
          hideEventsByDefault={hideEventsByDefault}
          scheduleTemplates={scheduleTemplates}
          assignments={assignments}
          schedule={schedule}
          onNeedSchedule={onNeedSchedule}
          onDataChanged={onAvailabilityChanged}
        />
      )}

      {activeSubTab === 'clock' && (
        <AdminClockManagementTab
          token={token}
          users={nameRows}
          ranks={ranks}
          shifts={shifts}
          logs={logs}
          loadedFrom={clockLogsFrom}
          onLoadOlder={onLoadOlderClockLogs}
          timeFormat={timeFormat}
          systemSettings={systemSettings}
          onDataChanged={onLogsChanged}
        />
      )}

      {activeSubTab === 'system' && (
        <AdminSystemSettingsTab
          token={token}
          systemSettings={systemSettings}
          onDataChanged={onDataChanged}
          onOpenMapSettings={() => onSelectTab('map')}
          onOpenNavigationSetup={() => onSelectTab('navigation')}
        />
      )}

      {activeSubTab === 'navigation' && (
        <AdminNavigationSetupTab
          token={token}
          systemSettings={systemSettings}
          onDataChanged={onDataChanged}
        />
      )}

      {/* Map settings tab */}
      {activeSubTab === 'map' && (
        <AdminMapSettingsTab
          token={token}
          systemSettings={systemSettings}
          canEditMap={permissionGranted(currentRole, 'can_edit_map')}
          canEditSystemSettings={permissionGranted(currentRole, 'can_edit_system_settings')}
        />
      )}

      {activeSubTab === 'reports-config' && (
        <AdminReportsConfigurationTab roles={roles} ranks={ranks} />
      )}

      {activeSubTab === 'forms-config' && (
        <AdminFormsTab roles={roles} ranks={ranks} />
      )}

      {activeSubTab === 'notifications' && (
        <AdminNotificationsTab
          token={token}
          systemSettings={systemSettings}
          // FCM credentials can only be edited by an admin.
          isAdmin={isAdmin}
          onDataChanged={onDataChanged}
        />
      )}

      {/* Debug tab: lets admins test alerts, sounds, and loading messages */}
      {activeSubTab === 'debug' && <AdminDebugTab systemSettings={systemSettings} />}

      {/* Admin help guides */}
      {activeSubTab === 'help' && <HelpGuides scope="admin" />}

      {/* Availability windows: weekly time slots members can sign up for */}
      {activeSubTab === 'availability-windows' && (
        <AdminAvailabilityWindowsTab token={token} onDataChanged={onDataChanged} />
      )}

      {/* Announcements management tab */}
      {activeSubTab === 'announcements' && (
        <AdminAnnouncementsTab
          token={token}
          roles={roles}
          ranks={ranks}
          users={nameRows}
          onDataChanged={onDataChanged}
        />
      )}

      {/* Documents and sign-off policies tab */}
      {activeSubTab === 'documents' && (
        <AdminDocumentsTab
          token={token}
          ranks={ranks}
          users={nameRows}
          timeFormat={timeFormat}
          currentUserId={currentUserId}
          canManageDocuments={permissionGranted(currentRole, 'can_manage_documents')}
          canVerifyDocuments={permissionGranted(currentRole, 'can_verify_documents')}
          documentVerificationCounts={documentVerificationCounts}
          onDataChanged={onDataChanged}
        />
      )}

      {/* Events management tab */}
      {activeSubTab === 'events' && (
        <AdminEventsTab
          token={token}
          roles={roles}
          ranks={ranks}
          users={nameRows}
          timeFormat={timeFormat}
          onDataChanged={onDataChanged}
        />
      )}

      {/* Training records and sign-offs */}
      {activeSubTab === 'training' && (
        <AdminTrainingTab
          token={token}
          trainings={trainings}
          signatures={trainingSignatures}
          users={nameRows}
          currentUserId={currentUserId}
          departmentName={departmentName}
          departmentLogoUrl={departmentLogoUrl}
          onDataChanged={onAdminDataChanged}
        />
      )}

      {activeSubTab === 'approvals' && (
        <AdminPendingApprovalsTab
          token={token}
          offers={offers}
          users={nameRows}
          assignments={assignments}
          schedule={schedule}
          scheduleTemplates={scheduleTemplates}
          timeFormat={timeFormat}
          onAdminDataChanged={onAdminDataChanged}
        />
      )}

      {/* Equipment asset tracking & lifecycle tab */}
      {activeSubTab === 'equipment' && (
        <AdminEquipmentTab
          token={token}
          users={nameRows}
          onDataChanged={onDataChanged}
        />
      )}

      {/* Apparatus fleet asset tracking tab */}
      {activeSubTab === 'apparatus' && (
        <AdminApparatusTab
          token={token}
          currentUserId={currentUserId}
          currentUser={currentUser}
          currentUserName={
            currentUserName ||
            currentUser?.name ||
            currentUser?.full_name ||
            currentUser?.user_name ||
            nameRows.find((u) => String(u?.id ?? u?.user_id) === String(currentUserId || currentUser?.id))?.name ||
            ''
          }
          users={nameRows}
          onDataChanged={onDataChanged}
        />
      )}

      {/* Work Orders management tab */}
      {activeSubTab === 'work-orders' && (
        <AdminWorkOrdersTab
          token={token}
          currentUserId={currentUserId}
          currentUser={currentUser}
          currentUserName={
            currentUserName ||
            currentUser?.name ||
            currentUser?.full_name ||
            currentUser?.user_name ||
            nameRows.find((u) => String(u?.id ?? u?.user_id) === String(currentUserId || currentUser?.id))?.name ||
            ''
          }
          users={nameRows}
          roles={roles}
          onDataChanged={onDataChanged}
        />
      )}

      {/* Asset types setup tab (equipment & apparatus types) */}
      {activeSubTab === 'asset-setup' && (
        <AdminAssetSetupTab
          token={token}
          onDataChanged={onDataChanged}
        />
      )}

      {/* Dashboard station default layout setup tab */}
      {activeSubTab === 'dashboard-setup' && (
        <AdminDashboardSetupTab
          token={token}
          systemSettings={systemSettings}
          onDataChanged={onDataChanged}
        />
      )}

      {/* Dashboard widgets definition & setup tab */}
      {activeSubTab === 'widget-setup' && (
        <AdminWidgetSetupTab
          token={token}
          systemSettings={systemSettings}
          onDataChanged={onDataChanged}
        />
      )}
      </Suspense>
    </div>
  );
}
