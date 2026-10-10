import React from 'react';
import { LayoutDashboard, CalendarDays, MessagesSquare, Menu } from 'lucide-react';

export default function MobileBottomNav({
  activeTab,
  onSelectTab,
  onOpenMore,
  canViewSchedule = true,
  canUseChat = true,
  canUseTimeclock = true,
  unreadChatCount = 0,
}) {
  const isTimeclockActive = activeTab === 'dashboard';
  const isScheduleActive = activeTab === 'schedule';
  const isChatActive = activeTab === 'chat';
  const isOtherActive = !isTimeclockActive && !isScheduleActive && !isChatActive;

  return (
    <nav
      aria-label="Mobile Navigation"
      className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-white/95 dark:bg-slate-800/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-700/80 px-2 pt-2 pb-[calc(0.5rem_+_env(safe-area-inset-bottom))] flex items-center justify-around shadow-lg"
    >
      {/* 1. Timeclock / Dashboard */}
      {canUseTimeclock && (
        <button
          type="button"
          onClick={() => onSelectTab('dashboard')}
          aria-current={isTimeclockActive ? 'page' : undefined}
          className={`flex flex-col items-center justify-center flex-1 py-1 px-2 rounded-xl text-xs font-medium transition ${
            isTimeclockActive
              ? 'text-red-600 dark:text-red-400 font-semibold'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <LayoutDashboard className="w-5 h-5 mb-1 shrink-0" />
          <span>Clock</span>
        </button>
      )}

      {/* 2. Schedule */}
      {canViewSchedule && (
        <button
          type="button"
          onClick={() => onSelectTab('schedule')}
          aria-current={isScheduleActive ? 'page' : undefined}
          className={`flex flex-col items-center justify-center flex-1 py-1 px-2 rounded-xl text-xs font-medium transition ${
            isScheduleActive
              ? 'text-red-600 dark:text-red-400 font-semibold'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <CalendarDays className="w-5 h-5 mb-1 shrink-0" />
          <span>Schedule</span>
        </button>
      )}

      {/* 3. Messages / Chat */}
      {canUseChat && (
        <button
          type="button"
          onClick={() => onSelectTab('chat')}
          aria-current={isChatActive ? 'page' : undefined}
          className={`flex flex-col items-center justify-center flex-1 py-1 px-2 rounded-xl text-xs font-medium transition relative ${
            isChatActive
              ? 'text-red-600 dark:text-red-400 font-semibold'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <div className="relative inline-flex items-center justify-center">
            <MessagesSquare className="w-5 h-5 mb-1 shrink-0" />
            {unreadChatCount > 0 && (
              <span className="absolute -top-1 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white shadow">
                {unreadChatCount > 99 ? '99+' : unreadChatCount}
              </span>
            )}
          </div>
          <span>Chat</span>
        </button>
      )}

      {/* 4. More */}
      <button
        type="button"
        onClick={onOpenMore}
        aria-label="Open more menu options"
        className={`flex flex-col items-center justify-center flex-1 py-1 px-2 rounded-xl text-xs font-medium transition ${
          isOtherActive
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

