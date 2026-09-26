import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Users, User, ShieldCheck, Award, Settings2, CalendarClock, CalendarDays, CalendarCog, CalendarCheck, CalendarPlus, ChevronDown, Check, ListTodo, Clock, AlertCircle, Bell, BookOpen, GraduationCap, ScrollText, Megaphone, Book } from 'lucide-react';
import AdminUsersTab from './AdminUsersTab';
import AdminRolesTab from './AdminRolesTab';
import AdminRanksTab from './AdminRanksTab';
import AdminScheduleTemplatesTab from './AdminScheduleTemplatesTab';
import AdminAssignmentsTab from './AdminAssignmentsTab';
import AdminAvailabilityTab from './AdminAvailabilityTab';
import AdminScheduleManagementTab from './AdminScheduleManagementTab';
import AdminSystemSettingsTab from './AdminSystemSettingsTab';
import AdminClockManagementTab from './AdminClockManagementTab';
import AdminPendingApprovalsTab from './AdminPendingApprovalsTab';
import AdminNotificationsTab from './AdminNotificationsTab';
import AdminSystemLogTab from './AdminSystemLogTab';
import HelpGuides from '../HelpGuides';
import AdminTrainingTab from './AdminTrainingTab';
import AdminAnnouncementsTab from './AdminAnnouncementsTab';
import AdminEventsTab from './AdminEventsTab';
import { pendingOffersOnly } from '../../utils/shiftOfferRow';
import { allowedAdminTabs, shouldFocusApprovals } from '../../utils/permissions';

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
      { id: 'users', label: 'Users', icon: User },
      { id: 'roles', label: 'Roles', icon: ShieldCheck },
      { id: 'ranks', label: 'Ranks', icon: Award },
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
      { id: 'training', label: 'Training', icon: GraduationCap },
    ],
  },
  {
    id: 'catSystem',
    label: 'System',
    icon: Settings2,
    items: [
      { id: 'system', label: 'System Settings', icon: Settings2 },
      { id: 'notifications', label: 'Notifications', icon: Bell },
      // Deliberately NOT part of refreshAdminData: the log is the largest table in the app, so it is
      // fetched only when this tab is opened. See AdminSystemLogTab.
      { id: 'system-log', label: 'System Log', icon: ScrollText },
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
  roles,
  ranks,
  shifts,
  schedule,
  scheduleTemplates,
  assignments,
  availability,
  systemSettings,
  logs,
  timeFormat,
  onDataChanged,
  onAvailabilityChanged,
  onLogsChanged,
  onAdminDataChanged,
  // Reports the open sub-tab upward, so the app bar can say "Admin: Schedule Mgt" once the page
  // heading has scrolled away. Optional: the panel works without it.
  onActiveSubTabChange,
  offers = [],
  onOffersChanged,
  // Training record and signatures. An administrator receives every signature; a member
  // receives only their own, which the server decides - so this tab only ever sees the full
  // set when the role can administer trainings.
  trainings = [],
  trainingSignatures = [],
  // Non-shift calendar entries, drawn on the board and the calendars this module hosts.
  events = [],
  // Lets a tab show a saved row immediately rather than waiting for the refresh wave.
  onRowSaved,
  // Used only on the printed schedule sheet's header.
  departmentName = '',
}) {
  // Offers awaiting a decision. Shares the predicate with the approvals table so
  // the badge can never disagree with the rows below it.
  const pendingApprovalsCount = pendingOffersOnly(offers).length;

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
  const [requestedSubTab, setRequestedSubTab] = useState(null);
  const barRef = useRef(null);

  // The open tab is DERIVED: the request stands only while the role may use it,
  // otherwise the first permitted tab is used. That covers the initial open, a role
  // edited mid-session, and any stale request, without an effect that would cause a
  // second render pass.
  const activeSubTab =
    requestedSubTab && allowedTabs.includes(requestedSubTab) ? requestedSubTab : allowedTabs[0] ?? null;

  // The pending count the last auto-focus was based on. Only an INCREASE moves the
  // user to approvals, so opening another tab stays put while an offer is still
  // waiting - see shouldFocusApprovals for why that matters.
  const lastApprovalCount = useRef(0);

  useEffect(() => {
    const previous = lastApprovalCount.current;
    lastApprovalCount.current = pendingApprovalsCount;
    if (shouldFocusApprovals(previous, pendingApprovalsCount, allowedTabs)) {
      setRequestedSubTab('approvals');
    }
  }, [pendingApprovalsCount, allowedTabs]);

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
  // falls back to the first permitted tab, and a new shift offer auto-focuses approvals. The parent
  // passes a state setter, so this is a stable prop and setting the same value is a no-op.
  useEffect(() => {
    if (onActiveSubTabChange) onActiveSubTabChange(activeSubTab || '');
  }, [activeSubTab, onActiveSubTabChange]);

  const categoryHasActive = (items) => items.some((item) => item.id === activeSubTab);
  const selectItem = (itemId) => {
    setRequestedSubTab(itemId);
    closeMenus();
  };

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
      className={`space-y-6 ${
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
                                <div className="absolute left-0 top-full mt-1 z-30 w-64 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl overflow-hidden py-1">
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
          users={users}
          // Only for the warning that a new end date will stop these templates drawing shifts.
          scheduleTemplates={scheduleTemplates}
          onDataChanged={onDataChanged}
          onRowSaved={onRowSaved}
        />
      )}

      {activeSubTab === 'schedule' && (
        <AdminScheduleManagementTab
          token={token}
          schedule={schedule}
          scheduleTemplates={scheduleTemplates}
          assignments={assignments}
          ranks={ranks}
          users={users}
          availability={availability}
          offers={offers}
          onOffersChanged={onOffersChanged}
          // Non-shift entries, so the board shows the month as a whole.
          events={events}
          timeFormat={timeFormat}
          // Used only on the printed sheet's header.
          departmentName={departmentName}
        />
      )}

      {activeSubTab === 'availability' && (
        <AdminAvailabilityTab
          token={token}
          users={users}
          availability={availability}
          scheduleTemplates={scheduleTemplates}
          assignments={assignments}
          ranks={ranks}
          timeFormat={timeFormat}
          events={events}
          onDataChanged={onAvailabilityChanged}
        />
      )}

      {activeSubTab === 'clock' && (
        <AdminClockManagementTab
          token={token}
          users={users}
          ranks={ranks}
          shifts={shifts}
          logs={logs}
          timeFormat={timeFormat}
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

      {/* The log fetches its own page when it mounts, so a tab nobody visits costs no requests. */}
      {activeSubTab === 'system-log' && (
        <AdminSystemLogTab token={token} users={users} timeFormat={timeFormat} />
      )}

      {/* Guides for administrators, from src/content/help/admin/*.md. No permission gates
          this tab beyond being able to open Administration at all. */}
      {activeSubTab === 'help' && <HelpGuides scope="admin" />}

      {/* Announcements: gated on can_make_announcements by the nav, and enforced again by the
          backend actions behind it. */}
      {activeSubTab === 'announcements' && (
        <AdminAnnouncementsTab
          token={token}
          roles={roles}
          ranks={ranks}
          users={users}
          onDataChanged={onDataChanged}
        />
      )}

      {/* Events: gated on can_create_events by the nav, and enforced again by the backend. */}
      {activeSubTab === 'events' && (
        <AdminEventsTab
          token={token}
          roles={roles}
          ranks={ranks}
          users={users}
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
          users={users}
          onDataChanged={onAdminDataChanged}
        />
      )}

      {activeSubTab === 'approvals' && (
        <AdminPendingApprovalsTab
          token={token}
          offers={offers}
          onOffersChanged={onOffersChanged}
          users={users}
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
