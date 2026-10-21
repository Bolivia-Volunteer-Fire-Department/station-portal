import React from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

// THE GROUPING PICKER: what a report is grouped by, IN ORDER.
//
// "Group by month, then by member" is the same thing as "group by month" with one more level after it, so this is a list
// rather than a single choice - and the ORDER is what the reader sees on the page, which is why the levels can be moved
// and not merely added and removed.
//
// IT MOVES WITH BUTTONS, NOT BY DRAGGING. A drag is nicer with a mouse and unusable with a keyboard, and this app is used
// on a phone at a station door as often as on a desk - the ranks editor already reorders with this same pair of arrows,
// so the control reads the way the rest of the app does.
//
// THE MAXIMUM IS THREE, and it is a judgement rather than a limit in the engine: each level past the first nests the
// table another step, and a report four levels deep is one nobody reads down to the numbers at the bottom of.
const MAX_LEVELS = 3;

export default function ReportGroupingPicker({
  value = [],
  options = [],
  onChange,
  max = MAX_LEVELS,
  min = 1,
  disabled = false,
  fieldClass = '',
  withDirection = false,
}) {
  // THE SAME CONTROL SERVES "GROUP BY" AND "ORDER BY", because both are an ordered list of keys over the same choices -
  // the report's grouping levels, and its measure. `withDirection` adds the ascending/descending toggle the order needs
  // (and the grouping does not have: the order IS the grouping order).
  const entries = (Array.isArray(value) ? value : [])
    .map((entry) => (entry && typeof entry === 'object' ? entry : { key: entry, direction: 'asc' }))
    .map((entry) => ({
      key: String(entry.key || '').trim(),
      direction: String(entry.direction || '').toLowerCase() === 'desc' ? 'desc' : 'asc',
    }))
    .filter((entry) => entry.key);
  const levels = entries.map((entry) => entry.key);
  const labelOf = (id) => options.find(([key]) => key === id)?.[1] || id;
  const unused = options.filter(([key]) => !levels.includes(key));

  // What the caller gets back: plain keys for a grouping, key-and-direction for an order.
  const emit = (next) => onChange(withDirection ? next : next.map((entry) => entry.key));
  const directionOf = (key) => entries.find((entry) => entry.key === key)?.direction || 'asc';

  const move = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= entries.length) return;
    const next = [...entries];
    [next[index], next[target]] = [next[target], next[index]];
    emit(next);
  };

  const arrowClass =
    'rounded-lg p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100';

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        {levels.map((level, index) => (
          <div
            key={level}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
          >
            {/* The number is the nesting order made visible: 1 is the outer heading, 2 sits inside it. */}
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              {index + 1}. {labelOf(level)}
            </span>
            <div className="ml-auto flex items-center gap-0.5">
              {withDirection && (
                <button
                  type="button"
                  onClick={() =>
                    emit(entries.map((entry) =>
                      entry.key === level ? { ...entry, direction: entry.direction === 'desc' ? 'asc' : 'desc' } : entry
                    ))
                  }
                  disabled={disabled}
                  // SAID OUT LOUD rather than shown as an arrow, because a lone arrow beside a number does not tell a
                  // reader which way it is pointing at.
                  aria-label={`${labelOf(level)}: ${directionOf(level) === 'desc' ? 'descending' : 'ascending'}`}
                  title={directionOf(level) === 'desc' ? 'Largest first' : 'Smallest first'}
                  className={`${arrowClass} px-1.5 text-[10px] font-semibold uppercase tracking-wide`}
                >
                  {directionOf(level) === 'desc' ? 'High → low' : 'Low → high'}
                </button>
              )}
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={disabled || index === 0}
                aria-label={`Move ${labelOf(level)} up`}
                className={arrowClass}
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={disabled || index === levels.length - 1}
                aria-label={`Move ${labelOf(level)} down`}
                className={arrowClass}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => emit(entries.filter((entry) => entry.key !== level))}
                // The LAST level cannot be removed from a grouping: a report has to group by something, and an empty list
                // would be a definition the server refuses. AN ORDER MAY BE EMPTY, which is why `min` is a prop.
                disabled={disabled || entries.length <= min}
                aria-label={`Remove ${labelOf(level)}`}
                className={`${arrowClass} hover:text-red-600 dark:hover:text-red-400`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {levels.length < max && unused.length > 0 && (
        <select
          value=""
          disabled={disabled}
          onChange={(event) => event.target.value && emit([...entries, { key: event.target.value, direction: 'asc' }])}
          aria-label="Add a grouping"
          className={fieldClass}
        >
          <option value="">Add a grouping…</option>
          {unused.map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      )}

      {levels.length > 1 && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {labelOf(levels[0])} is the outer heading, and each grouping after it nests one step further in.
        </p>
      )}
    </div>
  );
}
