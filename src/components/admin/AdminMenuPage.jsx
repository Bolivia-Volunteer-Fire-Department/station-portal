import React from 'react';

// The Administration landing page: a grid of large cards, one per nav category.
//
// WHY THIS EXISTS. Opening Administration used to drop the member straight into the first permitted
// tab (Users, or Pending Approvals when offers were waiting), which paid for that tab's reads whether
// or not the member wanted it. The menu reads nothing but the offers its badge counts, and every
// card's tab list is the navigation: the dropdown bar at the top of the module only appears once a
// section is chosen, and the way back here is the sidebar's Administration item again.
//
// The cards mirror ADMIN_NAV_CATEGORIES (the same source the dropdown bar renders), so a category
// can never exist on the menu and be missing from the bar, or the other way round.
export default function AdminMenuPage({ categories, onSelectTab, pendingCount = 0, pendingTabId = 'approvals' }) {
  if (categories.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Your role does not include access to any Administration tabs.
      </p>
    );
  }

  return (
    <div>
      {/* The page heading above already says "Administration" - this is only the wayfinding note. */}
      <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">
        Choose a section to manage. Press <span className="font-medium">Administration</span> in the sidebar to
        come back here.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {categories.map(({ id, label, icon: CategoryIcon, items }) => {
          // The pending-offers badge belongs to the category that holds the approvals tab, so it is
          // visible at a glance on the card - and again on the item itself, beside the label.
          const cardBadge = items.some((item) => item.id === pendingTabId) ? pendingCount : 0;

          return (
            <div
              key={id}
              className="flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm transition hover:border-red-300 dark:hover:border-red-800/60 hover:shadow-md"
            >
              <button
                type="button"
                onClick={() => items[0] && onSelectTab(items[0].id)}
                className="flex items-center gap-3 text-left"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400">
                  <CategoryIcon className="h-6 w-6" />
                </span>
                <span className="text-lg font-semibold text-slate-900 dark:text-white">{label}</span>
                {cardBadge > 0 && (
                  <span className="ml-auto inline-flex min-w-[22px] items-center justify-center rounded-full bg-amber-400 px-1.5 py-0.5 text-xs font-bold text-amber-950">
                    {cardBadge}
                  </span>
                )}
              </button>

              <div className="mt-4 flex flex-col gap-1 border-t border-slate-100 dark:border-slate-700/60 pt-3">
                {items.map(({ id: itemId, label: itemLabel, icon: ItemIcon }) => {
                  const badge = itemId === pendingTabId ? pendingCount : 0;
                  return (
                    <button
                      key={itemId}
                      type="button"
                      onClick={() => onSelectTab(itemId)}
                      className="-mx-1 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600 transition hover:bg-red-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white"
                    >
                      <ItemIcon className="h-4 w-4 shrink-0 opacity-70" />
                      <span className="flex-1 text-left">{itemLabel}</span>
                      {badge > 0 && (
                        <span className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-amber-950">
                          {badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
