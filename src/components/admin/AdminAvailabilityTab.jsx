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
// WHAT A SLOT IS, and every place on a day somebody can be put - the same rule the Schedule Management board draws from
// (utils/scheduleSlots), so a shift offered here is the same shift the board shows in the same slot.
import { placesFittingWindow, placesForDate, rowDateRange, slotsByDay, templateSlotsForMonth } from '../../utils/scheduleSlots';
import { toTimeInputValue } from '../../utils/timeInputValue';
import { userLabel } from '../../utils/displayLabel';
import { assignmentColor } from '../../utils/assignmentColor';

// The value that means "show everyone" in the member picker. Deliberately not a user id,
// so it can never collide with one.
const ALL_MEMBERS = '__all__';

// The popover the day's shifts are offered in - the same shape and the same positioning helper the board's own slot
// popover uses (utils/viewportPopover), so a list that appears beside a name behaves the way the ones on the board do.
const PICKER_WIDTH = 340;
const PICKER_MAX_HEIGHT = 380;
// The gap between the button and its menu, and the margin kept from the edges of the screen - the same two numbers the
// shared positioning helper uses, named here because the flip below is worked out from the space they leave.
const PICKER_GAP = 6;
const PICKER_MARGIN = 8;

// Administrator view of availability.
//
// One member selected: the same month grid the member sees, toggling that member's rows - useful when someone phones in
// and needs a change made for them.
//
// All Members: each day of the month, the availability windows that fall on it, and the members who claimed them -
// and BESIDE it, a card naming the members who claimed nothing at all this month, which is the other half of the
// answer. That list is now the whole view: it used to be built from the month's shift templates, with their times,
// assignments and ranks, which is a lot of machinery to answer "who can cover Tuesday night?".
//
// BOTH views read the SAME two things: the windows (station reference data, loaded once) and a month of claims. That is
// the simplification the windows model buys: one short list instead of templates, assignments and ranks per member.
export default function AdminAvailabilityTab({
  token,
  users = [],
  windows = [],
  rosterAvailability = [],
  loadedFrom = '',
  loadedTo = '',
  onLoadMonth,
  ranks = [],
  timeFormat = '12',
  hideEventsByDefault = false,
  // Non-shift entries, drawn on BOTH views: on the single-member grid so an administrator sees the same month the member
  // does, and in each day's heading of the All Members list, which is where they were before the availability model moved
  // to windows. The audience filter is the grid's alone: the list is an administrator's view of the whole crew, so an event
  // aimed at one rank still belongs in it.
  events = [],
  _eventAudience = {},
  // THE SCHEDULE, for the All Members list's assign control. The templates and assignments are station reference data
  // the panel already holds; `schedule` is the month the app last read and `onNeedSchedule` is how this tab asks for
  // another - the same read the board makes, so this needs no route of its own.
  scheduleTemplates = [],
  assignments = [],
  schedule = [],
  onNeedSchedule,
  onDataChanged,
}) {
  // Opens on All Members: the first thing an administrator wants from this tab is the
  // overview, and the picker sits right above it to drill into one person.
  const [selected, setSelected] = useState(ALL_MEMBERS);

  // The month the All Members view is showing. It lives HERE rather than inside the roster because two things read
  // it - the roster's day list and the no-availability card beside it - and they must agree. (The single-member
  // view keeps its own month: it is a different screen with its own arrows.)
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

  // The All Members view's two month-scoped readings: whether the month's claims have been read at all, and who
  // said nothing. Both come from utils/availability, so the card and the day list cannot disagree.
  const rosterLoaded = monthAvailabilityLoaded(loadedFrom, loadedTo, rosterYear, rosterMonth);
  const noAvailability = membersWithNoAvailability({
    users,
    availability: rosterAvailability,
    year: rosterYear,
    month: rosterMonth,
  });

  // The calendar owns the draft; this performs the batch save and refreshes. The token is passed explicitly on purpose:
  // refreshAvailability expects one, and calling it bare would come back UNAUTHORIZED and raise the re-auth prompt.
  const save = useCallback(
    async (changes) => {
      if (!token || !selectedMember) {
        return { success: false, message: 'Select a member first.' };
      }
      try {
        const result = await adminSetAvailability(selectedMember.id, changes, token);
        if (result?.success) await onDataChanged?.(token);
        return result;
      } catch (err) {
        return { success: false, message: err?.message || 'Failed to save availability.' };
      }
    },
    [token, selectedMember, onDataChanged]
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
              // The events, in each day's heading. The All Members list names WHO is free, and an event is very often why
              // fewer of them are - so it belongs beside the day, not only on the single-member grid below.
              events={events}
              timeFormat={timeFormat}
              hideEventsByDefault={hideEventsByDefault}
              // The schedule the assign control reads and writes. NOT gated on `can_edit_schedule`: an officer whose role
              // lacks it will be refused by the callable when they save, and the refusal is reported as what it is (see
              // saveError) rather than hidden behind a control that is missing for no visible reason.
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
          // The audience is the MEMBER being edited, so an administrator sees the month that member sees.
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

// All Members: each day of the month, the windows that fall on it, and the members who claimed each one.
//
// A LIST rather than a grid, because the question is "who can cover this?" rather than "what can this person work?" - and
// it is a short list now: the windows in the month, not every shift occurrence the station knows about. Nothing here is
// editable; an officer changes a claim by picking that member in the picker above.
function AvailabilityRoster({
  // The visible month and its arrows - owned by the tab above, because the no-availability card this view draws
  // beside the list reads the same month and the two must not be able to drift apart.
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
  // The month's events, in the day heading. This is the shape `AdminAvailabilityRoster` drew before the availability
  // model was rebuilt around windows (see commit 3edde4a, src/components/admin/AdminAvailabilityRoster.jsx) - it was lost
  // with the split of that file, and this is it put back rather than a new idea about it.
  //
  // SHOWN ONCE PER DATE RATHER THAN PER WINDOW, for the reason the original gave and it is still the right one: an event
  // belongs to the DAY, and repeating it down every window under it would bury the names this view exists to show.
  events = [],
  hideEventsByDefault = false,
  timeFormat = '12',
  // The schedule the assign control reads and writes (see the props' note on the tab above).
  scheduleTemplates = [],
  assignments = [],
  schedule = [],
  onNeedSchedule,
  token,
}) {
  const [showEvents, setShowEvents] = useState(() => !hideEventsByDefault);

  // WHAT AN OFFICER HAS DECIDED AND NOT YET SAVED.
  //
  // A name click adds to this and NOTHING is written until Save, so a whole month can be built in one pass - the same
  // draft-then-save shape the schedule board uses, and the reason the batch route (adminBulkSaveSchedule) exists: half a
  // month applied is a schedule nobody asked for.
  const [draft, setDraft] = useState({});
  // The shift picker: which member it was opened for, and where to draw it. Null when closed.
  const [picker, setPicker] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const pickerAnchorRef = useRef(null);
  // Which month's shifts have been asked for, so a click does not re-read one.
  const shiftsAsked = useRef('');

  const days = windowDaysForMonth({ year, month, windows, availability, users });
  const monthStart = toDateKey(new Date(year, month, 1));
  const monthEnd = toDateKey(new Date(year, month + 1, 0));
  // Whether this month's claims have been read - the SAME derivation the no-availability card uses, so the two
  // cannot disagree about whether "everyone has said nothing" is the truth or just a month nobody has asked for.
  const loaded = monthAvailabilityLoaded(loadedFrom, loadedTo, year, month);

  const assignmentById = useCallback(
    (id) => assignments.find((a) => String(a?.id ?? '') === String(id ?? '')) || null,
    [assignments]
  );

  // THE MONTH'S SHIFTS ARE READ WHEN A NAME IS FIRST CLICKED, not when the tab opens.
  //
  // This is the only read the assign menu needs and it is the biggest thing on the screen - a month of schedule rows -
  // and the All Members list is what this tab OPENS on, so an officer who only wanted to see who was free was paying for
  // a month of schedule on every visit. The templates and assignments come with the tab instead (they are small station
  // reference data, and the panel already holds them for other tabs), so a slot can be drawn the moment the menu opens;
  // only the rows are waited on. A month the app already holds is not asked for at all, which is the common case when an
  // officer has just come from the board.
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
      // A FAILED READ IS NOT REMEMBERED AS DONE, so the next click tries again rather than the month being quietly
      // empty for the rest of the session.
      shiftsAsked.current = '';
      setShiftsError(error?.message || 'Could not read the shifts for this month.');
    } finally {
      setShiftsLoading(false);
    }
  };

  // NOT WRAPPED IN useMemo, and that follows the note on the events derivation below: the React Compiler memoizes this
  // itself, and a manual memo written here is reported as one it cannot preserve. One pass over the month's templates
  // either way, so there is nothing to be clever about.
  const slotsForDay = slotsByDay(templateSlotsForMonth({ year, month, scheduleTemplates, assignmentById }));

  // Every place on a day somebody can be put, each carrying who is already in it - one list answering both "what is
  // free" and "who has the rest".
  const placesForDay = (dateKey) => placesForDate({ dateKey, slots: slotsForDay[dateKey] || [], rows: schedule });

  const placeTimeLabel = (place) => {
    const source = place.kind === 'row' ? place.row : place.slot.template;
    const start = toTimeInputValue(source?.start_time);
    const end = toTimeInputValue(source?.end_time);
    if (start && end) return `${start}–${end}`;
    return start || end || '';
  };

  // The assignment this member has been given on this day and not yet saved, if any - shown on their chip so a draft is
  // never a mystery about who it was for.
  const draftFor = (member, dateKey) =>
    Object.values(draft).find(
      (entry) => entry.place.dateKey === dateKey && entry.userId === String(member.id)
    ) || null;

  // Who holds a filled place. An id with no row in the directory still has to say something: this list names a member
  // the caller may not be able to look up, and "Unnamed member" beside a struck-through shift is worse than useless.
  const memberById = (id) =>
    users.find((user) => String(user.id) === String(id)) || { id, name: 'Another member' };

  // ONLY THE SHIFTS THE MEMBER SAID THEY COULD WORK. The day's shifts are filtered to the window whose name was clicked,
  // so the menu answers "who can cover this?" rather than offering a day shift beside somebody who claimed a night.
  //
  // THE REJECTED ONES ARE KEPT rather than dropped: an empty menu has to be able to say it was filtered and how many it
  // hid, or it reads as a bug - which is exactly how it read before the filter existed.
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
    // WHERE IT GOES, and the flipped case is anchored by its BOTTOM.
    //
    // The shared helper sizes the panel as if it were `maxHeight` tall and returns a `top` for that assumption, so a menu
    // holding three rows that flips above its button lands a few hundred pixels too high - visibly detached from the name
    // it belongs to, which is exactly the complaint the first version earned. Anchoring with `bottom` places the box by
    // the edge nearest the button, so the menu's own height cannot move it away. Each direction gets the space that is
    // actually there for `max-height`, so a long list scrolls rather than running off the screen.
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
      // The window whose name was clicked. The menu lists only the shifts that fall inside it (see placeFitsWindow).
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

  // CLOSES ON SCROLL rather than chasing the page. The board repositions its popover on scroll; this list is long and the
  // anchor may scroll away entirely, and a menu left floating over unrelated rows is worse than one that closes.
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

  // A REFUSAL BY PERMISSION IS NAMED AS ONE. This screen is open to roles that manage availability but not the schedule,
  // and the callable requires `can_edit_schedule` - so the likeliest failure here is a role that needs a permission
  // added, and saying exactly that is more use than "internal".
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
      // Every entry is a COMPLETE field set (utils/scheduleSlots#rowFieldsOf): the writer replaces a row's fields rather
      // than merging, so an entry that omitted the times would blank a custom shift's own hours.
      const entries = chosen.map((entry) => ({ ...entry.fields, user_id: entry.userId }));
      const result = await adminBulkSaveSchedule({ entries }, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to save the schedule.');
      const count = result.saved ?? entries.length;
      setDraft({});
      setNotice(`Saved ${count} assignment${count === 1 ? '' : 's'}.`);
      // RE-READ THE MONTH, and that is the whole refresh: App's loadScheduleWindow replaces the rows it was asked about
      // and holds them in the shared array the board reads too, so one call puts both screens right and picks up the
      // server-assigned ids a later edit would need. Clearing the asked-for marker is what makes the re-read happen.
      shiftsAsked.current = '';
      await Promise.resolve(onNeedSchedule?.(monthStart, monthEnd)).catch(() => {});
    } catch (error) {
      setSaveError(readSaveError(error));
    } finally {
      setSaving(false);
    }
  };


  // The month's events, keyed by date - expanded for RECURRING ones, because `eventSegmentsByDay` is what turns a weekly
  // drill night into an entry on each Tuesday it falls on. Normalised defensively, as the original was, so a row that
  // arrives half-built cannot silently disappear from a heading.
  //
  // NOT WRAPPED IN useMemo, and that is a change from the original. The React Compiler memoizes this itself, and when a
  // manual `useMemo` is written here it reports `react(preserve-manual-memoization)` - four warnings saying the memo it
  // cannot keep is being thrown away, which is the opposite of what writing one was for. The derivation is a single pass
  // over the month's events, so there is nothing to be clever about either way.
  const allEventsByDay = eventSegmentsByDay(normalizeEventList(events), monthStart, monthEnd, { ranks });
  const eventsByDay = showEvents ? allEventsByDay : new Map();
  // Counted as well as shown, because an event is very often WHY fewer people are free that night.
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
        {/* The month's events, counted as well as listed per day - an officer reading "3 members available" wants to know
            whether that is because nobody claimed it or because the drill night took them. Counted over the days this
            list actually draws, so a recurring event is counted once per occurrence it puts on the calendar. */}
        {eventCount > 0 && (
          <p className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <CalendarRange className="w-3.5 h-3.5 shrink-0" />
            {eventCount} event{eventCount === 1 ? '' : 's'} this month
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
            {/* THE DAY HEADING, and the events that fall on it - restored from `AdminAvailabilityRoster` (3edde4a), which
                drew them here before the file was split. A coloured DOT rather than a filled chip, for the reason the
                original gave: a pale event colour must not swallow the date, and these should not read as shift pills. */}
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
                    const pending = draftFor(member, day.dateKey);
                    // A MEMBER WHO HAS BEEN GIVEN A SHIFT IS FILLED IN, with the ASSIGNMENT's colour - the same solid
                    // fill the board draws for a staffed shift, so the same member reads the same way on both screens -
                    // and the shift's name goes UNDER their name rather than trailing it. A trailing name made one long
                    // chip that pushed the rest of the row about and read as part of the member's name; on its own line
                    // the assignment is plainly a second fact about that member, and a run of names stays a readable row.
                    const assignedColor = pending
                      ? assignmentColor(
                          pending.place.kind === 'row'
                            ? pending.place.row?.assignment_id
                            : pending.place.slot?.template?.assignment_id,
                          assignments
                        )
                      : '';
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
                        title={`${rank?.description ? `${member.name} — ${rank.description}. ` : ''}Add a shift for ${member.name} on this day.`}
                        // A BUTTON because it is one: clicking a name is how the month gets built from this list, and a
                        // span with onClick is unreachable by keyboard and invisible to anything reading the page aloud.
                        className={`inline-flex flex-col items-start gap-0.5 rounded-xl border px-2 py-1 text-xs font-medium transition ${
                          assignedColor ? '' : 'hover:bg-slate-100 dark:hover:bg-slate-700'
                        }`}
                        style={chipStyle}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          {rank?.icon ? <RankIcon name={rank.icon} className="h-3 w-3" /> : null}
                          {/* The name component every other screen uses, so a certification badge shows up here too. */}
                          <MemberName user={member} className="h-3 w-3" />
                        </span>
                        {pending && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold">
                            <Check className="h-3 w-3 shrink-0" /> {pending.place.name}
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

      {/* THE DAY'S SHIFTS, BESIDE THE NAME THAT WAS CLICKED. In the viewport layer rather than inside this card, because
          the list scrolls and a menu drawn in place would be clipped by it (see utils/viewportLayer - a transformed
          ancestor decides where a fixed element lands, and the page transition puts one on exactly that ancestor). */}
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
                  // A slot this member already holds is not an error to be refused - it is the answer, and saying so
                  // stops an officer assigning the same person twice.
                  const theirs = taken && place.userId === String(picker.member.id);
                  // Chosen FOR THIS MEMBER in the draft. Clicking it takes the choice back, which is how a mis-click is
                  // undone without discarding the rest of the month.
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
