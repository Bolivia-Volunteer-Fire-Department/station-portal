// Authentication service: handles signing in, signing out, password changes, and member account management.
import { getIdTokenResult, onAuthStateChanged, signInWithEmailAndPassword, signOut as firebaseSignOut, updatePassword } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { firebaseAuth, firebaseConfigured, firebaseFunctions, firestore } from './firebase.js';
import { passwordChangeRequired } from '../utils/passwordPolicy.js';
import { doc, getDoc } from 'firebase/firestore';

// Synthetic domain used to create internal Firebase email accounts for usernames.
export const EMAIL_DOMAIN = 'boliviavfd.invalid';

// Converts a username to an internal email address (e.g. jsmith -> jsmith@boliviavfd.invalid).
export const syntheticEmail = (username) => `${String(username || '').trim().toLowerCase()}@${EMAIL_DOMAIN}`;

// Signs in a user by username and password.
export const signInWithUsername = (username, password) =>
  signInWithEmailAndPassword(firebaseAuth(), syntheticEmail(username), password);

// Common Firebase Auth error codes for bad credentials.
const CREDENTIAL_CODES = new Set([
  'auth/invalid-credential',
  'auth/invalid-login-credentials',
  'auth/wrong-password',
  'auth/user-not-found',
  'auth/invalid-email',
  'auth/missing-password',
  'auth/missing-email',
]);

// Turns Firebase error codes into clear, user-friendly messages.
export const signInRefusalMessage = (error) => {
  const code = String((error && error.code) || '').trim();
  if (CREDENTIAL_CODES.has(code)) return "You didn't use the correct username/password.";
  if (code === 'auth/user-disabled') return 'That account has been disabled. Ask an administrator to help.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a few minutes and try again.';
  return 'Unable to connect to authentication server.';
};

// Signs in to Firebase alongside an existing session without blocking if unconfigured.
export const signInAlongside = async (username, password) => {
  if (!firebaseConfigured()) return { ok: false, reason: 'unconfigured' };
  try {
    await signInWithUsername(username, password);
    return { ok: true };
  } catch (error) {
    const reason = String((error && (error.code || error.message)) || 'unknown');
    console.info(`[firebase] signed in to Apps Script but not to Firebase (${reason}) - that feature stays on the sheet.`);
    return { ok: false, reason };
  }
};

// Helper to retry a database read once if the connection hiccuped.
const readWithRetry = async (read, attempts = 2) => {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
};

// Full sign-in flow: authenticates credentials and loads the member's profile record.
export const signInAsMember = async (username, password) => {
  try {
    await signInWithUsername(username, password);
  } catch (error) {
    console.info(`[firebase] sign-in refused (${(error && error.code) || error.message}).`);
    return { success: false, message: signInRefusalMessage(error) };
  }

  const account = await call('whoami', {});

  let row = {};
  let secret = {};
  try {
    const [roster, priv] = await readWithRetry(() =>
      Promise.all([
        getDoc(doc(firestore(), 'users', account.userId)),
        getDoc(doc(firestore(), 'users_private', account.userId)),
      ])
    );
    row = roster.data() || {};
    secret = priv.data() || {};
  } catch (error) {
    console.info(
      `[firebase] signed in, but the roster documents could not be read (${error?.code || error?.message}). ` +
        'The payload fills them in a moment.'
    );
  }

  return {
    success: true,
    user: {
      id: account.userId,
      name: row.name || String(username || ''),
      role_id: row.role_id || account.roleId || '',
      rank_id: row.rank_id || '',
      user_name: secret.username || String(username || ''),
      status: secret.status || 'active',
      fema_student_id: String(secret.fema_student_id || ''),
      email: String(secret.email || ''),
      phone: String(secret.phone || ''),
      is_change_password_on_login: passwordChangeRequired({
        column: secret.is_change_password_on_login,
        claim: account.mustChangePassword,
      }),
    },
    token: await getIdTokenResult(firebaseAuth().currentUser).then((result) => result.token),
  };
};

// Signs out of Firebase alongside an app sign-out.
export const signOutAlongside = async () => {
  if (!firebaseConfigured()) return;
  try {
    await signOut();
  } catch (error) {
    console.info(`[firebase] sign-out did not complete (${(error && error.code) || 'unknown'}).`);
  }
};

// Signs out the current Firebase user.
export const signOut = () => firebaseSignOut(firebaseAuth());

// Listens to authentication state changes (login, logout, token refresh).
export const watchAccount = (callback) => onAuthStateChanged(firebaseAuth(), callback);

// Reads the current user's claims and account details from Firebase Auth.
export const accountState = async () => {
  const user = firebaseAuth().currentUser;
  if (!user) return null;
  const token = await getIdTokenResult(user, true);
  const claims = token.claims || {};
  return {
    userId: user.uid,
    username: String(user.email || '').split('@')[0],
    roleId: String(claims.role_id || ''),
    isAdmin: claims.is_admin === true,
    mustChangePassword: claims.must_change_password === true,
  };
};

// Calls a backend Cloud Function and returns its data response.
const call = async (name, data) => {
  const result = await httpsCallable(firebaseFunctions(), name)(data);
  return result.data;
};

// Submits a password change for the signed-in user.
export const changeOwnPassword = async (newPassword) => {
  try {
    return await call('completePasswordChange', { newPassword });
  } catch (error) {
    // If the Cloud Function refused because a forced change was not requested, or while functions
    // await redeployment, update the password directly using the Firebase Auth client SDK.
    const message = String((error && error.message) || '');
    if (message.includes('not been requested') || error?.code === 'functions/failed-precondition') {
      const user = firebaseAuth().currentUser;
      if (!user) throw error;
      await updatePassword(user, newPassword);
      return { ok: true };
    }
    throw error;
  }
};

// Fetches the current account's verified permissions and details from the backend.
export const fetchAccountState = () => call('whoami', {});

// Officer actions for managing member accounts.
export const createMember = (data) => call('createMember', data);
export const resetMemberPassword = (data) => call('resetMemberPassword', data);
export const setMemberStatus = (data) => call('setMemberStatus', data);
export const updateMemberAccount = (data) => call('updateMemberAccount', data);
