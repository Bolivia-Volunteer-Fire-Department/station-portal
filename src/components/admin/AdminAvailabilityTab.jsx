import React, { useCallback, useState } from 'react';
import { Users } from 'lucide-react';
import { adminSetAvailability } from '../../services/api';
import AvailabilityCalendar, { MonthNav } from '../AvailabilityCalendar';
import CenteredContent from '../CenteredContent';
import MemberName from '../MemberName';
import RankIcon from '../RankIcon';
import { MONTHS } from '../../utils/calendarConstants';
import { windowDaysForMonth } from '../../utils/availability';
import { toDateKey } from '../../utils/scheduleDate';

// The value that means "show everyone" in the member picker. Deliberately not a user id,
// so it can never collide with one.
const ALL_MEMBERS = '__all__';

// Administrator view of availability.
//
// One member selected: the same month grid the member sees, toggling that member's rows - useful when someone phones in
// and needs a change made for them.
//
// All Members: each day of the month, the availability windows that fall on it, and the members who claimed them. That
// list is now the whole view - it used to be built from the month's shift templates, with their times, assignments and
// ranks, which is a lot of machinery to answer "who can cover Tuesday night?".
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
  // Non-shift entries, drawn on the single-member grid so an administrator sees the same month the member does. The All
  // Members list is windows and names, so events have no place in it.
  events = [],
  eventAudience = {},
  onDataChanged,
}) {
  // Opens on All Members: the first thing an administrator wants from this tab is the
  // overview, and the picker sits right above it to drill into one person.
  const [selected, setSelected] = useState(ALL_MEMBERS);

  const showingAll = selected === ALL_MEMBERS;
  const selectedMember = showingAll
    ? null
    : users.find((u) => String(u.id) === String(selected)) || null;

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
              : 'Tick the windows this member could work, then save.'}
          </p>
        </div>
      </div>

      {showingAll ? (
        // A date-grouped reading list, so it is capped and centred; the single-member view below renders the
        // seven-column month grid and deliberately is not.
        <CenteredContent>
          <AvailabilityRoster
            windows={windows}
            availability={rosterAvailability}
            users={users}
            ranks={ranks}
            loadedFrom={loadedFrom}
            loadedTo={loadedTo}
            onLoadMonth={onLoadMonth}
          />
        </CenteredContent>
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
  windows = [],
  availability = [],
  users = [],
  ranks = [],
  loadedFrom = '',
  loadedTo = '',
  onLoadMonth,
}) {
  const now = new Date();
  const [viewDate, setViewDate] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();

  const goBy = (delta) => setViewDate((date) => new Date(date.getFullYear(), date.getMonth() + delta, 1));
  const goTo = (date) => setViewDate(new Date(date.getFullYear(), date.getMonth(), 1));

  const days = windowDaysForMonth({ year, month, windows, availability, users });
  const monthStart = toDateKey(new Date(year, month, 1));
  const monthEnd = toDateKey(new Date(year, month + 1, 0));
  const loaded = (!loadedFrom || monthStart >= loadedFrom) && (!loadedTo || monthEnd <= loadedTo);

  const rankOf = (rankId) =>
    ranks.find((rank) => String(rank?.id ?? '').trim() === String(rankId ?? '').trim()) || null;

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <MonthNav
        year={year}
        month={month}
        onPrev={() => goBy(-1)}
        onNext={() => goBy(1)}
        onToday={() => goTo(now)}
        isCurrentMonth={isCurrentMonth}
      />

      <div className="px-4 py-3 space-y-4">
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
            <h4 className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
              {new Date(`${day.dateKey}T12:00:00`).toLocaleDateString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })}
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
                    return (
                      <span
                        key={member.id}
                        title={rank?.description ? `${member.name} — ${rank.description}` : member.name}
                        className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
                        style={rank?.color ? { borderColor: rank.color, color: rank.color } : undefined}
                      >
                        {rank?.icon ? <RankIcon name={rank.icon} className="h-3 w-3" /> : null}
                        {/* The name component every other screen uses, so a certification badge shows up here too. */}
                        <MemberName user={member} className="h-3 w-3" />
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
