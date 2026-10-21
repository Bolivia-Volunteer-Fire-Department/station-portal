import { doc, getDoc } from 'firebase/firestore';
import { firestore } from '../services/firebase.js';

// Cache structure: { [uid]: { data, timestamp } }
const userCache = {};

// Cache timestamp for expiry
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export const getUser = async (uid) => {
  if (!uid) return null;

  // Return cached data if available and not expired
  const cached = userCache[uid];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  // Fetch from Firestore
  try {
    const snap = await getDoc(doc(firestore(), 'users', uid));
    if (snap.exists()) {
      const data = snap.data();
      userCache[uid] = {
        data,
        timestamp: Date.now(),
      };
      return data;
    }
    return null;
  } catch (error) {
    console.warn('[userCache] Could not read user data:', error && error.message);
    return null;
  }
};

// Invalidate cache for a specific uid (call when user data changes)
export const invalidateUser = (uid) => {
  delete userCache[uid];
};

// Invalidate all cache (call on sign-out or session reset)
export const invalidateAll = () => {
  Object.keys(userCache).forEach((uid) => delete userCache[uid]);
};

// Export for debugging/inspection
export const getCacheStats = () => ({
  cachedUids: Object.keys(userCache),
  cacheSize: Object.keys(userCache).length,
});
