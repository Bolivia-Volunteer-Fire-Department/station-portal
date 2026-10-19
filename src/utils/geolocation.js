// Utility to capture current browser coordinates
export const getCurrentCoordinates = async () => {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    console.warn('Geolocation is blocked: site is not in a secure context (requires HTTPS or localhost).');
    return {
      latitude: null,
      longitude: null,
      errorCode: 1,
      errorReason: 'insecure-context',
      errorMessage: 'Geolocation is restricted to secure contexts (HTTPS or localhost). Current URL is not secure.',
    };
  }

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    console.warn('Geolocation is not supported by this browser.');
    return {
      latitude: null,
      longitude: null,
      errorCode: 2,
      errorReason: 'unsupported',
      errorMessage: 'Geolocation is not supported by this browser.',
    };
  }

  let permissionState = null;
  try {
    if (navigator.permissions?.query) {
      const perm = await navigator.permissions.query({ name: 'geolocation' });
      permissionState = perm?.state;
    }
  } catch {
    // permission query not supported
  }

  const queryPosition = (options) => {
    return new Promise((res, rej) => {
      navigator.geolocation.getCurrentPosition(res, rej, options);
    });
  };

  // Attempt 1: Standard accuracy with cached positions allowed (fastest, most reliable on desktop/laptop Wi-Fi)
  try {
    const position = await queryPosition({
      enableHighAccuracy: false,
      timeout: 5000,
      maximumAge: 300000, // 5 min cache
    });
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
    };
  } catch (err1) {
    console.warn('Standard accuracy geolocation attempt failed:', err1?.message);

    // If permission was explicitly denied, retrying high accuracy won't help
    if (err1?.code === 1) {
      let errorMsg = err1.message || 'Location permission denied.';
      if (permissionState === 'granted') {
        errorMsg = 'Browser site permission is Allowed, but macOS/system Location Services blocked the request. In macOS System Settings → Privacy & Security → Location Services, ensure Google Chrome is toggled ON, then restart Chrome (Cmd+Q).';
      }
      return {
        latitude: null,
        longitude: null,
        errorCode: 1,
        errorReason: 'denied',
        errorMessage: errorMsg,
      };
    }

    // Attempt 2: High accuracy (for mobile devices with GPS chip)
    try {
      const position = await queryPosition({
        enableHighAccuracy: true,
        timeout: 6000,
        maximumAge: 60000,
      });
      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };
    } catch (err2) {
      console.warn('High accuracy geolocation attempt failed:', err2?.message);

      // Attempt 3: Any cached position
      try {
        const position = await queryPosition({
          enableHighAccuracy: false,
          timeout: 4000,
          maximumAge: Infinity,
        });
        return {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
      } catch (err3) {
        const finalError = err3 || err2 || err1;
        let reason = 'unavailable';
        if (finalError?.code === 1) reason = 'denied';
        else if (finalError?.code === 3) reason = 'timeout';

        let customMsg = finalError?.message || 'Location unavailable.';
        if (finalError?.code === 1 && permissionState === 'granted') {
          customMsg = 'Browser site permission is Allowed, but macOS/system Location Services blocked the request. In macOS System Settings → Privacy & Security → Location Services, ensure Google Chrome is toggled ON, then restart Chrome (Cmd+Q).';
        } else if (finalError?.code === 2) {
          customMsg = 'Device position unavailable from macOS CoreLocation. In macOS System Settings → Privacy & Security → Location Services → System Services (Details...), verify "Networking & Wireless" is ON, or try toggling Chrome off/on under Location Services and restarting Chrome.';
        }

        return {
          latitude: null,
          longitude: null,
          errorCode: finalError?.code,
          errorReason: reason,
          errorMessage: customMsg,
        };
      }
    }
  }
};

/**
 * Creates a Leaflet divIcon representing the user's live position with pulsing radar rings.
 */
export const createUserLocationIcon = (L) => {
  if (!L || typeof L.divIcon !== 'function') return null;
  return L.divIcon({
    className: 'user-live-location-icon',
    html: `
      <div class="user-location-marker-container">
        <div class="user-location-pulse-ring"></div>
        <div class="user-location-accuracy-ring"></div>
        <div class="user-location-dot"></div>
      </div>
    `,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
};

/**
 * Watches the user's coordinates in real time via the browser Geolocation API.
 * Returns the numeric watch ID, or null on failure.
 */
export const watchUserCoordinates = (onSuccess, onError, options = {}) => {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    onError?.({
      errorCode: 1,
      errorReason: 'insecure-context',
      errorMessage: 'Geolocation is restricted to secure contexts (HTTPS or localhost).',
    });
    return null;
  }

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onError?.({
      errorCode: 2,
      errorReason: 'unsupported',
      errorMessage: 'Geolocation is not supported by this browser.',
    });
    return null;
  }

  const defaultOptions = {
    enableHighAccuracy: true,
    timeout: 12000,
    maximumAge: 4000,
    ...options,
  };

  try {
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (pos?.coords && Number.isFinite(pos.coords.latitude) && Number.isFinite(pos.coords.longitude)) {
          onSuccess({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            heading: pos.coords.heading,
            speed: pos.coords.speed,
            timestamp: pos.timestamp,
          });
        }
      },
      (err) => {
        onError?.({
          errorCode: err?.code,
          errorReason: err?.code === 1 ? 'denied' : err?.code === 3 ? 'timeout' : 'unavailable',
          errorMessage: err?.message || 'Could not acquire position.',
        });
      },
      defaultOptions
    );
    return watchId;
  } catch (err) {
    onError?.({
      errorCode: 2,
      errorReason: 'unavailable',
      errorMessage: err?.message || 'Failed to watch position.',
    });
    return null;
  }
};

/**
 * Safely clears an active geolocation watch subscription.
 */
export const clearUserCoordinatesWatch = (watchId) => {
  if (watchId !== null && watchId !== undefined && typeof navigator !== 'undefined' && navigator.geolocation) {
    try {
      navigator.geolocation.clearWatch(watchId);
    } catch {
      // ignore
    }
  }
};