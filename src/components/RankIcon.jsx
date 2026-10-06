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
  HeartPlus, BriefcaseMedical, ScanHeart, SquareActivity, Germ, Van, Toolbox,
  Radiation, Sailboat, Ship, Megaphone, createLucideIcon,
} from 'lucide-react';

// Lucide has no bugle, so this is drawn with the same factory (24px grid, 2px round stroke): a pair of fire bugles, each a
// flared mouthpiece, a band and a tapering body ending in a wide bell. It then behaves like any other icon in the map.
const Bugle = createLucideIcon(
  'bugle',
  [6.5, 17.5].flatMap((cx) => [
    ['path', { d: `M${cx - 2} 2h4l-1.2 4h-1.6z`, key: `mouth-${cx}` }],
    ['path', { d: `M${cx - 1.5} 7h3`, key: `band-${cx}` }],
    ['path', { d: `M${cx - 1.2} 8l-.8 9.5h4l-.8-9.5`, key: `body-${cx}` }],
    ['path', { d: `M${cx - 2} 17.5L${cx - 4} 22h8l-2-4.5`, key: `bell-${cx}` }],
  ])
);

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
  // The second batch, requested for certifications: the medical and rescue side of the same family the ranks
  // draw on. Anything lucide's version here does not export fails the build rather than rendering a question
  // mark, which is how this list is kept honest.
  'heart-plus': HeartPlus,
  'briefcase-medical': BriefcaseMedical,
  'scan-heart': ScanHeart,
  'square-activity': SquareActivity,
  germ: Germ,
  van: Van,
  toolbox: Toolbox,
  radiation: Radiation,
  sailboat: Sailboat,
  ship: Ship,
  bugle: Bugle,
  megaphone: Megaphone,
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
