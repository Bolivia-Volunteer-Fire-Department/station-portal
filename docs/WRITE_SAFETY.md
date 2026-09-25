# Write Safety and Concurrency

What happens when two people save at the same time, what the app does about it, and what it deliberately does
not. Everything here lives in the Apps Script backend (`src/services/Code.gs`) and the API client
(`src/services/api.js`).

## The short version

Google Sheets has **no transactions and no conflict detection**. Two writers to the same cell produce last-one-
wins, silently; you get a lost update, never a corrupt cell. So the app serialises its own writes with an Apps
Script script lock, re-checks business rules before filling anything, and versions the records an administrator
edits. Recovery, if it is ever needed, is the spreadsheet's **File → Version history**; the **System Log**
sheet records who did what.

## What changed, and why

| Before | After |
| --- | --- |
| A write that could not take the script lock within 10s ran **anyway, unlocked** - the answer was only used to decide whether to release it | A write that cannot take the lock is **refused** (`code: BUSY`, "your change was NOT saved") and the client retries once after the server's suggested wait |
| The Loading Messages card issued **ten** separate requests, so a failure part-way left the messages half updated | One `ADMIN_SAVE_SYSTEM_SETTINGS` request, validated as a whole, written in one pass |
| Clock-out wrote up to four cells with a Google Maps lookup **between** them: a failure left the row stamped out with no address, and the lock was held across the network call | The address is looked up first, then the whole row is written once |
| Clock-in appended a second open entry if a tap or a second tab got through | Refused server-side (`ALREADY_CLOCKED_IN`) |
| Clock-in built a positional 7-cell row | Built through the sheet's own headers, so reordering a column cannot misfile it |
| Two administrators editing one record: last save won, the first change silently gone | The row carries `row_version`; a save built on a stale copy is refused (`code: CONFLICT`) with the row as it now stands |
| "Sign out everywhere" could be undone by a request that had already validated the session | Sessions carry a per-member **epoch**; a revoked session cannot resurrect itself |

## The rules, as they stand

**Writes are serialised.** `doPost` takes a script lock for any action that is not in `READ_ONLY_ACTIONS`, waits
up to 20 seconds, and refuses rather than proceeding. `scripts/verify-refresh-wiring.mjs` fails the build if an
action listed as read-only contains a write call, and `scripts/verify-write-safety.mjs` fails it if a refusal
writes anything at all.

**Reads hold nothing.** That is deliberate: a save's refresh wave is ten requests, and serialising those behind
a write is what made a save settle in thirty seconds instead of two. `getAuthContext` does write one session
property per authenticated request (the sliding expiry) - see the epoch note below for why that is safe.

**Optimistic concurrency, not locks, for edited records.** A record edited in an admin form carries
`row_version`. The form sends back the version it loaded; `upsertSheetRowById` compares it before writing and
refuses a mismatch. The column is added to a sheet automatically on its first save (existing rows start at 1),
so there is no migration step. **A save that sends no version is not checked** - that is what lets a page
deployed before this keep working against a backend that has it, and it is why the bulk writers (a month of
schedule rows at once) stay out of the scheme.

**A member's revocation is authoritative.** Revoking sessions bumps a per-user epoch, and every request compares
the epoch in its session record. Deleting the records alone was not enough: sliding expiry rewrites a session on
every request, so one that had already been validated could write itself back after the delete.

## Record ids are UUIDs

Every record id (`users`, `schedule`, `schedule_offers`, `announcements`, …) is a UUID, minted by `newRowId()`
in one place. `system_log` is the one exception: nothing references a log row, so it keeps compact numeric ids
that read well in the sheet.

This replaced `getNextId` — "the last row's id plus one" — which **reused** ids after a delete. Deleting the
highest-id schedule row freed that id, the next created shift inherited it, and a `schedule_offers.schedule_id`
still on file silently pointed at a **different shift**: the approvals screen and `fillShiftFromOffer` both
resolve that reference by id, so an approval could fill the wrong slot. A UUID also removes the allocation read
(a create no longer depends on reading the sheet first), and stops ids being enumerated to watch the station's
growth.

Existing data was migrated once with `migrateIdsToUuids()` — see [Migrating ids](#migrating-ids) below, or the
section note above it in `Code.gs`. Ids are strings everywhere, so every comparison coerces them
(`String(a) === String(b)`), which is what the code already did.

## Migrating ids

Run from the Apps Script editor, once, after deploying the version of `Code.gs` that allocates UUIDs:

    migrateIdsToUuids()                    // dry run: reports what it would do, writes NOTHING
    migrateIdsToUuids({ dryRun: false })   // the real thing

What it does, and why it is a script rather than a manual pass:

- it walks **every** reference column — `*_id` columns plus `approved_by`, `declined_by` and `author_user_id` —
  not just the id columns, because a mistyped id in `schedule.user_id` does not error, it silently puts somebody
  else on a shift;
- it **refuses** to write if a sheet has a duplicate id, a row with no id, or a reference it cannot resolve — and
  reports a dangling reference rather than blanking it;
- it records every old→new pair in an `id_migration` sheet, so a run that dies part-way can be **completed by
  running it again** (the recorded pairs are reused, rather than fresh UUIDs orphaning the references);
- it is idempotent: a second run changes nothing and appends nothing;
- it finishes by bumping every member's session epoch, so everyone signs in again against the new ids
  (their sessions carried the ids that just changed).

Before running it: check the spreadsheet for any formula, chart or external reference of your own that quotes an
id — that is the one thing a script cannot see. After running it: sign in, clock in and out, open My Schedule,
and check one admin tab per permission level.



Be clear about these with anyone who asks - they are operating rules, not bugs:

- **A human editing the sheet.** The app's lock cannot coordinate with somebody typing in Google Sheets, and an
  edit there does not bump a row version. Use **Data → Protected ranges** on the sheets the app owns.
- **Two Apps Script projects on one spreadsheet.** The lock is per *project*, not per file. One project per
  spreadsheet; do not leave an old deployment pointed at production.
- **Bulk edits versus single-record edits.** The schedule board and the availability grid own a whole month at
  once and send no versions, so they are neither refused nor do they invalidate anyone. A bulk save can still
  overwrite a single-record edit made earlier.
- **Reads during a write.** A read that overlaps a multi-step write can see it half applied (updates written,
  appends not yet). It corrects itself on the next refresh; there is no snapshot isolation to be had.

## Verifying it

    npm run verify:write-safety   # the lock gate, the refusals, the timeclock, the epochs, row versions
    npm run verify:refresh-wiring # read-only actions really do not write, and doPost refuses a lock it cannot take
    npm run verify:all            # everything

`verify-write-safety` extracts the real functions out of `Code.gs` and runs them against a fake sheet and a lock
that can be made to fail, so the refusals are asserted to write **nothing** rather than merely to return an
error. It also contains a deliberate control: a demonstration that the old fail-open path really did produce two
rows with the same id, so the assertions cannot be passing for the wrong reason.
