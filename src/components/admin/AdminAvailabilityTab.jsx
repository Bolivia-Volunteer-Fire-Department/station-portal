import React, { useCallback, useState } from 'react';
import { Users } from 'lucide-react';
import { adminSetAvailability } from '../../services/api';
import AvailabilityCalendar from '../AvailabilityCalendar';
import AdminAvailabilityRoster from './AdminAvailabilityRoster';
import CenteredContent from '../CenteredContent';

// The value that means "show everyone" in the member picker. Deliberately not a user id,
// so it can never collide with one.
const ALL_MEMBERS = '__all__';

// Administrator view of availability.
//
// One member selected: the same month grid the member sees, toggling that member's rows -
// useful when someone phones in and needs a change made for them.
//
// All Members: every shift in the month with the members who marked themselves available
// for it, and nobody else. See AdminAvailabilityRoster for why that view is a list rather
// than a grid.
export default function AdminAvailabilityTab({
  token,
  users = [],
  availability = [],
  scheduleTemplates = [],
  assignments = [],
  ranks = [],
  timeFormat = '12',
  // Non-shift entries, drawn on the single-member grid so an administrator sees the same month the
  // member does. The All Members view is a list of availability rather than a calendar, so events have no
  // place in it.
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

  // The calendar owns the draft; this performs the batch save and refreshes the sheet.
  // The token is passed explicitly on purpose: refreshAvailability expects one, and calling
  // it bare would come back UNAUTHORIZED and raise the re-auth prompt.
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
              ? 'Who has marked themselves available for each shift.'
              : 'Tick the shifts this member could work, then save.'}
          </p>
        </div>
      </div>

      {showingAll ? (
        // The All Members list is capped and centred: it is a date-grouped reading list. The single-member
        // view below is deliberately NOT: it renders the seven-column month grid, which needs the width.
        <CenteredContent>
          <AdminAvailabilityRoster
            scheduleTemplates={scheduleTemplates}
            availability={availability}
            users={users}
            assignments={assignments}
            // Ranks color each name and supply its icon in the All Members list.
            ranks={ranks}
            timeFormat={timeFormat}
            // Non-shift entries, listed once per day so an administrator can see what is happening on a day
            // before deciding who to put on it.
            events={events}
          />
        </CenteredContent>
      ) : selectedMember ? (
        <AvailabilityCalendar
          member={selectedMember}
          availability={availability}
          scheduleTemplates={scheduleTemplates}
          assignments={assignments}
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
