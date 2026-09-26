import React, { useEffect, useMemo, useRef, useState } from 'react';
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

  // The pane the guide is read in, so a change of guide can start at the top of the new one.
  const paneRef = useRef(null);
  const shownSlug = useRef(activeSlug);

  // Switching guides starts at the top of the newly opened one. Without this, a long guide scrolled to its end
  // leaves the next one open half way down - which is worse now that the guide scrolls on its own, because the
  // page no longer moves at all. Skipped on the first render: arriving on the screen is not "changing guide", and
  // scrolling then would fight the browser's own restoration of where the member was.
  useEffect(() => {
    const previous = shownSlug.current;
    shownSlug.current = activeSlug;
    if (previous === activeSlug) return;

    const pane = paneRef.current;
    if (!pane) return;
    // Desktop: the pane is the scroller. Below `md` it is not - the page is - so the page moves instead.
    if (pane.scrollHeight > pane.clientHeight) pane.scrollTo({ top: 0 });
    else pane.scrollIntoView({ block: 'start' });
  }, [activeSlug]);

  return (
    // Bounded on desktop, so the guide scrolls inside the card and the bookmarks (and the card's own header) stay
    // where they are however long the guide is. Below `md` nothing here changes: the columns stack, the guide list
    // is a horizontal strip, and the page scrolls as it always did.
    //
    // The chain that makes the inner scroll work, every link of it needed:
    //   `md:h-full` on the card   fills the padded content area <main> gives it (`md:h-screen`)
    //   `md:flex md:flex-col`     so the columns can take the height left over after the header
    //   `md:flex-1 md:min-h-0`    a flex child will not shrink below its content without min-h-0, and a column that
    //   `md:grid-rows-1`          cannot shrink has nothing to scroll - it just grows. grid-rows-1 makes the row
    //                             exactly the height left over (`minmax(0, 1fr)`) so the pane's overflow is real.
    //
    // The root carries `md:h-full` AND `md:flex-1` because it has two parents to fit: <main> in the member module
    // (a block with a definite height, where h-full applies and flex-1 is inert) and the Administration panel's
    // column (where flex-1 wins the height and h-full is overridden). Either way it ends up with the height it was
    // given rather than its content's, which is the one thing the pane needs. Both callers are checked by
    // scripts/verify-app-shell.mjs, since a wrapper added between them would silently undo all of this.
    <div className="space-y-4 md:h-full md:min-h-0 md:flex-1">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden md:h-full md:flex md:flex-col">
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
          <div className="grid gap-0 md:grid-cols-[13rem_1fr] md:flex-1 md:min-h-0 md:grid-rows-1">
            <nav
              aria-label="Help guides"
              className="md:border-r border-slate-200 dark:border-slate-700 p-2 flex md:flex-col gap-1 overflow-x-auto md:overflow-y-auto md:min-h-0"
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

            {/* The guide itself, and the only thing that scrolls on desktop. A labelled region with a tab stop:
                a scrollable box that the keyboard cannot reach is a scrollable box a keyboard user cannot read
                past, and the outline shows where the focus is. */}
            <article
              ref={paneRef}
              tabIndex={0}
              role="region"
              aria-label={active ? `${active.title} guide` : 'Help guide'}
              className="p-4 min-w-0 md:min-h-0 md:overflow-y-auto overscroll-y-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500/60"
            >
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
