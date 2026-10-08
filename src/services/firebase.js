// Where the Firebase SDK is initialised (see the README's data-model section for the shape it serves).
//
// The config is NOT a secret: a Firebase web config is public by design, and the project is protected by
// firestore.rules and App Check rather than by hiding these values. They arrive at build time from .env (see
// .env.example), which also removes the round trip through system_settings that hands the browser its config today.
//
// Everything here is lazy, so importing this module costs nothing until the app is actually configured. (This used to say
// that without the VITE_FIREBASE_* values "the app stays entirely on Apps Script" - there is no sheet to stay on any more,
// so an unconfigured build is a build that cannot reach its data, which is what `firebaseConfigured()` says out loud.)
import { getApp, getApps, initializeApp } from 'firebase/app';
// The one analytics call in the app. It is imported rather than required lazily because the entry point is safe in Node -
// checked, not assumed: the harnesses load this module to assert the wiring, and an import that threw there would take
// every one of them down.
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
import { connectStorageEmulator, getStorage } from 'firebase/storage';

// `import.meta.env` is Vite's, so it is absent when a Node harness imports this module to check the wiring (see
// scripts/verify-firebase-auth.mjs). Reading through this makes the module importable in both places rather than
// throwing where the config is irrelevant.
const env = import.meta.env || {};

// A Node harness (scripts/verify-firestore-reads.mjs) runs under `firebase emulators:exec`, which exports the
// emulator host into the environment. That is the signal to configure the demo project rather than throw about a
// missing config: a test should not need a .env, and the browser path still requires the real one.
const emulatorHost = typeof process !== 'undefined' ? String(process.env.FIRESTORE_EMULATOR_HOST || '') : '';
const usingEmulator = env.VITE_FIREBASE_EMULATOR === '1' || Boolean(emulatorHost);

// The Google Analytics measurement id (`G-XXXXXXXXXX`), PUBLIC by design like the rest of the web config. EMPTY in every
// build that has not enabled Analytics in the console, and that emptiness is what switches the reporting off - there is no
// second switch to keep in step. Declared above `config` rather than beside the App Check values below, because the
// config object is built at module load and a `const` declared after it would be in its temporal dead zone.
const measurementId = String(env.VITE_FIREBASE_MEASUREMENT_ID || '').trim();

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY || (usingEmulator ? 'demo-api-key' : undefined),
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:
    env.VITE_FIREBASE_PROJECT_ID ||
    (usingEmulator ? String((typeof process !== 'undefined' && process.env.GCLOUD_PROJECT) || 'demo-station-portal') : undefined),
  appId: env.VITE_FIREBASE_APP_ID || (usingEmulator ? 'demo-app-id' : undefined),
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  // Carried on the app's own options, which is where the SDK looks for it: `getAnalytics` reports nothing without one.
  measurementId: measurementId || undefined,
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
        : '[firebase] no Firebase config in this build, so nothing can be read or written: there is no sheet behind the app any more. If .env has the values, restart the dev server: Vite reads it at startup only.'
    );
  }
  return configured;
};

let app = null;

// APP CHECK: the site key, and the debug token that is only ever for local development (see the README, App Check).
//
// TWO THINGS ABOUT THE WEB SDK THAT COST AN AFTERNOON IF YOU DO NOT KNOW THEM:
//
//   - TOKENS DO NOT REFRESH THEMSELVES. The default for `isTokenAutoRefreshEnabled` is FALSE, and an expired token is a
//     request that FAILS once enforcement is switched on - so passing it is not a nicety.
//   - LOCALHOST IS NOT A VALID SITE, so local development uses the debug provider. That token is a credential for this
//     project: it must never reach a production build, which is why it is a separate opt-in variable rather than something
//     the site key implies.
const appCheckSiteKey = String(env.VITE_FIREBASE_APPCHECK_SITE_KEY || '').trim();
const appCheckDebugToken = String(env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN || '').trim();

// Whether this origin is one Google could possibly attest. reCAPTCHA will not score a loopback origin
// unless `localhost` is listed by name on the key's supported domains, and App Check's own answer for
// development is the debug token, which skips attestation altogether. Anything else - the Pages host, a
// custom domain - is a real site and is left to prove itself.
const loopbackOrigin = () => {
  const host = typeof window === 'undefined' ? '' : String(window.location.hostname || '');
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
};

export const firebaseApp = () => {
  // Reuse an app that already exists rather than initialising a second one: a Node harness imports this module after
  // creating its own, and two apps cannot both be named '[DEFAULT]'. Whoever gets there first wins, and everybody
  // else shares it - which is also what keeps the auth state and the database instance the same in both.
  if (!app) {
    app = getApps().length ? getApp() : initializeApp(config);
    // Attached HERE so it is in place before any client asks for a token: Auth, Firestore and the callables all come through
    // this function first. Skipped in a harness (there is no browser to attest with, and the emulator does not verify App
    // Check at all) and skipped when no key is configured, so a build without one behaves exactly as it did before.
    if (appCheckSiteKey && !usingEmulator && typeof window !== 'undefined') {
      // ...AND THE REASON IT IS GUARDED rather than simply attempted. A site key with no debug token on a
      // loopback origin is App Check that cannot succeed: the reCAPTCHA script refuses to attest the origin,
      // `execute()` rejects, and every token request throws `appCheck/recaptcha-error`, with a 400 on
      // google.com/recaptcha/enterprise/clr beside it. Failing open is fine - App Check is a guard against
      // abuse, not a dependency, and the catch below already says so. What is NOT fine is that nothing backs
      // off: the provider's throttle only engages when Firebase's own exchange endpoint answers with a bad
      // status, and a reCAPTCHA failure never reaches that endpoint (firebase/firebase-js-sdk#10385, on the
      // 12.19.0 pinned here). Auth then warns on every request it makes and the refresher keeps retrying, so
      // the same two lines fill the console until the tab is closed.
      //
      // Skipping is therefore the honest state rather than a workaround: with no debug token there is no
      // attestation to be had on a loopback origin, and pretending otherwise only buys noise. Production is
      // untouched - it is not a loopback origin - and neither is a local run that does have the debug token,
      // which is the supported way to develop against App Check (see the README, App Check).
      if (!appCheckDebugToken && loopbackOrigin()) {
        // SAID ONCE, and it can only be said once, because this whole block sits inside the `if (!app)` above.
        // Announced rather than silent for the reason `firebaseConfigured()` announces itself: a decision the
        // app makes about itself that nobody states is one the next person rediscovers from a console with
        // nothing in it.
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
          // A misconfigured App Check must not stop the station from working: it is a guard against abuse, not a dependency.
          // The App Check console reports unverified requests, so a failure here is visible without this throwing.
          console.warn('[appcheck] could not initialise App Check:', error && error.message);
        }
      }
    }

    // GOOGLE ANALYTICS: the daily-active-user count, and the only reporting the app does.
    //
    // IT IS OPT-IN BY VALUE. A measurement id is what enables it, so every build without one - which is every build until
    // somebody pastes the id into .env or the repository secrets - behaves exactly as it did before Analytics existed.
    // There is no separate flag to switch on and forget to switch off.
    //
    // A LOOPBACK ORIGIN IS SKIPPED, and that is a deliberate difference from App Check's guard rather than a copy of it: a
    // developer's own browser is not a station user, and counting it would quietly inflate the very number this exists to
    // report. The emulator is skipped for the same reason (it reports to no project), and a deployed site is neither, so a
    // real visit is counted.
    //
    // WHAT IS SENT: one page view per visit, and nothing else - the app never calls a logging helper, so no member's name,
    // screen or action leaves the browser. Tab switches are not page views either, because this is a single-page app: GA4
    // sees one view per visit, which is exactly what "daily active users" means. See the README's Analytics note.
    if (measurementId && !usingEmulator && typeof window !== 'undefined') {
      if (loopbackOrigin()) {
        // Said once, for the reason `firebaseConfigured()` announces itself: somebody running locally and seeing nothing
        // in GA4 should learn why from the console rather than from the source.
        console.info(
          '[analytics] not counting this visit: a loopback origin is a developer\'s browser rather than a station user.'
        );
      } else {
        try {
          getAnalytics(app);
        } catch (error) {
          // Like App Check, a failure here must not stop the station from working: reporting is not a dependency, and the
          // GA4 console shows whether a period is missing data.
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
// The bucket, for the certification scans - see firebaseStorage below for why the name cannot be guessed.
let storageInstance = null;

export const firebaseAuth = () => {
  if (!authInstance) {
    authInstance = getAuth(firebaseApp());
    if (usingEmulator) connectAuthEmulator(authInstance, 'http://127.0.0.1:9099', { disableWarnings: true });
  }
  return authInstance;
};

// The browser's cache, with a way out. `persistentLocalCache` reaches for IndexedDB, and a browser that refuses it -
// private mode, storage disabled, an embedded webview - must not take the app down with it: the in-memory cache is the same
// Firestore with the same behaviour on the wire, and what is lost is the offline gap rather than the app.
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

export const firestore = () => {
  if (!firestoreInstance) {
    // OFFLINE PERSISTENCE, which is the "dead spots" half of the offline rule (see the README): a station's coverage is patchy, and
    // with no local cache every read made in one is a FAILURE rather than a slightly old answer. `getDoc`/`getDocs` remain
    // server-first while there is a connection - the cache is what answers when there is not - so switching this on does
    // not weaken the rule the rest of the app is built on: a read after a write still sees the write, because the write
    // that just landed and the read that follows it are both online.
    //
    // THE MULTI-TAB MANAGER, not the single-tab one: two tabs of this portal open at once is normal (the calendar in one,
    // the clock in the other), and the single-tab cache takes the database away from whichever tab opens second.
    //
    // NOT IN THE EMULATOR - and not out of taste: the persistent cache IS IndexedDB, which does not exist in Node, so the
    // harnesses that import this module under `firebase emulators:exec` could not construct a database at all. They get
    // the in-memory cache: the same Firestore, with the same behaviour on the wire.
    firestoreInstance = initializeFirestore(firebaseApp(), {
      localCache: usingEmulator ? memoryLocalCache() : browserCache(),
    });
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

// THE BUCKET, for the one thing in this app that is a file rather than a row: the scan attached to a certification.
//
// The bucket NAME is not optional, and it is not guessable either. A Firebase project created after September 2024 has
// `<project>.firebasestorage.app` as its default bucket; an older one has `<project>.appspot.com`. `getStorage(app)`
// reads `storageBucket` off the app's options and, with none set, builds requests with no bucket in them at all - which
// fails at the first upload rather than at startup, so the value is required rather than derived. It comes from
// VITE_FIREBASE_STORAGE_BUCKET, exactly as public as the rest of the web config (a bucket name is not a secret; the
// rules are what protect it), and it is in the Firebase console's SDK snippet beside the others.
//
// In the emulator the bucket name is only a namespace - the emulator serves whatever it is asked for - so a demo one
// stands in, and storage.rules is what the rules harness runs against.
export const firebaseStorage = () => {
  if (!storageInstance) {
    const bucket = String(env.VITE_FIREBASE_STORAGE_BUCKET || '').trim() || (usingEmulator ? `${config.projectId}.appspot.com` : undefined);
    storageInstance = getStorage(firebaseApp(), bucket);
    if (usingEmulator) connectStorageEmulator(storageInstance, '127.0.0.1', 9199);
  }
  return storageInstance;
};

// Whether a build can reach the bucket at all, which is what the certification-attachment screen asks before offering
// an Upload button it could not honour. Public, because anything that fails at the first byte uploaded should be able
// to say so before somebody chooses a file.
export const storageConfigured = () =>
  Boolean(String(env.VITE_FIREBASE_STORAGE_BUCKET || '').trim()) || usingEmulator;
