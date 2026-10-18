import React from 'react';
import { Users, User } from 'lucide-react';
import RankIcon from './RankIcon';
import MemberName from './MemberName';

export default function OnDutyCard({ onDutyUsers = [], ranks = [] }) {
  const rankFor = (rankId) => ranks.find((r) => String(r.id) === String(rankId));

  return (
    <div className="h-full max-h-[500px] flex flex-col justify-between overflow-hidden bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/80 rounded-2xl p-5 md:p-6 shadow-xl transition-all">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700/60 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 flex items-center justify-center font-bold shrink-0">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Currently On Duty
            </h3>
            <p className="text-[11px] text-slate-400">
              Active personnel currently on the clock
            </p>
          </div>
        </div>

        <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-bold rounded-full bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300">
          {onDutyUsers.length}
        </span>
      </div>

      {/* Content */}
      <div className="overflow-y-auto min-h-0 flex-1 pr-1">
        {onDutyUsers.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400 space-y-1">
            <Users className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-1 opacity-70" />
            <p className="font-semibold text-slate-700 dark:text-slate-300">No personnel clocked in</p>
            <p className="text-[11px]">Staff will appear here when they clock in.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {onDutyUsers.map((user) => {
              const rank = rankFor(user.rank_id);
              return (
                <div
                  key={user.id}
                  className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/50 shadow-xs"
                >
                  <div
                    className="p-2 bg-slate-200 dark:bg-slate-800 rounded-lg shrink-0"
                    style={{ color: rank?.color || undefined }}
                  >
                    {rank ? (
                      <RankIcon name={rank.icon} className="w-5 h-5" />
                    ) : (
                      <User className="w-5 h-5 text-slate-500 dark:text-slate-300" />
                    )}
                  </div>
                  <div className="overflow-hidden min-w-0">
                    <p className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                      <MemberName user={user} nameClassName="truncate" />
                    </p>
                    {rank && (
                      <p className="text-xs truncate font-medium" style={{ color: rank.color || undefined }}>
                        {rank.description}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 pt-3 mt-3 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-xs">
        <span className="text-[11px] text-slate-400">
          {onDutyUsers.length} member{onDutyUsers.length === 1 ? '' : 's'} on duty
        </span>
      </div>
    </div>
  );
}
