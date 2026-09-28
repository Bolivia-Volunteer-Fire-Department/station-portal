import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import RankIcon, { RANK_ICON_MAP } from './RankIcon';
import { renderInViewport } from '../utils/viewportLayer';

const PANEL_WIDTH = 320;
const PANEL_MAX_HEIGHT = 340;

// A number or a roman numeral, which the icon set has none of - see RankIcon, which draws them as text.
const TYPED_ICON = /^(?:\d{1,2}|[IVX]{1,4})$/;

// Where to put the panel: under the trigger, or above it when there is no room below.
//
// The trigger's own rect is used rather than an ancestor's because the panel is rendered into document.body -
// so it is positioned against the viewport, exactly like the schedule board's popovers, and cannot be clipped
// by a card's overflow-hidden the way an absolutely-positioned menu inside one would be.
const panelPosition = (rect) => {
  const margin = 8;
  let left = rect.left;
  if (left + PANEL_WIDTH > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - PANEL_WIDTH - margin);
  }

  let top = rect.bottom + 6;
  if (top + PANEL_MAX_HEIGHT > window.innerHeight - margin) {
    const above = rect.top - PANEL_MAX_HEIGHT - 6;
    top = above >= margin ? above : Math.max(margin, window.innerHeight - PANEL_MAX_HEIGHT - margin);
  }

  return { top, left, width: PANEL_WIDTH, maxHeight: PANEL_MAX_HEIGHT };
};

/**
 * Visually pick an icon.
 *
 * This replaces the `<select>` that listed icon NAMES. A name is a poor way to choose a picture - "life-buoy"
 * and "life-buoy-ring" are indistinguishable as words and obvious as glyphs - and the list was long enough that
 * finding one meant reading all of it.
 *
 * Three ways in, because the icon set contains three kinds of thing:
 *
 *   * the grid, filtered by the search box, for the named icons;
 *   * NO ICON, for the fields that are allowed to be empty;
 *   * a NUMBER or ROMAN NUMERAL, typed into the same box - nothing in the icon set is a digit, so `1`, `2` and
 *     `III` are drawn as text (see RankIcon), and a station numbering its levels needs exactly that.
 *
 * The panel is rendered into document.body and positioned from the trigger's rect, so a card with
 * `overflow: hidden` cannot cut it off - which is what an in-place dropdown would do inside every one of the
 * forms that use this.
 */
export default function IconPicker({ value = '', onChange, disabled = false, label = 'icon' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState(null);
  const triggerRef = useRef(null);

  const iconNames = useMemo(() => Object.keys(RANK_ICON_MAP).sort(), []);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return iconNames;
    return iconNames.filter((name) => name.includes(needle));
  }, [iconNames, query]);

  const typedIcon = TYPED_ICON.test(query.trim()) ? query.trim() : '';

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const openPanel = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition(panelPosition(rect));
    setQuery('');
    setOpen(true);
  };

  const choose = (name) => {
    onChange?.(name);
    close();
  };

  // While the panel is open: Escape closes it, and any scroll does too.
  //
  // The scroll listener is in the CAPTURE phase and on the window, because the forms that use this live inside
  // a scrolling <main> rather than the document - a bubbling listener on the document would never hear it, and
  // the panel would sit over whatever had scrolled up to meet it.
  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    const onScroll = () => close();

    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : openPanel())}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="mt-1 flex w-full items-center gap-3 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-left text-slate-900 transition hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:hover:border-slate-600"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <RankIcon name={value} className="h-4 w-4 text-slate-600 dark:text-slate-300" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">
          {value || <span className="text-slate-400 dark:text-slate-500">No icon</span>}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>

      {open &&
        position &&
        renderInViewport(
          <>
            {/* Clicking away closes, as anywhere else in the app. */}
            <div className="fixed inset-0 z-40" onClick={close} aria-hidden="true" />

            <div
              role="dialog"
              aria-label={`Choose an ${label}`}
              className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl origin-top animate-popoverIn dark:border-slate-700 dark:bg-slate-800"
              style={position}
            >
              <div className="flex items-center gap-2 border-b border-slate-200 p-2 dark:border-slate-700">
                <input
                  autoFocus
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search, or type a number…"
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close"
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {/* A number or roman numeral, when one has been typed: the icon set has no digits, so this is
                    the only way to have "Instructor 1" or "Level III" show anything at all. */}
                {typedIcon && (
                  <button
                    type="button"
                    onClick={() => choose(typedIcon)}
                    className="mb-2 flex w-full items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-left text-sm text-red-700 hover:bg-red-100 dark:border-red-800/80 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/60"
                  >
                    <RankIcon name={typedIcon} className="h-4 w-4" />
                    Use “{typedIcon}” as the icon
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => choose('')}
                  className={`mb-2 w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                    value === ''
                      ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800/80 dark:bg-red-950/50 dark:text-red-300'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700'
                  }`}
                >
                  No icon
                </button>

                {filtered.length === 0 ? (
                  <p className="px-2 py-3 text-sm text-slate-500 dark:text-slate-400">
                    No icon matches “{query}”.
                  </p>
                ) : (
                  <div className="grid grid-cols-6 gap-1">
                    {filtered.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => choose(name)}
                        title={name}
                        aria-label={name}
                        className={`flex h-9 items-center justify-center rounded-lg border transition ${
                          value === name
                            ? 'border-red-300 bg-red-50 text-red-600 dark:border-red-800/80 dark:bg-red-950/50 dark:text-red-300'
                            : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-100 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-700'
                        }`}
                      >
                        <RankIcon name={name} className="h-4 w-4" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <p className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                {filtered.length} icon{filtered.length === 1 ? '' : 's'} · a number or roman numeral (1, III)
                becomes its own badge
              </p>
            </div>
          </>
        )}
    </>
  );
}

