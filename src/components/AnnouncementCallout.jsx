import React from 'react';
import { X } from 'lucide-react';
import RankIcon from './RankIcon';
import {
  ANNOUNCEMENT_ICON_FALLBACK,
  announcementVariant,
} from '../utils/announcements';

/**
 * One announcement, drawn as a callout.
 *
 * Styled to match the help guides' alerts (components/Markdown.jsx): a colored left rule, the type's
 * label, and an icon. The heading is the announcement's own title rather than the variant's name, so a
 * reader sees what it is about; the variant is carried by the color and the icon.
 *
 * Compact by default, because the sidebar and dashboard placements sit among other content rather than
 * owning the page.
 */
export default function AnnouncementCallout({ announcement, onDismiss, compact = false }) {
  const variant = announcementVariant(announcement?.context_variant);
  const icon = String(announcement?.icon ?? '').trim() || ANNOUNCEMENT_ICON_FALLBACK;

  return (
    <div className={`rounded-xl border border-l-4 ${variant.box} ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}>
      <div className="flex items-start gap-2">
        <span className={`shrink-0 ${variant.head} ${compact ? 'mt-0.5' : 'mt-1'}`}>
          <RankIcon name={icon} className={compact ? 'w-4 h-4' : 'w-5 h-5'} />
        </span>

        <div className="min-w-0 flex-1">
          <div className={`font-semibold ${variant.head} ${compact ? 'text-xs' : 'text-sm'}`}>
            {announcement?.title}
          </div>
          {/* A member's message is free text, so it keeps its own line breaks. */}
          <p className={`mt-0.5 whitespace-pre-wrap text-slate-700 dark:text-slate-200 ${compact ? 'text-xs' : 'text-sm'}`}>
            {announcement?.message}
          </p>
        </div>

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={`Dismiss "${announcement?.title}"`}
            className={`shrink-0 rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 ${compact ? '' : 'mt-0.5'}`}
          >
            <X className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
          </button>
        )}
      </div>
    </div>
  );
}
