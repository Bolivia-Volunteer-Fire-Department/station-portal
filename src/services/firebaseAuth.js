// Signing in, the Firebase way, and the officer-only account work around it.
//
// A member types a username; the address the app signs in with is that username plus the department's synthetic
// domain. Nothing is ever sent there - the domain is RFC-reserved - so password resets cannot go by email and are
// officer-driven instead (see the callables in functions/index.js). That is the accountability the department asked
// for, and it is also what lets this file offer no reset-by-email path at all.
import { getIdTokenResult, onAuthStateChanged, signInWithEmailAndPassword, signOut as firebaseSignOut } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { firebaseAuth, firebaseConfigured, firebaseFunctions, firestore } from './firebase.js';
import { passwordChangeRequired } from '../utils/passwordPolicy.js';
import { doc, getDoc } from 'firebase/firestore';

// MUST MATCH EMAIL_DOMAIN in functions/index.js: the function creates the account under this domain, and the client
// derives the same address to sign in with. Changing one without the other locks everybody out.
export const EMAIL_DOMAIN = 'boliviavfd.invalid';

export const syntheticEmail = (username) => `${String(username || '').trim().toLowerCase()}@${EMAIL_DOMAIN}`;

export const signInWithUsername = (username, password) =>
  signInWithEmailAndPassword(firebaseAuth(), syntheticEmail(username), password);

// Signing in to Firebase ALONGSIDE the app's own session, and never failing the login because of it.
//
// The move is phased: the app still signs in through Apps Script and still reads everything from the sheet, and
// features are switched to Firestore one at a time. So a Firebase sign-in that does not succeed means "that feature
// is not available yet", not "you cannot sign in" - and it must never be able to produce the second message. The
// likeliest reason it will not succeed during the move is mundane: a member's Auth account holds the temporary
// password from the migration while the sheet still holds their old one, so the app accepts a password Firebase does
// not. That is expected for the legacy rows this table may still hold (see the README's data-model section), and it is logged rather than
// shown.
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

// A document read that is allowed to hiccup once. Firestore's first getDoc after a sign-in opens a Listen channel,
// and that channel failing is an ordinary event - the SDK re-establishes it - so a single retry turns "the login did
// not work" into "the login worked".
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

// Signing in FOR REAL: Firebase decides, and the account comes from the database.
//
// This returns the shape api.js callers already read - success, user, token - because the login screen hands `user`
// straight to setCurrentUser and the app reads its roster fields. The roster row and the private half are two
// documents, and the private one carries `is_change_password_on_login`, which is what raises the change-your-password
// screen after an officer reset: leaving it out would let a member past a forced change.
export const signInAsMember = async (username, password) => {
  await signInWithUsername(username, password);

  const account = await call('whoami', {});

  // The account is what matters and it is already in hand. These two documents are cosmetic by comparison - the
  // payload that loads next carries the roster - so a hiccup here must NOT fail the login, which would push the
  // member back to the sheet and their old password. It logs instead, and the name falls back to the username.
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
      // EITHER COPY IS ENOUGH TO ASK, and that is the whole point of asking both. See `passwordChangeRequired` for why
      // the rule is an OR and why it fails closed: the column is fetched by a read that is allowed to fail, and `false`
      // is the answer that lets somebody past a forced password change.
      is_change_password_on_login: passwordChangeRequired({
        column: secret.is_change_password_on_login,
        claim: account.mustChangePassword,
      }),
    },
    // The session token the app holds, and it has to be a real one: `applyToken` in App.jsx treats an empty string as
    // no session (it guards the admin refresh wave, and it is passed to every screen as the `token` prop). It used to
    // be the Apps Script session token, fetched after this sign-in so that the calls which had not moved yet could
    // authenticate; nothing needs that now, so it is the Firebase ID token - which is what a session token means here
    // (Firestore is authenticated by the session itself, not by this string).
    token: await getIdTokenResult(firebaseAuth().currentUser).then((result) => result.token),
  };
};

// The other half, and the one that matters on a shared station computer: a Firebase session that outlives the app's
// logout would leave the next person holding a token the rules still honour. Never throws, and does nothing when
// nobody is signed in.
export const signOutAlongside = async () => {
  if (!firebaseConfigured()) return;
  try {
    await signOut();
  } catch (error) {
    console.info(`[firebase] sign-out did not complete (${(error && error.code) || 'unknown'}).`);
  }
};

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

// The server changes the Auth password and clears both forced-change flags only after that succeeds.
export const changeOwnPassword = (newPassword) => call('completePasswordChange', { newPassword });

// What the app asks after signing in, before it decides what to draw.
export const fetchAccountState = () => call('whoami', {});

// Officer-only. Each of these refuses on the server for a caller without can_edit_users, whatever the client shows.
export const createMember = (data) => call('createMember', data);
export const resetMemberPassword = (data) => call('resetMemberPassword', data);
export const setMemberStatus = (data) => call('setMemberStatus', data);
// The username and the password-change flag: the two facts about an account that a browser must not write, and a
// rename has to move the Auth address with it.
export const updateMemberAccount = (data) => call('updateMemberAccount', data);
