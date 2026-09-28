import React from 'react';
import { Biohazard, HeartPulse } from 'lucide-react';

// The two categories that earn their own colour and glyph.
//
// Hazmat inherited this from the flag it replaced - `is_certification` was the highlighted one before the
// rename - and EMS is new. Standing out is the point: a hazmat or medical training should be identifiable at a
// glance in a list of thirty rows. Everything else stays the neutral chip.
const FLAG_STYLES = {
  is_hazmat: {
    className:
      'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/80 dark:bg-amber-950/40 dark:text-amber-400',
    Icon: Biohazard,
  },
  is_ems: {
    className:
      'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/80 dark:bg-rose-950/40 dark:text-rose-400',
    Icon: HeartPulse,
  },
};

const NEUTRAL_CLASS =
  'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400';

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
      {flags.map((flag) => {
        const style = FLAG_STYLES[flag.key];
        const Icon = style?.Icon;
        return (
          <span
            key={flag.key}
            title={flag.label}
            className={`inline-flex items-center gap-1 rounded-lg border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              style ? style.className : NEUTRAL_CLASS
            }`}
          >
            {Icon && <Icon className="w-2.5 h-2.5" />}
            {flag.short}
          </span>
        );
      })}
    </div>
  );
}
