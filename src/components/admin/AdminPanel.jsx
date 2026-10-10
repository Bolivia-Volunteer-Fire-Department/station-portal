import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Users, User, ShieldCheck, Award, Settings2, CalendarClock, CalendarDays, CalendarCog, CalendarCheck, CalendarPlus, ChevronDown, Check, ListTodo, Clock, AlertCircle, Bell, BookOpen, BookText, GraduationCap, Megaphone, Book, Bug, BadgeCheck, ClipboardCheck, Repeat, Loader2, BarChart3, FileText, MessagesSquare } from 'lucide-react';
import AdminUsersTab from './AdminUsersTab';
import AdminRolesTab from './AdminRolesTab';
import AdminRanksTab from './AdminRanksTab';
import AdminScheduleTemplatesTab from './AdminScheduleTemplatesTab';
import AdminAssignmentsTab from './AdminAssignmentsTab';
import AdminAvailabilityTab from './AdminAvailabilityTab';
import AdminAvailabilityWindowsTab from './AdminAvailabilityWindowsTab';
import AdminScheduleManagementTab from './AdminScheduleManagementTab';
import AdminSystemSettingsTab from './AdminSystemSettingsTab';
import AdminClockManagementTab from './AdminClockManagementTab';
import AdminPendingApprovalsTab from './AdminPendingApprovalsTab';
import AdminNotificationsTab from './AdminNotificationsTab';
// The Audit Log tab was removed: the station's audit trail is Cloud Logging now (see `audit` in functions/index.js).
import AdminDebugTab from './AdminDebugTab';
import HelpGuides from '../HelpGuides';
import AdminTrainingTab from './AdminTrainingTab';
import AdminCertificationsTab from './AdminCertificationsTab';
import AdminCertificationSetupTab from './AdminCertificationSetupTab';
import AdminAnnouncementsTab from './AdminAnnouncementsTab';
import AdminChatTab from './AdminChatTab';
import AdminDocumentsTab from './AdminDocumentsTab';
import AdminEventsTab from './AdminEventsTab';
import AdminReportsConfigurationTab from './AdminReportsConfigurationTab';
import AdminFormsTab from './AdminFormsTab';
import { pendingOffersOnly } from '../../utils/shiftOfferRow';
import { fetchAdminDocumentVerificationCount } from '../../services/api';
import { allowedAdminTabs, permissionGranted, shouldFocusApprovals } from '../../utils/permissions';
import AdminMenuPage from './AdminMenuPage';

// Categorical dropdown groups for the admin bar. Item ids match the sub-tabs
// rendered below, so the active tab state stays driven by one value.
//
// Exported so the grouping is testable (scripts/verify-admin-render.mjs asserts where each tab
// lives) - the labels are inside a closed dropdown in rendered output, so they cannot be read
// from the HTML.
export const ADMIN_NAV_CATEGORIES = [
  {
    id: 'catPeople',
    label: 'People',
    icon: Users,
    items: [
      { id: 'users', label: 'Members', icon: User },
      { id: 'roles', label: 'Roles', icon: ShieldCheck },
      { id: 'ranks', label: 'Ranks', icon: Award },
      { id: 'certifications', label: 'Certifications', icon: BadgeCheck },
      { id: 'certification-setup', label: 'Certification Setup', icon: ClipboardCheck },
    ],
  },
  {
    id: 'catScheduling',
    label: 'Scheduling',
    icon: CalendarDays,
    items: [
      // The Shifts tab (editing the `shifts` sheet) is intentionally NOT wired up:
      // shift definitions are edited directly in the spreadsheet for now. The
      // component is still at ./AdminShiftsTab.jsx, so bringing the tab back is a
      // matter of restoring this entry, its render block below, and the import.
      { id: 'templates', label: 'Schedule Templates', icon: CalendarCog },
      { id: 'assignments', label: 'Assignments', icon: ListTodo },
      { id: 'schedule', label: 'Schedule Management', icon: CalendarCheck },
      // Events sits directly under Schedule Management because it is configured the same way, and its
      // entries appear on every calendar alongside the shifts.
      { id: 'events', label: 'Events', icon: CalendarPlus },
      // Member Availability sits here rather than under Timeclock: it answers "who can work
      // which shift", the same question as the rest of this group.
      { id: 'availability', label: 'Member Availability', icon: Clock },
      // The windows members choose from, in the same group and under the same permission: the patterns are the options
      // list, and Member Availability is where the claims against them are read and corrected.
      { id: 'availability-windows', label: 'Availability Windows', icon: Repeat },
      { id: 'approvals', label: 'Pending Approvals', icon: AlertCircle },
    ],
  },
  {
    id: 'catTimeclock',
    label: 'Timeclock',
    icon: CalendarClock,
    items: [
      { id: 'clock', label: 'Clock Management', icon: CalendarClock },
    ],
  },
  {
    // Renamed from Training to Content when Announcements arrived alongside the Training report.
    id: 'catContent',
    label: 'Content',
    icon: Book,
    items: [
      { id: 'announcements', label: 'Announcements', icon: Megaphone },
      { id: 'documents', label: 'Documents', icon: BookText },
      { id: 'training', label: 'Training', icon: GraduationCap },
    ],
  },
  {
    id: 'catReports',
    label: 'Reports',
    icon: BarChart3,
    items: [
      { id: 'reports-config', label: 'Reports Configuration', icon: BarChart3 },
      { id: 'forms-config', label: 'Forms', icon: FileText },
    ],
  },
  {
    // Chat Rooms sits in its own group rather than under People, because it is not about people: it is the station's
    // conversation structure, and an officer given this permission is not thereby given a seat in any room (see
    // utils/chat.js#chatPermissionsFrom). Nothing else lives here yet, and that is fine - a group of one is clearer than
    // a tab filed under a heading that does not describe it.
    id: 'catChat',
    label: 'Communication',
    icon: MessagesSquare,
    items: [{ id: 'chat', label: 'Chat Rooms', icon: MessagesSquare }],
  },
  {
    id: 'catSystem',
    label: 'System',
    icon: Settings2,
    items: [
      { id: 'system', label: 'System Settings', icon: Settings2 },
      { id: 'notifications', label: 'Notifications', icon: Bell },
      // Debug fires the app's own toasts, dialogs and sounds from buttons. Like the audit log it is not part of the
      // refresh wave, and unlike the log it fetches nothing at all - see AdminDebugTab.
      { id: 'debug', label: 'Debug', icon: Bug },
      // Help needs no permission column - see ADMIN_PERMISSIONLESS_TABS in
      // utils/permissions.js. It is open to anyone who can reach Administration at all.
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
  // THE CREW DIRECTORY: the full public `users` rows ({ id, name, rank_id, exclude_from_scheduling, runner_sound_profile }),
  // read as a section when a tab that names a member opens. Distinct from `users` on purpose - the full rows are the
  // Users tab's section, and their private-half join is refused to roles without can_edit_users. Defaulted, because a
  // caller that has not read it yet is a real state rather than a mistake.
  directory = [],
  roles,
  ranks,
  shifts,
  schedule,
  // THE BOARD READS THE MONTH IT IS SHOWING, so it is handed what the last read said and the way to ask for another one.
  // THESE WERE PASSED BY App.jsx AND THEN DROPPED HERE: the board asked for a month, the request arrived nowhere, and it
  // drew whatever the sign-in payload had left in the shared array - so a month outside that window could never be
  // fetched at all, and a save could not be re-read into the month it changed. A prop that stops at this line produces no
  // error anywhere, which is why the forwarding is asserted by scripts/verify-admin-render.mjs.
  scheduleWindowError = '',
  onNeedSchedule,
  scheduleTemplates,
  assignments,
  // THE MODULE IS READ WHEN IT IS OPENED (App.jsx#adminModuleOpened), so this can be true for the first moment: every tab
  // below draws its empty state from an empty prop, and "No users yet" is indistinguishable from a read in flight.
  loading = false,
  // Reference data and the crew's claims for the availability screens: the windows every member chooses from, the
  // claims themselves (loaded per range, not in the payload), and the scope they were read over.
  availabilityWindows = [],
  rosterAvailability = [],
  rosterScope = { from: '', to: '' },
  onRosterMonth,
  systemSettings,
  logs,
  // What the clock history holds, and how to ask for more: forwarded to the Clock tab, which draws the same
  // "entries back to" line and "load older" control the member's own Clock History does.
  clockLogsFrom = '',
  onLoadOlderClockLogs,
  timeFormat,
  onDataChanged,
  // The signed-in admin's own user id: the checklist verification view uses it to leave that member's own
  // checklist off the list, because the server refuses self-verification.
  currentUserId = '',
  onAvailabilityChanged,
  onLogsChanged,
  onAdminDataChanged,
  // A certification or setup save rebuilds the badge index on the server and returns it with the reply. This carries it
  // to App, which owns the module registry the badge icons read from - so a badge appears or vanishes as the officer
  // saves, instead of only on the next sign-in. The data is already paid for; this just stops it being thrown away.
  onBadgesChanged,
  // Reports the sub-tab that ACTUALLY rendered upward, so the app bar can name it ("Admin: Schedule
  // Mgt"). This is not always the requested one: the menu page reports '' (which is what makes the
  // label fall back to the bare "Administration"), and a mid-session role edit reports '' too.
  onActiveSubTabChange,
  // THE OPEN SUB-TAB IS THE APP'S, not this panel's: '' (or an id the role may no longer use)
  // renders the menu page, and every selection is reported back through onSelectTab. Owning the
  // value in one place is what makes "press Administration again to return to the menu" possible -
  // the sidebar resets it, and this panel renders whatever the app says.
  subTab = '',
  onSelectTab,
  offers = [],
  // Training record and signatures. An administrator receives every signature; a member
  // receives only their own, which the server decides - so this tab only ever sees the full
  // set when the role can administer trainings.
  trainings = [],
  trainingSignatures = [],
  // Certifications. The catalog rides with every bootstrap (it names and icons the records, and the icons
  // appear beside members' names); the records only arrive for a role that may manage them.
  certificationSetup = [],
  certificationRecords = [],
  // Non-shift calendar entries, drawn on the board and the calendars this module hosts.
  events = [],
  // Lets a tab show a saved row immediately rather than waiting for the refresh wave.
  onRowSaved,
  // Used only on the printed schedule sheet's header.
  departmentName = '',
  hideEventsByDefault = false,
  colorblindRankLabels = false,
}) {
  // Offers awaiting a decision. Shares the predicate with the approvals table so
  // the badge can never disagree with the rows below it.
  const pendingApprovalsCount = pendingOffersOnly(offers).length;
  const [documentVerificationBadge, setDocumentVerificationBadge] = useState({ userId: '', count: 0 });
  const documentVerificationCount =
    documentVerificationBadge.userId === currentUserId ? documentVerificationBadge.count : 0;
  const canViewDocumentVerificationCount =
    isAdmin || permissionGranted(currentRole, 'is_admin') || permissionGranted(currentRole, 'can_verify_documents');

  // The tabs this role may use, which drives BOTH the nav entries and the panel
  // that can render. One list means a tab can never be selected without being
  // permitted, or shown without being usable.
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

  // THE ROWS THE TABS THAT NAME A MEMBER DRAW THOSE NAMES FROM - the merge, in one place rather than ten.
  //
  // Two sources, and each covers the other's gap:
  //
  //   * the DIRECTORY section: the full public `users` rows, read when a name-drawing tab opens. Public, so every
  //     officer may read it whatever else their role grants - which is the point, since the joined Users section
  //     reads `users_private` and the rules refuse that collection to anybody without can_edit_users (and they
  //     refuse it WHOLE, so one refused document would take the tab's own data down with it).
  //   * the USERS section: the same rows joined to their private half, which is what the Users TAB needs (it edits
  //     the username and the status) and which carries `status` for the tabs that filter on it.
  //
  // The join is laid OVER the directory, so a row that has both arrives as the fuller one and a row that only one
  // source has still arrives. The bug this replaces: every tab read `users`, the payload refactor left that empty
  // on a fresh session, and every member on the Certifications and Schedule tabs was rendered as "Unnamed member".
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
    fetchAdminDocumentVerificationCount()
      .then((count) => {
        if (!cancelled) setDocumentVerificationBadge({ userId: currentUserId, count });
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

  // Report the open sub-tab so the app bar can name it.
  //
  // An effect rather than a call inside selectItem, because the tab also changes on its own: a role edit
  // falls back to the menu, and a new shift offer focuses approvals. The parent passes a state setter,
  // so this is a stable prop and setting the same value is a no-op.
  useEffect(() => {
    if (onActiveSubTabChange) onActiveSubTabChange(activeSubTab || '');
  }, [activeSubTab, onActiveSubTabChange]);

  const categoryHasActive = (items) => items.some((item) => item.id === activeSubTab);
  const selectItem = (itemId) => {
    onSelectTab(itemId);
    closeMenus();
  };

  // The module's own read is still in flight. The panel is mounted the moment Administration is opened, so this is the first
  // moment of every visit - and every tab below would otherwise draw "No users yet" / "Nothing scheduled" from its empty
  // props, which reads as a station with no data rather than a read that has not come back yet.
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

  // THE MENU PAGE: the landing screen, a card per category. It replaces the first-permitted-tab
  // default, so opening Administration reads nothing the member did not ask for - the badge rides
  // with `offers`, which the member payload already carries for a role that may see this module.
  // The dropdown bar below is skipped entirely, and comes back the moment a section is chosen.
  if (activeSubTab === null) {
    return (
      <AdminMenuPage
        categories={visibleCategories}
        onSelectTab={selectItem}
        pendingCount={pendingApprovalsCount}
        documentVerificationCount={canViewDocumentVerificationCount ? documentVerificationCount : 0}
      />
    );
  }

  return (
    // `space-y-6` for the stack of cards. The height classes apply only to the Help tab, and only because that
    // screen scrolls INSIDE its card: the guide pane fills the height left over from this container, so this
    // container has to HAVE a height to give (percentage heights against an auto-height parent resolve to auto,
    // and the chain would silently break - the card would grow and the bookmarks would scroll away as before).
    // Every other tab is left exactly as it was: the page scrolls them.
    //
    // `md:flex-1` and `md:h-full` both appear because <main> becomes a flex column on this screen (see
    // boundedHelpScreen in App.jsx) and a block otherwise: flex-1 is what gives this container the height LEFT OVER
    // after the page heading - which is the whole point, since h-full alone asks for the heading's height as well
    // and pushes the last ~90px of the guide below the fold.
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
      {/* `z-[5]` keeps the tab bar and its dropdown UNDER the sticky app bar (z-10) on a phone, while
          still floating above the page content below it. It was `z-20`, which put the sub-menu - and the
          overflow menus hanging off it - on top of the sticky header as the page scrolled. The dropdown
          inside it keeps its own z-30; that is scoped to this element's stacking context, so it still
          clears the content it opens over. */}
      <div ref={barRef} className="relative z-[5] flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-700 pb-2">
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
                        const badge = itemId === 'approvals' ? pendingApprovalsCount : undefined;
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

      {activeSubTab === 'users' && (
        <AdminUsersTab
          token={token}
          users={users}
          roles={roles}
          ranks={ranks}
          onDataChanged={onDataChanged}
          // The runner sound profile is the one field on this tab that needs is_admin rather than
          // can_edit_users. Passed so the field can be disabled, and enforced on the server too.
          isAdmin={isAdmin}
          // Shows a saved row in the list straight away, since the refresh wave cannot be waited
          // on without holding the form open for tens of seconds.
          onRowSaved={onRowSaved}
        />
      )}

      {activeSubTab === 'roles' && (
        <AdminRolesTab token={token} roles={roles} isAdmin={isAdmin} onDataChanged={onDataChanged} onRowSaved={onRowSaved} />
      )}

      {activeSubTab === 'ranks' && (
        <AdminRanksTab token={token} ranks={ranks} onDataChanged={onDataChanged} onRowSaved={onRowSaved} />
      )}

      {/* Who holds what. The catalog comes with the payload (it is small and every tab that shows an icon needs
          it); the records only arrive for a role that may manage them, so a Setup-only role sees an empty table
          rather than somebody else's data. The names come from `nameRows` - see the note on it above. */}
      {activeSubTab === 'certifications' && (
        <AdminCertificationsTab
          token={token}
          users={nameRows}
          setup={certificationSetup}
          records={certificationRecords}
          departmentName={departmentName}
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
        // The roster rows and the rank list come from the caller's own payload - the tab needs to name a room's audience
        // in words ("Officers", "Captain") rather than as keys, and the read it makes for itself is the rooms.
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
          // Only for the warning that a new end date will stop these templates drawing shifts.
          scheduleTemplates={scheduleTemplates}
          onDataChanged={onDataChanged}
          onRowSaved={onRowSaved}
        />
      )}

      {activeSubTab === 'schedule' && (
        <AdminScheduleManagementTab
          token={token}
          // NOT the shared schedule array: this board reads the month on screen from Firestore (see the onNeedSchedule
          // note in AdminScheduleManagementTab), which is why it is handed the reader rather than a list of rows.
          // The month reader, and why the last read failed. Required: this board draws the month it read (see the
          // onNeedSchedule note in AdminScheduleManagementTab).
          scheduleWindowError={scheduleWindowError}
          onNeedSchedule={onNeedSchedule}
          scheduleTemplates={scheduleTemplates}
          assignments={assignments}
          ranks={ranks}
          users={nameRows}
          // The CREW'S claims, not this officer's own: they are what the "nothing marked that day" warning below the
          // board reads (read once by App.jsx and shared with the roster).
          rosterAvailability={rosterAvailability}
          // AND THE RANGE THOSE CLAIMS COVER, plus the way to ask for a month that is not in it. An empty list and an
          // unread month look identical, and only one of them is a member having marked nothing - so the board is told
          // which days it may judge, and can fetch the month it is looking at.
          rosterClaimsFrom={rosterScope?.from || ''}
          rosterClaimsTo={rosterScope?.to || ''}
          onRosterMonth={onRosterMonth}
          offers={offers}
          onAdminDataChanged={onAdminDataChanged}
          // Non-shift entries, so the board shows the month as a whole.
          events={events}
          hideEventsByDefault={hideEventsByDefault}
          colorblindRankLabels={colorblindRankLabels}
          timeFormat={timeFormat}
          // Used only on the printed sheet's header.
          departmentName={departmentName}
        />
      )}

      {activeSubTab === 'availability' && (
        <AdminAvailabilityTab
          token={token}
          users={nameRows}
          // The windows, the CREW'S claims and the scope they were read over. `availability` (this officer's own rows)
          // is deliberately NOT passed here any more: it was what made the roster list the wrong people.
          windows={availabilityWindows}
          rosterAvailability={rosterAvailability}
          loadedFrom={rosterScope?.from || ''}
          loadedTo={rosterScope?.to || ''}
          onLoadMonth={onRosterMonth}
          ranks={ranks}
          // The roles, for the "hasn't filled it in" card alone: a member whose role cannot open the Availability
          // module has no way to answer, so listing them every month is noise rather than a chase.
          roles={roles}
          timeFormat={timeFormat}
          events={events}
          hideEventsByDefault={hideEventsByDefault}
          // The schedule behind the All Members list's assign control: the templates and assignments the panel already
          // holds, the month the app last read, and the read itself. The same three the board gets, because the control
          // offers the same slots (utils/scheduleSlots) and writes through the same batch route.
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
          // The table opens on the PAY PERIOD, and it says so: see the window note on `logs` in App#loadLogs - a year of the
          // station's clock entries is tens of thousands of reads for one look.
          loadedFrom={clockLogsFrom}
          onLoadOlder={onLoadOlderClockLogs}
          timeFormat={timeFormat}
          // The rounding step, so the hours in this table are the hours the report an officer reconciles it against pays.
          systemSettings={systemSettings}
          onDataChanged={onLogsChanged}
        />
      )}

      {activeSubTab === 'system' && (
        <AdminSystemSettingsTab
          token={token}
          systemSettings={systemSettings}
          onDataChanged={onDataChanged}
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
          // The FCM credential card is administrator-only; the rest of the tab is
          // available to a role that manages notification settings.
          isAdmin={isAdmin}
          onDataChanged={onDataChanged}
        />
      )}

      {/* Debug: fires the app's own feedback on demand. Gated on can_access_debug by the nav. It takes no token
          and fetches nothing - every button on it is client-side, which is also why nothing here can be a way to
          change a row. The station's own loading messages are passed through so the overlay preview says what this
          station would say. */}
      {activeSubTab === 'debug' && <AdminDebugTab systemSettings={systemSettings} />}

      {/* Guides for administrators, from src/content/help/admin/*.md. No permission gates
          this tab beyond being able to open Administration at all. */}
      {activeSubTab === 'help' && <HelpGuides scope="admin" />}

      {/* Availability windows: the weekly patterns members choose from. Gated by the same permission as the tab that
          reads the claims against them - utils/permissions carries the pair. */}
      {activeSubTab === 'availability-windows' && (
        <AdminAvailabilityWindowsTab token={token} onDataChanged={onDataChanged} />
      )}

      {/* Announcements: gated on can_make_announcements by the nav, and enforced again by the
          backend actions behind it. */}
      {activeSubTab === 'announcements' && (
        <AdminAnnouncementsTab
          token={token}
          roles={roles}
          ranks={ranks}
          users={nameRows}
          onDataChanged={onDataChanged}
        />
      )}

      {/* Documents: opens for can_manage_documents OR can_verify_documents (see roleAllowsTab - the one tab two
          permissions open), and every action behind it is enforced again on the server. A verifier who cannot
          manage documents sees only the verification view, never the editor. */}
      {activeSubTab === 'documents' && (
        <AdminDocumentsTab
          token={token}
          ranks={ranks}
          users={nameRows}
          timeFormat={timeFormat}
          currentUserId={currentUserId}
          canManageDocuments={permissionGranted(currentRole, 'can_manage_documents')}
          canVerifyDocuments={permissionGranted(currentRole, 'can_verify_documents')}
          onDataChanged={onDataChanged}
        />
      )}

      {/* Events: gated on can_create_events by the nav, and enforced again by the backend. */}
      {activeSubTab === 'events' && (
        <AdminEventsTab
          token={token}
          roles={roles}
          ranks={ranks}
          users={nameRows}
          timeFormat={timeFormat}
          // The board's own refresh wave does not fetch events, so the tab re-reads them itself.
          onDataChanged={onDataChanged}
        />
      )}

      {/* The training record for everyone: who signed what, per training. Requires
          can_administer_trainings, which is also the only permission that can remove a
          signature. */}
      {activeSubTab === 'training' && (
        <AdminTrainingTab
          token={token}
          trainings={trainings}
          signatures={trainingSignatures}
          users={nameRows}
          currentUserId={currentUserId}
          departmentName={departmentName}
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
    </div>
  );
}
