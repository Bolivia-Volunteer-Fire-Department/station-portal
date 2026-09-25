import React from 'react';
import { Award } from 'lucide-react';

// The flag chips for one training, plus its time label.
//
// Shared by the member table and the admin report so the two read identically - the same reason
// the schedule's time helpers were extracted. `flags` is filtered in utils/training.js, so the
// administrative flags (which have their own table column) are never duplicated here.
export default function TrainingBadges({ training, dense = false }) {
  const flags = training?.flags || [];

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${dense ? '' : 'mt-1'}`}>
      {training?.when_label && (
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {training.when_label}
        </span>
      )}
      {flags.map((flag) => (
        <span
          key={flag.key}
          title={flag.label}
          className={`inline-flex items-center gap-1 rounded-lg border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            flag.key === 'is_certification'
              ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/80 dark:bg-amber-950/40 dark:text-amber-400'
              : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400'
          }`}
        >
          {flag.key === 'is_certification' && <Award className="w-2.5 h-2.5" />}
          {flag.short}
        </span>
      ))}
    </div>
  );
}
