import React, { useCallback, useMemo, useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { renderInViewport } from '../../utils/viewportLayer';
import { viewportPopoverPosition } from '../../utils/viewportPopover';
import {
  AlertCircle, Check, ChevronDown, ChevronLeft, ChevronRight, CalendarDays,
    Loader2, Plus, RefreshCw, RotateCcw, Save, Trash2, UserPlus, UserMinus, X, CheckCircle2, XCircle, Printer, Eye
} from 'lucide-react';
import { adminBulkSaveSchedule, adminResolveShiftOffer } from '../../services/api';
import { toDateKey, parseSheetDateKey } from '../../utils/scheduleDate';
import { isShiftDay } from '../../utils/shiftPlacement';
import { templateIsActiveOn } from '../../utils/scheduleTemplates';
// What a slot is, and who is in it - shared with the Member Availability roster, which offers the same slots to assign
// a member from. Imported under local names because this file already has a `slotsByDay` memo and a `slotOccupant`
// helper that closes over the working copy an officer is editing.
import { templateSlotsForMonth, slotsByDay as slotsByDayOf, slotOccupant as slotOccupantOf, rowFieldsOf as fieldsOf } from '../../utils/scheduleSlots';
import { assignmentIsActiveOn, choosableAssignments } from '../../utils/assignmentDates';
import { assignmentColor } from '../../utils/assignmentColor';
import { toTimeInputValue } from '../../utils/timeInputValue';
import { shiftTimeLabel } from '../../utils/shiftTime';
import RankIcon from '../RankIcon';
import RankDot from '../RankDot';
import CertificationBadges from '../CertificationBadges';
import EventPill from '../EventPill';
import ViewToggle from '../ViewToggle';
import MonthPickerModal from '../MonthPickerModal';
// The same picker, as a DIALOG, in the day view. One component, two frames - see the file for why the split matters.
import ScheduleAssignmentModal from '../ScheduleAssignmentModal';
import { eventSegmentsByDay, normalizeEventList } from '../../utils/events';
import { mergeDayItems, separateShiftTimeBlocks } from '../../utils/dayOrder';
// THE SAME SLIDE the member's calendar uses, so a change of view on this screen is not a different experience from one
// on the other. See utils/motion for the two phases and why the swap happens off the edge.
import { useMonthSlide } from '../../utils/motion';

// A day's SLOTS in the order that day reads: start time, then the assignment's required rank. The ORDERING moved to
// utils/scheduleSlots with the rest of the slot rule, so this file no longer sorts slots itself - it reads a day that
// has already been put in order.
import { memberDayKeys } from '../../utils/availability';
import { planShiftDrop, planShiftSwap, planSwapHover, stillOnSlot, swapSlotFields, SWAP_DWELL_MS, SWAP_POP_MS, DROP_NOTICES } from '../../utils/scheduleDrop';
// The app-wide toast wrapper, so a refused drop is explained and sounds like the other errors (utils/toast).
import { toast } from '../../utils/toast';
import {
  eligibilityFor as classifyEligibility,
  isTruthyFlag,
  parseRankOrder,
  rankLabel,
} from '../../utils/rankEligibility';
import {
  WEEKDAYS,
  weekdayLabels,
  MONTHS,
  DAY_ORDER,
  MONTH_VIEW,
  monthGridCells,
  dayViewSpan,
  spanDayDates,
} from '../../utils/calendarConstants';
import {
  desktopViewport,
  phoneViewport,
  subscribePhoneViewport,
  subscribeViewport,
} from '../../utils/viewport';
import { unnamedLabel } from '../../utils/displayLabel';
import PrintableSchedule from '../PrintableSchedule';

const DRAFT_KEY = 'sp_schedule_draft';

const pad = (n) => String(n).padStart(2, '0');

// Friendly date for popover headers ("Sat, Sep 13").
const displayDate = (dateKey) => {
  const key = parseSheetDateKey(dateKey);
  if (!key) return dateKey || '';
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
  return `${dow}, ${MONTHS[date.getMonth()].slice(0, 3)} ${date.getDate()}`;
};

const timeToMinutes = (value) => {
  const t = toTimeInputValue(value);
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  if (h === undefined || m === undefined) return null;
  return h * 60 + m;
};

const shiftDays = (dateKey, delta) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d + delta);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const daysBetween = (fromKey, toKey) => {
  const [fy, fm, fd] = fromKey.split('-').map(Number);
  const [ty, tm, td] = toKey.split('-').map(Number);
  return Math.round((new Date(ty, tm - 1, td) - new Date(fy, fm - 1, fd)) / 86400000);
};

const dowOf = (dateKey) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  return DAY_ORDER[new Date(y, m - 1, d).getDay()];
};

// Normalizes schedule rows: parses date keys and assigns stable client keys
// (`db-<id>` for saved rows, `tmp-...` for rows created in this session).
const normalizeRows = (rows) =>
  (Array.isArray(rows) ? rows : []).map((r, idx) => {
    const from = parseSheetDateKey(r.date_from);
    const to = parseSheetDateKey(r.date_to) || from;
    return { ...r, _from: from, _to: to, _key: r.id ? `db-${r.id}` : `tmp-srv-${idx}` };
  });

const FIELD_LIST = ['schedule_template_id', 'date_from', 'date_to', 'start_time', 'end_time', 'apparatus_id', 'assignment_id', 'user_id'];

// Pill shapes for the calendar's MONTH view, where a day cell is 124px tall and holds a whole day's shifts - so a
// pill is ONE clipped line. A STAFFED shift is a solid, color-filled pill; an UNFILLED one is drawn like an empty
// template slot - thin muted border, muted text, no fill - so a vacancy never reads as a staffed shift at a glance.
const FILLED_PILL_CLASS = 'rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white truncate';
const VACANT_PILL_CLASS =
  'rounded-full px-1.5 py-0.5 text-[10px] font-semibold truncate border border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-500';

// ...AND THE DAY VIEW'S SHAPES, where one day fills the card and there is room for what the tooltip was carrying.
//
// The same two states, so the board still reads the same way - solid for a staffed shift, a muted outline for a
// vacancy - but at a readable size, rounded as a block rather than as a pill, and with NO `truncate`: the whole point
// of the extra room is that a name and its window are not clipped to fit a 124px cell. `w-full` so a short name does
// not leave a ragged column of different-width blocks.
const FILLED_PILL_ROOMY_CLASS = 'w-full rounded-xl px-2.5 py-1.5 text-xs font-semibold text-white text-left';
const VACANT_PILL_ROOMY_CLASS =
  'w-full rounded-xl px-2.5 py-1.5 text-xs font-semibold text-left border border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-500';

// AN EMPTY SLOT has a third shape of its own - a border, a hover state, and a `relative` for the badge a pending offer
// hangs off - because it is also a CONTROL: it opens the assignment popover. Kept beside the two above so all of the
// board's pill shapes are read in one place.
const EMPTY_SLOT_CLASS = 'rounded-md border px-1 py-0.5 text-[10px] leading-tight truncate transition-colors relative';
const EMPTY_SLOT_ROOMY_CLASS = 'rounded-xl border px-2.5 py-1.5 text-xs transition-colors relative';

// The one place each shape is chosen between, so a pill cannot be drawn in a shape the view has no room for - and so a
// third view later means one line here rather than one per call site.
const pillShapeClass = (vacant, roomy) =>
  roomy
    ? vacant
      ? VACANT_PILL_ROOMY_CLASS
      : FILLED_PILL_ROOMY_CLASS
    : vacant
      ? VACANT_PILL_CLASS
      : FILLED_PILL_CLASS;
const emptySlotShapeClass = (roomy) => (roomy ? EMPTY_SLOT_ROOMY_CLASS : EMPTY_SLOT_CLASS);

// The field set a row is written with lives in utils/scheduleSlots (imported above as `fieldsOf`), beside the server's
// reason for it: the writer REPLACES a row's fields rather than merging, so a partial entry blanks what it omits. Both
// screens that write a row therefore send the same complete set.

const timeRangeOf = (t) => {
  const s = toTimeInputValue(t.start_time);
  const e = toTimeInputValue(t.end_time);
  if (s && e) return `${s}–${e}`;
  return s || e || '';
};

// Time window stored directly on a schedule row — only custom shifts (rows
// with no schedule template) carry their own start/end times.
const rowTimeRangeOf = (r) => {
  const s = toTimeInputValue(r.start_time);
  const e = toTimeInputValue(r.end_time);
  return s && e ? `${s}–${e}` : s || e || '';
};

export default function AdminScheduleManagementTab({
  token,
  // NO `schedule` PROP, deliberately: the board reads the month on screen itself (see the onNeedSchedule note below) and
  // draws nothing else. It used to be handed App's shared array and draw from it, which is what let a month round-trip
  // re-seed the board from a cache a save had not refreshed - the fault this tab is now shaped to make impossible.
  // Why the last attempt to read a month failed, if it did - a failed read and a month nobody is rostered on look
  // identical without it, and the board used to draw the second while the first was true.
  scheduleWindowError = '',
  // THE MONTH ON SCREEN IS READ FROM THE SERVER (see the scopeToMonth note below), and this is how: the month's first and
  // last day, handed to the same reader the member calendar uses.
  //
  // IT IS REQUIRED FOR THE BOARD TO DRAW ANYTHING AT ALL, which is worth saying out loud because it was passed by App.jsx
  // and then silently dropped by AdminPanel for a whole release: every month this board asked for went nowhere, so it
  // drew whatever the sign-in payload had left in the shared array and a month outside that window could never be
  // fetched. The forwarding is asserted in scripts/verify-admin-render.mjs now, because a prop that arrives nowhere
  // produces no error - only a board that quietly shows the wrong month.
  onNeedSchedule,
  scheduleTemplates = [],
  assignments = [],
  ranks = [],
  users = [],
  rosterAvailability = [],
  // WHAT THOSE CLAIMS COVER. An unread month and a month in which nobody claimed anything produce the same empty list,
  // and only the second is a statement about a member - see the availability note below.
  rosterClaimsFrom = '',
  rosterClaimsTo = '',
  // Asks for the CREW'S CLAIMS over one month, when this app does not already hold them. The board warns an officer
  // about a member by name, so it fetches what it needs to say that - one month of claims, not seven.
  onRosterMonth,
  offers = [],
  onAdminDataChanged,
  // Non-shift calendar entries. The board's audience is EVERYONE, because it draws the whole crew's month -
  // an event targeted at one rank still belongs on the board an administrator is building from.
  events = [],
  hideEventsByDefault = false,
  colorblindRankLabels = false,
  timeFormat = '12',
  // Used only on the printed sheet's header.
  departmentName = '',
}) {
  const now = new Date();

  // WHICH SHAPE THIS BOARD IS IN: the month's calendar, or one day of it. Read from the VIEWPORT (utils/viewport) at
  // the same 768px the shell's own layout switches at, so the board's behaviour and its layout cannot disagree.
  //
  // A JAVASCRIPT DECISION RATHER THAN A CSS ONE, and that is the point of it rather than a preference: the arrows walk
  // DAYS in this view and MONTHS in the other, the title says which unit is on screen, and the month on screen is what
  // the reader is asked for. Hiding six columns with `hidden md:block` would give a single-day LAYOUT while the arrows
  // still walked months, the title still named a month, and a day's shifts arrived as a month's read - a screen whose
  // controls disagree with what is on it. So ONE flag decides all of it, and the breakpoint it reads is Tailwind's `md`
  // - the number the sidebar already switches on (Sidebar.jsx) - rather than a second threshold to keep in step.
  const isDesktop = useSyncExternalStore(subscribeViewport, desktopViewport, desktopViewport);
  // THE SAME THREE SHAPES THE MEMBER'S CALENDAR USES, from the same `dayViewSpan` (utils/calendarConstants): the month on a
  // wide screen, TWO days in the band between a phone and the sidebar's 768px, one day on a phone. Asking the same function
  // is what keeps "the same narrow-view logic in both places" a fact rather than a coincidence - and it is why the bands
  // cannot drift apart when one of them is retuned.
  const isPhone = useSyncExternalStore(subscribePhoneViewport, phoneViewport, phoneViewport);
  const span = dayViewSpan({ isDesktop, isPhone });
  const dayView = span !== MONTH_VIEW;
  // Zero in the month view, so the arrow step below can never multiply a span of 'month' into NaN.
  const dayCount = dayView ? span : 0;

  // THE DAY AND THE MONTH ARE ONE PIECE OF STATE, deliberately: `viewDate` carries both, so the day on screen in the
  // day view and the month in the calendar can never drift apart, and resizing between the two keeps the officer on
  // the day they were reading.
  //
  // IT OPENS ON TODAY rather than on the 1st. That is invisible on a wide screen - the calendar draws the whole month
  // whichever day this is - and it is the entire request for the narrow one: a phone opens on today's shifts, and the
  // arrows walk to the other days from there.
  const [viewDate, setViewDate] = useState(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  // The visible month's bounds, computed before the row state below because that state is scoped BY them.
  const monthStartKey = toDateKey(new Date(viewDate.getFullYear(), viewDate.getMonth(), 1));
  const monthEndKey = toDateKey(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0));
  const monthKey = monthStartKey.slice(0, 7);

  // THE MONTH THIS BOARD OWNS, read from the server when it is looked at - not derived from a shared cache. The schedule
  // is the one collection that grows without limit, and only one officer edits it, so there is no shared array to
  // reconcile: the board reads the month it is showing, edits a local copy, and re-reads on every month change. That is
  // what keeps a saved shift on the day it was dragged to after a month round-trip - the round-trip reads the server,
  // never an in-memory copy that a save's re-read may have failed to refresh.
  //
  // THE DIFFERENCE BETWEEN A SAVE THAT EDITS A BOARD AND ONE THAT DELETES THE STATION'S HISTORY, unchanged: a save
  // deletes every row the board can see and no longer has in `working` (see computeChanges), so `base` must hold exactly
  // the month on screen - a whole window would delete its neighbours, a whole collection would delete everything outside
  // the month the officer was looking at. Scoped to the month, the diff means exactly what an officer means by it.
  const scopeToMonth = (rows) =>
    normalizeRows(Array.isArray(rows) ? rows : []).filter((row) => {
      const from = row.date_from || '';
      const to = row.date_to || from;
      // A multi-day row belongs to the month it OVERLAPS, not only to the month it starts in.
      return from <= monthEndKey && to >= monthStartKey;
    });
  // The month's rows for the month on screen, and which month they were fetched for - so a seed never fires with one
  // month's rows while another month is being drawn.
  const [monthRows, setMonthRows] = useState([]);
  const loadedMonthRef = useRef('');
  const [working, setWorking] = useState([]);
  const [base, setBase] = useState([]);
  const [dirty, setDirty] = useState(false);
  // Mirror of `dirty` for use inside effects without adding it to their deps:
  // a background data refresh must never clobber an in-flight draft.
  const dirtyRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // THE READ IN FLIGHT, and the board's only spinner. It starts TRUE whenever there is a reader at all, because the first
  // paint happens before the effect that reads the month has run - and that one frame of empty grid, with no word about
  // why, looks exactly like a station with nothing scheduled. With no reader it starts false, and the effect that would
  // set it never runs, so a board that cannot read does not claim to be reading.
  const [refreshingMonth, setRefreshingMonth] = useState(() => Boolean(onNeedSchedule));
  // A window error the officer has dismissed. Keyed to the message rather than a boolean, so a SECOND failure shows
  // again instead of arriving pre-dismissed.
  const [dismissedWindowError, setDismissedWindowError] = useState('');
  // While a print is being prepared the sheet is mounted (see PrintableSchedule).
  const [printOpen, setPrintOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  const [addFormOpen, setAddFormOpen] = useState(false);
  const [addForm, setAddForm] = useState(null);
  const [selectedKey, setSelectedKey] = useState(null);
  // Inline member picker anchored to the pill/slot that was clicked in the
  // calendar (positioned with `fixed` so the card's overflow cannot clip it).
  // IN A DAY VIEW THE SAME PICKER IS A DIALOG - see the render below and components/ScheduleAssignmentModal: on a
  // phone-sized screen a 300px panel anchored to a pill covers the day it is about, and there is no wide margin to
  // hang it in. One piece of state either way, so the two views cannot disagree about what is open.
  const [popover, setPopover] = useState(null);
  const popoverAnchorRef = useRef(null);
  // Whether the month picker is up. Only ever opened from a day view (see the toolbar).
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dragKey, setDragKey] = useState(null);
  const [dragSourceDate, setDragSourceDate] = useState(null);
  const [hoverSlot, setHoverSlot] = useState(null);
  const [warnedKeys, setWarnedKeys] = useState(() => new Set());
  // Quick Add: pick a member once, then click empty slots on the calendar to
  // assign them directly (no per-slot member picker).
  const [quickAddUserId, setQuickAddUserId] = useState(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const quickAddRef = useRef(null);
  const quickAddMenuRef = useRef(null);
  const [quickAddPosition, setQuickAddPosition] = useState(null);
  const tmpCounter = useRef(0);
  // The dragged row's key, readable during a drag. The state is right for rendering, but a dragover can arrive
  // before React has re-rendered with it - and `dataTransfer.getData` is not readable during a drag, only on drop -
  // so the hold-to-swap has nothing else to identify the dragged row with. Maintained in handlePillDragStart and
  // cleared in handleDragEndPill, alongside the state it mirrors.
  const dragKeyRef = useRef(null);
  // The hold-to-swap countdown and the revert flash. Refs rather than state: nothing renders from them, and the
  // pill's blinking is driven by the dwell state they are paired with.
  const swapDwellTimer = useRef(null);
  const swapRevertTimer = useRef(null);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthLabel = `${MONTHS[month]} ${year}`;
  // THE DAY ON SCREEN, as a key and as the toolbar's own label. In the day view the day IS the unit, so the title has
  // to name it - and the same key is what the single cell is drawn for, so the title and the grid cannot disagree.
  const viewDayKey = toDateKey(viewDate);
  // The month this view sits in, which is what the span is clipped to (see `spanDates`) and what every month-scoped read
  // on this board is asked for.
  // THE DAYS OF THE SPAN THIS BOARD CAN ACTUALLY DRAW, and the label to go with them.
  //
  // CLIPPED TO THE MONTH ON SCREEN, which is the one place this screen differs from the member's calendar and the reason is
  // not cosmetic. The board's visible rows ARE the save's diff base: `base` holds the month on screen precisely so that a
  // save deletes "every row the board can see and no longer has in working" (see scopeToMonth) and therefore cannot reach a
  // neighbouring month. Widening what the board HOLDS to reach across a boundary would widen what a save DELETES with it -
  // an officer editing the 31st would lose the 1st. So the span is asked of the day view and answered from the month this
  // board owns: at a month end the second column is simply absent rather than present and empty, which is the honest
  // answer and cannot delete anything. The member's calendar has no such base and reads the extra month freely.
  const spanDates = dayView
    ? spanDayDates(viewDate, dayCount).filter((day) => toDateKey(day).slice(0, 7) === viewDayKey.slice(0, 7))
    : [];
  // "Sat, Oct 3" for one day, "Sat, Oct 3 – Sun, Oct 4" for two, and for a span clipped to one day the single date - the
  // title therefore always names exactly the columns on screen.
  const dayLabel = spanDates.map((day) => displayDate(toDateKey(day))).join(' – ');
  const todayKey = toDateKey(now);
  // Events are visible by default. Not persisted: a temporary view choice, like "Show everyone".
  const [showEvents, setShowEvents] = useState(() => !hideEventsByDefault);

  // THE READER IS HELD IN A REF, NOT A DEPENDENCY, and this is the difference between one read and an unbounded loop.
  // `loadScheduleWindow` is a plain function in App's body, so App re-creates it on EVERY render - and an effect that
  // depended on it re-ran after every read it had just started: read, setState, new identity, read again, forever. The
  // fetch effect therefore watches the MONTH and nothing else, and reaches the current reader through this ref.
  const needScheduleRef = useRef(onNeedSchedule);
  useEffect(() => {
    needScheduleRef.current = onNeedSchedule;
  }, [onNeedSchedule]);
  // READS ARE NUMBERED, NOT CANCELLED, AND THIS IS WHAT MAKES THE BOARD WORK UNDER StrictMode. `main.jsx` wraps the app in
  // StrictMode, which mounts every component, unmounts it, and mounts it again - so this effect runs twice on first load.
  // A cleanup flag plus an "already reading this month" guard turns that into a board that never loads: the first run
  // starts a read and is then cancelled, the second run sees the month already in flight and starts nothing, and the
  // first read's answer is thrown away because it was cancelled. Nothing is ever applied and the spinner never stops. So
  // each read takes a number instead, and a read that lands is ignored only if a NEWER one has since been started - the
  // newest answer always wins, and no run can be left without one.
  const readSeq = useRef(0);

  // The month on screen is read WHEN IT IS LOOKED AT, not carried by the sign-in: the schedule is the one collection that
  // grows without limit, and a board may be walked back years - so the month in front of the officer is asked for, and so is
  // any month the arrows reach. Asking is what keeps the arrows working without reading every shift the station has ever
  // scheduled. The board owns its month (see above), so this is where the copy that gets seeded is fetched from - and it
  // re-reads on EVERY month change, never trusting a window that a save may have left stale.
  useEffect(() => {
    const read = needScheduleRef.current;
    if (!read) return;
    // A month change empties the board's copies until the new month arrives, so the month left behind is not drawn
    // beside the new month's slots while the read is in flight.
    if (loadedMonthRef.current !== monthKey) {
      setWorking([]);
      setBase([]);
      setDirty(false);
    }
    const thisRead = ++readSeq.current;
    setRefreshingMonth(true);
    void read(monthStartKey, monthEndKey)
      .then((rows) => {
        // Superseded by a newer read - a month change, or StrictMode's second mount. The newest answer wins.
        if (readSeq.current !== thisRead) return;
        // `loadScheduleWindow` returns null on a failed read, so an empty month (a real answer) still seeds while a
        // failed one leaves the rows already on screen in place.
        if (Array.isArray(rows)) {
          loadedMonthRef.current = monthKey;
          setMonthRows(scopeToMonth(rows));
        }
        setRefreshingMonth(false);
      })
      .catch(() => {
        if (readSeq.current === thisRead) setRefreshingMonth(false);
      });
    // There is deliberately NO cleanup: see the note on readSeq above. Cancelling here is what stranded the board.
    // ONLY THE MONTH is watched. See the note on needScheduleRef: the reader's identity changes on every render of App,
    // and depending on it here turned this effect into an unbounded loop of requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthStartKey, monthEndKey, monthKey]);

  // ...and the board says so while that read is in flight: an empty month with no word about it looks like a station with
  // nothing scheduled, which is the failure every part of this arrangement exists to avoid.
  // PENDING MEANS "A READ IS IN FLIGHT", AND NOTHING MORE. It used to also mean "no rows have been loaded for this month
  // yet", read from loadedMonthRef - and that is what made a FAILED read spin forever. A failed read never sets
  // loadedMonthRef, so the board said "Loading {month}..." for as long as it stayed open, with the reason for the empty
  // grid sitting in a banner underneath a spinner that could not stop. Pressing Refresh did not help either: it cleared
  // its own flag and then the same clause put the spinner straight back. Reads do fail - a permission, a dropped channel,
  // a month nobody has published - and a failed read is a FINISHED read. The spinner stops when the read settles either
  // way, and the banner below says which of the two it was.
  const monthPending = refreshingMonth;
  // Whether to show the failed-read banner: a window error the officer has not already dismissed.
  const showWindowError = Boolean(scheduleWindowError) && dismissedWindowError !== scheduleWindowError;

  // Re-sync the working copy whenever fresh server data arrives - unless the
  // admin has unsaved changes, which take precedence over any refresh.
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  // THE MONTH ON SCREEN IS NOT THE MONTH A DRAFT BELONGS TO, so a month change ALWAYS re-seeds - once the fetch for the
  // month on screen has actually landed (loadedMonthRef), never with the month left behind.
  //
  // `working` and `base` are this board's rows for THIS month, and what a save deletes is exactly the difference
  // between them (see computeChanges). Deferring to an unsaved draft across a month change left the PREVIOUS month's
  // rows in `working` while the board drew the new one, and - the part that made it look like data loss - the guard
  // also skipped the re-seed caused by fresh server rows, so Refresh could not fix it either. A saved shift was in the
  // database, absent from the board, and no button on the screen would bring it back.
  //
  // A same-month refresh still defers to a draft: that is the case the guard is for.
  const seededMonth = useRef(monthKey);
  useEffect(() => {
    if (loadedMonthRef.current !== monthKey) return;
    const monthChanged = seededMonth.current !== monthKey;
    if (!monthChanged && dirtyRef.current) return;
    seededMonth.current = monthKey;
    // The MONTH's rows, not the whole array: this is what keeps `base` - and therefore what a save deletes - inside the
    // month on screen.
    setWorking(monthRows);
    setBase(monthRows);
    setDirty(false);
    setSelectedKey(null);
  }, [monthRows, monthKey]);

  // Restore an unsaved draft (survives tab switches / refreshes).
  //
  // KEYED TO ITS MONTH, because a single key meant a draft from one month came back while another was on screen - and a
  // restored draft sets `dirty`, which blocks the re-seed above for a board the officer is not editing at all. A draft
  // that does not belong to the month being opened is discarded rather than restored.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const rows = Array.isArray(parsed) ? parsed : parsed?.rows;
      const savedMonth = Array.isArray(parsed) ? '' : String(parsed?.month || '');
      if (!Array.isArray(rows) || !rows.length) return;
      if (savedMonth && savedMonth !== monthKey) {
        sessionStorage.removeItem(DRAFT_KEY);
        return;
      }
      setWorking(rows);
      setDirty(true);
    } catch {
      /* corrupted draft - ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the draft while there are unsaved changes, with the month it belongs to.
  useEffect(() => {
    try {
      if (dirty) sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ month: monthKey, rows: working }));
      else sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      /* storage unavailable - ignore */
    }
  }, [working, dirty, monthKey]);

  const userById = (id) => users.find((u) => String(u.id) === String(id));
  // A member who cannot be resolved is named rather than numbered: an id here told an administrator nothing and
  // made the pill the width of a UUID.
  const userName = (id) => userById(id)?.name || unnamedLabel('member');
  // Stable identity, so the memoized month slots recompute when the assignments change
  // (their labels come from here) and not on every render.
  const assignmentById = useCallback(
    (id) => assignments.find((a) => String(a.id) === String(id)),
    [assignments]
  );

  // What a pill calls the shift. A VACANCY (a row with no member) is labeled with the
  // ASSIGNMENT rather than the word "Open": the vacancy styling already shows that nobody
  // is on it, and the assignment is what an administrator is scanning this board for.
  // A row created without an assignment of its own borrows the slot template's. "Open"
  // survives only for a vacancy whose assignment cannot be determined.
  //
  // This tab ONLY. The member calendar still says "Open", because there the word is the
  // point - it tells the member the shift is available to offer for.
  const occupantLabel = (entry, template) => {
    if (String(entry?.user_id ?? '').trim() !== '') return userName(entry.user_id);
    const assignmentId =
      String(entry?.assignment_id ?? '').trim() || String(template?.assignment_id ?? '').trim();
    return assignmentById(assignmentId)?.description || 'Open';
  };

  // The MEMBER behind a pill, for the rank dot drawn before their name (components/RankDot) and for the certification
  // badges drawn after it. A VACANCY has no member, so there is no rank and no badge to draw - which is why this
  // returns null rather than a placeholder row. `occupantLabel` answers the same question with a string, and the dot
  // and the badges are drawn by `pillBody` below, which is the one place a pill is assembled.
  const occupantUser = (entry) =>
    String(entry?.user_id ?? '').trim() !== '' ? userById(entry.user_id) : null;

  // Icon name configured for an assignment (Administration → Assignments). Blank means
  // "no icon", so callers render nothing rather than the fallback glyph.
  const assignmentIcon = (id) => String(assignmentById(id)?.icon ?? '').trim();

  // WHAT A PILL SAYS: the assignment's icon, the member's rank as a dot, their certification badges, the name or the
  // assignment label, and the shift's window.
  //
  // ONE FUNCTION FOR ALL THREE KINDS OF PILL - a template slot's occupant, a custom-shift row, and an unfilled slot -
  // because the alternative is what this file had: those five facts written out per branch, so the rank dot reached two
  // of the three and the certification badges reached none. A fact added to a pill now has exactly one home, and one
  // place to be missing from.
  //
  // IT RETURNS ELEMENTS RATHER THAN BEING A COMPONENT OF ITS OWN. A component declared inside this one is a NEW
  // component TYPE on every render, so React would unmount and remount every pill on the board whenever anything
  // changed - throwing away the focus inside a popover a pill had opened, and remounting the badge components, which
  // resubscribe to the badge index. A plain function is called during the render already happening and introduces no
  // type at all.
  //
  // `roomy` IS THE DAY VIEW, where one day fills the card and there is vertical room the month view does not have: the
  // pill becomes two lines at a readable size and shows the shift's WINDOW, rather than clipping it onto one line and
  // leaving it to the tooltip. The order of the facts is identical in both, so the two views read as the same pill.
  //
  // `memberId` AND `user` ARE TWO KEYS TO ONE PERSON, and both are needed: the badge index is keyed by MEMBER ID - which
  // the schedule row carries even when the directory cannot resolve them - while the rank dot needs the ROW itself for
  // its `rank_id`. A vacancy has neither, which is why both default to nothing and why a vacancy draws no dot and no
  // badge.
  const pillBody = ({
    label,
    icon,
    memberId = '',
    user = null,
    time = '',
    pending = false,
    labelClassName = '',
    roomy,
  }) => {
    const iconNode = icon ? (
      <RankIcon
        name={icon}
        className={roomy ? 'w-3.5 h-3.5 shrink-0' : 'inline-block w-2.5 h-2.5 mr-0.5 -mt-px align-[-1px]'}
      />
    ) : null;
    // THE CERTIFICATION ICONS GO BESIDE THE NAME, because that is whose they are - the answer to "who am I on with",
    // read at the moment an officer is looking at the shift. Only for a MEMBER: an unfilled slot has nobody to badge.
    //
    // `iconClassName=""` so each glyph INHERITS the pill's own text colour. A staffed pill is the assignment's colour
    // with white text over it, and that colour is arbitrary, so the fixed sky blue a badge carries on a white card can
    // be unreadable on it. Same rule as the assignment icon beside it, and the member calendar's crew pill.
    const badges = memberId ? (
      <CertificationBadges userId={memberId} className={roomy ? 'w-3.5 h-3.5' : 'w-2.5 h-2.5'} iconClassName="" />
    ) : null;
    const dot = (
      <RankDot
        user={user}
        ranks={ranks}
        showLabel={colorblindRankLabels}
        className={colorblindRankLabels
          ? 'shrink-0'
          : roomy
            ? 'w-2.5 h-2.5 shrink-0'
            : 'inline-block w-2 h-2 mr-0.5 -mt-px align-[-1px] shrink-0'}
      />
    );
    // The pending-approval marker is an EMPTY SLOT's, for a vacancy somebody has offered to fill - so it leads, and it
    // is the one fact on a pill that is not about the shift itself.
    const marker = pending ? (
      <span className="inline-flex items-center justify-center w-3 h-3 rounded-full bg-amber-400 shrink-0" title="Pending approval" />
    ) : null;

    if (!roomy) {
      return (
        <>
          {marker}
          {iconNode}
          {dot}
          <span className={labelClassName}>{label}</span>
          {badges}
          {time ? ` · ${time}` : ''}
        </>
      );
    }

    return (
      <>
        {/* WHO is on the shift, and which shift it is - the line that has to survive a narrow screen. */}
        <span className="flex min-w-0 items-center gap-1.5">
          {marker}
          {iconNode}
          {dot}
          <span className={`truncate ${labelClassName}`}>{label}</span>
          {badges}
        </span>
        {/* WHEN it runs, on its own line: the fact the month view has to leave to the tooltip. `whitespace-nowrap`
            because a window that breaks mid-way ("8:00 AM –" / "6:00 PM") reads as two times rather than one. */}
        {time ? (
          <span className="mt-0.5 block text-[11px] font-normal opacity-90 whitespace-nowrap">{time}</span>
        ) : null}
      </>
    );
  };

  // Eligibility classification for an assignment, sharing one implementation
  // with the Assignments admin tab so the counts always agree.
  //
  // RANK RULE (higher numeric rank_order = higher rank): a member can fill
  // shifts for their OWN rank and every LOWER rank, so an Officer (order 3) can
  // fill Firefighter (1), Driver (2), and Officer (3) shifts. See
  // `utils/rankEligibility.js`.
  const eligibilityFor = (assignment) => classifyEligibility({ users, ranks, assignment });

  const isOccurred = (entry) => Boolean(entry?._to && entry._to < todayKey);

  // An entry's template, and the time window shown for it: the template's, or (custom shifts) the start/end times stored
  // on the schedule row itself.
  const entryTemplate = (entry) =>
    scheduleTemplates.find((t) => String(t.id) === String(entry.schedule_template_id ?? ''));

  const entryTimeRangeOf = (entry) => {
    const template = entryTemplate(entry);
    return template ? timeRangeOf(template) : rowTimeRangeOf(entry);
  };

  // An entry's start MINUTE, from the same two places as its range above: the template's when it still has one, its own
  // start_time when it does not (which is what a custom shift is). Deliberately NOT defaulted to 0 - midnight is a real
  // start time, so a row whose start cannot be read must not borrow it (see the MISSING convention in utils/dayOrder).
  // Null here sorts last, which is the honest answer for a row that has lost both its template and its times.
  const entryStartMinute = (entry) => {
    const template = entryTemplate(entry);
    return timeToMinutes(template ? template.start_time : entry?.start_time);
  };
  const entryEndMinute = (entry) => {
    const template = entryTemplate(entry);
    return timeToMinutes(template ? template.end_time : entry?.end_time);
  };

  // WHETHER THE MEMBER MARKED ANYTHING AVAILABLE THAT DAY - and that is the honest question this board can ask.
  //
  // Availability is expressed as WINDOWS: a nickname, hours, and the days of the week the window runs on, claimed one day
  // at a time (utils/availability.js). A window does not name a schedule template, so a board that schedules shifts cannot
  // test "did they claim THIS shift" - only "did they claim anything that day". Asking the finer question would mean
  // inventing a mapping the data does not have; asking this one costs no extra read, because the crew's claims are already
  // in hand once an officer screen has read them (App.jsx#loadRosterAvailability).
  //
  // AND ONLY A DAY THAT WAS ACTUALLY READ CAN BE JUDGED AGAINST. Those claims arrive for a RANGE, and the board warns
  // about a month - so a month outside the range is not a month in which nobody claimed anything, it is a month this
  // board holds no claims for. Reading the two as the same thing drew a list naming every filled shift on the board,
  // counted as members who "marked no availability", from data that had never been fetched: an accusation made of an
  // empty array. `dayCovered` is the boundary - a claim is only counted where its day was read - and the banner says
  // which month's claims are missing instead of listing names.
  const hasRosterClaimsScope = Boolean(rosterClaimsFrom && rosterClaimsTo);
  const dayCovered = (dateKey) =>
    hasRosterClaimsScope && Boolean(dateKey) && dateKey >= rosterClaimsFrom && dateKey <= rosterClaimsTo;
  const claimsMonthLoaded =
    hasRosterClaimsScope && monthStartKey >= rosterClaimsFrom && monthEndKey <= rosterClaimsTo;
  const claimedDays = useMemo(() => memberDayKeys(rosterAvailability), [rosterAvailability]);

  const entryIsAvailable = (entry) => {
    const user = userById(entry.user_id);
    if (!user || !entry._from) return true;
    // Unknown is not "unavailable": see the range note above.
    if (!dayCovered(entry._from)) return true;
    return claimedDays.has(`${String(user.id).trim()}|${String(entry._from).trim()}`);
  };

  // Flags warnings on the visible month's pills that fall outside the member's
  // availability (the banner is dismissible; scheduling is still allowed).
  const unavailableEntries = working.filter(
    (e) =>
      !isOccurred(e) &&
      dayCovered(e._from) &&
      e._to &&
      e._from <= monthEndKey &&
      e._to >= monthStartKey &&
      !entryIsAvailable(e)
  );
  const visibleUnavailable = unavailableEntries.filter((e) => !warnedKeys.has(e._key));

  // THE CLAIMS FOR THE MONTH ON SCREEN ARE ASKED FOR, not assumed. That warning names members, and it is only honest
  // about days that were actually read - so when this app holds no claims for the month being looked at, the board asks
  // for exactly that month. One month, not the seven the roster screens hold: this tab needs the claims to judge one
  // month's shifts, and nothing else on this screen reads them.
  //
  // The ask is remembered per month, so walking back and forth does not re-ask; Refresh clears it, which makes a failed
  // claims read retryable by hand.
  const claimsAskedFor = useRef('');
  // Held in a ref for the same reason as the schedule reader above: `loadRosterMonth` is a function in App's body, so a
  // dependency on it would re-run this effect on every render.
  const rosterMonthRef = useRef(onRosterMonth);
  useEffect(() => {
    rosterMonthRef.current = onRosterMonth;
  }, [onRosterMonth]);
  useEffect(() => {
    const ask = rosterMonthRef.current;
    if (!ask || claimsMonthLoaded || claimsAskedFor.current === monthKey) return;
    claimsAskedFor.current = monthKey;
    void Promise.resolve(ask(year, month)).catch(() => {
      // Deliberately silent: a failed read leaves the month unread, and the note under the grid already says the shifts
      // were not checked. Accusing members from an empty list is the fault this arrangement replaced.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimsMonthLoaded, monthKey, year, month]);

  // Template slots for the visible month, and the day each falls on. THE RULE LIVES IN utils/scheduleSlots - the
  // Member Availability roster lists the same slots to assign a member to, and one definition of a slot is what keeps
  // the two screens from disagreeing. What is left here is the memo and the dependency list.
  const visibleSlots = useMemo(
    () => templateSlotsForMonth({ year, month, scheduleTemplates, assignmentById }),
    [year, month, scheduleTemplates, assignmentById]
  );

  const slotsByDay = useMemo(() => slotsByDayOf(visibleSlots), [visibleSlots]);

  // Scheduled pills per day of the visible month. A row is listed on the day it
  // STARTS only (utils/shiftPlacement): an overnight or multi-day row used to be
  // listed on every day it covered, which drew one shift twice - and an open one
  // as two separate vacancies.
  //
  // `slotOccupant` deliberately keeps its covering test instead, because a row
  // really does staff the later slots it spans; without that, a long shift would
  // leave a later same-template slot looking vacant when someone is on it.
  const pillsByDay = useMemo(() => {
    const map = {};
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = toDateKey(new Date(year, month, d));
      for (const e of working) {
        if (isShiftDay(e._from, dateKey)) (map[dateKey] = map[dateKey] || []).push(e);
      }
    }
    return map;
  }, [working, year, month]);

  const monthGrid = useMemo(() => monthGridCells(year, month), [year, month]);

  // WHICH DAYS THE CELLS ARE DRAWN FOR: every day of the month on a wide screen, the days of the span on a narrow one.
  // Both draw the SAME cell through the same closure below - a day view is an entry of this list, not a second renderer -
  // so a change to how a day is drawn cannot reach one view and miss the other.
  //
  // `spanDates` rather than `[viewDate]`, and it is already clipped to this board's month (see the note there): the list
  // is therefore never empty in a day view and never holds a day this board cannot edit.
  const daysOnBoard = dayView ? spanDates : monthGrid;

  // Non-shift entries for the visible month, grouped by day. Normalized defensively so a raw sheet row
  // cannot silently render nothing: the engine reads `isAllDay`/`startsAt`, not `is_all_day`/`date_from`.
  //
  // No audience filter: the board draws the whole crew and an administrator needs to see an event however
  // it is targeted. The toggle is a view choice only, and is not persisted.
  const eventSegmentsByDate = useMemo(() => {
    if (!showEvents) return new Map();
    const normalized = normalizeEventList(events);
    if (!normalized.length) return new Map();
    return eventSegmentsByDay(
      normalized,
      toDateKey(new Date(year, month, 1)),
      toDateKey(new Date(year, month + 1, 0)),
      { ranks }
    );
  }, [showEvents, events, ranks, year, month]);

  // The board's own rows are what fills a slot, so this stays a one-argument call and every use below is unchanged.
  const slotOccupant = (slot) => slotOccupantOf(slot, working);

  // WHAT THIS MONTH ACTUALLY HOLDS, SAID OUT LOUD.
  //
  // Three states draw the same empty calendar and only the first is innocent: the shifts were never loaded, the shifts
  // ARE loaded but none matches a slot, or the month genuinely has nobody on it. The board used to show a bare grid of
  // empty slots for all three, which is how a real roster problem read as "nobody is rostered" for hours. The counts
  // are deliberate: an officer can say which state they are looking at without opening a developer console.
  //
  // The UNMATCHED count is the one that matters when a shift is on the board but not in its slot: the grid draws such a
  // row as an extra pill (see extraPills below), so it appears BESIDE the empty slot it belongs to - which reads as "my
  // shift did not save" when the row is in the database and in this very array.
  const matchedKeys = new Set(visibleSlots.map((slot) => slotOccupant(slot)?._key).filter(Boolean));
  const unmatchedRows = working.filter((entry) => !matchedKeys.has(entry._key));
  const monthHoldsNothing = working.length === 0;

  // Pending shift offers keyed by slot, so the calendar can flag the slots
  // waiting on admin approval. Backend offer `slot_key` values are either
  // `row-<schedule id>` (for filled shifts) or `slot-YYYY-MM-DD-templateId`
  // (for open slots); the admin calendar's slot keys use `YYYY-MM-DD|templateId`,
  // so we normalize open-slot offer keys to match.
  const pendingBySlot = useMemo(() => {
    const map = new Map();
    for (const o of offers) {
      if (String(o.status ?? '') !== 'pending') continue;
      let key = String(o.slot_key ?? '') || '';
      if (key.startsWith('slot-')) {
        // `slot-YYYY-MM-DD-templateId` -> `YYYY-MM-DD|templateId`
        key = key.slice(5).replace(/-([^-]*)$/, '|$1');
      }
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(o);
    }
    return map;
  }, [offers]);

  const pendingOffersForSlot = (slot) => pendingBySlot.get(slot.slotKey) || [];

  // Every schedule template that runs on the selected date's weekday, ordered
  // by start time. Backs the Add Shift "Shift" picker.
  //
  // Retired and not-yet-effective templates are excluded too, so a one-off shift cannot be
  // created from a pattern that was not running that day (utils/scheduleTemplates).
  const templatesForDate = (dateKey) => {
    if (!dateKey) return [];
    const dow = dowOf(dateKey);
    return scheduleTemplates
      .filter((t) => String(t.day_of_week ?? '').trim().toLowerCase() === dow)
      .filter((t) => templateIsActiveOn(t, dateKey))
      .filter((t) => assignmentIsActiveOn(assignmentById(t.assignment_id), dateKey))
      .slice()
      .sort((a, b) => (timeToMinutes(a.start_time) ?? 0) - (timeToMinutes(b.start_time) ?? 0));
  };

  const templateById = (id) =>
    scheduleTemplates.find((t) => String(t.id) === String(id ?? '')) || null;

  // Assignments an administrator may CHOOSE for a new shift: the ones in force on the date being added.
  // The shift's own assignment is kept even when retired, so saving an untouched old entry cannot
  // silently rewrite it onto a different assignment (see utils/assignmentDates).
  const assignmentsForAddForm = () =>
    choosableAssignments(assignments, addForm.date_from, addForm.assignment_id);

  // Label used by the template picker and the inline popover header.
  const templateLabel = (t) => {
    const time = timeRangeOf(t);
    const name = assignmentById(t.assignment_id)?.description || 'No assignment';
    return [time, name].filter(Boolean).join(' · ');
  };

  // A slot's label: the template's nickname in place of its times when one is set,
  // otherwise the window. Shared rule - see utils/shiftTime.
  const slotLabelText = (slot) => {
    const time = shiftTimeLabel(slot.template, timeRangeOf(slot.template));
    const name = assignmentById(slot.template.assignment_id)?.description || '';
    return [time, name].filter(Boolean).join(' · ') || 'Open slot';
  };

  // Manual add: the admin picks a date then a schedule template for that
  // weekday, or selects "Custom Shift" and specifies the exact start/end date
  // & time window, then a member.
  const submitAdd = (e) => {
    e.preventDefault();
    const isCustom = addForm.schedule_template_id === 'custom';
    const template = isCustom ? null : templateById(addForm.schedule_template_id);
    const assignmentId = template ? template.assignment_id : addForm.assignment_id;
    const assignment = assignmentById(assignmentId);
    const user = users.find((u) => String(u.id) === String(addForm.user_id));
    // The member is optional: leaving it blank creates an OPEN shift (a row with
    // no user_id) that the calendar draws as available for members to offer on.
    // This used to bail silently, so nothing was added at all.
    if (!assignment) return;

    let fromKey = addForm.date;
    let toKey = addForm.date;
    let startTime = '';
    let endTime = '';
    if (isCustom) {
      fromKey = addForm.custom_start_date;
      toKey = addForm.custom_end_date;
      startTime = addForm.custom_start_time;
      endTime = addForm.custom_end_time;
      if (!fromKey || !toKey || !startTime || !endTime) {
        setError('Custom shifts need a start date & time and an end date & time.');
        return;
      }
      // Both sides are "YYYY-MM-DD HH:MM" so a plain string compare works.
      if (`${toKey} ${endTime}` <= `${fromKey} ${startTime}`) {
        setError('The custom shift must end after it starts.');
        return;
      }
    }

    tmpCounter.current += 1;
    setWorking((prev) => [
      ...prev,
      {
        id: '',
        schedule_template_id: template ? template.id : '',
        date_from: fromKey,
        date_to: toKey,
        start_time: startTime,
        end_time: endTime,
        apparatus_id: template ? template.apparatus_id ?? '' : '',
        assignment_id: assignment.id,
        user_id: user ? user.id : '',
        _from: fromKey,
        _to: toKey,
        _key: `tmp-${tmpCounter.current}`,
      },
    ]);
    setDirty(true);
    setAddFormOpen(false);
    setAddForm(null);
    setError(null);
    setNotice('Shift added. Remember to Save.');
  };

  const openAddForm = () => {
    const inMonth = todayKey >= monthStartKey && todayKey <= monthEndKey;
    const defaultDate = inMonth ? todayKey : monthStartKey;
    setAddForm({
      date: defaultDate,
      schedule_template_id: '',
      assignment_id: '',
      user_id: '',
      custom_start_date: defaultDate,
      custom_start_time: '',
      custom_end_date: defaultDate,
      custom_end_time: '',
    });
    setAddFormOpen(true);
    setError(null);
    setNotice(null);
    setPopover(null);
  };

  // Dragging a pill onto an empty slot moves the whole entry: dates shift by
  // the day delta and the entry adopts the target slot's template (and its
  // assignment/apparatus).
  const handlePillDragStart = (e, entry, dateKey) => {
    if (isOccurred(entry)) {
      e.preventDefault();
      return;
    }
    setDragKey(entry._key);
    // Also in a ref: a dragover can arrive before React re-renders with the state above, and the hold-to-swap needs
    // to know which row is being dragged from the very first one.
    dragKeyRef.current = entry._key;
    setDragSourceDate(dateKey);
    e.dataTransfer?.setData('text/plain', entry._key);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEndPill = () => {
    // The drag is over wherever it ended: stop counting, and drop any swap that was only being offered. Letting go
    // anywhere but on the slot means the answer was no, and the pills go back to where they were.
    cancelSwapDwell();
    cancelSwapPreview();
    dragKeyRef.current = null;
    setDragKey(null);
    setDragSourceDate(null);
    setHoverSlot(null);
  };

  // ---- Hold-to-swap ----
  //
  // Holding a dragged pill over a FILLED slot for SWAP_DWELL_MS offers to exchange the two shifts. The offer is
  // shown, not made: `swapPreview` is display-only, so letting go commits it and moving out simply stops showing
  // it. That is why the release is invisible - by then the board already looks swapped - and why a cancellation
  // cannot leave half a swap behind.
  //
  // The dwell timer is deliberately NOT restarted by every dragover event: those fire continuously while the
  // pointer sits still, and re-arming on each one would mean the swap never arrived.
  const [swapDwell, setSwapDwell] = useState(null);
  const [swapPreview, setSwapPreview] = useState(null);
  // Kept for a moment after a swap is taken back, so the pills get the same quick pop on the way back as they got
  // on the way out. Without it the revert is an invisible jump.
  const [swapRevert, setSwapRevert] = useState(null);

  const cancelSwapDwell = () => {
    if (swapDwellTimer.current) {
      clearTimeout(swapDwellTimer.current);
      swapDwellTimer.current = null;
    }
    setSwapDwell((current) => (current ? null : current));
  };

  const beginSwapDwell = (slot, occupant, entry) => {
    if (!entry || !occupant) return;
    if (swapDwell?.slotKey === slot.slotKey) return; // already counting down for this slot

    const verdict = planShiftSwap({
      draggedKey: entry._key,
      entry,
      targetOccupant: occupant,
      targetKind: 'slot',
      targetDate: slot.dateKey,
      todayKey,
    });
    if (verdict.action !== 'swap') return;

    cancelSwapDwell();
    setSwapPreview(null);
    // Coming back to a spot whose swap was just taken back: the timer starts again from scratch, because the hold
    // has to be continuous to mean anything.
    setSwapRevert(null);
    setSwapDwell({ slotKey: slot.slotKey, targetKey: occupant._key });
    swapDwellTimer.current = setTimeout(() => {
      swapDwellTimer.current = null;
      setSwapDwell(null);
      setSwapPreview({ slotKey: slot.slotKey, aKey: entry._key, bKey: occupant._key });
    }, SWAP_DWELL_MS);
  };

  const cancelSwapPreview = () => {
    // Read from this render's state rather than inside an updater: the revert has to schedule a timer, and a side
    // effect in an updater runs twice under StrictMode.
    const current = swapPreview;
    if (!current) return;
    setSwapPreview(null);
    // The exchange was on screen, so its reversal gets the same treatment: a short pop where each pill returns to,
    // rather than the pills silently changing their minds.
    setSwapRevert({ aKey: current.aKey, bKey: current.bKey });
    if (swapRevertTimer.current) clearTimeout(swapRevertTimer.current);
    swapRevertTimer.current = setTimeout(() => {
      swapRevertTimer.current = null;
      setSwapRevert(null);
    }, SWAP_POP_MS);
  };


  // What a slot should DRAW. With a swap offered, the two rows are drawn in each other's places - which is the
  // whole feedback for the gesture, and what makes the release appear to do nothing at all.
  const displayOccupant = (slot) => {
    const occupant = slotOccupant(slot);
    if (!swapPreview || !occupant) return occupant;
    if (occupant._key === swapPreview.aKey) return working.find((r) => r._key === swapPreview.bKey) || occupant;
    if (occupant._key === swapPreview.bKey) return working.find((r) => r._key === swapPreview.aKey) || occupant;
    return occupant;
  };

  // Letting go while a swap is offered is the confirmation.
  const commitSwap = (preview) => {
    setWorking((prev) => {
      const a = prev.find((r) => r._key === preview.aKey);
      const b = prev.find((r) => r._key === preview.bKey);
      if (!a || !b) return prev;
      const [nextA, nextB] = swapSlotFields(a, b);
      return prev.map((r) => (r._key === a._key ? nextA : r._key === b._key ? nextB : r));
    });
    setSwapPreview(null);
    setSwapRevert(null);
    setDirty(true);
    setError(null);
    setNotice(DROP_NOTICES.swapped);
  };

  // Both timers outlive a drag, so they have to be cleared if the tab goes away mid-gesture.
  useEffect(
    () => () => {
      if (swapDwellTimer.current) clearTimeout(swapDwellTimer.current);
      if (swapRevertTimer.current) clearTimeout(swapRevertTimer.current);
    },
    []
  );

  // A drop is asked for a verdict before it changes anything, so a refusal can explain itself instead of doing
  // nothing at all. See utils/scheduleDrop for what each refusal means and for the hold-to-swap above.
  const handleSlotDrop = (e, slot) => {
    e.preventDefault();
    e.stopPropagation();
    setHoverSlot(null);

    // The drag state first, then the dataTransfer as a fallback: an HTML5 drag can lose its React state to a
    // re-render, and the transfer text is what the browser guarantees.
    let key = dragKey;
    if (!key) {
      try {
        key = e.dataTransfer?.getData('text/plain') || null;
      } catch {
        key = null;
      }
    }
    const sourceDate = dragSourceDate;
    const entry = key ? working.find((r) => r._key === key) : null;
    // The real occupant, not what the board is drawing: the same rule as the hover above. (With no offer on
    // screen the two are identical; with one, the drawn pill is A and the row in the data is B.)
    const occupant = slotOccupant(slot);

    // A release while the swap is being offered IS the confirmation, and it has already been shown - so this
    // commits what the board is displaying and stops.
    const armed = swapPreview && swapPreview.slotKey === slot.slotKey ? swapPreview : null;
    cancelSwapDwell();
    setDragKey(null);
    setDragSourceDate(null);
    if (armed) {
      commitSwap(armed);
      return;
    }

    const verdict = planShiftDrop({
      draggedKey: key,
      sourceDate,
      entry,
      targetDate: slot.dateKey,
      targetKind: 'slot',
      targetOccupant: occupant,
      targetName: occupant ? occupantLabel(occupant, slot.template) : '',
      todayKey,
    });

    setDragKey(null);
    setDragSourceDate(null);

    if (verdict.action !== 'move') {
      toast.error(verdict.message);
      return;
    }

    const delta = daysBetween(sourceDate, slot.dateKey);
    setWorking((prev) =>
      prev
        .map((r) =>
          r._key === key
            ? {
                ...r,
                schedule_template_id: slot.template.id,
                assignment_id: slot.template.assignment_id,
                apparatus_id: slot.template.apparatus_id ?? '',
                date_from: shiftDays(r._from || r.date_from, delta),
                date_to: shiftDays(r._to || r.date_to, delta),
                _from: shiftDays(r._from || r.date_from, delta),
                _to: shiftDays(r._to || r.date_to, delta),
              }
            : r
        )
        // The open shift this move replaced goes with it, in the same write. The moved row now holds that slot,
        // and two rows on one slot would leave the board drawing whichever it happened to find first.
        .filter((r) => !verdict.displace || r._key !== verdict.displace)
    );
    setDirty(true);
    setError(null);
    // Only when the move did more than move: the open shift it replaced is gone, and the administrator should
    // know that before they Save.
    if (verdict.message) setNotice(verdict.message);
  };

  // Dropped on a shift that is not a board slot (a custom shift, or one whose template has gone). It has no slot
  // for a moved row to adopt, so this can only ever be explained - but it has to be explained rather than ignored.
  const handlePillDrop = (e, entry) => {
    e.preventDefault();
    e.stopPropagation();
    setHoverSlot(null);

    let key = dragKey;
    if (!key) {
      try {
        key = e.dataTransfer?.getData('text/plain') || null;
      } catch {
        key = null;
      }
    }

    const verdict = planShiftDrop({
      draggedKey: key,
      sourceDate: dragSourceDate,
      entry: key ? working.find((r) => r._key === key) : null,
      targetDate: entry._from || '',
      targetKind: 'pill',
      targetOccupant: entry,
      targetName: occupantLabel(entry, entryTemplate(entry)),
      todayKey,
    });

    setDragKey(null);
    setDragSourceDate(null);
    if (verdict.action !== 'move') toast.error(verdict.message);
  };

  // Dropped on the empty space of a day. There is no slot under it, so this too can only be explained - which is
  // the point: it used to do nothing at all, and read as a broken board.
  const handleDayDrop = (e, dateKey) => {
    e.preventDefault();
    setHoverSlot(null);

    let key = dragKey;
    if (!key) {
      try {
        key = e.dataTransfer?.getData('text/plain') || null;
      } catch {
        key = null;
      }
    }

    const verdict = planShiftDrop({
      draggedKey: key,
      sourceDate: dragSourceDate,
      entry: key ? working.find((r) => r._key === key) : null,
      targetDate: dateKey,
      targetKind: 'day',
      todayKey,
    });

    setDragKey(null);
    setDragSourceDate(null);
    if (verdict.action !== 'move') toast.error(verdict.message);
  };


  // Arms a slot so the browser will deliver the drop at all. Everything that wants to explain a refusal has to
  // accept the drop first - a slot that refuses the drag at this point shows a no-entry cursor and says nothing,
  // which is exactly the silence this replaced.
  //
  // It is also where the hold-to-swap is driven from, and the one thing that must not be read here is what the
  // board is DRAWING: with the two pills shown exchanged, the slot under the pointer looks like the row being
  // dragged, and reading that canceled the swap the instant it appeared - then re-armed it, forever. The real
  // occupant is the source of truth; the verdict logic is in planSwapHover.
  const handleSlotDragOver = (e, slot) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    setHoverSlot(slot.slotKey);

    const entry = dragKeyRef.current ? working.find((r) => r._key === dragKeyRef.current) : null;
    const occupant = slotOccupant(slot);
    const verdict = planSwapHover({
      draggedKey: dragKeyRef.current,
      entry,
      occupant,
      slotKey: slot.slotKey,
      dwellSlotKey: swapDwell?.slotKey || '',
      previewSlotKey: swapPreview?.slotKey || '',
    });

    if (verdict.action === 'cancel') {
      cancelSwapDwell();
      cancelSwapPreview();
    } else if (verdict.action === 'hold') {
      beginSwapDwell(slot, occupant, entry);
    }
    // 'keep': the hold or the offer is already right for this slot, so nothing at all happens - which is what
    // makes the swap stay on screen once it appears.
  };

  const handleSlotDragLeave = (e, slot) => {
    // A LEAVE THAT NEVER LEFT IS THE ORDINARY CASE, not an edge case - and it is the whole of the reported "it sits
    // there flashing and won't swap". A pill is a div full of children (a name, a rank dot, a badge, the time), and the
    // pointer crossing from the pill onto one of them fires dragleave on the pill; so does a hand resting a pixel off
    // the rounded edge. Believing each of those cancels the hold and restarts the countdown, so the blink never
    // resolves and no offer is armed when the pointer is released. See stillOnSlot for what counts as leaving.
    //
    // The box is measured here because a rect is the element's business - whether that box counts is the verdict's.
    const box = e?.currentTarget?.getBoundingClientRect?.() || null;
    if (stillOnSlot({ x: e?.clientX, y: e?.clientY, box })) return;

    // It really did leave: that is the cancellation - stop counting, and stop showing the exchange.
    setHoverSlot((cur) => (cur === slot.slotKey ? null : cur));
    cancelSwapDwell();
    cancelSwapPreview();
  };


  // ---- Inline member picker (click a pill or an empty slot) ----

  const POPOVER_WIDTH = 300;
  const POPOVER_MAX_HEIGHT = 340;

  // Positions the popover next to the clicked element, flipping above/beside it
  // when there isn't room below.
  const popoverPosition = (rect, width = POPOVER_WIDTH, maxHeight = POPOVER_MAX_HEIGHT) =>
    viewportPopoverPosition({
      anchor: rect,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      width,
      maxHeight,
    });

  const closePopover = () => {
    popoverAnchorRef.current = null;
    setPopover(null);
    setSelectedKey(null);
  };

  const openEntryPopover = (event, entry) => {
    event.stopPropagation();
    if (isOccurred(entry)) {
      setSelectedKey(entry._key);
      setPopover(null);
      return;
    }
    setSelectedKey(entry._key);
    popoverAnchorRef.current = event.currentTarget;
    setPopover({
      kind: 'entry',
      key: entry._key,
      ...popoverPosition(event.currentTarget.getBoundingClientRect()),
    });
  };

  // An empty template slot: assigning creates the scheduled entry for that day.
  // If the slot has a pending offer, the popover shows the pending status and
  // approve/decline actions instead of the member picker.
  const openSlotPopover = (event, slot) => {
    event.stopPropagation();
    setSelectedKey(null);
    popoverAnchorRef.current = event.currentTarget;
    const pending = pendingOffersForSlot(slot);
    if (pending.length) {
      setPopover({
        kind: 'slot-offer',
        slot,
        pending,
        ...popoverPosition(event.currentTarget.getBoundingClientRect()),
      });
      return;
    }
    setPopover({
      kind: 'slot',
      slot,
      ...popoverPosition(event.currentTarget.getBoundingClientRect()),
    });
  };

  const assignUser = (userId) => {
    if (!popover) return;
    if (popover.kind === 'entry') {
      setWorking((prev) => prev.map((r) => (r._key === popover.key ? { ...r, user_id: userId } : r)));
    } else {
      const { slot } = popover;
      tmpCounter.current += 1;
      setWorking((prev) => [
        ...prev,
        {
          id: '',
          schedule_template_id: slot.template.id,
          date_from: slot.dateKey,
          date_to: slot.dateKey,
          apparatus_id: slot.template.apparatus_id ?? '',
          assignment_id: slot.template.assignment_id,
          user_id: userId,
          _from: slot.dateKey,
          _to: slot.dateKey,
          _key: `tmp-${tmpCounter.current}`,
        },
      ]);
    }
    setDirty(true);
    setError(null);
    setNotice(null);
    closePopover();
  };

  // Removes the MEMBER from a shift rather than the shift itself: the row is kept
  // with a blank user_id, which is exactly what "Open" means everywhere else, so
  // the shift becomes one members can offer to fill.
  //
  // This is deliberately separate from deleting: a click that reads as "take this
  // person off the shift" must never destroy a custom shift outright. Deleting the
  // row is a distinct action, offered only where the row IS the shift (see the
  // Delete Shift button in the entry popover).
  const unassignEntry = (key) => {
    setWorking((prev) => prev.map((r) => (r._key === key ? { ...r, user_id: '' } : r)));
    setDirty(true);
    setError(null);
    setNotice(null);
    closePopover();
  };

  // Deletes the shift outright. Only reached for rows that stand alone - custom
  // shifts and rows whose template no longer exists.
  const removeEntry = (key) => {
    setWorking((prev) => prev.filter((r) => r._key !== key));
    setDirty(true);
    closePopover();
  };

  // Resolve a pending offer: approve (fills the shift and closes other offers)
  // or decline (just stamps the offer).
  const resolveOffer = async (offerId, decision) => {
    setSaving(true);
    setError(null);
    try {
      const result = await adminResolveShiftOffer(offerId, decision, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to resolve offer.');
      if (result.scheduleRow) {
        // The approved offer filled an empty slot - reflect it as a working row
        // so it shows on the calendar immediately.
        setWorking((prev) => [
          ...prev,
          {
            ...result.scheduleRow,
            _from: result.scheduleRow.date_from,
            _to: result.scheduleRow.date_to,
            _key: `db-${result.scheduleRow.id}`,
          },
        ]);
      }
      if (result.declinedIds?.length) {
        // Sibling offers were auto-declined when the slot was filled. Those
        // offers never created schedule rows, so there's nothing to remove
        // from `working` — the slot is now occupied by result.scheduleRow.
        // This branch exists so the caller can extend it later (e.g. removing
        // stale open-shift pills that were rendered from offer data).
      }
      setNotice(`Offer ${decision.toLowerCase()}.`);
      // Approved offers write a schedule row (the backend fills the empty slot), so the schedule section is refreshed
      // too - named explicitly, because the payload fallback cannot carry it. Declining writes only the offer.
      void onAdminDataChanged?.(
        decision === 'APPROVE' ? ['schedule', 'scheduleOffers'] : ['scheduleOffers'],
        token
      );
    } catch (err) {
      setError(err.message || 'Failed to resolve offer.');
    } finally {
      setSaving(false);
      closePopover();
    }
  };
  // Quick Add menu closes on outside click or Escape (like the other menus).
  useEffect(() => {
    if (!quickAddOpen) return undefined;
    const onDown = (e) => {
      if (
        !quickAddRef.current?.contains(e.target) &&
        !quickAddMenuRef.current?.contains(e.target)
      ) {
        setQuickAddOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setQuickAddOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [quickAddOpen]);

  useEffect(() => {
    if (!quickAddOpen) return undefined;
    const reposition = () => {
      const anchor = quickAddRef.current;
      if (!anchor?.isConnected) {
        setQuickAddOpen(false);
        return;
      }
      const next = popoverPosition(anchor.getBoundingClientRect(), 256, 320);
      setQuickAddPosition((current) =>
        current && current.top === next.top && current.left === next.left && current.width === next.width && current.maxHeight === next.maxHeight
          ? current
          : next
      );
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [quickAddOpen]);

  // Quick Add: assign the pre-picked member straight to an empty slot with no
  // member picker. Rank qualification is checked for an informational notice
  // but never blocks the assignment (consistent with manual scheduling).
  const quickAssignToSlot = (slot) => {
    if (!quickAddUser) return;
    if (slotOccupant(slot)) return; // slot filled meanwhile
    tmpCounter.current += 1;
    setWorking((prev) => [
      ...prev,
      {
        id: '',
        schedule_template_id: slot.template.id,
        date_from: slot.dateKey,
        date_to: slot.dateKey,
        apparatus_id: slot.template.apparatus_id ?? '',
        assignment_id: slot.template.assignment_id,
        user_id: quickAddUser.id,
        _from: slot.dateKey,
        _to: slot.dateKey,
        _key: `tmp-${tmpCounter.current}`,
      },
    ]);
    setDirty(true);
    setError(null);
    const assignment = assignmentById(slot.template.assignment_id);
    const elig = assignment ? eligibilityFor(assignment) : null;
    const qualifies = !elig || elig.eligible.some((u) => String(u.id) === String(quickAddUser.id));
    setNotice(
      qualifies
        ? `Assigned ${quickAddUser.name} to ${slotLabelText(slot)} (${displayDate(slot.dateKey)}). Remember to Save.`
        : `Assigned ${quickAddUser.name} — note: their rank doesn't qualify for this assignment.`
    );
  };

  // Escape closes the POPOVER (matching the menus elsewhere in the app). The dialog does not come through here: on a
  // narrow screen the picker is a modal owned by ScheduleAssignmentModal, which handles Escape itself and leaves through
  // its exit animation - so this effect stands aside rather than closing it in a single frame.
  useEffect(() => {
    if (!popover || dayView) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') closePopover();
    };
    const reposition = () => {
      const anchor = popoverAnchorRef.current;
      if (!anchor?.isConnected) {
        closePopover();
        return;
      }
      setPopover((current) => {
        if (!current) return null;
        const next = popoverPosition(anchor.getBoundingClientRect(), current.width, current.maxHeight);
        return current.top === next.top && current.left === next.left && current.width === next.width && current.maxHeight === next.maxHeight
          ? current
          : { ...current, ...next };
      });
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [popover, dayView]);

  // Diff the working copy against the loaded server data. Only the delta is
  // transmitted on Save. `upsertKeys` records which working row each upsert
  // came from so server-assigned ids can be applied back to the right rows.
  const computeChanges = () => {
    const upserts = [];
    const upsertKeys = [];
    for (const w of working) {
      if (!w.id) {
        upserts.push(fieldsOf(w));
        upsertKeys.push(w._key);
        continue;
      }
      const orig = base.find((b) => String(b.id) === String(w.id));
      if (!orig) {
        upserts.push(fieldsOf(w));
        upsertKeys.push(w._key);
        continue;
      }
      const f = fieldsOf(w);
      if (FIELD_LIST.some((k) => String(f[k]) !== String(orig[k] || ''))) {
        upserts.push(f);
        upsertKeys.push(w._key);
      }
    }
    const deleteIds = base
      .filter((b) => b.id && !working.some((w) => String(w.id) === String(b.id)))
      .map((b) => String(b.id));
    return { upserts, upsertKeys, deleteIds };
  };

  // THE REFRESH CONTROL. It re-reads the month on screen, unconditionally - `onNeedSchedule` is the same read the
  // effect above makes - and re-seeds the board's own copy from what came back, so the Refresh button fixes a stale
  // board the same way a month change does. A colleague's edit, or a read that failed earlier, both land here.
  const refreshMonth = async () => {
    if (!onNeedSchedule) return;
    setRefreshingMonth(true);
    try {
      // The claims are re-asked too, so a Refresh retries a failed availability read as well as a failed schedule read.
      claimsAskedFor.current = '';
      const rows = await onNeedSchedule(monthStartKey, monthEndKey);
      if (Array.isArray(rows) && !dirtyRef.current) {
        const scoped = scopeToMonth(rows);
        loadedMonthRef.current = monthKey;
        setMonthRows(scoped);
        setWorking(scoped);
        setBase(scoped);
        setDirty(false);
        setSelectedKey(null);
      }
    } finally {
      setRefreshingMonth(false);
    }
  };

  const handleSave = async () => {
    const { upserts, upsertKeys, deleteIds } = computeChanges();
    if (!upserts.length && !deleteIds.length) {
      setDirty(false);
      setNotice('Nothing to save.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await adminBulkSaveSchedule({ entries: upserts, deleteIds }, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to save schedule.');

      // Apply the server-assigned ids right away so freshly created rows are
      // immediately editable without waiting on any refetch.
      const idByKey = {};
      (result.ids || []).forEach((id, i) => {
        if (id && upsertKeys[i]) idByKey[upsertKeys[i]] = String(id);
      });
      const withIds = working.map((r) => {
        const newId = idByKey[r._key];
        return newId ? { ...r, id: newId, _key: `db-${newId}` } : r;
      });
      setWorking(withIds);
      setBase(withIds.map((r) => ({ ...r })));
      setDirty(false);
      setSelectedKey(null);
      // Entry keys changed (tmp -> db ids), so previously dismissed
      // availability warnings no longer match - let them re-evaluate cleanly.
      setWarnedKeys(new Set());
      setNotice(`Saved ${result.saved ?? upserts.length} shift(s), removed ${result.deleted ?? deleteIds.length}.`);

      setNotice(`Saved ${result.saved ?? upserts.length} shift(s), removed ${result.deleted ?? deleteIds.length}.`);

      // Re-read the month this board is looking at, so the App's shared array holds what was just written. A section
      // refresh would also do this, but it answers with the whole last/this/next window and can be skipped or fall back
      // to the payload (which no longer carries `schedule`). This is the precise read of the month that changed, and it
      // is what stops a drag-move from being drawn back where it came from after a month round-trip.
      if (onNeedSchedule) void onNeedSchedule(monthStartKey, monthEndKey);
    } catch (err) {
      setError(err.message || 'Failed to save schedule.');
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setWorking(base);
    setDirty(false);
    setSelectedKey(null);
    setNotice(null);
    setError(null);
  };

  // Derived values for the Add Shift form: templates available on the chosen
  // date, and the assignment the shift will actually be filed under.
  const addTemplates = addForm ? templatesForDate(addForm.date) : [];
  const isCustomShift = addForm?.schedule_template_id === 'custom';
  const addTemplate = addForm && !isCustomShift ? templateById(addForm.schedule_template_id) : null;
  const addAssignmentId = addTemplate ? addTemplate.assignment_id : (addForm?.assignment_id ?? '');
  const addEligibility = eligibilityFor(assignmentById(addAssignmentId));

  // ---- Quick Add ----
    const quickAddUser = quickAddUserId ? userById(quickAddUserId) || null : null;

  // Active + schedulable members grouped by rank (highest rank_order first),
  // then alphabetically within each group. Members with no rank land in a
  // trailing "No rank" group; ranks with no members are omitted.
  const quickAddGroups = (() => {
    const pool = users.filter(
      (u) =>
        !isTruthyFlag(u.exclude_from_scheduling) &&
        // A MISSING STATUS COUNTS AS ACTIVE, and this is not a shortcut: `status` lives in `users_private`, which the
        // rules hand only to an officer with can_edit_users, while the directory these rows come from is the public
        // half (see AdminPanel#nameRows). Requiring the field outright emptied the quick-add for every officer who
        // could not read the private half - the list silently lost everybody rather than showing somebody suspended.
        // The tab still excludes whoever it CAN see is suspended, which is the useful half of the filter.
        (String(u.status ?? '').trim().toLowerCase() === 'active' || String(u.status ?? '').trim() === '')
    );
    const rankById = new Map(ranks.map((r) => [String(r.id), r]));
    const byGroup = new Map();
    const noRank = [];
    for (const u of pool) {
      const rank = rankById.get(String(u.rank_id ?? ''));
      if (rank) {
        const key = String(rank.id);
        if (!byGroup.has(key)) byGroup.set(key, []);
        byGroup.get(key).push(u);
      } else {
        noRank.push(u);
      }
    }
    const byName = (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''));
    const groups = [...byGroup.entries()]
      .map(([id, members]) => ({ key: id, label: rankLabel(rankById.get(id)), members: members.slice().sort(byName) }))
      .sort((a, b) => {
        const ao = parseRankOrder(rankById.get(a.key)?.rank_order);
        const bo = parseRankOrder(rankById.get(b.key)?.rank_order);
        // Higher order first; tied (or unparseable) orders fall back to label.
        if (ao !== null && bo !== null && ao !== bo) return bo - ao;
        return a.label.localeCompare(b.label);
      });
    if (noRank.length) groups.push({ key: '_none', label: 'No rank', members: noRank.sort(byName) });
    return groups;
  })();

  // THE ARROWS WALK WHATEVER IS ON SCREEN: a day in the day view, a month in the calendar. One hook call, so the two
  // buttons, the title, Today and the picker cannot step a different unit from each other - and they travel there the
  // way every other screen's arrows do, on the two-phase slide in utils/motion.
  //
  // THE UNIT IS THE VIEW'S for the same reason the member's calendar passes it: a day that animated differently from a
  // month would be two boards wearing one card. The step is then THE SPAN (`dayCount || 1`, which is zero - so one -
  // in the month view, where a month IS the step), so a two-day view moves the whole pair rather than sliding one
  // column of it: a two-day view that advanced a day at a time would show the 4th and 5th after one press, having
  // shown the 3rd and 4th before, and no officer would ever see two days in a row.
  //
  // THE READ IS UNAFFECTED by either unit: the month bounds are derived from this date, so stepping INSIDE the month
  // asks the reader for nothing new, and stepping off the month's end asks for the month arrived at - one month's
  // read, exactly as before. Day-of-month overflow is Date's own normalization, so a day step walks across month and
  // year ends with no special case, and a MONTH step keeps the day, clamped into the month it lands in (the 31st
  // becomes the 28th or 30th) rather than pinning it to the 1st and silently moving the officer to the start of the
  // month.
  const { gridClass, onAnimationEnd, goBy, goTo } = useMonthSlide(viewDate, setViewDate, dayView ? 'day' : 'month');
  const stepView = (delta) => goBy(delta * (dayCount || 1));

  // Today, in BOTH views: the date whose month is read, and the day the day view draws. Through the slide, like an
  // arrow press - and nowhere at all when the view is already standing on today (see stepTo in utils/motion).
  const goToday = () => goTo(now);

  // A DAY CHOSEN FROM THE PICKER: the same state change a press of an arrow makes, so the read follows it exactly as it
  // follows a walk - picking a day inside the month on screen asks the reader for nothing, and picking one outside it
  // reads that month.
  //
  // NOT `stepView`, deliberately: that one steps a day from the current date, and this one is being handed the date.
  const chooseDay = (dateKey) => {
    const [y, m, d] = String(dateKey).split('-').map(Number);
    if (!y || !m || !d) return;
    // Through the slide, so a day picked from another month travels there the way an arrow press would have.
    goTo(new Date(y, m - 1, d));
    setPickerOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* The month on screen is read when it is looked at - no schedule travels with the sign-in - so this says so while
          that read is in flight, rather than showing an empty board. */}
      {monthPending && (
        <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading {monthLabel}…
        </div>
      )}
      {/* Toolbar */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            {/* THE ARROWS STEP THE UNIT ON SCREEN - a day in the day view, a month in the calendar - and their labels
                say which, because a screen reader has no title bar to read it from. `aria-label` is also what the
                board's own harness looks the buttons up by, so the two units' buttons stay distinguishable. */}
            <button type="button" onClick={() => stepView(-1)} aria-label={dayView ? (dayCount > 1 ? `Previous ${dayCount} days` : 'Previous day') : 'Previous month'} className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="min-w-[150px] text-center text-base font-semibold text-slate-900 dark:text-white">{dayView ? dayLabel : monthLabel}</span>
            <button type="button" onClick={() => stepView(1)} aria-label={dayView ? (dayCount > 1 ? `Next ${dayCount} days` : 'Next day') : 'Next month'} className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700">
              <ChevronRight className="w-5 h-5" />
            </button>
            <button type="button" onClick={goToday} className="ml-1 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-red-600">
              Today
            </button>

            {/* CHOOSE A DAY, which only a day view needs: the month view already has every day on screen, so a picker
                over it would be a second grid saying what the first one says. Here it is the difference between fourteen
                presses and one, and between a month boundary and none. */}
            {dayView && (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                aria-label="Choose a day"
                title="Pick a day from the month"
                className="ml-1 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <CalendarDays className="w-4 h-4" />
                {/* The word is dropped below `sm`, where the toolbar is arrows, the shift count, Quick Add, Discard and
                    Save already. The icon and its tooltip carry it there, and the `aria-label` carries it for a screen
                    reader at every width. */}
                <span className="hidden sm:inline">Day</span>
              </button>
            )}

            {/* RE-READS THE MONTH ON SCREEN, whatever the window already covers. It is also the retry after a failed
                read, and the only way to pick up a colleague's edit while this board is already open - `schedule` has
                no live listener by design (see utils/scheduleWindow and liveReads). */}
            <button
              type="button"
              onClick={refreshMonth}
              disabled={refreshingMonth || saving}
              title="Re-read this month from the database. Use it to pick up somebody else's change, or to retry after a failed load."
              className="ml-1 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40"
            >
              <RefreshCw className={refreshingMonth ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} />
              {refreshingMonth ? 'Refreshing…' : 'Refresh'}
            </button>

            {/* Prints the month on screen, so what is printed is exactly what is being managed. */}
            <button
              type="button"
              onClick={() => setPrintOpen(true)}
              title={
                dirty
                  ? 'Prints the saved schedule. Unsaved changes are not included — save first.'
                  : 'Print a printer-friendly month of every shift.'
              }
              className="ml-1 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <Printer className="w-4 h-4" />
              Print
            </button>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {dirty && (
              <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 rounded-full px-2.5 py-1">
                Unsaved changes
              </span>
            )}

            {/* Quick Add — pick a member once, then click empty calendar slots to assign them. */}
            <div className="relative" ref={quickAddRef}>
              <button
                type="button"
                onClick={(event) => {
                  if (quickAddOpen) {
                    setQuickAddOpen(false);
                    return;
                  }
                  setQuickAddPosition(popoverPosition(event.currentTarget.getBoundingClientRect(), 256, 320));
                  setQuickAddOpen(true);
                }}
                className={`flex items-center gap-2 font-medium text-sm px-3 py-2.5 rounded-xl transition border ${
                  quickAddUser
                    ? 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-500 shadow-lg shadow-emerald-600/20'
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                <UserPlus className="w-4 h-4" />
                {quickAddUser ? (
                  <span className="max-w-[170px] truncate">Quick Add: {quickAddUser.name}</span>
                ) : (
                  'Quick Add'
                )}
                {quickAddUser && (
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label="Exit Quick Add mode"
                    onClick={(e) => {
                      e.stopPropagation();
                      setQuickAddUserId(null);
                      setQuickAddOpen(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation();
                        setQuickAddUserId(null);
                        setQuickAddOpen(false);
                      }
                    }}
                    className="p-0.5 rounded-md hover:bg-white/20"
                  >
                    <X className="w-3.5 h-3.5" />
                  </span>
                )}
                <ChevronDown className={`w-4 h-4 transition-transform ${quickAddOpen ? 'rotate-180' : ''}`} />
              </button>

              {quickAddOpen && quickAddPosition && renderInViewport(
                <div
                  ref={quickAddMenuRef}
                  className="fixed z-50 overflow-y-auto overscroll-contain bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl origin-top-right animate-popoverIn"
                  style={{
                    top: quickAddPosition.top,
                    left: quickAddPosition.left,
                    width: quickAddPosition.width,
                    maxHeight: quickAddPosition.maxHeight,
                  }}
                >
                  <p className="px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                    Pick a member, then click any empty slot on the calendar to assign them.
                  </p>
                  {quickAddGroups.length === 0 && (
                    <p className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">
                      No active, schedulable members found.
                    </p>
                  )}
                  {quickAddGroups.map((group) => (
                    <div key={group.key}>
                      <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                        {group.label}
                      </p>
                      {group.members.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => {
                            setQuickAddUserId(String(u.id));
                            setQuickAddOpen(false);
                            setError(null);
                          }}
                          className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition ${
                            String(quickAddUserId) === String(u.id)
                              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-medium'
                              : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60'
                          }`}
                        >
                          <span className="truncate">{u.name}</span>
                          {String(quickAddUserId) === String(u.id) && <Check className="w-4 h-4 ml-auto shrink-0" />}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={openAddForm}
              className="flex items-center gap-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white font-medium text-sm px-3 py-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition border border-slate-200 dark:border-slate-700"
            >
              <Plus className="w-4 h-4" />
              Add Shift
            </button>

            {/* Events switch, the same shared chip the calendars use - so it reads "Hide events" while the
                events are showing and "Show events" once they are hidden. Shown only when there is something
                to show, so a station that uses no events never sees a control for them. Not persisted. */}
            {events.length > 0 && (
              <ViewToggle
                noun="events"
                description="Non-shift entries such as trainings. Turn this off to see only the shifts."
                icon={Eye}
                enabled={showEvents}
                onChange={setShowEvents}
              />
            )}

            <button
              type="button"
              onClick={discard}
              disabled={!dirty || saving}
              className="flex items-center gap-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white font-medium text-sm px-3 py-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition disabled:opacity-40"
            >
              <RotateCcw className="w-4 h-4" />
              Discard
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saving}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm px-4 py-2.5 rounded-xl transition shadow-lg shadow-emerald-600/20 disabled:opacity-40"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save
            </button>
          </div>
        </div>
{(error || notice || showWindowError) && (
          <div
            className={`p-3 rounded-xl flex items-center gap-2 text-sm font-medium ${
              error || showWindowError
                ? 'bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80'
                : 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800/80'
            }`}
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{error || notice || scheduleWindowError}</span>
            <button
              type="button"
              onClick={() =>
                error
                  ? setError(null)
                  : notice
                    ? setNotice(null)
                    : setDismissedWindowError(scheduleWindowError)
              }
              className="opacity-60 hover:opacity-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* WHICH STATE THIS MONTH IS IN, when it looks empty. Three different things draw the same grid of empty slots,
            and the board could not tell them apart: nothing loaded for the month, loaded but matched to nothing, or
            genuinely nobody rostered. Saying which one it is turns "the schedule is empty" into a question with an
            answer - and both of the first two are real problems worth reporting, not normal states. */}
        {!monthPending && !showWindowError && monthHoldsNothing && visibleSlots.length > 0 && (
          <div className="p-3 rounded-xl flex items-start gap-2 text-sm font-medium bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1">
              No shifts are loaded for {monthLabel}. Your templates draw {visibleSlots.length} slot
              {visibleSlots.length === 1 ? '' : 's'} for the month, and not one of them carries a shift yet - press{' '}
              <strong>Refresh</strong> to read the month again.
            </span>
          </div>
        )}
        {!monthPending && !showWindowError && monthHoldsNothing && visibleSlots.length === 0 && (
          <div className="p-3 rounded-xl flex items-start gap-2 text-sm font-medium bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1">
              No shifts are loaded for {monthLabel}, and no template draws a slot on any of its days - so there is nothing
              for a shift to sit in. Check the templates&apos; days of the week and their effective and end dates in{' '}
              <strong>Schedule Templates</strong>.
            </span>
          </div>
        )}
        {/* {!monthPending && !showWindowError && unmatchedRows.length > 0 && (
          <div className="p-3 rounded-xl flex items-start gap-2 text-sm font-medium bg-slate-50 text-slate-800 border border-slate-200 dark:bg-slate-950/70 dark:text-slate-300 dark:border-slate-800">
            <InfoCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1">
              {unmatchedRows.length} of {working.length} shift{working.length === 1 ? '' : 's'} loaded for {monthLabel}{' '}
              {unmatchedRows.length === 1 ? 'is' : 'are'} not sitting in a slot:{' '}
              {unmatchedRows
                .slice(0, 3)
                .map((entry) => `${userName(entry.user_id)} \u00b7 ${entry._from || 'no date'}`)
                .join(', ')}
              {unmatchedRows.length > 3 ? `, and ${unmatchedRows.length - 3} more` : ''}.
            </span>
          </div>
        )} */}

        {/* Dismissible availability warnings - scheduling is still allowed */}
        {visibleUnavailable.length > 0 && (
          <div className="p-3 rounded-xl flex items-start gap-2 text-sm font-medium bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">{visibleUnavailable.length} scheduled shift{visibleUnavailable.length === 1 ? '' : 's'} on a day the member has marked no availability for:</p>
              <ul className="list-disc pl-4 mt-1 space-y-0.5 text-xs">
                {visibleUnavailable.slice(0, 5).map((u) => (
                  <li key={u._key}>
                    {userName(u.user_id)} — {assignmentById(u.assignment_id)?.description || 'No assignment'} · {u._from || '?'} (nothing marked available that day)
                  </li>
                ))}
                {visibleUnavailable.length > 5 && <li>…and {visibleUnavailable.length - 5} more.</li>}
              </ul>
              {/* <p className="text-xs mt-1">You can still save these shifts — availability is informational and doesn't block scheduling.</p> */}
            </div>
            <button
              type="button"
              onClick={() => {
                const s = new Set(warnedKeys);
                visibleUnavailable.forEach((u) => s.add(u._key));
                setWarnedKeys(s);
              }}
              aria-label="Dismiss"
              className="text-amber-700 dark:text-amber-400 hover:text-red-600 p-1 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* NO CLAIMS FOR THIS MONTH, so nothing is checked - and saying so is the difference between "checked and clear"
            and "not checked". Before this line the board answered the second with the first, which is how a month that had
            never been read produced a list of members who had "marked no availability". Only shown when there is a shift
            on the board that would otherwise have been judged. */}
        {!monthPending && !claimsMonthLoaded && working.length > 0 && (
          <div className="p-3 rounded-xl flex items-start gap-2 text-sm bg-slate-50 text-slate-600 border border-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:border-slate-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <p className="flex-1">
              Availability for {monthLabel} is not loaded, so these shifts are not checked against it.
            </p>
          </div>
        )}

        {/* Manual add form */}
        {addFormOpen && addForm && (
          <form onSubmit={submitAdd} className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 flex flex-wrap items-end gap-3">
            {!isCustomShift && (
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Date</label>
                <input
                  type="date"
                  required
                  value={addForm.date}
                  onChange={(e) => {
                    const date = e.target.value;
                    // Keep the chosen template only if it still runs on the new
                    // date's weekday; otherwise clear it so the picker isn't stale.
                    const stillValid =
                      !!addForm.schedule_template_id &&
                      templatesForDate(date).some((t) => String(t.id) === String(addForm.schedule_template_id));
                    setAddForm({
                      ...addForm,
                      date,
                      schedule_template_id: stillValid ? addForm.schedule_template_id : '',
                      user_id: '',
                    });
                  }}
                  className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
            )}
            <div className="min-w-[220px] flex-1">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Shift</label>
              <select
                required
                value={addForm.schedule_template_id}
                onChange={(e) => {
                  const value = e.target.value;
                  const template = templateById(value);
                  setAddForm((prev) => ({
                    ...prev,
                    schedule_template_id: value,
                    assignment_id: template ? '' : prev.assignment_id,
                    user_id: '',
                    // Switching to a custom shift seeds its window from the
                    // date already picked for the template search.
                    custom_start_date:
                      value === 'custom' ? (prev.custom_start_date || prev.date) : prev.custom_start_date,
                    custom_end_date:
                      value === 'custom' ? (prev.custom_end_date || prev.date) : prev.custom_end_date,
                  }));
                }}
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="">-- Select a shift --</option>
                {addTemplates.map((t) => (
                  <option key={t.id} value={String(t.id)}>{templateLabel(t)}</option>
                ))}
                <option value="custom">Custom Shift</option>
              </select>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                {isCustomShift
                  ? 'Custom Shift — set the exact start and end date & time, and pick the assignment.'
                  : addTemplates.length === 0
                    ? `No schedule templates on ${WEEKDAYS[new Date(`${addForm.date}T00:00:00`).getDay()]}s — pick a Custom Shift instead.`
                    : `${addTemplates.length} template${addTemplates.length === 1 ? '' : 's'} on this weekday.`}
              </p>
            </div>
            {isCustomShift && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Start Date</label>
                  <input
                    type="date"
                    required
                    value={addForm.custom_start_date}
                    onChange={(e) => {
                      const startDate = e.target.value;
                      setAddForm((prev) => ({
                        ...prev,
                        custom_start_date: startDate,
                        // The end can't precede the start; clamp it forward.
                        custom_end_date: prev.custom_end_date && prev.custom_end_date < startDate
                          ? startDate
                          : prev.custom_end_date,
                        user_id: '',
                      }));
                    }}
                    className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Start Time</label>
                  <input
                    type="time"
                    required
                    value={addForm.custom_start_time}
                    onChange={(e) => setAddForm((prev) => ({ ...prev, custom_start_time: e.target.value }))}
                    className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">End Date</label>
                  <input
                    type="date"
                    required
                    min={addForm.custom_start_date || undefined}
                    value={addForm.custom_end_date}
                    onChange={(e) => setAddForm((prev) => ({ ...prev, custom_end_date: e.target.value }))}
                    className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">End Time</label>
                  <input
                    type="time"
                    required
                    value={addForm.custom_end_time}
                    onChange={(e) => setAddForm((prev) => ({ ...prev, custom_end_time: e.target.value }))}
                    className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div className="min-w-[180px] flex-1">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Assignment</label>
                  <select
                    required
                    value={addForm.assignment_id}
                    onChange={(e) => setAddForm({ ...addForm, assignment_id: e.target.value, user_id: '' })}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    <option value="">-- Select --</option>
                    {/* Underlying `<option>` list is `assignmentsForAddForm`, which excludes assignments
                        that are outside their own effective window - a retired assignment must not be
                        offered for a new shift. */}
                    {assignmentsForAddForm().map((a) => (
                      <option key={a.id} value={String(a.id)}>{a.description}</option>
                    ))}
                  </select>
                </div>
              </>
            )}
            <div className="min-w-[180px] flex-1">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Member{addForm.user_id ? (addAssignmentId ? ` (${addEligibility.eligible.length} eligible)` : '') : ' (optional)'}
              </label>
              <select
                value={addForm.user_id}
                onChange={(e) => setAddForm({ ...addForm, user_id: e.target.value })}
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="">-- Select --</option>
                {addEligibility.eligible.map((u) => (
                  <option key={u.id} value={String(u.id)}>{u.name}</option>
                ))}
                {addEligibility.rankBlocked.length + addEligibility.unverifiable.length + addEligibility.excluded.length + addEligibility.inactive.length > 0 && (
                  <optgroup label="Other members (not schedulable)">
                    {addEligibility.rankBlocked.map((u) => (
                      <option key={u.id} value={String(u.id)}>{u.name} — rank doesn't qualify</option>
                    ))}
                    {addEligibility.unverifiable.map((u) => (
                      <option key={u.id} value={String(u.id)}>{u.name} — rank can't be verified (missing rank_order)</option>
                    ))}
                    {addEligibility.excluded.map((u) => (
                      <option key={u.id} value={String(u.id)}>{u.name} — excluded from scheduling</option>
                    ))}
                    {addEligibility.inactive.map((u) => (
                      <option key={u.id} value={String(u.id)}>{u.name} — inactive</option>
                    ))}
                  </optgroup>
                )}
              </select>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                {!addForm.user_id
                  ? 'Leave blank to create this shift as Open — members can then offer to fill it.'
                  : addAssignmentId
                    ? `${addEligibility.eligible.length} eligible · ${addEligibility.rankBlocked.length} lower rank · ${addEligibility.unverifiable.length} unverified · ${addEligibility.excluded.length} excluded · ${addEligibility.inactive.length} inactive`
                    : 'Pick a shift (or custom assignment) to populate the member list.'}
              </p>
              {addAssignmentId && (
                <p className="text-[11px] mt-1 text-slate-500 dark:text-slate-400">
                  Minimum rank:{' '}
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                                         {addEligibility.requiredOrder !== null ? `${addEligibility.requiredOrder}` : 'Any rank'}
                  </span>
                  {addEligibility.unverifiable.length > 0 && (
                    <span className="text-amber-600 dark:text-amber-400">
                      {' '}— {addEligibility.unverifiable.length} member(s) have no rank order set, so their eligibility can't be verified.
                    </span>
                  )}
                </p>
              )}
            </div>
            <button type="submit" className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-4 py-2 rounded-xl transition">
              <Plus className="w-4 h-4" /> Add
            </button>
            <button type="button" onClick={() => { setAddFormOpen(false); setAddForm(null); }} className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white text-sm px-3 py-2">
              Cancel
            </button>
            <p className="w-full text-[11px] text-slate-500 dark:text-slate-400">
              {addForm.schedule_template_id
                ? (addTemplate
                    ? 'Files under this schedule template for the selected date.'
                    : 'Saved as a custom shift with the exact date & time window you set.')
                : 'Pick a shift to enable the member list.'}
            </p>
          </form>
        )}
        {/* Inline member picker (click a pill or an open slot in the calendar) */}
        {popover && (() => {
          const isEntry = popover.kind === 'entry';
          const isSlotOffer = popover.kind === 'slot-offer';
          const entry = isEntry ? working.find((r) => r._key === popover.key) : null;
          if (isEntry && !entry) return null;

          // Slot-offer popover: show the pending offer(s) with approve/decline.
          if (isSlotOffer) {
            const slot = popover.slot;
            const slotOffer = popover.pending[0];
            const offerUser = slotOffer ? userById(slotOffer.user_id) : null;
            // THE BODY IS THE SAME IN BOTH FRAMES - what the panel says about the offer, and the two buttons - so it is
            // built once here and handed to whichever frame is in use. Only the frame, the header and where it sits
            // differ; see components/ScheduleAssignmentModal for why a day view gets a dialog.
            const offerBody = (
              <>
                <div className="p-3 space-y-2">
                  <div className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-500" />
                    <div>
                      <p className="font-medium">Approve</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Fill the shift with {offerUser ? offerUser.name : 'that member'} and close any other pending offers for this shift.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <XCircle className="w-4 h-4 mt-0.5 shrink-0 text-rose-500" />
                    <div>
                      <p className="font-medium">Decline</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Turn down the offer. The member cannot offer for this shift again — assign it to them directly if you change your mind.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 border-t border-slate-200 dark:border-slate-700 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => resolveOffer(slotOffer?.id ?? '', 'APPROVE')}
                    disabled={saving}
                    className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-300 text-white font-medium text-sm px-4 py-2 rounded-xl transition"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {saving ? 'Resolving…' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    onClick={() => resolveOffer(slotOffer?.id ?? '', 'DECLINE')}
                    disabled={saving}
                    className="flex-1 flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-500 disabled:bg-rose-300 text-white font-medium text-sm px-4 py-2 rounded-xl transition"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                    {saving ? 'Resolving…' : 'Decline'}
                  </button>
                </div>
              </>
            );

            // THE FRAME IS THE VIEW'S: the same panel in a modal on a narrow screen, and hanging off the pill on a wide one.
            // The tone is passed because the popover's amber frame is what marks a pending offer as an offer.
            if (dayView) {
              return (
                <ScheduleAssignmentModal
                  title="Pending approval"
                  subtitle={`${offerUser ? offerUser.name : unnamedLabel('member')} · ${slotLabelText(slot)}`}
                  tone="offer"
                  onClose={closePopover}
                >
                  {offerBody}
                </ScheduleAssignmentModal>
              );
            }

            // Both popovers below are `fixed` and positioned from the trigger's getBoundingClientRect, i.e. in
            // VIEWPORT coordinates - so they are handed to document.body, which is what position:fixed has
            // always meant (see utils/viewportLayer). Otherwise a transformed or clipping ancestor anywhere
            // above them decides where they land, and the page transition puts a transform on exactly that
            // ancestor.
            return renderInViewport(
              <>
                <div className="fixed inset-0 z-40" onClick={closePopover} />
                <div
                  className="fixed z-50 max-w-[calc(100vw-16px)] overflow-y-auto overscroll-contain bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 rounded-xl shadow-2xl origin-top animate-popoverIn"
                  style={{ top: popover.top, left: popover.left, width: popover.width, maxHeight: popover.maxHeight }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-start gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        Pending approval
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {offerUser ? offerUser.name : unnamedLabel('member')} ·{' '}
                        {slotLabelText(slot)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={closePopover}
                      aria-label="Close"
                      className="p-1 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {offerBody}
                </div>
              </>
            );
          }

          const assignmentId = isEntry ? entry.assignment_id : popover.slot.template.assignment_id;
          const assignment = assignmentById(assignmentId);
          const elig = eligibilityFor(assignment);
          const currentUserId = isEntry ? entry.user_id : '';
          const currentUser = String(currentUserId ?? '') === '' ? null : userById(currentUserId);

          const options = [
            ...elig.eligible.map((u) => ({ u, note: '' })),
            ...elig.rankBlocked.map((u) => ({ u, note: "rank doesn't qualify" })),
            ...elig.unverifiable.map((u) => ({ u, note: "rank can't be verified" })),
            ...elig.excluded.map((u) => ({ u, note: 'excluded from scheduling' })),
            ...elig.inactive.map((u) => ({ u, note: 'inactive' })),
          ];
          if (currentUser && !options.some((o) => String(o.u.id) === String(currentUser.id))) {
            options.unshift({ u: currentUser, note: '' });
          }

          const title = isEntry ? occupantLabel(entry, entryTemplate(entry)) : `${displayDate(popover.slot.dateKey)} · open slot`;
          // Whether the row exists because a schedule template defines it. A row
          // with no (or no longer existing) template IS the shift, so it can be
          // deleted outright; a template slot cannot.
          const isTemplateBacked = isEntry && Boolean(entryTemplate(entry));
          const entryDateText = !entry?._from
            ? ''
            : entry._from === entry._to
              ? displayDate(entry._from)
              : `${entry._from} → ${entry._to}`;
          const subtitle = isEntry
            ? [
                assignment?.description || 'No assignment',
                entryTimeRangeOf(entry),
                entryDateText,
              ].filter(Boolean).join(' · ')
            : slotLabelText(popover.slot);

          const memberPickerBody = (
            <>
              <div>
                {options.map(({ u, note }) => {
                  const selected = isEntry && String(u.id) === String(currentUserId);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => assignUser(u.id)}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition ${
                        selected
                          ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 font-medium'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60'
                      }`}
                    >
                      <span className="truncate">{u.name}</span>
                      {note && <span className="text-[10px] shrink-0 text-amber-600 dark:text-amber-400">— {note}</span>}
                      {selected && <Check className="w-4 h-4 ml-auto shrink-0" />}
                    </button>
                  );
                })}
                {options.length === 0 && (
                  <p className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">No members available.</p>
                )}
              </div>

              {/* A shift with someone on it can have that person taken off:
                  "Remove from shift" now clears the MEMBER and leaves the shift
                  OPEN, rather than deleting the row. */}
              {isEntry && String(entry.user_id ?? '').trim() !== '' && (
                <button
                  type="button"
                  onClick={() => unassignEntry(entry._key)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 border-t border-slate-200 dark:border-slate-700"
                >
                  <UserMinus className="w-4 h-4" /> Remove from shift
                  <span className="ml-auto text-[10px] font-normal text-slate-500 dark:text-slate-400">
                    leaves it Open
                  </span>
                </button>
              )}

              {/* Deleting the row is only meaningful for a shift the row defines
                  itself - a custom (non-template) shift, or one whose template
                  was deleted. For a template slot the shift exists because the
                  template says so, so an empty slot is already the "deleted"
                  state and there is nothing to remove. */}
              {isEntry && !isTemplateBacked && (
                <button
                  type="button"
                  onClick={() => removeEntry(entry._key)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 border-t border-slate-200 dark:border-slate-700"
                >
                  <Trash2 className="w-4 h-4" /> Delete Shift
                </button>
              )}
            </>
          );

          // THE FRAME IS THE VIEW'S, exactly as the offer panel above: a day view gets the dialog, a wide screen keeps the
          // menu hanging off the pill it was opened from. The list and its actions are ONE definition - `title` and
          // `subtitle` are computed once, above - so the two frames cannot offer different things.
          //
          // The inner cap on the list's height is the POPOVER's (`maxHeight`, sized for a panel anchored to a pill); the
          // dialog lets its own frame scroll instead, which is why the body is capped in dvh there.
          if (dayView) {
            return (
              <ScheduleAssignmentModal title={title} subtitle={subtitle} onClose={closePopover}>
                {memberPickerBody}
              </ScheduleAssignmentModal>
            );
          }

          return renderInViewport(
            <>
              <div className="fixed inset-0 z-40" onClick={closePopover} />
              <div
                className="fixed z-50 max-w-[calc(100vw-16px)] overflow-y-auto overscroll-contain bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl origin-top animate-popoverIn"
                style={{ top: popover.top, left: popover.left, width: popover.width, maxHeight: popover.maxHeight }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{title}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{subtitle}</p>
                  </div>
                  <button type="button" onClick={closePopover} aria-label="Close" className="p-1 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {memberPickerBody}
              </div>
            </>
          );
        })()}
      </div>

      {/* THE MONTH ON A WIDE SCREEN, ONE DAY OF IT ON A NARROW ONE.

          The unit changes, the DATA does not: the month is read and grouped exactly as before (visibleSlots, pillsByDay
          and eventSegmentsByDate are all per-MONTH), and the day view simply draws one of those groups in full width.
          That is why widening the window never costs a read - everything the day needs is already in hand - and why
          walking to another day inside the month asks the reader for nothing either.

          The weekday header is the calendar's, so it goes with the calendar: the day view's single cell names its own
          weekday and date instead, which is more useful than a row of seven abbreviations over one column. */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        {!dayView && (
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 grid grid-cols-7 gap-1">
            {weekdayLabels().map((d) => (
              <div key={d} className="text-center text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                {d}
              </div>
            ))}
          </div>
        )}

        {/* ONE COLUMN IN THE DAY VIEW, two when the span is two days, seven equal ones in the calendar. The
            `p-2` padding is shared by all three so the cells sit the same way whichever shape is on screen.

            `gridClass` AND `onAnimationEnd` GO HERE, on the grid and not on the card: the card holds still while the
            days leave through one edge and arrive from the other, which is the whole shape of the slide. The weekday
            header above stays put for the same reason it does in the member's calendar - only the days travel. */}
        <div
          className={`${dayView ? (spanDates.length > 1 ? 'p-2 grid grid-cols-2 gap-1' : 'p-2') : 'p-2 grid grid-cols-7 gap-1'} ${gridClass}`}
          onAnimationEnd={onAnimationEnd}
        >
          {daysOnBoard.map((day, i) => {
            const isWeekStart = !dayView && i % 7 === 0;
            const weekNumber = Math.floor(i / 7) + 1;
            const weekHeader = isWeekStart ? (
              <div
                key={`week-header-${weekNumber}`}
                className={`col-span-full text-left text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 px-1 ${
                  weekNumber > 1 ? 'pt-3 pb-1 border-t border-slate-200 dark:border-slate-700/60 mt-1' : 'pt-1 pb-1'
                }`}
              >
                Week {weekNumber}
              </div>
            ) : null;

            if (!day) {
              return (
                <React.Fragment key={`blank-${i}`}>
                  {weekHeader}
                  <div className="min-h-[124px] rounded-lg bg-slate-50/50 dark:bg-slate-900/40" />
                </React.Fragment>
              );
            }
            const dateKey = toDateKey(day);
            // THE SHAPE THIS CELL IS DRAWN IN. In the day view one day fills the card, so the cell is tall and its
            // pills carry two lines of facts (see pillBody); in the calendar it is one of thirty-five and holds only
            // what fits.
            const roomy = dayView;
            const isToday = dateKey === todayKey;
            const isPast = dateKey < todayKey;
            const daySlots = (slotsByDay[dateKey] || []).slice().sort((a, b) => a.startMin - b.startMin);
            const dayPills = pillsByDay[dateKey] || [];
            const slotEntryKeys = new Set(
              daySlots.map((s) => slotOccupant(s)?._key).filter(Boolean)
            );
            // Entries covering this day that aren't tied to one of the day's
            // template slots (e.g. manual shifts with no matching template)
            const extraPills = dayPills.filter((e) => !slotEntryKeys.has(e._key));

            // ...AND THEY ARE PART OF THE DAY'S ORDER, NOT A LIST UNDER IT.
            //
            // These two used to be drawn as two separate blocks: the merged day (slots, ordered by start time, with
            // events among them) and then every entry without a slot, in whatever order the rows arrived. A CUSTOM
            // SHIFT is the common case here - it has no template, so it is never a slot - and it carries real times of
            // its own, so drawing it after the day's shifts put an 08:00 custom shift BELOW an evening one on the
            // same day. The cell reads top to bottom in the order the day happens, so a shift that has a start time
            // belongs among the shifts that start around it.
            //
            // Each is given the minute its own template-or-row says (entryStartMinute above) and joined to the slots
            // as one shift-like list, so mergeDayItems orders them together with the events. `entry` is the marker the
            // render branches on; a row with no readable start keeps null and sorts last, which is the right answer
            // for a shift whose template AND times are both gone.
            const dayRows = [
              ...daySlots,
              ...extraPills.map((entry) => ({
                entry,
                startMin: entryStartMinute(entry),
                endMin: entryEndMinute(entry),
              })),
            ];
            const dayItems = separateShiftTimeBlocks(
              mergeDayItems(dayRows, eventSegmentsByDate.get(dateKey) || [])
            );

            return (
              <React.Fragment key={dateKey}>
                {weekHeader}
                <div
                  // A drop anywhere in the day is answered, even where there is no slot under the pointer: the cell
                // is the last surface a pill can land on, and saying nothing there is what made the board look
                // broken. See handleDayDrop.
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDayDrop(e, dateKey)}
                // THE HEIGHT IS THE VIEW'S, and it is the whole reason the day view exists on a phone: 124px is what a
                // month cell can afford, and one day gets the window. The calendar's string is kept contiguous and
                // unchanged on purpose - the server-rendered harness finds a day cell by it (verify-admin-render).
                className={`${roomy ? 'min-h-[60vh]' : 'min-h-[124px]'} rounded-lg border p-1.5 flex flex-col gap-1 ${
                  isToday
                    ? 'border-red-300 dark:border-red-800 bg-red-50/30 dark:bg-red-950/20'
                    : 'bg-slate-50 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700/40'
                }`}
              >
                {/* The date, which the day view has to state in full: the weekday header above it belongs to the
                    calendar, so on its own the cell would be a bare day number with no weekday or month anywhere. */}
                <div className={`leading-none font-semibold ${roomy ? 'text-xs' : 'text-[10px]'} ${isToday ? 'text-red-600' : 'text-slate-500 dark:text-slate-400'}`}>
                  {roomy
                    ? day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
                    : day.getDate()}
                </div>

                {/* Chronological, with the day's events placed among its shifts rather than above them all - see
                    utils/dayOrder. Events stay plain divs, so they carry none of the board's selection or drag
                    behavior; only their position changes. */}

                {dayItems.map(({ kind, value, separatorBefore }) => {
                  if (kind === 'event') {
                    const segment = value;
                    return (
                      <EventPill
                        key={`event-${segment.eventId}-${segment.dateKey}`}
                        segment={segment}
                        timeFormat={timeFormat}
                      />
                    );
                  }

                  // A ROW WITH NO SLOT BEHIND IT - the custom-shift case. It came in through `dayRows` above so it
                  // sorts in the order the day happens, but it is drawn here rather than by the slot branch below,
                  // which needs a template this row does not have.
                  if (value.entry) {
                    const e = value.entry;
                    // Same rule as the occupant branch below: an unfilled row is a
                    // vacancy, so it is drawn like an empty slot rather than a
                    // color-filled shift.
                    const vacant = String(e.user_id ?? '').trim() === '';
                    // A row that still points at a template borrows that template's
                    // nickname; a custom shift has none, so it shows its own times.
                    const pillTime = shiftTimeLabel(entryTemplate(e), entryTimeRangeOf(e));
                    return (
                      <React.Fragment key={`custom-${e._key}`}>
                        {separatorBefore && (
                          <div aria-hidden="true" className="mx-1 my-1.5 h-px shrink-0 bg-slate-300 dark:bg-slate-600" />
                        )}
                        <div
                          draggable={!isOccurred(e)}
                          // Same reason as the shift pill below: a past event is not draggable but is still clickable.
                          data-sound="click"
                          onDragStart={(e2) => handlePillDragStart(e2, e, dateKey)}
                          onDragEnd={handleDragEndPill}
                          onClick={(ev) => openEntryPopover(ev, e)}
                          // A custom shift accepts the drag so it can say why it will not take it: it is not a board
                          // slot, so there is no slot for the moved shift to adopt.
                          onDragOver={(e2) => e2.preventDefault()}
                          onDrop={(e2) => handlePillDrop(e2, e)}
                          title={`${occupantLabel(e, entryTemplate(e))} · ${assignmentById(e.assignment_id)?.description || 'No assignment'}${entryTimeRangeOf(e) ? ` · ${entryTimeRangeOf(e)}` : ''}${isOccurred(e) ? ' (past — locked)' : vacant ? ' — click to assign a member' : ' — click to change member'}`}
                          className={`${pillShapeClass(vacant, roomy)} cursor-grab active:cursor-grabbing ${
                            isOccurred(e) ? 'opacity-40 saturate-50' : ''
                          } ${selectedKey === e._key ? 'ring-2 ring-slate-900 dark:ring-white ring-offset-1 ring-offset-transparent' : ''}`}
                          style={vacant ? undefined : { backgroundColor: assignmentColor(e.assignment_id, assignments) }}
                        >
                          {pillBody({
                            label: occupantLabel(e, entryTemplate(e)),
                            icon: assignmentIcon(e.assignment_id),
                            memberId: e.user_id,
                            user: occupantUser(e),
                            time: pillTime,
                            roomy,
                          })}
                        </div>
                      </React.Fragment>
                    );
                  }

                  // displayOccupant, not slotOccupant: with a swap being offered the two rows are drawn in each
                  // other's places. See the hold-to-swap block above.
                  const slot = value;
                  const occupant = displayOccupant(slot);
                  if (occupant) {
                    const occurred = isOccurred(occupant);
                    // An unfilled row is a VACANCY, so it borrows the empty slot's
                    // look instead of the solid color fill a staffed shift uses.
                    const vacant = String(occupant.user_id ?? '').trim() === '';
                    // The hold-to-swap feedback: blinking while the timer runs, and a quick pop once the two
                    // shifts have changed places (or changed back). Both live in index.css.
                    const dwelling = swapDwell?.slotKey === slot.slotKey;
                    // The pop runs while the two rows are shown exchanged, and again (briefly) as they go back.
                    const exchanged =
                      (!!swapPreview && (swapPreview.aKey === occupant._key || swapPreview.bKey === occupant._key)) ||
                      (!!swapRevert && (swapRevert.aKey === occupant._key || swapRevert.bKey === occupant._key));
                    // The slot's template names the shift; the tooltip below still
                    // spells out the window.
                    const pillTime = shiftTimeLabel(slot.template, timeRangeOf(slot.template));
                    return (
                      <React.Fragment key={`slot-${slot.slotKey}`}>
                        {separatorBefore && (
                          <div aria-hidden="true" className="mx-1 my-1.5 h-px shrink-0 bg-slate-300 dark:bg-slate-600" />
                        )}
                        <div
                        draggable={!occurred}
                        // data-sound because a pill is a div, and once a shift has occurred it is no longer
                        // draggable - without this, clicking a locked pill would be the one silent control on the
                        // board. See utils/uiSounds.
                        data-sound="click"
                        onDragStart={(e) => handlePillDragStart(e, occupant, dateKey)}
                        onDragEnd={handleDragEndPill}
                        onClick={(e) => openEntryPopover(e, occupant)}
                        // A pill is a drop target as well as a drag source. Without these three a pill accepted
                        // no drops at all - silently, which is why an OPEN shift (a vacancy row) could never take
                        // a dragged shift while a genuinely empty slot beside it could. The refusal is explained
                        // in handleSlotDrop, and the occupant it needs is looked up from the rows, not passed in
                        // from what this render happens to be drawing.
                        onDragOver={(e) => handleSlotDragOver(e, slot)}
                        onDragLeave={(e) => handleSlotDragLeave(e, slot)}
                        onDrop={(e) => handleSlotDrop(e, slot)}
                        title={`${occupantLabel(occupant, slot.template)} · ${timeRangeOf(slot.template)}${
                          occurred
                            ? ' (past — locked)'
                            : dwelling
                              ? ' — hold to swap these two shifts'
                              : vacant
                                ? ' — click to assign a member'
                                : ' — click to change member, or hold to swap'
                        }`}
                        className={`${pillShapeClass(vacant, roomy)} cursor-grab active:cursor-grabbing transition ${
                          occurred ? 'opacity-40 saturate-50' : ''
                        } ${dwelling ? 'animate-swapDwell' : ''} ${exchanged ? 'animate-swapPop' : ''} ${
                          selectedKey === occupant._key ? 'ring-2 ring-slate-900 dark:ring-white ring-offset-1 ring-offset-transparent' : ''
                        }`}
                        style={vacant ? undefined : { backgroundColor: assignmentColor(occupant.assignment_id, assignments) }}
                      >
                        {pillBody({
                          label: occupantLabel(occupant, slot.template),
                          icon: assignmentIcon(occupant.assignment_id),
                          memberId: occupant.user_id,
                          user: occupantUser(occupant),
                          time: pillTime,
                          roomy,
                        })}
                        </div>
                      </React.Fragment>
                    );
                  }

                  const droppable = !isPast;
                  const slotPending = pendingOffersForSlot(slot);
                  return (
                    <React.Fragment key={`open-slot-${slot.slotKey}`}>
                    {separatorBefore && (
                      <div aria-hidden="true" className="mx-1 my-1.5 h-px shrink-0 bg-slate-300 dark:bg-slate-600" />
                    )}
                    <div
                      // An empty slot is a control - it opens the assignment popover, or takes a quick-add -
                      // and a div with no role is invisible to the click selector. See utils/uiSounds.
                      data-sound="click"
                      onClick={droppable ? (e) => (quickAddUser ? quickAssignToSlot(slot) : openSlotPopover(e, slot)) : undefined}
                      title={
                        isPast
                          ? 'Past shift — locked'
                          : slotPending.length
                            ? `Pending approval — ${slotPending.length} member(s) offered to fill this shift`
                            : quickAddUser
                              ? `Assign ${quickAddUser.name} to ${slotLabelText(slot)}`
                              : `Assign a member to ${slotLabelText(slot)}`
                      }
                      onDragOver={(e) => handleSlotDragOver(e, slot)}
                      onDragLeave={(e) => handleSlotDragLeave(e, slot)}
                      onDrop={(e) => handleSlotDrop(e, slot)}
                      className={`${emptySlotShapeClass(roomy)} ${
                        hoverSlot === slot.slotKey
                          ? 'bg-red-100 dark:bg-red-900/40 border-red-400 ring-1 ring-red-400 text-red-700 dark:text-red-300'
                          : 'border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-500'
                      } ${
                        isPast
                          ? 'opacity-40'
                          : quickAddUser
                            ? 'cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/60 dark:hover:bg-emerald-950/30 hover:text-emerald-600 dark:hover:text-emerald-400'
                            : 'cursor-pointer hover:border-red-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50/60 dark:hover:bg-red-950/30'
                      }`}
                    >
                      {/* A vacancy has NO MEMBER, so this passes no `memberId` and no `user` - which is what keeps a
                          rank dot and a certification badge off the assignment's name. It is the same call a filled
                          pill makes, with the facts a vacant slot actually has.
                          
                          AND NO `time`, which is worth saying because passing one is the obvious mistake: the
                          empty slot's LABEL is already the window and the assignment joined (`slotLabelText`, shared
                          with the popover and the tooltips), so handing the body the window as well drew it twice -
                          the window joined to itself after the assignment name, in the calendar and again on two lines
                          in the day view. The month view has to stay exactly as it was, and the day view gets the window
                          from the same place. Found by reading the rendered markup, which is why the harness now counts. */}
                      {pillBody({
                        label: slotLabelText(slot),
                        icon: assignmentIcon(slot.template.assignment_id),
                        pending: slotPending.length > 0,
                        labelClassName: slotPending.length ? 'text-amber-700 dark:text-amber-300 font-semibold' : '',
                        roomy,
                      })}
                    </div>
                    </React.Fragment>
                  );
                })}
              </div>
            </React.Fragment>
          );
        })}
        </div>
      </div>

      {/* The month, to pick a day from. Mounted only while it is open, so the board behind it is untouched and there is
          no state to reset. `viewDate` is what it opens on, so the day being managed is marked in it rather than being a
          month the officer has to find again. */}
      {pickerOpen && (
        <MonthPickerModal
          viewDate={viewDate}
          selectedKey={toDateKey(viewDate)}
          todayKey={todayKey}
          onPick={chooseDay}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {/* Printer-friendly month. Rendered from the SAVED schedule rather than the in-memory draft, so a
          printout always matches the record; the button says so when there are unsaved changes. */}
      {printOpen && (
        <PrintableSchedule
          mode="admin"
          departmentName={departmentName}
          year={year}
          month={month}
          // THE SAVED ROWS THIS BOARD HOLDS for the month on screen (`base`), not the shared array: the sheet prints the
          // month being managed, and the board no longer draws from a cache that may not hold it.
          schedule={base}
          scheduleTemplates={scheduleTemplates}
          assignments={assignments}
          users={users}
          ranks={ranks}
          // Events print on every mode, so the board's sheet shows the month as a whole.
          events={events}
          onDone={() => setPrintOpen(false)}
        />
      )}
    </div>
  );
}