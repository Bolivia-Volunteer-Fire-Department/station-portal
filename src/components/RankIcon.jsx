import React from 'react';
import {
  HelpCircle, Star, Shield, ShieldCheck, ShieldAlert, ShieldPlus, Award, Crown,
  ChevronUp, ChevronsUp, Flame, Siren, Users, User, UserCheck, Zap,
  BadgeCheck, Medal, Trophy, Anchor, Compass, Target, Truck, Wrench,
  Heart, HeartPulse, Ambulance, Flashlight, Radio, Phone, Briefcase,
  GraduationCap, BookOpen, CheckCircle, Circle, Square, Diamond,
  Hexagon, Octagon, Triangle, TriangleAlert, Cross, Stethoscope, Syringe, Pill,
  Activity, LifeBuoy, FireExtinguisher, Biohazard, HardHat, Droplet, Wind,
  HandHelping, BadgePlus, ClipboardCheck, FileCheck, IdCard, BookMarked,
  Ribbon, Hash, Microscope, Beaker, TestTube, RefreshCw, Clock,
} from 'lucide-react';

// Curated, tree-shakable subset of lucide icons commonly used for ranks/badges
export const RANK_ICON_MAP = {
  star: Star,
  shield: Shield,
  'shield-check': ShieldCheck,
  'shield-alert': ShieldAlert,
  // Added for announcements, where an exclamation triangle is the default. Ranks and assignments can
  // use it too.
  'triangle-alert': TriangleAlert,
  'shield-plus': ShieldPlus,
  award: Award,
  crown: Crown,
  'chevron-up': ChevronUp,
  'chevrons-up': ChevronsUp,
  flame: Flame,
  siren: Siren,
  users: Users,
  user: User,
  'user-check': UserCheck,
  zap: Zap,
  'badge-check': BadgeCheck,
  medal: Medal,
  trophy: Trophy,
  anchor: Anchor,
  compass: Compass,
  target: Target,
  truck: Truck,
  wrench: Wrench,
  heart: Heart,
  'heart-pulse': HeartPulse,
  ambulance: Ambulance,
  flashlight: Flashlight,
  radio: Radio,
  phone: Phone,
  briefcase: Briefcase,
  'graduation-cap': GraduationCap,
  'book-open': BookOpen,
  'check-circle': CheckCircle,
  circle: Circle,
  square: Square,
  diamond: Diamond,
  hexagon: Hexagon,
  octagon: Octagon,
  triangle: Triangle,
  // Emergency-services badges, added for certifications: a station tracks licences, not just ranks, and the
  // icons for those are medical and inspection-shaped rather than command-shaped.
  cross: Cross,
  stethoscope: Stethoscope,
  syringe: Syringe,
  pill: Pill,
  activity: Activity,
  'life-buoy': LifeBuoy,
  'fire-extinguisher': FireExtinguisher,
  biohazard: Biohazard,
  'hard-hat': HardHat,
  droplet: Droplet,
  wind: Wind,
  'hand-helping': HandHelping,
  'badge-plus': BadgePlus,
  'clipboard-check': ClipboardCheck,
  'file-check': FileCheck,
  'id-card': IdCard,
  'book-marked': BookMarked,
  ribbon: Ribbon,
  hash: Hash,
  microscope: Microscope,
  beaker: Beaker,
  'test-tube': TestTube,
  'refresh-cw': RefreshCw,
  clock: Clock,
};

// An icon NAME that is a number or a roman numeral is drawn as that text rather than as a glyph.
//
// Lucide has no digit icons, and "1", "2", "III" are exactly what a station uses for levels ("Instructor 1",
// "Level III"), so refusing them would mean numbering by hand in the name. Anything that is only digits or
// roman numerals is rendered as a text badge in the same slot, sized from the font rather than from the box.
const LABEL_ICON = /^(?:\d{1,2}|[IVX]{1,4})$/;

export default function RankIcon({ name, className = 'w-4 h-4', ...props }) {
  const key = String(name || '').trim();
  const lower = key.toLowerCase();

  if (LABEL_ICON.test(key)) {
    return (
      <span
        {...props}
        className={`inline-flex items-center justify-center font-bold leading-none ${className}`}
        aria-hidden="true"
      >
        {key}
      </span>
    );
  }

  const IconComponent = RANK_ICON_MAP[lower] || HelpCircle;
  return <IconComponent className={className} {...props} />;
}
