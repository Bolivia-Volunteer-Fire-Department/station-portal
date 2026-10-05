import React from 'react';
import RankIcon from './RankIcon';

export default function RosterModule({
  loading = false,
  error = '',
  members = [],
  ranks = [],
  certificationTypes = [],
  memberCertificationIds = {},
}) {
  if (loading) {
    return <p role="status" className="text-sm text-slate-500 dark:text-slate-400">Loading roster...</p>;
  }

  if (error) {
    return <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }

  return (
    <div className="max-h-[calc(100dvh-18rem)] min-h-48 overflow-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
        <thead className="bg-slate-50 dark:bg-slate-800">
          <tr>
            <th scope="col" className="sticky top-0 z-10 bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500 dark:bg-slate-800">Name</th>
            <th scope="col" className="sticky top-0 z-10 bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500 dark:bg-slate-800">Rank</th>
            {certificationTypes.map((type) => (
              <th key={type.id} scope="col" className="sticky top-0 z-10 max-w-40 bg-slate-50 px-4 py-3 text-center text-xs font-semibold uppercase text-slate-500 dark:bg-slate-800">
                <span className="block truncate" title={type.name}>{type.name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
          {members.length ? members.map((member) => {
            const rank = ranks.find((item) => String(item.id) === String(member.rank_id));
            const activeTypeIds = new Set(memberCertificationIds[member.id] || []);
            return (
              <tr key={member.id} className="text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/40">
                <td className="whitespace-nowrap px-4 py-3 font-medium">{member.name || '—'}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  {rank ? (
                    <span style={{ color: String(rank.color || '').trim() || undefined }} className="inline-flex items-center gap-1.5">
                      <RankIcon name={rank.icon} className="h-4 w-4 shrink-0" />
                      <span>{rank.description || rank.id}</span>
                    </span>
                  ) : '—'}
                </td>
                {certificationTypes.map((type) => (
                  <td key={type.id} className="px-4 py-3 text-center">
                    {activeTypeIds.has(type.id) && (
                      <span title={type.name} aria-label={`${type.name} active`}>
                        <RankIcon name={type.icon} className="mx-auto h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            );
          }) : (
            <tr>
              <td colSpan={certificationTypes.length + 2} className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                No active members found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}