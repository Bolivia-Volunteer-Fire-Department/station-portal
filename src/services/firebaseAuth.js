// Signing in, the Firebase way, and the officer-only account work around it.
//
// A member types a username; the address the app signs in with is that username plus the department's synthetic
// domain. Nothing is ever sent there - the domain is RFC-reserved - so password resets cannot go by email and are
// officer-driven instead (see the callables in functions/index.js). That is the accountability the department asked
// for, and it is also what lets this file offer no reset-by-email path at all.
import { getIdTokenResult, onAuthStateChanged, signInWithEmailAndPassword, signOut as firebaseSignOut, updatePassword } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { firebaseAuth, firebaseFunctions } from './firebase.js';

// MUST MATCH EMAIL_DOMAIN in functions/index.js: the function creates the account under this domain, and the client
// derives the same address to sign in with. Changing one without the other locks everybody out.
export const EMAIL_DOMAIN = 'boliviavfd.invalid';

export const syntheticEmail = (username) => `${String(username || '').trim().toLowerCase()}@${EMAIL_DOMAIN}`;

export const signInWithUsername = (username, password) =>
  signInWithEmailAndPassword(firebaseAuth(), syntheticEmail(username), password);

export const signOut = () => firebaseSignOut(firebaseAuth());

// `watchAccount` reports the signed-in account, or null, and keeps doing so across token refreshes and sign-outs.
export const watchAccount = (callback) => onAuthStateChanged(firebaseAuth(), callback);

// Who the member is, per the Auth record rather than the token: the claims are refreshed on demand, so a role
// change or a password reset flag is picked up on the next call rather than whenever the token happens to renew.
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

const call = async (name, data) => {
  const result = await httpsCallable(firebaseFunctions(), name)(data);
  return result.data;
};

// The member's own: change the password, then tell the server the flag can come off. The server call is what
// clears it - the claim is not something a client can write.
export const changeOwnPassword = async (newPassword) => {
  await updatePassword(firebaseAuth().currentUser, newPassword);
  await call('completePasswordChange', {});
};

// What the app asks after signing in, before it decides what to draw.
export const fetchAccountState = () => call('whoami', {});

// Officer-only. Each of these refuses on the server for a caller without can_edit_users, whatever the client shows.
export const createMember = (data) => call('createMember', data);
export const resetMemberPassword = (data) => call('resetMemberPassword', data);
export const setMemberStatus = (data) => call('setMemberStatus', data);
