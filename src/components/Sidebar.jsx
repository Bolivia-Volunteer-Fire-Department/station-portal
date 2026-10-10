import React from 'react';
import { LayoutDashboard, User, Settings, LogOut, History, ShieldCheck, CalendarDays, Clock, BookOpen, BookText, GraduationCap, BadgeCheck, Users, BarChart3, MessagesSquare, X } from 'lucide-react';
import RankIcon from './RankIcon';
import CertificationBadges from './CertificationBadges';
import { stationLogoUrl, stationSyncLoopsUrl, stationSyncOnTransUrl } from '../utils/assets';
// stationLogoUrl() preserved for test contract or department fallback
import PixelBurst from './PixelBurst';
import AnnouncementList from './AnnouncementList';

export default function Sidebar({
    currentUser,
    isClockedIn,
    departmentName = '',
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
    canViewDocuments,
    canViewReports = false,
    canGenerateForms = false,
    canViewRoster = false,
    canUseChat = false,
    ranks = [],
    // The member's own announcements for the sidebar, and who to filter them for.
    announcements = [],
    announcementAudience = {},
}) {
    const [easterEggCount, setEasterEggCount] = React.useState(0);
    // Every press fires the pixel burst, whether or not that press is also counting towards the
    // easter egg (the sixth does not increment, and the burst must not skip it).
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

    const currentUserRank = ranks.find((r) => String(r.id) === String(currentUser?.rank_id));
    return (
        <>
            {isSidebarOpen && (
                <div
                    onClick={() => setIsSidebarOpen(false)}
                    className="fixed inset-0 bg-black/60 z-20 md:hidden animate-fadeIn"
                />
            )}

            {/* The drawer is a full-height window of its own on a phone, so it clears the status bar and
                the home indicator the same way the shell does - `pt-`/`pb-` with the safe-area insets,
                which are 0 on any device without them and unused at md, where this is a static column. */}
            <aside className={`
        fixed md:static md:h-dvh inset-y-0 left-0 z-30 w-64 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex flex-col transition-transform duration-200 ease-in-out pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:pt-0 md:pb-0 overflow-hidden overscroll-y-contain
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
                <div className="flex items-center justify-between p-5 md:p-6 border-b border-slate-200 dark:border-slate-700">
                    {/* The burst is placed off the anchor, so the anchor is the containing block. */}
                    <a
                        href="#"
                        className="relative flex items-center gap-3 min-w-0 group"
                        onClick={(e) => {
                            e.preventDefault();
                            handleEasterEgg();
                        }}
                    >
                        <img
                            src={stationSyncLoopsUrl()}
                            alt="StationSync"
                            className="h-9 w-9 shrink-0 object-contain drop-shadow-sm transition-transform duration-200 group-hover:scale-105"
                        />
                        <div className="flex flex-col min-w-0 justify-center">
                            {departmentName ? (
                                <span
                                    className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate max-w-[145px] leading-tight mb-0.5"
                                    title={departmentName}
                                >
                                    {departmentName}
                                </span>
                            ) : null}
                            <span className="text-xl font-extrabold tracking-tight leading-none text-slate-800 dark:text-white flex items-center">
                                Station<span className="bg-gradient-to-r from-red-500 to-red-600 bg-clip-text text-transparent">Sync</span>
                            </span>
                        </div>
                        <PixelBurst trigger={easterBurst} />
                    </a>
                    <button
                        type="button"
                        onClick={() => setIsSidebarOpen(false)}
                        className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                        aria-label="Close navigation menu"
                    >
                        <X className="w-5 h-5" />
                    </button>
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
                        <p className="text-xs text-slate-500 dark:text-slate-400 capitalize">Status: {isClockedIn ? 'On Duty' : 'Off Duty'}</p>
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

                <nav className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-4 space-y-1">
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

                    {canUseChat && (
                    <button
                        onClick={() => { setActiveTab('chat'); setIsSidebarOpen(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${activeTab === 'chat'
                            ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                            }`}
                    >
                        <MessagesSquare className="w-5 h-5" />
                        <span>Chat</span>
                    </button>)}

                    {canViewRoster && (
                    <button
                        onClick={() => { setActiveTab('roster'); setIsSidebarOpen(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${activeTab === 'roster'
                            ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                            }`}
                    >
                        <Users className="w-5 h-5" />
                        <span>Roster</span>
                    </button>)}

                    {canViewSchedule && (
                    <button
                        onClick={() => { setActiveTab('schedule'); setIsSidebarOpen(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${activeTab === 'schedule'
                            ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                            }`}
                    >
                        <CalendarDays className="w-5 h-5" />
                        <span>Schedule</span>
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
                        <span>Availability</span>
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

                    {/* My Certifications: the member's own records, shown to everyone rather than gated on a
                        permission - it is their own paperwork, and a permission whose column did not exist yet
                        would hide it from the very people it is about. See the note in utils/permissions. */}
                    <button
                        onClick={() => { setActiveTab('certifications'); setIsSidebarOpen(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${activeTab === 'certifications'
                            ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                            }`}
                    >
                        <BadgeCheck className="w-5 h-5" />
                        <span>Certifications</span>
                        <CertificationBadges userId={currentUser?.id} className="w-3.5 h-3.5" iconClassName="text-current opacity-80" />
                    </button>

                    {/* Documents is gated on can_view_documents - the permission that means "may read documents at
                        all". Which documents are INSIDE the module is still decided by the server (published, live
                        on today's date, and at or above the member's rank); this only decides whether the module is
                        offered. The other two documents permissions both require this one, so a role that manages or
                        verifies documents always has it. */}
                    {canViewDocuments && (
                    <button
                        onClick={() => { setActiveTab('documents'); setIsSidebarOpen(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${activeTab === 'documents'
                            ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                            }`}
                    >
                        <BookText className="w-5 h-5" />
                        <span>Documents</span>
                    </button>
                    )}

                    {/* Reports and Forms are ONE entry now, gated on EITHER permission, because the module behind it
                        shows whichever half the member holds (see ReportsAndFormsModule). Testing one flag alone here
                        would hide the whole entry from a member who holds only the other. WHICH reports and forms appear
                        inside is still decided by each definition's own audience, proved on the server against the
                        member's role and rank - this only decides whether the screen is offered at all. */}
                    {(canViewReports || canGenerateForms) && (
                    <button
                        onClick={() => { setActiveTab('reports'); setIsSidebarOpen(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${activeTab === 'reports'
                            ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white'
                            }`}
                    >
                        <BarChart3 className="w-5 h-5" />
                        <span>Reports &amp; Forms</span>
                    </button>
                    )}

                    {/* Help is open to everyone, like My Settings - no permission gates
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
                        My Settings
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