import React from 'react';
import { UserX } from 'lucide-react';
import MemberName from '../MemberName';
import { MONTHS } from '../../utils/calendarConstants';

// The members who have claimed NOTHING for the month on screen - who an officer has to chase before the month
// closes. It sits BESIDE the All Members day list on a computer and ABOVE it on a phone; that layout decision is the
// tab's, which owns the month the two agree on, so this component is only the card itself.
//
// An UNREAD month makes every member look unclaimed (there are no rows to count), so the card says that rather than
// printing the whole crew - the same distinction the day list draws with its own "nothing is loaded" banner above.
export default function NoAvailabilityCard({ members = [], year, month, loaded = true, className = '' }) {
  return (
    <section
      className={`rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800 ${className}`.trim()}
    >
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <UserX className="h-4 w-4 shrink-0 text-amber-600" />
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">No availability</h3>
        {loaded && (
          <span className="ml-auto text-xs font-medium text-slate-500 dark:text-slate-400">{members.length}</span>
        )}
      </div>

      <div className="px-4 py-3">
        {!loaded ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {MONTHS[month]} {year} has not been read yet, so everyone would look unclaimed. Load the month to see who
            has said nothing.
          </p>
        ) : members.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Everyone who can set their own availability has marked some in {MONTHS[month]} {year}.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {members.map((member) => (
              <li key={member.id} className="flex min-w-0 text-sm text-slate-700 dark:text-slate-200">
                <MemberName user={member} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
