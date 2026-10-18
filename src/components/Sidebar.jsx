import React from 'react';
import { LayoutDashboard, User, LogOut, History, ShieldCheck, CalendarDays, Clock, BookOpen, BookText, GraduationCap, BadgeCheck, Users, BarChart3, MessagesSquare, Map as MapIcon, X, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import RankIcon from './RankIcon';
import MemberName from './MemberName';
import { stationLogoUrl, stationSyncLoopsUrl, stationSyncOnTransUrl } from '../utils/assets';
// stationLogoUrl() preserved for test contract or department fallback
import PixelBurst from './PixelBurst';
import AnnouncementList from './AnnouncementList';
import {
    SIDEBAR_NAV_ORDER_KEY,
    SIDEBAR_NAV_ICONS_KEY,
    parseSidebarNavOrder,
    parseSidebarNavIcons,
    getSidebarModuleIcon,
} from '../utils/sidebarNav';
import { getSettingValue } from '../utils/systemSettings';
import { useAuth } from '../context/AuthContext';
import { useStationData } from '../context/StationDataContext';

export default function Sidebar({
    currentUser: propUser,
    isClockedIn,
    departmentName: propDept = '',
    activeTab,
    setActiveTab,
    isSidebarOpen,
    setIsSidebarOpen,
    onLogout: propLogout,
    // Module visibility, each driven by a role permission:
    canAdminister: propAdmin,
    canAccessDashboard: propDashboard,
    canViewSchedule: propSchedule,
    canEditAvailability: propAvail,
    canUseTimeclock: propClock,
    canSignTrainings: propTrain,
    canViewDocuments: propDocs,
    canViewMap: propMap = false,
    canViewReports: propReports = false,
    canGenerateForms: propForms = false,
    canViewRoster: propRoster = false,
    canUseChat: propChat = false,
    canViewWorkOrders: propWorkOrders = false,
    ranks: propRanks = [],
    // The member's own announcements for the sidebar, and who to filter them for.
    announcements = [],
    announcementAudience = {},
    systemSettings: propSettings = [],
}) {
    const auth = useAuth();
    const station = useStationData();

    const currentUser = propUser || auth.currentUser;
    const departmentName = propDept || station.departmentName || '';
    const onLogout = propLogout || auth.onLogout;
    const canAdminister = propAdmin !== undefined ? propAdmin : Boolean(auth.canAdminister);
    const canAccessDashboard = propDashboard !== undefined ? propDashboard : (auth.permissions?.canAccessDashboard ?? true);
    const canViewSchedule = propSchedule !== undefined ? propSchedule : Boolean(auth.permissions?.canViewSchedule);
    const canEditAvailability = propAvail !== undefined ? propAvail : Boolean(auth.permissions?.canEditOwnAvailability);
    const canUseTimeclock = propClock !== undefined ? propClock : Boolean(auth.permissions?.canUseTimeclock);
    const canSignTrainings = propTrain !== undefined ? propTrain : Boolean(auth.permissions?.canSignTrainings);
    const canViewDocuments = propDocs !== undefined ? propDocs : Boolean(auth.permissions?.canViewDocuments);
    const canViewMap = propMap || Boolean(auth.permissions?.canViewMap);
    const canViewReports = propReports || Boolean(auth.permissions?.canViewReports);
    const canGenerateForms = propForms || Boolean(auth.permissions?.canGenerateForms);
    const canViewRoster = propRoster || Boolean(auth.permissions?.canViewRoster);
    const canUseChat = propChat || Boolean(auth.permissions?.canUseChat);
    const canViewWorkOrders = propWorkOrders || Boolean(auth.permissions?.canViewWorkOrders);
    const ranks = propRanks && propRanks.length ? propRanks : (station.ranks || []);
    const systemSettings = propSettings && propSettings.length ? propSettings : (station.systemSettings || []);
    const [easterEggCount, setEasterEggCount] = React.useState(0);
    // Trigger pixel effect when clicking the logo.
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

    const [isCollapsed, setIsCollapsed] = React.useState(() => {
        try {
            return window.localStorage.getItem('stationsync:sidebar_collapsed') === 'true';
        } catch {
            return false;
        }
    });

    const toggleCollapse = () => {
        setIsCollapsed((prev) => {
            const next = !prev;
            try {
                window.localStorage.setItem('stationsync:sidebar_collapsed', String(next));
            } catch {
                // ignore
            }
            return next;
        });
    };

    const currentUserRank = ranks.find((r) => String(r.id) === String(currentUser?.rank_id));

    const sidebarNavIcons = React.useMemo(() => {
        const raw = getSettingValue(systemSettings, SIDEBAR_NAV_ICONS_KEY, '');
        return parseSidebarNavIcons(raw);
    }, [systemSettings]);

    const sidebarNavOrder = React.useMemo(() => {
        const raw = getSettingValue(systemSettings, SIDEBAR_NAV_ORDER_KEY, '');
        return parseSidebarNavOrder(raw);
    }, [systemSettings]);

    const renderNavButton = (moduleId) => {
        const NavIcon = getSidebarModuleIcon(moduleId, sidebarNavIcons);
        switch (moduleId) {
            case 'dashboard':
                return canAccessDashboard ? (
                    <button
                        key="dashboard"
                        onClick={() => { setActiveTab('dashboard'); setIsSidebarOpen(false); }}
                        className={`w-full flex items-center ${isCollapsed ? 'gap-3 md:gap-0 md:justify-center px-4 py-3 md:px-0 md:py-3' : 'gap-3 px-4 py-3'} rounded-xl text-sm font-medium transition ${activeTab === 'dashboard' ? 'bg-red-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        title={isCollapsed ? 'Dashboard' : undefined}
                    >
                        <NavIcon className="w-5 h-5 shrink-0" />
                        <span className={isCollapsed ? 'md:hidden' : ''}>Dashboard</span>
                    </button>
                ) : null;
            case 'clock-history':
                return canUseTimeclock ? (
                    <button
                        key="clock-history"
                        onClick={() => {
                            setActiveTab('clock-history');
                            setIsSidebarOpen(false);
                        }}
                        className={`w-full flex items-center ${isCollapsed ? 'gap-3 md:gap-0 md:justify-center px-4 py-3 md:px-0 md:py-3' : 'gap-3 px-4 py-3'} rounded-xl text-sm font-medium transition ${activeTab === 'clock-history'
                            ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        title={isCollapsed ? 'Clock History' : undefined}
                    >
                        <NavIcon className="w-5 h-5 shrink-0" />
                        <span className={isCollapsed ? 'md:hidden' : ''}>Clock History</span>
                    </button>
                ) : null;
            case 'apparatus':
                return (
                    <button
                        key="apparatus"
                        onClick={() => {
                            setActiveTab('apparatus');
                            setIsSidebarOpen(false);
                        }}
                        className={`w-full flex items-center ${isCollapsed ? 'gap-3 md:gap-0 md:justify-center px-4 py-3 md:px-0 md:py-3' : 'gap-3 px-4 py-3'} rounded-xl text-sm font-medium transition ${activeTab === 'apparatus'
                            ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        title={isCollapsed ? 'Apparatus Registry' : undefined}
                    >
                        <NavIcon className="w-5 h-5 shrink-0" />
                        <span className={isCollapsed ? 'md:hidden' : ''}>Apparatus Registry</span>
                    </button>
                );
            case 'chat':
                return canUseChat ? (
                    <button
                        key="chat"
                        onClick={() => { setActiveTab('chat'); setIsSidebarOpen(false); }}
                        className={`w-full flex items-center ${isCollapsed ? 'gap-3 md:gap-0 md:justify-center px-4 py-3 md:px-0 md:py-3' : 'gap-3 px-4 py-3'} rounded-xl text-sm font-medium transition ${activeTab === 'chat'
                            ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        title={isCollapsed ? 'Chat' : undefined}
                    >
                        <NavIcon className="w-5 h-5 shrink-0" />
                        <span className={isCollapsed ? 'md:hidden' : ''}>Chat</span>
                    </button>
                ) : null;
            case 'roster':
                return canViewRoster ? (
                    <button
                        key="roster"
                        onClick={() => { setActiveTab('roster'); setIsSidebarOpen(false); }}
                        className={`w-full flex items-center ${isCollapsed ? 'gap-3 md:gap-0 md:justify-center px-4 py-3 md:px-0 md:py-3' : 'gap-3 px-4 py-3'} rounded-xl text-sm font-medium transition ${activeTab === 'roster'
                            ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        title={isCollapsed ? 'Roster' : undefined}
                    >
                        <NavIcon className="w-5 h-5 shrink-0" />
                        <span className={isCollapsed ? 'md:hidden' : ''}>Roster</span>
                    </button>
                ) : null;
            case 'schedule':
                return canViewSchedule ? (
                    <button
                        key="schedule"
                        onClick={() => { setActiveTab('schedule'); setIsSidebarOpen(false); }}
                        className={`w-full flex items-center ${isCollapsed ? 'gap-3 md:gap-0 md:justify-center px-4 py-3 md:px-0 md:py-3' : 'gap-3 px-4 py-3'} rounded-xl text-sm font-medium transition ${activeTab === 'schedule'
                            ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        title={isCollapsed ? 'Schedule' : undefined}
                    >
                        <NavIcon className="w-5 h-5 shrink-0" />
                        <span className={isCollapsed ? 'md:hidden' : ''}>Schedule</span>
                    </button>
                ) : null;
            case 'availability':
                return canEditAvailability ? (
                    <button
                        key="availability"
                        onClick={() => { setActiveTab('availability'); setIsSidebarOpen(false); }}
                        className={`w-full flex items-center ${isCollapsed ? 'gap-3 md:gap-0 md:justify-center px-4 py-3 md:px-0 md:py-3' : 'gap-3 px-4 py-3'} rounded-xl text-sm font-medium transition ${activeTab === 'availability'
                            ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        title={isCollapsed ? 'Availability' : undefined}
                    >
                        <NavIcon className="w-5 h-5 shrink-0" />
                        <span className={isCollapsed ? 'md:hidden' : ''}>Availability</span>
                    </button>
                ) : null;
            case 'training':
                return canSignTrainings ? (
                    <button
                        key="training"
                        onClick={() => { setActiveTab('training'); setIsSidebarOpen(false); }}
                        className={`w-full flex items-center ${isCollapsed ? 'gap-3 md:gap-0 md:justify-center px-4 py-3 md:px-0 md:py-3' : 'gap-3 px-4 py-3'} rounded-xl text-sm font-medium transition ${activeTab === 'training'
                            ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        title={isCollapsed ? 'Training' : undefined}
                    >
                        <NavIcon className="w-5 h-5 shrink-0" />
                        <span className={isCollapsed ? 'md:hidden' : ''}>Training</span>
                    </button>
                ) : null;
            case 'certifications':
                return (
                    <button
                        key="certifications"
                        onClick={() => { setActiveTab('certifications'); setIsSidebarOpen(false); }}
                        className={`w-full flex items-center ${isCollapsed ? 'gap-3 md:gap-0 md:justify-center px-4 py-3 md:px-0 md:py-3' : 'gap-3 px-4 py-3'} rounded-xl text-sm font-medium transition ${activeTab === 'certifications'
                            ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        title={isCollapsed ? 'Certifications' : undefined}
                    >
                        <NavIcon className="w-5 h-5 shrink-0" />
                        <span className={isCollapsed ? 'md:hidden' : ''}>Certifications</span>
                    </button>
                );
            case 'documents':
                return (
                    <React.Fragment key="documents">
                        {canViewDocuments && (
                            <button
                                onClick={() => { setActiveTab('documents'); setIsSidebarOpen(false); }}
                                className={`w-full flex items-center ${isCollapsed ? 'gap-3 md:gap-0 md:justify-center px-4 py-3 md:px-0 md:py-3' : 'gap-3 px-4 py-3'} rounded-xl text-sm font-medium transition ${activeTab === 'documents'
                                    ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                title={isCollapsed ? 'Documents' : undefined}
                            >
                                <NavIcon className="w-5 h-5 shrink-0" />
                                <span className={isCollapsed ? 'md:hidden' : ''}>Documents</span>
                            </button>
                        )}
                    </React.Fragment>
                );
            case 'work-orders':
                return canViewWorkOrders ? (
                    <button
                        key="work-orders"
                        onClick={() => { setActiveTab('work-orders'); setIsSidebarOpen(false); }}
                        className={`w-full flex items-center ${isCollapsed ? 'gap-3 md:gap-0 md:justify-center px-4 py-3 md:px-0 md:py-3' : 'gap-3 px-4 py-3'} rounded-xl text-sm font-medium transition ${activeTab === 'work-orders'
                            ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        title={isCollapsed ? 'Work Orders' : undefined}
                    >
                        <NavIcon className="w-5 h-5 shrink-0" />
                        <span className={isCollapsed ? 'md:hidden' : ''}>Work Orders</span>
                    </button>
                ) : null;
            case 'district-map':
                return (
                    <React.Fragment key="district-map">
                        {canViewMap && (
                            <button
                                onClick={() => { setActiveTab('district-map'); setIsSidebarOpen(false); }}
                                className={`w-full flex items-center ${isCollapsed ? 'gap-3 md:gap-0 md:justify-center px-4 py-3 md:px-0 md:py-3' : 'gap-3 px-4 py-3'} rounded-xl text-sm font-medium transition ${activeTab === 'district-map'
                                    ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                title={isCollapsed ? 'District Map' : undefined}
                            >
                                <NavIcon className="w-5 h-5 shrink-0" />
                                <span className={isCollapsed ? 'md:hidden' : ''}>District Map</span>
                            </button>
                        )}
                    </React.Fragment>
                );
            case 'reports':
                return (canViewReports || canGenerateForms) ? (
                    <button
                        key="reports"
                        onClick={() => { setActiveTab('reports'); setIsSidebarOpen(false); }}
                        className={`w-full flex items-center ${isCollapsed ? 'gap-3 md:gap-0 md:justify-center px-4 py-3 md:px-0 md:py-3' : 'gap-3 px-4 py-3'} rounded-xl text-sm font-medium transition ${activeTab === 'reports'
                            ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        title={isCollapsed ? 'Reports & Forms' : undefined}
                    >
                        <NavIcon className="w-5 h-5 shrink-0" />
                        <span className={isCollapsed ? 'md:hidden' : ''}>Reports &amp; Forms</span>
                    </button>
                ) : null;
            case 'help':
                return (
                    <button
                        key="help"
                        onClick={() => { setActiveTab('help'); setIsSidebarOpen(false); }}
                        className={`w-full flex items-center ${isCollapsed ? 'gap-3 md:gap-0 md:justify-center px-4 py-3 md:px-0 md:py-3' : 'gap-3 px-4 py-3'} rounded-xl text-sm font-medium transition ${activeTab === 'help'
                            ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        title={isCollapsed ? 'Help' : undefined}
                    >
                        <NavIcon className="w-5 h-5 shrink-0" />
                        <span className={isCollapsed ? 'md:hidden' : ''}>Help</span>
                    </button>
                );
            case 'admin':
                return canAdminister ? (
                    <button
                        key="admin"
                        onClick={() => { setActiveTab('admin'); setIsSidebarOpen(false); }}
                        className={`w-full flex items-center ${isCollapsed ? 'gap-3 md:gap-0 md:justify-center px-4 py-3 md:px-0 md:py-3' : 'gap-3 px-4 py-3'} rounded-xl text-sm font-medium transition ${activeTab === 'admin' ? 'bg-red-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        title={isCollapsed ? 'Administration' : undefined}
                    >
                        <NavIcon className="w-5 h-5 shrink-0" />
                        <span className={isCollapsed ? 'md:hidden' : ''}>Administration</span>
                    </button>
                ) : null;
            default:
                return null;
        }
    };
    return (
        <>
            {isSidebarOpen && (
                <div
                    onClick={() => setIsSidebarOpen(false)}
                    className="fixed inset-0 bg-black/60 z-20 md:hidden animate-fadeIn"
                />
            )}

            {/* Mobile drawer accounts for device safe-area insets (notch and home indicator). */}
            <aside className={`
        fixed md:static md:h-dvh inset-y-0 left-0 z-30 ${isCollapsed ? 'w-64 md:w-20' : 'w-64'} bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex flex-col transition-all duration-200 ease-in-out pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:pt-0 md:pb-0 overflow-hidden overscroll-y-contain
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
                <div className={`flex items-center ${isCollapsed ? 'justify-between md:justify-center p-5 md:p-4' : 'justify-between p-5 md:p-6'} border-b border-slate-200 dark:border-slate-700`}>
                    <a
                        href="#"
                        className={`relative flex items-center ${isCollapsed ? 'gap-3 md:gap-0 md:justify-center' : 'gap-3'} min-w-0 group`}
                        onClick={(e) => {
                            e.preventDefault();
                            handleEasterEgg();
                        }}
                        title={isCollapsed ? (departmentName ? `${departmentName} • StationSync` : 'StationSync') : undefined}
                    >
                        <img
                            src={stationSyncLoopsUrl()}
                            alt="StationSync"
                            className="h-9 w-9 shrink-0 object-contain drop-shadow-sm transition-transform duration-200 group-hover:scale-105"
                        />
                        <div className={`flex flex-col min-w-0 justify-center ${isCollapsed ? 'md:hidden' : ''}`}>
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

                <div
                    className={`p-4 m-4 bg-slate-100 dark:bg-slate-900/60 rounded-xl border ${
                        activeTab === 'profile' || activeTab === 'settings'
                            ? 'border-red-500/50 ring-2 ring-red-500/20'
                            : 'border-slate-200 dark:border-slate-700/50'
                    } flex items-center ${
                        isCollapsed ? 'gap-3 md:gap-0 md:p-2 md:m-2 md:justify-center' : 'gap-3'
                    }`}
                    title={isCollapsed ? `${currentUser.name} • Status: ${isClockedIn ? 'On Duty' : 'Off Duty'} • Click to view profile` : undefined}
                >
                    <button
                        type="button"
                        onClick={() => { setActiveTab('profile'); setIsSidebarOpen(false); }}
                        className="p-2 bg-slate-200 dark:bg-slate-800 rounded-lg shrink-0 relative text-left cursor-pointer hover:bg-slate-300 dark:hover:bg-slate-700 transition"
                        style={{ color: currentUserRank?.color || undefined }}
                        title="View Profile"
                    >
                        {currentUserRank ? (
                            <RankIcon name={currentUserRank.icon} className="w-5 h-5" />
                        ) : (
                            <User className="w-5 h-5 text-slate-500 dark:text-slate-300" />
                        )}
                        {isCollapsed && (
                            <span
                                className={`hidden md:block absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-slate-800 ${
                                    isClockedIn ? 'bg-emerald-500' : 'bg-slate-400'
                                }`}
                            />
                        )}
                    </button>
                    <div className={`overflow-hidden ${isCollapsed ? 'md:hidden' : ''}`}>
                        <button
                            type="button"
                            onClick={() => { setActiveTab('profile'); setIsSidebarOpen(false); }}
                            className="font-semibold text-sm text-slate-900 dark:text-white truncate text-left hover:text-red-600 dark:hover:text-red-400 hover:underline transition cursor-pointer max-w-full block"
                            title="View Profile"
                        >
                            <MemberName user={currentUser} nameClassName="truncate" />
                        </button>
                        <p className="text-xs text-slate-500 dark:text-slate-400 capitalize">Status: {isClockedIn ? 'On Duty' : 'Off Duty'}</p>
                    </div>
                </div>

                {/* Sidebar announcements displayed between the user card and navigation. */}
                <div className={isCollapsed ? 'px-4 pb-2 md:px-2' : 'px-4 pb-2'}>
                  <AnnouncementList
                    announcements={announcements}
                    location="is_visible_on_sidebar"
                    audience={announcementAudience}
                    compact
                    iconOnly={isCollapsed}
                  />
                </div>

                <nav className={`flex-1 min-h-0 overflow-y-auto overscroll-y-contain ${isCollapsed ? 'px-4 md:px-2 space-y-1' : 'px-4 space-y-1'}`}>
                    {sidebarNavOrder.map(renderNavButton)}
                </nav>

                <div className={`p-4 border-t border-slate-200 dark:border-slate-700 ${isCollapsed ? 'md:p-2' : ''}`}>
                    <div className={`flex items-center gap-2 ${isCollapsed ? 'flex-row md:flex-col' : 'flex-row'}`}>
                        <button
                            onClick={onLogout}
                            className={`w-full flex items-center justify-center gap-2 bg-red-100 dark:bg-red-700/50 hover:bg-red-600 text-slate-600 dark:text-slate-300 hover:text-white font-medium py-2.5 px-3 rounded-xl transition ${
                                isCollapsed ? 'md:px-0' : 'flex-1'
                            }`}
                            title="Sign Out"
                        >
                            <LogOut className="w-4 h-4 shrink-0" />
                            <span className={isCollapsed ? 'md:hidden' : ''}>Sign Out</span>
                        </button>

                        {/* Toggle Collapse button: Desktop only (hidden on mobile) */}
                        <button
                            type="button"
                            onClick={toggleCollapse}
                            className={`hidden md:flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-700/50 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition ${
                                isCollapsed ? 'w-full py-2.5 px-0' : 'p-2.5 shrink-0'
                            }`}
                            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                        >
                            {isCollapsed ? (
                                <PanelLeftOpen className="w-4 h-4 shrink-0" />
                            ) : (
                                <PanelLeftClose className="w-4 h-4 shrink-0" />
                            )}
                        </button>
                    </div>
                </div>
            </aside>
        </>
    );
}