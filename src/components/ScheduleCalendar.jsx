import React, { useState, useEffect, useMemo } from 'react';
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Clock, Eye, Printer, Users } from 'lucide-react';
import { toDateKey, parseSheetDateKey } from '../utils/scheduleDate';
import { assignmentColor } from '../utils/assignmentColor';
import RankIcon from './RankIcon';
import { rowTimeText, templateTimeText, timeToMinutes, prettyRange, shiftTimeLabel } from '../utils/shiftTime';
import { WEEKDAYS, MONTHS, DAY_ORDER } from '../utils/calendarConstants';
import { isShiftDay } from '../utils/shiftPlacement';
import EventPill from './EventPill';
import { eventSegmentTimeLabel, eventSegmentTitle, eventSegmentsByDay, normalizeEventList } from '../utils/events';
import { templateIsActiveOn } from '../utils/scheduleTemplates';
import { assignmentIsActiveOn } from '../utils/assignmentDates';
import { parseRankOrder, memberCanFillAssignment } from '../utils/rankEligibility';
import { compareCrewOrder } from '../utils/crewOrder';
import { submitShiftOffer } from '../services/api';
import ViewToggle from './ViewToggle';
import ShiftOfferModal from './ShiftOfferModal';
import ScheduleItemModal from './ScheduleItemModal';
import { shiftItemDetails, eventItemDetails } from '../utils/scheduleItemDetails';
import PrintableSchedule from './PrintableSchedule';

// Identity used for an unfilled shift wherever a member's name would go.
const OPEN_SHIFT_LABEL = 'Open';

// Shift-window formatting lives in utils/shiftTime so every schedule view renders
// times identically (the pending-approvals table uses the same helpers).

export default function ScheduleCalendar({
  currentUser,
  schedule = [],
  assignments = [],
  scheduleTemplates = [],
  ranks = [],
  users = [],
  // Reference rows for the event detail modal's audience line ("...role", "...rank and above"). Only names
  // are read from them; a caller that omits them gets ids instead, which is why they are optional.
  roles = [],
  offers = [],
  token,
  // Role permissions. Least privilege by default: a caller that forgets to pass
  // these gets a read-only calendar rather than one that can act.
  canMakeOffers = false,
  canViewFullSchedule = false,
  // Non-shift calendar entries, already filtered by the caller's audience. Rendered above the shift pills
  // and never mixed into them: an event is not a shift and must never look offerable.
  events = [],
  eventAudience = {},
  timeFormat = '12',
  // Used only on the printed sheet's header.
  departmentName = '',
  onOfferSubmitted,
}) {
  const now = new Date();
  const [viewDate, setViewDate] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  // While a print is being prepared the sheet is mounted (see PrintableSchedule); it prints itself and
  // calls back when the browser is done, so nothing is left behind.
  const [printOpen, setPrintOpen] = useState(false);
  // Events default to visible, and the toggle is deliberately NOT persisted: it is a "get these off my
  // screen for a moment" control, the same way "Show everyone" behaves.
  const [showEvents, setShowEvents] = useState(true);
  // Default off, and local to this component: the calendar opens on the
  // signed-in member's own shifts and only expands to the whole crew on demand.
  const [showEveryone, setShowEveryone] = useState(false);
  // Open pill the member clicked, held while the confirmation modal is up.
  const [offerTarget, setOfferTarget] = useState(null);
  // The item whose details are open, as { kind: 'shift' | 'event', item }. Shift pills that are already
  // filled and event pills open this; open pills keep going straight to the offer modal, which is the same
  // layout plus the one action that pill has.
  const [detailTarget, setDetailTarget] = useState(null);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthLabel = `${MONTHS[month]} ${year}`;
  const todayKey = toDateKey(now);
  const viewKey = toDateKey(viewDate);

  const assignmentById = (id) => assignments.find((a) => String(a.id) === String(id));
  const assignmentInfo = (id) => assignmentById(id)?.description || '';

  const monthStartKey = toDateKey(new Date(year, month, 1));
  const monthEndKey = toDateKey(new Date(year, month + 1, 0));

  // Friendly label for a member: the signed-in user always resolves from the
  // session, everyone else comes from the name directory (the admin directory
  // or the member-visible roster), falling back to their member id.
  const memberName = (userId) => {
    if (String(userId ?? '') === String(currentUser?.id ?? '')) return currentUser?.name || 'You';
    const found = users.find((u) => String(u.id) === String(userId));
    return found?.name || `Member #${userId}`;
  };

  // Rank order of the ASSIGNMENT a pill belongs to - the shift's own minimum
  // rank, not the member's rank. This is what orders a day's crew (see
  // utils/crewOrder), so a day at 08:00 reads in the order the shifts are
  // configured (Officer above Driver above Firefighter) no matter who fills them.
  // Returns null when the assignment or its rank isn't known.
  const assignmentRankOrder = (assignmentId) =>
    parseRankOrder(assignmentById(assignmentId)?.rank_order_required);

  // Normalize every schedule row into { from, to } date keys so multi-day
  // ranges can be checked per calendar day. Times come from the linked
  // schedule template, falling back to the row's own times (custom shifts
  // carry their window directly on the row). A blank `user_id` means the row is
  // unfilled - there is no member to name, so it becomes an open shift.
  const allAssignments = schedule
    .map((row) => {
      let from = parseSheetDateKey(row.date_from);
      let to = parseSheetDateKey(row.date_to);
      if (from && !to) to = from; // single-day assignment when date_to is blank
      const template = scheduleTemplates.find(
        (t) => String(t.id) === String(row.schedule_template_id ?? '')
      );
      const time = template ? templateTimeText(template) : rowTimeText(row);
      const userId = String(row.user_id ?? '').trim();
      return {
        row,
        key: `row-${row.id ?? `${from}-${row.assignment_id ?? ''}`}`,
        templateId: String(row.schedule_template_id ?? '').trim(),
        assignmentId: String(row.assignment_id ?? ''),
        userId,
        from,
        to,
        // Sort key for the day cell - earliest start first.
        startMin: timeToMinutes(template ? template.start_time : row.start_time),
        isMine: userId !== '' && userId === String(currentUser?.id ?? ''),
        name: userId === '' ? OPEN_SHIFT_LABEL : memberName(userId),
        requiredRankOrder: assignmentRankOrder(row.assignment_id),
        label: String(row.apparatus_id ?? '').trim() || assignmentInfo(row.assignment_id) || 'Scheduled',
        // Optional icon name from the assignments sheet, drawn with the label. Blank
        // means "no icon", so nothing is rendered rather than a fallback glyph.
        icon: String(assignmentById(row.assignment_id)?.icon ?? '').trim(),
        time,
        // `timeRange` is always the window, for tooltips and the detail list, while
        // `timeLabel` is what the pill shows: the shift's nickname when its template has
        // one, the window otherwise.
        timeRange: prettyRange(time),
        timeLabel: shiftTimeLabel(template, prettyRange(time)),
        color: assignmentColor(row.assignment_id, assignments),
        isOpen: false,
      };
    })
    .filter((a) => a.from && a.to && a.from <= a.to);

  const filledAssignments = allAssignments.filter((a) => a.userId !== '');
  // The signed-in user's own rows - always shown, and the only rows shown while
  // "Show everyone" is off.
  const myAssignments = filledAssignments.filter((a) => a.isMine);

  // Rows already on the sheet without a member are unfilled shifts.
  const unassignedRows = allAssignments
    .filter((a) => a.userId === '')
    .map((a) => ({ ...a, isOpen: true }));

  // Build the month grid: leading blanks, then one cell per day, then trailing blanks.
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);

  // ---- Open shifts -------------------------------------------------------
  // A weekly template slot is "open" when no schedule row covers that date for
  // it - the same rule the admin Schedule Management calendar uses to draw its
  // empty slots. Coverage is collected once so the per-day check stays cheap.
  const templateCoverage = new Map();
  for (const row of schedule) {
    const templateId = String(row.schedule_template_id ?? '').trim();
    if (!templateId) continue;
    const from = parseSheetDateKey(row.date_from);
    const to = parseSheetDateKey(row.date_to) || from;
    if (!from || !to) continue;
    if (!templateCoverage.has(templateId)) templateCoverage.set(templateId, []);
    templateCoverage.get(templateId).push({ from, to });
  }
  const slotCovered = (templateId, dateKey) =>
    (templateCoverage.get(String(templateId)) || []).some((r) => dateKey >= r.from && dateKey <= r.to);

  // Rank rule (shared with the admin scheduler - see utils/rankEligibility): a
  // higher numeric rank_order is a higher rank, and a member may fill their own
  // rank and every lower one. They also have to be schedulable at all.
  // Shifts the member may offer to fill. The rule lives in utils/rankEligibility so the
  // availability editor preloads exactly the same set of slots.
  const canFill = (assignmentId) =>
    memberCanFillAssignment({
      member: currentUser,
      assignment: assignmentById(assignmentId),
      ranks,
    });

  // Events for the visible month, grouped by day. Built in one pass for the whole window rather than per
  // cell, and never mixed with the shift pills below - an event is not a shift, is not offerable, and does
  // not affect coverage. See utils/events.
  //
  // Normalised here as well as at the boundary, so the calendar is correct whichever caller hands it rows:
  // the engine reads `isAllDay`/`startsAt`, and a raw sheet row silently produces no occurrences at all.
  const normalizedEvents = useMemo(() => normalizeEventList(events), [events]);
  const eventSegmentsByDate = showEvents
    ? eventSegmentsByDay(
        normalizedEvents,
        toDateKey(cells.find(Boolean) || new Date(year, month, 1)),
        toDateKey(new Date(year, month, daysInMonth)),
        { ...eventAudience, ranks }
      )
    : new Map();

  const openSlots = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dateKey = toDateKey(date);
    const dow = DAY_ORDER[date.getDay()];
    for (const template of scheduleTemplates) {
      if (String(template.day_of_week ?? '').trim().toLowerCase() !== dow) continue;
      // Retired and not-yet-effective templates produce no slot (utils/scheduleTemplates), and a
      // template whose ASSIGNMENT is out of its own window produces none either (utils/assignmentDates):
      // a retired assignment must stop offering shifts through the templates that use it.
      if (!templateIsActiveOn(template, dateKey)) continue;
      if (!assignmentIsActiveOn(assignmentById(template.assignment_id), dateKey)) continue;
      if (slotCovered(template.id, dateKey)) continue;
      const time = templateTimeText(template);
      openSlots.push({
        key: `slot-${dateKey}-${template.id}`,
        templateId: String(template.id),
        assignmentId: String(template.assignment_id ?? ''),
        userId: '',
        from: dateKey,
        to: dateKey,
        startMin: timeToMinutes(template.start_time),
        isMine: false,
        name: OPEN_SHIFT_LABEL,
        requiredRankOrder: assignmentRankOrder(template.assignment_id),
        label:
          String(template.apparatus_id ?? '').trim() ||
          assignmentInfo(template.assignment_id) ||
          'Scheduled',
        // Same icon source as the row branch above.
        icon: String(assignmentById(template.assignment_id)?.icon ?? '').trim(),
        time,
        // Same split as the row branch above: tooltips keep the window, the pill shows
        // the nickname when the template has one.
        timeRange: prettyRange(time),
        timeLabel: shiftTimeLabel(template, prettyRange(time)),
        color: assignmentColor(template.assignment_id, assignments),
        isOpen: true,
      });
    }
  }

  // Unfilled shifts the signed-in member could actually pick up: their rank has
  // to be sufficient (per `canFill`) and the shift must not be in the past.
  // These are the pills shift requests will hang off later.
  const openAssignments = [...unassignedRows, ...openSlots].filter(
    (a) => a.to >= todayKey && canFill(a.assignmentId)
  );

  // Pills drawn on the calendar: the crew (or just you), plus every unfilled
  // shift you're eligible to pick up.
  const calendarAssignments = showEveryone
    ? [...filledAssignments, ...openAssignments]
    : [...myAssignments, ...openAssignments];

  // ---- Shift offers ------------------------------------------------------
  // Offers arrive keyed by `slot_key` from the backend, which is exactly the
  // key each open pill carries (`row-<schedule id>` or `slot-<date>-<template>`),
  // so offer state can be attached without extra lookups.
  const offersBySlot = new Map();
  for (const offer of offers) {
    const key = String(offer.slot_key ?? '');
    if (!key) continue;
    if (!offersBySlot.has(key)) offersBySlot.set(key, []);
    offersBySlot.get(key).push(offer);
  }
  const offersFor = (a) => offersBySlot.get(a.key) || [];

  // '' (open) | 'pending' (waiting on an admin) | 'declined' (turned down - the
  // member may offer again, which records a fresh pending offer).
  const offerStateFor = (a) => {
    const slotOffers = offersFor(a);
    if (slotOffers.some((o) => o.status === 'pending')) return 'pending';
    if (slotOffers.some((o) => o.status === 'declined')) return 'declined';
    return '';
  };

  // The event row behind a tapped pill. A segment carries one day's slice of an event (the times, the colour)
  // and its id, but the popup also has to answer "does this repeat?" - which only the row knows.
  const eventFor = (segment) =>
    normalizedEvents.find((event) => String(event.id) === String(segment?.eventId)) || null;

  // Opens the confirmation modal (only open/declined pills are clickable, and only
  // for a role that may offer at all).
  const openOfferModal = (a) => {
    if (!canMakeOffers) return;
    if (offerStateFor(a) === 'pending') return;
    setOfferTarget(a);
  };

  // A role that may not view the whole crew keeps the toggle off, including if the
  // permission was removed while this screen was open.
  useEffect(() => {
    if (!canViewFullSchedule && showEveryone) setShowEveryone(false);
  }, [canViewFullSchedule, showEveryone]);

  // Bodies the backend expects; template occurrences leave schedule_id blank.
  const offerPayloadFor = (a) => ({
    schedule_template_id: a.templateId || '',
    date_from: a.from,
    date_to: a.to,
    assignment_id: a.assignmentId || '',
    schedule_id: a.row?.id ?? '',
  });

  const submitOffer = async () => {
    if (!offerTarget) return { success: false, message: 'That shift is no longer available.' };
    const result = await submitShiftOffer(offerPayloadFor(offerTarget), token);
    if (result?.code === 'UNAUTHORIZED') {
      return { success: false, message: result.message || 'Your session expired. Please sign in again.' };
    }
    if (result?.success) {
      setOfferTarget(null);
      // Re-reads the member's offers so the pill flips to "pending approval"
      // (and, once a push provider lands, a notification can do the same).
      try {
        await onOfferSubmitted?.(result.offer);
      } catch (err) {
        // The offer itself is saved - a refresh hiccup must not read as a failure.
        console.error('Failed to refresh shift offers', err);
      }
    }
    return result || { success: false, message: 'Unable to submit your offer.' };
  };

  // Order within a day: start time, then filled ahead of open, then rank order
  // (highest first) and finally name. Shared with the verification script - see
  // utils/crewOrder.js for the full rule.
  const byStartTime = compareCrewOrder;

  // One-line description of an assignment, used for day/pill tooltips. Tooltips spell
  // out the window (`timeRange`) even when the pill shows a nickname, so hovering never
  // hides when the shift actually runs.
  const describe = (a) => {
    const base = a.timeRange ? `${a.label || 'Scheduled'} (${a.timeRange})` : a.label || 'Scheduled';
    if (a.isOpen) return `Open shift — ${base}`;
    return showEveryone ? `${a.name}${a.isMine ? ' (you)' : ''} — ${base}` : base;
  };

  // Open shifts in the visible month - drives the legend entries below the toggle.
  const openShiftsThisMonth = openAssignments.filter(
    (a) => a.from <= monthEndKey && a.to >= monthStartKey
  );
  const openableThisMonth = openShiftsThisMonth.filter((a) => offerStateFor(a) === '');
  const pendingThisMonth = openShiftsThisMonth.filter((a) => offerStateFor(a) === 'pending');
  const declinedThisMonth = openShiftsThisMonth.filter((a) => offerStateFor(a) === 'declined');

  // Hover text for an open pill: explains what clicking does (or why it doesn't).
  const offerTitleFor = (a, state) => {
    const base = describe(a);
    if (!canMakeOffers) return `${base} — your role cannot offer to fill shifts`;
    if (state === 'pending') return `${base} — awaiting admin approval`;
    if (state === 'declined') return `${base} — your offer was declined, click to offer again`;
    return `${base} — click to offer to fill this shift`;
  };

  // Assignments overlapping the currently visible month. This list stays
  // personal even in the crew view: the calendar carries everyone's shifts plus
  // the open ones, while the detail list below is always the signed-in
  // member's own.
  const visibleAssignments = myAssignments
    .filter((a) => a.from <= monthEndKey && a.to >= monthStartKey)
    .sort((a, b) =>
      a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from)
    );

  const formatRange = (a) => {
    const [fy, fm, fd] = a.from.split('-').map(Number);
    const [ty, tm, td] = a.to.split('-').map(Number);
    const fromLabel = new Date(fy, fm - 1, fd, 12);
    const toLabel = new Date(ty, tm - 1, td, 12);
    const short = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (a.from === a.to) return `${short(fromLabel)}, ${fy}`;
    if (fy === ty) return `${short(fromLabel)} – ${short(toLabel)}, ${fy}`;
    return `${short(fromLabel)}, ${fy} – ${short(toLabel)}, ${ty}`;
  };

  const goPrev = () => setViewDate(new Date(year, month - 1, 1));
  const goNext = () => setViewDate(new Date(year, month + 1, 1));
  const goToday = () => setViewDate(new Date(now.getFullYear(), now.getMonth(), 1));

  return (
    <div className="space-y-6">
      {/* Month-at-a-time calendar */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={goPrev}
            aria-label="Previous month"
            className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <h3 className="flex-1 text-center text-base font-semibold text-slate-900 dark:text-white">
            {monthLabel}
          </h3>

          <button
            type="button"
            onClick={goNext}
            aria-label="Next month"
            className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <ChevronRight className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={goToday}
            disabled={viewKey === todayKey}
            className="ml-2 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-red-600 disabled:opacity-40"
          >
            Today
          </button>

          {/* Prints the month on screen, so what is printed matches what is being looked at. */}
          <button
            type="button"
            onClick={() => setPrintOpen(true)}
            className="ml-2 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <Printer className="w-4 h-4" />
            Print
          </button>
        </div>

        {/* Crew view toggle - only for roles allowed to see the whole crew, and
            off by default so the month opens on your own shifts. */}
        {/* One strip for both view switches, so they read as a pair of view options rather than as two
            separate settings. They wrap onto their own line on a narrow screen. */}
        {(canViewFullSchedule || events.length > 0) && (
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40 flex flex-wrap items-center gap-3">
            {canViewFullSchedule && (
              <ViewToggle
                noun="everyone"
                description="Include every member's shifts on the calendar, not just yours."
                icon={Users}
                enabled={showEveryone}
                onChange={setShowEveryone}
              />
            )}

            {/* Shown only when there is something to show, so a station that uses no events never sees a
                control for them. Not persisted: a temporary view choice, like Show everyone. */}
            {events.length > 0 && (
              <ViewToggle
                noun="events"
                description="Include non-shift entries such as trainings. Shifts are not affected."
                icon={Eye}
                enabled={showEvents}
                onChange={setShowEvents}
              />
            )}
          </div>
        )}

        <div className="px-4 py-3 space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-sm bg-red-600 shrink-0" />
              You're scheduled
            </span>
            {showEveryone && (
              <span className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-sm bg-slate-400 dark:bg-slate-500 shrink-0" />
                Others scheduled
              </span>
            )}
            {openableThisMonth.length > 0 && (
              <span className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-sm border border-dashed border-slate-400 dark:border-slate-500 shrink-0" />
                {canMakeOffers ? 'Open shift you can fill' : 'Open shift'}
              </span>
            )}
            {pendingThisMonth.length > 0 && (
              <span className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-sm bg-amber-400 shrink-0" />
                Offer awaiting approval
              </span>
            )}
            {declinedThisMonth.length > 0 && (
              <span className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-sm border border-dashed border-rose-400 shrink-0" />
                Offer declined — you can offer again
              </span>
            )}
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map((label) => (
              <div
                key={label}
                className="text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400 py-1"
              >
                {label}
              </div>
            ))}
          </div>
<div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (!day) {
                return (
                  <div key={`empty-${i}`} className="min-h-[76px] rounded-lg bg-slate-50/50 dark:bg-slate-900/40" />
                );
              }

              const key = toDateKey(day);
              // Chronological, and never truncated - every shift for the day renders.
              // A shift is placed on the day it STARTS only: see utils/shiftPlacement
              // for why an overnight shift must not be drawn on both days.
              const dayAssignments = calendarAssignments
                .filter((a) => isShiftDay(a.from, key))
                .sort(byStartTime);
              const isToday = key === todayKey;
              const scheduled = dayAssignments.length > 0;
              // In everyone's view the day is tinted red only when one of the
              // signed-in user's own shifts falls on it; other people's shifts
              // get a muted tint, and days holding nothing but open shifts get a
              // dashed outline, so your own days still stand out.
              const hasMine = dayAssignments.some((a) => a.isMine);
              const hasFilled = dayAssignments.some((a) => !a.isOpen);

              return (
                <div
                  key={key}
                  title={
                    scheduled
                      ? `${hasFilled ? 'Scheduled' : 'Open'}: ${dayAssignments.map(describe).join(', ')}`
                      : undefined
                  }
                  className={`min-h-[76px] rounded-lg flex flex-col items-stretch ${
                    hasMine
                      ? 'bg-red-600/10 border border-red-300 dark:border-red-800'
                      : hasFilled
                        ? 'bg-slate-100 dark:bg-slate-900/80 border border-slate-300 dark:border-slate-700'
                        : scheduled
                          ? 'border border-dashed border-slate-300 dark:border-slate-600'
                          : 'bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/40'
                  }`}
                >
                  <span
                    className={`text-[11px] leading-none px-1 ${
                      isToday ? 'text-red-600 font-bold' : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {day.getDate()}
                  </span>

                  {/* Events first: they are context for the day, and rendering them above the shifts keeps
                      them from being mistaken for one. Coloured by the event's own colour, with no offer
                      machinery anywhere near them. */}
                  {(eventSegmentsByDate.get(key) || []).map((segment) => (
                    <EventPill
                      key={`event-${segment.eventId}-${segment.dateKey}`}
                      segment={segment}
                      timeFormat={timeFormat}
                      className="mx-0.5 mt-0.5"
                      onClick={() => setDetailTarget({ kind: 'event', item: segment, event: eventFor(segment) })}
                    />
                  ))}
                  {dayAssignments.map((a) => {
                    const offerState = a.isOpen ? offerStateFor(a) : '';
                    // Filled pills are solid (member name, or the assignment in
                    // the personal view). Open shifts are dashed and coloured by
                    // assignment; once the member offers they turn amber while
                    // pending, or rose when declined (and offerable again).
                    const line1 = a.isOpen
                      ? offerState === 'pending'
                        ? 'Pending'
                        : offerState === 'declined'
                          ? 'Declined'
                          : OPEN_SHIFT_LABEL
                      : showEveryone
                        ? a.name
                        : a.label || 'Scheduled';
                    const line2 =
                      a.isOpen || showEveryone
                        ? a.timeLabel
                          ? `${a.label || 'Scheduled'} · ${a.timeLabel}`
                          : a.label || 'Scheduled'
                        : a.timeLabel;
                    const lines = (
                      <>
                        <span className="block truncate">{line1}</span>
                        {line2 && (
                          <span className="block truncate text-[9px] font-normal opacity-90">
                            {/* Assignment icon (Administration → Assignments). Inherits
                                the pill's text colour so an arbitrary assignment colour
                                can never make it unreadable. */}
                            {a.icon && <RankIcon name={a.icon} className="inline-block w-2.5 h-2.5 mr-0.5 -mt-px align-[-1px]" />}
                            {line2}
                          </span>
                        )}
                      </>
                    );
                    const baseClass =
                      'mt-0.5 w-full overflow-hidden px-1.5 py-0.5 rounded-md text-[10px] leading-tight font-semibold';

                    if (!a.isOpen) {
                      // A filled shift has no action, but it still has facts the tooltip cannot hold - so it
                      // opens the same detail modal as an event.
                      return (
                        <button
                          key={a.key}
                          type="button"
                          onClick={() => setDetailTarget({ kind: 'shift', item: a })}
                          className={`${baseClass} block text-left text-white transition hover:brightness-110 ${
                            showEveryone && a.isMine ? 'ring-1 ring-white/70 dark:ring-red-300' : ''
                          }`}
                          style={{ backgroundColor: a.color }}
                          title={`${describe(a)} — click for details`}
                        >
                          {lines}
                        </button>
                      );
                    }

                    return (
                      <button
                        key={a.key}
                        type="button"
                        disabled={offerState === 'pending' || !canMakeOffers}
                        onClick={() => openOfferModal(a)}
                        title={offerTitleFor(a, offerState)}
                        className={`${baseClass} text-left transition ${
                          !canMakeOffers
                            ? 'border border-dashed bg-white/70 dark:bg-slate-900/60 cursor-default'
                            : offerState === 'pending'
                              ? 'border border-amber-300 dark:border-amber-700 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 cursor-default'
                              : offerState === 'declined'
                                ? 'border border-dashed border-rose-400 bg-rose-50/70 dark:bg-rose-950/30 text-rose-600 dark:text-rose-300 cursor-pointer hover:ring-1 hover:ring-rose-400/70'
                                : 'border border-dashed bg-white/70 dark:bg-slate-900/60 cursor-pointer hover:ring-1 hover:ring-slate-400/70'
                        }`}
                        // Open pills carry the assignment colour; pending/declined
                        // pills use their state colours instead.
                        style={offerState === '' ? { borderColor: a.color, color: a.color } : undefined}
                      >
                        {lines}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Detail list for the visible month - always the signed-in member's own
          assignments, even while the calendar shows the whole crew. */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <CalendarDays className="w-4 h-4 text-red-500" />
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Schedule Details — {monthLabel}
          </h3>
        </div>

        {visibleAssignments.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {myAssignments.length === 0
              ? 'You have no schedule assignments on file yet.'
              : `No scheduled assignments in ${monthLabel}.`}
          </p>
        ) : (
          <div className="space-y-3">
            {visibleAssignments.map((a) => (
              // Tappable like the pill above, and for the same reason: the tooltip cannot hold everything.
              <button
                key={String(a.row.id ?? '') + a.from + a.to}
                type="button"
                onClick={() => setDetailTarget({ kind: 'shift', item: a })}
                title={`${describe(a)} — click for details`}
                className="w-full text-left flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/50 hover:border-slate-300 dark:hover:border-slate-600 transition"
              >
                {/* Spans, not divs/paragraphs: a button may only contain phrasing content. */}
                <span className="p-2 bg-red-600/10 border border-red-500/20 rounded-xl text-red-500 shrink-0">
                  <CalendarRange className="w-5 h-5" />
                </span>
                <span className="min-w-0 flex-1 overflow-hidden">
                  <span className="flex items-center gap-1.5 font-semibold text-sm text-slate-900 dark:text-white">
                    {a.icon && (
                      <RankIcon
                        name={a.icon}
                        className="w-4 h-4 shrink-0"
                        style={{ color: a.color }}
                      />
                    )}
                    <span className="truncate">{a.label || 'Scheduled shift'}</span>
                  </span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">{formatRange(a)}</span>
                  {a.timeRange && (
                    <span className="mt-0.5 flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300 truncate">
                      <Clock className="w-3.5 h-3.5 text-red-500 shrink-0" />
                      {a.timeRange}
                    </span>
                  )}
                </span>
                {a.row.assignment_id !== undefined && a.row.assignment_id !== '' && (
                  <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 shrink-0">
                    #{a.row.assignment_id}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Offer confirmation - mounted only while an open pill is selected */}
      {offerTarget && (
        <ShiftOfferModal
          shift={{
            label: offerTarget.label,
            // The confirmation spells out when the shift runs, so it asks for the raw
            // window rather than the pill's nickname.
            timeLabel: offerTarget.timeRange,
            dateLabel: formatRange(offerTarget),
          }}
          assignment={assignmentById(offerTarget.assignmentId)}
          onClose={() => setOfferTarget(null)}
          onConfirm={submitOffer}
        />
      )}

      {/* Details for a filled shift or an event. The rows come from utils/scheduleItemDetails, so what the
          modal says is tested rather than the markup that says it. `crewMember` follows the Show everyone
          toggle: in the personal view the reader is the member, so naming them would be noise. */}
      {detailTarget && (
        <ScheduleItemModal
          details={
            detailTarget.kind === 'event'
              ? eventItemDetails(detailTarget.event, detailTarget.item, { timeFormat, roles, ranks, users })
              : shiftItemDetails(detailTarget.item, { timeFormat, crewMember: showEveryone && !detailTarget.item.isMine })
          }
          icon={detailTarget.kind}
          onClose={() => setDetailTarget(null)}
        />
      )}

      {/* Printer-friendly month. The mode follows the Show everyone toggle, so the sheet mirrors what the
          member is looking at: their own shifts, or the whole crew's. Crew mode still only offers
          vacancies their rank could fill, exactly as the calendar does. */}
      {printOpen && (
        <PrintableSchedule
          mode={showEveryone ? 'crew' : 'member'}
          departmentName={departmentName}
          memberName={currentUser?.name || ''}
          year={viewDate.getFullYear()}
          month={viewDate.getMonth()}
          member={currentUser}
          schedule={schedule}
          scheduleTemplates={scheduleTemplates}
          assignments={assignments}
          users={users}
          ranks={ranks}
          // The normalised list the calendar draws, so the sheet cannot disagree with the screen.
          events={normalizedEvents}
          onDone={() => setPrintOpen(false)}
        />
      )}
    </div>
  );
}