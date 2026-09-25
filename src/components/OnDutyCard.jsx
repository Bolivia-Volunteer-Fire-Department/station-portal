import React from 'react';
import { Users, User } from 'lucide-react';
import RankIcon from './RankIcon';

export default function OnDutyCard({ onDutyUsers = [], ranks = [] }) {
  const rankFor = (rankId) => ranks.find((r) => String(r.id) === String(rankId));

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-xl">
      <div className="flex items-center gap-2 mb-4">
        <Users className="w-4 h-4 text-red-500" />
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          Currently On Duty {onDutyUsers.length > 0 && `(${onDutyUsers.length})`}
        </h3>
      </div>

      {onDutyUsers.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No one is currently clocked in.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {onDutyUsers.map((user) => {
            const rank = rankFor(user.rank_id);
            return (
              <div
                key={user.id}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/50"
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
                <div className="overflow-hidden">
                  <p className="font-semibold text-sm text-slate-900 dark:text-white truncate">{user.name}</p>
                  {rank && (
                    <p className="text-xs truncate" style={{ color: rank.color || undefined }}>{rank.description}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
