import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Award,
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  FileCheck2,
  FileText,
  Flame,
  History,
  Lock,
  Mail,
  MapPin,
  Moon,
  Printer,
  Search,
  Shield,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Sun,
  Truck,
  Users,
  WifiOff,
  Wrench,
  X,
} from 'lucide-react';
import { stationSyncLoopsUrl } from '../utils/assets';
import { APP_VERSION } from '../utils/appVersion';
import { hasGuideContent, helpGuides } from '../utils/helpGuides';
import { parseChangelog } from '../utils/changelog';
import { parseInline } from '../utils/markdown';
import Markdown from '../components/Markdown';
import PrintableHelpGuide from '../components/printable/PrintableHelpGuide';
import termsMarkdown from '../content/help/member/98-terms-of-service.md?raw';
import privacyMarkdown from '../content/help/member/99-privacy-policy.md?raw';
import dpaMarkdown from '../content/help/admin/99-Data Processing Addendum.md?raw';

const FEATURE_PILLARS = [
  {
    id: 'dashboard',
    title: 'Customizable Dashboard & Timeclock',
    badge: 'Daily Operations',
    icon: Clock,
    accent: 'from-red-500 to-orange-500',
    guideScope: 'member',
    guideSlug: '02-timeclock',
    summary:
      'A real-time operational command center built for station kiosks, apparatus iPads, and member phones. See who is scheduled vs. clocked in at a glance, punch in with geofence verification, and track tasks and notes.',
    bullets: [
      'Currently On Duty widget separates scheduled crew (highlighted in green when clocked in) from additional clocked-in responders.',
      'Drag-and-drop resizable widget grid: Station Time, On Duty, Upcoming Shifts, Apparatus Readiness, Tasks & Notes, and Announcements.',
      'One-tap Clock History modal with running shift totals and audit-ready timestamps.',
      'Offline safeguard disables clock punches only when disconnected so server-verified timestamps remain tamper-proof.',
    ],
    previewType: 'dashboard',
  },
  {
    id: 'scheduling',
    title: 'Shift Scheduling, Swaps & Availability',
    badge: 'Workforce Management',
    icon: Calendar,
    accent: 'from-amber-500 to-red-500',
    guideScope: 'admin',
    guideSlug: '07-schedule-management',
    summary:
      'Replace spreadsheets and group texts with a fast drag-and-drop schedule board that cross-references member availability, rank eligibility, and shift templates in real time.',
    bullets: [
      'Hold-and-drag officer schedule board with instant shift swapping and conflict explanations.',
      'Member shift-offer workflows that automatically decline sibling offers once a shift is filled.',
      'Configurable Availability Windows so volunteer and part-time personnel submit availability on time.',
      'Monthly, Weekly, Daily, and Auto views plus one-click Google Calendar / iCal export and printable station schedules.',
    ],
    previewType: 'scheduling',
  },
  {
    id: 'map',
    title: 'Interactive District Map & Pre-Incident Plans',
    badge: 'Situational Awareness',
    icon: MapPin,
    accent: 'from-sky-500 to-blue-600',
    guideScope: 'member',
    guideSlug: '14-district-map',
    summary:
      'Map your response district boundaries, color-coded fire hydrants, target hazards, and multi-tab Pre-Incident Plans so crews have critical building intelligence before arriving on scene.',
    bullets: [
      'Bulk CSV Hydrant Import with NFPA flow-rate color coding, pressure specs, and out-of-service flags.',
      'Structured Pre-Incident Plans covering Building Construction, Fire Protection Systems, Utilities, HazMat, and Tactical Diagrams.',
      'Custom GeoJSON/SVG station district and mutual-aid boundary overlays.',
      'Printable Pre-Incident Plan sheets formatted for apparatus binders.',
    ],
    previewType: 'map',
  },
  {
    id: 'fleet',
    title: 'Apparatus, Equipment & Work Orders',
    badge: 'Fleet & Asset Readiness',
    icon: Truck,
    accent: 'from-emerald-500 to-teal-600',
    guideScope: 'admin',
    guideSlug: '27-apparatus',
    summary:
      'Track every engine, ladder, medic unit, and piece of loose equipment across your stations—complete with maintenance records, defect reporting, and automated work order queues.',
    bullets: [
      'Live Apparatus status tracking (In Service, Out of Service, Maintenance) visible across the station.',
      'Equipment inventory assigned to specific apparatus compartments, stations, or individual personnel.',
      'Integrated Work Orders module with priority badges, status tracking, and officer notifications.',
      'Complete apparatus maintenance and inspection history logs.',
    ],
    previewType: 'fleet',
  },
  {
    id: 'training',
    title: 'Training Sign-Offs & Certifications',
    badge: 'Compliance & Credentials',
    icon: Award,
    accent: 'from-violet-500 to-indigo-600',
    guideScope: 'admin',
    guideSlug: '19-certifications',
    summary:
      'Keep ISO training hours, state transcripts, EMT/Paramedic licenses, and apparatus driver qualifications organized with automated expiration tracking and PDF transcript imports.',
    bullets: [
      'Bulk import state training transcripts via PDF or CSV directly into member Certification records.',
      'Digital member sign-offs and officer verification for company drills and department trainings.',
      'Qualification badges displayed directly alongside member names on the Roster and Schedule board.',
      'Printable training attendance rosters and certification compliance reports.',
    ],
    previewType: 'training',
  },
  {
    id: 'docs',
    title: 'SOP Documents, PDF Forms & Station Chat',
    badge: 'Communications & SOPs',
    icon: FileCheck2,
    accent: 'from-rose-500 to-red-600',
    guideScope: 'admin',
    guideSlug: '13-documents',
    summary:
      'Publish rank-targeted Standard Operating Procedures, orientation checklists, and Assessments—and map station data directly onto official state PDF forms.',
    bullets: [
      'Rich Markdown SOP editor, New-Hire Orientation Checklists, and scored Assessments with verification badges.',
      'Configurable PDF Form Exporter that maps member and station fields onto existing state/municipal PDF templates.',
      'Real-time Station Chat with presence indicators, channels, and custom notification sounds.',
      'StationSync-branded printable Reference Manuals and administrative reports.',
    ],
    previewType: 'docs',
  },
];

const ADMIN_GUIDE_GROUPS = [
  {
    label: 'Getting Started & People',
    match: (slug) => /^(01|02|03|04|19|20)-/.test(slug),
  },
  {
    label: 'Scheduling & Timeclock',
    match: (slug) => /^(05|06|07|08|09|10|11|21)-/.test(slug),
  },
  {
    label: 'Training, Documents & Comms',
    match: (slug) => /^(12|13|14|22|23|24)-/.test(slug),
  },
  {
    label: 'District Map, Fleet & Assets',
    match: (slug) => /^(25|26|27|28|31)-/.test(slug),
  },
  {
    label: 'Dashboard, System & Compliance',
    match: () => true,
  },
];

const LEGAL_DOCS = [
  {
    id: 'terms',
    title: 'Terms of Service',
    badge: 'Service Agreement',
    slug: '98-terms-of-service',
    scope: 'member',
    summary: 'Governs access to and use of the StationSync platform by subscribing emergency services agencies and authorized personnel.',
    markdown: termsMarkdown,
  },
  {
    id: 'privacy',
    title: 'Privacy Policy',
    badge: 'Data Privacy',
    slug: '99-privacy-policy',
    scope: 'member',
    summary: 'Details how StationSync collects, secures, and processes member profile records, active timeclock geofence checks, and operational logs.',
    markdown: privacyMarkdown,
  },
  {
    id: 'dpa',
    title: 'Data Processing Addendum (DPA)',
    badge: 'Agency Compliance',
    slug: '99-Data Processing Addendum',
    scope: 'admin',
    summary: 'Formal Controller/Processor addendum and security controls schedule for fire districts, municipalities, and agency boards.',
    markdown: dpaMarkdown,
  },
];

function renderInlineTokens(tokens) {
  return (tokens || []).map((token, idx) => {
    if (token.type === 'text') return <React.Fragment key={idx}>{token.value}</React.Fragment>;
    if (token.type === 'code') {
      return (
        <code
          key={idx}
          className="rounded bg-slate-200/80 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-red-600 dark:text-red-400"
        >
          {token.value}
        </code>
      );
    }
    if (token.type === 'bold') {
      return (
        <strong key={idx} className="font-semibold text-slate-900 dark:text-white">
          {renderInlineTokens(token.children)}
        </strong>
      );
    }
    if (token.type === 'italic') {
      return <em key={idx}>{renderInlineTokens(token.children)}</em>;
    }
    if (token.type === 'link') {
      return (
        <a
          key={idx}
          href={token.href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-red-600 dark:text-red-400 underline underline-offset-2"
        >
          {renderInlineTokens(token.children)}
        </a>
      );
    }
    return <React.Fragment key={idx}>{renderInlineTokens(token.children)}</React.Fragment>;
  });
}

function parseHashRoute(hashStr) {
  const raw = String(hashStr || '').replace(/^#\/?/, '').trim();
  if (!raw || raw === 'overview' || raw === 'features') {
    return { tab: 'overview', section: raw || 'overview' };
  }
  if (raw === 'docs-admin') {
    return { tab: 'docs', scope: 'admin', slug: '' };
  }
  if (raw.startsWith('docs')) {
    const parts = raw.split('/');
    // #docs/admin/07-schedule-management or #docs/member/02-timeclock
    const scope = parts[1] === 'admin' ? 'admin' : 'member';
    const slug = parts[2] ? decodeURIComponent(parts[2]) : '';
    return { tab: 'docs', scope, slug };
  }
  if (raw.startsWith('changelog')) {
    return { tab: 'changelog' };
  }
  if (raw.startsWith('legal')) {
    const parts = raw.split('/');
    return { tab: 'legal', legalId: parts[1] || 'terms' };
  }
  return { tab: 'overview' };
}

export default function StationSyncSite() {
  const [isDark, setIsDark] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [activePillarId, setActivePillarId] = useState(FEATURE_PILLARS[0].id);

  // Documentation state
  const memberGuides = useMemo(() => helpGuides('member').filter((g) => !/^9[89]-/.test(g.slug)), []);
  const adminGuides = useMemo(() => helpGuides('admin').filter((g) => !/^9[89]-/.test(g.slug)), []);
  const [docScope, setDocScope] = useState('member');
  const [activeMemberSlug, setActiveMemberSlug] = useState(memberGuides[0]?.slug || '');
  const [activeAdminSlug, setActiveAdminSlug] = useState(adminGuides[0]?.slug || '');
  const [docSearch, setDocSearch] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  // Changelog state
  const releases = useMemo(() => parseChangelog(), []);
  const [changelogSearch, setChangelogSearch] = useState('');
  const [changelogTag, setChangelogTag] = useState('All');

  // Legal hub state
  const [activeLegalId, setActiveLegalId] = useState('terms');

  // Print state
  const [printTarget, setPrintTarget] = useState(null);

  // Sync theme with <html class="dark">
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', isDark);
    }
  }, [isDark]);

  // Sync URL hash with active view
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const applyHash = () => {
      const route = parseHashRoute(window.location.hash);
      setActiveTab(route.tab);
      if (route.tab === 'docs') {
        if (route.scope) setDocScope(route.scope);
        if (route.slug) {
          if (route.scope === 'admin') setActiveAdminSlug(route.slug);
          else setActiveMemberSlug(route.slug);
        }
      } else if (route.tab === 'legal' && route.legalId) {
        setActiveLegalId(route.legalId);
      }
    };
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, []);

  const navigateTo = (tab, extra = {}) => {
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      if (tab === 'docs') {
        const nextScope = extra.scope || docScope;
        const nextSlug =
          extra.slug || (nextScope === 'admin' ? activeAdminSlug : activeMemberSlug);
        setDocScope(nextScope);
        if (extra.slug) {
          if (nextScope === 'admin') setActiveAdminSlug(extra.slug);
          else setActiveMemberSlug(extra.slug);
        }
        window.history.replaceState(null, '', `#docs/${nextScope}/${encodeURIComponent(nextSlug)}`);
      } else if (tab === 'legal') {
        const nextLegal = extra.legalId || activeLegalId;
        setActiveLegalId(nextLegal);
        window.history.replaceState(null, '', `#legal/${nextLegal}`);
      } else if (tab === 'changelog') {
        window.history.replaceState(null, '', '#changelog');
      } else {
        window.history.replaceState(null, '', '#overview');
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const activeGuides = docScope === 'admin' ? adminGuides : memberGuides;
  const currentDocSlug = docScope === 'admin' ? activeAdminSlug : activeMemberSlug;
  const activeGuide =
    activeGuides.find((g) => g.slug === currentDocSlug) || activeGuides[0] || null;
  const activeGuideIndex = activeGuides.findIndex((g) => g.slug === activeGuide?.slug);

  const selectGuide = (scope, slug) => {
    setDocScope(scope);
    if (scope === 'admin') setActiveAdminSlug(slug);
    else setActiveMemberSlug(slug);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `#docs/${scope}/${encodeURIComponent(slug)}`);
    }
  };

  // Global search across both Member and Admin guides when a search query is typed
  const searchResults = useMemo(() => {
    const q = docSearch.trim().toLowerCase();
    if (!q) return null;
    const all = [
      ...memberGuides.map((g) => ({ ...g, scope: 'member', scopeLabel: 'Member Guide' })),
      ...adminGuides.map((g) => ({ ...g, scope: 'admin', scopeLabel: 'Admin Guide' })),
    ];
    return all
      .map((guide) => {
        const titleHit = guide.title.toLowerCase().includes(q);
        const bodyLower = guide.markdown.toLowerCase();
        const bodyIdx = bodyLower.indexOf(q);
        if (!titleHit && bodyIdx === -1) return null;
        let snippet = '';
        if (bodyIdx !== -1) {
          const start = Math.max(0, bodyIdx - 50);
          const end = Math.min(guide.markdown.length, bodyIdx + q.length + 90);
          snippet =
            (start > 0 ? '…' : '') +
            guide.markdown
              .slice(start, end)
              .replace(/[#>*`|]/g, '')
              .replace(/\s+/g, ' ')
              .trim() +
            (end < guide.markdown.length ? '…' : '');
        }
        return { ...guide, titleHit, snippet };
      })
      .filter(Boolean);
  }, [docSearch, memberGuides, adminGuides]);

  // Grouped admin guides for clean sidebar navigation
  const groupedAdminGuides = useMemo(() => {
    const remaining = [...adminGuides];
    return ADMIN_GUIDE_GROUPS.map((group) => {
      const items = [];
      for (let i = remaining.length - 1; i >= 0; i -= 1) {
        if (group.match(remaining[i].slug)) {
          items.unshift(remaining[i]);
          remaining.splice(i, 1);
        }
      }
      return { label: group.label, items };
    }).filter((g) => g.items.length > 0);
  }, [adminGuides]);

  // Filtered changelog releases
  const filteredReleases = useMemo(() => {
    const q = changelogSearch.trim().toLowerCase();
    return releases
      .map((rel) => {
        const matchingItems = rel.items.filter((item) => {
          const matchesTag = changelogTag === 'All' || item.tag === changelogTag;
          const matchesQuery =
            !q ||
            item.text.toLowerCase().includes(q) ||
            rel.heading.toLowerCase().includes(q);
          return matchesTag && matchesQuery;
        });
        return { ...rel, items: matchingItems };
      })
      .filter((rel) => rel.items.length > 0);
  }, [releases, changelogSearch, changelogTag]);

  const totalChangelogItems = useMemo(
    () => releases.reduce((sum, r) => sum + r.items.length, 0),
    [releases]
  );

  const activePillar =
    FEATURE_PILLARS.find((p) => p.id === activePillarId) || FEATURE_PILLARS[0];
  const activeLegalDoc =
    LEGAL_DOCS.find((d) => d.id === activeLegalId) || LEGAL_DOCS[0];

  const handleCopyGuideLink = () => {
    if (!activeGuide || typeof window === 'undefined') return;
    const url = `${window.location.origin}${window.location.pathname}#docs/${docScope}/${encodeURIComponent(activeGuide.slug)}`;
    navigator.clipboard?.writeText(url);
    setCopiedLink(true);
    window.setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div className="min-h-dvh bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100 flex flex-col selection:bg-red-600 selection:text-white">
      {/* Top Accent Bar */}
      <div className="h-1 w-full bg-gradient-to-r from-red-600 via-amber-500 to-sky-500 shrink-0" />

      {/* Sticky Site Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* Brand Logo & Wordmark */}
          <button
            type="button"
            onClick={() => navigateTo('overview')}
            className="flex items-center gap-3 text-left group cursor-pointer"
          >
            <img
              src={stationSyncLoopsUrl()}
              alt="StationSync"
              className="h-9 w-9 shrink-0 object-contain drop-shadow-sm transition-transform duration-200 group-hover:scale-105"
            />
            <div className="flex items-center gap-2.5">
              <span className="text-xl font-extrabold tracking-tight leading-none text-slate-900 dark:text-white flex items-center">
                Station<span className="text-red-500">Sync</span>
              </span>
              <span className="hidden sm:inline-flex items-center rounded-full bg-red-500/10 dark:bg-red-500/15 border border-red-500/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-red-600 dark:text-red-400">
                v{APP_VERSION !== 'undefined' ? APP_VERSION : '1.8x'}
              </span>
            </div>
          </button>

          {/* Primary Navigation */}
          <nav
            aria-label="Primary site navigation"
            className="flex items-center gap-1 sm:gap-1.5 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-200 dark:border-slate-700/70 overflow-x-auto"
          >
            {[
              { id: 'overview', label: 'Overview & Features', shortLabel: 'Features', icon: Sparkles },
              {
                id: 'docs',
                label: 'Help & Docs',
                shortLabel: 'Docs',
                icon: BookOpen,
                badge: memberGuides.length + adminGuides.length,
              },
              {
                id: 'changelog',
                label: 'Changelog',
                shortLabel: 'Changelog',
                icon: History,
              },
              {
                id: 'legal',
                label: 'Legal & DPA',
                shortLabel: 'Legal',
                icon: Shield,
              },
            ].map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateTo(item.id)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs sm:text-sm font-semibold whitespace-nowrap transition cursor-pointer ${
                    isActive
                      ? 'bg-red-600 text-white shadow-sm shadow-red-600/30'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-700/50'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden md:inline">{item.label}</span>
                  <span className="md:hidden">{item.shortLabel}</span>
                  {item.badge && (
                    <span
                      className={`hidden lg:inline-flex items-center justify-center rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                        isActive
                          ? 'bg-white/20 text-white'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Right Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsDark((prev) => !prev)}
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition cursor-pointer"
              title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
              aria-label="Toggle color theme"
            >
              {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
            </button>
            <a
              href="mailto:support@stationsync.net?subject=StationSync%20Department%20Inquiry"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-white px-3.5 py-2 text-xs font-bold text-white dark:text-slate-900 hover:opacity-90 transition shadow-sm"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>Contact</span>
            </a>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        {activeTab === 'overview' && (
          <div>
            {/* Hero Section */}
            <section className="relative overflow-hidden border-b border-slate-200 dark:border-slate-800 bg-gradient-to-b from-white via-slate-50 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-900 py-14 sm:py-20">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
                  {/* Left Hero Copy */}
                  <div className="lg:col-span-7 space-y-6">
                    <div className="inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-3.5 py-1 text-xs font-semibold text-red-600 dark:text-red-400">
                      <Flame className="w-3.5 h-3.5" />
                      <span>Built <i>by</i> firefighters, <i>for</i> firefighters.</span>
                    </div>

                    <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-[1.12]">
                      Every station operation, schedule, and pre-plan in{' '}
                      <span className="bg-gradient-to-r from-red-500 via-orange-500 to-amber-500 bg-clip-text text-transparent">
                        one unified command platform.
                      </span>
                    </h1>

                    <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
                      StationSync brings together real-time on-duty tracking, drag-and-drop shift scheduling,
                      interactive district maps with Pre-Incident Plans, apparatus &amp; work order management,
                      certification transcript imports, and SOP documentation—engineered to feel instant on
                      station kiosks, apparatus tablets, and firefighter phones.
                    </p>

                    <div className="flex flex-wrap items-center gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => navigateTo('docs', { scope: 'member', slug: '01-getting-started' })}
                        className="inline-flex items-center gap-2 rounded-xl bg-red-600 hover:bg-red-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-red-600/25 transition cursor-pointer"
                      >
                        <BookOpen className="w-4 h-4" />
                        <span>Browse Documentation</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => navigateTo('docs', { scope: 'admin', slug: '01-getting-started' })}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 px-5 py-3 text-sm font-semibold text-slate-800 dark:text-slate-100 transition cursor-pointer"
                      >
                        <ShieldCheck className="w-4 h-4 text-sky-500" />
                        <span>Administration Guides</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => navigateTo('changelog')}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white/70 dark:bg-slate-800/60 hover:bg-white dark:hover:bg-slate-800 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 transition cursor-pointer"
                      >
                        <History className="w-4 h-4 text-amber-500" />
                        <span>What&apos;s New in v{APP_VERSION !== 'undefined' ? APP_VERSION : '1.8x'}</span>
                      </button>
                    </div>

                    {/* Key Metrics Strip */}
                    <div className="grid grid-cols-3 gap-4 pt-4 border-t border-slate-200 dark:border-slate-800">
                      <div>
                        <div className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white">
                          {memberGuides.length + adminGuides.length}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          Member &amp; Admin Guides
                        </div>
                      </div>
                      <div>
                        <div className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white">
                          {releases.length} Releases
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {totalChangelogItems}+ Shipped Improvements
                        </div>
                      </div>
                      <div>
                        <div className="text-xl sm:text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
                          Offline-First
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          Self-Healing Cloud Sync
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Live Interactive Station Dashboard Mockup */}
                  <div className="lg:col-span-5">
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/90 shadow-2xl overflow-hidden">
                      {/* Window Header */}
                      <div className="bg-slate-900 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <img
                            src={stationSyncLoopsUrl()}
                            alt=""
                            className="h-5 w-5 object-contain"
                          />
                          <span className="text-xs font-extrabold tracking-tight text-white">
                            Station<span className="text-red-500">Sync</span>
                          </span>
                          <span className="text-[10px] text-slate-400 font-medium">
                            &bull; Station 1 Command Kiosk
                          </span>
                        </div>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          Live Sync
                        </span>
                      </div>

                      {/* Mockup Body */}
                      <div className="p-4 space-y-4 bg-slate-50 dark:bg-slate-900/60">
                        {/* Currently On Duty Widget Preview */}
                        <div className="rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800 p-3.5 space-y-3 shadow-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                              <Users className="w-3.5 h-3.5 text-red-500" />
                              Currently On Duty
                            </span>
                            <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                              4 Scheduled &bull; 1 Additional
                            </span>
                          </div>

                          <div className="space-y-1.5">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                              Scheduled for Current Shift
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              {[
                                { name: 'Capt. M. Holloway', role: 'Engine 1 • Officer', clockedIn: true, badges: ['FO-II', 'EMT-P'] },
                                { name: 'Eng. R. Vance', role: 'Engine 1 • Driver/Op', clockedIn: true, badges: ['DO-P', 'EMT'] },
                                { name: 'FF J. Alvarez', role: 'Ladder 1 • Nozzle', clockedIn: true, badges: ['FF-II', 'HM-O'] },
                                { name: 'FF K. Lindqvist', role: 'Medic 1 • Attendant', clockedIn: false, badges: ['EMT-P'] },
                              ].map((member) => (
                                <div
                                  key={member.name}
                                  className={`rounded-lg px-2.5 py-2 border text-left transition ${
                                    member.clockedIn
                                      ? 'border-emerald-500 bg-emerald-500/5 dark:bg-emerald-500/10 ring-1 ring-emerald-500/30'
                                      : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                      {member.name}
                                    </span>
                                    {member.clockedIn && (
                                      <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" title="Clocked In" />
                                    )}
                                  </div>
                                  <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                                    {member.role}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="pt-2 border-t border-slate-200 dark:border-slate-700/70 space-y-1.5">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                              Clocked In &bull; Unscheduled / Callback
                            </div>
                            <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 px-2.5 py-1.5">
                              <span className="h-2 w-2 rounded-full bg-sky-500" />
                              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                                Lt. D. Mercer
                              </span>
                              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                                Training Detail
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Apparatus & District Mini Strip */}
                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800 p-3 space-y-1.5">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                              <Truck className="w-3 h-3 text-emerald-500" />
                              Fleet Status
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-slate-800 dark:text-slate-200">Engine 1</span>
                              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                                In Service
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-slate-800 dark:text-slate-200">Ladder 1</span>
                              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                                1 Open Work Order
                              </span>
                            </div>
                          </div>

                          <div className="rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800 p-3 space-y-1.5">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-sky-500" />
                              District Intelligence
                            </div>
                            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                              312 Hydrants Mapped
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              48 Active Pre-Incident Plans
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Interactive 6-Pillar Feature Explorer */}
            <section id="features" className="py-16 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
              <div className="text-center max-w-3xl mx-auto space-y-3">
                <div className="text-xs font-bold uppercase tracking-widest text-red-600 dark:text-red-400">
                  Platform Capabilities
                </div>
                <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                  Purpose-built modules for every role in the firehouse
                </h2>
                <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400">
                  Select a module below to explore how StationSync streamlines daily operations for both active
                  crew members and department administrators.
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Left Module Selector Tabs */}
                <div className="lg:col-span-5 flex flex-col gap-2">
                  {FEATURE_PILLARS.map((pillar) => {
                    const Icon = pillar.icon;
                    const isSelected = pillar.id === activePillar.id;
                    return (
                      <button
                        key={pillar.id}
                        type="button"
                        onClick={() => setActivePillarId(pillar.id)}
                        className={`w-full text-left rounded-2xl p-4 border transition cursor-pointer flex items-start gap-3.5 ${
                          isSelected
                            ? 'bg-white dark:bg-slate-800 border-red-500/60 ring-2 ring-red-500/20 shadow-lg'
                            : 'bg-white/60 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 hover:bg-white dark:hover:bg-slate-800/80'
                        }`}
                      >
                        <div
                          className={`p-2.5 rounded-xl bg-gradient-to-br ${pillar.accent} text-white shrink-0 shadow-sm`}
                        >
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                            {pillar.badge}
                          </div>
                          <div className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                            {pillar.title}
                          </div>
                        </div>
                        <ChevronRight
                          className={`w-4 h-4 mt-2 shrink-0 transition-transform ${
                            isSelected ? 'text-red-500 translate-x-0.5' : 'text-slate-400'
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>

                {/* Right Active Feature Detail Panel */}
                <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 sm:p-8 shadow-xl space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-700 pb-5">
                    <div className="flex items-center gap-3.5">
                      {(() => {
                        const ActiveIcon = activePillar.icon;
                        return (
                          <div
                            className={`p-3 rounded-2xl bg-gradient-to-br ${activePillar.accent} text-white shadow-md`}
                          >
                            <ActiveIcon className="w-6 h-6" />
                          </div>
                        );
                      })()}
                      <div>
                        <span className="text-xs font-bold uppercase tracking-wider text-red-600 dark:text-red-400">
                          {activePillar.badge}
                        </span>
                        <h3 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white">
                          {activePillar.title}
                        </h3>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        navigateTo('docs', {
                          scope: activePillar.guideScope,
                          slug: activePillar.guideSlug,
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-700/80 hover:bg-red-600 hover:text-white dark:hover:bg-red-600 px-3.5 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 transition cursor-pointer"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>Read Full Guide</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed">
                    {activePillar.summary}
                  </p>

                  <div className="space-y-3">
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      Key Operational Highlights
                    </div>
                    <ul className="space-y-2.5">
                      {activePillar.bullets.map((bullet, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-200"
                        >
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Quick Jump Links to Related Guides */}
                  <div className="pt-4 border-t border-slate-200 dark:border-slate-700/80 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Want to see how this module is configured or used day-to-day?
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => navigateTo('docs', { scope: 'member' })}
                        className="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline cursor-pointer"
                      >
                        Member Guides &rarr;
                      </button>
                      <span className="text-slate-300 dark:text-slate-600">&bull;</span>
                      <button
                        type="button"
                        onClick={() => navigateTo('docs', { scope: 'admin' })}
                        className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline cursor-pointer"
                      >
                        Admin Guides &rarr;
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Architecture & Reliability Grid (Deferred below-the-fold) */}
            <section className="site-deferred-section border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/60 py-16">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
                <div className="max-w-2xl space-y-2">
                  <div className="text-xs font-bold uppercase tracking-widest text-sky-600 dark:text-sky-400">
                    Engineered for Emergency Services
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                    Fast, resilient, and auditable by design
                  </h2>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  {[
                    {
                      icon: WifiOff,
                      title: 'Offline-Resilient Reads',
                      desc: 'Schedules, clock history, SOP documents, and help guides remain accessible even when apparatus tablets lose cellular signal.',
                    },
                    {
                      icon: Lock,
                      title: 'Granular Role Permissions',
                      desc: 'Customize access per rank or role across 20+ administrative capabilities—with server-enforced Firestore security rules.',
                    },
                    {
                      icon: Printer,
                      title: 'Print & State Form Ready',
                      desc: 'Generate StationSync-branded printable schedules, training rosters, reference manuals, and pre-filled state PDF forms.',
                    },
                    {
                      icon: Smartphone,
                      title: 'Kiosk & Mobile Native Feel',
                      desc: 'Installable PWA with safe-area notch support, mobile bottom action bar, dark/light themes, and subtle tactile audio feedback.',
                    },
                  ].map((card) => {
                    const CardIcon = card.icon;
                    return (
                      <div
                        key={card.title}
                        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-5 space-y-3"
                      >
                        <div className="inline-flex p-2.5 rounded-xl bg-red-500/10 text-red-600 dark:text-red-400">
                          <CardIcon className="w-5 h-5" />
                        </div>
                        <h3 className="text-base font-bold text-slate-900 dark:text-white">
                          {card.title}
                        </h3>
                        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                          {card.desc}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          </div>
        )}

        {/* Documentation Center (#docs / #docs-admin) */}
        {activeTab === 'docs' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
            {/* Docs Top Header & Search Bar */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-bold uppercase tracking-widest text-red-600 dark:text-red-400">
                    StationSync Knowledge Base
                  </div>
                  <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                    Help &amp; Documentation Center
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                    Complete reference manuals for active station members and department administrators.
                  </p>
                </div>

                {/* Audience Scope Toggle */}
                <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-900 p-1 border border-slate-200 dark:border-slate-700 self-start md:self-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setDocScope('member');
                      setDocSearch('');
                      selectGuide('member', activeMemberSlug || memberGuides[0]?.slug);
                    }}
                    className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition cursor-pointer ${
                      docScope === 'member'
                        ? 'bg-red-600 text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>Member Guides ({memberGuides.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDocScope('admin');
                      setDocSearch('');
                      selectGuide('admin', activeAdminSlug || adminGuides[0]?.slug);
                    }}
                    className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition cursor-pointer ${
                      docScope === 'admin'
                        ? 'bg-red-600 text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Wrench className="w-3.5 h-3.5" />
                    <span>Administration Guides ({adminGuides.length})</span>
                  </button>
                </div>
              </div>

              {/* Search Input across all guides */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={docSearch}
                  onChange={(e) => setDocSearch(e.target.value)}
                  placeholder="Search across all Member and Administration guides (e.g., 'hydrant import', 'shift swap', 'certifications', 'pre-incident')..."
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/90 pl-10 pr-10 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
                {docSearch && (
                  <button
                    type="button"
                    onClick={() => setDocSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer"
                    aria-label="Clear search"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Search Results Overlay List */}
              {searchResults && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3 space-y-2 max-h-80 overflow-y-auto">
                  <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 px-1">
                    Found {searchResults.length} matching guide{searchResults.length === 1 ? '' : 's'}
                  </div>
                  {searchResults.length === 0 ? (
                    <p className="text-xs text-slate-500 px-1 py-2">
                      No guides matched &ldquo;{docSearch}&rdquo;. Try another keyword.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {searchResults.map((hit) => (
                        <button
                          key={`${hit.scope}:${hit.slug}`}
                          type="button"
                          onClick={() => {
                            selectGuide(hit.scope, hit.slug);
                            setDocSearch('');
                          }}
                          className="text-left rounded-lg border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800 p-3 hover:border-red-500 transition cursor-pointer space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-bold text-slate-900 dark:text-white truncate">
                              {hit.title}
                            </span>
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                                hit.scope === 'admin'
                                  ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
                                  : 'bg-red-500/15 text-red-600 dark:text-red-400'
                              }`}
                            >
                              {hit.scopeLabel}
                            </span>
                          </div>
                          {hit.snippet && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                              {hit.snippet}
                            </p>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Docs Reader Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Sidebar Navigation */}
              <aside className="lg:col-span-4 xl:col-span-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 shadow-sm lg:sticky lg:top-20 max-h-[calc(100dvh-6.5rem)] overflow-y-auto space-y-4">
                {docScope === 'member' ? (
                  <div className="space-y-1">
                    <div className="px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Member Modules
                    </div>
                    {memberGuides.map((guide) => {
                      const isActive = activeGuide?.slug === guide.slug;
                      const num = /^(\d{2})-/.exec(guide.slug)?.[1];
                      return (
                        <button
                          key={guide.slug}
                          type="button"
                          onClick={() => selectGuide('member', guide.slug)}
                          className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition cursor-pointer ${
                            isActive
                              ? 'bg-red-600 text-white shadow-sm shadow-red-600/20'
                              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60'
                          }`}
                        >
                          {num && (
                            <span
                              className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                isActive
                                  ? 'bg-white/20 text-white'
                                  : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {num}
                            </span>
                          )}
                          <span className="truncate">{guide.title}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {groupedAdminGuides.map((group) => (
                      <div key={group.label} className="space-y-1">
                        <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                          {group.label}
                        </div>
                        {group.items.map((guide) => {
                          const isActive = activeGuide?.slug === guide.slug;
                          const num = /^(\d{2})-/.exec(guide.slug)?.[1];
                          return (
                            <button
                              key={guide.slug}
                              type="button"
                              onClick={() => selectGuide('admin', guide.slug)}
                              className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition cursor-pointer ${
                                isActive
                                  ? 'bg-red-600 text-white shadow-sm shadow-red-600/20'
                                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60'
                              }`}
                            >
                              {num && (
                                <span
                                  className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                    isActive
                                      ? 'bg-white/20 text-white'
                                      : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                                  }`}
                                >
                                  {num}
                                </span>
                              )}
                              <span className="truncate">{guide.title}</span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </aside>

              {/* Right Guide Article Card */}
              <article className="lg:col-span-8 xl:col-span-9 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl overflow-hidden">
                {activeGuide && (
                  <div>
                    {/* Guide Card Header */}
                    <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 flex flex-wrap items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                              docScope === 'admin'
                                ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
                                : 'bg-red-500/15 text-red-600 dark:text-red-400'
                            }`}
                          >
                            {docScope === 'admin' ? 'Administration Guide' : 'Member Help Guide'}
                          </span>
                          {/^(\d{2})-/.exec(activeGuide.slug)?.[1] && (
                            <span className="font-mono text-xs text-slate-400">
                              Section {/^(\d{2})-/.exec(activeGuide.slug)[1]}
                            </span>
                          )}
                        </div>
                        <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white">
                          {activeGuide.title}
                        </h2>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleCopyGuideLink}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition cursor-pointer"
                          title="Copy direct link to this guide"
                        >
                          {copiedLink ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-500" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 text-slate-400" />
                              <span>Share link</span>
                            </>
                          )}
                        </button>

                        {hasGuideContent(activeGuide) && (
                          <button
                            type="button"
                            onClick={() =>
                              setPrintTarget({
                                guide: activeGuide,
                                scope: docScope,
                              })
                            }
                            className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-500 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition cursor-pointer"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            <span>Print guide</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Guide Markdown Body */}
                    <div className="p-6 sm:p-8">
                      <Markdown markdown={activeGuide.markdown} />
                    </div>

                    {/* Prev / Next Footer Navigation */}
                    <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30 flex items-center justify-between gap-4">
                      {activeGuideIndex > 0 ? (
                        <button
                          type="button"
                          onClick={() =>
                            selectGuide(docScope, activeGuides[activeGuideIndex - 1].slug)
                          }
                          className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 transition cursor-pointer"
                        >
                          <ChevronLeft className="w-4 h-4" />
                          <span>{activeGuides[activeGuideIndex - 1].title}</span>
                        </button>
                      ) : (
                        <div />
                      )}

                      {activeGuideIndex >= 0 && activeGuideIndex < activeGuides.length - 1 ? (
                        <button
                          type="button"
                          onClick={() =>
                            selectGuide(docScope, activeGuides[activeGuideIndex + 1].slug)
                          }
                          className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 transition cursor-pointer ml-auto"
                        >
                          <span>{activeGuides[activeGuideIndex + 1].title}</span>
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      ) : (
                        <div />
                      )}
                    </div>
                  </div>
                )}
              </article>
            </div>
          </div>
        )}

        {/* Changelog Timeline (#changelog) */}
        {activeTab === 'changelog' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
            {/* Changelog Header & Filter Controls */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm space-y-5">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-xs font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400">
                    Continuous Product Evolution
                  </div>
                  <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                    Release Notes &amp; Changelog
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                    Tracking {totalChangelogItems} features, performance optimizations, security enhancements, and fixes across {releases.length} release series.
                  </p>
                </div>

                {/* Search Input */}
                <div className="relative w-full md:w-80">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={changelogSearch}
                    onChange={(e) => setChangelogSearch(e.target.value)}
                    placeholder="Filter changelog entries..."
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 pl-9 pr-8 py-2 text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                  {changelogSearch && (
                    <button
                      type="button"
                      onClick={() => setChangelogSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Category Filter Pills */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-700/60">
                {['All', 'Feature', 'Performance', 'Security & Access', 'Fix', 'Improvement'].map(
                  (tag) => {
                    const active = changelogTag === tag;
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => setChangelogTag(tag)}
                        className={`rounded-lg px-3 py-1 text-xs font-semibold transition cursor-pointer ${
                          active
                            ? 'bg-red-600 text-white shadow-sm'
                            : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                        }`}
                      >
                        {tag}
                      </button>
                    );
                  }
                )}
              </div>
            </div>

            {/* Changelog Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Version Jump Sidebar */}
              <aside className="hidden lg:block lg:col-span-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 shadow-sm sticky top-20 space-y-1">
                <div className="px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Release Series
                </div>
                {filteredReleases.map((rel, idx) => (
                  <a
                    key={rel.id}
                    href={`#${rel.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(rel.id)?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="flex items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          idx === 0 ? 'bg-red-500' : 'bg-slate-400 dark:bg-slate-600'
                        }`}
                      />
                      <span>{rel.heading}</span>
                    </span>
                    <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-mono text-slate-500 dark:text-slate-300">
                      {rel.items.length}
                    </span>
                  </a>
                ))}
              </aside>

              {/* Right Release Cards */}
              <div className="lg:col-span-9 space-y-6">
                {filteredReleases.map((rel, idx) => (
                  <section
                    key={rel.id}
                    id={rel.id}
                    className={`${
                      idx > 1 ? 'site-deferred-section ' : ''
                    }rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden`}
                  >
                    <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/50 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center justify-center rounded-xl bg-red-600 px-3 py-1 font-mono text-xs font-bold text-white shadow-sm">
                          v{rel.version}
                        </span>
                        <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">
                          {rel.heading}
                        </h2>
                        {idx === 0 && (
                          <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                            Latest Series
                          </span>
                        )}
                      </div>
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        {rel.items.length} {rel.items.length === 1 ? 'update' : 'updates'}
                      </span>
                    </div>

                    <ul className="divide-y divide-slate-100 dark:divide-slate-700/50">
                      {rel.items.map((item, itemIdx) => {
                        const badgeColors = {
                          red: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
                          sky: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
                          amber:
                            'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
                          emerald:
                            'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
                          slate:
                            'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/20',
                        };
                        return (
                          <li
                            key={itemIdx}
                            className="px-6 py-3.5 flex flex-col sm:flex-row sm:items-baseline gap-2 sm:gap-3.5 text-sm text-slate-700 dark:text-slate-200"
                          >
                            <span
                              className={`self-start shrink-0 inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider w-32 justify-center ${
                                badgeColors[item.tone] || badgeColors.slate
                              }`}
                            >
                              {item.tag}
                            </span>
                            <span className="leading-relaxed">
                              {renderInlineTokens(parseInline(item.text))}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Legal & Compliance Hub (#legal) */}
        {activeTab === 'legal' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-bold uppercase tracking-widest text-sky-600 dark:text-sky-400">
                    Governance, Privacy &amp; Agency Agreements
                  </div>
                  <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                    Legal &amp; Compliance Hub
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                    Review and print StationSync&apos;s Terms of Service, Privacy Policy, and Municipal Data Processing Addendum.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setPrintTarget({
                      guide: {
                        title: activeLegalDoc.title,
                        slug: activeLegalDoc.slug,
                        markdown: activeLegalDoc.markdown,
                      },
                      scope: activeLegalDoc.scope,
                    })
                  }
                  className="inline-flex items-center gap-2 rounded-xl bg-red-600 hover:bg-red-500 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition cursor-pointer self-start md:self-auto"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print {activeLegalDoc.title}</span>
                </button>
              </div>

              {/* Document Selector Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                {LEGAL_DOCS.map((doc) => {
                  const isSelected = doc.id === activeLegalDoc.id;
                  return (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => navigateTo('legal', { legalId: doc.id })}
                      className={`text-left rounded-xl p-4 border transition cursor-pointer space-y-1.5 ${
                        isSelected
                          ? 'border-red-500 bg-red-500/5 dark:bg-red-500/10 ring-2 ring-red-500/20'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 hover:bg-white dark:hover:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">
                          {doc.badge}
                        </span>
                        <FileText className="w-4 h-4 text-slate-400" />
                      </div>
                      <div className="text-sm font-bold text-slate-900 dark:text-white">
                        {doc.title}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                        {doc.summary}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Legal Document Reader */}
            <article className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 sm:p-10 shadow-xl">
              <div className="mb-6 pb-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-4">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-red-600 dark:text-red-400">
                    {activeLegalDoc.badge}
                  </span>
                  <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white">
                    {activeLegalDoc.title}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setPrintTarget({
                      guide: {
                        title: activeLegalDoc.title,
                        slug: activeLegalDoc.slug,
                        markdown: activeLegalDoc.markdown,
                      },
                      scope: activeLegalDoc.scope,
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-red-500" />
                  <span>Print copy</span>
                </button>
              </div>
              <Markdown markdown={activeLegalDoc.markdown} />
            </article>
          </div>
        )}
      </main>

      {/* Site Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 py-10 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <img
              src={stationSyncLoopsUrl()}
              alt="StationSync"
              className="h-7 w-7 object-contain"
            />
            <span className="text-base font-extrabold tracking-tight text-slate-900 dark:text-white">
              Station<span className="text-red-500">Sync</span>
            </span>
            <span className="text-xs text-slate-400">
              &bull; Firehouse Operations &amp; Workforce Platform
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <button
              type="button"
              onClick={() => navigateTo('overview')}
              className="hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              Features
            </button>
            <button
              type="button"
              onClick={() => navigateTo('docs', { scope: 'member' })}
              className="hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              Member Guides
            </button>
            <button
              type="button"
              onClick={() => navigateTo('docs', { scope: 'admin' })}
              className="hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              Admin Guides
            </button>
            <button
              type="button"
              onClick={() => navigateTo('changelog')}
              className="hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              Changelog
            </button>
            <button
              type="button"
              onClick={() => navigateTo('legal', { legalId: 'terms' })}
              className="hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              Terms
            </button>
            <button
              type="button"
              onClick={() => navigateTo('legal', { legalId: 'privacy' })}
              className="hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              Privacy
            </button>
            <button
              type="button"
              onClick={() => navigateTo('legal', { legalId: 'dpa' })}
              className="hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              DPA
            </button>
          </div>
        </div>
      </footer>

      {/* Printable Guide / Legal Document Portal */}
      {printTarget && (
        <PrintableHelpGuide
          guide={printTarget.guide}
          scope={printTarget.scope}
          onDone={() => setPrintTarget(null)}
        />
      )}
    </div>
  );
}
