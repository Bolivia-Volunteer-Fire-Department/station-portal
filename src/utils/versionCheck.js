import { APP_BUILD_TIME, APP_VERSION } from './appVersion.js';

let updateFound = false;
let latestUpdateInfo = { updateAvailable: false, version: APP_VERSION, buildTime: APP_BUILD_TIME };
const listeners = new Set();

export const isUpdateAvailable = () => updateFound;
export const getLatestUpdateInfo = () => latestUpdateInfo;

// Checks the server for a newer build of the application.
export async function checkForAppUpdate() {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') {
    return { updateAvailable: false };
  }

  try {
    const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const url = `${cleanBase}/version.json?_t=${Date.now()}`;

    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
    });

    if (!response.ok) {
      return { updateAvailable: false };
    }

    const data = await response.json();
    const serverBuildTime = Number(data?.buildTime) || 0;
    const serverVersion = String(data?.version || '').trim();

    // Check if the server has a newer build timestamp or a different version string.
    const isNewer =
      (APP_BUILD_TIME > 0 && serverBuildTime > APP_BUILD_TIME) ||
      (APP_BUILD_TIME > 0 && serverVersion && serverVersion !== APP_VERSION && serverBuildTime >= APP_BUILD_TIME);

    if (isNewer) {
      updateFound = true;
      latestUpdateInfo = {
        updateAvailable: true,
        version: serverVersion || APP_VERSION,
        buildTime: serverBuildTime,
      };

      listeners.forEach((callback) => {
        try {
          callback(latestUpdateInfo);
        } catch (err) {
          console.error('[version] listener error:', err);
        }
      });

      return latestUpdateInfo;
    }

    return { updateAvailable: false };
  } catch (error) {
    // Suppress network errors (e.g. device offline or temporary disconnect)
    console.debug('[version] check skipped:', error?.message);
    return { updateAvailable: false };
  }
}

// Subscribes to update detection events.
export function subscribeToAppUpdates(callback) {
  if (typeof callback !== 'function') return () => {};
  listeners.add(callback);
  if (updateFound) {
    try {
      callback(latestUpdateInfo);
    } catch (err) {
      console.error('[version] immediate callback error:', err);
    }
  }
  return () => {
    listeners.delete(callback);
  };
}

// Activates the latest update by updating the service worker and reloading.
export async function applyAppUpdate() {
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
    } catch {
      // Ignore service worker update error and proceed with reload
    }
  }

  if (typeof window !== 'undefined') {
    window.location.reload();
  }
}

// Starts background update monitoring on visibility, focus, and periodic timers.
export function startPeriodicUpdateChecks({ intervalMinutes = 15 } = {}) {
  if (typeof window === 'undefined') return () => {};

  const check = () => {
    void checkForAppUpdate();
  };

  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      check();
    }
  };

  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('online', check);
  window.addEventListener('focus', check);

  const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;
  const intervalId = setInterval(check, intervalMs);

  // Initial check shortly after load
  const initialTimeoutId = setTimeout(check, 6000);

  return () => {
    document.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('online', check);
    window.removeEventListener('focus', check);
    clearInterval(intervalId);
    clearTimeout(initialTimeoutId);
  };
}

