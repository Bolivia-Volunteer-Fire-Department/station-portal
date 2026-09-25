// The "choose a new password at your next sign-in" flag.
//
// One column on the users sheet, ticked by an administrator (Administration → Users) so a member who has just
// been given a temporary password cannot carry on with it. The server refuses nothing until the change is made -
// it is the app that holds the member at a modal - so the rules about what counts as the flag, and what counts
// as a usable new password, live here where they can be tested.

export const MUST_CHANGE_PASSWORD_COLUMN = 'is_change_password_on_login';

// Tolerant on purpose: this arrives from a spreadsheet cell somebody may have typed into by hand, and a blank
// or unrecognised value is off. TRUE is what the app writes, so that is what to expect.
export const mustChangePassword = (user) => {
  const raw = String(user?.[MUST_CHANGE_PASSWORD_COLUMN] ?? '').trim().toUpperCase();
  return raw === 'TRUE' || raw === 'YES' || raw === '1';
};

// Why a new password cannot be accepted, or '' when it can.
//
// This mirrors what the server will actually do rather than inventing policy: the backend refuses a blank
// password (it could never sign in) and nothing else, so there is no length or complexity rule here to disagree
// with it. The confirmation match is the one thing the client has to do, because the server is only sent the
// new password - and the typo it catches is the reason a forced change needs confirming at all.
export const passwordChangeProblem = ({ newPassword, confirmPassword } = {}) => {
  const chosen = String(newPassword ?? '');
  const repeated = String(confirmPassword ?? '');

  if (!chosen) return 'Choose a new password.';
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
