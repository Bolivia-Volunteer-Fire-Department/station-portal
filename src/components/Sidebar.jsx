import React from 'react';
import { LayoutDashboard, User, Settings, LogOut, History, Shield, ShieldCheck, CalendarDays, Clock, BookOpen, GraduationCap } from 'lucide-react';
import RankIcon from './RankIcon';
import { stationLogoUrl } from '../utils/assets';
import AnnouncementList from './AnnouncementList';

export default function Sidebar({
    currentUser,
    isClockedIn,
    activeTab,
    setActiveTab,
    isSidebarOpen,
    setIsSidebarOpen,
    onLogout,
    // Module visibility, each driven by a role permission:
    canAdminister,
    canViewSchedule,
    canEditAvailability,
    canUseTimeclock,
    canSignTrainings,
    ranks = [],
    // The member's own announcements for the sidebar, and who to filter them for.
    announcements = [],
    announcementAudience = {},
}) {
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

    const currentUserRank = ranks.find((r) => String(r.id) === String(currentUser?.rank_id));
    return (
        <>
            {isSidebarOpen && (
                <div
                    onClick={() => setIsSidebarOpen(false)}
                    className="fixed inset-0 bg-black/60 z-20 md:hidden"
                />
            )}

            <aside className={`
        fixed md:static md:h-screen inset-y-0 left-0 z-30 w-64 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex flex-col transition-transform duration-200 ease-in-out
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
                <div className="hidden md:flex items-center gap-3 p-6 border-b border-slate-200 dark:border-slate-700">
                    <a href="#" onClick={(e) => {
                        e.preventDefault();
                        handleEasterEgg();
                    }}>
                        <img src={stationLogoUrl()} alt="Bolivia Fire Department Logo" className="w-8 h-8" />
                        {/* <Shield className="w-8 h-8 text-red-500" /> */}
                    </a>
                    <span className="font-bold text-xl text-slate-900 dark:text-white">Station Portal</span>
                </div>

                <div className="p-4 m-4 bg-slate-100 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-700/50 flex items-center gap-3">
                    <div
                        className="p-2 bg-slate-200 dark:bg-slate-800 rounded-lg"
                        style={{ color: currentUserRank?.color || undefined }}
                    >
                        {currentUserRank ? (
                            <RankIcon name={currentUserRank.icon} className="w-5 h-5" />
                        ) : (
                            <User className="w-5 h-5 text-slate-500 dark:text-slate-300" />
                        )}
                    </div>
                    <div className="overflow-hidden">
                        <p className="font-semibold text-sm text-slate-900 dark:text-white truncate">{currentUser.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 capitalize">Status: {isClockedIn ? 'Clocked In' : 'Clocked Out'}</p>
                    </div>
                </div>

                {/* The member's announcements: below the name card, above the menu. Compact, because the
                    sidebar is narrow. */}
                <div className="px-4 pb-2">
                  <AnnouncementList
                    announcements={announcements}
                    location="is_visible_on_sidebar"
                    audience={announcementAudience}
                    compact
                  />
                </div>

                <nav className="flex-1 min-h-0 overflow-y-auto px-4 space-y-1">
                    <button
                        onClick={() => { setActiveTab('dashboard'); setIsSidebarOpen(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${activeTab === 'dashboard' ? 'bg-red-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white'
                            }`}
                    >
                        <LayoutDashboard className="w-5 h-5" />
                        Timeclock
                    </button>

                    {canUseTimeclock && (
                    <button
                        onClick={() => {
                            setActiveTab('clock-history');
                            setIsSidebarOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${activeTab === 'clock-history'
                            ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                            }`}
                    >
                        <History className="w-5 h-5" />
                        <span>Clock History</span>
                    </button>
                    )}

                    {canViewSchedule && (
                    <button
                        onClick={() => { setActiveTab('schedule'); setIsSidebarOpen(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${activeTab === 'schedule'
                            ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                            }`}
                    >
                        <CalendarDays className="w-5 h-5" />
                        <span>My Schedule</span>
                    </button>
                    )}

                    {canEditAvailability && (
                    <button
                        onClick={() => { setActiveTab('availability'); setIsSidebarOpen(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${activeTab === 'availability'
                            ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                            }`}
                    >
                        <Clock className="w-5 h-5" />
                        <span>My Availability</span>
                    </button>
                    )}

                    {/* Training is gated on can_sign_trainings: a role without it does not
                        see the module at all, which is what that permission means. */}
                    {canSignTrainings && (
                    <button
                        onClick={() => { setActiveTab('training'); setIsSidebarOpen(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${activeTab === 'training'
                            ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                            }`}
                    >
                        <GraduationCap className="w-5 h-5" />
                        <span>Training</span>
                    </button>
                    )}

                    {/* Help is open to everyone, like User Settings - no permission gates
                        it, and the guides it lists are the member-facing ones. */}
                    <button
                        onClick={() => { setActiveTab('help'); setIsSidebarOpen(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${activeTab === 'help'
                            ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                            }`}
                    >
                        <BookOpen className="w-5 h-5" />
                        <span>Help</span>
                    </button>

                    <button
                        onClick={() => { setActiveTab('settings'); setIsSidebarOpen(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${activeTab === 'settings' ? 'bg-red-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white'
                            }`}
                    >
                        <Settings className="w-5 h-5" />
                        User Settings
                    </button>

                    {canAdminister && (
                        <button
                            onClick={() => { setActiveTab('admin'); setIsSidebarOpen(false); }}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${activeTab === 'admin' ? 'bg-red-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white'
                                }`}
                        >
                            <ShieldCheck className="w-5 h-5" />
                            Administration
                        </button>
                    )}
                </nav>

                <div className="p-4 border-t border-slate-200 dark:border-slate-700">
                    <button
                        onClick={onLogout}
                        className="w-full flex items-center justify-center gap-2 bg-slate-100 dark:bg-slate-700/50 hover:bg-red-600 text-slate-600 dark:text-slate-300 hover:text-white font-medium py-2.5 px-4 rounded-xl transition"
                    >
                        <LogOut className="w-4 h-4" />
                        Sign Out
                    </button>
                </div>
            </aside>
        </>
    );
}