// Initializes Firebase services (Auth, Firestore, Functions, Storage, Analytics, and Realtime Database).
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAnalytics } from 'firebase/analytics';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { connectDatabaseEmulator, getDatabase } from 'firebase/database';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

// Read configuration environment variables.
const env = import.meta.env || {};

// Check if running against local Firebase emulators for testing.
const emulatorHost = typeof process !== 'undefined' ? String(process.env.FIRESTORE_EMULATOR_HOST || '') : '';
const usingEmulator = env.VITE_FIREBASE_EMULATOR === '1' || Boolean(emulatorHost);

// Google Analytics measurement ID (e.g. G-XXXXXXXXXX).
const measurementId = String(env.VITE_FIREBASE_MEASUREMENT_ID || '').trim();

// Project ID for cloud resources and local emulator namespaces.
const projectId =
  env.VITE_FIREBASE_PROJECT_ID ||
  (usingEmulator ? String((typeof process !== 'undefined' && process.env.GCLOUD_PROJECT) || 'demo-station-portal') : undefined);

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY || (usingEmulator ? 'demo-api-key' : undefined),
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId,
  appId: env.VITE_FIREBASE_APP_ID || (usingEmulator ? 'demo-app-id' : undefined),
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  measurementId: measurementId || undefined,
  databaseURL: env.VITE_FIREBASE_DATABASE_URL || (usingEmulator ? `http://127.0.0.1:9000?ns=${projectId}` : undefined),
};

// Returns true if Firebase settings are present in the build.
let reported = false;
export const firebaseConfigured = () => {
  const configured = Boolean(config.apiKey && config.projectId && config.appId);
  if (!reported) {
    reported = true;
    console.info(
      configured
        ? `[firebase] configured for ${config.projectId}${usingEmulator ? ' (emulators)' : ''}.`
        : '[firebase] no Firebase config in this build, so nothing can be read or written: there is no sheet behind the app any more. If .env has the values, restart the dev server: Vite reads it at startup only.'
    );
  }
  return configured;
};

let app = null;

const appCheckSiteKey = String(env.VITE_FIREBASE_APPCHECK_SITE_KEY || '').trim();
const appCheckDebugToken = String(env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN || '').trim();

// Detects local developer machines to prevent invalid reCAPTCHA checks.
const loopbackOrigin = () => {
  const host = typeof window === 'undefined' ? '' : String(window.location.hostname || '');
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
};

// Returns the shared Firebase app instance.
export const firebaseApp = () => {
  if (!app) {
    app = getApps().length ? getApp() : initializeApp(config);

    // Initialize App Check for security against unauthorized requests.
    if (appCheckSiteKey && !usingEmulator && typeof window !== 'undefined') {
      if (!appCheckDebugToken && loopbackOrigin()) {
        console.info(
          '[appcheck] not enabled here: this is a loopback origin with no VITE_FIREBASE_APPCHECK_DEBUG_TOKEN, so ' +
            'reCAPTCHA has nothing to attest and every request would fail with appCheck/recaptcha-error - which the ' +
            'SDK never backs off from, so it floods. Either put a debug token in .env (Firebase console > App Check ' +
            '> your app > Manage debug tokens), or add "localhost" to the site key\'s supported domains in the Google ' +
            'Cloud console. Requests go unverified meanwhile, which is what development wants; the App Check console ' +
            'still reports them.'
        );
      } else {
        try {
          if (appCheckDebugToken) window.FIREBASE_APPCHECK_DEBUG_TOKEN = appCheckDebugToken;
          initializeAppCheck(app, {
            provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
            isTokenAutoRefreshEnabled: true,
          });
        } catch (error) {
          console.warn('[appcheck] could not initialise App Check:', error && error.message);
        }
      }
    }

    // Initialize Google Analytics if configured.
    if (measurementId && !usingEmulator && typeof window !== 'undefined') {
      if (loopbackOrigin()) {
        console.info(
          '[analytics] not counting this visit: a loopback origin is a developer\'s browser rather than a station user.'
        );
      } else {
        try {
          getAnalytics(app);
        } catch (error) {
          console.warn('[analytics] could not initialise Google Analytics:', error && error.message);
        }
      }
    }
  }
  return app;
};

let authInstance = null;
let firestoreInstance = null;
let functionsInstance = null;
let storageInstance = null;
let databaseInstance = null;

// Returns the Firebase Authentication service.
export const firebaseAuth = () => {
  if (!authInstance) {
    authInstance = getAuth(firebaseApp());
    if (usingEmulator) connectAuthEmulator(authInstance, 'http://127.0.0.1:9099', { disableWarnings: true });
  }
  return authInstance;
};

// Configures browser cache storage for offline capability across multiple browser tabs.
const browserCache = () => {
  try {
    return persistentLocalCache({ tabManager: persistentMultipleTabManager() });
  } catch (error) {
    console.info(
      '[firebase] the persistent cache is unavailable here, so this session runs from memory:',
      error && error.message
    );
    return memoryLocalCache();
  }
};

// Returns the Cloud Firestore database instance.
export const firestore = () => {
  if (!firestoreInstance) {
    firestoreInstance = initializeFirestore(firebaseApp(), {
      localCache: usingEmulator ? memoryLocalCache() : browserCache(),
      experimentalAutoDetectLongPolling: true,
    });
    if (usingEmulator) connectFirestoreEmulator(firestoreInstance, '127.0.0.1', 8080);
  }
  return firestoreInstance;
};

// Returns the Cloud Functions service for server-side actions.
export const firebaseFunctions = () => {
  if (!functionsInstance) {
    functionsInstance = getFunctions(firebaseApp());
    if (usingEmulator) connectFunctionsEmulator(functionsInstance, '127.0.0.1', 5001);
  }
  return functionsInstance;
};

// Returns the Cloud Storage bucket service for uploaded files.
export const firebaseStorage = () => {
  if (!storageInstance) {
    const bucket = String(env.VITE_FIREBASE_STORAGE_BUCKET || '').trim() || (usingEmulator ? `${config.projectId}.appspot.com` : undefined);
    storageInstance = getStorage(firebaseApp(), bucket);
    if (usingEmulator) connectStorageEmulator(storageInstance, '127.0.0.1', 9199);
  }
  return storageInstance;
};

// Returns true if cloud file storage is enabled.
export const storageConfigured = () =>
  Boolean(String(env.VITE_FIREBASE_STORAGE_BUCKET || '').trim()) || usingEmulator;

// Returns the Realtime Database instance for user presence and typing indicators.
export const firebaseDatabase = () => {
  if (!databaseInstance) {
    databaseInstance = getDatabase(firebaseApp());
    if (usingEmulator) connectDatabaseEmulator(databaseInstance, '127.0.0.1', 9000);
  }
  return databaseInstance;
};

// Returns true if Realtime Database is enabled.
export const realtimeConfigured = () =>
  Boolean(String(env.VITE_FIREBASE_DATABASE_URL || '').trim()) || usingEmulator;
