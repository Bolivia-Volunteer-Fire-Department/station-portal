import React, { useEffect, useState } from 'react';
import { RefreshCw, Sparkles, X } from 'lucide-react';
import { applyAppUpdate, subscribeToAppUpdates } from '../utils/versionCheck.js';

export default function AppUpdateBanner() {
  const [updateInfo, setUpdateInfo] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    return subscribeToAppUpdates((info) => {
      if (info?.updateAvailable) {
        setUpdateInfo(info);
      }
    });
  }, []);

  if (!updateInfo?.updateAvailable || dismissed) {
    return null;
  }

  const handleUpdate = () => {
    setApplying(true);
    void applyAppUpdate();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-3 left-1/2 -translate-x-1/2 z-50 max-w-md w-[calc(100%-2rem)] sm:w-auto flex items-center justify-between gap-3 rounded-2xl border border-sky-300 dark:border-sky-800 bg-sky-50/95 dark:bg-slate-900/95 backdrop-blur-md px-4 py-2.5 text-xs text-sky-950 dark:text-sky-100 shadow-2xl transition"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <Sparkles className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
        <span className="truncate font-medium">
          New version available{updateInfo.version ? ` (v${updateInfo.version})` : ''}
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={handleUpdate}
          disabled={applying}
          className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold px-2.5 py-1 text-xs shadow-sm transition active:scale-95"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${applying ? 'animate-spin' : ''}`} />
          {applying ? 'Updating…' : 'Update now'}
        </button>

        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition"
          title="Dismiss"
          aria-label="Dismiss update notice"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

