import React, { useCallback } from 'react';
import { Info } from 'lucide-react';
import { setMyAvailability } from '../services/api';
import AvailabilityCalendar from './AvailabilityCalendar';

// "My Availability" - the member marks the availability windows they could work.
//
// It shows the station's weekly patterns for the month (utils/availability.js) and lets the member mark each day they
// fall on. There is deliberately no "show everyone" toggle here - this screen is about the member's own availability,
// and seeing the crew's would not help answer it.
//
// The calendar owns the draft and saves it in one request; this performs the save and refreshes the claims, so the
// success path leaves the calendar reading fresh server state.
export default function MyAvailability({
  token,
  currentUser,
  availability = [],
  windows = [],
  loadedFrom = '',
  loadedTo = '',
  onLoadMonth,
  ranks = [],
  timeFormat = '12',
  hideEventsByDefault = false,
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
            Check every window you could work, then press <span className="font-medium">Save</span>.
            This is what administrators check when they build the schedule — marking yourself
            available does not commit you to the shift, and you can change it at any time.
          </p>
        </div>
      </div>

      <AvailabilityCalendar
        member={currentUser}
        availability={availability}
        windows={windows}
        loadedFrom={loadedFrom}
        loadedTo={loadedTo}
        onLoadMonth={onLoadMonth}
        ranks={ranks}
        timeFormat={timeFormat}
        hideEventsByDefault={hideEventsByDefault}
        // Non-shift entries, so the member sees training and meetings alongside the windows they can mark.
        events={events}
        eventAudience={eventAudience}
        onSave={save}
      />
    </div>
  );
}
