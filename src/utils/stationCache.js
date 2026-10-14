// Persistent client-side cache for station metadata (ranks, roles, shifts, systemSettings).
// Provides instant zero-latency UI boots while supporting stale-while-revalidate background refresh.

export const STATION_META_CACHE_KEY = 'stationsync:station_meta';
export const STATION_META_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Reads station metadata from localStorage.
 * @returns {{ roles: Array, ranks: Array, shifts: Array, systemSettings: Array, savedAt: number } | null}
 */
export const readStationMetaCache = () => {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(STATION_META_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return {
      roles: Array.isArray(data.roles) ? data.roles : [],
      ranks: Array.isArray(data.ranks) ? data.ranks : [],
      shifts: Array.isArray(data.shifts) ? data.shifts : [],
      systemSettings: Array.isArray(data.systemSettings) ? data.systemSettings : [],
      savedAt: Number(data.savedAt) || 0,
    };
  } catch {
    return null;
  }
};

/**
 * Writes updated station metadata to localStorage, merging with any existing values.
 */
export const writeStationMetaCache = ({ roles, ranks, shifts, systemSettings } = {}) => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const existing = readStationMetaCache() || { roles: [], ranks: [], shifts: [], systemSettings: [], savedAt: 0 };
    const payload = {
      roles: Array.isArray(roles) && roles.length > 0 ? roles : existing.roles,
      ranks: Array.isArray(ranks) && ranks.length > 0 ? ranks : existing.ranks,
      shifts: Array.isArray(shifts) && shifts.length > 0 ? shifts : existing.shifts,
      systemSettings: Array.isArray(systemSettings) && systemSettings.length > 0 ? systemSettings : existing.systemSettings,
      savedAt: Date.now(),
    };
    window.localStorage.setItem(STATION_META_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Quota exceeded or storage disabled
  }
};

/**
 * Determines whether the cached metadata is stale and needs background revalidation.
 */
export const isStationMetaStale = (savedAt, maxAgeMs = STATION_META_TTL_MS) => {
  const at = Number(savedAt) || 0;
  if (!at) return true;
  return Date.now() - at >= maxAgeMs;
};

/**
 * Clears cached station metadata.
 */
export const clearStationMetaCache = () => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(STATION_META_CACHE_KEY);
  } catch {
    // ignore
  }
};

