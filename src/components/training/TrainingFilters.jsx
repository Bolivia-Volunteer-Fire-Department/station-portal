import { Filter, RotateCcw } from 'lucide-react';
import { TRAINING_SORT_OPTIONS, trainingLocationOptions } from '../../utils/training';

// The filter and sort controls shared by the Training module and the Administration Training report.
//
// Presentational only: the parent owns the filter state and does the filtering, so both screens
// behave identically. `memberOptions` is what makes this reusable - the report adds a Member select
// (All Members plus everyone), and the member module simply omits it, since a member is only ever
// looking at their own record.
const selectClass =
  'w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500/40';

const labelClass = 'block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1';

export default function TrainingFilters({
  filters,
  onChange,
  sort,
  onSortChange,
  rows = [],
  memberOptions = null,
  signedLabel = 'Signature',
}) {
  const locations = trainingLocationOptions(rows);
  const isFiltered = Boolean(filters.from || filters.to || filters.location || filters.member || filters.signed);

  // One handler for every control, keyed by the filter's own name, so adding a filter means adding
  // an entry here rather than another callback.
  const setFilter = (key) => (event) => onChange({ ...filters, [key]: event.target.value });

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
        <Filter className="w-4 h-4 text-red-500 shrink-0" />
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Filter &amp; sort</h3>
        {isFiltered && (
          <button
            type="button"
            onClick={() => onChange({ from: '', to: '', location: '', member: '', signed: '' })}
            className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Clear filters
          </button>
        )}
      </div>

      <div className="p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className={labelClass} htmlFor="training-filter-from">From date</label>
          <input
            id="training-filter-from"
            type="date"
            value={filters.from || ''}
            onChange={setFilter('from')}
            className={selectClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="training-filter-to">To date</label>
          <input
            id="training-filter-to"
            type="date"
            value={filters.to || ''}
            onChange={setFilter('to')}
            className={selectClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="training-filter-location">Location</label>
          <select
            id="training-filter-location"
            value={filters.location || ''}
            onChange={setFilter('location')}
            className={selectClass}
          >
            <option value="">All locations</option>
            {locations.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        {memberOptions && (
          <div>
            <label className={labelClass} htmlFor="training-filter-member">Member</label>
            <select
              id="training-filter-member"
              value={filters.member || ''}
              onChange={setFilter('member')}
              className={selectClass}
            >
              {memberOptions.map((option) => (
                <option key={option.value || 'all'} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className={labelClass} htmlFor="training-filter-signed">{signedLabel}</label>
          <select
            id="training-filter-signed"
            value={filters.signed || ''}
            onChange={setFilter('signed')}
            className={selectClass}
          >
            <option value="">Any</option>
            <option value="yes">Signed only</option>
            <option value="no">Not signed only</option>
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="training-filter-sort">Sort by</label>
          <select
            id="training-filter-sort"
            value={sort}
            onChange={(event) => onSortChange(event.target.value)}
            className={selectClass}
          >
            {TRAINING_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
