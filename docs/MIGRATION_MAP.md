# The Migration Map: the sheet as it actually is

Written from a read-only reconnaissance pass over the live spreadsheet ("Time Clock Database", 25 tabs) rather than
from the design document, because the two disagree in places and the sheet is what exists. The **security rules are
the authority** for collection names: they are what the app has to satisfy at runtime.

Most tabs are a column copy. The sections after the table are the ones that are not, and they are the whole reason
this document exists.

## Tab to collection

| sheet tab | becomes | notes |
|---|---|---|
| `users` | `users` + `users_private` | Split. `password` is NOT copied anywhere - it goes to Firebase Auth. `user_name` is renamed `username` and lives in the private half. |
| `roles` | `roles` | Straight copy, 30 permission flags plus `is_admin`. |
| `ranks` | `ranks` | Straight copy. `rank_order` is what expands "this rank or above". |
| `push_devices` | `push_devices` | Straight copy. Already per device. |
| `user_settings` | `user_settings` | Copy, minus `fcm_token` - see below. |
| `system_settings` | `settings/public` + `settings/private` | Split by key, and secrets are refused. See below. |
| `shifts` | `shifts` | Straight copy. |
| `apparatus` | `apparatus` | Straight copy. |
| `assignments` | `assignments` + `assignment_private` | Split: the private half is `admin_note`, which the sheet has no column for, so it starts empty. |
| `schedule_templates` | `schedule_templates` + `schedule_template_private` | Same treatment. |
| `schedule` | `schedule` | Copy plus a derived `is_open`. |
| `availability` | `availability` | Straight copy. |
| `timeclock` | `timeclock` | Copy of the 12 real columns; `Column 1`-`Column 14` are junk. |
| `timeclock` (open rows) | `on_duty` | Derived, not a tab: one document per member whose shift is open. |
| `schedule_offers` | `schedule_offers` | Copy plus a derived `slot_key`. |
| `events` | `events` | Copy plus a derived `audience_keys`. |
| `announcements` | `announcements` | Copy plus a derived `audience_keys`. |
| `documents` | `documents` | Copy. **These three have no rules - see the gaps below.** |
| `document_checklist_items` | `document_checklist_items` | Copy. |
| `document_signatures` | `document_signatures` | Copy. |
| `training` | `trainings` | **Renamed**: the rules and the readers say `trainings`, the sheet says `training`. |
| `training_signatures` | `training_signatures` | Straight copy. |
| `certifications` | `certifications` | Straight copy. |
| `certification_setup` | `certification_setup` | Straight copy. |
| `system_log` | `system_log` | **Not migrated, deliberately**: the rows were development noise rather than the station's history, so the collection starts empty and fills with real audit rows. `mintIds` for the first write's sake. |
| `id_migration` | *nothing* | 444 rows that record a one-off rewrite of every id. History, not data - and see the referential check below. |

## The six things that are not a column copy

1. **`users` splits, and one column leaves the database.** `users` gets `name`, `rank_id`, `role_id`. `users_private`
   gets `username` (the sheet's `user_name`), `status`, `is_change_password_on_login`. `password` goes to **Firebase
   Auth** or nowhere: credentials leave the database entirely, and no Firestore document should ever hold one.
2. **`assignments` and `schedule_templates` split.** The private half of each is `admin_note`, a field the sheet does
   not have, so it migrates as an empty string. The point is the read rule: a member reads the public document, an
   officer reads both.
3. **`audience_keys` is materialized on `announcements`, `events` and `documents`.** This is not optional: the member
   payload queries `where('audience_keys', 'array-contains-any', myKeys)`, so a document without the field is a
   document nobody ever sees - and that failure looks like an empty screen, not like a bad migration. It is built from
   `role_id`, `rank_id`, `user_id` plus `'*'`, with "this rank or above" expanded to concrete rank ids using
   `ranks.rank_order`.
4. **`is_open` on `schedule`** is `user_id === ''`. The board queries it, so an absent value is a row that never
   appears.
5. **`slot_key` on `schedule_offers`** is the value `slotKeyOfOffer` computes in `Code.gs` (`row-<schedule id>`, or
   `slot-<date>-<template id>`), because the calendar matches its open pills against it.
6. **`on_duty` is derived from open `timeclock` rows** (`time_out` empty), one small document per member. It is not a
   column anywhere, and the roster reads it.

A seventh thing is not a copy either, though it is only a TYPE: **`runner_score` must arrive as a number.** The leaderboard
is a query — `where('runner_score', '>', 0).orderBy('runner_score', 'desc').limit(25)` — and Firestore compares types, so a
score stored as text is not greater than zero: that member does not appear with a wrong score, they leave the board. Every
column the app compares or does arithmetic with is in `NUMERIC_COLUMNS` in the map for the same reason. `runner_score` is
there now; `npm run scores:normalize` reports — and, with `--apply`, repairs — anything a migration run before that change
left as text, and it is safe to run twice, which is what makes it usable as a check as well as a fix.

The map's first cut did not include it, and that is the shape of the risk worth remembering: a column that is only ever
*displayed* can be a string for years without anybody noticing, and it is a query arriving later that turns the type into a
bug. What pins it now is `npm run verify:firestore-reads`, which stores a text score, shows it missing from the board,
repairs it, and shows it appear — so the hazard is demonstrated on every run rather than described in a comment.

Two smaller moves: `settings` splits into `public` and `private` **by key**, and `user_settings.fcm_token` is dropped,
because the rules deliberately keep device tokens out of that document - `push_devices` is where they belong and
already has them.

## Secrets: what is refused rather than copied

`system_settings` is a key/value tab whose values the reconnaissance pass never printed, and one of its keys is a
**service-account private key** (the app holds an FCM credential there). So the migration refuses any key whose name
looks like a credential - `private_key`, `secret`, `password`, `token`, `api_key` - rather than copying it, and
reports every refusal. A credential in Firestore is readable by everyone the rules let read that document, and the
point of this move is that secrets stop travelling to browsers.

## Gaps this pass found

- **Three tabs have no security rules at all.** `documents`, `document_checklist_items` and `document_signatures` are
  in the model and in the reads, but there is no `match` for them in `firestore.rules`. The catch-all at the end
  denies everything, so they are safely closed rather than open - but they are also unusable, and the rules have to be
  written before those screens can move.
- **`timeclock` carries fourteen junk columns.** Nothing maps them; they can be deleted from the sheet whenever.
- **`id_migration` means ids were rewritten once.** Every `user_id` in every other tab should therefore be a *new* id.
  The plan checks that instead of assuming it: each foreign key is verified against the tab it points at, and anything
  that does not resolve is reported rather than silently migrated.
- **`documents.content` may be large.** A Firestore document is capped at 1 MiB and a guide could approach it, so the
  plan measures the largest one and reports it before anything is written.
- **`certification_badges` has rules but no tab.** It is a materialized index written by the certification writer, so
  the migration leaves it alone and the first certification save fills it.

## What the first real run of the plan changed

The plan found four things the design had not, and three of them were in the tooling rather than the data:

1. **`system_log`'s id is a row counter, not an id.** 35 of the 688 rows share an id with another row, so using it as
   a document id would have overwritten 35 audit rows in silence. The writer mints a Firestore id per row instead, and
   the sheet's id is kept as a field.
2. **12 audit rows name a user that no longer exists** (`mwills`, `crave`, `firefighter`, `Unknown` …) - usernames
   from before the id rewrite `id_migration` records. An FK check that treated those as errors would have been wrong:
   the log is history, so `system_log.user_id` is a **soft** reference, reported as a count and migrated as it stands.
3. **Declared columns are not leaks.** The credential-looking refusal fired 35 times on
   `is_change_password_on_login` and twice on `push_devices.token` - both the data of their own collection. A column
   the map has spoken about is exempt; only an **undeclared** credential-looking column is refused, and it is refused
   from the document as well as named in the report.
4. **The `fcm_*` settings are not copied at all.** They are the web config the browser used to be handed at runtime;
   after the move it comes from the build. `fcm_service_account_private_key` is refused for the same reason as before
   and the rest are dropped as mechanism rather than data.

And one thing the plan proved rather than assumed: **no announcement, event or document fills more than one audience
column.** That was the case an `array-contains-any` query cannot express, so it would have needed a different design -
it turned out not to exist.

The settings split is now explicit rather than guessed. Reading the real key names settled it: **18 of the 21 keys are
read by the browser** - the loading messages, the theme, the time format, the idle timeout, and the clock location the
fence is checked against - so they are named as public, and **private is the default** for anything added later. The
four `fcm_*` keys are not copied at all: they are the web config the browser used to be handed at runtime, and after
the move it comes from the build. `fcm_service_account_private_key` is the app's FCM credential and it stays where
Apps Script reads it; checking the `fcm_` namespace BEFORE the credential rule is what keeps that a *note* rather
than a problem somebody has to force past on every run, while an undeclared credential-looking key is still refused.

The plan now separates the two kinds of line, because the first run put 107 of them under one heading for four
findings, which is how a report stops being read to the end. **Notes** are what the plan *decided*: a junk column
ignored, the settings split by name, the audit rows kept as history, the id minted per row. **Problems** are what is
*wrong*: a reference that does not resolve, an id appearing twice, a credential under an undeclared column, a document
over 1 MiB, a tab with no mapping at all.

## What the officer surface needs from the rules before it can move

The member side is now running on Firestore: the sign-in payload, the officer payload, and the ten refresh reads.
The officer-only reads (users, certifications, templates, announcements, documents, events) cannot follow yet, and
the reason is in the rules rather than in the readers:

1. **Three collections have no rules at all.** `documents`, `document_checklist_items` and `document_signatures` are
   in the model and in the reads, and there is no `match` for them. The catch-all denies them, so an
   `ADMIN_GET_DOCUMENTS` routed today would answer `permission-denied` and fall back - correctly, but pointlessly.
2. **An officer's whole-collection read is not provable against an audience rule.** `announcements` and `events` are
   readable when the viewer's keys match the document's `audience_keys`, which is exactly right for a member and
   exactly wrong for the Announcements tab: it reads EVERY announcement, and Firestore refuses a query it cannot
   prove safe. The rules need an officer branch - `permission('can_make_announcements')` reads the collection whole -
   before that tab can leave the sheet.

So the next piece of work is a rules pass, not a reader: write the three document rules, add the officer branch to the
audience-bearing collections, and extend `scripts/verify-rules.mjs` to assert both halves - that a member still sees
only what they may, and that an officer's whole-collection read is allowed. The readers behind them are a few lines
each once that is true.

Only ONE member-facing exception is left in the routing table, and it is the one that has to be there: `GET_INITIAL_DATA`
runs before anyone signs in, so a route needing a Firebase user could never fire, and the router carries a single
pre-auth exception for it.

`MY_PUSH_DEVICES` was the other, and it is MOVED - the last member read to leave the sheet. It needed more than a
reader because it answers two questions at once. "Which devices are mine" is a member's own rows and always was
readable from Firestore. "Whose alerts arrive on THIS browser" is not a query Firestore will prove: a member may read
their own `push_devices` rows and nobody else's, so another member's token reads as nothing at all and a shared
computer looks like the signed-in member's own. The `pushDeviceOwner` callable answers it server-side, exactly as the
sheet did, and returns only whose device it is and on which device - nothing else about the row.

## Every read that has a caller is now Firestore's

The **system log** was the last one, and it is moved. It is a callable rather than a query, and that is a decision
rather than a shortcut: the response is not a page. It carries the counts for the footer and the facets for the filter
dropdowns, and those come from the WHOLE log - a dropdown offering only the values on the current page could never
select the value somebody is looking for - and the log names members and records failed sign-ins, so the permission
belongs on the server. It reproduces the sheet's `systemLogPage` exactly, down to the contract version the tab checks,
including two behaviours a Firestore query would have changed silently: the sheet's action filter is case-insensitive,
and a missing value sorts last in both directions where Firestore sorts it first in ascending order. The cost is a scan
per request instead of a bounded page, which is why `docs/FIRESTORE_MODEL.md` records the upgrade path.

Writing it turned up the thing that had been wrong since the functions started writing audit rows at all: they wrote
`created_at` as an ISO instant, and the tab's contract is `timestamp` in station time. Sorting can only happen on a
stored field, so that gap could not be papered over at read time - the writer now writes both, and the reader converts
ISO rows that predate it. An ISO instant rendered as station time is four or five hours wrong in a way that looks like
a real time rather than like a bug, which is the worst kind.

What is left on the sheet is three actions **nothing in the app calls** - `ADMIN_GET_USERS`,
`ADMIN_GET_CERTIFICATIONS`, `ADMIN_GET_SCHEDULE_TEMPLATES`, all named in `switchReads`. **Apps Script is out of
`api.js`**: the one gate every data call passes through dispatches to the reader or the writer and to nothing else, and
an action neither answers THROWS rather than being swallowed or asked of somewhere else. There is no second backend to
fall back to, and a screen that quietly receives nothing is the failure that module exists to prevent - so the sheet is
now the station's *data* and the specification the Firestore implementation was built from, and it answers nothing.

## Two things the login work found, and what each became

**An officer's password reset had no route of its own.** `resetMemberPassword` existed as a callable - it takes a
temporary password, sets the must-change flag, records who reset whose password on the member's own record and writes an
audit row - while the reset itself rode on `adminSaveUser`, a composite of profile fields, a username, a password and a
status in one save. Half-routing that would have split one save across two systems with two different outcomes, so it
moved as a whole: `adminSaveUser` writes the roster fields the rules allow directly, and hands the parts only a server
may do to the callables that already existed for them - status to `setMemberStatus`, the password to
`resetMemberPassword`, and the username and the change-on-next-login flag to `updateMemberAccount`. A username *change*
had nothing to route to at all, because `users_private` is writable by nobody and still is from the browser;
`updateMemberAccount` is what moves it now, along with the Auth address that goes with it.

**"Whose device is this browser?" could not be answered by a member.** The device card asks exactly that - it has to, or
a member on a shared computer is told their alerts are set up when they are set up for the person before them - and
`push_devices` lets a member read only their *own* row, so somebody else's token reads as nothing and `device_owner`
would come back null: the wrong answer rather than no answer. It is answered by the `pushDeviceOwner` callable, which is
the "a server may read it" option of the two: the rule stays "your own rows", and the function returns only the two
things the card draws, because a token is credential-shaped and the row it points at is nobody else's business. `null`
is a real answer there rather than a failure - it means this browser's alerts are set up to go to nobody.

**Neither was blocking the station, and neither is open now.** A member's Auth account holds the migration's temporary
password, so the passwords in `secrets/temp-passwords.txt` could be handed out at any point, and the login prefers
Firebase.

**One thing the move has silently changed, and it needs deciding.** The audit log. On the sheet, the server wrote an
audit row for what an officer did, because the server was the one doing it. Now the straightforward admin saves -
roles, ranks, shifts, assignments, templates, certification setup, checklist items, announcements, documents, events,
settings - go straight to Firestore from the browser, and **Firestore has no audit log**. The rows are correct and the
rules police who may write them, but nobody can say afterwards who changed a role. The callable-backed work (creating
a member, resetting a password, suspending somebody, saving the board) still audits, because a function does it.

The options are to accept it (the rules are the record of who may, not who did), to move those saves behind a generic
callable that audits before writing, or to have the audit written by the same client write - which the rules forbid,
and for a good reason: an audit row a browser can forge is not an audit row. It is written here because it is a real
change in what the station can answer for, and it is not the kind of thing to discover during an enquiry.

**Decided, and it is a toggle rather than one of the three.** The owner's answer was to let the station choose, with
#1 as the default, which is what is live now: nothing about an officer's straightforward save has changed, and no
audit row is written for one. An officer who wants #2 adds the setting `audit_client_writes` = TRUE in the System
Settings tab's own table - the tab already edits any key, so there is no new screen - and from then on every one of
those saves goes through the `saveDocumentWithAudit` callable, which checks the caller's permission from the database
before it writes and writes an audit row alongside. Slower, always accountable, and reversible by setting it back to
FALSE. The setting is public because the CLIENT has to read it to know which way to write; the read is one small
document, and it is read per save rather than cached so a station that has just switched it on does not have to wait.

The callable is not a general writer, which is the only reason it is safe to have one: the collection must be in its
table, that table names the permission each collection needs, and the table duplicates the client's routing on
purpose. A permission that exists only on the other side of a network call is not a permission.

## What the migration does, in order

1. **Read** every tab (read-only, service account, no writes at all).
2. **Map** each row through the table above, computing the derived fields.
3. **Check** - foreign keys, header drift, secret refusals, document sizes, and anything the map does not recognise -
   and print all of it.
4. **Report the plan** - per collection, how many documents would be written, and every problem found.
5. Only then, and only when asked, **write**. Written by the **Admin SDK**, not the browser SDK, so it bypasses
   `firestore.rules` entirely - which is exactly why steps 3 and 4 exist, and why the map has to be right rather than
   merely plausible.
6. **Report what is in Firestore but not in the sheet.** Named, never deleted: a migration that deletes is one bad
   read away from emptying a collection, and a person can decide what an orphan means. It is a **pre-cutover** check -
   while the app still writes through Apps Script, the sheet is the only writer, so an orphan is a row that was
   removed or an id that changed. After cutover the same list will include everything the app has created since.

The Auth accounts are a separate step in the same tool: every member in `users` needs an account before anything else
can move, the sheet holds only a hashed password, so each arrives with a temporary password and the officer-driven
change-on-first-login flow already in `functions/index.js` does the rest.

**And the account's uid is the sheet's id.** That is not a detail, it is the thing that decides whether any of this
works: every document about a member is keyed by their id - `users`, `users_private`, `user_settings`, and every
`user_id` in every other collection - and `firestore.rules` compares that key to `request.auth.uid`. If Firebase were
left to mint its own uid, the migration would file 33 members' rows under ids nothing could authenticate as, and each
of them would sign in to an empty station. The Admin SDK accepts a chosen uid, so the two line up by construction and
no reference anywhere has to be rewritten.

An account created by hand in the console is the one case that does not: it has a uid of Firebase's choosing and the
right address, so the migration cannot fix it and must not ignore it. The writer reports every such account by name,
with both ids, and exits non-zero - because the failure it prevents is a member who can sign in and see nothing.

## The ledger is empty

The routing harness (`npm run verify:backend-routing`) carries a TO-DO list of the actions `api.js` still asks the sheet
for, and asserts that every action the app calls is either routed to Firestore or written down in that list. It went from
twenty-three entries to none over this migration. The last three were:

| action | what it became | why it is not a column copy |
|---|---|---|
| `GET_RUNNER_LEADERBOARD` | a reader | Personal bests above zero, highest first, capped at the 25 rows the game draws, with `total` counting everybody who has scored. No permission, deliberately - "anyone who can play can see the board" - and no `orderBy`: see the Indexes section of `docs/FIRESTORE_MODEL.md` for why a query on this field would drop exactly the members who have never played. |
| `SAVE_RUNNER_SCORE` | a callable | The sheet clamped the score server-side - its own comment called it a "guard rail against a doctored request" - and only ever upwards. That has to stay server-side here for the same reason it was there: the board is SHARED, so an impossible number at the top of it is visible to everybody. It answers with the score still on file when a run was not a personal best, so the game can call it after every run. |
| `ADMIN_DELETE_USER` | a callable | The one action that could not be a column copy at all. The sheet deleted a spreadsheet row, because the row WAS the account. Here there is an Auth account to close, six documents to remove, records that must be kept, and two foot-guns the sheet never had at all: deleting yourself, and deleting the last administrator. See `deleteMember` in `functions/index.js`. |

What is left on the sheet is the station's **data** rather than its code, and that is the migration script's job - the
steps above. Nothing the app does is answered by Apps Script any more.

## The event times the migration lost, and how they come back

`typedValue` coerces every cell to text, and for the columns the app QUERIES it also normalizes the date - because
`where('date_from', '>=', '2026-09-01')` is a string range and `'3/6/2026'` sorts after `'2026-09-30'`. The day parser
it used is unanchored, so `'11/10/2026 18:00'` parsed happily to `'2026-11-10'` **and the hour was gone**. On an event
that is the whole story: `date_from`/`date_to` are date columns, but on an event they carry a time as well, and on a
RECURRING event they carry *only* times. Every migrated event therefore drew as "00:00 - 00:01".

The map is fixed - a value carrying a time keeps it verbatim while its date half is still normalized - so a fresh
migration is correct. **The rows already written are not, and no repair that reads only Firestore can fix them**: the
hour is not there to be reformatted. `npm run dates:normalize` rewrites a value through that same parser, and a
day-only value parses to itself, so it correctly reports nothing to do. The hour survives in exactly one place, the
spreadsheet, which is why the cure reads it.

Read from production when this was written: **11 events, every one of them day-only** - 10 timed and 1 all-day. And it
is worse than a display bug. `eventValidation` requires a timed event's end to be after its start, and both ends are
midnight, so **an officer who opens one of those events to change the title cannot save it at all**. That is asserted
rather than described, in the harness below.

The cure is `npm run events:restore-times` (`scripts/restore-event-times.mjs`), report-only by default and `--apply` to
write. What it guarantees, and `npm run verify:event-times` asserts every one:

- **It never touches an all-day event.** Day-only is the shape `AdminEventsTab` writes for one and the app reads its
  dates inclusively, so it is correct as it stands. Giving it an hour would invent a time nobody chose.
- **It can add an hour; it cannot move an event to another day.** If the sheet's day differs from the stored day then
  either the sheet was edited after the migration or the document was edited in the app since cutover, and which one
  wins is a human decision - so that row is named and left alone.
- **It writes only `date_from` and `date_to`, with `update()` and never `set()`**, so a title, colour or audience an
  officer has changed since cutover is not rolled back to the sheet's stale copy. This is also why a blanket re-run of
  `npm run migration:write` is the wrong cure: it would overwrite post-cutover edits with the sheet's older version.
- **It refuses a pair the form would reject**, because writing one would leave the event unsaveable - the very failure
  being repaired.
- **Everything it declines is counted and named**, never guessed at: a row whose time the sheet lost too is a row for
  an officer to re-enter, and saying so is the useful answer.

Restoring the hour is not quite enough on its own, and the sheet shows why. Two of the eleven cells hold a
single-digit hour - `2026-09-26 8:00` and `2026-10-31 8:00` - and nothing in the app *objects* to that: `eventMinutesOf`
reads it as 480 and `eventValidation` passes the pair. But `AdminEventsTab` hands those fields straight to an
`<input type="datetime-local">` (`date_from.replace(' ', 'T')`) or an `<input type="time">`
(`date_from.slice(11, 16)`), and both run the value sanitization algorithm, which **sets the value to empty unless the
hour is two digits**. So restoring `8:00` verbatim would have fixed the calendar and left the officer staring at a blank
"Starts" field in the very form they would use to correct it. `typedValue` therefore zero-pads the hour, which is also
simply the shape the app writes - its `toInputValue` pads, and a time input's change event always yields `HH:MM`. A
meridiem is deliberately **not** converted: `8:00 PM` to `20:00` is a conversion rather than a normalization, no cell in
the sheet carries one, and guessing at data nobody has is worse than naming the row.

The harness is built through Vite like `verify-events.mjs`, because the repair cannot import `src/utils/events.js`
(its imports are extensionless, which is Vite's resolution and not node's) and so it copies two small rules. The
harness holds both the copies and the originals and asserts they agree, and it checks every pair the repair can
produce against the app's own `eventValidation` - which is what makes "the repair cannot write something the form
rejects" a proved property rather than an intention.

