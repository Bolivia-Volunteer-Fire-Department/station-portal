// Where the Firebase SDK is initialised, for the move off Google Sheets (see docs/FIRESTORE_MODEL.md).
//
// The config is NOT a secret: a Firebase web config is public by design, and the project is protected by
// firestore.rules and App Check rather than by hiding these values. They arrive at build time from .env (see
// .env.example), which also removes the round trip through system_settings that hands the browser its config today.
//
// Everything here is lazy, so importing this module costs nothing until the app is actually configured - until the
// VITE_FIREBASE_* values exist, the app stays entirely on Apps Script and none of this is reached.
import { getApp, getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';

// `import.meta.env` is Vite's, so it is absent when a Node harness imports this module to check the wiring (see
// scripts/verify-firebase-auth.mjs). Reading through this makes the module importable in both places rather than
// throwing where the config is irrelevant.
const env = import.meta.env || {};

// A Node harness (scripts/verify-firestore-reads.mjs) runs under `firebase emulators:exec`, which exports the
// emulator host into the environment. That is the signal to configure the demo project rather than throw about a
// missing config: a test should not need a .env, and the browser path still requires the real one.
const emulatorHost = typeof process !== 'undefined' ? String(process.env.FIRESTORE_EMULATOR_HOST || '') : '';
const usingEmulator = env.VITE_FIREBASE_EMULATOR === '1' || Boolean(emulatorHost);

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY || (usingEmulator ? 'demo-api-key' : undefined),
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:
    env.VITE_FIREBASE_PROJECT_ID ||
    (usingEmulator ? String((typeof process !== 'undefined' && process.env.GCLOUD_PROJECT) || 'demo-station-portal') : undefined),
  appId: env.VITE_FIREBASE_APP_ID || (usingEmulator ? 'demo-app-id' : undefined),
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};

// Whether there is anything to talk to. A build without the config is a build that has not moved yet.
//
// Said ONCE, at the first question, because "why is nothing routing to Firestore?" is otherwise answered only by
// reading this file and src/services/firestoreRouting.js together. A build with no config reports itself and stays
// entirely on Apps Script - and the most common reason for that is not a wrong value but a stale process: Vite reads
// .env when the dev server STARTS, so a value added since is invisible until it restarts.
let reported = false;
export const firebaseConfigured = () => {
  const configured = Boolean(config.apiKey && config.projectId && config.appId);
  if (!reported) {
    reported = true;
    console.info(
      configured
        ? `[firebase] configured for ${config.projectId}${usingEmulator ? ' (emulators)' : ''}.`
        : '[firebase] no Firebase config in this build, so everything stays on Apps Script. If .env has the values, restart the dev server: Vite reads it at startup only.'
    );
  }
  return configured;
};

let app = null;

export const firebaseApp = () => {
  // Reuse an app that already exists rather than initialising a second one: a Node harness imports this module after
  // creating its own, and two apps cannot both be named '[DEFAULT]'. Whoever gets there first wins, and everybody
  // else shares it - which is also what keeps the auth state and the database instance the same in both.
  if (!app) app = getApps().length ? getApp() : initializeApp(config);
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
