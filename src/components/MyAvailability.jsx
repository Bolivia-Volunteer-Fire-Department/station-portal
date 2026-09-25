import React, { useCallback } from 'react';
import { Info } from 'lucide-react';
import { setMyAvailability } from '../services/api';
import AvailabilityCalendar from './AvailabilityCalendar';

// "My Availability" - the member marks the shifts they could work.
//
// Modelled on My Schedule: it preloads every shift template occurrence the member's rank
// qualifies for and lets them mark each one, rather than asking them to describe their week
// as time windows. There is deliberately no "show everyone" toggle here - this screen is
// about the member's own availability, and seeing the crew's would not help answer it.
//
// The calendar owns the draft and saves it in one request; this just performs the save and
// refreshes the sheet, so the success path leaves the calendar reading fresh server state.
export default function MyAvailability({
  token,
  currentUser,
  availability = [],
  scheduleTemplates = [],
  assignments = [],
  ranks = [],
  timeFormat = '12',
  events = [],
  eventAudience = {},
  onChanged,
}) {
  const save = useCallback(
    async (changes) => {
      try {
        const result = await setMyAvailability(changes, token);
        if (result?.success) await onChanged?.(token);
        return result;
      } catch (err) {
        return { success: false, message: err?.message || 'Failed to save availability.' };
      }
    },
    [token, onChanged]
  );

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl p-4">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Tick every shift you could work, then press <span className="font-medium">Save</span>.
            This is what administrators check when they build the schedule — marking yourself
            available does not commit you to the shift, and you can change it at any time.
          </p>
        </div>
      </div>

      <AvailabilityCalendar
        member={currentUser}
        availability={availability}
        scheduleTemplates={scheduleTemplates}
        assignments={assignments}
        ranks={ranks}
        timeFormat={timeFormat}
        // Non-shift entries, so the member sees training and meetings alongside the shifts they can mark.
        events={events}
        eventAudience={eventAudience}
        onSave={save}
      />
    </div>
  );
}
