import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, FileText } from 'lucide-react';
import { hasGuideContent, helpFolderFor, helpGuides } from '../utils/helpGuides';
import Markdown from './Markdown';

// Help guides, rendered from the markdown files under src/content/help/.
//
// One component for both audiences - the member module and the Administration tab - because the
// only difference is which folder is read and what the header says.
//
// `initialSlug` opens a specific guide instead of the first one. It exists so a caller can link
// straight to a guide (and so the render test can reach the empty-guide branch), and is ignored if
// the slug is unknown.
export default function HelpGuides({ scope = 'member', initialSlug = '' }) {
  const guides = useMemo(() => helpGuides(scope), [scope]);
  const [activeSlug, setActiveSlug] = useState(initialSlug || (guides[0]?.slug ?? ''));

  // Guides are static per scope, but the scope can change (the same component serves both
  // audiences), so the selection resets when it does.
  useEffect(() => {
    setActiveSlug(initialSlug && guides.some((g) => g.slug === initialSlug)
      ? initialSlug
      : (guides[0]?.slug ?? ''));
  }, [guides, initialSlug]);

  const active = guides.find((guide) => guide.slug === activeSlug) || guides[0] || null;
  const isAdminScope = scope === 'admin';

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-red-500 shrink-0" />
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {isAdminScope ? 'Administration guides' : 'Help guides'}
          </h3>
          <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
            {guides.length} guide{guides.length === 1 ? '' : 's'}
          </span>
        </div>

        {guides.length === 0 ? (
          <div className="p-4 space-y-1">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No guides yet.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Add a markdown file to{' '}
              <code className="rounded bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 px-1 py-0.5 font-mono text-[11px]">
                {helpFolderFor(scope)}
              </code>{' '}
              and it appears here — the first <code className="font-mono text-[11px]"># heading</code> becomes
              its title, and a numeric prefix (01-, 02-) sets the order.
            </p>
          </div>
        ) : (
          <div className="grid gap-0 md:grid-cols-[13rem_1fr]">
            <nav
              aria-label="Help guides"
              className="md:border-r border-slate-200 dark:border-slate-700 p-2 flex md:flex-col gap-1 overflow-x-auto"
            >
              {guides.map((guide) => {
                const isActive = active && guide.slug === active.slug;
                return (
                  <button
                    key={guide.slug}
                    type="button"
                    onClick={() => setActiveSlug(guide.slug)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium whitespace-nowrap transition ${
                      isActive
                        ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    <FileText className="w-4 h-4 shrink-0" />
                    <span className="truncate">{guide.title}</span>
                  </button>
                );
              })}
            </nav>

            <article className="p-4 min-w-0">
              {active && (
                <>
                  <h2 className="mb-3 text-base font-bold text-slate-900 dark:text-white">
                    {active.title}
                  </h2>
                  {/* An empty file is still listed (the guide exists and is where you expect it),
                      but it says so rather than rendering a blank pane. */}
                  {hasGuideContent(active) ? (
                    <Markdown markdown={active.markdown} />
                  ) : (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      This guide has no content yet. Add markdown to{' '}
                      <code className="rounded bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 px-1 py-0.5 font-mono text-[11px]">
                        {`${helpFolderFor(scope)}${active.slug}.md`}
                      </code>{' '}
                      and it will appear here.
                    </p>
                  )}
                </>
              )}
            </article>
          </div>
        )}
      </div>
    </div>
  );
}
