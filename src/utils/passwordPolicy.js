// The "choose a new password at your next sign-in" flag.
//
// One column on the users sheet, ticked by an administrator (Administration → Users) so a member who has just
// been given a temporary password cannot carry on with it. The server refuses nothing until the change is made -
// it is the app that holds the member at a modal - so the rules about what counts as the flag, and what counts
// as a usable new password, live here where they can be tested.

export const MUST_CHANGE_PASSWORD_COLUMN = 'is_change_password_on_login';

// The claim's name for the same fact. It lives in the member's ID token, which is what the app can gate on without a
// read, and only a function can write it.
export const MUST_CHANGE_PASSWORD_CLAIM = 'must_change_password';

// Whether a member must choose a new password, given BOTH copies of the fact.
//
// THE FLAG IS STORED TWICE, because the two readers need different things: the claim travels in the token, and the
// column on `users_private` is what the Users tab shows an officer. They are written together - one function in
// `functions/index.js` owns both - so normally they agree, and this reads the same whichever way round they are.
//
// EITHER ONE IS ENOUGH TO ASK, and the direction is deliberate. At sign-in the column is fetched by a read that is
// ALLOWED TO FAIL (it must not push a member back to the login screen over a hiccup), and every other field on that
// page can safely fall back to something cosmetic. This one cannot: `false` is the answer that lets somebody past a
// forced password change, so a document that could not be read is not a reason to stop asking. That is why this is an
// OR rather than a preference for the column - it fails CLOSED.
export const passwordChangeRequired = ({ column, claim } = {}) => column === true || claim === true;

// Tolerant on purpose: this arrives from a spreadsheet cell somebody may have typed into by hand, and a blank
// or unrecognized value is off. TRUE is what the app writes, so that is what to expect.
export const mustChangePassword = (user) => {
  const raw = String(user?.[MUST_CHANGE_PASSWORD_COLUMN] ?? '').trim().toUpperCase();
  return raw === 'TRUE' || raw === 'YES' || raw === '1';
};

// Why a new password cannot be accepted, or '' when it can.
//
// Match the backend's eight-character minimum. The confirmation match is client-side because only the chosen
// password is sent to the server.
export const passwordChangeProblem = ({ newPassword, confirmPassword } = {}) => {
  const chosen = String(newPassword ?? '');
  const repeated = String(confirmPassword ?? '');

  if (!chosen) return 'Choose a new password.';
  if (chosen.length < 8) return 'Use at least 8 characters.';
  if (!repeated) return 'Repeat the new password to confirm it.';
  if (chosen !== repeated) return 'The two passwords do not match.';
  return '';
};

// What the modal tells the member about the password they are choosing. Static copy, kept beside the rule so the
// two cannot drift apart in tone.
export const passwordChangeCopy = () => ({
  title: 'Choose a new password',
  lead:
    'An administrator has asked you to set your own password. Until you do, this is the only thing you can do ' +
    'in the portal - everything else opens once your new password is saved.',
  hint: 'Pick something you will remember: there is no reset link, and a forgotten password has to be changed ' +
    'for you by an administrator.',
});
