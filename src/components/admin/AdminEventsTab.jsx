import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, CalendarPlus, ChevronDown, ChevronLeft, ChevronRight, Loader2, Pencil, Plus, RefreshCw,
  Repeat, Save, Trash2, UserRound, X,
} from 'lucide-react';
import { adminDeleteEvent, adminFetchEvents, adminSaveEvent } from '../../services/api';
import { toDateKey } from '../../utils/scheduleDate';
import { authorLabel } from '../../utils/authorLabel';
import { clampPage, pageRangeLabel, pageSlice, totalPages } from '../../utils/pagination';
import {
  DEFAULT_EVENT_SORT, EVENTS_PAGE_SIZE, EVENT_AUDIENCE_OPTIONS, EVENT_DEFAULT_COLOR, EVENT_FREQUENCIES,
  EVENT_SORT_OPTIONS, EVENT_WEEKDAYS, emptyEventFilters, eventFiltersActive, eventNextOccurrenceLabel,
  eventRecurrenceLabel, eventTimesLabel, eventValidation, eventVisibilityLabel, eventWindowLabel,
  filterEvents, normalizeEvent, normalizeEventColor, normalizeEventList, sortEvents, splitEventsByRecurrence,
} from '../../utils/events';

// One list card: a header with a count, the rows, and a pager that hides itself on a single page.
//
// Both cards are the same shell, so it lives here rather than being written twice. The pager owns its own page
// number because the two lists page independently.
function EventListCard({ title, icon, rows, visible, page, onPageChange, emptyMessage, rowProps }) {
  const pageCount = totalPages(rows.length, EVENTS_PAGE_SIZE);

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {title} ({rows.length})
        </h3>
      </div>

      {rows.length === 0 ? (
        <p className="p-6 text-sm text-slate-500 dark:text-slate-400">{emptyMessage}</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700/70">
          {visible.map((event) => (
            <EventRow key={String(event.id)} event={event} {...rowProps} />
          ))}
        </ul>
      )}

      {pageCount > 1 && (
        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span>{pageRangeLabel(rows.length, page, EVENTS_PAGE_SIZE)}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onPageChange(clampPage(page - 1, rows.length, EVENTS_PAGE_SIZE))}
              disabled={page <= 1}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span>
              Page {page} of {pageCount}
            </span>
            <button
              type="button"
              onClick={() => onPageChange(clampPage(page + 1, rows.length, EVENTS_PAGE_SIZE))}
              disabled={page >= pageCount}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// A new event defaults to a one-hour block TODAY, repeating weekly: "every Tuesday" is the common case,
// and it means the form is usable without typing a date at all.
const todayKey = () => toDateKey(new Date());

const EMPTY_FORM = () => ({
  id: '',
  title: '',
  date_from: `${todayKey()} 08:00`,
  date_to: `${todayKey()} 09:00`,
  color: '',
  role_id: '',
  rank_id: '',
  user_id: '',
  is_recurring: false,
  is_all_day: false,
  recurring_start: todayKey(),
  recurring_end: '',
  recurring_amount: '1',
  recurring_frequency: 'weekly',
  date_of_month: '',
  ...EVENT_WEEKDAYS.reduce((flags, day) => ({ ...flags, [day.key]: false }), {}),
});

const fieldClass =
  'w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500';
const labelClass = 'block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5';
const checkClass = 'flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200';
const chipClass =
  'rounded-full border px-2 py-0.5 text-[11px] font-semibold border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400';

const selectClass =
  'bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500';

// One event row, shared by both list cards.
//
// A local component rather than a second copy of the markup: the two cards show identical rows, and a copy is
// how the calendars drifted apart earlier in this feature.
function EventRow({ event, roles, ranks, users, timeFormat, deletingId, onEdit, onDelete }) {
  const author = authorLabel(event, users);

  return (
    <li className="p-4 flex items-start gap-3">
      <span
        className="mt-1.5 h-3 w-3 shrink-0 rounded-full border border-black/10"
        style={{ backgroundColor: event.color }}
        title={event.color}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-900 dark:text-white">{event.title}</span>
          {event.isAllDay && <span className={chipClass}>All day</span>}
        </div>

        {/* A repeating event has no single date, so it is described by its repeat and its TIMES. The "next" line
            exists because the anchor date is not the first occurrence: a weekly event anchored on a Thursday and
            set to Tuesdays first lands the following Tuesday, which reads as "it did not save" if nothing says so. */}
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {event.isRecurring
            ? `${eventRecurrenceLabel(event)} · ${eventTimesLabel(event, timeFormat)}`
            : eventWindowLabel(event, timeFormat)}
        </p>
        {event.isRecurring && (
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {eventNextOccurrenceLabel(event, { fromKey: todayKey(), timeFormat })}
          </p>
        )}
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {eventVisibilityLabel(event, { roles, ranks, users })}
        </p>
        {author && (
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <UserRound className="w-3 h-3 shrink-0" />
            {author}
          </p>
        )}
      </div>

      <div className="flex shrink-0 gap-1">
        <button
          type="button"
          onClick={() => onEdit(event)}
          title="Edit"
          className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700"
        >
          <Pencil className="w-4 h-4" />
        </button>
        <button
          type="button"
          title="Delete"
          disabled={deletingId === event.id}
          onClick={() => onDelete(event)}
          className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-red-600 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
        >
          {deletingId === event.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
        </button>
      </div>
    </li>
  );
}

// One labelled control, so twenty fields stay readable instead of repeating a wrapper each time.
function Field({ label, hint, wide, children }) {
  return (
    <div className={wide ? 'md:col-span-2' : undefined}>
      <label className={labelClass}>{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

// The sheet holds date/times as text and the form edits them as one string, so these two conversions live
// here rather than in the shared engine, which takes whatever the cell happens to hold.
const toInputValue = (instant, allDay) => {
  if (!instant) return '';
  if (allDay) return instant.dateKey;
  const hours = String(Math.floor(instant.minutes / 60)).padStart(2, '0');
  const minutes = String(instant.minutes % 60).padStart(2, '0');
  return `${instant.dateKey}T${hours}:${minutes}`;
};

const fromInputValue = (value, allDay) => (allDay ? value : String(value).replace('T', ' '));
const timeOf = (value) => String(value).slice(11, 16);
const dateOf = (value) => String(value).slice(0, 10);
const dateKeyOf = (key) => String(key ?? '').slice(0, 10);

export default function AdminEventsTab({
  token,
  roles = [],
  ranks = [],
  users = [],
  timeFormat = '12',
  onDataChanged,
}) {
  const [rows, setRows] = useState([]);
  const [sort, setSort] = useState(DEFAULT_EVENT_SORT);
  const [filters, setFilters] = useState(emptyEventFilters);
  // One page number per card, because the two lists are paged independently.
  const [oneOffPage, setOneOffPage] = useState(1);
  const [recurringPage, setRecurringPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState(null);

  const isEditing = !!form.id;
  const setField = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));

  // Fetched here rather than through the shared refresh wave: ADMIN_GET_EVENTS returns the whole sheet, and
  // this tab only exists while an administrator is looking at it.
  const loadRows = useCallback(async () => {
    const result = await adminFetchEvents(token);
    if (!result?.success) throw new Error(result?.message || 'Failed to load events.');
    return normalizeEventList(result.events);
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    loadRows()
      .then((list) => {
        if (!cancelled) setRows(list);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message || 'Failed to load events.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [loadRows]);

  // Re-reads this tab's own list after a write. onDataChanged refreshes the calendars, which is a
  // different set of screens.
  const reload = async () => {
    try {
      setRows(await loadRows());
      setLoadError(null);
    } catch (err) {
      setError(err.message || 'Saved, but the list could not be reloaded.');
    }
  };

  const handleEdit = (event) => {
    setError(null);
    // Open the card, or the click would appear to do nothing.
    setFormOpen(true);
    setForm({
      id: event.id,
      // Carried through the form so the backend can refuse a save built on a stale copy.
      row_version: event.row_version,
      title: event.title,
      date_from: toInputValue(event.startsAt, false),
      date_to: toInputValue(event.endsAt, false),
      // The stored colour is always resolved, so "no explicit colour" has to be recovered by comparing
      // against the default - otherwise the form would present gray as a chosen colour.
      color: event.color === EVENT_DEFAULT_COLOR ? '' : event.color,
      role_id: event.role_id,
      rank_id: event.rank_id,
      user_id: event.user_id,
      is_recurring: event.isRecurring,
      is_all_day: event.isAllDay,
      recurring_start: dateKeyOf(event.recurringStart),
      recurring_end: dateKeyOf(event.recurringEnd),
      recurring_amount: String(event.amount),
      recurring_frequency: event.frequency,
      date_of_month: event.dateOfMonth === null ? '' : String(event.dateOfMonth),
      ...EVENT_WEEKDAYS.reduce(
        (flags, day) => ({ ...flags, [day.key]: event.weekdays.includes(day.index) }),
        {}
      ),
    });
  };

  const handleSave = async (submitEvent) => {
    submitEvent.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // The same rules the backend enforces, so a bad event is caught before a round trip.
      const problem = eventValidation(form);
      if (problem) throw new Error(problem);

      const result = await adminSaveEvent(form, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to save the event.');

      void onDataChanged?.();
      await reload();
      setForm(EMPTY_FORM());
      setFormOpen(false);
    } catch (err) {
      setError(err.message || 'Failed to save the event.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (event) => {
    if (!window.confirm(`Delete "${event.title}"? This cannot be undone.`)) return;
    setDeletingId(event.id);
    setError(null);
    try {
      const result = await adminDeleteEvent(event.id, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to delete the event.');
      void onDataChanged?.();
      await reload();
      if (String(form.id) === String(event.id)) {
        setForm(EMPTY_FORM());
        setFormOpen(false);
      }
    } catch (err) {
      setError(err.message || 'Failed to delete the event.');
    } finally {
      setDeletingId(null);
    }
  };

  // The two lists, ordered, filtered and paged.
  //
  // All four steps are derived rather than stored: a reload, a delete or a filter change cannot leave the order,
  // the split or a page number out of step with the rows underneath them. The clamp on each page is what stops a
  // delete on the last page from rendering an empty card.
  const orderedRows = useMemo(() => sortEvents(rows, sort), [rows, sort]);
  const matchingRows = useMemo(() => filterEvents(orderedRows, filters), [orderedRows, filters]);
  const { oneOff, recurring } = useMemo(() => splitEventsByRecurrence(matchingRows), [matchingRows]);

  const oneOffCurrentPage = clampPage(oneOffPage, oneOff.length, EVENTS_PAGE_SIZE);
  const recurringCurrentPage = clampPage(recurringPage, recurring.length, EVENTS_PAGE_SIZE);
  const oneOffVisible = useMemo(
    () => pageSlice(oneOff, oneOffCurrentPage, EVENTS_PAGE_SIZE),
    [oneOff, oneOffCurrentPage]
  );
  const recurringVisible = useMemo(
    () => pageSlice(recurring, recurringCurrentPage, EVENTS_PAGE_SIZE),
    [recurring, recurringCurrentPage]
  );

  const filtersOn = eventFiltersActive(filters);

  // Changing a filter sends both lists back to their first page: you filter to look at a different set of events,
  // and landing on page 3 of a result you have not seen the start of reads as an empty screen. The clamp already
  // makes an out-of-range page safe; this makes it sensible.
  const updateFilters = (next) => {
    setFilters(next);
    setOneOffPage(1);
    setRecurringPage(1);
  };

  const isWeekly = form.is_recurring && form.recurring_frequency === 'weekly';
  const isMonthly = form.is_recurring && form.recurring_frequency === 'monthly';
  const previewColor = normalizeEventColor(form.color) || EVENT_DEFAULT_COLOR;

  // What the form currently describes, for the live "first appears" line below the repeat fields.
  //
  // This is the answer to the mistake that prompted it: a weekly event anchored on a Thursday and set to
  // Tuesdays does not appear until the FOLLOWING Tuesday, so without this line the repeat looks broken.
  const recurringPreview = form.is_recurring ? normalizeEvent({ ...form, id: 'preview' }) : null;
  const recurringNextLabel = recurringPreview
    ? eventNextOccurrenceLabel(recurringPreview, { fromKey: todayKey(), timeFormat, prefix: '' })
    : '';
  const closeForm = () => {
    setForm(EMPTY_FORM());
    setFormOpen(false);
  };


  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        {/* The header is the collapse control, matching the Training and Announcements forms. It stays
            visible when collapsed so "New Event" is always one click away. */}
        <button
          type="button"
          onClick={() => setFormOpen((open) => !open)}
          aria-expanded={formOpen}
          className="w-full flex items-start gap-3 p-6 text-left hover:bg-slate-50 dark:hover:bg-slate-900/40 transition"
        >
          <span className="mt-0.5 text-slate-400 shrink-0">
            {formOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
              <CalendarPlus className="w-5 h-5 text-red-500" />
              {isEditing ? `Edit Event #${form.id}` : 'New Event'}
            </span>
            <span className="block text-sm text-slate-500 dark:text-slate-400">
              {isEditing
                ? 'Change this event. Saving redraws it on every calendar it appears on.'
                : 'Add a non-shift entry to the calendars. Events never fill a shift and are never offered for.'}
            </span>
          </span>
        </button>

        {formOpen && (
          <form onSubmit={handleSave} className="px-6 pb-6 space-y-5">
            {isEditing && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={closeForm}
                  className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                  Cancel edit
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label={<>Title <span className="font-normal text-slate-400">(required)</span></>} wide>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setField('title', e.target.value)}
                  placeholder="e.g. Training, Company meeting, Standby"
                  className={fieldClass}
                />
              </Field>
              <Field label="Color" hint="Leave blank to use gray.">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={previewColor}
                    onChange={(e) => setField('color', e.target.value)}
                    aria-label="Event color"
                    className="h-9 w-14 shrink-0 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent"
                  />
                  <input
                    type="text"
                    value={form.color}
                    onChange={(e) => setField('color', e.target.value)}
                    placeholder="#RRGGBB"
                    className={fieldClass}
                  />
                </div>
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-6">
              <label className={checkClass}>
                <input
                  type="checkbox"
                  checked={form.is_all_day}
                  onChange={(e) => setField('is_all_day', e.target.checked)}
                  className="h-4 w-4"
                />
                All day
              </label>
              <label className={checkClass}>
                <input
                  type="checkbox"
                  checked={form.is_recurring}
                  onChange={(e) => setField('is_recurring', e.target.checked)}
                  className="h-4 w-4"
                />
                Repeats
              </label>
            </div>

            {form.is_all_day && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                An all-day event covers whole days, so it has no times and its end date is{' '}
                <strong>inclusive</strong>.
              </p>
            )}

            {!form.is_recurring && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label={form.is_all_day ? 'Start date' : 'Starts'}>
                  <input
                    type={form.is_all_day ? 'date' : 'datetime-local'}
                    value={form.is_all_day ? dateOf(form.date_from) : form.date_from.replace(' ', 'T')}
                    onChange={(e) => setField('date_from', fromInputValue(e.target.value, form.is_all_day))}
                    className={fieldClass}
                  />
                </Field>
                <Field
                  label={form.is_all_day ? 'End date (optional — inclusive)' : 'Ends'}
                >
                  <input
                    type={form.is_all_day ? 'date' : 'datetime-local'}
                    value={form.is_all_day ? dateOf(form.date_to) : form.date_to.replace(' ', 'T')}
                    onChange={(e) => setField('date_to', fromInputValue(e.target.value, form.is_all_day))}
                    className={fieldClass}
                  />
                </Field>
              </div>
            )}


            {form.is_recurring && (
              <div className="space-y-4 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  A repeating event takes only the <strong>times</strong> below; the repeat decides which
                  days it lands on.
                </p>

                {!form.is_all_day && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="Start time">
                      <input
                        type="time"
                        value={timeOf(form.date_from)}
                        onChange={(e) => setField('date_from', `${dateOf(form.date_from)} ${e.target.value}`)}
                        className={fieldClass}
                      />
                    </Field>
                    <Field label="End time">
                      <input
                        type="time"
                        value={timeOf(form.date_to)}
                        onChange={(e) => setField('date_to', `${dateOf(form.date_to)} ${e.target.value}`)}
                        className={fieldClass}
                      />
                    </Field>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Field label="Repeat every" hint="Daily + 2 means every other day.">
                    <input
                      type="number"
                      min="1"
                      value={form.recurring_amount}
                      onChange={(e) => setField('recurring_amount', e.target.value)}
                      className={fieldClass}
                    />
                  </Field>
                  <Field label="Frequency">
                    <select
                      value={form.recurring_frequency}
                      onChange={(e) => setField('recurring_frequency', e.target.value)}
                      className={fieldClass}
                    >
                      {EVENT_FREQUENCIES.map((frequency) => (
                        <option key={frequency.value} value={frequency.value}>
                          {frequency.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={<>Repeat starts <span className="font-normal text-slate-400">(required)</span></>}>
                    <input
                      type="date"
                      value={form.recurring_start}
                      onChange={(e) => setField('recurring_start', e.target.value)}
                      className={fieldClass}
                    />
                  </Field>
                </div>

                <Field
                  label="Repeat ends"
                  hint="Blank repeats indefinitely."
                >
                  <input
                    type="date"
                    value={form.recurring_end}
                    onChange={(e) => setField('recurring_end', e.target.value)}
                    className={`${fieldClass} max-w-xs`}
                  />
                </Field>

                {isWeekly && (
                  <div>
                    <label className={labelClass}>On these days</label>
                    <div className="flex flex-wrap gap-3">
                      {EVENT_WEEKDAYS.map((day) => (
                        <label key={day.key} className={checkClass}>
                          <input
                            type="checkbox"
                            checked={Boolean(form[day.key])}
                            onChange={(e) => setField(day.key, e.target.checked)}
                            className="h-4 w-4"
                          />
                          {day.label}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {isMonthly && (
                  <div className="max-w-xs">
                    <Field label="Day of the month" hint="A 31st skips months that have no such day.">
                      <input
                        type="number"
                        min="1"
                        max="31"
                        value={form.date_of_month}
                        onChange={(e) => setField('date_of_month', e.target.value)}
                        className={fieldClass}
                      />
                    </Field>
                  </div>
                )}

                {/* The repeat start is the ANCHOR, not the first occurrence - they are often different days, and
                    saying which day it first lands on is what stops "I saved it and nothing appeared". */}
                {recurringNextLabel && (
                  <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    First appears: {recurringNextLabel}
                  </p>
                )}
              </div>
            )}


            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label={<>Role <span className="font-normal text-slate-400">(optional)</span></>}>
                <select value={form.role_id} onChange={(e) => setField('role_id', e.target.value)} className={fieldClass}>
                  <option value="">-- All roles --</option>
                  {roles.map((role) => (
                    <option key={role.id} value={String(role.id)}>{role.description || `#${role.id}`}</option>
                  ))}
                </select>
              </Field>
              <Field
                label={<>Rank <span className="font-normal text-slate-400">(optional)</span></>}
                hint="Shows to this rank and above."
              >
                <select value={form.rank_id} onChange={(e) => setField('rank_id', e.target.value)} className={fieldClass}>
                  <option value="">-- All ranks --</option>
                  {ranks.map((rank) => (
                    <option key={rank.id} value={String(rank.id)}>{rank.description || `#${rank.id}`}</option>
                  ))}
                </select>
              </Field>
              <Field label={<>Member <span className="font-normal text-slate-400">(optional)</span></>}>
                <select value={form.user_id} onChange={(e) => setField('user_id', e.target.value)} className={fieldClass}>
                  <option value="">-- All members --</option>
                  {users.map((user) => (
                    <option key={user.id} value={String(user.id)}>{user.name || `#${user.id}`}</option>
                  ))}
                </select>
              </Field>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              Fill any of the three to narrow who sees this. Blank in all three shows it to everyone.
            </p>

            {error && (
              <div className="p-3 rounded-xl flex items-start gap-2 text-sm bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-800/60">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : isEditing ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                {isEditing ? 'Save Changes' : 'Create Event'}
              </button>
            </div>
          </form>
        )}
      </div>


      {/* Sorting and filtering, below the add card and above both lists. */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl px-6 py-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className={labelClass}>From</label>
            <input
              type="date"
              value={filters.from}
              onChange={(event) => updateFilters({ ...filters, from: event.target.value })}
              className={selectClass}
            />
          </div>
          <div>
            <label className={labelClass}>To</label>
            <input
              type="date"
              value={filters.to}
              onChange={(event) => updateFilters({ ...filters, to: event.target.value })}
              className={selectClass}
            />
          </div>
          <div>
            <label className={labelClass}>Shows to</label>
            <select
              value={filters.audience}
              onChange={(event) => updateFilters({ ...filters, audience: event.target.value })}
              className={selectClass}
            >
              {EVENT_AUDIENCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Sort by</label>
            <select value={sort} onChange={(event) => setSort(event.target.value)} className={selectClass}>
              {EVENT_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => updateFilters(emptyEventFilters())}
            disabled={!filtersOn}
            className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-40 transition"
          >
            Clear filters
          </button>

          <button
            type="button"
            onClick={reload}
            disabled={loading}
            className="ml-auto flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Showing {matchingRows.length} of {rows.length} event{rows.length === 1 ? '' : 's'}
          {filtersOn ? ' (filters on)' : ''}
        </p>
      </div>

      {loadError && (
        <div className="px-6 py-4 flex items-center gap-3 rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-200">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <p className="text-sm font-medium">{loadError}</p>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <p className="p-6 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading events…
        </p>
      ) : rows.length === 0 ? (
        <p className="p-6 text-sm text-slate-500 dark:text-slate-400">
          No events yet. Create one above and it appears on the calendars.
        </p>
      ) : (
        <>
          {/* One-off events first: they are the majority, and the ones that get created ad hoc. */}
          <EventListCard
            title="One-off events"
            icon={<CalendarPlus className="w-4 h-4 shrink-0 text-red-500" />}
            rows={oneOff}
            visible={oneOffVisible}
            page={oneOffCurrentPage}
            onPageChange={setOneOffPage}
            emptyMessage={
              filtersOn ? 'No one-off events match these filters.' : 'No one-off events yet.'
            }
            rowProps={{ roles, ranks, users, timeFormat, deletingId, onEdit: handleEdit, onDelete: handleDelete }}
          />

          {/* Repeating events in their own card: there are fewer of them, and a repeat that lands on the wrong
              weekday is the mistake this screen invites, so they are worth looking at together. */}
          <EventListCard
            title="Repeating events"
            icon={<Repeat className="w-4 h-4 shrink-0 text-red-500" />}
            rows={recurring}
            visible={recurringVisible}
            page={recurringCurrentPage}
            onPageChange={setRecurringPage}
            emptyMessage={
              filtersOn ? 'No repeating events match these filters.' : 'No repeating events yet.'
            }
            rowProps={{ roles, ranks, users, timeFormat, deletingId, onEdit: handleEdit, onDelete: handleDelete }}
          />
        </>
      )}
    </div>
  );
}

