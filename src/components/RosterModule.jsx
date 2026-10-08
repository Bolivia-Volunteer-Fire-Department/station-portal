import React, { useState } from 'react';
import RankIcon from './RankIcon';
import { unnamedLabel } from '../utils/displayLabel';

export default function RosterModule({
  loading = false,
  error = '',
  members = [],
  ranks = [],
  certificationTypes = [],
  memberCertificationIds = {},
  // The term the read in hand answers, and the way to ask for another one (see functions/rosterPage.js - the page, its
  // size and the prefix search are all decided there, so they can be tested without a database).
  search = '',
  onSearch,
  // WHERE THE PAGE ENDS: the cursor behind it, and the page after it.
  page = {},
  loadingMore = false,
  onLoadMore,
}) {
  // THE BOX IS LOCAL UNTIL IT IS SUBMITTED. `search` is the term the rows on screen answer; this is what is being typed.
  // Keeping them apart is a READ decision: committing on submit makes a search ONE read per question asked, where
  // committing per keystroke would make it one per letter.
  const [draft, setDraft] = useState(search);
  // ADJUSTED DURING RENDER rather than in an effect - React's documented pattern, and the one TrainingModule uses here for
  // the same reason: an effect would paint the stale box once after the committed term changed underneath it.
  const [seen, setSeen] = useState(search);
  if (seen !== search) {
    setSeen(search);
    setDraft(search);
  }

  if (loading) {
    return <p role="status" className="text-sm text-slate-500 dark:text-slate-400">Loading roster...</p>;
  }

  if (error) {
    return <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }

  return (
    <div className="space-y-3">
      {/* THE SEARCH, COMMITTED RATHER THAN OBSERVED. A name prefix is what the reader can answer from an index, and one
          read per submitted question is the point of the box being a form rather than a listener on the input. */}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (onSearch) onSearch(String(draft || '').trim());
        }}
      >
        <label className="sr-only" htmlFor="roster-search">
          Search members
        </label>
        <input
          id="roster-search"
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Search by name…"
          className="w-full max-w-xs rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
        />
        <button
          type="submit"
          className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500"
        >
          Search
        </button>
        {search ? (
          <button
            type="button"
            onClick={() => {
              setDraft('');
              if (onSearch) onSearch('');
            }}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Clear
          </button>
        ) : null}
        {/* WHAT IS ON SCREEN: a page's worth, for the term it answers - and whether anything is behind it. Without this
            line, fourteen names read as a roster of fourteen. */}
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {members.length} shown
          {search ? ` for “${search}”` : ''}
          {page && page.has_more ? ' · more available' : ''}
        </span>
      </form>

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
                      <span>{rank.description || unnamedLabel('rank')}</span>
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

      {/* ONE MORE PAGE, WHILE THE READER HAS ONE. The button appears only when the callable said there is something behind
          the page in hand, so it cannot promise names that are not there. */}
      {onLoadMore && page && page.has_more ? (
        <button
          type="button"
          disabled={loadingMore}
          onClick={() => onLoadMore()}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          {loadingMore ? 'Loading…' : 'Load more members'}
        </button>
      ) : null}
    </div>
  );
}