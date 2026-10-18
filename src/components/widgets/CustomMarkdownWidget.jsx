import React from 'react';
import { FileText } from 'lucide-react';
import Markdown from '../Markdown';

/**
 * Custom Markdown Widget.
 * Displays admin-created notices, pass-down notes, or briefing cards.
 */
export default function CustomMarkdownWidget({ title = 'Station Notice', content = '' }) {
  return (
    <div className="h-full max-h-[500px] flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800 p-5 md:p-6 shadow-xl transition-all">
      {/* Title */}
      <div className="shrink-0 flex items-center gap-2 text-slate-700 dark:text-slate-200 font-semibold text-sm mb-3">
        <FileText className="w-4 h-4 text-red-600 dark:text-red-500 shrink-0" />
        <span>{title}</span>
      </div>

      {/* Content */}
      <div className="overflow-y-auto min-h-0 flex-1 pr-1 prose dark:prose-invert max-w-none text-xs text-slate-700 dark:text-slate-300">
        {content ? (
          <Markdown content={content} />
        ) : (
          <p className="italic text-slate-400 dark:text-slate-500">No content provided.</p>
        )}
      </div>
    </div>
  );
}

