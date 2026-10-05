import React, { useState, useEffect, useMemo, useSyncExternalStore } from 'react';
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Clock, Eye, Loader2, Printer, Users } from 'lucide-react';
import { toDateKey, parseSheetDateKey, displayDate } from '../utils/scheduleDate';
import { assignmentColor } from '../utils/assignmentColor';
import { useMonthSlide } from '../utils/motion';
import RankIcon from './RankIcon';
import { rowTimeText, templateTimeText, timeToMinutes, prettyRange, shiftTimeLabel } from '../utils/shiftTime';
import { WEEKDAYS, MONTHS, DAY_ORDER, MONTH_VIEW, monthGridCells, dayViewSpan, spanDayDates } from '../utils/calendarConstants';
import {
  desktopViewport,
  phoneViewport,
  subscribePhoneViewport,
  subscribeViewport,
} from '../utils/viewport';
import { isShiftDay } from '../utils/shiftPlacement';
import EventPill from './EventPill';
import { eventSegmentsByDay, normalizeEventList } from '../utils/events';
import { templateIsActiveOn } from '../utils/scheduleTemplates';
import { assignmentIsActiveOn } from '../utils/assignmentDates';
import { parseRankOrder, memberCanFillAssignment } from '../utils/rankEligibility';
import { compareCrewOrder } from '../utils/crewOrder';
import { mergeDayItems } from '../utils/dayOrder';
// Whether the window the schedule arrived in covers the month on screen: the difference between "this month is empty" and
// "I have not asked for this month".
import { windowCoversMonth } from '../utils/scheduleWindow';
import { submitShiftOffer } from '../services/api';
import ViewToggle from './ViewToggle';
import ShiftOfferModal from './ShiftOfferModal';
import ScheduleItemModal from './ScheduleItemModal';
import MonthPickerModal from './MonthPickerModal';
import { shiftItemDetails, eventItemDetails } from '../utils/scheduleItemDetails';
import PrintableSchedule from './PrintableSchedule';
import MemberName from './MemberName';
import RankDot from './RankDot';
import { unnamedLabel } from '../utils/displayLabel';

// Identity used for an unfilled shift wherever a member's name would go.
const OPEN_SHIFT_LABEL = 'Open';

// Shift-window formatting lives in utils/shiftTime so every schedule view renders
// times identically (the pending-approvals table uses the same helpers).

export default function ScheduleCalendar({
  currentUser,
  schedule = [],
  // The window `schedule` holds (last month, this month, next) and the way to ask for a month the window does not cover.
  // A calendar's arrows reach further than the sign-in does, so a month outside the window is normal rather than an error.
  scheduleWindow = { from: '', to: '' },
  onNeedSchedule,
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

  // WHICH SHAPE THIS CALENDAR IS IN: the whole month, one day of it, or two. Read from the VIEWPORT (utils/viewport) at
  // the same 768px the shell's own layout switches at - the number the sidebar changes shape at (Sidebar.jsx) - so the
  // calendar's behaviour and the layout around it cannot disagree about whether this is a phone-shaped window.
  //
  // A JAVASCRIPT DECISION RATHER THAN A CSS ONE, and that is the point rather than a preference: the arrows walk DAYS
  // in this view and MONTHS in the other, the title says which unit is on screen, the legend and the details list below
  // report the range being shown, and the month on screen is what gets read. Six columns hidden with `hidden md:block`
  // would give a single-day LAYOUT whose arrows still walked months and whose details list still listed the month.
  //
  // THREE SHAPES, NOT TWO. `dayViewSpan` (utils/calendarConstants) is the one place that decides, and Administration's
  // board asks the same function rather than repeating the bands - so "the same narrow-view logic in both places" stays a
  // fact rather than a coincidence. The band that is new is the middle one: below the sidebar's 768px but above a phone's
  // 640px there is room for TWO days side by side, which answers "what have I got, and what is tomorrow" in one look.
  const isDesktop = useSyncExternalStore(subscribeViewport, desktopViewport, desktopViewport);
  const isPhone = useSyncExternalStore(subscribePhoneViewport, phoneViewport, phoneViewport);
  const span = dayViewSpan({ isDesktop, isPhone });
  const dayView = span !== MONTH_VIEW;
  // A day count for anything that has to MEASURE the view rather than draw it: the arrows step this far, the read
  // covers this many days. Zero in the month view, so a stray `span * 2` cannot quietly walk two months.
  const dayCount = dayView ? span : 0;

  // IT OPENS ON TODAY rather than on the 1st. Invisible in the month view - the calendar draws the whole month whichever
  // day this is - and the entire point of the narrow one: a member opens Schedule on their phone and sees today.
  //
  // ONE PIECE OF STATE FOR BOTH THE DAY AND THE MONTH, deliberately: a narrow window and a wide one can never drift to
  // different days, and resizing keeps the member on the day they were reading.
  const [viewDate, setViewDate] = useState(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
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
  // Whether the month picker is up. Only ever opened from a DAY view (see the toolbar), where stepping a day at a time is
  // otherwise the only way to reach a day that is not today - and "the 14th of next month" was fourteen presses and a
  // month boundary. Local to this component like every other temporary view control here.
  const [pickerOpen, setPickerOpen] = useState(false);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthLabel = `${MONTHS[month]} ${year}`;
  const todayKey = toDateKey(now);
  // THE DAY ON SCREEN, and the name the toolbar and the details heading give it. In the day view the day IS the unit, so
  // it has to be named - and it is the same key the single cell is drawn for, so the title and the grid cannot disagree.
  //
  // `displayDate` - the SHORT form ("Sat, Oct 3"), which is the one the schedule board's own day view uses. The cell
  // states its date in full underneath (see the day cell), so repeating the full form in the toolbar would be the same
  // sentence twice on a phone.
  const viewDayKey = toDateKey(viewDate);
  // THE DAYS ON SCREEN IN A DAY VIEW, and every measurement below is taken off these rather than off `viewDayKey` alone -
  // so a two-day span cannot title itself after its first day, or report a range one day short of what it draws.
  const spanDates = dayView ? spanDayDates(viewDate, dayCount) : [];
  const spanKeys = spanDates.map(toDateKey);
  // "Sat, Oct 3" for one day, "Sat, Oct 3 – Sun, Oct 4" for two. The SECOND date is what tells a member which day the
  // arrows moved, and dropping it would leave a two-column grid under a one-day title.
  const dayLabel = spanKeys.map(displayDate).join(' – ');
  const viewLabel = dayView ? dayLabel : monthLabel;
  // Whether the view is ALREADY on today, which is what the Today button goes by. Asked in the view's own unit: in the
  // month view "today" is the month today falls in, and in a two-day span it is TODAY BEING THE FIRST DAY - a span that
  // starts yesterday and runs into today is not standing on today, and Today should still take the member there.
  const atToday = dayView ? spanKeys[0] === todayKey : viewDayKey.slice(0, 7) === todayKey.slice(0, 7);

  const assignmentById = (id) => assignments.find((a) => String(a.id) === String(id));
  const assignmentInfo = (id) => assignmentById(id)?.description || '';

  const monthStartKey = toDateKey(new Date(year, month, 1));
  const monthEndKey = toDateKey(new Date(year, month + 1, 0));

  // THE RANGE ON SCREEN, which is the month in the calendar and EVERY DAY OF THE SPAN in a day view. Everything that
  // answers "what is showing?" is measured against this - the events that are grouped, the legend under the toggles, and
  // the details list below - so a day view cannot report a month of shifts beneath a single day, and a two-day view
  // cannot report only the first of its two days.
  //
  // THE READ IS STILL BY MONTH (see the effect below): each day is a slice of a month already in hand, so walking within
  // a month asks for nothing, and stepping outside one asks for the month arrived at. That is why this range never
  // reaches the reader.
  const viewFromKey = dayView ? spanKeys[0] : monthStartKey;
  const viewToKey = dayView ? spanKeys[spanKeys.length - 1] : monthEndKey;

  // THE MONTHS THE VIEW TOUCHES, WHICH IS NOT ALWAYS ONE. A two-day span can cross a boundary - the 31st and the 1st -
  // and the read below is issued per MONTH, so a span that quietly covered only the first of its two days would draw a
  // second column with nothing in it and no error anywhere: the most convincing way to show a member an empty day.
  //
  // So the months are collected from the span and ALL of them must be in hand before the view is drawn. Deduplicated
  // rather than assumed unique, because the common case - a span inside one month - would otherwise ask the same question
  // of the same month twice.
  const viewMonthKeys = [...new Set((dayView ? spanKeys : [monthStartKey]).map((key) => key.slice(0, 7)))];
  // ...AND THE RANGE THE READ ASKS FOR, which has to reach from the first of the FIRST month to the last of the LAST.
  // The month view's answer is exactly what it always was, so this changes nothing for the wide layout.
  //
  // BUILT FROM `viewMonthKeys` RATHER THAN FROM `viewDate`, and that is the difference between a crossing span working and
  // drawing an empty second column: the months are collected from the days actually ON SCREEN precisely so the read can be
  // issued over all of them. Deriving the end from `viewDate` would ask for the first month twice and never for the second -
  // no error, no spinner, just a blank column that reads as "nothing is scheduled tomorrow".
  const viewReadFromKey = `${viewMonthKeys[0]}-01`;
  // THE LAST DAY OF THE LAST MONTH THE VIEW TOUCHES, which is not always the month `viewDate` is in. Day 0 of the following
  // month IS that month's last day, so February and leap years stay somebody else's problem, as they are everywhere else.
  const lastMonthKey = viewMonthKeys[viewMonthKeys.length - 1];
  const viewReadToKey = toDateKey(
    new Date(Number(lastMonthKey.slice(0, 4)), Number(lastMonthKey.slice(5, 7)), 0)
  );

  // THE MONTH ON SCREEN IS NOT IN THE WINDOW THE APP HOLDS at first, and that is by design: sign-in carries NO schedule at
  // all - it is the one collection that grows without limit, and this screen may never be opened - so the month in front of
  // the member is always asked for, as is any month the arrows walk to. Asking is what keeps the arrows working without
  // reading every shift the station has ever scheduled, and it is why the window travels with the rows rather than being
  // worked out again here.
  // WHETHER THE WINDOW ALREADY HOLDS EVERY MONTH THE VIEW TOUCHES, as a plain boolean.
  //
  // This is what the effect below keys off, rather than the array of month keys: that array is rebuilt on every render,
  // so depending on it would re-fire the read on every render - which is the "a screen asks for the same rows fifty times
  // while you watch" bug. A boolean is stable whenever the ANSWER is, which is exactly the condition for re-reading.
  const viewMonthsInHand = viewMonthKeys.every((key) => windowCoversMonth(scheduleWindow, key));

  useEffect(() => {
    if (!onNeedSchedule) return;
    if (viewMonthsInHand) return;
    void onNeedSchedule(viewReadFromKey, viewReadToKey);
  }, [onNeedSchedule, viewMonthsInHand, viewReadFromKey, viewReadToKey]);

  // ...and while that read is in flight the screen SAYS SO. Without a word, opening Schedule shows an empty grid for a
  // moment, which is indistinguishable from a station with nothing scheduled - the failure the window exists to prevent.
  const monthPending = Boolean(onNeedSchedule) && !viewMonthsInHand;

  // Friendly label for a member: the signed-in user always resolves from the
  // session, everyone else comes from the name directory (the admin directory
  // or the member-visible roster), falling back to a phrase rather than the id.
  const memberName = (userId) => {
    if (String(userId ?? '') === String(currentUser?.id ?? '')) return currentUser?.name || 'You';
    const found = users.find((u) => String(u.id) === String(userId));
    return found?.name || unnamedLabel('member');
  };

  // The ROW behind a member's name, for the fact a name alone cannot carry - their rank, which the pill draws as a
  // coloured dot before the name (see components/RankDot). `memberName` above reads the same two sources and returns the
  // string; this returns the row, because a rank is not a name.
  //
  // The signed-in member's own row is not necessarily in the directory the calendar was handed, and their OWN document is
  // the authoritative one for their rank - the sidebar resolves theirs the same way.
  const memberRow = (userId) =>
    users.find((u) => String(u.id) === String(userId)) ||
    (String(userId ?? '') === String(currentUser?.id ?? '') ? currentUser : null);

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

  // Build the MONTH grid: leading blanks, then one cell per day, then trailing blanks. The day view draws one of these
  // days - `cells` below picks which - rather than a second renderer, so a change to how a day is drawn cannot reach one
  // view and miss the other. Built by `monthGridCells` (utils/calendarConstants), which the month picker uses too.
  const monthCells = monthGridCells(year, month);
  // How many days the month has: the open-slot pass below walks the month by day, and it is the same date arithmetic
  // the grid above is built from.
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // WHICH DAYS ARE DRAWN: every day of the month, or the days of the span. `viewDate` rather than a leading blank,
  // because it is a real date - so the day view never has a blank cell to draw and the days it shows are the days the
  // read is scoped to. `spanDayDates` is the same helper that decides where the arrows land, so the second column cannot
  // come out empty while the arrows think they moved two days.
  const cells = dayView ? spanDates : monthCells;

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

  // Events for the RANGE ON SCREEN, grouped by day. Built in one pass for the whole range rather than per
  // cell, and never mixed with the shift pills below - an event is not a shift, is not offerable, and does
  // not affect coverage. See utils/events.
  //
  // Normalized here as well as at the boundary, so the calendar is correct whichever caller hands it rows:
  // the engine reads `isAllDay`/`startsAt`, and a raw sheet row silently produces no occurrences at all.
  const normalizedEvents = useMemo(() => normalizeEventList(events), [events]);
  const eventSegmentsByDate = showEvents
    ? eventSegmentsByDay(
        normalizedEvents,
        viewFromKey,
        viewToKey,
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

  // '' (open) | 'pending' (waiting on an admin) | 'declined' (turned down, and CLOSED to this member).
  //
  // A DECLINE IS FINAL IN THE APP. It used to be a nudge - the member could offer again and a fresh pending row appeared -
  // which turned one decision into a loop: an officer says no, the offer comes back, somebody says no again. Now the pill
  // still reads "Declined" so the member knows where they stand, and the way in is a conversation rather than a button: an
  // officer can put them on the shift by hand. makeOffer refuses the write too, so a screen that was already open when the
  // decline landed cannot slip a second offer through.
  const offerStateFor = (a) => {
    const slotOffers = offersFor(a);
    if (slotOffers.some((o) => o.status === 'pending')) return 'pending';
    if (slotOffers.some((o) => o.status === 'declined')) return 'declined';
    return '';
  };

  // The event row behind a tapped pill. A segment carries one day's slice of an event (the times, the color)
  // and its id, but the popup also has to answer "does this repeat?" - which only the row knows.
  const eventFor = (segment) =>
    normalizedEvents.find((event) => String(event.id) === String(segment?.eventId)) || null;

  // Opens the confirmation modal: ONLY a shift this member has no offer on. A pending one is waiting on an answer, and a
  // declined one is closed to them outright (see offerStateFor).
  const openOfferModal = (a) => {
    if (!canMakeOffers) return;
    if (offerStateFor(a) !== '') return;
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

  // Open shifts in the RANGE ON SCREEN - drives the legend entries below the toggle.
  const openShiftsInView = openAssignments.filter(
    (a) => a.from <= viewToKey && a.to >= viewFromKey
  );
  const openableInView = openShiftsInView.filter((a) => offerStateFor(a) === '');
  const pendingInView = openShiftsInView.filter((a) => offerStateFor(a) === 'pending');
  const declinedInView = openShiftsInView.filter((a) => offerStateFor(a) === 'declined');

  // Hover text for an open pill: explains what clicking does (or why it doesn't).
  const offerTitleFor = (a, state) => {
    const base = describe(a);
    if (!canMakeOffers) return `${base} — your role cannot offer to fill shifts`;
    if (state === 'pending') return `${base} — awaiting admin approval`;
    if (state === 'declined') return `${base} — your offer was declined, so this shift is closed to you. Ask an officer to put you on it.`;
    return `${base} — click to offer to fill this shift`;
  };

  // Assignments overlapping the RANGE ON SCREEN. This list stays
  // personal even in the crew view: the calendar carries everyone's shifts plus
  // the open ones, while the detail list below is always the signed-in
  // member's own.
  const visibleAssignments = myAssignments
    .filter((a) => a.from <= viewToKey && a.to >= viewFromKey)
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

  // Movement goes through the slide (see utils/motion): the arrows are the most-used navigation in this
  // screen, and a month that simply appears gives no sense of which way it just moved. The day grid
  // below is what travels - the weekday row and the label stay where they are, as they do in a native calendar.
  //
  // THE UNIT IS THE VIEW'S: a month in the calendar, and a DAY in the day view, which is exactly what makes a narrow
  // screen's arrows walk a day at a time. The slide is identical either way.
  //
  // THE ARROWS MOVE THE WHOLE SPAN, so the step is the span and not a hard-coded 1: in a two-day view they walk two days,
  // which keeps what is on screen a contiguous pair rather than a window that slides one column at a time and stops
  // straddling the pair. `|| 1` rather than a ternary because the month view's span is the STRING 'month', and
  // `'month' * 2` would be NaN - a step of NaN would silently freeze the arrows instead of walking months.
  const { gridClass, onAnimationEnd, goBy, goTo } = useMonthSlide(viewDate, setViewDate, dayView ? 'day' : 'month');
  const step = dayCount || 1;
  const goPrev = () => goBy(-step);
  const goNext = () => goBy(step);
  const goToday = () => goTo(now);

  // A DAY CHOSEN FROM THE PICKER, which moves the view the same way Today does - through the slide, so the day it lands
  // on arrives the way a stepped one does rather than appearing. `goTo` takes a Date, and the picker hands back a key.
  //
  // THE CHOSEN DAY IS THE FIRST DAY OF THE SPAN, in a two-day view as much as in a one-day one: picking the 14th shows
  // the 14th and the 15th, which is what Today does too (it opens on today and tomorrow). Anchoring on the SECOND day
  // instead would hide the day the member just chose off the left of the screen.
  //
  // THE READ IS THE VIEW'S, unchanged: picking a day inside the month on screen asks the reader for nothing, and picking
  // one outside it asks for that month - exactly as walking there with the arrows would.
  const chooseDay = (dateKey) => {
    const [y, m, d] = String(dateKey).split('-').map(Number);
    if (!y || !m || !d) return;
    goTo(new Date(y, m - 1, d));
    setPickerOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* The month the member is looking at is read when they look at it (no schedule travels with the sign-in), so this is
          the honest thing to show while that read is in flight - rather than a month that looks empty. */}
      {monthPending && (
        <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          {/* The range being loaded, not just a month name: a two-day span that straddles the 31st asks for two months,
              and saying "Loading October" while November is also on the way is the half-truth that makes the spinner
              look like it has stalled. Tested on the MONTH COUNT rather than on the bounds, because `viewReadFromKey`
              and `viewReadToKey` are the first and last days of a month and so are never equal to each other. */}
          Loading {viewMonthKeys.length > 1 ? `${viewReadFromKey} – ${viewReadToKey}` : monthLabel}…
        </div>
      )}
      {/* Month-at-a-time calendar */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={goPrev}
            aria-label={dayView ? (dayCount > 1 ? `Previous ${dayCount} days` : 'Previous day') : 'Previous month'}
            className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <h3 className="flex-1 text-center text-base font-semibold text-slate-900 dark:text-white">
            {viewLabel}
          </h3>

          <button
            type="button"
            onClick={goNext}
            aria-label={dayView ? (dayCount > 1 ? `Next ${dayCount} days` : 'Next day') : 'Next month'}
            className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <ChevronRight className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={goToday}
            disabled={atToday}
            className="ml-2 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-red-600 disabled:opacity-40"
          >
            Today
          </button>

          {/* CHOOSE A DAY, which a day view needs and a month view does not: the whole month is already on screen there, so
              a picker over it would be a second grid saying what the first one says. In a day view it is the difference
              between fourteen presses and one. */}
          {dayView && (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              aria-label="Choose a day"
              title="Pick a day from the month"
              className="ml-2 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              {/* The word is dropped below `sm`, where the row is arrows, the day's name, Today and Print already - the
                  icon and its tooltip carry it there, and the `aria-label` carries it for a screen reader at every
                  width. From `sm` up there is room for it. */}
              <CalendarDays className="w-4 h-4" />
              <span className="hidden sm:inline">Day</span>
            </button>
          )}

          {/* Prints the month the day falls in, whatever unit is on screen: a printed sheet is a month - that is what a
              member sticks on the fridge - and the whole month is already in hand, so this costs nothing to offer here. */}
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
            {openableInView.length > 0 && (
              <span className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-sm border border-dashed border-slate-400 dark:border-slate-500 shrink-0" />
                {canMakeOffers ? 'Open shift you can fill' : 'Open shift'}
              </span>
            )}
            {pendingInView.length > 0 && (
              <span className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-sm bg-amber-400 shrink-0" />
                Offer awaiting approval
              </span>
            )}
            {declinedInView.length > 0 && (
              <span className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-sm border border-dashed border-rose-400 shrink-0" />
                Offer declined — ask an officer if you still want it
              </span>
            )}
          </div>

          {/* The weekday names belong to the calendar, so they go with it: the day view's single cell names its own
              weekday and date instead, which is more useful than a row of seven abbreviations over one column. */}
          {!dayView && (
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
          )}

          <div
            // ONE LEFT-ALIGNED COLUMN IN THE DAY VIEW, two when the span is two days, seven equal ones in the calendar.
            // The `gridClass` that drives the slide is applied either way, so the two views travel the same way.
            className={`${dayView ? (dayCount > 1 ? 'grid grid-cols-2 gap-1' : '') : 'grid grid-cols-7 gap-1'} ${gridClass}`}
            onAnimationEnd={onAnimationEnd}
          >
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
                  // THE HEIGHT IS THE VIEW'S, and it is the whole reason the day view exists on a phone: 76px is what a
                  // month cell can afford, and one day gets the window. The calendar's string is kept contiguous and
                  // unchanged on purpose - the availability calendar's server-rendered harness splits its cells by a
                  // class of this shape (verify-admin-render), and a screen rendered with no window is in the month view.
                  className={`${dayView ? 'min-h-[60vh]' : 'min-h-[76px]'} rounded-lg flex flex-col items-stretch ${
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
                  className={`leading-none px-1 ${dayView ? 'text-sm' : 'text-[11px]'} ${
                    isToday ? 'text-red-600 font-bold' : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {/* The day view has no weekday row above it (that row is the calendar's), so its one cell has to name
                      its own weekday and date - a bare day number would be the only thing on the screen. */}
                  {dayView
                    ? day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
                    : day.getDate()}
                </span>

                {/* Chronological, with events placed among the shifts rather than above them all - see
                      utils/dayOrder. Events stay visually distinct (outlined, never offerable): the order decides
                      where a pill sits, not what it looks like. */}
                  {mergeDayItems(dayAssignments, eventSegmentsByDate.get(key) || []).map(({ kind, value }) => {
                    if (kind === 'event') {
                      const segment = value;
                      return (
                        <EventPill
                          key={`event-${segment.eventId}-${segment.dateKey}`}
                          segment={segment}
                          timeFormat={timeFormat}
                          className="mx-0.5 mt-0.5"
                          onClick={() => setDetailTarget({ kind: 'event', item: segment, event: eventFor(segment) })}
                        />
                      );
                    }

                    const a = value;
                    const offerState = a.isOpen ? offerStateFor(a) : '';
                    // Filled pills are solid (member name, or the assignment in
                    // the personal view). Open shifts are dashed and colored by
                    // assignment; once the member offers they turn amber while
                    // pending, or rose when declined - which closes the shift to
                    // them, so the pill is not a button any more.
                    // IN THE CREW VIEW THE FIRST LINE IS A MEMBER'S NAME, and that is the one line on the calendar
                    // that carries certification icons - the answer to "who am I on with", read at the moment the
                    // pill is, which is the whole point of the icons. So the name goes through MemberName rather than
                    // being a bare string. Nothing else on a pill is a person: an assignment label is not, and an
                    // open shift has no member yet.
                    //
                    // `iconClassName` is empty on purpose: each glyph then inherits the pill's own text color,
                    // which is the same rule the assignment icon on line 2 follows - a pill's background is an
                    // arbitrary assignment color, so a fixed icon color can end up unreadable on it.
                    // `rank_id` rides along so the pill can draw the member's rank as a dot, the same way the row it
                    // came from does everywhere else. The dot is part of THIS branch on purpose: it belongs to a
                    // member's name, so it can never be drawn beside an assignment label or an open shift.
                    const crewUser = showEveryone && !a.isOpen
                      ? { id: a.userId, name: a.name, rank_id: memberRow(a.userId)?.rank_id ?? '' }
                      : null;
                    const line1 = crewUser ? (
                      // A flex row rather than plain inline content: the dot must not be able to push the name out of
                      // the pill, and `min-w-0` is what lets the name truncate instead (MemberName has it too).
                      <span className="flex min-w-0 items-center gap-1">
                        {/* The member's rank, in the colour Administration → Ranks gives it. `ml-px` is a nudge off
                            the pill's own padding; it is `px` rather than the `ml-0.25` this line first carried, which
                            is not a Tailwind class at all - it generated no rule, so the margin it looked like was
                            never there. A class that does nothing is worse than no class, because the next reader
                            believes it. */}
                        <RankDot user={crewUser} ranks={ranks} className="w-2 h-2 shrink-0 ml-px" />
                        <MemberName
                          user={crewUser}
                          className="w-2.5 h-2.5"
                          iconClassName=""
                          nameClassName="truncate"
                        />
                      </span>
                    ) : a.isOpen ? (
                      offerState === 'pending'
                        ? 'Pending'
                        : offerState === 'declined'
                          ? 'Declined'
                          : OPEN_SHIFT_LABEL
                    ) : (
                      a.label || 'Scheduled'
                    );
                    const line2 =
                      a.isOpen || showEveryone
                        ? a.timeLabel
                          ? `${a.label || 'Scheduled'} · ${a.timeLabel}`
                          : a.label || 'Scheduled'
                        : a.timeLabel;
                    const lines = (
                      <>
                        <span className={dayView ? 'block' : 'block truncate'}>{line1}</span>
                        {line2 && (
                          <span className={`block ${dayView ? 'text-[11px]' : 'truncate text-[9px]'} font-normal opacity-90`}>
                            {/* Assignment icon (Administration → Assignments). Inherits
                                the pill's text color so an arbitrary assignment color
                                can never make it unreadable. */}
                            {a.icon && <RankIcon name={a.icon} className="inline-block w-2.5 h-2.5 mr-0.5 -mt-px align-[-1px]" />}
                            {line2}
                          </span>
                        )}
                      </>
                    );
                    // A MONTH CELL IS 76px TALL AND HOLDS A WHOLE DAY, so a pill there is two clipped lines of 10px text.
                    // A day has the window to itself, so the pill becomes a readable block and NOTHING is truncated - the
                    // whole point of the extra room is that a name and the shift's window are not cut off to fit.
                    const baseClass = dayView
                      ? 'mt-1.5 w-full px-2.5 py-1.5 rounded-xl text-xs leading-tight font-semibold'
                      : 'mt-0.5 w-full overflow-hidden px-1.5 py-0.5 rounded-md text-[10px] leading-tight font-semibold';

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
                        disabled={offerState !== '' || !canMakeOffers}
                        onClick={() => openOfferModal(a)}
                        title={offerTitleFor(a, offerState)}
                        className={`${baseClass} text-left transition ${
                          !canMakeOffers
                            ? 'border border-dashed bg-white/70 dark:bg-slate-900/60 cursor-default'
                            : offerState === 'pending'
                              ? 'border border-amber-300 dark:border-amber-700 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 cursor-default'
                              : offerState === 'declined'
                                ? 'border border-dashed border-rose-400 bg-rose-50/70 dark:bg-rose-950/30 text-rose-600 dark:text-rose-300 cursor-default'
                                : 'border border-dashed bg-white/70 dark:bg-slate-900/60 cursor-pointer hover:ring-1 hover:ring-slate-400/70'
                        }`}
                        // Open pills carry the assignment color; pending/declined
                        // pills use their state colors instead.
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

      {/* Detail list for the RANGE ON SCREEN - always the signed-in member's own
          assignments, even while the calendar shows the whole crew. In the day view that means the day's own shifts,
          because the day is what is showing: a month of rows under a single day would be a list of things that are not
          on screen. */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <CalendarDays className="w-4 h-4 text-red-500" />
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Schedule Details — {viewLabel}
          </h3>
        </div>

        {visibleAssignments.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {myAssignments.length === 0
              ? 'You have no schedule assignments on file yet.'
              : `No scheduled assignments in ${viewLabel}.`}
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

      {/* The month, to pick a day from. Mounted only while it is open, so the calendar behind it is untouched and
          there is no state to reset. `viewDate` is what it opens on, so the day the member is reading is marked in
          it rather than being a month they have to find again. */}
      {pickerOpen && (
        <MonthPickerModal
          viewDate={viewDate}
          selectedKey={viewDayKey}
          todayKey={todayKey}
          onPick={chooseDay}
          onClose={() => setPickerOpen(false)}
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
          // The normalized list the calendar draws, so the sheet cannot disagree with the screen.
          events={normalizedEvents}
          onDone={() => setPrintOpen(false)}
        />
      )}
    </div>
  );
}