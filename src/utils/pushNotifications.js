// Push notifications for Station Portal.
//
// The Firebase web config lives in the `system_settings` sheet (key
// `fcm_web_config`, a JSON blob) rather than in Vite env vars, so a station
// admin can turn notifications on without a rebuild. Only public values live
// there - the service-account private key used to *send* messages stays in the
// sheet too but is never shipped to the browser.
//
// The Firebase SDK is used purely to mint an FCM registration token; delivery
// and display are handled by public/sw.js plus the Apps Script backend.

const FIREBASE_APP_NAME = 'station-portal-push';

// Load the Firebase SDK on demand: it is only needed while a member turns
// notifications on (or off) for a device, so the ~140 kB of messaging code
// stays out of the initial bundle for everyone else.
let firebaseModulePromise = null;
function loadFirebase() {
  if (!firebaseModulePromise) {
    firebaseModulePromise = Promise.all([import('firebase/app'), import('firebase/messaging')]);
  }
  return firebaseModulePromise;
}

export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function notificationPermission() {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission;
}

// `fcm_web_config` is stored as JSON in a single system_settings value; we also
// accept the individual keys as a fallback so either shape works in the sheet.
export function parseWebConfig(systemSettings) {
  const raw = systemSettings?.fcm_web_config;

  if (raw) {
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (text) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && parsed.apiKey && parsed.projectId && parsed.appId) return parsed;
      } catch (err) {
        console.warn('[push] fcm_web_config is not valid JSON:', err.message);
      }
    }
  }

  const { fcm_api_key, fcm_auth_domain, fcm_project_id, fcm_storage_bucket, fcm_messaging_sender_id, fcm_app_id } = systemSettings || {};
  if (fcm_api_key && fcm_project_id && fcm_app_id) {
    return {
      apiKey: fcm_api_key,
      authDomain: fcm_auth_domain || '',
      projectId: fcm_project_id,
      storageBucket: fcm_storage_bucket || '',
      messagingSenderId: fcm_messaging_sender_id || '',
      appId: fcm_app_id,
    };
  }

  return null;
}

export function vapidKeyFrom(systemSettings) {
  return String(systemSettings?.fcm_vapid_public_key || '').trim();
}

// Registered at the deployed base path (/ locally, /station-portal/ on Pages).
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  const base = import.meta.env.BASE_URL || '/';
  const registration = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
  await navigator.serviceWorker.ready;
  return registration;
}

function firebaseAppFor(appModule, webConfig) {
  const existing = appModule.getApps().find((app) => app.name === FIREBASE_APP_NAME);
  if (existing) return existing;
  return appModule.initializeApp(webConfig, FIREBASE_APP_NAME);
}

// Requests permission (must be called from a user gesture), registers the
// worker and returns the FCM registration token for this device.
export async function enablePushNotifications(webConfig, vapidKey) {
  if (!pushSupported()) {
    throw new Error('This browser does not support push notifications.');
  }
  if (!webConfig) {
    throw new Error('Firebase web configuration is missing. Ask an admin to finish FCM setup.');
  }
  if (!vapidKey) {
    throw new Error('The FCM VAPID public key is missing. Ask an admin to finish FCM setup.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted in this browser.');
  }

  const [appModule, messagingModule] = await loadFirebase();

  const supported = await messagingModule.isSupported().catch(() => true);
  if (!supported) {
    throw new Error('This browser does not support Firebase Cloud Messaging.');
  }

  const registration = await registerServiceWorker();
  const messaging = messagingModule.getMessaging(firebaseAppFor(appModule, webConfig));

  const token = await messagingModule.getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration: registration || undefined,
  });

  if (!token) {
    throw new Error('Firebase did not return a device token. Check the FCM web configuration.');
  }

  return token;
}

// Turns this device off: releases the browser's push subscription, which is
// what actually stops delivery.
//
// The FCM SDK's deleteToken() is deliberately not called. Unlike getToken() it
// takes no serviceWorkerRegistration option, so it insists on finding a
// firebase-messaging-sw.js at the site root - a file this app does not ship
// (public/sw.js is registered instead). It therefore throws
// "unsupported MIME type" before making any server call, which is pure noise.
//
// Re-enabling still produces a fresh token without any cleanup here: the SDK
// caches tokens in IndexedDB and isTokenValid() compares the stored push
// endpoint with the current one, so a new subscription invalidates the cache.
export async function disablePushNotifications() {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    if (subscription) await subscription.unsubscribe();
  } catch (err) {
    console.warn('[push] unsubscribe failed:', err.message);
  }

  return true;
}
