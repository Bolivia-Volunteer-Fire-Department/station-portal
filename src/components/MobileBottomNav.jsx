import React from 'react';
import {
  LayoutDashboard,
  CalendarDays,
  MessagesSquare,
  CalendarCheck,
  Users,
  GraduationCap,
  BookText,
  BarChart3,
  History,
  BookOpen,
  Map as MapIcon,
  // Settings,
  ShieldCheck,
  Menu,
} from 'lucide-react';
import { DEFAULT_MOBILE_NAV_MODULES } from '../utils/mobileNav';

const MODULE_META = {
  dashboard: { label: 'Clock', icon: LayoutDashboard },
  schedule: { label: 'Schedule', icon: CalendarDays },
  chat: { label: 'Chat', icon: MessagesSquare },
  availability: { label: 'Availability', icon: CalendarCheck },
  roster: { label: 'Roster', icon: Users },
  training: { label: 'Trainings', icon: GraduationCap },
  documents: { label: 'Documents', icon: BookText },
  'district-map': { label: 'Map', icon: MapIcon },
  reports: { label: 'Reports', icon: BarChart3 },
  'clock-history': { label: 'History', icon: History },
  help: { label: 'Help', icon: BookOpen },
  // settings: { label: 'Settings', icon: Settings },
  admin: { label: 'Admin', icon: ShieldCheck },
};

export default function MobileBottomNav({
  activeTab,
  onSelectTab,
  onOpenMore,
  modules = DEFAULT_MOBILE_NAV_MODULES,
  canViewSchedule = true,
  canUseChat = true,
  canUseTimeclock = true,
  canEditAvailability = false,
  canViewRoster = false,
  canSignTrainings = false,
  canViewDocuments = false,
  canViewReports = false,
  canGenerateForms = false,
  canViewMap = false,
  canAdminister = false,
  unreadChatCount = 0,
}) {
  const isPermitted = (id) => {
    switch (id) {
      case 'dashboard':
      case 'clock-history':
        return Boolean(canUseTimeclock);
      case 'schedule':
        return Boolean(canViewSchedule);
      case 'chat':
        return Boolean(canUseChat);
      case 'availability':
        return Boolean(canEditAvailability);
      case 'roster':
        return Boolean(canViewRoster);
      case 'training':
        return Boolean(canSignTrainings);
      case 'documents':
        return Boolean(canViewDocuments);
      case 'reports':
        return Boolean(canViewReports || canGenerateForms);
      case 'district-map':
        return Boolean(canViewMap);
      case 'admin':
        return Boolean(canAdminister);
      case 'help':
      // case 'settings':
      default:
        return true;
    }
  };

  // Filter modules configured by admin to those the user's role can access
  const visibleModules = (Array.isArray(modules) ? modules : DEFAULT_MOBILE_NAV_MODULES)
    .filter(isPermitted)
    .slice(0, 3);

  const isMoreActive = !visibleModules.includes(activeTab);

  return (
    <nav
      aria-label="Mobile Navigation"
      className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-white/95 dark:bg-slate-800/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-700/80 px-2 pt-2 pb-[calc(0.5rem_+_env(safe-area-inset-bottom))] flex items-center justify-around shadow-lg"
    >
      {visibleModules.map((moduleId) => {
        const meta = MODULE_META[moduleId] || { label: moduleId, icon: LayoutDashboard };
        const Icon = meta.icon;
        const isActive = activeTab === moduleId;
        const isChat = moduleId === 'chat';

        return (
          <button
            key={moduleId}
            type="button"
            onClick={() => onSelectTab(moduleId)}
            aria-current={isActive ? 'page' : undefined}
            className={`flex flex-col items-center justify-center flex-1 py-1 px-2 rounded-xl text-xs font-medium transition ${
              isActive
                ? 'text-red-600 dark:text-red-400 font-semibold'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <div className="relative inline-flex items-center justify-center">
              <Icon className="w-5 h-5 mb-1 shrink-0" />
              {isChat && unreadChatCount > 0 && (
                <span className="absolute -top-1 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white shadow">
                  {unreadChatCount > 99 ? '99+' : unreadChatCount}
                </span>
              )}
            </div>
            <span>{meta.label}</span>
          </button>
        );
      })}

      {/* More menu button */}
      <button
        type="button"
        onClick={onOpenMore}
        aria-label="Open more menu options"
        className={`flex flex-col items-center justify-center flex-1 py-1 px-2 rounded-xl text-xs font-medium transition ${
          isMoreActive
            ? 'text-slate-900 dark:text-white font-semibold'
            : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
        }`}
      >
        <Menu className="w-5 h-5 mb-1 shrink-0" />
        <span>More</span>
      </button>
    </nav>
  );
}
