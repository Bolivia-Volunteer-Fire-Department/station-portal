// The fields on a member's PRIVATE record that a browser may write - in one place, because THREE things have to agree
// about them: the Firestore rules (which name them in `affectedKeys().hasOnly(...)`), the writer (which refuses anything
// else out loud), and the two screens that edit them. scripts/verify-rules asserts the rules' own lists are exactly
// these, so the agreement is checked rather than assumed.
//
// MEMBER ID IS THE OFFICER'S ALONE. The station issues it and recycles it when somebody goes inactive, so it is not the
// member's to choose - which is why it is in the second list and not the first, and why it is absent from the sign-in
// shape (firebaseAuth) as well: a member's session does not carry it at all.
export const MEMBER_PRIVATE_FIELDS = ['fema_student_id', 'email', 'phone'];
export const MEMBER_PRIVATE_ADMIN_FIELDS = [...MEMBER_PRIVATE_FIELDS, 'member_id'];

// How long each may be, matching the rules' own limits so a value a form accepts is never refused on the way in - and so
// the two cannot drift into a field that saves in the app and fails at the database.
export const MEMBER_PRIVATE_LIMITS = { member_id: 20, fema_student_id: 40, email: 120, phone: 40 };
