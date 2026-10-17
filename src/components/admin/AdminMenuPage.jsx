import React from 'react';

// The Administration home menu: displays categories of administrative settings.
export default function AdminMenuPage({
  categories,
  onSelectTab,
  pendingCount = 0,
  pendingTabId = 'approvals',
  documentVerificationCount = 0,
  verificationTabId = 'documents',
  workOrdersCount = 0,
  workOrdersTabId = 'work-orders',
}) {
  if (categories.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Your role does not include access to any Administration tabs.
      </p>
    );
  }

  return (
    <div>
      <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">
        Choose a section to manage. Press <span className="font-medium">Administration</span> in the sidebar to
        come back here.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {categories.map(({ id, label, icon: CategoryIcon, items }) => {
          // Count of pending items to show on the category card.
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
                {/* {cardBadge > 0 && (
                  <span className="ml-auto inline-flex min-w-[22px] items-center justify-center rounded-full bg-amber-400 px-1.5 py-0.5 text-xs font-bold text-amber-950">
                    {cardBadge}
                  </span>
                )} */}
              </button>

              <div className="mt-4 flex flex-col gap-1 border-t border-slate-100 dark:border-slate-700/60 pt-3">
                {items.map(({ id: itemId, label: itemLabel, icon: ItemIcon }) => {
                  const badge =
                    itemId === pendingTabId
                      ? pendingCount
                      : itemId === verificationTabId
                        ? documentVerificationCount
                        : itemId === workOrdersTabId
                          ? workOrdersCount
                          : 0;
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
