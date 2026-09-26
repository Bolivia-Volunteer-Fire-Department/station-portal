// The words used where a record has no label of its own.
//
// Every place that calls this used to print the record's id instead - "Member #9f2c1e0a-1b3d-..." in a table, in a
// filter dropdown, in a printed schedule, or under an announcement as its author. An id is not a name: nobody can
// compare two of them by eye, they are longer than the column they sit in, and they are the kind of thing that
// quietly shows whoever is looking at the screen how the records are keyed. A record with no name now reads as what
// it is, and the id stays where it belongs - in the data.
//
// The noun is the thing being named, in the singular: 'member', 'role', 'rank'.
export const unnamedLabel = (noun) => `Unnamed ${noun}`;

// A member's name from a user row, in the order the whole app uses: their preferred name, then the sign-in name,
// then the phrase above. One helper so a half-filled row reads the same everywhere rather than differently per tab.
export const userLabel = (user) =>
  String(user?.name ?? '').trim() || String(user?.user_name ?? '').trim() || unnamedLabel('member');

// The heading for an edit form: "Edit Chainsaw Ticket".
//
// It used to carry the record's id - "Edit User #9f2c1e0a-..." - above a form that already contains the record, so
// it named the row in the one way nobody recognises it. Where a record has a name, the name identifies it; where it
// does not (a new one, or a blank field), the plain noun is clearer than a UUID.
export const recordHeading = (noun, label) => `Edit ${String(label ?? '').trim() || noun}`;
