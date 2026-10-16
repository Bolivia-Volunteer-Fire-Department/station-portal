import React from 'react';
import { ExternalLink, Compass, Link2, MapPin, Radio, Shield, FileText } from 'lucide-react';
import { DEFAULT_QUICK_LINKS } from '../../utils/dashboardWidgets';

const ICON_MAP = {
  cad: Shield,
  gis: MapPin,
  weather: Compass,
  sops: FileText,
  radio: Radio,
};

/**
 * Quick Links Widget.
 * Shows fast access buttons to dispatch, county GIS, and station resources.
 */
export default function QuickLinksWidget({ links = DEFAULT_QUICK_LINKS, onNavigate }) {
  const activeLinks = Array.isArray(links) && links.length > 0 ? links : DEFAULT_QUICK_LINKS;

  const handleClick = (e, link) => {
    if (!link.external && link.url?.startsWith('#')) {
      e.preventDefault();
      const tabId = link.url.replace(/^#/, '');
      onNavigate?.(tabId);
    }
  };

  return (
    <div className="h-full flex flex-col justify-between rounded-2xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800 p-5 md:p-6 shadow-xl transition-all">
      <div>
        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200 font-semibold text-sm mb-3">
          <Link2 className="w-4 h-4 text-red-600 dark:text-red-500" />
          <span>Quick Links & CAD</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-1 gap-2">
          {activeLinks.map((link) => {
            const Icon = ICON_MAP[link.id] || ExternalLink;
            const isInternal = !link.external && link.url?.startsWith('#');

            return (
              <a
                key={link.id || link.label}
                href={link.url || '#'}
                target={isInternal ? '_self' : '_blank'}
                rel={isInternal ? '' : 'noreferrer noopener'}
                onClick={(e) => handleClick(e, link)}
                className="group flex items-center justify-between p-2.5 rounded-xl border border-slate-200 dark:border-slate-700/60 bg-slate-50/70 dark:bg-slate-900/40 hover:bg-red-50/60 dark:hover:bg-red-950/20 hover:border-red-300 dark:hover:border-red-800/60 transition shadow-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="p-1.5 rounded-lg bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 group-hover:text-red-600 dark:group-hover:text-red-400 group-hover:bg-red-100/60 dark:group-hover:bg-red-900/40 transition shrink-0">
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <span className="text-xs font-medium text-slate-800 dark:text-slate-200 group-hover:text-red-600 dark:group-hover:text-red-400 truncate transition">
                    {link.label}
                  </span>
                </div>
                <ExternalLink className="w-3 h-3 text-slate-400 group-hover:text-red-500 shrink-0 opacity-60 group-hover:opacity-100 transition" />
              </a>
            );
          })}
        </div>
      </div>

      <p className="text-[11px] text-slate-400 dark:text-slate-500 pt-3 mt-3 border-t border-slate-100 dark:border-slate-700/60">
        Station operational portals & external emergency resources.
      </p>
    </div>
  );
}

