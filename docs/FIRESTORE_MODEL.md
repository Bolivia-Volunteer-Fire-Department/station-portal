# The Firestore Model

**Status: design, not implemented.** This document is the thing to argue with before any code
exists. It describes what replaces the Google Sheets backend: one Firestore collection per thing
the app stores, who writes each one, what rule replaces each server-side check, and which index
each query needs.

Decisions already taken, so they are not re-litigated here:

- **Firestore only**, in the existing Firebase project (Blaze, for Cloud Functions). Realtime
  Database stays in our back pocket for presence and typing indicators when chat arrives.
- **`src/services/api.js` stays the client's only door.** The same exported functions — 87 of them,
  84 of which name a server action — with their internals swapped, so no component changes in the
  first four phases.
- **Usernames, not email addresses.** A member's Auth email is their username plus a synthetic
  domain, and no mail is ever sent.
- **Officer-driven password resets**, for accountability — an officer-only function sets a
  temporary password and an audit row naming the officer who did it.
- **Offline persistence on.** Reads work with no signal. Writes that need a trustworthy clock
  (clocking in and out) require connectivity; see "Offline" below.
- **GitHub Pages** keeps serving the app for now; Firebase Hosting is a later, optional switch.

The current backend is 9,257 lines of Apps Script that reads whole sheets, filters rows, strips
fields, applies audience rules and computes what each viewer may see. Almost all of that work is
*policy*, and policy is what the new rules have to say instead.

## The short version

Every collection gets **one writer, one rule, one index**. A fact lives in exactly one place. Where
one row holds both a public and a private fact, the row is **split into two documents**, never
copied — so there is still nothing to keep in sync. The four or five values that a screen cannot
compute for itself are **materialized by the writer that changes their source**, in the same
transaction, so they cannot drift. Credentials move to Firebase Auth, secrets leave the database
entirely, and everything the old server enforced becomes either a security rule or a transaction.

## Why the shape changes at all

Two facts about Firestore drive every decision below, and neither is a preference:

1. **A document is the unit of permission.** Rules allow or deny whole documents — never
   individual fields, and never a subset of rows within a document. There is no way to say
   "return this row without `admin_note`". (Write rules *can* constrain field sets, which is how a
   client is stopped from writing a field it does not own.)
2. **A query has to be provably safe.** If a query *could* return a document the rules deny,
   Firestore rejects the whole query rather than quietly filtering it. So every screen's query has
   to be something the rule can accept as written, which is what makes some of the fields below
   exist at all.

Two more, which are consequences rather than rules: there are **no joins** (so a second collection
is read and joined in the client's cache, which is free), and **no views or computed columns** (so
a derived value is either computed client-side or stored and maintained).

## The four options this document picks between

- **A — no projection.** One collection; the rule says "your own rows" and the client always
  constrains its query the same way. Cheapest: one copy, one read, and it works with live updates.
- **B — split the document.** One row becomes two documents with *disjoint* fields and different
  audiences, sharing an id. Not duplication: each fact still has one home, so nothing can drift.
- **C — a function returns the payload.** Today's shape, kept as a deliberate, temporary crutch
  for anything genuinely computed. It reintroduces a server round trip and cannot be listened to,
  so it is the option we intend to remove before go-live.
- **D — materialized on write.** A field or document computed and stored when its source changes:
  an audience list, an open-shift flag, a derived status. This spends writes to save reads, and it
  is only safe because of the rule below.

## The one-source-of-truth rules

Relational habits are correct here; what changes is *where* the boundaries are. These five rules
are what keep "one source of truth" true in a database that cannot join, cannot project fields,
and cannot compute:

1. **One writer per fact.** Each fact has exactly one place it is written, and this document names
   it. A second writer is a bug.
2. **A split holds different facts, never a copy.** `assignments` and `assignment_private` share an
   id and hold different fields. If two documents ever need the same field kept in step, the answer
   is to move the field, not to write it twice.
3. **A materialized value must be derivable from the normalized data alone**, and it is written by
   the same transaction that changes its source. It is a cache or an index — never a second source
   of truth.
4. **Claims are a cache.** A member's custom claims tell the client who they are without a read, but
   they refresh roughly hourly, so a *role change would otherwise lag*. The role document stays the
   source of truth and the rules read it.
5. **Nothing sensitive shares a document with something public.** No `password`, no FCM credential,
   no officer-only note. This is rule 2 applied to fields that rules cannot hide.

## Collections: identity and access

`users` is the clearest example of a split. Today's row holds a username, a password hash, a role,
a status, a name and a rank — and the app hands every member a three-field projection of it
(`rosterRowsFor`), while officers see the rest. In Firestore the row becomes two documents that
hold *different facts*, so the roster needs no copy at all.

| collection | fields | written by | read by | option | rule, in words |
|---|---|---|---|---|---|
| `users/{id}` | `name`, `rank_id`, `role_id` | officer Functions (create), and the officer's own save | **any signed-in member** | B | The roster is not sensitive: a member needs names to label other people's shifts. This document holds nothing else, so there is nothing to strip. |
| `users_private/{id}` | `username`, `status`, `created_at`, `notes` | officer Functions only | the member (own doc) and officers | B | The username is not secret, but the app deliberately withholds it from members, so it cannot live in the roster document. |
| `roles/{id}` | `description`, `is_admin`, and the 30 permission flags | officer with `can_edit_roles`; a role with `is_admin` only by an administrator | **any signed-in member** | A | The client needs the flag list to shape its own navigation, and the rules read it to decide what a caller may do — see "Claims are a cache" below. |
| `ranks/{id}` | `description`, `rank_order`, `color`, `icon` | officer with `can_edit_ranks` | any signed-in member | A | Reference data for labels and the crew ordering. |
| `user_settings/{userId}` | `time_format`, `is_dark_mode`, notification preferences | the member (own doc) | the member, and officers | A | Keyed by the member's id, so "your own document" is the whole rule. |
| `push_devices/{id}` | `user_id`, `token`, `device_label`, `updated_at` | the member's own browser, via api.js | the member (own), officers for the FCM status tab | A | The device token leaves `user_settings` and lives where it belongs — which is also what lets `user_settings` be plainly readable by its owner. |

**One wrinkle worth naming.** A username is part of the *credential*, so its real home is Firebase
Auth: the synthetic email's local part. The Users tab needs to display usernames, and reading them
back out of Auth means a server round trip — so `users_private.username` keeps a display copy,
holding to rule 3: it is derivable from Auth, and the officer Functions that create or rename a
member are its only writers. If that ever proves fragile, the fallback is to read the list from
Auth and delete the field.

## Collections: configuration

| collection | fields | written by | read by | option | rule, in words |
|---|---|---|---|---|---|
| `settings/public` | the world-readable settings: department name, loading messages, clock-location configuration | officers with `can_edit_system_settings` | any signed-in member, and the login screen | A | This is `publicSystemSettings` as a document instead of a row-per-key filter. |
| `settings/private` | every other setting | same | officers | B | Not a copy: a different, disjoint set of keys. |
| `shifts/{id}` | `description`, `start_time`, `end_time` | officer with `can_edit_schedule` | any signed-in member | A | The shift *definitions* members pick when marking availability. |
| `apparatus/{id}` | `id`, `description` | officer with `can_edit_schedule` | any signed-in member | A | Reference data for the schedule board. |
| `assignments/{id}` | `description`, `color`, `icon`, `rank_order_required` | officer with `can_edit_assignments` | any signed-in member | B | The member calendar draws pills from exactly these fields. |
| `assignment_private/{id}` | `admin_note` | officer with `can_edit_assignments` | officers | B | The one field a member's copy must not carry — so it moves, and nothing is duplicated. |
| `schedule_templates/{id}` | `day_of_week`, `start_time`, `end_time`, `assignment_id`, `nickname` | officer with `can_edit_schedule_templates` | any signed-in member | B | As above: the weekly pattern, minus the note. |
| `schedule_template_private/{id}` | `admin_note` | officer with `can_edit_schedule_templates` | officers | B | Same treatment. |

Both splits are written in one batch by the same officer save, so a row and its private half can
never disagree — a split costs no atomicity.

## Collections: the schedule

| collection | fields | written by | read by | option | rule, in words |
|---|---|---|---|---|---|
| `schedule/{id}` | `schedule_template_id`, `assignment_id`, `user_id` (empty = open), `date_from`, `date_to`, `start_time`, `end_time`, `is_open` | officer with `can_edit_schedule`, in one batch per board save | **any signed-in member** | A + D | A member is meant to see the crew's shifts — that is what "Show everyone" draws and how the calendar labels other people's pills. So no row filtering: the collection is readable, and the *date range* is what the query narrows. |
| `availability/{id}` | `user_id`, `schedule_template_id`, `date_from`, `date_to` | the member's own save (batch add/remove) | the member (own rows), officers (all) | A | One row per member per date — ten thousand a year at station scale — so this is exactly the table that must never travel whole. The rule states it: `user_id` is the caller. |
| `schedule_offers/{id}` | `user_id`, `schedule_id`, `date_from`, `assignment_id`, `status`, `slot_key`, `approved_by` | the member who offers; the officer who approves | the member (own), officers with `can_approve_shifts` (all), and other members' offers only as an approved schedule row | A | `can_make_offers` is what lets a member write; the approval is an officer's write. |
| `on_duty/{userId}` | `user_id`, `time_in` | the clock-in/out **transaction**, never a client | any signed-in member | D | "Who is on duty" is derived from open clock entries — but members may only read their *own* clock rows, so the answer cannot be a query. One small document per clocked-in member, written by the same transaction that opens and closes their entry, is both cheaper and live. |

## Collections: timeclock

| collection | fields | written by | read by | option | rule, in words |
|---|---|---|---|---|---|
| `timeclock/{id}` | `user_id`, `time_in`, `time_out`, `gps_lat`, `gps_lon`, `is_manual`, `calc_address` | **a transaction** on clock in/out | the member (own rows), officers (all) | A | The one that already stops at the member: My Clock History filters to the signed-in member, and so does the app's "am I clocked in" lookup. In Firestore the rule enforces it instead of the filter. |

Clocking in and out is the transaction that also writes `on_duty`, so the two can never disagree:
either the entry opens and the member appears on duty, or neither happens. This is also where the
script-wide lock finally goes away — today two simultaneous saves could collide and one was told
to try again; a transaction retries itself instead.

## The open-shift case, worked through

The hardest rule in the app, and the one to settle first because it shapes the query. Today a
member may see **their own shifts** and **any unfilled shift they are eligible to fill**, and
eligibility is a rank comparison against the assignment's `rank_order_required`.

Written naively, the rule would be an OR — `user_id == uid || is_open == true` — and an OR is where
"the query must be provably safe" bites: Firestore has to be able to prove that *every* document a
query could return satisfies the rule, and it will not reason its way through a disjunction for
you. There are two workable shapes, and the choice is a Phase 0 decision:

1. **Two queries, one per rule.** The calendar asks for `where('user_id','==',uid)` and separately
   for `where('is_open','==',true)`, with `is_open` maintained by the same write that fills the
   shift. Each query has its own single, provable condition, and both streams can be listened to.
2. **One collection per audience.** Open shifts live in `schedule_open/{id}` and filled ones in
   `schedule/{id}`, moved between them by the write that fills a slot. More moving parts, but each
   collection has one simple rule and one simple query.

Option 1 is my recommendation — fewer writes, and the two queries are exactly the two things the
calendar draws anyway. Either way, the emulator test for `can_make_offers` is what proves it, and
that test is the reason this document exists before the code does.

## Collections: training and certifications

| collection | fields | written by | read by | option | rule, in words |
|---|---|---|---|---|---|
| `trainings/{id}` | `title`, and its other columns | officer with `can_edit_trainings` | any signed-in member | A | The list of trainings everyone may read, exactly as `trainingRowsForApp` serves it. |
| `training_signatures/{id}` | `training_id`, `user_id`, `signed_at` | the member who signs; officers who amend | the member (own), and officers with `can_administer_trainings` (all) | A | The permission that widens this one is a *claim on the reader*, which is why the rule reads the role document rather than the signature. |
| `certification_setup/{id}` | `name`, `icon`, `sort_order`, `warn_days_before`, `is_renewable`, `show_next_to_name`, `description` | officer with `can_manage_certification_setup` | any signed-in member | A | The catalog the member's own records are named and iconed from. |
| `certifications/{id}` | `user_id`, `certification_id`, `effective_date`, `end_date`, `notes`, `updated_at` | officer with `can_manage_certifications` | the member (own records), officers (all) | A | **The dates are the source; the status is computed.** |

That last row is worth stating plainly, because it is a place I would *not* follow the
materialize-on-write instinct. Expiry status is a function of two dates and today's date, so a
stored status would go stale on its own, without anyone writing anything — the one thing rule 3
forbids. The app already computes it on both sides from the same logic, and
`scripts/verify-certifications.mjs` already asserts the two agree, so the client keeps computing it
from the dates it has.

## Collections: documents

The shape here is already right — `GET_DOCUMENTS` returns metadata only, and a body is fetched one
document at a time — so this is a straight port with the split made explicit in the data.

| collection | fields | written by | read by | option | rule, in words |
|---|---|---|---|---|---|
| `documents/{id}` | `title`, `folder`, `doc_type`, `sort_order`, `is_published`, `rank_id`, `is_sign_required`, `effective_date`, `end_date`, `content_revision`, `author_user_id`, `updated_at` | officer with `can_manage_documents` | members with `can_view_documents`; the metadata only | B | The list view's fields, and nothing heavy. |
| `document_bodies/{docId}` | `content` | the same save, in one batch with the metadata | same | B | Split out because a body is the expensive half: the list never needs it, and one document's body is fetched when it is opened — which is what the API already does. |
| `document_checklist_items/{id}` | `document_id`, `sort_order`, `section`, `label` | officer with `can_manage_documents` | members with `can_view_documents` | A | Rows of one document's checklist. |
| `document_signatures/{id}` | `document_id`, `checklist_item_id`, `user_id`, `signed_by_user_id`, `signature_role`, `signed_at`, `content_revision` | the member who signs; the verifier who countersigns | the member (own), officers with `can_verify_documents` | A | `signature_role` distinguishes the member's own sign-off from an officer's verification — the same two roles the app already models. |

## Collections: communication and audit

| collection | fields | written by | read by | option | rule, in words |
|---|---|---|---|---|---|
| `announcements/{id}` | `title`, body fields, the three `is_visible_on_*` flags, and `audience_roles`, `audience_ranks`, `audience_users`, `audience_locations` | officer with `can_make_announcements` | whoever the audience arrays name | D | Today `announcementRowsFor` filters in the function. Here the audience is **materialized as arrays the client queries and the rule checks**, because a rule cannot filter rows for you: the query must be able to say `array-contains` the viewer's role, and the rule has to accept exactly that. |
| `events/{id}` | `title`, `date_from`, `date_to`, `author_user_id`, audience fields as above | officer with `can_create_events` | as above | D | Same treatment, for the same reason. |
| `system_log/{id}` | `user_id`, `action`, `details`, `created_at` | **Functions only** — never a client | officers with `can_view_system_log` | A | The audit trail. Making the client unable to write it is the point: an audit row that a browser can forge is not an audit row. |
| ~~`id_migration`~~ | — | — | — | — | Dropped entirely. It existed to rewrite ids in place in a spreadsheet; Firestore documents have stable ids from birth. |

## Indexes

Firestore wants an index for anything but a single-field query, and it tells you by failing one.
They belong in `firestore.indexes.json`, so they are reviewed like code rather than clicked in a
console.

| query | index |
|---|---|
| schedule for a date range | `schedule`: `date_from` ascending |
| my shifts | `schedule`: `user_id`, `date_from` |
| open shifts | `schedule`: `is_open`, `date_from` |
| my availability | `availability`: `user_id`, `date_from` |
| my clock history, newest first | `timeclock`: `user_id`, `time_in` descending |
| my offers | `schedule_offers`: `user_id`, `status` |
| offers awaiting approval | `schedule_offers`: `status`, `date_from` |
| my signatures | `training_signatures`: `user_id`, `signed_at` descending |
| my certifications | `certifications`: `user_id`, `end_date` |
| announcements for me | `announcements`: `audience_roles` (array-contains), `created_at` descending |
| events in a range | `events`: `date_from`, `date_to` |
| the audit trail | `system_log`: `created_at` descending |

## Auth

- **Username → email.** A member's Auth email is `username@<synthetic domain>`, and the client signs
  in with `signInWithEmailAndPassword` built from the username that was typed. No mail is ever sent
  or expected, so email verification and reset-by-email are disabled rather than merely unused.
- **Officer-driven resets**, as required for accountability: an officer-only callable Function sets
  a temporary password, flags `must_change_password`, and writes a `system_log` row naming the
  officer and the member. The member then walks through the change screen that already exists.
- **Creating a member** is the same kind of Function: it creates the Auth user and writes `users`,
  `users_private` and `user_settings` in one batch, so a half-created member is impossible.
- **Claims are a cache.** `role_id` and `is_admin` ride in the token so the client can shape its own
  navigation without a read. The *rules* never trust them for access: they read
  `users_private/{uid}.role_id` and then `roles/{roleId}`, so removing somebody's access takes
  effect on their next request rather than on their next token refresh, which can be an hour. That
  is why rule 4 exists, and why the role document is the source of truth.
- **Sessions disappear.** The session token, the cache-service session record, the revocation epoch
  and the server-side idle timeout all go: Firebase Auth owns the credential's lifetime, and the app
  keeps its own idle-logout UX on the client, where it belongs.

## Secrets

Nothing sensitive stays in the database, because a rule that has to remember to hide a field is a
rule that can forget. The FCM service account moves into Functions secret storage. The Firebase web
config and VAPID key become build-time `VITE_FIREBASE_*` values in `.env` (already gitignored, with
`.env.example` as the template) — a Firebase web config is public by design, and it is rules and
App Check that protect the project, not the key. That also removes today's round trip through
`system_settings` to hand the browser its config.

## The client seam

`src/services/api.js` keeps its exported functions — 87 of them, 84 naming a server action — and
their signatures. Only the bodies change.

| action group | count | becomes |
|---|---|---|
| `admin*` | 51 | Firestore writes — batched where a save touches a row and its private half — or a callable Function where the write needs a trusted party |
| `fetch*` | 18 | Firestore queries, then listeners |
| `sign*`, `save*`, `verify*`, `submit*`, `set*`, `register*` | 19 | Firestore writes, with transactions for clock in/out and shift fills |

Nothing in `src/components/**` changes across Phases 1–4. Two client behaviours do change, and both
are improvements worth naming up front: the **refresh wave stops existing** (a listener pushes the
change instead of the app re-fetching everything after every save), and retry/patience handling
simplifies, because a save no longer queues behind a script-wide lock.

## Offline

Reads work with no signal: the schedule, the roster and a member's own history all come from cache,
which is a real win for a station with dead spots. Writes queue, and a queued write carries the
*device's* clock rather than the server's — so **clock in/out and shift approvals require
connectivity** and say so when they are offline. Everything else may queue safely.

## What disappears

Sessions and their revocations; the script-wide write lock and its "busy, try again" response; row
versions and their upcasting; password hashing and the timing salt; the id-migration tool; the 111
`getSheetData` call sites; the projection helpers that become rules; and `Code.gs` itself — 9,257
lines.

`docs/AUTH_SECURITY.md` and `docs/WRITE_SAFETY.md` describe guarantees that move from server code
into rules and transactions. Both will need a rewrite saying where each guarantee now lives, and
that rewrite belongs in the same commit as the code that moves it.

## Verification

The rules become the enforcement, so the harnesses that proved enforcement are rewritten as
**emulator tests that sign in as a real member and run the real queries**. That verifies the rule
*and* the query together, which a rule-only test cannot: the classic Firestore failure is a correct
rule with a query the rule will not accept, or a permissive query with a rule that never fires.

| harness | today | its Phase 0/1 shape |
|---|---|---|
| `verify:write-safety` | runs the write paths against a fake workbook | the same writes against the emulator, allowed and denied per role |
| `verify:permissions` | asserts the flag list and its gates | one emulator case per permission flag |
| `verify:auth-security` | session and password behaviour | Auth behaviour plus the officer reset path and its audit row |
| `verify:bootstrap` | the two payloads against a fixture | the equivalent reads, per role |
| `verify:id-schema`, `verify:session-timeout`, `verify:refresh-wiring` | the spreadsheet's plumbing | retired with the code they test, their intent folded into the rows above |

The other 25 harnesses never touch the backend — print sheets, motion, sounds, day order, the admin
render checks, the documents renderer — and stay exactly as they are. They are also what makes this
port verifiable at all: the UI cannot silently change underneath it.

## Phase 0, and what "done" means

1. `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`, and `functions/` in
   plain JS, matching the repo's conventions.
2. The emulator wired into `npm run emulators`, plus a `verify:rules` harness added to the
   `verify:all` chain, in the same style as the existing 48.
3. `scripts/seed-emulator.mjs`, built from the fixture `verify-bootstrap` already uses — one
   administrator, one member, one shift on duty — so a demo station exists in seconds.
4. This document agreed, with the open-shift shape decided.
5. Guardrails: budget alerts, App Check, and a reads-per-screen budget written down so the free
   tier is never a surprise.

**Exit criteria:** the emulator boots, the seed runs, the rules tests pass in CI, and one thin slice
works end to end — sign in with a synthetic email and read the dashboard from Firestore. That
proves the shape before any bulk porting starts, which is the whole point of doing Phase 0 at all.

## Open questions

- **The open-shift shape** — two queries or two collections. My recommendation is two queries; the
  emulator test is what settles it.
- **The synthetic email domain string**, which is effectively permanent once members exist.
  `.invalid` is honest about never receiving mail; the department's future domain is more
  meaningful. Either is defensible, but it should be chosen deliberately rather than by default.
- **The reporting mirror.** Pulling data into a spreadsheet is a habit worth keeping, and a nightly
  Function exporting collections to a Sheet is small — but it should be scheduled deliberately
  rather than discovered as missing after go-live.
- **Presence**, when chat arrives: Realtime Database's `onDisconnect` is the honest tool for
  online/offline and typing indicators, and it can live in this same project as a second database.
