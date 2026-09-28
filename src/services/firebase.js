// Where the Firebase SDK is initialised, for the move off Google Sheets (see docs/FIRESTORE_MODEL.md).
//
// The config is NOT a secret: a Firebase web config is public by design, and the project is protected by
// firestore.rules and App Check rather than by hiding these values. They arrive at build time from .env (see
// .env.example), which also removes the round trip through system_settings that hands the browser its config today.
//
// Everything here is lazy, so importing this module costs nothing until the app is actually configured - until the
// VITE_FIREBASE_* values exist, the app stays entirely on Apps Script and none of this is reached.
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';

// `import.meta.env` is Vite's, so it is absent when a Node harness imports this module to check the wiring (see
// scripts/verify-firebase-auth.mjs). Reading through this makes the module importable in both places rather than
// throwing where the config is irrelevant.
const env = import.meta.env || {};

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};

// Whether there is anything to talk to. A build without the config is a build that has not moved yet.
export const firebaseConfigured = () => Boolean(config.apiKey && config.projectId && config.appId);

// The emulator is opted into explicitly, never guessed at from the hostname, so a build cannot reach it by accident
// and a developer cannot forget they are on it.
const usingEmulator = env.VITE_FIREBASE_EMULATOR === '1';

let app = null;

export const firebaseApp = () => {
  if (!app) app = initializeApp(config);
  return app;
};

let authInstance = null;
let firestoreInstance = null;
let functionsInstance = null;

export const firebaseAuth = () => {
  if (!authInstance) {
    authInstance = getAuth(firebaseApp());
    if (usingEmulator) connectAuthEmulator(authInstance, 'http://127.0.0.1:9099', { disableWarnings: true });
  }
  return authInstance;
};

export const firestore = () => {
  if (!firestoreInstance) {
    firestoreInstance = getFirestore(firebaseApp());
    if (usingEmulator) connectFirestoreEmulator(firestoreInstance, '127.0.0.1', 8080);
  }
  return firestoreInstance;
};

// Callable functions only - the four in functions/index.js, which are the work a browser must not be trusted with.
export const firebaseFunctions = () => {
  if (!functionsInstance) {
    functionsInstance = getFunctions(firebaseApp());
    if (usingEmulator) connectFunctionsEmulator(functionsInstance, '127.0.0.1', 5001);
  }
  return functionsInstance;
};
