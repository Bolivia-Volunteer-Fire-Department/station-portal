import { Clock, ListChecks } from 'lucide-react';
import { formatTotalHours } from '../../utils/training';

// The totals strip for a filtered Training list: how many trainings are showing, how many hours
// they come to, and - when the active member has signatures - how many of them are signed.
//
// Shared by both screens so the same filter set produces the same numbers in both. `signedIds` is
// optional: the report shows a signature COUNT per row rather than a yes/no for one member, so it
// can pass the totals for hours and count alone.
export default function TrainingTotals({ totals, signedLabel = 'Signed' }) {
  if (!totals) return null;

  // The signature tile is optional: the report passes it only when one member is selected, since
  // "0 of 40 signed" against All Members would read as a problem rather than as Not Applicable.
  const showSigned = Number.isFinite(Number(totals.signedCount));

  const tile = (key, icon, label, value, hint) => (
    <div
      key={key}
      className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 px-3 py-2"
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-0.5 text-lg font-bold text-slate-800 dark:text-slate-100">{value}</div>
      {hint && <div className="text-xs text-slate-500 dark:text-slate-400">{hint}</div>}
    </div>
  );

  return (
    <div className={`grid gap-3 ${showSigned ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
      {tile('count', <ListChecks className="w-3.5 h-3.5" />, 'Trainings shown', totals.count)}
      {tile(
        'hours',
        <Clock className="w-3.5 h-3.5" />,
        'Training hours',
        formatTotalHours(totals.hours),
        'Total duration in this view'
      )}
      {showSigned &&
        tile(
          'signed',
          <ListChecks className="w-3.5 h-3.5" />,
          signedLabel,
          `${totals.signedCount} of ${totals.count}`,
          totals.unsignedCount > 0 ? `${totals.unsignedCount} outstanding` : 'None outstanding'
        )}
    </div>
  );
}
