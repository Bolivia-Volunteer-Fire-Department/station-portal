// WHEN THE SCHEDULE ON SCREEN WAS LAST READ, and a way to read it again.
//
// WHY A LINE RATHER THAN SILENCE. The app now re-reads the schedule by itself when it changes (functions/index.js#onShiftWritten
// bumps a sentinel, App re-reads the visible window) and when a member comes back to the tab. Neither is a promise, though -
// a sentinel can fail and a member can want the truth NOW, before deciding anything on the strength of it. So the screen says
// how old its answer is, and offers the read.
//
// IT SAYS NOTHING WHEN NOTHING HAS BEEN READ. A screen that has not loaded is not fresh, it is silent - and "Updated 0 minutes
// ago" would be a lie told by a screen that has not asked for anything yet (see utils/freshness.js#freshnessLabelFor, which
// answers with an empty string for exactly that case, and this component which renders nothing for it).
//
// THE LABEL TURNS AMBER WHEN STALE, which is the whole difference between a note and a prompt: the same words either way, in a
// colour that says "you may want to press this".
import React from 'react';
import { RefreshCw } from 'lucide-react';
import { freshnessLabelFor, isStale } from '../utils/freshness';

// `nowMs` is a prop rather than a reading taken here, so a caller drawing this beside other freshness-aware things agrees with
// them about the moment - and so a harness can ask about any moment it likes without a clock.
export default function ScheduleFreshness({ atMs = 0, nowMs = 0, onRefresh }) {
  const now = nowMs || Date.now();
  const label = freshnessLabelFor({ atMs, nowMs: now });
  if (!label) return null;
  const stale = isStale({ atMs, nowMs: now });

  return (
    <div className="flex items-center justify-end gap-2 px-1 pb-1 text-xs">
      <span className={stale ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500 dark:text-slate-400'}>{label}</span>
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          className="flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-0.5 font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          aria-label="Refresh the schedule"
          title="Refresh the schedule"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
      )}
    </div>
  );
}