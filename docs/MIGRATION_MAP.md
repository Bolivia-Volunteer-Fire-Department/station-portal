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
| `system_log` | `system_log` | Straight copy, 688 rows of history. |
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
the move it comes from the build. `fcm_service_account_private_key` is refused outright.

The plan now separates the two kinds of line, because the first run put 107 of them under one heading for four
findings, which is how a report stops being read to the end. **Notes** are what the plan *decided*: a junk column
ignored, the settings split by name, the audit rows kept as history, the id minted per row. **Problems** are what is
*wrong*: a reference that does not resolve, an id appearing twice, a credential under an undeclared column, a document
over 1 MiB, a tab with no mapping at all.

## What the migration does, in order

1. **Read** every tab (read-only, service account, no writes at all).
2. **Map** each row through the table above, computing the derived fields.
3. **Check** - foreign keys, header drift, secret refusals, document sizes, and anything the map does not recognise -
   and print all of it.
4. **Report the plan** - per collection, how many documents would be written, and every problem found.
5. Only then, and only when asked, **write**. Written by the **Admin SDK**, not the browser SDK, so it bypasses
   `firestore.rules` entirely - which is exactly why steps 3 and 4 exist, and why the map has to be right rather than
   merely plausible.

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
