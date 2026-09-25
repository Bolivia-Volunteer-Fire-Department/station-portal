// Printable schedule: the data behind the printed calendar sheet.
//
// Kept as pure functions so the printed output can be tested without a printer, a browser or a click.
//
// Three modes, matching what the screen draws in each state:
//
//   'member'  the member's own shifts, plus open shifts they could pick up
//   'crew'    everyone's shifts, named, plus open shifts the member could pick up
//   'admin'   everyone's shifts, named, plus every vacancy in the month
//
// 'member' and 'crew' mirror My Schedule with Show everyone off and on respectively, so the printed sheet
// and the screen agree about which shifts exist. 'admin' mirrors the Schedule Management board, where
// every vacancy matters because the reader is the one who fills them.
//
// The rules are the app's existing ones, reused rather than reimplemented: a shift is drawn on the day
// it STARTS (utils/shiftPlacement), a template or assignment outside its own effective window produces
// nothing (utils/scheduleTemplates, utils/assignmentDates), a vacancy is offered only to a rank that
// could fill it (utils/rankEligibility), and a shift's label prefers the template's nickname over its
// times (utils/shiftTime).

import { parseSheetDateKey, toDateKey } from './scheduleDate';
import { MONTHS } from './calendarConstants';
import { isShiftDay } from './shiftPlacement';
import { eventSegmentTimeLabel, eventSegmentTitle, eventSegmentsByDay, normalizeEventList } from './events';
import { prettyRange, rowTimeText, shiftTimeLabel, timeToMinutes } from './shiftTime';
import { templateIsActiveOn } from './scheduleTemplates';
import { assignmentIsActiveOn } from './assignmentDates';
import { assignmentColor } from './assignmentColor';
import { memberCanFillAssignment } from './rankEligibility';

const text = (value) => String(value ?? '').trim();

// Monday-first weekday headings, matching the week grid and the printed week.
export const PRINT_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Monday-first index of a Date, matching how the schedule weeks are laid out elsewhere in the app.
const mondayIndex = (date) => (date.getDay() + 6) % 7;

// The month laid out as whole Monday-first weeks.
//
// Cells outside the month are returned too, flagged `outside`, so the grid keeps its shape - a short
// month must not stretch its last row across the page.
export const printMonthGrid = (year, month) => {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];

  for (let i = 0; i < mondayIndex(first); i += 1) {
    cells.push({ outside: true, key: `lead-${i}` });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    cells.push({
      outside: false,
      key: toDateKey(date),
      dateKey: toDateKey(date),
      dayOfMonth: day,
      weekdayIndex: mondayIndex(date),
    });
  }

  let trail = 0;
  while (cells.length % 7 !== 0) {
    cells.push({ outside: true, key: `trail-${trail}` });
    trail += 1;
  }

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
};

// How many days are in the month, for the subtitle.
export const printDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();

// One shift, as a printable line: "Member 1 · Day Shift · Engine 1".
const lineFor = ({ row, template, assignments, assignmentsById, extraLabel }) => {
  const assignmentId = text(row?.assignment_id) || text(template?.assignment_id);
  const assignment = assignmentsById(assignmentId);
  // The template carries the window when there is one, so a nickname replaces the times exactly as it
  // does on the calendars. Without a template the row's own times are used (a custom shift).
  const timeText = template
    ? shiftTimeLabel(template, prettyRange(rowTimeText(template)))
    : prettyRange(rowTimeText(row));

  const parts = [extraLabel, timeText, assignment?.description || 'Unassigned'].filter(Boolean);

  return {
    key: `${text(row?.id) || text(template?.id) || 'x'}-${timeText}`,
    text: parts.join(' · '),
    color: assignmentColor(assignmentId, assignments),
    startMin: timeToMinutes(template ? template.start_time : row?.start_time),
  };
};

// Every line for one date, sorted by start time.
export const printLinesForDate = ({
  dateKey,
  mode = 'member',
  member = null,
  schedule = [],
  scheduleTemplates = [],
  assignments = [],
  users = [],
  ranks = [],
  // Non-shift entries. Printed in every mode: an event is on the calendars, so a sheet without it would
  // disagree with the screen the reader was just looking at.
  events = [],
  // Vacancies in the past are not worth printing for a member - there is nothing to pick up.
  todayKey = toDateKey(new Date()),
}) => {
  const assignmentList = Array.isArray(assignments) ? assignments : [];
  const assignmentsById = (id) =>
    assignmentList.find((a) => String(a?.id ?? '') === String(id ?? '')) || null;
  const templateById = (id) =>
    scheduleTemplates.find((t) => String(t?.id ?? '') === String(id ?? '')) || null;
  const userName = (id) => {
    const found = (Array.isArray(users) ? users : []).find((u) => String(u?.id) === String(id));
    if (!found) return '';
    return text(found.name) || `Member #${id}`;
  };

  // Who may fill a vacancy, and whether it is still worth printing one.
  //
  // The administrator's sheet lists every vacancy, because the reader is the one who fills them. A member's
  // sheet lists only the vacancies they could actually take, and only from today onward - which is exactly
  // the set the calendar offers them, so the sheet and the screen agree.
  const canFill = (assignmentId) =>
    memberCanFillAssignment({ member, assignment: assignmentsById(assignmentId), ranks });
  const isPast = dateKey < todayKey;
  const showsEveryone = mode === 'admin' || mode === 'crew';
  const showsVacancy = (assignmentId) => mode === 'admin' || (!isPast && canFill(assignmentId));

  const lines = [];

  // Shifts that exist as rows on the schedule sheet.
  for (const row of Array.isArray(schedule) ? schedule : []) {
    if (!row) continue;
    // Placed on the day it STARTS, the same rule the calendars use.
    if (!isShiftDay(parseSheetDateKey(row.date_from), dateKey)) continue;

    const template = templateById(row.schedule_template_id);
    const who = text(row.user_id);

    if (!who) {
      // An unfilled row is a vacancy.
      if (!showsVacancy(row.assignment_id)) continue;
    } else if (!showsEveryone && String(who) !== String(member?.id)) {
      // On a member's own sheet somebody else's shift is not listed.
      continue;
    }

    lines.push(
      lineFor({
        row,
        template,
        assignments: assignmentList,
        assignmentsById,
        // The member's own shift needs no name; everyone else's does.
        extraLabel: !who ? 'Open' : showsEveryone ? userName(who) || `Member #${who}` : '',
      })
    );
  }

  // A template occurrence with no row on the sheet is still a shift that has to be covered, so it prints as
  // a vacancy too. This runs for every mode: the calendar draws these, and a member's sheet that omitted
  // them would offer fewer shifts than the screen does.
  {
    const dow = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][
      new Date(`${dateKey}T12:00:00`).getDay()
    ];
    const covered = new Set(
      (Array.isArray(schedule) ? schedule : [])
        .filter((row) => parseSheetDateKey(row?.date_from) === dateKey)
        .map((row) => text(row.schedule_template_id))
        .filter(Boolean)
    );

    for (const template of scheduleTemplates) {
      if (text(template?.day_of_week).toLowerCase() !== dow) continue;
      if (!templateIsActiveOn(template, dateKey)) continue;
      if (!assignmentIsActiveOn(assignmentsById(template?.assignment_id), dateKey)) continue;
      if (covered.has(text(template?.id))) continue;
      if (!showsVacancy(template?.assignment_id)) continue;
      lines.push(lineFor({ template, assignments: assignmentList, assignmentsById, extraLabel: 'Open' }));
    }
  }

  // Events for this day, printed FIRST so they read as context above the shifts - the same order the
  // calendars draw them in. Normalised defensively, and never given a name or an "Open" label: an event is
  // not a shift and nothing about it is offerable.
  const dayEvents = eventSegmentsByDay(normalizeEventList(events), dateKey, dateKey, { ranks }).get(dateKey) || [];
  for (const segment of dayEvents) {
    const when = eventSegmentTimeLabel(segment, '12');
    lines.push({
      key: `event-${segment.eventId}-${segment.dateKey}`,
      text: when && when !== 'All day' ? `${eventSegmentTitle(segment)} · ${when}` : eventSegmentTitle(segment),
      color: segment.color,
      startMin: segment.startsOnDay ? segment.startMinutes : 0,
      isEvent: true,
    });
  }

  // A shift with no readable start sorts last rather than pretending to be midnight.
  return lines.sort((a, b) => {
    const aMin = Number.isFinite(a.startMin) ? a.startMin : Number.MAX_SAFE_INTEGER;
    const bMin = Number.isFinite(b.startMin) ? b.startMin : Number.MAX_SAFE_INTEGER;
    return aMin - bMin || a.text.localeCompare(b.text);
  });
};

// The whole month as weeks of cells, each cell carrying its printed lines. The sheet renders this, so the
// grid and the data cannot disagree about which day a shift lands on.
export const printMonth = ({
  year,
  month,
  mode = 'member',
  member = null,
  schedule = [],
  scheduleTemplates = [],
  assignments = [],
  users = [],
  ranks = [],
  events = [],
  todayKey,
}) =>
  printMonthGrid(year, month).map((week) =>
    week.map((cell) => ({
      ...cell,
      lines: cell.outside
        ? []
        : printLinesForDate({
            dateKey: cell.dateKey,
            mode,
            member,
            schedule,
            scheduleTemplates,
            assignments,
            users,
            ranks,
            events,
            ...(todayKey ? { todayKey } : {}),
          }),
    }))
  );

// The header block: what the page is, for whom, and when it was produced.
export const printHeader = ({
  mode = 'member',
  departmentName = '',
  memberName = '',
  year,
  month,
  generatedAt = new Date(),
}) => {
  const showsEveryone = mode === 'admin' || mode === 'crew';
  return {
    departmentName: text(departmentName) || 'Fire Department',
    title: showsEveryone ? 'Shift Schedule' : 'My Schedule',
    subtitle: showsEveryone
      ? `${MONTHS[month]} ${year} · All members`
      : `${MONTHS[month]} ${year}${memberName ? ` · ${memberName}` : ''}`,
    monthLabel: `${MONTHS[month]} ${year}`,
    // Counted to a day rather than to a time: a printed sheet is a record, and the reader wants the date.
    generated: `Printed ${toDateKey(generatedAt)}`,
    // On a crew sheet the reader is holding someone else's printout, so it says who produced it.
    printedBy: showsEveryone ? text(memberName) : '',
  };
};

// How many shifts the sheet covers, for the line under the grid.
export const printShiftCount = (weeks) =>
  weeks.reduce(
    (total, week) => total + week.reduce((sum, cell) => sum + (cell.lines ? cell.lines.length : 0), 0),
    0
  );
