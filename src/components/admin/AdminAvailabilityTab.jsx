import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CalendarRange, Check, Eye, Loader2, Save, Users, X } from 'lucide-react';
import { adminBulkSaveSchedule, adminSetAvailability } from '../../services/api';
import AvailabilityCalendar, { MonthNav } from '../AvailabilityCalendar';
import ViewToggle from '../ViewToggle';
import MemberName from '../MemberName';
import RankIcon from '../RankIcon';
import NoAvailabilityCard from './NoAvailabilityCard';
import { renderInViewport } from '../../utils/viewportLayer';
import { viewportPopoverPosition } from '../../utils/viewportPopover';
import { MONTHS } from '../../utils/calendarConstants';
import { membersWithNoAvailability, monthAvailabilityLoaded, windowDaysForMonth } from '../../utils/availability';
import { eventSegmentTimeLabel, eventSegmentTitle, eventSegmentsByDay, normalizeEventList } from '../../utils/events';
import { toDateKey } from '../../utils/scheduleDate';
// Helper functions for shift slots and available places on each date.
import { placesFittingWindow, placesForDate, rowDateRange, slotsByDay, templateSlotsForMonth } from '../../utils/scheduleSlots';
import { toTimeInputValue } from '../../utils/timeInputValue';
import { userLabel } from '../../utils/displayLabel';
import { assignmentColor } from '../../utils/assignmentColor';

// Special ID to represent all members in the dropdown.
const ALL_MEMBERS = '__all__';

// Width and height limits for the shift assignment popover.
const PICKER_WIDTH = 340;
const PICKER_MAX_HEIGHT = 380;
// Spacing constants for positioning the popover.
const PICKER_GAP = 6;
const PICKER_MARGIN = 8;

// Admin view for member availability (single member or whole crew).
export default function AdminAvailabilityTab({
  token,
  users = [],
  windows = [],
  rosterAvailability = [],
  loadedFrom = '',
  loadedTo = '',
  onLoadMonth,
  ranks = [],
  roles = [],
  timeFormat = '12',
  hideEventsByDefault = false,
  events = [],
  _eventAudience = {},
  scheduleTemplates = [],
  assignments = [],
  schedule = [],
  onNeedSchedule,
  onDataChanged,
}) {
  const [selected, setSelected] = useState(ALL_MEMBERS);

  // The month currently selected in the All Members view.
  const [today] = useState(() => new Date());
  const [rosterDate, setRosterDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const rosterYear = rosterDate.getFullYear();
  const rosterMonth = rosterDate.getMonth();
  const rosterIsCurrentMonth = rosterYear === today.getFullYear() && rosterMonth === today.getMonth();
  const goByMonth = (delta) =>
    setRosterDate((date) => new Date(date.getFullYear(), date.getMonth() + delta, 1));
  const goToMonth = (date) => setRosterDate(new Date(date.getFullYear(), date.getMonth(), 1));

  const showingAll = selected === ALL_MEMBERS;
  const selectedMember = showingAll
    ? null
    : users.find((u) => String(u.id) === String(selected)) || null;

  // Check if availability data is loaded and find members with none.
  const rosterLoaded = monthAvailabilityLoaded(loadedFrom, loadedTo, rosterYear, rosterMonth);
  const noAvailability = membersWithNoAvailability({
    users,
    availability: rosterAvailability,
    roles,
    year: rosterYear,
    month: rosterMonth,
  });

  // Save availability changes for the selected member.
  const save = useCallback(
    async (changes) => {
      if (!token || !selectedMember) {
        return { success: false, message: 'Select a member first.' };
      }
      try {
        const result = await adminSetAvailability(selectedMember.id, changes, token);
        if (result?.success) await onDataChanged?.(token, { from: loadedFrom, to: loadedTo });
        return result;
      } catch (err) {
        return { success: false, message: err?.message || 'Failed to save availability.' };
      }
    },
    [token, selectedMember, onDataChanged, loadedFrom, loadedTo]
  );

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Users className="w-5 h-5 text-emerald-600 shrink-0" />
          <label className="text-sm font-medium text-slate-600 dark:text-slate-300">Member</label>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 min-w-[220px]"
          >
            <option value={ALL_MEMBERS}>All Members</option>
            {users.map((user) => (
              <option key={user.id} value={String(user.id)}>
                {user.name}
              </option>
            ))}
          </select>
          <p className="ml-auto text-xs text-slate-500 dark:text-slate-400">
            {showingAll
              ? 'Who has marked themselves available for each window.'
              : 'Check the windows this member could work, then save.'}
          </p>
        </div>
      </div>

      {showingAll ? (
        // The All Members view FILLS the content frame - it is a board, like the schedule's, so there is no reading
        // column to cap it to. The members who have said nothing sit BESIDE the day list on a computer and ABOVE it
        // on a phone: `lg` rather than `md` because the sidebar takes 256px, so the panel only has room for both
        // columns once the window is a computer rather than a tablet. The list takes whatever the card leaves.
        <div className="flex w-full flex-col gap-4 lg:flex-row lg:items-start">
          <NoAvailabilityCard
            members={noAvailability}
            year={rosterYear}
            month={rosterMonth}
            loaded={rosterLoaded}
            className="lg:w-56 lg:shrink-0"
          />
          <div className="min-w-0 flex-1">
            <AvailabilityRoster
              year={rosterYear}
              month={rosterMonth}
              isCurrentMonth={rosterIsCurrentMonth}
              onPrev={() => goByMonth(-1)}
              onNext={() => goByMonth(1)}
              onToday={() => goToMonth(today)}
              windows={windows}
              availability={rosterAvailability}
              users={users}
              ranks={ranks}
              loadedFrom={loadedFrom}
              loadedTo={loadedTo}
              onLoadMonth={onLoadMonth}
              events={events}
              timeFormat={timeFormat}
              hideEventsByDefault={hideEventsByDefault}
              scheduleTemplates={scheduleTemplates}
              assignments={assignments}
              schedule={schedule}
              onNeedSchedule={onNeedSchedule}
              token={token}
            />
          </div>
        </div>
      ) : selectedMember ? (
        <AvailabilityCalendar
          member={selectedMember}
          availability={rosterAvailability}
          windows={windows}
          loadedFrom={loadedFrom}
          loadedTo={loadedTo}
          onLoadMonth={onLoadMonth}
          ranks={ranks}
          timeFormat={timeFormat}
          events={events}
          eventAudience={{ roleId: selectedMember?.role_id, rankId: selectedMember?.rank_id, userId: selectedMember?.id }}
          hideEventsByDefault={hideEventsByDefault}
          onSave={save}
        />
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Select a member to edit their availability.
        </p>
      )}
    </div>
  );
}

// Roster view showing who is available for each window across the month.
function AvailabilityRoster({
  year,
  month,
  isCurrentMonth,
  onPrev,
  onNext,
  onToday,
  windows = [],
  availability = [],
  users = [],
  ranks = [],
  loadedFrom = '',
  loadedTo = '',
  onLoadMonth,
  events = [],
  hideEventsByDefault = false,
  timeFormat = '12',
  scheduleTemplates = [],
  assignments = [],
  schedule = [],
  onNeedSchedule,
  token,
}) {
  const [showEvents, setShowEvents] = useState(() => !hideEventsByDefault);

  // Temporary assignments chosen by the admin before saving.
  const [draft, setDraft] = useState({});
  // Active popover details for assigning a member to a shift.
  const [picker, setPicker] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const pickerAnchorRef = useRef(null);
  // Tracks which month was fetched to prevent duplicate reads.
  const shiftsAsked = useRef('');

  const days = windowDaysForMonth({ year, month, windows, availability, users });
  const monthStart = toDateKey(new Date(year, month, 1));
  const monthEnd = toDateKey(new Date(year, month + 1, 0));
  // Whether this month's availability claims have been loaded.
  const loaded = monthAvailabilityLoaded(loadedFrom, loadedTo, year, month);

  const assignmentById = useCallback(
    (id) => assignments.find((a) => String(a?.id ?? '') === String(id ?? '')) || null,
    [assignments]
  );

  // Track loading state for month shifts.
  const [shiftsLoading, setShiftsLoading] = useState(false);
  const [shiftsError, setShiftsError] = useState('');

  const monthAlreadyHeld = schedule.some((row) => {
    const { from, to } = rowDateRange(row);
    return Boolean(from && to) && from <= monthEnd && to >= monthStart;
  });

  const ensureShifts = async () => {
    const askedFor = `${year}-${month}`;
    if (!onNeedSchedule || shiftsAsked.current === askedFor || monthAlreadyHeld) return;
    shiftsAsked.current = askedFor;
    setShiftsLoading(true);
    setShiftsError('');
    try {
      await Promise.resolve(onNeedSchedule(monthStart, monthEnd));
    } catch (error) {
      // Reset cache key so user can retry if the fetch failed.
      shiftsAsked.current = '';
      setShiftsError(error?.message || 'Could not read the shifts for this month.');
    } finally {
      setShiftsLoading(false);
    }
  };

  // Load shifts when viewing a different month.
  useEffect(() => {
    void ensureShifts();
  }, [year, month]);

  const slotsForDay = slotsByDay(templateSlotsForMonth({ year, month, scheduleTemplates, assignmentById }));

  // All shifts and open slots for a given date.
  const placesForDay = (dateKey) => placesForDate({ dateKey, slots: slotsForDay[dateKey] || [], rows: schedule });

  // Helper to get assignment ID from either a slot or row.
  const placeAssignmentId = (place) =>
    place?.kind === 'row' ? place.row?.assignment_id : place.slot?.template?.assignment_id;

  // Map of members already assigned to shifts for each date.
  const heldPlaces = (() => {
    const map = new Map();
    for (const day of days) {
      for (const place of placesForDay(day.dateKey)) {
        if (place.userId) map.set(`${day.dateKey}|${place.userId}`, place);
      }
    }
    return map;
  })();
  const heldFor = (member, dateKey) =>
    heldPlaces.get(`${dateKey}|${String(member.id)}`) || null;

  const placeTimeLabel = (place) => {
    const source = place.kind === 'row' ? place.row : place.slot.template;
    const start = toTimeInputValue(source?.start_time);
    const end = toTimeInputValue(source?.end_time);
    if (start && end) return `${start}–${end}`;
    return start || end || '';
  };

  // Find any unsaved draft assignment for this member on this day.
  const draftFor = (member, dateKey) =>
    Object.values(draft).find(
      (entry) => entry.place.dateKey === dateKey && entry.userId === String(member.id)
    ) || null;

  // Look up a member by ID, with a fallback if their profile isn't found.
  const memberById = (id) =>
    users.find((user) => String(user.id) === String(id)) || { id, name: 'Another member' };

  // Only show shifts that fit within the availability window the member signed up for.
  const pickerFilter = picker
    ? placesFittingWindow(placesForDay(picker.dateKey), picker.window)
    : { fitted: [], outside: [] };
  const pickerPlaces = pickerFilter.fitted;
  const pickerWindowLabel = picker?.window ? picker.window.nickname || 'this window' : '';

  const closePicker = () => {
    pickerAnchorRef.current = null;
    setPicker(null);
  };

  const openPicker = (event, member, dateKey, availabilityWindow) => {
    const rect = event.currentTarget.getBoundingClientRect();
    // Position popover above or below the button depending on screen space.
    const spaceAbove = rect.top - PICKER_MARGIN - PICKER_GAP;
    const spaceBelow = window.innerHeight - rect.bottom - PICKER_MARGIN - PICKER_GAP;
    const flipUp = spaceBelow < PICKER_MAX_HEIGHT && spaceAbove > spaceBelow;
    const position = viewportPopoverPosition({
      anchor: rect,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      width: PICKER_WIDTH,
      maxHeight: PICKER_MAX_HEIGHT,
      margin: PICKER_MARGIN,
      gap: PICKER_GAP,
    });
    pickerAnchorRef.current = event.currentTarget;
    setSaveError('');
    setNotice('');
    setPicker({
      member,
      dateKey,
      window: availabilityWindow || null,
      flipUp,
      top: flipUp ? undefined : rect.bottom + PICKER_GAP,
      bottom: flipUp ? window.innerHeight - rect.top + PICKER_GAP : undefined,
      left: position.left,
      width: position.width,
      maxHeight: Math.max(0, Math.min(position.maxHeight, flipUp ? spaceAbove : spaceBelow)),
    });
    void ensureShifts();
  };

  // Close the popup menu when the user scrolls or hits Escape.
  useEffect(() => {
    if (!picker) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') closePicker();
    };
    const onScroll = () => closePicker();
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [picker]);

  const choosePlace = (member, place) => {
    setDraft((prev) => ({
      ...prev,
      [place.key]: { key: place.key, userId: String(member.id), fields: place.fields, member, place },
    }));
    setNotice('');
    setSaveError('');
    closePicker();
  };

  const dropDraft = (key) =>
    setDraft((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });

  // Turn server errors into helpful messages.
  const readSaveError = (error) => {
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    if (code.includes('permission-denied') || /permission/i.test(message)) {
      return 'You do not have permission to change the schedule. Ask an administrator to add "Manage the schedule" to your role.';
    }
    if (code.includes('unauthenticated')) return 'Your session has ended. Sign in again and retry.';
    return message || 'Could not save those assignments.';
  };

  const saveDraft = async () => {
    const chosen = Object.values(draft);
    if (!chosen.length) return;
    setSaving(true);
    setSaveError('');
    setNotice('');
    try {
      // Save all shift fields so custom hours and settings are preserved.
      const entries = chosen.map((entry) => ({ ...entry.fields, user_id: entry.userId }));
      const result = await adminBulkSaveSchedule({ entries }, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to save the schedule.');
      const count = result.saved ?? entries.length;
      setDraft({});
      setNotice(`Saved ${count} assignment${count === 1 ? '' : 's'}.`);
      // Ask the parent component to refresh schedule data for this month.
      shiftsAsked.current = '';
      await Promise.resolve(onNeedSchedule?.(monthStart, monthEnd)).catch(() => {});
    } catch (error) {
      setSaveError(readSaveError(error));
    } finally {
      setSaving(false);
    }
  };

  // Group events by day across the month, expanding recurring events.
  const allEventsByDay = eventSegmentsByDay(normalizeEventList(events), monthStart, monthEnd, { ranks });
  const eventsByDay = showEvents ? allEventsByDay : new Map();
  // Count total events shown this month.
  const eventCount = showEvents ? days.reduce((sum, day) => sum + (eventsByDay.get(day.dateKey) || []).length, 0) : 0;

  const rankOf = (rankId) =>
    ranks.find((rank) => String(rank?.id ?? '').trim() === String(rankId ?? '').trim()) || null;

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <MonthNav
        year={year}
        month={month}
        onPrev={onPrev}
        onNext={onNext}
        onToday={onToday}
        isCurrentMonth={isCurrentMonth}
      />

      <div className="px-4 py-3 space-y-4">
        {/* THE MONTH IS BUILT HERE AND SAVED ONCE.
            Every name click adds an assignment to the draft above and nothing is written until this button is pressed,
            so an officer can plan a whole month without committing half of it. It sits at the TOP because that is where
            the decision is made after working down the list, and it states the count so the officer can see the draft is
            what they think it is. */}
        {(Object.keys(draft).length > 0 || saveError || notice) && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 px-3 py-2">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                {Object.keys(draft).length > 0
                  ? `${Object.keys(draft).length} unsaved assignment${Object.keys(draft).length === 1 ? '' : 's'}`
                  : notice}
              </span>
              <div className="ml-auto flex items-center gap-2">
                {Object.keys(draft).length > 0 && (
                  <button
                    type="button"
                    onClick={() => { setDraft({}); setSaveError(''); setNotice(''); }}
                    disabled={saving}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    <X className="h-3.5 w-3.5" /> Discard
                  </button>
                )}
                <button
                  type="button"
                  onClick={saveDraft}
                  disabled={saving || Object.keys(draft).length === 0}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
            {saveError && (
              <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-red-700 dark:text-red-300">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {saveError}
              </p>
            )}
          </div>
        )}
        {events.length > 0 && (
          <div className="flex items-center">
            <ViewToggle
              noun="events"
              description="Include non-shift entries such as trainings. Availability is not affected."
              icon={Eye}
              enabled={showEvents}
              onChange={setShowEvents}
            />
          </div>
        )}
        {/* Show total count of events across the month. */}
        {eventCount > 0 && (
          <p className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <CalendarRange className="w-3.5 h-3.5 shrink-0" />
            {eventCount} event{eventCount === 1 ? '' : 's'} this month
          </p>
        )}

        {/* Loading and error status for the month's shifts. */}
        {(shiftsLoading || shiftsError) && (
          <p
            role={shiftsError ? 'alert' : undefined}
            className={`flex items-start gap-1.5 text-xs ${
              shiftsError ? 'text-red-700 dark:text-red-300' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {shiftsLoading ? (
              <>
                <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" /> Reading this month’s shifts, so the names
                already on one can be filled in…
              </>
            ) : (
              <>
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Who is already on a shift is not shown:{' '}
                {shiftsError}
              </>
            )}
          </p>
        )}

        {!loaded && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            <span>Nobody&rsquo;s claims for {MONTHS[month]} {year} are loaded, so every window below looks uncovered.</span>
            <button
              type="button"
              onClick={() => onLoadMonth?.(year, month)}
              disabled={!onLoadMonth}
              className="ml-auto font-semibold text-amber-900 dark:text-amber-100 hover:underline disabled:opacity-50"
            >
              Load {MONTHS[month]}
            </button>
          </div>
        )}

        {days.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No availability windows fall in {MONTHS[month]} {year}.
          </p>
        )}

        {days.map((day) => (
          <div key={day.dateKey} className="space-y-2">
            {/* Day header showing date and any events on that date. */}
            <h4 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
              <CalendarRange className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              {new Date(`${day.dateKey}T12:00:00`).toLocaleDateString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })}
              {(eventsByDay.get(day.dateKey) || []).length > 0 && (
                <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 normal-case">
                  {(eventsByDay.get(day.dateKey) || []).map((segment) => (
                    <span
                      key={`event-${segment.eventId}-${segment.dateKey}`}
                      title={`${eventSegmentTitle(segment)} · ${eventSegmentTimeLabel(segment, timeFormat)}`}
                      className="flex items-center gap-1.5 font-normal text-slate-600 dark:text-slate-300"
                    >
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-black/10"
                        style={{ backgroundColor: segment.color }}
                      />
                      <span className="truncate max-w-[16rem]">{eventSegmentTitle(segment)}</span>
                      <span className="text-slate-400 dark:text-slate-500">
                        {eventSegmentTimeLabel(segment, timeFormat)}
                      </span>
                    </span>
                  ))}
                </span>
              )}
            </h4>
            {day.windows.map((window) => (
              <div
                key={window.key}
                className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2"
              >
                <div className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="font-medium text-slate-800 dark:text-slate-100">
                    {window.nickname || 'Availability'}
                  </span>
                  {(window.start_time || window.end_time) && (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {window.start_time} – {window.end_time}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
                    {window.claimed.length} member{window.claimed.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {window.claimed.length === 0 && (
                    <span className="text-xs text-slate-400 dark:text-slate-500">Nobody has claimed it.</span>
                  )}
                  {window.claimed.map((member) => {
                    const rank = rankOf(member.rank_id);
                    // Check draft first, then saved shifts for who is assigned.
                    const pending = draftFor(member, day.dateKey);
                    const held = pending ? null : heldFor(member, day.dateKey);
                    const chosen = pending ? pending.place : held;
                    // Use the assignment's color if assigned.
                    const assignedColor = chosen ? assignmentColor(placeAssignmentId(chosen), assignments) : '';
                    const rankPrefix = rank?.description ? `${member.name} — ${rank.description}. ` : '';
                    const chipTitle = chosen
                      ? `${rankPrefix}Already on ${chosen.name} on this day. Click to change it.`
                      : `${rankPrefix}Add a shift for ${member.name} on this day.`;
                    const chipStyle = assignedColor
                      ? { backgroundColor: assignedColor, borderColor: assignedColor, color: '#ffffff' }
                      : rank?.color
                        ? { borderColor: rank.color, color: rank.color }
                        : undefined;
                    return (
                      <button
                        key={member.id}
                        type="button"
                        onClick={(event) => openPicker(event, member, day.dateKey, window)}
                        aria-haspopup="dialog"
                        title={chipTitle}
                        className={`inline-flex flex-col items-start gap-0.5 rounded-xl border px-2 py-1 text-xs font-medium transition ${
                          assignedColor ? '' : 'hover:bg-slate-100 dark:hover:bg-slate-700'
                        }`}
                        style={chipStyle}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          {rank?.icon ? <RankIcon name={rank.icon} className="h-3 w-3" /> : null}
                          <MemberName user={member} className="h-3 w-3" />
                        </span>
                        {chosen && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold">
                            {pending && <Check className="h-3 w-3 shrink-0" />} {chosen.name}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Popover menu to pick a shift for the clicked member. */}
      {picker &&
        renderInViewport(
          <>
            <div className="fixed inset-0 z-40" onClick={closePicker} />
            <div
              role="dialog"
              aria-label={`Assign ${userLabel(picker.member)} to a shift`}
              className="fixed z-50 max-w-[calc(100vw-16px)] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white shadow-2xl origin-top animate-popoverIn dark:border-slate-700 dark:bg-slate-800"
              style={{
                top: picker.top,
                bottom: picker.bottom,
                left: picker.left,
                width: picker.width,
                maxHeight: picker.maxHeight,
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-700">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                    {userLabel(picker.member)}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {Number(picker.dateKey.slice(8, 10))} {MONTHS[month]} —{' '}
                    {pickerWindowLabel ? `shifts inside ${pickerWindowLabel}` : 'pick a shift to assign'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closePicker}
                  aria-label="Close"
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-1 px-2 py-2">
                {shiftsLoading && (
                  <p className="flex items-center gap-2 px-1 py-2 text-xs text-slate-500 dark:text-slate-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading this month’s shifts…
                  </p>
                )}
                {!shiftsLoading && shiftsError && (
                  <p
                    role="alert"
                    className="flex items-start gap-1.5 px-1 py-2 text-xs text-red-700 dark:text-red-300"
                  >
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {shiftsError}
                  </p>
                )}
                {!shiftsLoading && !shiftsError && pickerPlaces.length === 0 && (
                  <p className="px-1 py-2 text-xs text-slate-500 dark:text-slate-400">
                    {pickerFilter.outside.length > 0
                      ? `None of this day’s ${pickerFilter.outside.length} shift${
                          pickerFilter.outside.length === 1 ? '' : 's'
                        } fall inside ${pickerWindowLabel} — they run outside the hours this member marked available.`
                      : 'No shifts fall on this day. A shift appears here when a schedule template runs on this weekday, or when a one-off shift has been added for the date on the schedule board.'}
                  </p>
                )}
                {pickerPlaces.map((place) => {
                  const taken = Boolean(place.userId);
                  const theirs = taken && place.userId === String(picker.member.id);
                  // Check if this shift is chosen for this member in the current unsaved draft.
                  const chosenHere =
                    Boolean(draft[place.key]) && draft[place.key].userId === String(picker.member.id);
                  return (
                    <button
                      key={place.key}
                      type="button"
                      disabled={taken}
                      onClick={() =>
                        chosenHere ? dropDraft(place.key) : choosePlace(picker.member, place)
                      }
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${
                        taken
                          ? 'cursor-not-allowed opacity-70'
                          : chosenHere
                            ? 'bg-emerald-50 dark:bg-emerald-950/40'
                            : 'hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-xs font-semibold ${
                            taken ? 'text-slate-500 line-through dark:text-slate-400' : 'text-slate-900 dark:text-white'
                          }`}
                        >
                          {place.name}
                        </span>
                        <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                          {placeTimeLabel(place)}
                          {place.kind === 'row' ? ' · one-off' : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        {theirs ? 'Already theirs' : taken ? `Filled by ${userLabel(memberById(place.userId))}` : chosenHere ? 'Chosen — remove' : 'Assign'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
    </div>
  );
}
