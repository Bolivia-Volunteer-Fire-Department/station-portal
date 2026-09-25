import React from 'react';
import {
  HelpCircle, Star, Shield, ShieldCheck, ShieldAlert, ShieldPlus, Award, Crown,
  ChevronUp, ChevronsUp, Flame, Siren, Users, User, UserCheck, Zap,
  BadgeCheck, Medal, Trophy, Anchor, Compass, Target, Truck, Wrench,
  Heart, HeartPulse, Ambulance, Flashlight, Radio, Phone, Briefcase,
  GraduationCap, BookOpen, CheckCircle, Circle, Square, Diamond,
  Hexagon, Octagon, Triangle, TriangleAlert,
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
};

export default function RankIcon({ name, ...props }) {
  const IconComponent = RANK_ICON_MAP[String(name || '').trim().toLowerCase()] || HelpCircle;
  return <IconComponent {...props} />;
}
