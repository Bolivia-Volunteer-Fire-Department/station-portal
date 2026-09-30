import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Eye, Loader2, Save } from 'lucide-react';
import { toDateKey, parseSheetDateKey } from '../utils/scheduleDate';
import { WEEKDAYS, MONTHS } from '../utils/calendarConstants';
import { formatClockRange, timeToMinutes } from '../utils/shiftTime';
import { availabilityKey, availabilityRowsFor, windowDaysForMonth } from '../utils/availability';
import EventPill from './EventPill';
import { eventSegmentsByDay, normalizeEventList } from '../utils/events';
import { mergeDayItems } from '../utils/dayOrder';
import ViewToggle from './ViewToggle';
import { useMonthSlide } from '../utils/motion';

// Month navigation, shared by the member editor and the administrator's roster view so
// the two always move the same way.
export function MonthNav({ year, month, onPrev, onNext, onToday, isCurrentMonth }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
      <button
        type="button"
        onClick={onPrev}
        aria-label="Previous month"
        className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      <h3 className="flex-1 text-center text-base font-semibold text-slate-900 dark:text-white">
        {MONTHS[month]} {year}
      </h3>

      <button
        type="button"
        onClick={onNext}
        aria-label="Next month"
        className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700"
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      <button
        type="button"
        onClick={onToday}
        disabled={isCurrentMonth}
        className="ml-2 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-emerald-600 disabled:opacity-40"
      >
        Today
      </button>
    </div>
  );
}

// Month-at-a-time availability editor, modeled on the schedule calendar.
//
// It shows the month's AVAILABILITY WINDOWS - the station's weekly patterns (utils/availability.js) - and lets the
// member mark each occurrence available or not. There is no "show everyone" toggle here on purpose: this screen is
// about one member's availability.
//
// IT NO LONGER DERIVES ANYTHING FROM THE SCHEDULE. The options used to be the shift template occurrences the member's
// rank qualified for, so a month of checkboxes needed templates, assignments AND ranks read first. Windows are
// station-wide, rank-blind and short, so the grid needs one list - and an officer's screen and a member's screen cannot
// disagree about what was on offer, because they read the same list.
//
// Ticks are held locally and saved in ONE request. The draft stores the member's INTENT per window-day rather than an
// optimistic copy of the server state, so a failed save keeps what they chose and the refetched `availability` stays
// the source of truth for every window-day they did not touch. `onSave` receives only what actually changed.
//
// THE SERVER STATE IS WINDOWED, so the grid is told what it holds (`loadedFrom`/`loadedTo`) and can ask for a month it
// does not have. Without that, a month outside the window would draw every day as unmarked - a lie, and one that would
// write a duplicate claim for a day already marked.
export default function AvailabilityCalendar({
  member,
  availability = [],
  windows = [],
  // The range of claims this screen holds, as date keys. Both empty means "assume everything is loaded", which is what
  // a caller that reads them all (and the harnesses) pass.
  loadedFrom = '',
  loadedTo = '',
  onLoadMonth,
  onSave,
  timeFormat = '12',
  // Non-shift calendar entries, rendered among the windows and never markable: an event is not an availability window.
  // See utils/events.
  events = [],
  eventAudience = {},
  ranks = [],
}) {
  const now = new Date();
  const [viewDate, setViewDate] = useState(
    () => new Date(now.getFullYear(), now.getMonth(), 1)
  );
  const [overrides, setOverrides] = useState(() => new Map());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  // Events are visible by default, and this is deliberately not persisted - it is a "get these off my
  // screen for a moment" control, exactly like "Show everyone".
  const [showEvents, setShowEvents] = useState(true);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const todayKey = toDateKey(now);
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();

  // The month's windows, flattened into the window-day rows the grid draws and the diff works on: one per window per
  // occurrence, keyed `window|day` - the same key a claim row resolves to.
  const days = useMemo(() => windowDaysForMonth({ year, month, windows }), [year, month, windows]);
  const items = useMemo(
    () =>
      days.flatMap((day) =>
        day.windows.map((window) => {
          const startMin = timeToMinutes(window.start_time);
          return {
            key: availabilityKey(window.id, day.dateKey),
            windowId: window.id,
            dateKey: day.dateKey,
            window,
            nickname: String(window.nickname || '').trim() || 'Availability',
            // A window with no usable time sorts last rather than pretending to start at midnight.
            startMin: startMin === null ? Number.MAX_SAFE_INTEGER : startMin,
          };
        })
      ),
    [days]
  );
  const byDay = useMemo(() => {
    const map = new Map();
    for (const item of items) {
      if (!map.has(item.dateKey)) map.set(item.dateKey, []);
      map.get(item.dateKey).push(item);
    }
    return map;
  }, [items]);
  const itemByKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items]);

  // Events for the visible month, grouped by day. Normalized defensively so the calendar is correct
  // whichever caller hands it rows: the engine reads `isAllDay`/`startsAt`, and a raw sheet row would
  // silently produce no occurrences at all.
  const normalizedEvents = useMemo(() => normalizeEventList(events), [events]);
  const eventSegmentsByDate = useMemo(() => {
    if (!showEvents || !normalizedEvents.length) return new Map();
    // The window is the month itself, so this does not depend on the grid being built first.
    return eventSegmentsByDay(
      normalizedEvents,
      toDateKey(new Date(year, month, 1)),
      toDateKey(new Date(year, month + 1, 0)),
      { ...eventAudience, ranks }
    );
  }, [showEvents, normalizedEvents, eventAudience, ranks, year, month]);

  // What the server currently says, as window|day -> ROW ID. The id matters here: un-marking deletes a row, so the
  // claim's identity travels with the mark instead of being reconstructed at save time.
  const serverMarked = useMemo(() => {
    const map = new Map();
    for (const row of availabilityRowsFor(availability, member?.id)) {
      const dateKey = parseSheetDateKey(row?.date_from);
      if (dateKey) map.set(availabilityKey(row?.availability_window_id, dateKey), String(row.id || ''));
    }
    return map;
  }, [availability, member]);

  // Switching member must never carry a draft across.
  useEffect(() => {
    setOverrides(new Map());
    setMessage(null);
  }, [member?.id]);

  // WHETHER THIS MONTH IS ACTUALLY LOADED. The claims this screen holds cover a range; a month outside it would draw
  // every day as unmarked, which is wrong in a way that invites a duplicate claim - so the grid says so, and will not
  // save until the month has been asked for.
  const monthStart = toDateKey(new Date(year, month, 1));
  const monthEnd = toDateKey(new Date(year, month + 1, 0));
  const monthLoaded = (!loadedFrom || monthStart >= loadedFrom) && (!loadedTo || monthEnd <= loadedTo);
  const [loadingMonth, setLoadingMonth] = useState(false);

  const loadThisMonth = async () => {
    if (!onLoadMonth || loadingMonth) return;
    setLoadingMonth(true);
    setMessage(null);
    try {
      await onLoadMonth(year, month);
    } catch (err) {
      setMessage({ type: 'error', text: err?.message || 'Could not load this month.' });
    } finally {
      setLoadingMonth(false);
    }
  };

  const isMarked = (item) =>
    overrides.has(item.key) ? overrides.get(item.key) : serverMarked.has(item.key);
  const markedCount = items.filter(isMarked).length;

  // Only the window-days whose intent differs from the server travel. A removal carries the row id, because that is
  // what a delete needs.
  const adds = [];
  const removes = [];
  for (const [key, wanted] of overrides) {
    const item = itemByKey.get(key);
    if (!item) continue;
    if (wanted && !serverMarked.has(key)) adds.push({ windowId: item.windowId, dateKey: item.dateKey });
    else if (!wanted && serverMarked.has(key)) removes.push({ id: serverMarked.get(key) });
  }
  const changeCount = adds.length + removes.length;
  const dirty = changeCount > 0;

  const toggleItem = (item) => {
    const serverValue = serverMarked.has(item.key);
    const next = !isMarked(item);
    setOverrides((prev) => {
      const map = new Map(prev);
      // Ticking back to the server's answer drops the override, so "unsaved changes" can never count a no-op.
      if (next === serverValue) map.delete(item.key);
      else map.set(item.key, next);
      return map;
    });
    setMessage(null);
  };

  const handleSave = async () => {
    if (!dirty || !onSave || !monthLoaded) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await onSave({ adds, removes });
      if (!result?.success) throw new Error(result?.message || 'Failed to save availability.');
      setOverrides(new Map());
      setMessage({ type: 'ok', text: `Saved ${changeCount} change${changeCount === 1 ? '' : 's'}.` });
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Failed to save availability.' });
    } finally {
      setSaving(false);
    }
  };

  const monthLabel = `${MONTHS[month]} ${year}`;

  // Leading blanks, one cell per day, trailing blanks - the grid the schedule calendar
  // builds, so the two months line up.
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);

  // Month movement goes through the slide (see utils/motion), so the day grid travels out to one side and
  // the new month arrives from the other - the weekday row and the month label stay put, as they do in a
  // native calendar. The arrows above are the most-used navigation in this screen.
  const { gridClass, onAnimationEnd, goBy, goTo } = useMonthSlide(viewDate, setViewDate);
  const goPrev = () => goBy(-1);
  const goNext = () => goBy(1);
  const goToday = () => goTo(now);

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <MonthNav
        year={year}
        month={month}
        onPrev={goPrev}
        onNext={goNext}
        onToday={goToday}
        isCurrentMonth={isCurrentMonth}
      />

      {/* Events switch. Shown only when there is something to show, so a station that uses no events never
          sees a control for them. Not persisted: a temporary view choice. */}
      {normalizedEvents.length > 0 && (
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40 flex items-center">
          <ViewToggle
            noun="events"
            description="Include non-shift entries such as trainings. Your availability is not affected."
            icon={Eye}
            enabled={showEvents}
            onChange={setShowEvents}
          />
        </div>
      )}

      <div className="px-4 py-3 space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-sm bg-emerald-600 shrink-0" />
            Available
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-sm border border-dashed border-slate-400 dark:border-slate-500 shrink-0" />
            Not marked
          </span>
          <span className="ml-auto">
            {markedCount} of {items.length} window{items.length === 1 ? '' : 's'} marked available
          </span>
        </div>

        {items.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No availability windows fall in {monthLabel}.
            {member?.name ? ` Nothing is on offer to ${member.name} that month.` : ''}
          </p>
        )}

        {/* A month this screen does not HOLD: said out loud, with the way to fetch it, rather than drawn as an empty grid
            that would read as "you marked nothing" and invite a duplicate claim. */}
        {items.length > 0 && !monthLoaded && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            <span>
              {member?.name ? `${member.name}'s` : 'Your'} saved marks for {monthLabel} are not loaded, so nothing here
              is marked. Load the month before changing it.
            </span>
            <button
              type="button"
              onClick={loadThisMonth}
              disabled={loadingMonth || !onLoadMonth}
              className="ml-auto inline-flex items-center gap-1.5 font-semibold text-amber-900 dark:text-amber-100 hover:underline disabled:opacity-50"
            >
              {loadingMonth ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {loadingMonth ? 'Loading…' : `Load ${MONTHS[month]}`}
            </button>
          </div>
        )}

        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEKDAYS.map((label) => (
            <div key={label} className="text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">
              {label}
            </div>
          ))}
        </div>

        <div
          className={`grid grid-cols-7 gap-1 ${gridClass}`}
          onAnimationEnd={onAnimationEnd}
        >
          {cells.map((day, index) => {
            if (!day) return <div key={`blank-${index}`} className="min-h-[76px]" />;
            const dateKey = toDateKey(day);
            const dayItems = byDay.get(dateKey) || [];
            const isToday = dateKey === todayKey;
            const past = dateKey < todayKey;

            return (
              <div
                key={dateKey}
                className={`min-h-[76px] rounded-lg flex flex-col items-stretch ${
                  past
                    ? 'bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700/40'
                    : dayItems.length
                      ? 'bg-emerald-50/40 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700'
                      : 'bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/40'
                }`}
              >
                <span
                  className={`text-[11px] leading-none px-1 pt-0.5 ${
                    isToday ? 'text-emerald-600 font-bold' : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {day.getDate()}
                </span>

                {/* Chronological, with the day's events placed among its shifts rather than above them all - see
                    utils/dayOrder. Events must never look markable, so they stay plain divs with no availability
                    state: the ordering decides where they sit, not what they are. */}
                {mergeDayItems(dayItems, eventSegmentsByDate.get(dateKey) || []).map(({ kind, value }) => {
                  if (kind === 'event') {
                    const segment = value;
                    return (
                      <EventPill
                        key={`event-${segment.eventId}-${segment.dateKey}`}
                        segment={segment}
                        timeFormat={timeFormat}
                        className="mx-0.5 mt-0.5"
                      />
                    );
                  }

                  const item = value;
                  const marked = isMarked(item);
                  const window = item.window;
                  const timing = window.start_time
                    ? formatClockRange(`${window.start_time} – ${window.end_time || ''}`.trim(), timeFormat)
                    : '';
                  const label = String(window.nickname || '').trim() || timing;

                  return (
                    <button
                      key={item.key}
                      type="button"
                      disabled={past || !monthLoaded}
                      onClick={() => toggleItem(item)}
                      title={`${label || 'Availability'}${timing && label !== timing ? ` · ${timing}` : ''} — ${
                        marked ? 'marked available' : 'not marked'
                      }${
                        !monthLoaded
                          ? ' (load this month first)'
                          : past
                            ? ' (this date has passed)'
                            : ` — click to ${marked ? 'remove' : 'mark'}`
                      }`}
                      className={`mt-0.5 w-full overflow-hidden text-left px-1.5 py-0.5 rounded-md text-[10px] leading-tight font-semibold transition ${
                        marked
                          ? 'bg-emerald-600 text-white'
                          : 'border border-dashed bg-white/70 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400'
                      } ${
                        past || !monthLoaded
                          ? 'opacity-40'
                          : 'cursor-pointer hover:ring-1 hover:ring-emerald-400/70'
                      }`}
                    >
                      <span className="flex items-center gap-1">
                        {marked ? <Check className="w-2.5 h-2.5 shrink-0" /> : null}
                        <span className="truncate">{label || 'Availability'}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Save row. The count is the number of slots whose intent differs from the server,
          so a tick that was undone does not count as a change. */}
      <div className="px-4 py-3 flex flex-wrap items-center gap-3 border-t border-slate-200 dark:border-slate-700">
        {dirty && (
          <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 rounded-full px-2.5 py-1">
            {changeCount} unsaved change{changeCount === 1 ? '' : 's'}
          </span>
        )}
        {message && (
          <span
            className={`text-xs font-medium ${
              message.type === 'error'
                ? 'text-red-600 dark:text-red-400'
                : message.type === 'warn'
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-emerald-700 dark:text-emerald-400'
            }`}
          >
            {message.text}
          </span>
        )}

        <div className="ml-auto flex items-center gap-3">
          {dirty && (
            <button
              type="button"
              onClick={() => {
                setOverrides(new Map());
                setMessage(null);
              }}
              disabled={saving}
              className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-40"
            >
              Discard
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm px-4 py-2.5 rounded-xl transition shadow-lg shadow-emerald-600/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save availability
          </button>
        </div>
      </div>
    </div>
  );
}
