import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  AlertCircle, Check, ChevronDown, ChevronLeft, ChevronRight,
    Loader2, Plus, RotateCcw, Save, Trash2, UserPlus, UserMinus, X, CheckCircle2, XCircle, Printer, Eye
} from 'lucide-react';
import { adminBulkSaveSchedule, adminResolveShiftOffer } from '../../services/api';
import { toDateKey, parseSheetDateKey } from '../../utils/scheduleDate';
import { isShiftDay } from '../../utils/shiftPlacement';
import { templateIsActiveOn } from '../../utils/scheduleTemplates';
import { assignmentIsActiveOn, choosableAssignments } from '../../utils/assignmentDates';
import { assignmentColor } from '../../utils/assignmentColor';
import { toTimeInputValue } from '../../utils/timeInputValue';
import { shiftTimeLabel } from '../../utils/shiftTime';
import RankIcon from '../RankIcon';
import EventPill from '../EventPill';
import ViewToggle from '../ViewToggle';
import { eventSegmentsByDay, normalizeEventList } from '../../utils/events';
import { isAvailableForSlot } from '../../utils/availability';
import { planShiftDrop, planShiftSwap, swapSlotFields, SWAP_DWELL_MS, SWAP_POP_MS, DROP_NOTICES } from '../../utils/scheduleDrop';
// The app-wide toast wrapper, so a refused drop is explained and sounds like the other errors (utils/toast).
import { toast } from '../../utils/toast';
import {
  eligibilityFor as classifyEligibility,
  isTruthyFlag,
  parseRankOrder,
  rankLabel,
} from '../../utils/rankEligibility';
import { WEEKDAYS, MONTHS, DAY_ORDER } from '../../utils/calendarConstants';
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

// Pill shapes for the calendar. A STAFFED shift is a solid, color-filled pill; an
// UNFILLED one is drawn like an empty template slot - thin muted border, muted
// text, no fill - so a vacancy never reads as a staffed shift at a glance.
const FILLED_PILL_CLASS = 'rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white truncate';
const VACANT_PILL_CLASS =
  'rounded-full px-1.5 py-0.5 text-[10px] font-semibold truncate border border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-500';
const fieldsOf = (r) => ({
  id: r.id || '',
  schedule_template_id: r.schedule_template_id || '',
  date_from: r.date_from || '',
  date_to: r.date_to || '',
  start_time: r.start_time || '',
  end_time: r.end_time || '',
  apparatus_id: r.apparatus_id || '',
  assignment_id: r.assignment_id || '',
  user_id: r.user_id || '',
});

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
  schedule = [],
  scheduleTemplates = [],
  assignments = [],
  ranks = [],
  users = [],
  availability = [],
  offers = [],
  onOffersChanged,
  onAdminDataChanged,
  // Non-shift calendar entries. The board's audience is EVERYONE, because it draws the whole crew's month -
  // an event targeted at one rank still belongs on the board an administrator is building from.
  events = [],
  timeFormat = '12',
  // Used only on the printed sheet's header.
  departmentName = '',
}) {
  const now = new Date();
  const [viewDate, setViewDate] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const [working, setWorking] = useState(() => normalizeRows(schedule));
  const [base, setBase] = useState(() => normalizeRows(schedule));
  const [dirty, setDirty] = useState(false);
  // Mirror of `dirty` for use inside effects without adding it to their deps:
  // a background data refresh must never clobber an in-flight draft.
  const dirtyRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // While a print is being prepared the sheet is mounted (see PrintableSchedule).
  const [printOpen, setPrintOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  const [addFormOpen, setAddFormOpen] = useState(false);
  const [addForm, setAddForm] = useState(null);
  const [selectedKey, setSelectedKey] = useState(null);
  // Inline member picker anchored to the pill/slot that was clicked in the
  // calendar (positioned with `fixed` so the card's overflow cannot clip it).
  const [popover, setPopover] = useState(null);
  const [dragKey, setDragKey] = useState(null);
  const [dragSourceDate, setDragSourceDate] = useState(null);
  const [hoverSlot, setHoverSlot] = useState(null);
  const [warnedKeys, setWarnedKeys] = useState(() => new Set());
  // Quick Add: pick a member once, then click empty slots on the calendar to
  // assign them directly (no per-slot member picker).
  const [quickAddUserId, setQuickAddUserId] = useState(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const quickAddRef = useRef(null);
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
  const todayKey = toDateKey(now);
  // Events are visible by default. Not persisted: a temporary view choice, like "Show everyone".
  const [showEvents, setShowEvents] = useState(true);
  const monthStartKey = toDateKey(new Date(year, month, 1));
  const monthEndKey = toDateKey(new Date(year, month + 1, 0));

  // Re-sync the working copy whenever fresh server data arrives - unless the
  // admin has unsaved changes, which take precedence over any refresh.
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    if (dirtyRef.current) return;
    const rows = normalizeRows(schedule);
    setWorking(rows);
    setBase(rows);
    setDirty(false);
    setSelectedKey(null);
  }, [schedule]);

  // Restore an unsaved draft (survives tab switches / refreshes).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const rows = JSON.parse(raw);
        if (Array.isArray(rows) && rows.length) {
          setWorking(rows);
          setDirty(true);
        }
      }
    } catch {
      /* corrupted draft - ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the draft while there are unsaved changes.
  useEffect(() => {
    try {
      if (dirty) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(working));
      else sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      /* storage unavailable - ignore */
    }
  }, [working, dirty]);

  const userById = (id) => users.find((u) => String(u.id) === String(id));
  const userName = (id) => userById(id)?.name || `#${id}`;
  const assignmentById = (id) => assignments.find((a) => String(a.id) === String(id));

  // What a pill calls the shift. A VACANCY (a row with no member) is labelled with the
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

  // Icon name configured for an assignment (Administration → Assignments). Blank means
  // "no icon", so callers render nothing rather than the fallback glyph.
  const assignmentIcon = (id) => String(assignmentById(id)?.icon ?? '').trim();

  // Eligibility classification for an assignment, sharing one implementation
  // with the Assignments admin tab so the counts always agree.
  //
  // RANK RULE (higher numeric rank_order = higher rank): a member can fill
  // shifts for their OWN rank and every LOWER rank, so an Officer (order 3) can
  // fill Firefighter (1), Driver (2), and Officer (3) shifts. See
  // `utils/rankEligibility.js`.
  const eligibilityFor = (assignment) => classifyEligibility({ users, ranks, assignment });

  const isOccurred = (entry) => Boolean(entry?._to && entry._to < todayKey);
  const coversDate = (entry, dateKey) =>
    Boolean(entry._from && entry._to && entry._from <= dateKey && dateKey <= entry._to);

  // Checks whether a member is available for a shift's time window on a
  // particular date (availability is a whitelist: no rows = not available).
  const entryTemplate = (entry) =>
    scheduleTemplates.find((t) => String(t.id) === String(entry.schedule_template_id ?? ''));

  // Time window shown for an entry: its template's, or (custom shifts) the
  // start/end times stored on the schedule row itself.
  const entryTimeRangeOf = (entry) => {
    const template = entryTemplate(entry);
    return template ? timeRangeOf(template) : rowTimeRangeOf(entry);
  };

  // Whether the member has marked themselves available for THIS shift on THIS date.
  //
  // Availability is now expressed per shift - the `availability` sheet mirrors the
  // schedule (member + template + date) - so this is a direct lookup rather than the old
  // weekday-window coverage test. A custom shift has no template, so there is no slot the
  // member could have marked; like every other missing piece of data, it stays silent.
  const entryIsAvailable = (entry) => {
    const user = userById(entry.user_id);
    if (!user) return true;
    const templateId = String(entry.schedule_template_id ?? '').trim();
    if (!templateId || !entry._from) return true;
    return isAvailableForSlot(availability, user.id, templateId, entry._from);
  };

  // Flags warnings on the visible month's pills that fall outside the member's
  // availability (the banner is dismissible; scheduling is still allowed).
  const unavailableEntries = working.filter(
    (e) =>
      !isOccurred(e) &&
      e._from &&
      e._to &&
      e._from <= monthEndKey &&
      e._to >= monthStartKey &&
      !entryIsAvailable(e)
  );
  const visibleUnavailable = unavailableEntries.filter((e) => !warnedKeys.has(e._key));

  // Template slots for the visible month: every date crossed with every
  // template whose day_of_week matches that date's weekday.
  const visibleSlots = useMemo(() => {
    const slots = [];
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = toDateKey(new Date(year, month, d));
      const dow = DAY_ORDER[new Date(year, month, d).getDay()];
      for (const t of scheduleTemplates) {
        if (String(t.day_of_week ?? '').trim().toLowerCase() !== dow) continue;
        // A retired or not-yet-effective template draws no slot (utils/scheduleTemplates), and neither
        // does one whose assignment is outside its own window (utils/assignmentDates).
        if (!templateIsActiveOn(t, dateKey)) continue;
        if (!assignmentIsActiveOn(assignmentById(t.assignment_id), dateKey)) continue;
        slots.push({
          slotKey: `slot-${dateKey}-${t.id}`,
          dateKey,
          template: t,
          startMin: timeToMinutes(t.start_time) ?? 0,
        });
      }
    }
    return slots;
  }, [year, month, scheduleTemplates]);

  const slotsByDay = useMemo(() => {
    const map = {};
    for (const s of visibleSlots) (map[s.dateKey] = map[s.dateKey] || []).push(s);
    return map;
  }, [visibleSlots]);

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

  const monthGrid = useMemo(() => {
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const arr = [];
    for (let i = 0; i < firstWeekday; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(new Date(year, month, d));
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [year, month]);

  // Non-shift entries for the visible month, grouped by day. Normalised defensively so a raw sheet row
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

  const slotOccupant = (slot) =>
    working.find(
      (r) =>
        String(r.schedule_template_id ?? '') === String(slot.template.id) &&
        coversDate(r, slot.dateKey)
    );

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
  const handleSlotDrop = (e, slot, occupant = null) => {
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
      targetOccupant: occupant || slotOccupant(slot),
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
  // It is also where the hold-to-swap starts counting: `occupant` is whoever is drawn in the slot, and holding
  // over a FILLED one is the only thing that arms the timer.
  const handleSlotDragOver = (e, slot, occupant = null) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    setHoverSlot(slot.slotKey);

    const entry = dragKeyRef.current ? working.find((r) => r._key === dragKeyRef.current) : null;
    if (!entry) return;
    // Back over the slot the drag started from, or over a free one: no swap to offer.
    if (!occupant || occupant._key === entry._key) {
      cancelSwapDwell();
      cancelSwapPreview();
      return;
    }
    beginSwapDwell(slot, occupant, entry);
  };

  const handleSlotDragLeave = (slot) => {
    setHoverSlot((cur) => (cur === slot.slotKey ? null : cur));
    // Moving out of the slot is the cancellation: stop counting, and stop showing the exchange.
    cancelSwapDwell();
    cancelSwapPreview();
  };


  // ---- Inline member picker (click a pill or an empty slot) ----

  const POPOVER_WIDTH = 300;
  const POPOVER_MAX_HEIGHT = 340;

  // Positions the popover next to the clicked element, flipping above/beside it
  // when there isn't room below.
  const popoverPosition = (rect) => {
    const margin = 8;
    let left = rect.left;
    if (left + POPOVER_WIDTH > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - POPOVER_WIDTH - margin);
    }
    let top = rect.bottom + 6;
    if (top + POPOVER_MAX_HEIGHT > window.innerHeight - margin) {
      const above = rect.top - POPOVER_MAX_HEIGHT - 6;
      top = above >= margin ? above : Math.max(margin, window.innerHeight - POPOVER_MAX_HEIGHT - margin);
    }
    return { top, left, width: POPOVER_WIDTH, maxHeight: POPOVER_MAX_HEIGHT };
  };

  const closePopover = () => {
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
      await onOffersChanged?.();
      // Also trigger a schedule refresh so approved/declined offers reflect immediately
      // in both the Schedule Management calendar and My Schedule pills.
      void onAdminDataChanged?.(token);
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
      if (quickAddRef.current && !quickAddRef.current.contains(e.target)) setQuickAddOpen(false);
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

  // Escape closes the inline picker (matching the menus elsewhere in the app).
  useEffect(() => {
    if (!popover) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') closePopover();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [popover]);

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

      // Refresh the server copy in the background; the local state is already
      // authoritative for everything that was just saved. Also trigger admin data refresh.
      onAdminDataChanged?.(token);
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

  // How many shifts the Quick-Add member already has scheduled in the visible
  // month (shows next to their name so you can keep the month balanced).
  const quickAddShiftCount = useMemo(
    () => (
      quickAddUser
        ? working.filter(
            (e) =>
              String(e.user_id) === String(quickAddUser.id) &&
              e._from &&
              e._to &&
              e._from <= monthEndKey &&
              e._to >= monthStartKey
          ).length
        : 0
    ),
    [quickAddUser, working, monthStartKey, monthEndKey]
  );


  // Active + schedulable members grouped by rank (highest rank_order first),
  // then alphabetically within each group. Members with no rank land in a
  // trailing "No rank" group; ranks with no members are omitted.
  const quickAddGroups = (() => {
    const pool = users.filter(
      (u) =>
        !isTruthyFlag(u.exclude_from_scheduling) &&
        String(u.status ?? '').trim().toLowerCase() === 'active'
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

  const goMonth = (delta) => setViewDate(new Date(year, month + delta, 1));
  const goToday = () => setViewDate(new Date(now.getFullYear(), now.getMonth(), 1));

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => goMonth(-1)} aria-label="Previous month" className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="min-w-[150px] text-center text-base font-semibold text-slate-900 dark:text-white">{monthLabel}</span>
            <button type="button" onClick={() => goMonth(1)} aria-label="Next month" className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700">
              <ChevronRight className="w-5 h-5" />
            </button>
            <button type="button" onClick={goToday} className="ml-1 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-red-600">
              Today
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
                onClick={() => setQuickAddOpen((o) => !o)}
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

              {quickAddOpen && (
                <div className="absolute right-0 z-50 mt-1 w-64 max-h-80 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl">
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
{(error || notice) && (
          <div
            className={`p-3 rounded-xl flex items-center gap-2 text-sm font-medium ${
              error
                ? 'bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80'
                : 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800/80'
            }`}
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{error || notice}</span>
            <button type="button" onClick={() => (error ? setError(null) : setNotice(null))} className="opacity-60 hover:opacity-100">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Dismissible availability warnings - scheduling is still allowed */}
        {visibleUnavailable.length > 0 && (
          <div className="p-3 rounded-xl flex items-start gap-2 text-sm font-medium bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">{visibleUnavailable.length} scheduled shift{visibleUnavailable.length === 1 ? '' : 's'} the member has not marked themselves available for:</p>
              <ul className="list-disc pl-4 mt-1 space-y-0.5 text-xs">
                {visibleUnavailable.slice(0, 5).map((u) => (
                  <li key={u._key}>
                    {userName(u.user_id)} — {assignmentById(u.assignment_id)?.description || 'No assignment'} · {u._from || '?'} (not marked available for this shift)
                  </li>
                ))}
                {visibleUnavailable.length > 5 && <li>…and {visibleUnavailable.length - 5} more.</li>}
              </ul>
              <p className="text-xs mt-1">You can still save these shifts — availability is informational and doesn't block scheduling.</p>
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
            return (
              <>
                <div className="fixed inset-0 z-40" onClick={closePopover} />
                <div
                  className="fixed z-50 bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 rounded-xl shadow-2xl overflow-hidden"
                  style={{ top: popover.top, left: popover.left, width: popover.width }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-start gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        Pending approval
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {offerUser ? offerUser.name : `#${slotOffer?.user_id}`} ·{' '}
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
                          Turn down the offer. The member can offer again.
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

          return (
            <>
              <div className="fixed inset-0 z-40" onClick={closePopover} />
              <div
                className="fixed z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl overflow-hidden"
                style={{ top: popover.top, left: popover.left, width: popover.width }}
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

                <div className="overflow-y-auto" style={{ maxHeight: popover.maxHeight }}>
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
              </div>
            </>
          );
        })()}
      </div>

      {/* Monthly calendar */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 grid grid-cols-7 gap-1">
          {WEEKDAYS.map((d) => (
            <div key={d} className="text-center text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">
              {d}
            </div>
          ))}
        </div>

        <div className="p-2 grid grid-cols-7 gap-1">
{monthGrid.map((day, i) => {
            if (!day) {
              return <div key={`blank-${i}`} className="min-h-[124px] rounded-lg bg-slate-50/50 dark:bg-slate-900/40" />;
            }
            const dateKey = toDateKey(day);
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

            return (
              <div
                key={dateKey}
                // A drop anywhere in the day is answered, even where there is no slot under the pointer: the cell
                // is the last surface a pill can land on, and saying nothing there is what made the board look
                // broken. See handleDayDrop.
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDayDrop(e, dateKey)}
                className={`min-h-[124px] rounded-lg border p-1.5 flex flex-col gap-1 ${
                  isToday
                    ? 'border-red-300 dark:border-red-800 bg-red-50/30 dark:bg-red-950/20'
                    : 'bg-slate-50 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700/40'
                }`}
              >
                <div className={`text-[10px] leading-none font-semibold ${isToday ? 'text-red-600' : 'text-slate-500 dark:text-slate-400'}`}>
                  {day.getDate()}
                </div>

                {/* Events above the shift pills: context for the day, never clickable and never mistaken for
                    a shift. Plain divs, so they carry none of the board's selection or drag behaviour. */}
                {(eventSegmentsByDate.get(dateKey) || []).map((segment) => (
                  <EventPill
                    key={`event-${segment.eventId}-${segment.dateKey}`}
                    segment={segment}
                    timeFormat={timeFormat}
                  />
                ))}

                {daySlots.map((slot) => {
                  // displayOccupant, not slotOccupant: with a swap being offered the two rows are drawn in each
                  // other's places. See the hold-to-swap block above.
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
                      <div
                        key={slot.slotKey}
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
                        // in handleSlotDrop.
                        onDragOver={(e) => handleSlotDragOver(e, slot, occupant)}
                        onDragLeave={() => handleSlotDragLeave(slot)}
                        onDrop={(e) => handleSlotDrop(e, slot, occupant)}
                        title={`${occupantLabel(occupant, slot.template)} · ${timeRangeOf(slot.template)}${
                          occurred
                            ? ' (past — locked)'
                            : dwelling
                              ? ' — hold to swap these two shifts'
                              : vacant
                                ? ' — click to assign a member'
                                : ' — click to change member, or hold to swap'
                        }`}
                        className={`${vacant ? VACANT_PILL_CLASS : FILLED_PILL_CLASS} cursor-grab active:cursor-grabbing transition ${
                          occurred ? 'opacity-40 saturate-50' : ''
                        } ${dwelling ? 'animate-swapDwell' : ''} ${exchanged ? 'animate-swapPop' : ''} ${
                          selectedKey === occupant._key ? 'ring-2 ring-slate-900 dark:ring-white ring-offset-1 ring-offset-transparent' : ''
                        }`}
                        style={vacant ? undefined : { backgroundColor: assignmentColor(occupant.assignment_id, assignments) }}
                      >
                        {/* Assignment icon, inheriting the pill's text color so an
                            arbitrary assignment color can't make it unreadable. */}
                        {assignmentIcon(occupant.assignment_id) && (
                          <RankIcon name={assignmentIcon(occupant.assignment_id)} className="inline-block w-2.5 h-2.5 mr-0.5 -mt-px align-[-1px]" />
                        )}
                        {occupantLabel(occupant, slot.template)}
                        {pillTime ? ` · ${pillTime}` : ''}
                      </div>
                    );
                  }

                  const droppable = !isPast;
                  const slotPending = pendingOffersForSlot(slot);
                  return (
                    <div
                      key={slot.slotKey}
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
                      onDragLeave={() => handleSlotDragLeave(slot)}
                      onDrop={(e) => handleSlotDrop(e, slot)}
                      className={`rounded-md border px-1 py-0.5 text-[10px] leading-tight truncate transition-colors relative ${
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
                      <div className="flex items-center gap-1">
                        {slotPending.length > 0 && (
                          <span className="inline-flex items-center justify-center w-3 h-3 rounded-full bg-amber-400 shrink-0" title="Pending approval" />
                        )}
                        {assignmentIcon(slot.template.assignment_id) && (
                          <RankIcon name={assignmentIcon(slot.template.assignment_id)} className="w-2.5 h-2.5 shrink-0" />
                        )}
                        <span className={slotPending.length ? 'text-amber-700 dark:text-amber-300 font-semibold' : ''}>
                          {slotLabelText(slot)}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {extraPills.map((e) => {
                  // Same rule as the occupant branch above: an unfilled row is a
                  // vacancy, so it is drawn like an empty slot rather than a
                  // color-filled shift.
                  const vacant = String(e.user_id ?? '').trim() === '';
                  // A row that still points at a template borrows that template's
                  // nickname; a custom shift has none, so it shows its own times.
                  const pillTime = shiftTimeLabel(entryTemplate(e), entryTimeRangeOf(e));
                  return (
                  <div
                    key={e._key}
                    draggable={!isOccurred(e)}
                    // Same reason as the shift pill above: a past event is not draggable but is still clickable.
                    data-sound="click"
                    onDragStart={(e2) => handlePillDragStart(e2, e, dateKey)}
                    onDragEnd={handleDragEndPill}
                    onClick={(ev) => openEntryPopover(ev, e)}
                    // A custom shift accepts the drag so it can say why it will not take it: it is not a board
                    // slot, so there is no slot for the moved shift to adopt.
                    onDragOver={(e2) => e2.preventDefault()}
                    onDrop={(e2) => handlePillDrop(e2, e)}
                    title={`${occupantLabel(e, entryTemplate(e))} · ${assignmentById(e.assignment_id)?.description || 'No assignment'}${entryTimeRangeOf(e) ? ` · ${entryTimeRangeOf(e)}` : ''}${isOccurred(e) ? ' (past — locked)' : vacant ? ' — click to assign a member' : ' — click to change member'}`}
                    className={`${vacant ? VACANT_PILL_CLASS : FILLED_PILL_CLASS} cursor-grab active:cursor-grabbing ${
                      isOccurred(e) ? 'opacity-40 saturate-50' : ''
                    } ${selectedKey === e._key ? 'ring-2 ring-slate-900 dark:ring-white ring-offset-1 ring-offset-transparent' : ''}`}
                    style={vacant ? undefined : { backgroundColor: assignmentColor(e.assignment_id, assignments) }}
                  >
                    {assignmentIcon(e.assignment_id) && (
                      <RankIcon name={assignmentIcon(e.assignment_id)} className="inline-block w-2.5 h-2.5 mr-0.5 -mt-px align-[-1px]" />
                    )}
                    {occupantLabel(e, entryTemplate(e))}
                    {pillTime ? ` · ${pillTime}` : ''}
                  </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Printer-friendly month. Rendered from the SAVED schedule rather than the in-memory draft, so a
          printout always matches the record; the button says so when there are unsaved changes. */}
      {printOpen && (
        <PrintableSchedule
          mode="admin"
          departmentName={departmentName}
          year={year}
          month={month}
          schedule={schedule}
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