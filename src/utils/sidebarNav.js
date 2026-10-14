// Helpers and catalog for sidebar navigation order and icon customization.
//
// Admins can configure the order and icons for modules that appear in the sidebar.
// Stored in systemSettings under:
// - 'sidebar_nav_order': comma-delimited string of module IDs.
// - 'sidebar_nav_icons': JSON string mapping moduleId -> iconName.

import {
  LayoutDashboard,
  History,
  MessagesSquare,
  Users,
  CalendarDays,
  Clock,
  GraduationCap,
  BadgeCheck,
  BookText,
  Map as MapIcon,
  BarChart3,
  BookOpen,
  Settings,
  ShieldCheck,
  // Emergency / Fire / Medical
  Flame,
  Siren,
  Truck,
  Radio,
  Shield,
  ShieldAlert,
  ShieldPlus,
  HeartPulse,
  Activity,
  Ambulance,
  Flashlight,
  FireExtinguisher,
  LifeBuoy,
  Heart,
  Stethoscope,
  Cross,
  Syringe,
  Pill,
  HardHat,
  Biohazard,
  // Time & Scheduling
  Calendar,
  Timer,
  Gauge,
  Hourglass,
  AlarmClock,
  CalendarCheck,
  // People & Training
  UserCheck,
  User,
  Award,
  Trophy,
  Medal,
  Crown,
  Zap,
  Target,
  // Communication & Documents
  MessageCircle,
  Bell,
  Megaphone,
  Phone,
  FileText,
  FileCheck,
  ClipboardList,
  ClipboardCheck,
  Folder,
  BookMarked,
  // Places & Tools
  Compass,
  Navigation,
  MapPin,
  Building2,
  Briefcase,
  Wrench,
  Toolbox,
  Sliders,
  SlidersHorizontal,
  Lock,
  Key,
  CheckCircle,
  HelpCircle,
} from 'lucide-react';

export const SIDEBAR_NAV_ORDER_KEY = 'sidebar_nav_order';
export const SIDEBAR_NAV_ICONS_KEY = 'sidebar_nav_icons';

export const DEFAULT_SIDEBAR_NAV_ORDER = [
  'dashboard',
  'clock-history',
  'chat',
  'roster',
  'schedule',
  'availability',
  'training',
  'documents',
  'district-map',
  'reports',
  'help',
  'admin',
];

export const DEFAULT_MODULE_ICONS = {
  dashboard: 'LayoutDashboard',
  'clock-history': 'History',
  chat: 'MessagesSquare',
  roster: 'Users',
  schedule: 'CalendarDays',
  availability: 'Clock',
  training: 'GraduationCap',
  certifications: 'BadgeCheck',
  documents: 'BookText',
  'district-map': 'Map',
  reports: 'BarChart3',
  help: 'BookOpen',
  settings: 'Settings',
  admin: 'ShieldCheck',
};

export const NAV_ICON_MAP = {
  LayoutDashboard,
  History,
  MessagesSquare,
  Users,
  CalendarDays,
  Clock,
  GraduationCap,
  BadgeCheck,
  BookText,
  Map: MapIcon,
  BarChart3,
  BookOpen,
  Settings,
  ShieldCheck,
  Flame,
  Siren,
  Truck,
  Radio,
  Shield,
  ShieldAlert,
  ShieldPlus,
  HeartPulse,
  Activity,
  Ambulance,
  Flashlight,
  FireExtinguisher,
  LifeBuoy,
  Heart,
  Stethoscope,
  Cross,
  Syringe,
  Pill,
  HardHat,
  Biohazard,
  Calendar,
  Timer,
  Gauge,
  Hourglass,
  AlarmClock,
  CalendarCheck,
  UserCheck,
  User,
  Award,
  Trophy,
  Medal,
  Crown,
  Zap,
  Target,
  MessageCircle,
  Bell,
  Megaphone,
  Phone,
  FileText,
  FileCheck,
  ClipboardList,
  ClipboardCheck,
  Folder,
  BookMarked,
  Compass,
  Navigation,
  MapPin,
  Building2,
  Briefcase,
  Wrench,
  Toolbox,
  Sliders,
  SlidersHorizontal,
  Lock,
  Key,
  CheckCircle,
  HelpCircle,
};

export const NAV_ICON_CATEGORIES = [
  'Fire & Emergency',
  'Time & Shifts',
  'Personnel & Crew',
  'Communication & Docs',
  'Operations & System',
];

export const NAV_ICON_OPTIONS = [
  // Fire & Emergency
  { id: 'Flame', label: 'Flame', category: 'Fire & Emergency' },
  { id: 'Siren', label: 'Siren', category: 'Fire & Emergency' },
  { id: 'Truck', label: 'Truck / Engine', category: 'Fire & Emergency' },
  { id: 'Radio', label: 'Radio', category: 'Fire & Emergency' },
  { id: 'FireExtinguisher', label: 'Fire Extinguisher', category: 'Fire & Emergency' },
  { id: 'HardHat', label: 'Hard Hat', category: 'Fire & Emergency' },
  { id: 'Biohazard', label: 'Biohazard', category: 'Fire & Emergency' },
  { id: 'Shield', label: 'Shield', category: 'Fire & Emergency' },
  { id: 'ShieldAlert', label: 'Shield Alert', category: 'Fire & Emergency' },
  { id: 'ShieldPlus', label: 'Shield Plus', category: 'Fire & Emergency' },
  { id: 'LifeBuoy', label: 'Life Buoy', category: 'Fire & Emergency' },
  { id: 'Flashlight', label: 'Flashlight', category: 'Fire & Emergency' },
  { id: 'HeartPulse', label: 'Heart Pulse (EMS)', category: 'Fire & Emergency' },
  { id: 'Activity', label: 'Activity / Vitals', category: 'Fire & Emergency' },
  { id: 'Ambulance', label: 'Ambulance', category: 'Fire & Emergency' },
  { id: 'Stethoscope', label: 'Stethoscope', category: 'Fire & Emergency' },
  { id: 'Cross', label: 'Cross', category: 'Fire & Emergency' },
  { id: 'Heart', label: 'Heart', category: 'Fire & Emergency' },
  { id: 'Syringe', label: 'Syringe', category: 'Fire & Emergency' },
  { id: 'Pill', label: 'Pill', category: 'Fire & Emergency' },

  // Time & Shifts
  { id: 'Clock', label: 'Clock', category: 'Time & Shifts' },
  { id: 'History', label: 'History', category: 'Time & Shifts' },
  { id: 'CalendarDays', label: 'Calendar Days', category: 'Time & Shifts' },
  { id: 'Calendar', label: 'Calendar', category: 'Time & Shifts' },
  { id: 'CalendarCheck', label: 'Calendar Check', category: 'Time & Shifts' },
  { id: 'Timer', label: 'Timer', category: 'Time & Shifts' },
  { id: 'Gauge', label: 'Gauge', category: 'Time & Shifts' },
  { id: 'Hourglass', label: 'Hourglass', category: 'Time & Shifts' },
  { id: 'AlarmClock', label: 'Alarm Clock', category: 'Time & Shifts' },

  // Personnel & Crew
  { id: 'Users', label: 'Crew / Users', category: 'Personnel & Crew' },
  { id: 'User', label: 'Member', category: 'Personnel & Crew' },
  { id: 'UserCheck', label: 'User Check', category: 'Personnel & Crew' },
  { id: 'GraduationCap', label: 'Graduation Cap', category: 'Personnel & Crew' },
  { id: 'BadgeCheck', label: 'Badge Check', category: 'Personnel & Crew' },
  { id: 'Award', label: 'Award', category: 'Personnel & Crew' },
  { id: 'Trophy', label: 'Trophy', category: 'Personnel & Crew' },
  { id: 'Medal', label: 'Medal', category: 'Personnel & Crew' },
  { id: 'Crown', label: 'Crown', category: 'Personnel & Crew' },
  { id: 'Zap', label: 'Zap / Alert', category: 'Personnel & Crew' },
  { id: 'Target', label: 'Target', category: 'Personnel & Crew' },

  // Communication & Docs
  { id: 'MessagesSquare', label: 'Messages Square', category: 'Communication & Docs' },
  { id: 'MessageCircle', label: 'Message Circle', category: 'Communication & Docs' },
  { id: 'Bell', label: 'Bell', category: 'Communication & Docs' },
  { id: 'Megaphone', label: 'Megaphone', category: 'Communication & Docs' },
  { id: 'Phone', label: 'Phone', category: 'Communication & Docs' },
  { id: 'BookText', label: 'Book Text', category: 'Communication & Docs' },
  { id: 'BookOpen', label: 'Book Open', category: 'Communication & Docs' },
  { id: 'BookMarked', label: 'Book Marked', category: 'Communication & Docs' },
  { id: 'FileText', label: 'File Text', category: 'Communication & Docs' },
  { id: 'FileCheck', label: 'File Check', category: 'Communication & Docs' },
  { id: 'ClipboardList', label: 'Clipboard List', category: 'Communication & Docs' },
  { id: 'ClipboardCheck', label: 'Clipboard Check', category: 'Communication & Docs' },
  { id: 'Folder', label: 'Folder', category: 'Communication & Docs' },

  // Operations & System
  { id: 'LayoutDashboard', label: 'Dashboard', category: 'Operations & System' },
  { id: 'Map', label: 'Map', category: 'Operations & System' },
  { id: 'Compass', label: 'Compass', category: 'Operations & System' },
  { id: 'Navigation', label: 'Navigation', category: 'Operations & System' },
  { id: 'MapPin', label: 'Map Pin', category: 'Operations & System' },
  { id: 'Building2', label: 'Building / Station', category: 'Operations & System' },
  { id: 'BarChart3', label: 'Bar Chart', category: 'Operations & System' },
  { id: 'Briefcase', label: 'Briefcase', category: 'Operations & System' },
  { id: 'Wrench', label: 'Wrench', category: 'Operations & System' },
  { id: 'Toolbox', label: 'Toolbox', category: 'Operations & System' },
  { id: 'Sliders', label: 'Sliders', category: 'Operations & System' },
  { id: 'SlidersHorizontal', label: 'Sliders Horizontal', category: 'Operations & System' },
  { id: 'Settings', label: 'Settings', category: 'Operations & System' },
  { id: 'ShieldCheck', label: 'Shield Check', category: 'Operations & System' },
  { id: 'Lock', label: 'Lock', category: 'Operations & System' },
  { id: 'Key', label: 'Key', category: 'Operations & System' },
  { id: 'CheckCircle', label: 'Check Circle', category: 'Operations & System' },
  { id: 'HelpCircle', label: 'Help Circle', category: 'Operations & System' },
];

export const SIDEBAR_MODULE_CATALOG = [
  {
    id: 'dashboard',
    label: 'Timeclock',
    description: 'Timeclock and station dashboard',
    permissionKey: null,
  },
  {
    id: 'clock-history',
    label: 'Clock History',
    description: 'Member clock-in history',
    permissionKey: 'canUseTimeclock',
  },
  {
    id: 'chat',
    label: 'Chat',
    description: 'Station rooms and messaging',
    permissionKey: 'canUseChat',
  },
  {
    id: 'roster',
    label: 'Roster',
    description: 'Crew member roster directory',
    permissionKey: 'canViewRoster',
  },
  {
    id: 'schedule',
    label: 'Schedule',
    description: 'Shift calendar and open shifts',
    permissionKey: 'canViewSchedule',
  },
  {
    id: 'availability',
    label: 'Availability',
    description: 'Monthly availability submission',
    permissionKey: 'canEditAvailability',
  },
  {
    id: 'training',
    label: 'Training',
    description: 'Training sessions and logs',
    permissionKey: 'canSignTrainings',
  },
  {
    id: 'certifications',
    label: 'Certifications',
    description: 'Member certification badges',
    permissionKey: null,
  },
  {
    id: 'documents',
    label: 'Documents',
    description: 'Standard operating guidelines',
    permissionKey: 'canViewDocuments',
  },
  {
    id: 'district-map',
    label: 'District Map',
    description: 'Department boundary and district map',
    permissionKey: 'canViewMap',
  },
  {
    id: 'reports',
    label: 'Reports & Forms',
    description: 'Station reporting and forms',
    permissionKey: 'canViewReports',
  },
  {
    id: 'help',
    label: 'Help',
    description: 'Guides and documentation',
    permissionKey: null,
  },
  {
    id: 'admin',
    label: 'Administration',
    description: 'Station administration and setup',
    permissionKey: 'canAdminister',
  },
];

export function parseSidebarNavOrder(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') {
    return [...DEFAULT_SIDEBAR_NAV_ORDER];
  }
  const parts = rawValue.split(',').map((s) => s.trim()).filter(Boolean);
  const valid = parts.filter((id) => DEFAULT_SIDEBAR_NAV_ORDER.includes(id));
  const result = [];
  for (const id of valid) {
    if (!result.includes(id)) {
      result.push(id);
    }
  }
  // Append any missing modules from default so modules are never lost
  for (const def of DEFAULT_SIDEBAR_NAV_ORDER) {
    if (!result.includes(def)) {
      result.push(def);
    }
  }
  return result;
}

export function formatSidebarNavOrder(moduleIds) {
  if (!Array.isArray(moduleIds)) return DEFAULT_SIDEBAR_NAV_ORDER.join(',');
  const valid = moduleIds.filter((id) => DEFAULT_SIDEBAR_NAV_ORDER.includes(id));
  const result = [];
  for (const id of valid) {
    if (!result.includes(id)) {
      result.push(id);
    }
  }
  for (const def of DEFAULT_SIDEBAR_NAV_ORDER) {
    if (!result.includes(def)) {
      result.push(def);
    }
  }
  return result.join(',');
}

function cleanIconsObject(obj) {
  const result = {};
  for (const [moduleId, iconName] of Object.entries(obj)) {
    if (
      DEFAULT_SIDEBAR_NAV_ORDER.includes(moduleId) &&
      typeof iconName === 'string' &&
      NAV_ICON_MAP[iconName]
    ) {
      result[moduleId] = iconName;
    }
  }
  return result;
}

export function parseSidebarNavIcons(rawValue) {
  if (!rawValue) return {};
  if (typeof rawValue === 'object' && rawValue !== null) {
    return cleanIconsObject(rawValue);
  }
  if (typeof rawValue === 'string') {
    try {
      const parsed = JSON.parse(rawValue);
      if (typeof parsed === 'object' && parsed !== null) {
        return cleanIconsObject(parsed);
      }
    } catch {
      // ignore malformed JSON
    }
  }
  return {};
}

export function formatSidebarNavIcons(icons) {
  if (!icons || typeof icons !== 'object') return '{}';
  const clean = cleanIconsObject(icons);
  return JSON.stringify(clean);
}

export function getSidebarModuleIcon(moduleId, customIcons = {}) {
  const customKey = customIcons?.[moduleId];
  if (customKey && NAV_ICON_MAP[customKey]) {
    return NAV_ICON_MAP[customKey];
  }
  const defaultKey = DEFAULT_MODULE_ICONS[moduleId];
  return (defaultKey && NAV_ICON_MAP[defaultKey]) || LayoutDashboard;
}
